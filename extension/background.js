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
      // Faza 2 (#21 v1.5.0):
      acceptedAt: null,
      lastAcceptCheckAt: null,
      scrapedProfile: null,
      messageDraft: null,
      messageStatus: "none", // "none"|"draft"|"approved"|"sent"|"skipped"
      messageApprovedAt: null,
      messageSentAt: null,
      // Faza 3 (#22 v1.6.0): która strona search results zawiera ten profil.
      // bulkConnectTick navigates karty na tę stronę przed click'iem żeby
      // findLiBySlug w content.js znalazł poprawne <li>. Default 1 dla
      // backward-compat (profile dodawane manualnie z aktywnej strony).
      pageNumber: typeof p.pageNumber === "number" ? p.pageNumber : 1,
      // Sprint #4 (#25 v1.7.0): follow-upy 3d/7d po wysłaniu pierwszej
      // wiadomości. Daty RemindAt set'owane przez hook w bulkMarkMessageSent
      // (sentAt+3d / sentAt+7d). Sent timestamps gdy user klika "Wysłałem".
      followup1RemindAt: null,
      followup2RemindAt: null,
      followup1Draft: null,
      followup2Draft: null,
      followup1SentAt: null,
      followup2SentAt: null,
      followupStatus: "scheduled", // "scheduled" | "skipped"
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

// ── Post-Connect Messaging (#21 v1.5.0) ──────────────────────────

const ACCEPT_CHECK_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h rate-limit per item
const TAB_LOAD_TIMEOUT_MS = 12000; // 12s na document_idle
const TAB_SCRAPE_TIMEOUT_MS = 30000; // jak BULK_TICK_TIMEOUT_MS

/**
 * Otwiera background tab z URL'em, czeka aż content script zareaguje na
 * sendMessage, zwraca response. Cleanup: zamyka tab niezależnie od wyniku.
 */
