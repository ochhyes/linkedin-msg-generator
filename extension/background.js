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
  // #45 v1.14.0: co ile dni auto-backup bazy profili do pliku (0 = wyłączony).
  backupIntervalDays: 3,
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
 * Wyciąga slug profilu z URL'a LinkedIn — zwraca DECODED LOWERCASE form
 * (np. "radosław-paczyński-72307a230", nie "rados%C5%82aw-paczy%C5%84ski-...").
 *
 * KONSEKWENCJE NORMALIZACJI:
 * - Storage queue items używają decoded slug jako klucz (dedup, lookup)
 * - URL builders (chrome.tabs.create) muszą encode'ować raz przez
 *   URL.searchParams.set lub encodeURIComponent (NIE oba)
 * - Spójność z popup.js extractSlugFromUrl (też decoded lowercase od v1.8.0)
 *
 * Wcześniejsze wersje zwracały slug as-is z URL-a (czyli URL-encoded
 * z mixed case w %XX), co powodowało:
 * - Bug A: double-encoding w chrome.tabs.create (rados%C5% → rados%25C5%)
 * - Bug B: mismatch popup vs background (popup .toLowerCase()'ował, BG nie)
 * Migracja istniejących encoded slug-ów w queue: migrateSlugEncoding() przy SW startup.
 */
function extractSlugFromUrl(url) {
  if (!url || typeof url !== "string") return "";
  const m = url.match(/\/in\/([^/?#]+)/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch (_) {
    // Malformed URL escape — fallback na lowercase as-is.
    return m[1].toLowerCase();
  }
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
    dailyCap: 25,           // ile worker WYSYŁA zaproszeń dziennie
    addCount: 50,           // ile profili dorzuca "Wypełnij" do kolejki za jednym razem (v1.14.4)
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
  // #39 v1.9.2 — bulk worker resilience. tabId persistowany przy bulkConnectStart
  // żeby tick mógł resolve'ować tab nawet jeśli user przeszedł na inny URL
  // w tej samej karcie (zamiast exit'ować z "Lost LinkedIn search tab").
  // lastSearchKeywords pozwala odbudować search URL i auto-navigate kartę
  // z powrotem na search results. navigateFailCount circuit-breaker po 3
  // failed auto-navigates żeby nie spamować user'a tab.update'ami.
  tabId: null,
  lastSearchKeywords: null,
  navigateFailCount: 0,
  // #44 v1.11.5 — cooperative cancel dla bulkAutoFillByUrl (pagination loop).
  // Popup ustawia autoFillCancelRequested=true gdy user kliknie Stop. Loop
  // sprawdza flag po każdej iteracji i breakuje z partial result.
  // autoFillRunning żeby popup wiedział kiedy pokazać "Stop" zamiast "Wypełnij".
  autoFillRunning: false,
  autoFillCancelRequested: false,
};

const BULK_ALARM_NAME = "bulkKeepAlive";
const BULK_TICK_TIMEOUT_MS = 30000; // czekamy max 30s na content.js response

// #40 v1.11.1 — storage quota guard. chrome.storage.local ma limit
// 5 MB per single key (QUOTA_BYTES_PER_ITEM). bulkConnect z queue items
// zawierającymi pełen scrapedProfile (about + experience + skills, ~50-200KB
// per item) potrafi przekroczyć ten limit po 30-100 profilach. Bez try/catch
// chrome.storage.local.set rzucał, setBulkState propagował, callerzy nie
// łapali → silent fail w SW console. Marcin doświadczył: "klikam Wysłałem
// i nic się nie dzieje, queue puste po reload popup'u".
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Strip scrapedProfile z queue items które już są poza pre-message phase.
 * scrapedProfile potrzebny TYLKO do generateMessage (Faza 2 #21). Po
 * messageSentAt → message wysłana, follow-up generation używa wyłącznie
 * messageDraft + headline (nie scrapedProfile). Strip zwalnia 50-200KB
 * per item bez utraty funkcjonalności.
 *
 * @param {Array} queue
 * @param {boolean} aggressive — gdy true, strip wszystkie items z messageSentAt;
 *   gdy false (default eager), strip tylko items z messageSentAt > 7 dni temu
 *   (tail-end items prawdopodobnie kompletne, edge case generation rare).
 */
function stripStaleProfiles(queue, aggressive) {
  if (!Array.isArray(queue)) return queue;
  const now = Date.now();
  return queue.map((item) => {
    if (!item || !item.scrapedProfile) return item;
    if (aggressive && item.messageSentAt) {
      return { ...item, scrapedProfile: null };
    }
    if (item.messageSentAt && now - item.messageSentAt > SEVEN_DAYS_MS) {
      return { ...item, scrapedProfile: null };
    }
    return item;
  });
}

/**
 * Last-resort strip: drop drafts z items które już dostały reply. Drafty
 * follow-up'ów dla replied items są zbędne (osoba odpowiedziała, nie wyślemy
 * follow-up'a). messageDraft też niepotrzebny po reply (history-only).
 */
function stripRepliedDrafts(queue) {
  if (!Array.isArray(queue)) return queue;
  return queue.map((item) => {
    if (!item) return item;
    const replied = item.messageReplyAt || item.followup1ReplyAt || item.followup2ReplyAt;
    if (!replied) return item;
    return { ...item, messageDraft: null, followup1Draft: null, followup2Draft: null };
  });
}

async function getBulkState() {
  const data = await chrome.storage.local.get("bulkConnect");
  return { ...BULK_DEFAULTS, ...(data.bulkConnect || {}) };
}

async function setBulkState(patch) {
  const current = await getBulkState();
  let next = { ...current, ...patch };

  // Eager pre-write strip: items z messageSentAt > 7d temu nie potrzebują
  // już scrapedProfile. Tania op (no allocation gdy nic do strip), trzyma
  // storage growth ograniczony. NIE odpalany przy każdym tick'u przez worker
  // bo worker write'uje malutkie patche — strip wykonuje się tylko gdy
  // patch faktycznie modyfikuje queue (większy write).
  if (Array.isArray(next.queue) && patch && Object.prototype.hasOwnProperty.call(patch, "queue")) {
    next.queue = stripStaleProfiles(next.queue, false);
  }

  try {
    await chrome.storage.local.set({ bulkConnect: next });
    return next;
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    const isQuotaErr = /quota/i.test(errMsg) || /QUOTA/.test(errMsg);

    if (!isQuotaErr) {
      // Inny error (rare — storage corruption / runtime invalid).
      console.error("[LinkedIn MSG] setBulkState write fail:", errMsg);
      reportScrapeFailure({
        event_type: "storage_write_fail",
        error_message: errMsg,
        diagnostics: { queue_size: (next.queue || []).length },
      });
      throw err;
    }

    // Quota exceeded — recovery cascade.
    console.warn("[LinkedIn MSG] Storage quota exceeded — aggressive strip scrapedProfile from sent items");
    let recovered = { ...next, queue: stripStaleProfiles(next.queue, true) };
    try {
      await chrome.storage.local.set({ bulkConnect: recovered });
      reportScrapeFailure({
        event_type: "storage_quota_recovered_strip_profiles",
        error_message: errMsg,
        diagnostics: { queue_size: recovered.queue.length },
      });
      return recovered;
    } catch (err2) {
      // Still failing — drop drafts z replied items.
      console.warn("[LinkedIn MSG] Quota still exceeded — dropping drafts z replied items");
      recovered = { ...recovered, queue: stripRepliedDrafts(recovered.queue) };
      try {
        await chrome.storage.local.set({ bulkConnect: recovered });
        reportScrapeFailure({
          event_type: "storage_quota_recovered_strip_drafts",
          error_message: String(err2),
          diagnostics: { queue_size: recovered.queue.length },
        });
        return recovered;
      } catch (err3) {
        // Fatal — re-throw żeby caller wiedział że nic się nie zapisało.
        console.error("[LinkedIn MSG] Storage quota FATAL — write completely failed:", err3);
        reportScrapeFailure({
          event_type: "storage_quota_fatal",
          error_message: String(err3),
          diagnostics: { queue_size: recovered.queue.length },
        });
        throw err3;
      }
    }
  }
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
      followupStatus: "scheduled", // "scheduled" | "skipped" | "replied"
      // Sprint #6 (#38 v1.11.0): reply tracking — timestamp gdy user oznaczy
      // że dostał odpowiedź na danym etapie. Ustawia followupStatus="replied"
      // (excluded z due/scheduled, idzie do history). BC: items sprzed v1.11.0
      // nie mają tych pól → null w filterach.
      messageReplyAt: null,
      followup1ReplyAt: null,
      followup2ReplyAt: null,
    }));
  const next = await setBulkState({ queue: [...state.queue, ...fresh] });
  // #45: każdy profil który przewija się przez kolejkę trafia też do trwałej
  // bazy (źródło "bulk"). Fire-and-forget — nie blokuje add-to-queue.
  upsertProfilesToDb(fresh, "bulk").catch(() => {});
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
      upsertProfilesToDb([{ slug, ...resp.profile, scrapedProfile: resp.profile }], "profile_scrape").catch(() => {});
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

// ── Manual outreach tracking (#26 v1.7.2) ────────────────────────
//
// Główny flow popup'u (Profile preview → Generuj → Kopiuj + śledź) tworzy
// queue item z status="manual_sent" + messageStatus="sent" + messageDraft
// + scheduling follow-up #1/#2. To rozwiązuje gap z #25: follow-upy
// działały TYLKO dla bulk-invite pipeline'u (#21), manualnie wysłane
// wiadomości (do osób spoza queue) nie były śledzone.
//
// Status "manual_sent" automatycznie wykluczony z bulkCheckAccepts (filter
// q.status === "sent") i bulkConnectTick (filter q.status === "pending"),
// więc bezpiecznie współistnieje z bulk pipeline'em.
async function bulkAddManualSent(profile, messageDraft) {
  if (!profile || !profile.profile_url) {
    return { success: false, error: "no_profile" };
  }
  const slug = extractSlugFromUrl(profile.profile_url);
  if (!slug) return { success: false, error: "no_slug" };

  const state = await getBulkState();
  const existing = state.queue.find((q) => q.slug === slug);

  if (existing) {
    // Update existing: świeży draft + scrapedProfile, zachowaj status jeśli
    // już jest manual_sent/sent (idempotent), ale nie wracaj z "skipped" do
    // active gdyż user świadomie pominął kiedyś.
    const patch = {
      messageDraft,
      scrapedProfile: profile,
    };
    if (existing.status !== "skipped" && existing.followupStatus !== "skipped") {
      patch.messageStatus = "sent";
      // status "pending" → "manual_sent" (manual override invite). "sent"
      // (bulk-sent invite) zostaw jak jest. Other statuses bez zmiany.
      if (existing.status === "pending") patch.status = "manual_sent";
    }
    await updateQueueItem(slug, patch);
  } else {
    // Create new manual item.
    await addToQueue([{
      slug,
      name: profile.name || "",
      headline: profile.headline || "",
      pageNumber: 1,
    }]);
    await updateQueueItem(slug, {
      status: "manual_sent",
      messageStatus: "sent",
      messageDraft,
      scrapedProfile: profile,
    });
  }

  // bulkMarkMessageSent ustawia messageSentAt + idempotent hook na follow-up
  // RemindAt'y. Drugi klik nie nadpisuje (per #25 hook guard).
  await bulkMarkMessageSent(slug);

  // #45: zapisz profil do trwałej bazy (źródło "manual").
  upsertProfilesToDb([{ ...profile, slug, scrapedProfile: profile }], "manual").catch(() => {});

  return { success: true, slug, action: existing ? "updated" : "added" };
}

// Pełna lista follow-upów dla dashboard'u — kategoryzuje queue na due,
// scheduled, history. Dashboard otwiera ten widok w nowej karcie.
async function bulkListAllFollowups() {
  const state = await getBulkState();
  const now = Date.now();
  const due = [];
  const scheduled = [];
  const history = [];

  for (const item of state.queue) {
    // Wymagamy żeby wiadomość była wysłana (manual_sent lub bulk pipeline).
    if (!item.messageSentAt) continue;

    const base = {
      slug: item.slug,
      name: item.name || "",
      headline: item.headline || "",
      messageSentAt: item.messageSentAt,
      messageDraft: item.messageDraft || "",
      status: item.status,
    };

    // Replied items — całkowicie wykluczone z due/scheduled, idą do history.
    // (#38 v1.11.0) — gdy user dostał odpowiedź na dowolnym etapie, dalsze
    // follow-up'y są zbędne. Status reset'owalny przez bulkUnmarkReply.
    if (item.followupStatus === "replied") {
      history.push({ ...base, kind: "replied" });
      continue;
    }

    // Skipped → tylko historia
    if (item.followupStatus === "skipped") {
      history.push({ ...base, kind: "skipped" });
      continue;
    }

    // Sprawdź follow-up #1
    if (item.followup1RemindAt) {
      if (item.followup1SentAt) {
        history.push({ ...base, kind: "followup_sent", followupNum: 1, sentAt: item.followup1SentAt, draft: item.followup1Draft || "" });
      } else if (item.followup1RemindAt <= now) {
        due.push({ ...base, dueFollowup: 1, daysSinceSent: Math.floor((now - item.messageSentAt) / 86400000), draft: item.followup1Draft || "" });
      } else {
        scheduled.push({ ...base, dueFollowup: 1, remindAt: item.followup1RemindAt, daysUntil: Math.ceil((item.followup1RemindAt - now) / 86400000) });
      }
    }

    // Sprawdź follow-up #2
    if (item.followup2RemindAt) {
      if (item.followup2SentAt) {
        history.push({ ...base, kind: "followup_sent", followupNum: 2, sentAt: item.followup2SentAt, draft: item.followup2Draft || "" });
      } else if (item.followup2RemindAt <= now) {
        due.push({ ...base, dueFollowup: 2, daysSinceSent: Math.floor((now - item.messageSentAt) / 86400000), draft: item.followup2Draft || "" });
      } else {
        scheduled.push({ ...base, dueFollowup: 2, remindAt: item.followup2RemindAt, daysUntil: Math.ceil((item.followup2RemindAt - now) / 86400000) });
      }
    }
  }

  due.sort((a, b) => a.messageSentAt - b.messageSentAt);
  scheduled.sort((a, b) => a.remindAt - b.remindAt);
  history.sort((a, b) => (b.sentAt || b.messageSentAt) - (a.sentAt || a.messageSentAt));

  return { success: true, due, scheduled, history };
}

// Zwraca minimum potrzebne popup'owi do pokazania persistent "już śledzone"
// hint'u na profilu. Null gdy slug nie istnieje albo nigdy nie był wysłany.
async function getTrackingState(slug) {
  if (!slug) return { success: true, item: null };
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item || !item.messageSentAt) return { success: true, item: null };
  return {
    success: true,
    item: {
      slug: item.slug,
      messageSentAt: item.messageSentAt,
      followup1RemindAt: item.followup1RemindAt,
      followup2RemindAt: item.followup2RemindAt,
      followup1SentAt: item.followup1SentAt,
      followup2SentAt: item.followup2SentAt,
      followupStatus: item.followupStatus,
      status: item.status,
    },
  };
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
  // URL.searchParams.set encoduje raz, niezależnie od formy slug'a w storage.
  // (slug w v1.8.0 jest decoded lowercase — fallback safe nawet gdyby był encoded)
  const composeUrl = new URL("https://www.linkedin.com/messaging/compose/");
  composeUrl.searchParams.set("recipient", slug);
  const url = composeUrl.toString();
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

// ── Reply tracking (#38 v1.11.0) ─────────────────────────────────
//
// User oznacza że dostał odpowiedź na danym etapie (message / followup1 /
// followup2). Ustawia ReplyAt timestamp + followupStatus="replied" (item
// excluded z due/scheduled, ląduje w history). Idempotent — drugi klik
// no-op zachowując original timestamp. bulkUnmarkReply pozwala cofnąć (np.
// błędny klik) — restore'uje followupStatus="scheduled" jeśli żaden inny
// stage nie ma reply, RemindAt'y zostały persisted więc due liczy się znowu.

async function bulkMarkMessageReply(slug) {
  if (!slug) return { success: false, error: "no_slug" };
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "not_found" };
  // Idempotent — jeśli już oznaczony, no-op (zachowaj original ReplyAt timestamp).
  if (item.messageReplyAt) return { success: true, alreadyMarked: true };
  await updateQueueItem(slug, {
    messageReplyAt: Date.now(),
    followupStatus: "replied",
  });
  await updateFollowupBadge();
  return { success: true };
}

async function bulkMarkFollowup1Reply(slug) {
  if (!slug) return { success: false, error: "no_slug" };
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "not_found" };
  if (item.followup1ReplyAt) return { success: true, alreadyMarked: true };
  await updateQueueItem(slug, {
    followup1ReplyAt: Date.now(),
    followupStatus: "replied",
  });
  await updateFollowupBadge();
  return { success: true };
}

