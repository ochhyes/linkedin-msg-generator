/**
 * Background Service Worker
 *
 * Handles API communication and stores settings.
 * Popup sends requests here; this worker calls the backend.
 *
 * Storage split:
 *  - chrome.storage.local  → 'settings' (API URL/key/defaults), 'lastSession' (popup state)
 *  - chrome.storage.sync   → 'userSettings' (personalization: style, examples, antipatterns, sysPrompt)
 */

const DEFAULT_SETTINGS = {
  apiUrl: "https://linkedin-api.szmidtke.pl",
  apiKey: "",
  defaultGoal: "recruitment",
  defaultLanguage: "pl",
  defaultMaxChars: 1000,
  senderContext: "",
};

// ── Settings (local — API creds + runtime defaults) ──────────────────

async function getSettings() {
  const data = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

// ── User personalization settings (sync with local fallback) ─────────

async function getUserSettings() {
  try {
    const s = await chrome.storage.sync.get("userSettings");
    if (s && s.userSettings) return s.userSettings;
  } catch (e) { /* sync unavailable */ }
  try {
    const l = await chrome.storage.local.get("userSettings");
    return l.userSettings || null;
  } catch (e) {
    return null;
  }
}

/**
 * Convert camelCase frontend shape → snake_case backend shape.
 * Returns an object to spread into the request body (only non-empty fields).
 */
function personalizationToBody(us) {
  if (!us) return {};
  const out = {};

  if (us.senderOffer && us.senderOffer.trim()) {
    out.sender_offer = us.senderOffer.trim();
  }

  if (us.senderStyleSample && us.senderStyleSample.trim()) {
    out.sender_style_sample = us.senderStyleSample.trim();
  }

  if (us.customExamples && Object.keys(us.customExamples).length) {
    const ce = {};
    for (const [goal, data] of Object.entries(us.customExamples)) {
      const conv = {};
      if (Array.isArray(data.examplesGood) && data.examplesGood.length) {
        conv.examples_good = data.examplesGood
          .filter((e) => (e.profile || "").trim() && (e.message || "").trim())
          .map((e) => ({ profile: e.profile, message: e.message }));
      }
      if (data.exampleBad && data.exampleBad.message && data.exampleBad.why) {
        conv.example_bad = {
          message: data.exampleBad.message,
          why: data.exampleBad.why,
        };
      }
      if (conv.examples_good?.length || conv.example_bad) {
        ce[goal] = conv;
      }
    }
    if (Object.keys(ce).length) out.custom_examples = ce;
  }

  if (Array.isArray(us.customAntipatterns) && us.customAntipatterns.length) {
    const cleaned = us.customAntipatterns.map((s) => (s || "").trim()).filter(Boolean);
    if (cleaned.length) out.custom_antipatterns = cleaned;
  }

  if (us.customSystemPrompt && us.customSystemPrompt.trim()) {
    out.custom_system_prompt = us.customSystemPrompt.trim();
  }

  return out;
}

// ── Diagnostics — telemetria fail'i scrape (#5) ──────────────────────

/**
 * Wyciąga slug profilu z URL'a LinkedIn (kopia helpera z popup.js;
 * vanilla JS bez modułów, więc ad-hoc duplikacja jest świadoma).
 */
function extractSlugFromUrl(url) {
  if (!url || typeof url !== "string") return "";
  const m = url.match(/\/in\/([^/?#]+)/);
  return m ? m[1] : "";
}

/**
 * SHA-256 hex digest stringa. Używa WebCrypto (dostępne w MV3 SW
 * od Chrome 95+). Hash służy do agregacji telemetrii — NIE jest
 * privacy decision, bo URL i tak zawiera slug w cleartext.
 */
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str || "");
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Forwarder z extension'a do backendu. Fire-and-forget — żaden
 * błąd sieciowy nie może rozłożyć user flow scrape'a.
 *
 * Wywoływany przez content.js w `extractViaDom` fail path.
 * Payload zawiera diagnostics + url + error_message; tutaj
 * dorzucamy version, slug_hash, browser_ua, client_timestamp.
 */
async function reportScrapeFailure(payload) {
  try {
    const settings = await getSettings();
    if (!settings.apiKey) {
      console.warn("[LinkedIn MSG] Telemetry skipped — no API key configured");
      return;
    }

    const apiUrl = `${settings.apiUrl.replace(/\/$/, "")}/api/diagnostics/scrape-failure`;
    const url = payload.url || "";
    const slug = extractSlugFromUrl(url);
    const slugHash = await sha256Hex(slug);

    const body = {
      client_timestamp: new Date().toISOString(),
      extension_version: chrome.runtime.getManifest().version,
      slug_hash: slugHash,
      url: url.slice(0, 500),
      browser_ua: (navigator.userAgent || "unknown").slice(0, 500),
      diagnostics: payload.diagnostics || {},
      error_message: payload.error_message || null,
      event_type: payload.event_type || "scrape_failure",
    };

    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": settings.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok && resp.status !== 204) {
      console.warn(
        `[LinkedIn MSG] Telemetry rejected: HTTP ${resp.status}`
      );
    }
  } catch (err) {
    // Backend down, network fail, crypto fail — wszystko połykamy.
    // Telemetria NIGDY nie blokuje scrape'a.
    console.warn("[LinkedIn MSG] Telemetry send failed:", err && err.message);
  }
}

// ── Bulk Connect: queue + worker loop + alarms keep-alive (#19) ──────
//
// Worker loop jest setTimeout-based (NIE setInterval — MV3 SW kill zostawi
// orphan timer). chrome.alarms.create({periodInMinutes: 0.4}) trzyma SW
// przy życiu podczas long queue'a (~37 min dla 25 zaproszeń × 90s avg).

const BULK_DEFAULTS = {
  queue: [],
  config: {
    delayMin: 45,
    delayMax: 120,
    dailyCap: 25,
    workingHoursStart: 9,
    workingHoursEnd: 18,
  },
  stats: { sentToday: 0, sentTotal: 0, lastResetDate: "" },
  active: false,
  errorMsg: null,
  // Wall-clock timestamp (ms) kiedy zaplanowany kolejny tick. Popup używa
  // do live countdown timer'a "Następne za X". null gdy active=false.
  nextTickAt: null,
  // Wall-clock timestamp (ms) ostatnio wykonanego tick'a — dla diagnostyki
  // w popup'ie (np. "Ostatnia akcja 30s temu").
  lastTickAt: null,
};

const BULK_ALARM_NAME = "bulkKeepAlive";
const BULK_TICK_TIMEOUT_MS = 30000; // czekamy max 30s na content.js response

async function getBulkState() {
  const data = await chrome.storage.local.get("bulkConnect");
  return { ...BULK_DEFAULTS, ...(data.bulkConnect || {}) };
}

async function setBulkState(patch) {
  const current = await getBulkState();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ bulkConnect: next });
  return next;
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function resetDailyCounterIfNeeded() {
  const state = await getBulkState();
  const today = todayDateString();
  if (state.stats.lastResetDate !== today) {
    await setBulkState({
      stats: { ...state.stats, sentToday: 0, lastResetDate: today },
    });
  }
}

async function addToQueue(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    const state = await getBulkState();
    return { success: true, queueSize: state.queue.length };
  }
  const state = await getBulkState();
  const existingSlugs = new Set(state.queue.map((q) => q.slug));
  const fresh = profiles
    .filter((p) => p && p.slug && !existingSlugs.has(p.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.name || "",
      headline: p.headline || "",
      status: "pending",
      timestamp: null,
      error: null,
    }));
  const next = await setBulkState({ queue: [...state.queue, ...fresh] });
  return { success: true, queueSize: next.queue.length, added: fresh.length };
}