async function probeProfileTab(slug, action) {
  const url = `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    // Wait for tab content script — retry sendMessage do timeout.
    const start = Date.now();
    let lastErr = null;
    while (Date.now() - start < TAB_LOAD_TIMEOUT_MS) {
      try {
        const resp = await Promise.race([
          chrome.tabs.sendMessage(tab.id, { action }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("scrape_timeout")), TAB_SCRAPE_TIMEOUT_MS)),
        ]);
        return resp;
      } catch (err) {
        lastErr = err;
        // Content script może jeszcze nie być zainjectowany — czekamy.
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastErr || new Error("tab_load_timeout");
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (_) { /* tab już zamknięty */ }
    }
  }
}

/**
 * Skanuje queue items ze status="sent" i sprawdza czy LinkedIn pokazuje
 * 1st degree (accepted). Rate-limit 4h per item żeby nie spamować LI.
 */
async function bulkCheckAccepts() {
  const state = await getBulkState();
  const now = Date.now();
  const candidates = state.queue.filter(
    (q) =>
      q.status === "sent" &&
      !q.acceptedAt &&
      q.slug &&
      (!q.lastAcceptCheckAt || now - q.lastAcceptCheckAt > ACCEPT_CHECK_COOLDOWN_MS)
  );

  if (candidates.length === 0) {
    return { success: true, scanned: 0, accepted: 0, skipped_recent: state.queue.filter((q) => q.status === "sent" && !q.acceptedAt).length };
  }

  let acceptedCount = 0;
  for (const item of candidates) {
    let result = { degree: "unknown", status: "unknown" };
    try {
      result = await probeProfileTab(item.slug, "checkProfileDegree");
    } catch (err) {
      // Tab open / scrape failed — record check time, skip for now.
      result = { degree: "unknown", status: "unknown", error: err && err.message || "probe_failed" };
    }
    const patch = { lastAcceptCheckAt: Date.now() };
    if (result?.status === "accepted" || result?.degree === "1st") {
      patch.acceptedAt = Date.now();
      acceptedCount += 1;
    }
    await updateQueueItem(item.slug, patch);
    // Małe opóźnienie między tabami żeby nie zalać Chromy/LinkedIn.
    await new Promise((r) => setTimeout(r, 800));
  }

  return {
    success: true,
    scanned: candidates.length,
    accepted: acceptedCount,
  };
}

/**
 * Pre-flight scrape pełnego profilu (reuse `scrapeProfile` z #1).
 * Zapisuje w queue item.scrapedProfile.
 */
async function bulkScrapeProfileForQueue(slug) {
  try {
    const resp = await probeProfileTab(slug, "scrapeProfile");
    if (resp?.success && resp?.profile) {
      await updateQueueItem(slug, { scrapedProfile: resp.profile });
      return { success: true, profile: resp.profile };
    }
    return { success: false, error: resp?.error || "scrape_returned_no_profile" };
  } catch (err) {
    return { success: false, error: err && err.message || "scrape_exception" };
  }
}

/**
 * Generuje message draft dla pojedynczego slug'a. Pre-flight scrape jeśli
 * brakuje scrapedProfile. POST do /api/generate-message (reuse generateMessage).
 */
async function bulkGenerateMessage(slug, options = {}) {
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "item_not_found" };

  // Pre-flight scrape gdy brakuje danych profilu.
  let profile = item.scrapedProfile;
  if (!profile) {
    const scraped = await bulkScrapeProfileForQueue(slug);
    if (!scraped.success) {
      await updateQueueItem(slug, { messageStatus: "draft", messageDraft: null, error: scraped.error });
      return { success: false, error: `scrape_failed: ${scraped.error}` };
    }
    profile = scraped.profile;
  }

  try {
    const result = await generateMessage(profile, options);
    const draft = result?.message || "";
    await updateQueueItem(slug, {
      messageDraft: draft,
      messageStatus: "draft",
    });
    return { success: true, draft };
  } catch (err) {
    return { success: false, error: err && err.message || "generate_failed" };
  }
}

async function bulkUpdateMessageDraft(slug, draft) {
  await updateQueueItem(slug, {
    messageDraft: draft,
    messageStatus: "draft",
  });
  return { success: true };
}

async function bulkApproveMessage(slug) {
  await updateQueueItem(slug, {
    messageStatus: "approved",
    messageApprovedAt: Date.now(),
  });
  return { success: true };
}

async function bulkSkipMessage(slug) {
  await updateQueueItem(slug, {
    messageStatus: "skipped",
  });
  return { success: true };
}

async function bulkMarkMessageSent(slug) {
  const sentAt = Date.now();
  await updateQueueItem(slug, {
    messageStatus: "sent",
    messageSentAt: sentAt,
  });
  // Idempotent hook (#25 v1.7.0): set follow-up reminders TYLKO gdy nie były
  // wcześniej ustawione. User może kliknąć "Wysłałem" dwa razy — drugi klik
  // nie nadpisuje reminderów (np. po reset'cie skipped → ponownie sent).
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (item && item.followup1RemindAt == null) {
    await updateQueueItem(slug, {
      followup1RemindAt: sentAt + 3 * 24 * 60 * 60 * 1000,
      followup2RemindAt: sentAt + 7 * 24 * 60 * 60 * 1000,
      followupStatus: "scheduled",
    });
  }
  await updateFollowupBadge();
  return { success: true };
}

// ── Follow-upy 3d/7d (#25 v1.7.0) ────────────────────────────────
//
// Architektura: storage queue items (#21) extended o 7 pól follow-up'owych.
// Hook w bulkMarkMessageSent ustawia RemindAt'y. Alarm `followup_check_due`
// co 6h + storage.onChanged listener trigger'ują updateFollowupBadge() —
// badge na ikonie pokazuje liczbę due follow-up'ów. Popup section listuje
// due items z buttonami Generuj / Skopiuj i otwórz / Wysłałem / Pomiń.
//
// Backend: ZERO zmian. Reuse generateMessage z goal="followup" + augmented
// sender_context (poprzednia treść wiadomości + numer follow-up'a).

const FOLLOWUP_ALARM_NAME = "followup_check_due";
const FOLLOWUP_BADGE_COLOR = "#d32f2f";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Zlicza due follow-up'y w queue i ustawia badge na ikonie. Każdy profil
 * może mieć dwa due naraz (FU#1 + FU#2 jeśli user nigdy nie zareagował) —
 * wtedy liczy 2. Cap "99+" dla wizualnej higieny.
 */
async function updateFollowupBadge() {
  try {
    const state = await getBulkState();
    const now = Date.now();
    let count = 0;
    for (const item of state.queue) {
      if (item.followupStatus !== "scheduled") continue;
      if (!item.messageSentAt) continue;
      if (item.followup1RemindAt && item.followup1RemindAt <= now && !item.followup1SentAt) count++;
      if (item.followup2RemindAt && item.followup2RemindAt <= now && !item.followup2SentAt) count++;
    }
    const text = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
    await chrome.action.setBadgeText({ text });
    if (count > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: FOLLOWUP_BADGE_COLOR });
    }
    return count;
  } catch (err) {
    console.warn("[followup] updateFollowupBadge failed:", err && err.message);
    return 0;
  }
}

/**
 * Lista due follow-up'ów (filtered + sorted by oldest sent first). Per-profil
 * może być dwa entries (jeden per dueFollowup=1|2) gdy oba RemindAt'y minęły.
 */
async function bulkListDueFollowups() {
  const state = await getBulkState();
  const now = Date.now();
  const items = [];
  for (const item of state.queue) {
    if (item.followupStatus !== "scheduled") continue;
    if (!item.messageSentAt) continue;
    const daysSinceSent = Math.floor((now - item.messageSentAt) / DAY_MS);
    if (item.followup1RemindAt && item.followup1RemindAt <= now && !item.followup1SentAt) {
      items.push({
        slug: item.slug,
        name: item.name,
        headline: item.headline,
        messageSentAt: item.messageSentAt,
        dueFollowup: 1,
        daysSinceSent,
        draft: item.followup1Draft || "",
      });
    }
    if (item.followup2RemindAt && item.followup2RemindAt <= now && !item.followup2SentAt) {
      items.push({
        slug: item.slug,
        name: item.name,
        headline: item.headline,
        messageSentAt: item.messageSentAt,
        dueFollowup: 2,
        daysSinceSent,
        draft: item.followup2Draft || "",
      });
    }
  }
  items.sort((a, b) => a.messageSentAt - b.messageSentAt);
  return { success: true, items };
}

/**
 * Generuje follow-up draft przez backend (reuse generateMessage z goal="followup").
 * Augmentuje sender_context o kontekst follow-up'a + treść poprzedniej wiadomości.
 * Pre-flight scrape gdy queue item nie ma scrapedProfile (jak bulkGenerateMessage).
 */
async function bulkGenerateFollowup(slug, followupNum) {
  if (followupNum !== 1 && followupNum !== 2) {
    return { success: false, error: "invalid_followup_num" };
  }

  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "item_not_found" };
  if (!item.messageDraft) return { success: false, error: "no_message_draft" };

  // Pre-flight scrape gdy brakuje danych profilu (mirror bulkGenerateMessage).
  let profile = item.scrapedProfile;
  if (!profile) {
    const scraped = await bulkScrapeProfileForQueue(slug);
    if (!scraped.success) {
      return { success: false, error: `scrape_failed: ${scraped.error}` };
    }
    profile = scraped.profile;
  }

  // Augmentowany sender_context — bazowy z user settings + kontekst follow-up'a.
  const baseSettings = await getSettings();
  const baseContext = (baseSettings.senderContext || "").trim();
  const days = followupNum === 1 ? 3 : 7;
  const followupContext =
    `[KONTEKST FOLLOW-UP'A] To jest follow-up #${followupNum} (${days} dni po wysłaniu pierwszej wiadomości).\n` +
    `Poprzednia wiadomość, którą napisał nadawca:\n` +
    `"${item.messageDraft}"\n` +
    `Odbiorca nie odpowiedział. Napisz łagodne nawiązanie / przypomnienie o sobie. NIE re-pitch tej samej oferty. Krótko (max 3 zdania).`;
  const augmented = baseContext
    ? `${baseContext}\n\n${followupContext}`
    : followupContext;

  try {
    const result = await generateMessage(profile, {
      goal: "followup",
      sender_context: augmented,
    });
    const draft = result?.message || "";
    const patch = followupNum === 1
      ? { followup1Draft: draft }
      : { followup2Draft: draft };
    await updateQueueItem(slug, patch);
    return { success: true, draft };
  } catch (err) {
    return { success: false, error: err && err.message || "generate_failed" };
  }
}

async function bulkUpdateFollowupDraft(slug, followupNum, text) {
  if (followupNum !== 1 && followupNum !== 2) {
    return { success: false, error: "invalid_followup_num" };
  }
  const patch = followupNum === 1
    ? { followup1Draft: text }
    : { followup2Draft: text };
  await updateQueueItem(slug, patch);
  return { success: true };
}

/**
 * Otwiera tab z LinkedIn messaging compose dla profilu i zwraca draft
 * (popup robi navigator.clipboard.writeText — clipboard API nie działa
 * niezawodnie w MV3 service worker, więc clipboard zostaje po stronie popup'u
 * jak istniejący handleCopyAndOpen w popup.js dla #21).
 */
async function bulkCopyFollowupAndOpen(slug, followupNum) {
  if (followupNum !== 1 && followupNum !== 2) {
    return { success: false, error: "invalid_followup_num" };
  }
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "item_not_found" };
  const draft = followupNum === 1 ? item.followup1Draft : item.followup2Draft;
  if (!draft || !String(draft).trim()) {
    return { success: false, error: "empty_draft" };
  }
  const url = `https://www.linkedin.com/messaging/compose/?recipient=${encodeURIComponent(slug)}`;
  try {
    await chrome.tabs.create({ url, active: true });
  } catch (err) {
    return { success: false, error: err && err.message || "tab_open_failed" };
  }
  return { success: true, draft, url };
}