async function bulkMarkFollowup2Reply(slug) {
  if (!slug) return { success: false, error: "no_slug" };
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "not_found" };
  if (item.followup2ReplyAt) return { success: true, alreadyMarked: true };
  await updateQueueItem(slug, {
    followup2ReplyAt: Date.now(),
    followupStatus: "replied",
  });
  await updateFollowupBadge();
  return { success: true };
}

async function bulkUnmarkReply(slug, stage) {
  // stage: "message" | "followup1" | "followup2"
  if (!slug || !stage) return { success: false, error: "no_slug_or_stage" };
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "not_found" };

  const otherFields = ["messageReplyAt", "followup1ReplyAt", "followup2ReplyAt"];
  const removedField = stage === "message" ? "messageReplyAt" : `${stage}ReplyAt`;

  const patch = {};
  if (stage === "message") patch.messageReplyAt = null;
  else if (stage === "followup1") patch.followup1ReplyAt = null;
  else if (stage === "followup2") patch.followup2ReplyAt = null;
  else return { success: false, error: "bad_stage" };

  // Restore followupStatus do "scheduled" gdy żaden inny ReplyAt nie jest set.
  // (Inaczej user oznaczył reply na innym stage'u — zostaje "replied".)
  // RemindAt'y zostały persisted od bulkMarkMessageSent — due się znowu liczą
  // gdy wracamy do "scheduled".
  const hasOtherReply = otherFields
    .filter((f) => f !== removedField)
    .some((f) => item[f] != null);

  if (!hasOtherReply && item.followupStatus === "replied") {
    patch.followupStatus = "scheduled";
  }

  await updateQueueItem(slug, patch);
  await updateFollowupBadge();
  return { success: true };
}