async function updateQueueItem(slug, patch) {
  const state = await getBulkState();
  const queue = state.queue.map((q) =>
    q.slug === slug ? { ...q, ...patch } : q
  );
  return await setBulkState({ queue });
}

async function findLinkedInSearchTab() {
  // chrome.tabs.query nie supportuje wildcard *.linkedin.com/search w pojedynczym
  // wzorcu w MV3 — szukamy obu domen.
  const tabs = await chrome.tabs.query({
    url: ["*://*.linkedin.com/search/results/people/*"],
  });
  return tabs[0] || null;
}

function inWorkingHours(config) {
  const hour = new Date().getHours();
  return hour >= config.workingHoursStart && hour < config.workingHoursEnd;
}

async function bulkConnectTick() {
  await resetDailyCounterIfNeeded();
  const state = await getBulkState();

  if (!state.active) return; // user kliknął Stop lub guards wyłączyły.

  // Guards.
  if (!inWorkingHours(state.config)) {
    await setBulkState({
      active: false,
      errorMsg: `Outside working hours (${state.config.workingHoursStart}:00–${state.config.workingHoursEnd}:00). Resume manually.`,
    });
    await chrome.alarms.clear(BULK_ALARM_NAME);
    await setBulkState({ nextTickAt: null });
    return;
  }

  if (state.stats.sentToday >= state.config.dailyCap) {
    await setBulkState({
      active: false,
      errorMsg: `Daily cap reached (${state.config.dailyCap}). Resets at midnight.`,
    });
    await chrome.alarms.clear(BULK_ALARM_NAME);
    await setBulkState({ nextTickAt: null });
    return;
  }

  const pending = state.queue.find((q) => q.status === "pending");
  if (!pending) {
    await setBulkState({ active: false, errorMsg: null });
    await chrome.alarms.clear(BULK_ALARM_NAME);
    await setBulkState({ nextTickAt: null });
    return;
  }

  const tab = await findLinkedInSearchTab();
  if (!tab) {
    await setBulkState({
      active: false,
      errorMsg: "Lost LinkedIn search tab. Reopen /search/results/people/ and resume.",
    });
    await chrome.alarms.clear(BULK_ALARM_NAME);
    await setBulkState({ nextTickAt: null });
    return;
  }

  // Send click message do content script. Timeout 30s żeby zawsze
  // przejść do następnego ticku (LinkedIn może mieć slow DOM).
  let response;
  try {
    response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, {
        action: "bulkConnectClick",
        slug: pending.slug,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("bulk_tick_timeout")), BULK_TICK_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    response = { success: false, error: err && err.message || "send_failed" };
  }

  // Update queue item.
  const now = Date.now();
  let newStatus, errorVal = null;
  if (response.success) {
    newStatus = "sent";
  } else if (response.skip) {
    newStatus = "skipped";
    errorVal = response.skip;
  } else {
    newStatus = "failed";
    errorVal = response.error || "unknown_error";
  }
  await updateQueueItem(pending.slug, { status: newStatus, timestamp: now, error: errorVal });

  // Update stats.
  const after = await getBulkState();
  const newStats = { ...after.stats };
  if (newStatus === "sent") {
    newStats.sentToday += 1;
    newStats.sentTotal += 1;
  }
  await setBulkState({ stats: newStats });

  // Schedule next tick — random delay między delayMin a delayMax.
  const delay =
    (after.config.delayMin +
      Math.random() * (after.config.delayMax - after.config.delayMin)) *
    1000;
  await setBulkState({ lastTickAt: now, nextTickAt: Date.now() + delay });
  setTimeout(bulkConnectTick, delay);
}