async function bulkMarkFollowupSent(slug, followupNum) {
  if (followupNum !== 1 && followupNum !== 2) {
    return { success: false, error: "invalid_followup_num" };
  }
  const patch = followupNum === 1
    ? { followup1SentAt: Date.now() }
    : { followup2SentAt: Date.now() };
  await updateQueueItem(slug, patch);
  await updateFollowupBadge();
  return { success: true };
}

async function bulkSkipFollowup(slug) {
  await updateQueueItem(slug, { followupStatus: "skipped" });
  await updateFollowupBadge();
  return { success: true };
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

// ── URL pagination helpers (#22 v1.6.0) ──────────────────────────
//
// LinkedIn search results URL zawiera dużo query params (keywords, origin,
// network, spellCorrectionEnabled, prioritizeMessage, page). MUSIMY
// preservować wszystkie podczas zmiany strony — nie rebuildujemy URL'a od
// zera bo zgubilibyśmy filter network=["S"] (2nd degree only) i inne.

function getPageFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const p = parseInt(u.searchParams.get("page") || "1", 10);
    return Number.isFinite(p) && p > 0 ? p : 1;
  } catch (_) {
    return 1;
  }
}

function setPageInUrl(urlStr, pageNum) {
  try {
    const u = new URL(urlStr);
    u.searchParams.set("page", String(pageNum));
    return u.toString();
  } catch (_) {
    return urlStr;
  }
}