// ── Funnel statistics (#38 v1.11.0) ──────────────────────────────
//
// Computed funkcja — liczy queue items po stage'ach i kalkuluje rates.
// pct() handles divide-by-zero (return 0, nie NaN/Infinity). Round do
// 1 miejsca po przecinku dla wizualnej higieny ("23.4%" nie "23.456789%").

async function bulkGetStats() {
  const state = await getBulkState();
  const totals = {
    invitesSent: 0,
    accepted: 0,
    messagesSent: 0,
    messageReplies: 0,
    followup1Sent: 0,
    followup1Replies: 0,
    followup2Sent: 0,
    followup2Replies: 0,
    anyReply: 0,
  };

  for (const item of state.queue) {
    // Invite sent: status="sent" lub "manual_sent" (manual outreach też counts).
    if (item.status === "sent" || item.status === "manual_sent") {
      totals.invitesSent++;
    }
    if (item.acceptedAt != null) totals.accepted++;
    if (item.messageSentAt != null) totals.messagesSent++;
    if (item.messageReplyAt != null) totals.messageReplies++;
    if (item.followup1SentAt != null) totals.followup1Sent++;
    if (item.followup1ReplyAt != null) totals.followup1Replies++;
    if (item.followup2SentAt != null) totals.followup2Sent++;
    if (item.followup2ReplyAt != null) totals.followup2Replies++;
    if (
      item.messageReplyAt != null ||
      item.followup1ReplyAt != null ||
      item.followup2ReplyAt != null
    ) {
      totals.anyReply++;
    }
  }

  function pct(num, den) {
    if (!den || den <= 0) return 0;
    return Math.round((num / den) * 1000) / 10; // 1 decimal place
  }

  const rates = {
    acceptRate: pct(totals.accepted, totals.invitesSent),
    messageReplyRate: pct(totals.messageReplies, totals.messagesSent),
    followup1ReplyRate: pct(totals.followup1Replies, totals.followup1Sent),
    followup2ReplyRate: pct(totals.followup2Replies, totals.followup2Sent),
    overallReplyRate: pct(totals.anyReply, totals.messagesSent),
  };

  return { success: true, totals, rates };
}

async function findLinkedInSearchTab() {
  // chrome.tabs.query nie supportuje wildcard *.linkedin.com/search w pojedynczym
  // wzorcu w MV3 — szukamy obu domen.
  const tabs = await chrome.tabs.query({
    url: ["*://*.linkedin.com/search/results/people/*"],
  });
  return tabs[0] || null;
}