async function startBulkConnect() {
  // Pierwszy tick za 100ms — popup widzi countdown od razu.
  await setBulkState({
    active: true,
    errorMsg: null,
    nextTickAt: Date.now() + 100,
    lastTickAt: null,
  });
  // Keep-alive alarm (24s period < 30s SW idle limit).
  await chrome.alarms.create(BULK_ALARM_NAME, { periodInMinutes: 0.4 });
  bulkConnectTick();
  return { success: true };
}

async function stopBulkConnect() {
  await setBulkState({ active: false, errorMsg: null, nextTickAt: null });
  await chrome.alarms.clear(BULK_ALARM_NAME);
  return { success: true };
}

// Dummy listener — sam fakt registracji + alarm trzyma MV3 SW przy życiu.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BULK_ALARM_NAME) {
    // No-op. Alarm tu tylko żeby SW był wakeup'owany co 24s.
  }
});

// ── API Calls ────────────────────────────────────────────────────────

async function generateMessage(profile, options = {}) {
  const settings = await getSettings();
  const userSettings = await getUserSettings();

  const apiUrl = `${settings.apiUrl.replace(/\/$/, "")}/api/generate-message`;

  const body = {
    profile: profile,
    goal: options.goal || settings.defaultGoal,
    tone: options.tone || null,
    language: options.language || settings.defaultLanguage,
    max_chars: options.maxChars || settings.defaultMaxChars,
    sender_context: settings.senderContext || null,
    ...personalizationToBody(userSettings),
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": settings.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new Error(err.detail || `Błąd serwera: ${response.status}`);
  }

  return await response.json();
}

async function getSettingsDefaults() {
  const settings = await getSettings();
  const apiUrl = `${settings.apiUrl.replace(/\/$/, "")}/api/settings/defaults`;

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: { "X-API-Key": settings.apiKey },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new Error(err.detail || `Błąd serwera: ${response.status}`);
  }
  return await response.json();
}

// ── Message Router ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    try {
      switch (message.action) {
        case "generateMessage":
          return await generateMessage(message.profile, message.options);

        case "getSettings":
          return await getSettings();

        case "saveSettings":
          await saveSettings(message.settings);
          return { success: true };

        case "getSettingsDefaults":
          return await getSettingsDefaults();

        case "reportScrapeFailure":
          // Fire-and-forget. Nie czekamy na sieć — od razu zwracamy ack
          // żeby content.js nie trzymał kanału MV3 (idle kill po 30s).
          reportScrapeFailure(message.payload || {});
          return { success: true };

        case "bulkConnectStart":
          return await startBulkConnect();

        case "bulkConnectStop":
          return await stopBulkConnect();

        case "bulkConnectAddToQueue":
          return await addToQueue(message.profiles || []);

        case "getBulkState":
          return await getBulkState();

        default:
          throw new Error(`Nieznana akcja: ${message.action}`);
      }
    } catch (err) {
      return { error: err.message };
    }
  };

  handler().then(sendResponse);
  return true; // Keep message channel open for async
});

// ── Install / Update ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await saveSettings(DEFAULT_SETTINGS);
    await chrome.storage.local.set({ bulkConnect: BULK_DEFAULTS });
    console.log("[LinkedIn MSG] Extension installed, defaults saved.");
  }
});