/**
 * Czeka aż chrome.tabs.update zakończy nawigację (status === "complete").
 * Potem dodatkowy delay dla LinkedIn SDUI dorenderowania (lazy load lists).
 */
async function waitForTabComplete(tabId, timeoutMs) {
  const limit = timeoutMs || 12000;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("tab_load_timeout"));
    }, limit);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

const PAGINATION_RENDER_DELAY_MS = 1500; // SDUI lazy render po SPA nav
const PAGINATION_MAX_PAGES = 10;

/**
 * Auto-pagination przez kolejne strony LinkedIn search results.
 * Navigates aktywną kartę przez ?page=1, 2, 3..., extractSearchResults na
 * każdej, dorzuca Connect-able do queue z `pageNumber` field. Stop'uje gdy
 * queue zapełni do `maxProfiles` lub max pages albo brak Connect-able.
 *
 * NIE navigates karty z powrotem na page 1 po finish — user zostaje na
 * ostatniej zeskanowanej stronie. Worker loop bulkConnectTick navigates
 * karty per-profil zgodnie z item.pageNumber.
 */
async function bulkAutoFillByUrl(maxProfiles) {
  const tab = await findLinkedInSearchTab();
  if (!tab) {
    return { success: false, error: "no_search_tab" };
  }
  const baseUrl = tab.url || "";
  if (!baseUrl.includes("/search/results/people/")) {
    return { success: false, error: "not_on_search_page" };
  }

  const cap = Math.max(1, maxProfiles || 25);
  const state = await getBulkState();
  // Dedup także względem istniejącej queue (nie tylko within current scan).
  const existingSlugs = new Set(state.queue.map((q) => q.slug));
  const collected = [];

  let pageNum = getPageFromUrl(baseUrl); // start z aktualnej strony
  if (pageNum < 1) pageNum = 1;

  for (let pagesScanned = 0; pagesScanned < PAGINATION_MAX_PAGES; pagesScanned++) {
    // Navigate (nawet pierwsza iteracja — żeby gwarantować świeży DOM
    // bez stale ze scrolla użytkownika; jeśli aktualnie jesteśmy na page=N
    // ten update jest no-op — Chrome nie reload'uje gdy URL identyczny).
    const targetUrl = setPageInUrl(baseUrl, pageNum);
    try {
      await chrome.tabs.update(tab.id, { url: targetUrl });
      await waitForTabComplete(tab.id, 12000);
    } catch (err) {
      // Tab load failed — przerwij, zwróć co mamy.
      break;
    }
    // SDUI lazy render — extractSearchResults na świeżo loaded DOM często
    // zwraca pustą listę. Dodatkowe 1.5s żeby listy się zrenderowały.
    await new Promise((r) => setTimeout(r, PAGINATION_RENDER_DELAY_MS));

    let pageProfiles = [];
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, {
        action: "extractSearchResults",
      });
      if (resp && resp.success && Array.isArray(resp.profiles)) {
        pageProfiles = resp.profiles;
      }
    } catch (err) {
      // Content script nie zareagował — możliwe że LinkedIn redirect'ował na 404
      // dla page > max_pages. Przerwij scan.
      break;
    }

    if (pageProfiles.length === 0) {
      // Pusta strona — najprawdopodobniej page > max_pages dla tego search.
      break;
    }

    let addedThisPage = 0;
    for (const p of pageProfiles) {
      if (!p || !p.slug) continue;
      if (existingSlugs.has(p.slug)) continue;
      if (p.buttonState !== "Connect") continue;
      existingSlugs.add(p.slug);
      collected.push({
        slug: p.slug,
        name: p.name || "",
        headline: p.headline || "",
        pageNumber: pageNum,
      });
      addedThisPage++;
      if (collected.length >= cap) break;
    }

    if (collected.length >= cap) break;
    pageNum++;
  }

  // Dorzuć do queue (addToQueue zachowuje pageNumber).
  let added = 0;
  if (collected.length > 0) {
    const resp = await addToQueue(collected);
    added = resp.added || collected.length;
  }

  return {
    success: true,
    added,
    pagesScanned: pageNum - getPageFromUrl(baseUrl),
    finalPage: pageNum,
  };
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

  // Page-aware navigation (#22 v1.6.0). Pre-click ensure tab jest na
  // tej samej stronie search results na której był profil scrape'owany.
  // Bez tego findLiBySlug w content.js zwróci li_not_found dla profili
  // z innych stron (po auto-fill queue zawiera profile z multiple pages).
  const targetPage = pending.pageNumber || 1;
  const currentPage = getPageFromUrl(tab.url || "");
  if (currentPage !== targetPage) {
    try {
      await chrome.tabs.update(tab.id, {
        url: setPageInUrl(tab.url, targetPage),
      });
      await waitForTabComplete(tab.id, 12000);
      await new Promise((r) => setTimeout(r, PAGINATION_RENDER_DELAY_MS));
    } catch (err) {
      // Page nav failed — kontynuuj próbę kliknięcia (może i tak zadziała),
      // ale zaloguj w error message przy fail.
      console.warn("[LinkedIn MSG] page nav failed:", err && err.message);
    }
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
  } else if (alarm.name === FOLLOWUP_ALARM_NAME) {
    // Re-compute badge co 6h — łapie case'y kiedy user nie otwierał
    // popup'u przez dni, a follow-up #1 (3d) lub #2 (7d) stał się due.
    updateFollowupBadge();
  }
});