// ── Bulk worker resilience (#39 v1.9.2) ──────────────────────────────
//
// Pre-#39 problem: `findLinkedInSearchTab()` querowało po URL pattern, więc gdy
// user kliknął na profil w aktywnej karcie (URL zmienił się z /search/results/
// people/ na /in/<slug>/), query zwracało null → tick exit'ował z "Lost
// LinkedIn search tab". User musiał manualnie wrócić na search i kliknąć Start.
//
// Fix: persist tabId przy starcie bulk session. Tick używa `resolveBulkTab()`
// (chrome.tabs.get → fallback do findLinkedInSearchTab). Jeśli URL kart nie
// jest na search results, tick auto-navigates karty na zapisanym keywords
// + pageNumber (max 3 retry — circuit breaker).

/**
 * Zwraca tab object dla bulk session. Próbuje persistowanego tabId, fallback
 * na query po URL pattern. Re-persistuje tabId gdy fallback znalazł nowy.
 */
async function resolveBulkTab() {
  const state = await getBulkState();
  if (state.tabId) {
    try {
      const tab = await chrome.tabs.get(state.tabId);
      if (tab) return tab;
    } catch (_) {
      // Tab closed — fallthrough do fallback.
    }
  }
  const fallback = await findLinkedInSearchTab();
  if (fallback && fallback.id) {
    await setBulkState({ tabId: fallback.id });
    return fallback;
  }
  // #43 v1.11.4: user zamknął kartę search results całkowicie (nie tylko
  // nawigacja na inną stronę — #39 case). Recovery: stwórz nową kartę
  // z zapisanym lastSearchKeywords + page pending item'a. active:false
  // żeby nie zabierać user'owi focus'u (worker zwykle działa w tle).
  if (state.lastSearchKeywords) {
    const pending = state.queue.find((q) => q.status === "pending");
    const targetPage = (pending && pending.pageNumber) || 1;
    const url = buildSearchUrl(state.lastSearchKeywords, targetPage);
    try {
      const newTab = await chrome.tabs.create({ url, active: false });
      await waitForTabComplete(newTab.id, 12000);
      await new Promise((r) => setTimeout(r, PAGINATION_RENDER_DELAY_MS));
      await setBulkState({ tabId: newTab.id });
      reportScrapeFailure({
        event_type: "bulk_tab_recovered",
        url,
        diagnostics: {
          lastSearchKeywords: state.lastSearchKeywords,
          targetPage,
        },
        error_message: "tab_closed_recovered_by_create",
      });
      return newTab;
    } catch (err) {
      console.warn(
        "[LinkedIn MSG] bulk tab recovery failed:",
        err && err.message
      );
    }
  }
  return null;
}

/**
 * Czyta location.href z taba bez `tabs` permission. Pattern z v1.8.2 (#32) —
 * `scripting` + host_permissions wystarcza dla executeScript w LinkedIn'ie.
 */
async function getCurrentBulkTabUrl(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => location.href,
    });
    return (results && results[0] && results[0].result) || null;
  } catch (err) {
    return null;
  }
}

/**
 * Buduje search results URL z zapisanego keywords + page. Używane gdy tick
 * wykryje że karta jest poza search results (np. user kliknął profil) i
 * próbuje auto-navigate z powrotem.
 */
function buildSearchUrl(keywords, pageNum) {
  const u = new URL("https://www.linkedin.com/search/results/people/");
  if (keywords) u.searchParams.set("keywords", keywords);
  if (pageNum && pageNum > 1) u.searchParams.set("page", String(pageNum));
  // Standard LinkedIn defaults dla people search — NIE re-buildujemy
  // network=["S"] (2nd degree only) etc., bo nie zapisujemy całego URL'a.
  // Auto-navigate jest fallbackiem dla "user wyszedł z search" — primary
  // use case (page-aware navigation w tick'u) używa setPageInUrl który
  // preservuje wszystkie LinkedIn'owe query params z aktualnego URL'a.
  u.searchParams.set("origin", "FACETED_SEARCH");
  return u.toString();
}

/**
 * Telemetria fail'a auto-navigate (3x w rzędu user wyszedł z search results,
 * worker poddał się). Reuse `reportScrapeFailure` żeby payload trafił do
 * tego samego JSONL log'u backendu (`event_type` field rozróżnia incydenty).
 */
async function fireBulkNavigateFail(currentUrl, expectedUrl) {
  reportScrapeFailure({
    event_type: "bulk_navigate_fail",
    url: currentUrl || "",
    error_message: `expected ${expectedUrl}`,
    diagnostics: {
      current_url: currentUrl || null,
      expected_url: expectedUrl || null,
    },
  });
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
// v1.14.4: bump 10 → 20 — "Wypełnij" z dużym addCount (np. 200 na zapas)
// potrzebuje więcej stron. Sama nawigacja po stronach (bez Connect-klików)
// jest low-risk dla anti-detection; LI patrzy na burst'y Connectów.
const PAGINATION_MAX_PAGES = 20;

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

  // #43-followup v1.14.4: persistuj keywords + tabId teraz, żeby Resume po
  // zamknięciu karty potrafił odtworzyć search URL nawet jeśli worker nigdy
  // nie był jeszcze wystartowany.
  try {
    const kw = new URL(baseUrl).searchParams.get("keywords");
    const patch = { tabId: tab.id };
    if (kw) patch.lastSearchKeywords = kw;
    await setBulkState(patch);
  } catch (_) { /* malformed URL — skip */ }

  const cap = Math.max(1, maxProfiles || 25);
  const state = await getBulkState();
  // Dedup także względem istniejącej queue (nie tylko within current scan).
  const existingSlugs = new Set(state.queue.map((q) => q.slug));
  const collected = [];

  let pageNum = getPageFromUrl(baseUrl); // start z aktualnej strony
  if (pageNum < 1) pageNum = 1;
  const startPage = pageNum;

  // #44 v1.11.5 — cooperative cancel. Reset flag i zaznacz że auto-fill
  // running, żeby popup pokazał button Stop. finally guarantee'uje
  // wyczyszczenie nawet przy wyjątku.
  await setBulkState({ autoFillRunning: true, autoFillCancelRequested: false });
  let cancelled = false;
  try {
  for (let pagesScanned = 0; pagesScanned < PAGINATION_MAX_PAGES; pagesScanned++) {
    // Cooperative cancel — user kliknął Stop. Sprawdzamy PRZED jitter'em
    // i navigation żeby cancel reagował szybko (max ~render delay = 1.5s).
    const cancelCheck = await getBulkState();
    if (cancelCheck.autoFillCancelRequested) {
      cancelled = true;
      break;
    }
    // Pierwsza iteracja na bieżącej stronie — DOM zhydrowany, scrape od razu.
    // BEZ tabs.update (Chrome nie wystrzeli "complete" gdy URL ten sam →
    // waitForTabComplete timeout'owało 12s = root cause "czekam 2 minuty").
    const alreadyOnTargetPage = pagesScanned === 0 && pageNum === startPage;
    if (!alreadyOnTargetPage) {
      // Anti-detection jitter 2-5s między pages. Krótszy niż 5-15s (#39)
      // bo cap=25 mieści się typowo w 1-3 stronach, a worker tick'i przy
      // faktycznym Connect mają osobny delay 45-120s.
      const jitter = 2000 + Math.random() * 3000;
      await new Promise((r) => setTimeout(r, jitter));
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
    }

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
  } finally {
    // Zawsze resetuj running flag, nawet przy wyjątku — inaczej UI utknęłoby
    // w stanie "Stop" bez możliwości ponownego uruchomienia.
    await setBulkState({ autoFillRunning: false, autoFillCancelRequested: false });
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
    cancelled,
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

  // #49 v1.14.5 — connect z profilu zamiast ze strony wyszukiwania.
  // probeProfileTab otwiera linkedin.com/in/<slug>/ w karcie w tle, content
  // script klika "Połącz" → "Wyślij bez notatki", weryfikuje pending badge,
  // potem karta jest zamykana. ZERO zależności od search tab / keywords /
  // numerów stron (root cause li_not_found gdy osoba nie na otwartej stronie).
  let response;
  try {
    response = await Promise.race([
      probeProfileTab(pending.slug, "connectFromProfile"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("bulk_tick_timeout")), 50000)
      ),
    ]);
  } catch (err) {
    response = { success: false, error: (err && err.message) || "send_failed" };
  }
  if (!response) response = { success: false, error: "no_response" };

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
    reportScrapeFailure({
      event_type: "bulk_connect_profile_fail",
      error_message: errorVal,
      diagnostics: { slug: pending.slug },
    });
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
  // #49 v1.14.5: connect z profilu — worker NIE potrzebuje otwartej karty
  // wyszukiwania. Wystarczy że są pending items w kolejce. Każdy tick otwiera
  // linkedin.com/in/<slug>/ w karcie w tle i tam klika "Połącz". To
  // jednocześnie naprawia stary "Resume wymaga otwartej karty search".
  const state = await getBulkState();
  const hasPending = (state.queue || []).some((q) => q.status === "pending");
  if (!hasPending) {
    return { success: false, error: "queue_empty" };
  }
  await setBulkState({
    active: true,
    errorMsg: null,
    nextTickAt: Date.now() + 100,
    lastTickAt: null,
    navigateFailCount: 0,
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
  } else if (alarm.name === DB_BACKUP_ALARM_NAME) {
    // #45: sprawdź czy minął interwał auto-backupu; jeśli tak — zapisz plik.
    doAutoBackup(false).catch((e) => console.warn("[LinkedIn MSG] auto-backup tick fail:", e && e.message));
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

// ── Profile DB — trwała baza profili (#45 v1.14.0) ────────────────────
//
// LinkedIn wprowadził limity wyszukiwania → zescrape'owane profile i wyniki
// wyszukiwania trzeba zachować NA STAŁE, niezależnie od `bulkConnect.queue`
// (kolejka zaproszeń bywa czyszczona, a wyszukać ponownie się nie da po
// wyczerpaniu limitu). `profileDb` to osobny, rosnący zbiór — kolejka jest
// jego podzbiorem (`inQueue` liczony lazy przy `profileDbList`).
//
// Auto-backup: alarm `dbBackupAlarm` co N dni → chrome.downloads zapisuje
// pełny snapshot do Pobrane/linkedin-msg-backup/. To JEDYNA rzecz która
// przeżyje Remove+Add extension'a (Chrome wipe'uje storage przy Remove,
// niezależnie od stable `key` — patrz CLAUDE.md). `unlimitedStorage` w
// manifest zdejmuje limit 5 MB per-key.

const PROFILE_DB_DEFAULTS = { version: 1, profiles: {}, lastBackupAt: null };
const DB_BACKUP_ALARM_NAME = "dbBackupAlarm";
const DEFAULT_BACKUP_INTERVAL_DAYS = 3;
// Soft limit dla data: URL przekazywanego do chrome.downloads. Powyżej —
// budujemy "lite" backup bez scrapedProfile (about/experience/skills) żeby
// download nie failował na zbyt długim data URI.
const BACKUP_DATA_URL_SOFT_LIMIT = 20 * 1024 * 1024;

// "Siła" źródła — przy upsercie nie cofamy source z bogatszego na uboższy
// (raz oznaczony profile_scrape nie wraca do "search").
const SOURCE_RANK = {
  search: 1,
  bulk: 2,
  manual: 3,
  connections_import: 4,
  profile_scrape: 5,
};

async function getProfileDb() {
  const data = await chrome.storage.local.get("profileDb");
  const db = data.profileDb || {};
  return {
    version: db.version || PROFILE_DB_DEFAULTS.version,
    profiles: db.profiles && typeof db.profiles === "object" ? db.profiles : {},
    lastBackupAt: db.lastBackupAt || null,
  };
}

async function writeProfileDb(next) {
  try {
    await chrome.storage.local.set({ profileDb: next });
    return next;
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    console.error("[LinkedIn MSG] writeProfileDb fail:", errMsg);
    reportScrapeFailure({
      event_type: "profiledb_write_fail",
      error_message: errMsg,
      diagnostics: { profiles_count: Object.keys((next && next.profiles) || {}).length },
    });
    throw err;
  }
}

/**
 * Normalizuje wejściowy obiekt (z extractSearchResults / scrapeProfile /
 * importu) do ProfileRecord. Zwraca null gdy brak slug-a.
 */
function profileRecordFromInput(p, source, nowMs) {
  if (!p) return null;
  // slug może przyjść jako p.slug (search/connections) albo wyciągnięty
  // z profile_url (scrapeProfile zwraca {profile_url, name, headline, ...}).
  let slug = p.slug || null;
  if (!slug && p.profile_url) slug = extractSlugFromUrl(p.profile_url);
  if (!slug && p.profileUrl) slug = extractSlugFromUrl(p.profileUrl);
  if (slug) {
    try { slug = decodeURIComponent(slug).toLowerCase(); } catch (_) { slug = String(slug).toLowerCase(); }
  }
  if (!slug) return null;

  const isScrape = source === "profile_scrape";
  const degreeRaw = p.degree || (p.buttonState === "Message" ? "1st" : null);
  return {
    slug,
    name: p.name || "",
    headline: p.headline || "",
    location: p.location || null,
    degree: degreeRaw || null,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    mutualConnections: p.mutualConnections || p.mutual_connections || null,
    source,
    pageNumber: typeof p.pageNumber === "number" ? p.pageNumber : null,
    firstSeenAt: nowMs,
    lastSeenAt: nowMs,
    // Pełny blob ze scrapeProfile (about/experience/skills) — tylko gdy
    // faktycznie scrapujemy; inaczej null. scrapeProfile zwraca cały obiekt
    // profilu — zapisujemy go w całości.
    scrapedProfile: isScrape ? (p.scrapedProfile || (p.profile_url ? p : null)) : (p.scrapedProfile || null),
    isConnection: source === "connections_import" ? true : (degreeRaw === "1st" || !!p.isConnection || p.buttonState === "Message"),
    inQueue: false, // liczony lazy w profileDbList
    notes: typeof p.notes === "string" ? p.notes : "",
    tags: Array.isArray(p.tags) ? p.tags : [],
  };
}

/**
 * Merge nowego rekordu na istniejący. Reguła: nie nadpisuj wartości truthy
 * wartością falsy (raz zescrape'owany scrapedProfile / wypełniony headline
 * przeżywa kolejny upsert z samego search), aktualizuj lastSeenAt, podbij
 * source tylko "w górę".
 */
function mergeProfileRecord(prev, next) {
  if (!prev) return next;
  const out = { ...prev };
  out.lastSeenAt = next.lastSeenAt || prev.lastSeenAt;
  out.firstSeenAt = Math.min(prev.firstSeenAt || next.firstSeenAt, next.firstSeenAt || prev.firstSeenAt);
  // Pola tekstowe — nadpisz tylko gdy nowa wartość niepusta.
  for (const k of ["name", "headline", "location", "degree", "mutualConnections", "profileUrl"]) {
    if (next[k]) out[k] = next[k];
  }
  if (typeof next.pageNumber === "number") out.pageNumber = next.pageNumber;
  if (next.scrapedProfile) out.scrapedProfile = next.scrapedProfile;
  out.isConnection = prev.isConnection || next.isConnection;
  // Source — wybierz wyżej rankowane.
  if ((SOURCE_RANK[next.source] || 0) >= (SOURCE_RANK[prev.source] || 0)) out.source = next.source;
  // notes/tags — ręczne, importowane wartości nie kasują istniejących.
  if (next.notes && !prev.notes) out.notes = next.notes;
  if (Array.isArray(next.tags) && next.tags.length && (!prev.tags || !prev.tags.length)) out.tags = next.tags;
  return out;
}

/**
 * Upsert listy profili do bazy. `source` ∈ {search, profile_scrape,
 * connections_import, manual, bulk}. Zwraca {added, updated, total}.
 */
async function upsertProfilesToDb(profiles, source) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    const db = await getProfileDb();
    return { added: 0, updated: 0, total: Object.keys(db.profiles).length };
  }
  const db = await getProfileDb();
  const now = Date.now();
  let added = 0, updated = 0;
  for (const p of profiles) {
    const rec = profileRecordFromInput(p, source, now);
    if (!rec) continue;
    if (db.profiles[rec.slug]) {
      db.profiles[rec.slug] = mergeProfileRecord(db.profiles[rec.slug], rec);
      updated += 1;
    } else {
      db.profiles[rec.slug] = rec;
      added += 1;
    }
  }
  await writeProfileDb(db);
  return { added, updated, total: Object.keys(db.profiles).length };
}

/**
 * Zwraca posortowaną tablicę rekordów (+ liczniki) dla dashboardu.
 * inQueue liczony tutaj (cross-ref z bulkConnect.queue) — taniej niż
 * synchronizować przy każdym setBulkState.
 * filter: { text?, source?, isConnection? ("yes"|"no"|"") }
 */
async function profileDbList(filter = {}) {
  const db = await getProfileDb();
  const bulk = await getBulkState();
  const queueSlugs = new Set((bulk.queue || []).map((q) => q.slug));
  const text = (filter.text || "").trim().toLowerCase();
  const wantSource = filter.source || "";
  const wantConn = filter.isConnection || "";

  let list = Object.values(db.profiles).map((r) => ({
    ...r,
    inQueue: queueSlugs.has(r.slug),
    hasFullScrape: !!r.scrapedProfile,
  }));
  let inQueueCount = 0, connectionsCount = 0;
  for (const r of list) {
    if (r.inQueue) inQueueCount += 1;
    if (r.isConnection) connectionsCount += 1;
  }
  if (text) {
    list = list.filter((r) =>
      (r.name || "").toLowerCase().includes(text) ||
      (r.headline || "").toLowerCase().includes(text) ||
      (r.slug || "").toLowerCase().includes(text)
    );
  }
  if (wantSource) list = list.filter((r) => r.source === wantSource);
  if (wantConn === "yes") list = list.filter((r) => r.isConnection);
  if (wantConn === "no") list = list.filter((r) => !r.isConnection);

  list.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  return {
    success: true,
    list,
    counts: { total: Object.keys(db.profiles).length, connections: connectionsCount, inQueue: inQueueCount, filtered: list.length },
  };
}

// ── Eksport / backup ──────────────────────────────────────────────────

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const CSV_COLUMNS = ["slug", "name", "headline", "location", "degree", "profileUrl", "source", "isConnection", "inQueue", "firstSeenAt", "lastSeenAt", "hasFullScrape", "notes"];

async function buildProfileDbCsv() {
  const { list } = await profileDbList({});
  const rows = [CSV_COLUMNS.join(",")];
  for (const r of list) {
    rows.push(CSV_COLUMNS.map((c) => {
      if (c === "hasFullScrape") return r.hasFullScrape ? "1" : "0";
      if (c === "isConnection") return r.isConnection ? "1" : "0";
      if (c === "inQueue") return r.inQueue ? "1" : "0";
      if (c === "firstSeenAt" || c === "lastSeenAt") return r[c] ? new Date(r[c]).toISOString() : "";
      return csvEscape(r[c]);
    }).join(","));
  }
  return rows.join("\r\n");
}

/**
 * Bardzo prosty parser CSV (obsługuje cudzysłowy + escaped ""). Zwraca
 * tablicę obiektów keyed po nagłówku. Używany przy imporcie CSV do bazy.
 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch === "\r") { /* skip — \r\n handled by \n */ }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c && c.trim())).map((r) => {
    const o = {};
    header.forEach((h, idx) => { o[h] = r[idx] != null ? r[idx] : ""; });
    return o;
  });
}