// Storage listener — re-compute badge natychmiast po zmianach z popup'u
// (mark_sent / skip / generate). Gwarantuje że badge zniknie zaraz po
// kliknięciu "Wysłałem" zamiast czekać do następnego alarm'u.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.bulkConnect) return;
  updateFollowupBadge();
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
    // options.sender_context override pozwala bulkGenerateFollowup wstrzyknąć
    // augmented context (poprzednia treść wiadomości + nr follow-up'a) bez
    // mutowania user settings. Undefined → fallback do settings (BC).
    sender_context:
      options.sender_context !== undefined
        ? options.sender_context
        : settings.senderContext || null,
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

        case "bulkAutoFillByUrl":
          return await bulkAutoFillByUrl(message.maxProfiles);

        case "getBulkState":
          return await getBulkState();

        case "bulkCheckAccepts":
          return await bulkCheckAccepts();

        case "bulkScrapeProfileForQueue":
          return await bulkScrapeProfileForQueue(message.slug);

        case "bulkGenerateMessage":
          return await bulkGenerateMessage(message.slug, message.options || {});

        case "bulkUpdateMessageDraft":
          return await bulkUpdateMessageDraft(message.slug, message.draft || "");

        case "bulkApproveMessage":
          return await bulkApproveMessage(message.slug);

        case "bulkSkipMessage":
          return await bulkSkipMessage(message.slug);

        case "bulkMarkMessageSent":
          return await bulkMarkMessageSent(message.slug);

        case "followupListDue":
          return await bulkListDueFollowups();

        case "followupGenerate":
          return await bulkGenerateFollowup(message.slug, message.followupNum);

        case "followupUpdateDraft":
          return await bulkUpdateFollowupDraft(message.slug, message.followupNum, message.text);

        case "followupCopyAndOpen":
          return await bulkCopyFollowupAndOpen(message.slug, message.followupNum);

        case "followupMarkSent":
          return await bulkMarkFollowupSent(message.slug, message.followupNum);

        case "followupSkip":
          return await bulkSkipFollowup(message.slug);

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
  // #25: alarm reset niezależnie od reason — install/update/chrome_update.
  // chrome.alarms.create jest idempotent (nadpisze istniejący o tej samej nazwie).
  await chrome.alarms.create(FOLLOWUP_ALARM_NAME, { periodInMinutes: 360 });
  await updateFollowupBadge();
});

// SW może się obudzić bez onInstalled (np. po idle kill). Re-create alarm
// + recompute badge na każdy start żeby badge był aktualny.
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(FOLLOWUP_ALARM_NAME, { periodInMinutes: 360 });
  await updateFollowupBadge();
});