async function buildFullBackupJson() {
  const bulk = await getBulkState();
  const db = await getProfileDb();
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    extVersion: chrome.runtime.getManifest().version,
    bulkConnect: bulk,
    profileDb: db,
  });
}

function buildLiteBackupJson(fullObj) {
  const lite = JSON.parse(JSON.stringify(fullObj));
  if (lite.profileDb && lite.profileDb.profiles) {
    for (const slug of Object.keys(lite.profileDb.profiles)) {
      lite.profileDb.profiles[slug].scrapedProfile = null;
    }
  }
  if (lite.bulkConnect && Array.isArray(lite.bulkConnect.queue)) {
    lite.bulkConnect.queue = lite.bulkConnect.queue.map((it) => ({ ...it, scrapedProfile: null }));
  }
  lite._lite = true;
  return JSON.stringify(lite);
}

// SW nie ma URL.createObjectURL — używamy data: URL z base64. btoa wymaga
// latin1, więc encode UTF-8 → percent → unescape (klasyczny trik).
function toBase64Utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function doAutoBackup(force) {
  const db = await getProfileDb();
  const intervalDays = await getBackupIntervalDays();
  if (!force) {
    if (intervalDays <= 0) return { success: false, skipped: "disabled" };
    const due = Date.now() - (db.lastBackupAt || 0) > intervalDays * 86400000;
    if (!due) return { success: false, skipped: "not_due" };
  }

  const fullObj = {
    exportedAt: new Date().toISOString(),
    extVersion: chrome.runtime.getManifest().version,
    bulkConnect: await getBulkState(),
    profileDb: db,
  };
  let json = JSON.stringify(fullObj);
  let lite = false;
  if (json.length > BACKUP_DATA_URL_SOFT_LIMIT) {
    console.warn("[LinkedIn MSG] Backup za duży (" + Math.round(json.length / 1048576) + " MB) — buduję lite (bez scrapedProfile)");
    json = buildLiteBackupJson(fullObj);
    lite = true;
  }
  const today = todayDateString();
  const filename = `linkedin-msg-backup/backup-${today}${lite ? "-lite" : ""}.json`;
  try {
    const url = "data:application/json;base64," + toBase64Utf8(json);
    const downloadId = await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: "overwrite" });
    await writeProfileDb({ ...db, lastBackupAt: Date.now() });
    return { success: true, filename, bytes: json.length, lite, downloadId };
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err);
    console.error("[LinkedIn MSG] Auto-backup download fail:", errMsg);
    reportScrapeFailure({ event_type: "db_backup_fail", error_message: errMsg, diagnostics: { bytes: json.length, lite } });
    return { success: false, error: errMsg };
  }
}

async function getBackupIntervalDays() {
  const s = await getSettings();
  const v = s.backupIntervalDays;
  if (v === 0 || v === "0") return 0;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_BACKUP_INTERVAL_DAYS;
}

// ── Import / restore ──────────────────────────────────────────────────

/**
 * Import z parsowanego pliku. Akceptuje:
 *  - JSON pełnego backupu {profileDb, bulkConnect, ...}
 *  - JSON samej bazy {profiles: {...}}
 *  - JSON tablicy rekordów [{slug, name, ...}, ...]
 *  - CSV (string) — wiersze z kolumnami CSV_COLUMNS
 * opts.restoreQueue — gdy true i payload zawiera bulkConnect, nadpisz kolejkę.
 */
async function profileDbImport({ json, csv, restoreQueue }) {
  let recordsInput = [];
  let bulkPayload = null;

  if (typeof csv === "string" && csv.trim()) {
    const rows = parseCsv(csv);
    recordsInput = rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      headline: row.headline,
      location: row.location || null,
      degree: row.degree || null,
      profileUrl: row.profileUrl || null,
      isConnection: row.isConnection === "1" || row.isConnection === "true",
      notes: row.notes || "",
    }));
  } else if (typeof json === "string" && json.trim()) {
    let parsed;
    try { parsed = JSON.parse(json); } catch (e) { return { success: false, error: "invalid_json" }; }
    if (Array.isArray(parsed)) {
      recordsInput = parsed;
    } else if (parsed && parsed.profileDb && parsed.profileDb.profiles) {
      recordsInput = Object.values(parsed.profileDb.profiles);
      bulkPayload = parsed.bulkConnect || null;
    } else if (parsed && parsed.profiles && typeof parsed.profiles === "object") {
      recordsInput = Object.values(parsed.profiles);
    } else if (parsed && Array.isArray(parsed.queue)) {
      // ktoś podrzucił sam bulkConnect
      bulkPayload = parsed;
    } else {
      return { success: false, error: "unrecognized_format" };
    }
  } else {
    return { success: false, error: "empty_input" };
  }

  // Upsert rekordów — zachowaj oryginalny source jeśli był, inaczej "manual".
  const db = await getProfileDb();
  const now = Date.now();
  let added = 0, updated = 0;
  for (const p of recordsInput) {
    if (!p) continue;
    const src = (p.source && SOURCE_RANK[p.source]) ? p.source : "manual";
    const rec = profileRecordFromInput(p, src, now);
    if (!rec) continue;
    // Zachowaj oryginalne timestampy z backupu jeśli są.
    if (p.firstSeenAt) rec.firstSeenAt = p.firstSeenAt;
    if (p.lastSeenAt) rec.lastSeenAt = p.lastSeenAt;
    if (db.profiles[rec.slug]) { db.profiles[rec.slug] = mergeProfileRecord(db.profiles[rec.slug], rec); updated += 1; }
    else { db.profiles[rec.slug] = rec; added += 1; }
  }
  await writeProfileDb(db);

  let queueRestored = 0;
  if (restoreQueue && bulkPayload && Array.isArray(bulkPayload.queue)) {
    // Merge: dodaj brakujące slug-i do istniejącej kolejki (nie kasuj
    // bieżącej pracy). Pełne nadpisanie byłoby destrukcyjne.
    const cur = await getBulkState();
    const have = new Set(cur.queue.map((q) => q.slug));
    const incoming = bulkPayload.queue.filter((q) => q && q.slug && !have.has(q.slug));
    queueRestored = incoming.length;
    if (incoming.length) await setBulkState({ queue: [...cur.queue, ...incoming] });
  }

  return { success: true, added, updated, total: Object.keys(db.profiles).length, queueRestored };
}

// ── Import kontaktów 1st-degree z LinkedIn ────────────────────────────
//
// Otwiera (lub reusuje) kartę /mynetwork/invite-connect/connections/,
// content.js robi infinite-scroll + extractConnectionsList, wynik upsertujemy
// jako source="connections_import" z isConnection=true. Karta otwierana
// active:true bo infinite-scroll wymaga layoutu/IntersectionObserver'a.

const CONNECTIONS_TAB_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/";
const IMPORT_CONNECTIONS_TIMEOUT_MS = 6 * 60 * 1000; // generous — scroll może trwać

async function importConnectionsFlow(maxPages) {
  let tab = null;
  let createdTab = false;
  try {
    const existing = await chrome.tabs.query({ url: ["*://*.linkedin.com/mynetwork/invite-connect/connections/*"] });
    if (existing && existing.length) {
      tab = existing[0];
      // Re-load żeby content script był świeży i lista od początku.
      await chrome.tabs.update(tab.id, { url: CONNECTIONS_TAB_URL, active: true });
    } else {
      tab = await chrome.tabs.create({ url: CONNECTIONS_TAB_URL, active: true });
      createdTab = true;
    }
    // Czekamy aż content script odpowie (retry sendMessage przez ~15s).
    let resp = null, lastErr = null;
    const start = Date.now();
    while (Date.now() - start < 15000) {
      try {
        resp = await Promise.race([
          chrome.tabs.sendMessage(tab.id, { action: "importAllConnections", maxPages: maxPages || 50 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("import_timeout")), IMPORT_CONNECTIONS_TIMEOUT_MS)),
        ]);
        break;
      } catch (err) {
        lastErr = err;
        if (err && err.message === "import_timeout") throw err;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    if (!resp) throw lastErr || new Error("connections_tab_no_response");
    if (!resp.success) return { success: false, error: resp.error || "extract_failed" };

    const profiles = (resp.profiles || []).map((p) => ({ ...p, degree: "1st", isConnection: true }));
    const up = await upsertProfilesToDb(profiles, "connections_import");
    return { success: true, ...up, pagesProcessed: resp.pagesProcessed || 0, hitCap: !!resp.hitCap, scraped: profiles.length };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  } finally {
    if (createdTab && tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (_) { /* już zamknięta */ }
    }
  }
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
          // #43-followup v1.14.4: persistuj keywords przy dodawaniu do kolejki
          // (nie tylko przy Start) — żeby Resume po zamknięciu karty mógł
          // odtworzyć search results URL nawet jeśli worker nigdy nie był
          // wystartowany z otwartą kartą.
          if (message.searchKeywords) {
            await setBulkState({ lastSearchKeywords: message.searchKeywords });
          }
          return await addToQueue(message.profiles || []);

        case "bulkAutoFillByUrl":
          return await bulkAutoFillByUrl(message.maxProfiles);

        case "bulkAutoFillCancel":
          await setBulkState({ autoFillCancelRequested: true });
          return { success: true };

        case "getBulkState":
          return await getBulkState();

        case "getBulkTabUrl": {
          // #39: popup używa do diagnozy "user wyszedł z search results"
          // (np. żeby pokazać banner "Wróć na search żeby Resume").
          const s = await getBulkState();
          if (!s.tabId) {
            return { success: true, url: null, active: s.active };
          }
          const url = await getCurrentBulkTabUrl(s.tabId);
          return {
            success: true,
            url,
            active: s.active,
            lastSearchKeywords: s.lastSearchKeywords || null,
          };
        }

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

        case "trackManualSent":
          return await bulkAddManualSent(message.profile, message.messageDraft);

        case "getTrackingState":
          return await getTrackingState(message.slug);

        case "followupListAll":
          return await bulkListAllFollowups();

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

        // Reply tracking (#38 v1.11.0)
        case "bulkMarkMessageReply":
          return await bulkMarkMessageReply(message.slug);
        case "bulkMarkFollowup1Reply":
          return await bulkMarkFollowup1Reply(message.slug);
        case "bulkMarkFollowup2Reply":
          return await bulkMarkFollowup2Reply(message.slug);
        case "bulkUnmarkReply":
          return await bulkUnmarkReply(message.slug, message.stage);
        case "bulkGetStats":
          return await bulkGetStats();

        // Profile DB (#45 v1.14.0)
        case "profileDbUpsert":
          return { success: true, ...(await upsertProfilesToDb(message.profiles || [], message.source || "manual")) };
        case "profileDbList":
          return await profileDbList(message.filter || {});
        case "profileDbExportCsv":
          return { success: true, csv: await buildProfileDbCsv() };
        case "profileDbExportJson":
          return { success: true, json: await buildFullBackupJson() };
        case "profileDbImport":
          return await profileDbImport({ json: message.json, csv: message.csv, restoreQueue: !!message.restoreQueue });
        case "importConnections":
          return await importConnectionsFlow(message.maxPages);
        case "backupNow":
          return await doAutoBackup(true);
        case "getBackupStatus": {
          const _db = await getProfileDb();
          return { success: true, lastBackupAt: _db.lastBackupAt || null, intervalDays: await getBackupIntervalDays() };
        }

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
    // #40 v1.11.1 — DEFENSIVE: NIE overwrite gdy storage już istnieje.
    // Stable `key` field w manifest (od v1.6.0) zachowuje extension ID
    // po Remove+Add → Chrome preservuje storage. ALE poprzednia logika
    // bezwarunkowo overwrite'owała bulkConnect na DEFAULTS przy reason="install"
    // → user tracił queue/follow-upy mimo że Chrome próbował je zachować.
    // Marcin lost data 2026-05-10 — to zapobiega następnym razem.
    const existing = await chrome.storage.local.get(["settings", "bulkConnect", "profileDb"]);
    if (!existing.settings) {
      await saveSettings(DEFAULT_SETTINGS);
    }
    if (!existing.bulkConnect) {
      await chrome.storage.local.set({ bulkConnect: BULK_DEFAULTS });
    }
    if (!existing.profileDb) {
      await chrome.storage.local.set({ profileDb: PROFILE_DB_DEFAULTS });
    }
    const preserved = existing.settings ? "settings" : "";
    const preserved2 = existing.bulkConnect
      ? `bulkConnect (queue: ${(existing.bulkConnect.queue || []).length})`
      : "";
    const preserved3 = existing.profileDb
      ? `profileDb (profiles: ${Object.keys((existing.profileDb.profiles) || {}).length})`
      : "";
    console.log(
      `[LinkedIn MSG] Extension installed/reinstalled — preserved: ${[preserved, preserved2, preserved3].filter(Boolean).join(", ") || "(nothing, fresh install)"}`
    );
  }
  // v1.8.0: migracja encoded slug-ów (z wcześniejszych 1.7.x) na decoded
  // lowercase form. Idempotent — items już w decoded form pozostają bez zmian.
  await migrateSlugEncoding();
  // #25: alarm reset niezależnie od reason — install/update/chrome_update.
  await chrome.alarms.create(FOLLOWUP_ALARM_NAME, { periodInMinutes: 360 });
  // #45 v1.14.0: alarm auto-backupu — sprawdza co 12h czy minął interwał.
  await chrome.alarms.create(DB_BACKUP_ALARM_NAME, { periodInMinutes: 720 });
  await updateFollowupBadge();
});

// SW może się obudzić bez onInstalled (np. po idle kill). Re-create alarm
// + recompute badge na każdy start żeby badge był aktualny.
chrome.runtime.onStartup.addListener(async () => {
  await migrateSlugEncoding();
  await chrome.alarms.create(FOLLOWUP_ALARM_NAME, { periodInMinutes: 360 });
  await chrome.alarms.create(DB_BACKUP_ALARM_NAME, { periodInMinutes: 720 });
  await updateFollowupBadge();
});

/**
 * Jednorazowa migracja: queue items zapisane w 1.7.x mogły mieć encoded
 * slug-i (np. "rados%C5%82aw-...") z mixed case. v1.8.0 standaryzuje
 * decoded lowercase. Funkcja idempotent — drugie wywołanie nic nie zmienia.
 *
 * Plus dedup: jeśli po decode dwa items mają ten sam slug (legacy double-
 * inserted przed unifikacją), merge'ujemy zachowując bardziej kompletny
 * (większy messageSentAt + truthy followup1RemindAt).
 */
async function migrateSlugEncoding() {
  try {
    const state = await getBulkState();
    if (!Array.isArray(state.queue) || state.queue.length === 0) return;

    let changed = false;
    const merged = new Map();
    for (const item of state.queue) {
      if (!item || !item.slug) continue;
      let normalized;
      try {
        normalized = decodeURIComponent(item.slug).toLowerCase();
      } catch (_) {
        normalized = item.slug.toLowerCase();
      }
      if (normalized !== item.slug) changed = true;
      const patched = { ...item, slug: normalized };
      const prev = merged.get(normalized);
      if (!prev) {
        merged.set(normalized, patched);
      } else {
        // Wybierz bardziej kompletny — preferuj item z messageSentAt set.
        const keep = (patched.messageSentAt || 0) >= (prev.messageSentAt || 0) ? patched : prev;
        merged.set(normalized, keep);
        changed = true;
      }
    }
    if (changed) {
      await setBulkState({ queue: Array.from(merged.values()) });
      console.log(`[LinkedIn MSG] Slug migracja v1.8.0 — znormalizowano ${merged.size} item(s).`);
    }
  } catch (err) {
    console.warn("[LinkedIn MSG] migrateSlugEncoding failed:", err);
  }
}
