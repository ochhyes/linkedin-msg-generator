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
  // #68: default 3 → 1 — przy aktywnej pracy (setki zaproszeń/tydz.) utrata
  // 3 dni bolała; plik jest per-data z overwrite, więc 1/dzień nie śmieci.
  backupIntervalDays: 1,
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
  // #72 v2.1.0 — licznik kolejnych "failed" ticków. >=3 → auto-pauza
  // (konto ograniczone/limit). Zerowany przez sent/skipped i przy Start/Wznów.
  consecutiveFails: 0,
  // #44 v1.11.5 — cooperative cancel dla bulkAutoFillByUrl (pagination loop).
  // Popup ustawia autoFillCancelRequested=true gdy user kliknie Stop. Loop
  // sprawdza flag po każdej iteracji i breakuje z partial result.
  // autoFillRunning żeby popup wiedział kiedy pokazać "Stop" zamiast "Wypełnij".
  autoFillRunning: false,
  autoFillCancelRequested: false,
  // #65 v1.25.6 — live progress scanu "Wypełnij do limitu". Aktualizowany po
  // każdej stronie; popup renderuje licznik na przycisku (storage.onChanged).
  autoFillProgress: null, // {page, added, seen} | null
  // #56A v1.23.0 — auto accept-tracker w tle. 1× dziennie hidden tab na
  // /mynetwork/invite-connect/connections/, scan pierwszej porcji listy,
  // match po slug → flip acceptedAt dla wszystkich pasujących queue items
  // (status:"sent" && !acceptedAt). Eliminuje konieczność klikania
  // "Sprawdź akcepty" w popup'ie ręcznie. Mutex z bulk-connect worker'em.
  acceptCheck: {
    enabled: true,
    lastRunAt: null,            // ms — kiedy ostatni tick zakończony (success lub skip)
    lastSuccessAt: null,        // ms — kiedy ostatni tick z prawdziwym scan'em
    lastResult: null,           // {scanned, accepted, total} z ostatniego scan'a
    nextScanAt: null,           // ms — kiedy najwcześniej kolejny scan
    lastError: null,            // string — ostatni komunikat błędu
    lastErrorAt: null,          // ms — kiedy ostatni error
    failCount: 0,               // licznik kolejnych błędów; >=3 → auto-disable
    // #67: kto wyłączył — "user" (ręcznie w dashboardzie) | "auto" (3 faile).
    // Auto-disable jest cofany przy UPDATE extensionu (fix parsera = tracker
    // ma wstać sam); ręczny disable szanujemy na zawsze.
    disabledBy: null,
  },
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
      followupStatus: "scheduled", // "scheduled" | "skipped" | "replied" | "no_consent"
      // Sprint #6 (#38 v1.11.0): reply tracking — timestamp gdy user oznaczy
      // że dostał odpowiedź na danym etapie. Ustawia followupStatus="replied"
      // (excluded z due/scheduled, idzie do history). BC: items sprzed v1.11.0
      // nie mają tych pól → null w filterach.
      messageReplyAt: null,
      followup1ReplyAt: null,
      followup2ReplyAt: null,
      // #55 v1.22.0: zestaw zależny follow-upów + status "Brak zgody".
      // followupSetId niepuste gdy FU#1+FU#2 zaplanowane razem akcją
      // "Odroczony" — voidScheduledFollowupSet kasuje wtedy oba atomowo.
      followupSetId: null,
      followupDeferredDays: null,
    }));
  const next = await setBulkState({ queue: [...state.queue, ...fresh] });
  // #45: każdy profil który przewija się przez kolejkę trafia też do trwałej
  // bazy (źródło "bulk"). Fire-and-forget — nie blokuje add-to-queue.
  upsertProfilesToDb(fresh, "bulk").catch(() => {});
  return { success: true, queueSize: next.queue.length, added: fresh.length };
}

// #72 v2.1.0 — "Ponów błędy". PURE: queue items status==="failed" → "pending"
// (czyść error/timestamp). sent/manual_sent/skipped/pending nietknięte.
function resetFailedToPending(queue) {
  let retried = 0;
  const next = (queue || []).map((q) => {
    if (q && q.status === "failed") {
      retried += 1;
      return { ...q, status: "pending", error: null, timestamp: null };
    }
    return q;
  });
  return { queue: next, retried };
}

// Przywraca osoby z błędem do listy zaproszeń:
//  (1) reset failed→pending w kolejce (osoby, które wcześniej wywaliły "błąd"),
//  (2) "też z bazy/historii" — docina prospektów z profileDb (nie-kontakty),
//      których nie ma jeszcze w kolejce (np. po "Wyczyść" lub nigdy nie dodani).
// Worker (dailyCap) drenuje listę powoli, więc dorzucenie bazy jest bezpieczne.
async function bulkConnectRetryFailed() {
  const state = await getBulkState();
  const { queue, retried } = resetFailedToPending(state.queue);
  await setBulkState({ queue, errorMsg: null });

  const db = await getProfileDb();
  const queueSlugs = new Set(queue.map((q) => q.slug));
  const allSlugs = Object.keys((db && db.profiles) || {});
  const { toAdd } = selectEnqueueCandidates(db.profiles, allSlugs, queueSlugs);
  let fromBase = 0;
  if (toAdd.length) {
    const resp = await addToQueue(toAdd);
    fromBase = resp.added != null ? resp.added : toAdd.length;
  }
  const after = await getBulkState();
  return {
    success: true,
    retried,
    fromBase,
    queueSize: (after.queue || []).length,
  };
}

// #72 v2.1.0 — DIAGNOSTYKA dodawania. Otwiera profil w karcie w tle i wykonuje
// CAŁY flow connectFromProfile w trybie dryRun (NIE wysyła zaproszenia), zwraca
// strukturę z każdego etapu (URL po redirectach, czy znaleziono przycisk, czy
// modal, etykiety przycisków). To jest "pobierz prawdziwe dane" jednym klikiem.
async function bulkConnectDiagnose(slug) {
  const state = await getBulkState();
  let targetSlug = slug;
  if (!targetSlug) {
    const pending = (state.queue || []).find((q) => q.status === "pending");
    const failed = (state.queue || []).find((q) => q.status === "failed");
    targetSlug = (pending && pending.slug) || (failed && failed.slug) || null;
  }
  if (!targetSlug) return { success: false, error: "no_slug", hint: "brak profili w kolejce" };
  const t0 = Date.now();
  let result, errMsg = null;
  try {
    result = await probeProfileTab(targetSlug, "connectFromProfile", { dryRun: true });
  } catch (err) {
    errMsg = (err && err.message) || String(err);
    result = { success: false, error: errMsg };
  }
  return {
    success: true,
    slug: targetSlug,
    elapsedMs: Date.now() - t0,
    result: result || null,
    probeError: errMsg,
  };
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

// #72 v2.1.0 — czeka aż karta osiągnie status "complete" (lub timeout).
// Pozwala redirectom (/in/→/mynetwork/ przy limicie) ustabilizować się zanim
// zaczniemy injektować/sendMessage, żeby trafić w finalny dokument.
function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(onUpd); } catch (_) {}
      resolve();
    };
    const onUpd = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    try { chrome.tabs.onUpdated.addListener(onUpd); } catch (_) {}
    // Może już być complete zanim dodaliśmy listener.
    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === "complete") finish();
    }).catch(() => {});
    setTimeout(finish, timeoutMs);
  });
}

/**
 * Otwiera background tab z URL'em, czeka aż content script zareaguje na
 * sendMessage, zwraca response. Cleanup: zamyka tab niezależnie od wyniku.
 */
async function probeProfileTab(slug, action, opts) {
  const url = `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
  let tab = null;

  // Jedna runda: czeka na load karty, injektuje content.js, odpytuje go.
  // Zwraca response z content.js albo rzuca rich `tab_load_timeout`.
  async function oneRound() {
    // Poczekaj aż karta skończy ładowanie (i ustabilizuje redirecty) zanim
    // zaczniemy gadać — inaczej injektujemy w dokument, który zaraz zniknie.
    await waitForTabComplete(tab.id, 8000);
    const start = Date.now();
    let lastErr = null, injectOk = false, injectErrMsg = null, attempts = 0;
    while (Date.now() - start < TAB_LOAD_TIMEOUT_MS) {
      attempts++;
      // #72 v2.1.0: wstrzykuj content.js PROAKTYWNIE na KAŻDEJ próbie (nie raz
      // po 3 failach). Powód lawiny "Could not establish connection": manifest
      // content_scripts matchuje tylko /in/*, /search/.../people/*,
      // /connections/* — konto z limitem redirectuje /in/<slug>/ na gołe
      // /mynetwork/, gdzie manifest NIE wstrzykuje; a redirect potrafi też
      // nastąpić PO injekcji i zabić listener z poprzedniego dokumentu.
      // host_permissions pokrywa całe linkedin.com, więc executeScript wejdzie
      // wszędzie; guard __LINKEDIN_MSG_LOADED__ w content.js robi z powtórnej
      // injekcji w tym samym dokumencie no-op (zero podwójnych listenerów).
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        injectOk = true;
      } catch (e) { injectErrMsg = (e && e.message) || String(e); }
      try {
        return await Promise.race([
          chrome.tabs.sendMessage(tab.id, { action, opts: opts || undefined }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("scrape_timeout")), TAB_SCRAPE_TIMEOUT_MS)),
        ]);
      } catch (err) {
        lastErr = err;
        // Content script może jeszcze nie być gotowy / dokument w nawigacji.
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    // DIAGNOSTYKA: samoopisujący się błąd — finalny URL karty + status injekcji.
    let finalPath = "?", finalStatus = "?";
    try {
      const t = await chrome.tabs.get(tab.id);
      try { finalPath = new URL(t.url).pathname; } catch (_) { finalPath = t.url || "?"; }
      finalStatus = t.status || "?";
    } catch (_) {}
    const last = (lastErr && lastErr.message) || "no_response";
    const lastShort = last.indexOf("establish connection") >= 0 ? "no_listener" : last;
    throw new Error(
      `tab_load_timeout [path=${finalPath} status=${finalStatus} ` +
      `inject=${injectOk ? "ok" : "FAIL:" + (injectErrMsg || "?")} tries=${attempts} last=${lastShort}]`
    );
  }

  try {
    tab = await chrome.tabs.create({ url, active: false });
    let resp = await oneRound();
    // #72 v2.1.0 — RETRY przy redirektcie. Konto rate-limitowane bywa
    // redirectowane /in/→/mynetwork/ PRZEJŚCIOWO: pojedyncze świeże wejście
    // przechodzi (potwierdzone Diagnostyką "martyradomska" — wouldSend:true),
    // a seryjny bulk odbija. Przeładuj kartę z powrotem na /in/<slug>/ i spróbuj
    // ponownie (do 2×, z odstępem) — odzyskuje przejściowe redirecty.
    let redirectRetries = 0;
    while (resp && resp.error === "redirected_off_profile" && redirectRetries < 2) {
      redirectRetries++;
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
      try { await chrome.tabs.update(tab.id, { url }); } catch (_) {}
      resp = await oneRound();
    }
    if (resp && typeof resp === "object") resp.redirectRetries = redirectRetries;
    return resp;
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

// -- Auto accept-tracker (#56A v1.23.0) -------------------------------
//
// Background worker odpalany przez chrome.alarms co 60min. Tick sprawdza
// czy minal nextScanAt; jesli tak - otwiera /mynetwork/invite-connect/
// connections/ w hidden tab (active:false), parsuje pierwsze ~100 wpisow
// (BEZ scrolla, swieze akcepty na gorze listy LinkedIn'a), match slug
// w queue -> flip acceptedAt dla wszystkich pasujacych queue items
// (status:"sent" && !acceptedAt). Eliminuje koniecznosc klikania
// "Sprawdz akcepty" w popupie recznie.
//
// Mutex: gdy bulkConnect.active=true -> skip + reschedule za 30min.
// Godziny 9-18: poza -> skip + reschedule na 9:05 dzis/jutro.
// Auto-disable po 3 kolejnych bledach.

const ACCEPT_CHECK_ALARM_NAME = "acceptCheckTick";
const ACCEPT_CHECK_PERIOD_MS = 24 * 60 * 60 * 1000; // 24h base period
const ACCEPT_CHECK_JITTER_MS = 30 * 60 * 1000;     // +/- 30 min
const ACCEPT_CHECK_TAB_TIMEOUT_MS = 30000;
const ACCEPT_CHECK_RETRY_DELAY_MS = 30 * 60 * 1000; // 30min retry
const ACCEPT_CHECK_FAIL_LIMIT = 3;

/**
 * Pure (#67): czy auto-disabled tracker ma wstać przy update extensionu?
 * "auto" → tak (nowa wersja zwykle zawiera fix parsera). "user" → nie.
 * BC: stany sprzed #67 bez disabledBy — failCount>=limit traktujemy jak auto.
 * Portowane do test_accept_check.js.
 */
function shouldReenableAcceptTracker(ac, failLimit) {
  if (!ac || ac.enabled) return false;
  if (ac.disabledBy === "user") return false;
  if (ac.disabledBy === "auto") return true;
  return (ac.failCount || 0) >= failLimit;
}

/**
 * Pure logic: match listy connections (z .slug) przeciwko queue items.
 * Flip acceptedAt na items pasujacych slug && status==="sent" && !acceptedAt.
 * Portowane do test_accept_check.js (sync z tym kodem manualnie - debt #10).
 */
function matchAndFlipAccepts(queue, connections, nowMs) {
  if (!Array.isArray(queue) || !Array.isArray(connections)) {
    return { queue: queue || [], accepted: 0, matchedSlugs: [] };
  }
  const connSlugs = new Set(
    connections
      .map((c) => (c && c.slug ? String(c.slug).toLowerCase() : null))
      .filter(Boolean)
  );
  if (connSlugs.size === 0) {
    return { queue, accepted: 0, matchedSlugs: [] };
  }
  let accepted = 0;
  const matchedSlugs = [];
  const newQueue = queue.map((item) => {
    if (!item || !item.slug) return item;
    if (item.status !== "sent") return item;
    if (item.acceptedAt) return item;
    // #67: defensywny lowercase — connSlugs jest znormalizowany, ale legacy
    // queue item sprzed migracji mógłby mieć mixed-case slug i nie matchować.
    if (!connSlugs.has(String(item.slug).toLowerCase())) return item;
    accepted += 1;
    matchedSlugs.push(item.slug);
    return { ...item, acceptedAt: nowMs, lastAcceptCheckAt: nowMs };
  });
  return { queue: newQueue, accepted, matchedSlugs };
}

/**
 * Schedule next scan with jitter +/-30min around 24h base period.
 */
function scheduleNextAcceptCheck(nowMs) {
  const jitter = Math.floor((Math.random() - 0.5) * 2 * ACCEPT_CHECK_JITTER_MS);
  return nowMs + ACCEPT_CHECK_PERIOD_MS + jitter;
}

/**
 * Working-hours guard: gdy poza 9-18, zwroc timestamp nastepnego 9:05.
 * null = jestesmy w oknie pracy (mozna scanowac).
 */
function nextWorkingHourTs(nowMs, hourStart, hourEnd) {
  const d = new Date(nowMs);
  const hour = d.getHours();
  if (hour >= hourStart && hour < hourEnd) return null;
  const next = new Date(d);
  if (hour < hourStart) {
    next.setHours(hourStart, 5, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(hourStart, 5, 0, 0);
  }
  return next.getTime();
}

async function getAcceptCheckState() {
  const bulk = await getBulkState();
  return { ...BULK_DEFAULTS.acceptCheck, ...(bulk.acceptCheck || {}) };
}

async function setAcceptCheckState(patch) {
  const bulk = await getBulkState();
  const next = { ...BULK_DEFAULTS.acceptCheck, ...(bulk.acceptCheck || {}), ...patch };
  await setBulkState({ acceptCheck: next });
  return next;
}

/**
 * Otwiera hidden tab na connections page i pobiera swieza liste (bez scrolla).
 * Zwraca {success, profiles, total, error?}.
 */
async function fetchRecentConnections(limit) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url: CONNECTIONS_TAB_URL, active: false });
    let resp = null, lastErr = null;
    let injectedFallback = false;
    let attempts = 0;
    const start = Date.now();
    while (Date.now() - start < ACCEPT_CHECK_TAB_TIMEOUT_MS) {
      try {
        resp = await chrome.tabs.sendMessage(tab.id, {
          action: "extractRecentConnections",
          limit: limit || 100,
        });
        break;
      } catch (err) {
        lastErr = err;
        attempts++;
        // #67: injection-fallback (#57-pattern, spójnie z probeProfileTab) —
        // soft-redirect poza manifest matches zostawiał tab bez scriptu
        // i tick padał głuchym timeoutem po 30s.
        if (attempts >= 3 && !injectedFallback) {
          injectedFallback = true;
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ["content.js"],
            });
          } catch (_) { /* retry-loop doleci do timeoutu */ }
        }
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    if (!resp) throw lastErr || new Error("tab_no_response");
    if (!resp.success) return { success: false, error: resp.error || "extract_failed" };
    return { success: true, profiles: resp.profiles || [], total: resp.total || 0 };
  } catch (err) {
    return { success: false, error: err && err.message ? err.message : String(err) };
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (_) { /* tab already closed */ }
    }
  }
}

/**
 * Glowny tick auto-trackera. Idempotent - bezpieczny do force-run i scheduled.
 * @param {object} opts - {force:boolean} - bypassuje period + hours check
 */
async function acceptCheckTick(opts) {
  const force = !!(opts && opts.force);
  const state = await getAcceptCheckState();
  const bulkState = await getBulkState();
  const now = Date.now();

  if (!state.enabled && !force) {
    return { skipped: "disabled" };
  }

  if (bulkState.active) {
    await setAcceptCheckState({ lastRunAt: now, nextScanAt: now + ACCEPT_CHECK_RETRY_DELAY_MS });
    return { skipped: "bulk_running", nextScanAt: now + ACCEPT_CHECK_RETRY_DELAY_MS };
  }

  if (!force) {
    const wakeTs = nextWorkingHourTs(now, bulkState.config.workingHoursStart, bulkState.config.workingHoursEnd);
    if (wakeTs !== null) {
      await setAcceptCheckState({ lastRunAt: now, nextScanAt: wakeTs });
      return { skipped: "idle_hours", nextScanAt: wakeTs };
    }
    if (state.nextScanAt && now < state.nextScanAt) {
      return { skipped: "not_due", nextScanAt: state.nextScanAt };
    }
  }

  const fetched = await fetchRecentConnections(100);
  if (!fetched.success) {
    const failCount = (state.failCount || 0) + 1;
    const patch = {
      lastRunAt: now,
      lastError: fetched.error,
      lastErrorAt: now,
      failCount,
      nextScanAt: now + ACCEPT_CHECK_RETRY_DELAY_MS,
    };
    if (failCount >= ACCEPT_CHECK_FAIL_LIMIT) {
      patch.enabled = false;
      patch.disabledBy = "auto"; // #67: odróżnij od ręcznego — update re-enable'uje
    }
    await setAcceptCheckState(patch);
    return { success: false, error: fetched.error, failCount, disabled: patch.enabled === false };
  }

  // Match w queue (re-read state - moglo sie zmienic miedzy fetchem a teraz).
  const freshBulk = await getBulkState();
  const { queue: newQueue, accepted, matchedSlugs } = matchAndFlipAccepts(freshBulk.queue, fetched.profiles, now);
  if (accepted > 0) {
    await setBulkState({ queue: newQueue });
  }

  // BONUS: upsert do profileDb (swieze dane connections).
  try {
    const profilesForDb = fetched.profiles.map((p) => ({ ...p, degree: "1st", isConnection: true }));
    upsertProfilesToDb(profilesForDb, "connections_import").catch(() => {});
  } catch (_) { /* upsert best-effort */ }

  const nextScanAt = scheduleNextAcceptCheck(now);
  await setAcceptCheckState({
    lastRunAt: now,
    lastSuccessAt: now,
    lastResult: { scanned: fetched.profiles.length, accepted, total: fetched.total || fetched.profiles.length },
    nextScanAt,
    lastError: null,
    lastErrorAt: null,
    failCount: 0,
  });

  return {
    success: true,
    scanned: fetched.profiles.length,
    accepted,
    matchedSlugs,
    nextScanAt,
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
      followupSetId: item.followupSetId || null,
      followupDeferredDays: item.followupDeferredDays || null,
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

    // Brak zgody (#55) → tylko historia, żadnych dalszych wiadomości
    if (item.followupStatus === "no_consent") {
      history.push({ ...base, kind: "no_consent" });
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

// ── Follow-up "Brak zgody" + Odroczony + zależność/rollback (#55 v1.22.0) ──
//
// "Brak zgody" — kontakt nie wyraził zgody: status no_consent (mirror skip),
// nic dalej nie wysyłamy. "Odroczony" — przeplanowanie FU#1 na T+X dni i FU#2
// na T+X+GAP, oba w JEDNYM atomowym zapisie, oznaczone followupSetId (zestaw
// zależny). voidScheduledFollowupSet — anulacja jednego follow-upu z zestawu
// kasuje CAŁY zestaw jednym patchem (transakcyjnie — brak stanu pośredniego
// gdzie A anulowane a B jeszcze nie).

const FOLLOWUP_SET_GAP_DAYS = 4; // odstęp FU#2 po FU#1 (zachowuje obecne 3->7d)

async function bulkMarkNoConsent(slug) {
  if (!slug) return { success: false, error: "no_slug" };
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "not_found" };
  // Idempotent — drugi klik no-op.
  if (item.followupStatus === "no_consent") return { success: true, alreadyMarked: true };
  await updateQueueItem(slug, { followupStatus: "no_consent" });
  await updateFollowupBadge();
  return { success: true };
}

async function bulkDeferFollowup(slug, days) {
  if (!slug) return { success: false, error: "no_slug" };
  const n = Number(days);
  // Walidacja — liczba całkowita >= 1 (UI default 60).
  if (!Number.isInteger(n) || n < 1) return { success: false, error: "invalid_days" };
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "not_found" };
  const now = Date.now();
  const followup1RemindAt = now + n * 86400000;
  const followup2RemindAt = now + (n + FOLLOWUP_SET_GAP_DAYS) * 86400000;
  // JEDEN atomowy patch — FU#1 i FU#2 planowane równocześnie jako zestaw.
  await updateQueueItem(slug, {
    followup1RemindAt,
    followup2RemindAt,
    followupSetId: "fset_" + now,
    followupDeferredDays: n,
    followupStatus: "scheduled",
  });
  await updateFollowupBadge();
  return { success: true, followup1RemindAt, followup2RemindAt, days: n };
}

async function voidScheduledFollowupSet(slug, followupIdToCancel) {
  // Transakcyjny rollback. Jeśli follow-up należy do zestawu zależnego
  // (followupSetId), anuluj CAŁY zestaw jednym updateQueueItem = jeden
  // atomowy zapis storage. Bez tego marker'a — anuluj tylko żądany.
  if (!slug) return { success: false, error: "no_slug" };
  const state = await getBulkState();
  const item = state.queue.find((q) => q.slug === slug);
  if (!item) return { success: false, error: "not_found" };

  if (item.followupSetId) {
    await updateQueueItem(slug, {
      followup1RemindAt: null,
      followup2RemindAt: null,
      followup1Draft: null,
      followup2Draft: null,
      followupSetId: null,
      followupDeferredDays: null,
      followupStatus: "skipped",
    });
    await updateFollowupBadge();
    return { success: true, cancelled: [1, 2], wasSet: true };
  }

  // Item nie jest częścią zestawu — anuluj tylko żądany follow-up.
  const num = followupIdToCancel === 2 ? 2 : 1;
  const patch = num === 2
    ? { followup2RemindAt: null, followup2Draft: null }
    : { followup1RemindAt: null, followup1Draft: null };
  const otherRemind = num === 2 ? item.followup1RemindAt : item.followup2RemindAt;
  if (!otherRemind) patch.followupStatus = "skipped";
  await updateQueueItem(slug, patch);
  await updateFollowupBadge();
  return { success: true, cancelled: [num], wasSet: false };
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
// v1.14.4: bump 10 → 20. #58 v1.25.0: bump 20 → 100 — model Octopus (zbierz
// dużą pulę prospektów do bazy, max 1000 = 100 stron × 10). Sama nawigacja po
// stronach (bez Connect-klików) jest low-risk dla anti-detection; LI patrzy
// na burst'y Connectów, NIE na czytanie wyników. Jitter między stronami
// (3-7s, niżej) dodatkowo maskuje. UWAGA: LI bez Sales Nav capuje wyniki
// ~100 (commercial use limit) → realnie scan kończy się na pustej stronie.
const PAGINATION_MAX_PAGES = 100;
// #64 v1.25.5: bezpiecznik — tyle KOLEJNYCH stron bez ani jednego nowego
// connectable kończy scan. Bez tego, gdy LinkedIn rollował markup przycisku
// Connect (wszystkie profile "Unknown"), pętla jechała pusto przez 100 stron
// — Marcin widział "skacze po stronach i nic nie kolejkuje" przez ~10 minut.
const FILL_NO_NEW_PAGES_LIMIT = 5;

/**
 * extractSearchResults z injection-fallbackiem (#57-pattern, v1.24.1).
 * Goły sendMessage zawodzi gdy content script nie jest wstrzyknięty (karta
 * po SPA-nav — manifest content_scripts odpala się tylko przy pełnym load).
 * Fallback: chrome.scripting.executeScript + retry raz.
 */
async function extractSearchPageProfiles(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { action: "extractSearchResults" });
  } catch (_) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await new Promise((r) => setTimeout(r, 300));
    return await chrome.tabs.sendMessage(tabId, { action: "extractSearchResults" });
  }
}

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
  // #64: diagnostyka scanu — histogram buttonState'ów + próbka przycisków
  // z content scriptu. "0 dodanych" ma być wyjaśnialne (komunikat w popup +
  // telemetria), nie kończyć się cichą pętlą po pustych stronach.
  const stateCounts = {};
  let profilesSeen = 0;
  let buttonsSample = null;
  let noNewStreak = 0;
  let stoppedReason = null;

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
      stoppedReason = "cancelled";
      break;
    }
    // Pierwsza iteracja na bieżącej stronie — DOM zhydrowany, scrape od razu.
    // BEZ tabs.update (Chrome nie wystrzeli "complete" gdy URL ten sam →
    // waitForTabComplete timeout'owało 12s = root cause "czekam 2 minuty").
    const alreadyOnTargetPage = pagesScanned === 0 && pageNum === startPage;
    if (!alreadyOnTargetPage) {
      // Anti-detection jitter 3-7s między pages (#58: bump z 2-5s — przy
      // scanie do 100 stron większy jitter wygląda mniej botowo). Worker
      // tick'i przy faktycznym Connect mają osobny delay 45-120s.
      const jitter = 3000 + Math.random() * 4000;
      await new Promise((r) => setTimeout(r, jitter));
      const targetUrl = setPageInUrl(baseUrl, pageNum);
      try {
        await chrome.tabs.update(tab.id, { url: targetUrl });
        await waitForTabComplete(tab.id, 12000);
      } catch (err) {
        // Tab load failed — przerwij, zwróć co mamy.
        stoppedReason = "tab_load_failed";
        break;
      }
      // SDUI lazy render — extractSearchResults na świeżo loaded DOM często
      // zwraca pustą listę. Dodatkowe 1.5s żeby listy się zrenderowały.
      await new Promise((r) => setTimeout(r, PAGINATION_RENDER_DELAY_MS));
    }

    let pageProfiles = [];
    try {
      // #64: injection-fallback (#57-pattern) — goły sendMessage zawodził,
      // gdy karta doszła do search przez SPA-nav (content script nie
      // wstrzyknięty) i scan kończył się cicho z 0 profili.
      const resp = await extractSearchPageProfiles(tab.id);
      if (resp && resp.success && Array.isArray(resp.profiles)) {
        pageProfiles = resp.profiles;
        if (!buttonsSample && resp.buttonsSample) buttonsSample = resp.buttonsSample;
      }
    } catch (err) {
      // Content script nie zareagował — możliwe że LinkedIn redirect'ował na 404
      // dla page > max_pages. Przerwij scan.
      stoppedReason = "content_script_unreachable";
      break;
    }

    if (pageProfiles.length === 0) {
      // Pusta strona — najprawdopodobniej page > max_pages dla tego search.
      stoppedReason = "empty_page";
      break;
    }

    // #64: histogram buttonState'ów ze wszystkich obejrzanych profili —
    // trafia do komunikatu w popup i do telemetrii.
    profilesSeen += pageProfiles.length;
    for (const p of pageProfiles) {
      const st = (p && p.buttonState) || "Unknown";
      stateCounts[st] = (stateCounts[st] || 0) + 1;
    }

    // #58 v1.25.0: napełniaj bazę prospektów CAŁĄ pulą (nie tylko connectable
    // → kolejka). Model Octopus: zbierasz wszystko do `profileDb`, kurujesz w
    // dashboardzie, potem "Dodaj zaznaczone do kolejki connect". Fire-and-forget
    // — nie blokuje pagination loop'a.
    upsertProfilesToDb(pageProfiles, "search").catch(() => {});

    let addedThisPage = 0;
    const pageCollected = [];
    for (const p of pageProfiles) {
      if (!p || !p.slug) continue;
      if (existingSlugs.has(p.slug)) continue;
      if (p.buttonState !== "Connect") continue;
      existingSlugs.add(p.slug);
      pageCollected.push({
        slug: p.slug,
        name: p.name || "",
        headline: p.headline || "",
        pageNumber: pageNum,
      });
      addedThisPage++;
      if (collected.length + pageCollected.length >= cap) break;
    }

    // #65 v1.25.6: dorzucaj do kolejki PER STRONA, nie po całym scanie.
    // Popup ma storage.onChanged → renderBulkUI, więc lista i licznik
    // odświeżają się NA ŻYWO. Wcześniej addToQueue szło raz na końcu —
    // UI stało martwe aż do końca/Stop (zgłoszenie "nie odświeża się
    // ile już dodał — musiałem kliknąć stop").
    if (pageCollected.length > 0) {
      collected.push(...pageCollected);
      await addToQueue(pageCollected);
    }
    // Progress dla popupu (licznik na przycisku Stop).
    await setBulkState({
      autoFillProgress: { page: pageNum, added: collected.length, seen: profilesSeen },
    });

    if (collected.length >= cap) {
      stoppedReason = "cap_reached";
      break;
    }
    // #64: bezpiecznik — kolejne strony nic nie wnoszą (0 nowych connectable)
    // → przerwij po FILL_NO_NEW_PAGES_LIMIT zamiast jechać do 100. Typowe
    // przyczyny: LinkedIn przerollował markup przycisków (same "Unknown"),
    // same duplikaty po dedup, albo commercial-use limit ucina wyniki.
    if (addedThisPage === 0) {
      noNewStreak++;
      if (noNewStreak >= FILL_NO_NEW_PAGES_LIMIT) {
        stoppedReason = "no_new_connectable";
        break;
      }
    } else {
      noNewStreak = 0;
    }
    pageNum++;
  }
  if (!stoppedReason) stoppedReason = "max_pages_reached";
  } finally {
    // Zawsze resetuj running flag, nawet przy wyjątku — inaczej UI utknęłoby
    // w stanie "Stop" bez możliwości ponownego uruchomienia.
    await setBulkState({
      autoFillRunning: false,
      autoFillCancelRequested: false,
      autoFillProgress: null,
    });
  }

  // #65: profile trafiały do kolejki na bieżąco (per strona) — tu tylko suma.
  const added = collected.length;

  // #64: scan widział profile, ale ŻADEN nie nadawał się do kolejki —
  // najpewniej LinkedIn zmienił markup przycisku Connect. Telemetria z
  // histogramem + próbką przycisków pozwala naprawić selektory bez
  // czekania na ręczny dump od użytkownika. Fire-and-forget, max 1×/scan.
  if (profilesSeen > 0 && collected.length === 0 && !cancelled) {
    reportScrapeFailure({
      url: baseUrl,
      event_type: "bulk_fill_no_connectable",
      error_message: `0 connectable z ${profilesSeen} profili (stop: ${stoppedReason || "?"})`,
      diagnostics: {
        buttonStates: stateCounts,
        profilesSeen,
        pages: pageNum - startPage + 1,
        stoppedReason,
        buttonsSample,
      },
    });
  }

  return {
    success: true,
    added,
    pagesScanned: pageNum - getPageFromUrl(baseUrl),
    finalPage: pageNum,
    cancelled,
    profilesSeen,
    buttonStates: stateCounts,
    stopped: stoppedReason,
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
        // #72 v2.1.0: 75s (było 50s) — probeProfileTab robi teraz do 3 rund
        // (retry przy przejściowym redirektcie /in/→/mynetwork/).
        setTimeout(() => reject(new Error("bulk_tick_timeout")), 75000)
      ),
    ]);
  } catch (err) {
    response = { success: false, error: (err && err.message) || "send_failed" };
  }
  if (!response) response = { success: false, error: "no_response" };

  // #72 v2.1.0 — LinkedIn wstrzymał zaproszenia (tygodniowy limit konta).
  // NIE oznaczaj osoby jako "błąd" (to limit konta, nie wina profilu) —
  // zostaw ją jako pending, zatrzymaj worker i pokaż czytelny komunikat.
  // Wznów po resecie limitu (kilka dni).
  if (response.limit || response.error === "weekly_limit") {
    await setBulkState({
      active: false,
      errorMsg:
        "LinkedIn wstrzymał wysyłanie zaproszeń (tygodniowy limit konta). " +
        "Spróbuj ponownie za kilka dni — kliknij „Wznów”, gdy limit się odnowi.",
      nextTickAt: null,
    });
    await chrome.alarms.clear(BULK_ALARM_NAME);
    reportScrapeFailure({
      event_type: "bulk_connect_weekly_limit",
      error_message: "weekly_limit",
      diagnostics: { slug: pending.slug },
    });
    return;
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

  // #72 v2.1.0 — bezpiecznik serii błędów. "sent"/"skipped" = LinkedIn
  // odpowiada normalnie → zeruj licznik. Seria "failed" (np. każdy profil
  // redirectuje na /mynetwork/ albo "Could not establish connection") =
  // konto prawdopodobnie ograniczone/zablokowane → auto-pauza zamiast
  // przepalać całą kolejkę. Łapie limit niezależnie od tekstu modala.
  let consecutiveFails = after.consecutiveFails || 0;
  if (newStatus === "failed") consecutiveFails += 1;
  else consecutiveFails = 0;
  await setBulkState({ stats: newStats, consecutiveFails });

  const FAIL_STREAK_LIMIT = 3;
  if (consecutiveFails >= FAIL_STREAK_LIMIT) {
    await setBulkState({
      active: false,
      consecutiveFails: 0,
      errorMsg:
        `${FAIL_STREAK_LIMIT} nieudane próby z rzędu — LinkedIn prawdopodobnie ` +
        "ogranicza to konto (tygodniowy limit zaproszeń lub czasowa blokada). " +
        "Wstrzymano. Spróbuj ponownie za kilka dni — kliknij „Wznów”.",
      nextTickAt: null,
    });
    await chrome.alarms.clear(BULK_ALARM_NAME);
    reportScrapeFailure({
      event_type: "bulk_connect_fail_streak",
      error_message: errorVal,
      diagnostics: { slug: pending.slug, streak: FAIL_STREAK_LIMIT },
    });
    return;
  }

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
  const cw = await getCampaignWorkerState();
  if (cw.active) return { success: false, error: "campaign_worker_active" };
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
    consecutiveFails: 0,
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

// ── Campaign Worker (#74 v2.2.0) ─────────────────────────────────────────────
// Sekwencyjna kampania wiadomosci: auto-send przez LinkedIn DOM, multi-step,
// szablony [Imie], follow-upy w dniach, mutex z bulkConnect, dry-run gate.

const CAMPAIGN_ALARM_NAME = "campaignKeepAlive";
const CAMPAIGN_MSG_TIMEOUT_MS = 25000;

const CAMPAIGN_WORKER_DEFAULTS = {
  active: false,
  activeCampaignId: null,
  nextTickAt: null,
  lastTickAt: null,
  errorMsg: null,
  consecutiveFails: 0,
  sentToday: 0,
  lastResetDate: "",
};

async function getCampaignWorkerState() {
  const d = await chrome.storage.local.get("campaignWorker");
  return { ...CAMPAIGN_WORKER_DEFAULTS, ...(d.campaignWorker || {}) };
}

async function setCampaignWorkerState(patch) {
  const cur = await getCampaignWorkerState();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ campaignWorker: next });
  return next;
}

async function getCampaigns() {
  const d = await chrome.storage.local.get("campaigns");
  return Array.isArray(d.campaigns) ? d.campaigns : [];
}

async function saveCampaigns(list) {
  await chrome.storage.local.set({ campaigns: list });
}

async function getCampaignById(id) {
  const list = await getCampaigns();
  return list.find((c) => c.id === id) || null;
}

async function updateCampaignInList(updated) {
  const list = await getCampaigns();
  const idx = list.findIndex((c) => c.id === updated.id);
  if (idx < 0) return;
  list[idx] = updated;
  await saveCampaigns(list);
}

// Buduje wiadomosc z szablonu. Tokeny z Connections.csv:
// [Imie]/[Imię], [Nazwisko], [Firma], [Stanowisko]. Brak danych -> pusty string.
// Wstecznie kompatybilne: 2. arg moze byc obiektem kontaktu ALBO samym imieniem (string).
function buildCampaignMessage(template, contact) {
  const c = (contact && typeof contact === "object") ? contact : { firstName: contact };
  return (template || "")
    .replace(/\[Imi[eę]\]/gi, c.firstName || "")
    .replace(/\[Nazwisko\]/gi, c.lastName || "")
    .replace(/\[Firma\]/gi, c.company || "")
    .replace(/\[Stanowisko\]/gi, c.position || "");
}

// Rozwiazuje tekst wiadomosci dla (kontakt, krok). Priorytet: zapisana
// wiadomosc (np. wygenerowana AI) > szablon z podmiana [Imie].
function resolveCampaignMessage(contact, step) {
  const stored = ((contact && contact.steps) || {})[String(step && step.stepNum)] || {};
  if (stored.message && String(stored.message).trim()) return String(stored.message);
  return buildCampaignMessage((step && step.template) || "", contact);
}

// Krok w trybie AI bez gotowej wiadomosci => trzeba wygenerowac przed wyslaniem.
function campaignStepNeedsAi(contact, step) {
  if (!step || step.mode !== "ai") return false;
  const stored = ((contact && contact.steps) || {})[String(step.stepNum)] || {};
  return !(stored.message && String(stored.message).trim());
}

// Wola backend /api/campaign/generate dla listy kontaktow.
// Zwraca { success, messages } albo { success:false, error }.
async function generateCampaignMessages(campaign, contacts, step) {
  const settings = await getSettings();
  const apiKey = settings.apiKey;
  if (!apiKey) return { success: false, error: "no_api_key" };
  try { assertApiKeyHeaderSafe(apiKey); } catch (e) { return { success: false, error: e.message }; }
  const apiUrl = (settings.apiUrl || DEFAULT_SETTINGS.apiUrl).replace(/\/+$/, "");
  const brief = (campaign && campaign.brief) || {};
  const payload = {
    batch_id: "camp-" + (campaign && campaign.id) + "-s" + (step && step.stepNum) + "-" + Date.now(),
    contacts: (contacts || []).map((c) => ({
      contact_id: c.slug,
      first_name: c.firstName || "",
      headline: c.headline || "",
      profile_url: c.profileUrl || ("https://www.linkedin.com/in/" + c.slug + "/"),
      location: c.location || null,
      company: c.company || null,
    })),
    product_description: brief.productDescription || "",
    author_context: brief.authorContext || "",
    campaign_goal: brief.campaignGoal || "info",
  };
  if (brief.authorNote && brief.authorNote.trim()) payload.author_note = brief.authorNote.trim();
  let resp;
  try {
    resp = await fetch(apiUrl + "/api/campaign/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { success: false, error: "network_error: " + ((e && e.message) || e) };
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: "HTTP " + resp.status }));
    return { success: false, error: err.detail || ("HTTP " + resp.status), throttled: resp.status === 429 };
  }
  const data = await resp.json().catch(() => ({}));
  return { success: true, messages: data.messages || [] };
}

// Najblizszy gotowy krok DLA JEDNEGO kontaktu (zwraca stepNum) albo null.
function findContactNextStep(campaign, contact, nowMs) {
  if (!campaign || !Array.isArray(campaign.steps)) return null;
  if (!contact || contact.status === "replied" || contact.status === "done") return null;
  for (let si = 0; si < campaign.steps.length; si++) {
    const step = campaign.steps[si];
    const stepState = (contact.steps || {})[String(step.stepNum)] || { status: "pending" };
    if (stepState.status === "sent") continue;
    if (stepState.status === "failed") continue; // pominiety po failach — czekaj na reset
    if (si > 0) {
      const prevStep = campaign.steps[si - 1];
      const prevState = (contact.steps || {})[String(prevStep.stepNum)] || {};
      if (prevState.status !== "sent") break; // poprzedni jeszcze nie wyslany
      const delayMs = (step.delayDays || 0) * 24 * 60 * 60 * 1000;
      if ((prevState.sentAt || 0) + delayMs > nowMs) break; // za wczesnie na follow-up
    }
    if (stepState.status === "pending" || !stepState.status || stepState.status === "draft") {
      return step.stepNum;
    }
  }
  return null;
}

// Zwraca { contactIdx, stepNum } następnego do wysłania albo null.
function findNextCampaignStep(campaign, nowMs) {
  if (!campaign || !Array.isArray(campaign.contacts) || !Array.isArray(campaign.steps)) return null;
  for (let ci = 0; ci < campaign.contacts.length; ci++) {
    const stepNum = findContactNextStep(campaign, campaign.contacts[ci], nowMs);
    if (stepNum != null) return { contactIdx: ci, stepNum: stepNum };
  }
  return null;
}

/**
 * Otwiera background tab z messaging compose URL, injectuje content.js,
 * wywoluje sendLinkedInMessage, zamyka tab. Wzorzec jak probeProfileTab.
 */
async function probeMsgComposeTab(slug, msgText) {
  const url = `https://www.linkedin.com/messaging/thread/new/?recipients=${encodeURIComponent(slug)}`;
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabComplete(tab.id, 10000);
    // Dodatkowy delay na hydration SPA (messaging page to Ember SPA).
    await new Promise((r) => setTimeout(r, 2000));
    let lastErr = null;
    const deadline = Date.now() + CAMPAIGN_MSG_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      } catch (_) {}
      try {
        const resp = await Promise.race([
          chrome.tabs.sendMessage(tab.id, { action: "sendLinkedInMessage", text: msgText }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("msg_send_timeout")), 12000)),
        ]);
        if (resp && resp.success) return { success: true };
        if (resp && resp.error === "compose_form_not_found") {
          // Czekaj chwile i sprobuj ponownie — SPA moze jeszcze renderowac.
          await new Promise((r) => setTimeout(r, 1500));
          lastErr = resp.error;
          continue;
        }
        return resp || { success: false, error: "no_response" };
      } catch (err) {
        lastErr = (err && err.message) || String(err);
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    return { success: false, error: lastErr || "msg_compose_timeout" };
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (_) {}
    }
  }
}

async function resetCampaignDailyIfNeeded() {
  const state = await getCampaignWorkerState();
  const today = todayDateString();
  if (state.lastResetDate !== today) {
    await setCampaignWorkerState({ sentToday: 0, lastResetDate: today });
  }
}

async function campaignWorkerTick() {
  await resetCampaignDailyIfNeeded();
  const worker = await getCampaignWorkerState();
  if (!worker.active) return;

  if (!inWorkingHours({ workingHoursStart: 9, workingHoursEnd: 18 })) {
    await setCampaignWorkerState({
      active: false,
      errorMsg: "Poza godzinami pracy (9:00-18:00). Wznow recznie.",
      nextTickAt: null,
    });
    await chrome.alarms.clear(CAMPAIGN_ALARM_NAME);
    return;
  }

  const campaign = worker.activeCampaignId
    ? await getCampaignById(worker.activeCampaignId)
    : null;
  if (!campaign) {
    await setCampaignWorkerState({ active: false, errorMsg: "Nie znaleziono kampanii.", nextTickAt: null });
    await chrome.alarms.clear(CAMPAIGN_ALARM_NAME);
    return;
  }

  const cfg = campaign.config || {};
  const dailyCap = cfg.dailyCap || 20;
  if (worker.sentToday >= dailyCap) {
    await setCampaignWorkerState({
      active: false,
      errorMsg: `Dzienny limit osiagniety (${dailyCap}). Resetuje o polnocy.`,
      nextTickAt: null,
    });
    await chrome.alarms.clear(CAMPAIGN_ALARM_NAME);
    return;
  }

  const next = findNextCampaignStep(campaign, Date.now());
  if (!next) {
    await setCampaignWorkerState({ active: false, errorMsg: null, nextTickAt: null });
    await chrome.alarms.clear(CAMPAIGN_ALARM_NAME);
    return;
  }

  const contact = campaign.contacts[next.contactIdx];
  const stepDef = campaign.steps.find((s) => s.stepNum === next.stepNum);
  const stepKey = String(next.stepNum);

  // Krok AI bez gotowej wiadomosci -> wygeneruj teraz (1 call/tick, respektuje jitter/cap).
  let msgText = null;
  let response = null;
  if (campaignStepNeedsAi(contact, stepDef)) {
    const gen = await generateCampaignMessages(campaign, [contact], stepDef);
    if (gen.throttled) {
      // Dzienny limit AI po stronie backendu — czysta pauza (nie liczy sie do faili).
      await setCampaignWorkerState({ active: false, errorMsg: gen.error || "Dzienny limit AI wyczerpany. Wznów jutro.", nextTickAt: null });
      await chrome.alarms.clear(CAMPAIGN_ALARM_NAME);
      return;
    }
    const m = gen.success && gen.messages && gen.messages[0];
    if (m && m.status !== "error" && m.message) {
      msgText = m.message;
    } else {
      response = { success: false, error: "ai_generate_fail: " + (gen.error || (m && m.error) || "unknown") };
    }
  } else {
    msgText = resolveCampaignMessage(contact, stepDef);
  }

  if (response == null && msgText != null) {
    try {
      response = await Promise.race([
        probeMsgComposeTab(contact.slug, msgText),
        new Promise((_, rej) => setTimeout(() => rej(new Error("tick_timeout")), CAMPAIGN_MSG_TIMEOUT_MS + 15000)),
      ]);
    } catch (err) {
      response = { success: false, error: (err && err.message) || "tick_error" };
    }
  }

  const nowMs = Date.now();
  const updated = JSON.parse(JSON.stringify(campaign)); // deep copy
  const uc = updated.contacts[next.contactIdx];
  if (!uc.steps) uc.steps = {};

  const FAIL_STREAK = 3;
  let consecutiveFails = worker.consecutiveFails || 0;

  if (response && response.success) {
    uc.steps[stepKey] = { status: "sent", sentAt: nowMs, error: null, message: msgText };
    uc.status = "active";
    consecutiveFails = 0;
    await setCampaignWorkerState({ sentToday: worker.sentToday + 1, consecutiveFails: 0, lastTickAt: nowMs });
  } else {
    uc.steps[stepKey] = { status: "failed", sentAt: null, error: (response && response.error) || "unknown" };
    consecutiveFails += 1;
    await setCampaignWorkerState({ consecutiveFails, lastTickAt: nowMs });
    reportScrapeFailure({
      event_type: "campaign_send_fail",
      error_message: (response && response.error) || "unknown",
      diagnostics: { slug: contact.slug, stepNum: next.stepNum, campaignId: campaign.id },
    });
  }

  await updateCampaignInList(updated);

  if (consecutiveFails >= FAIL_STREAK) {
    await setCampaignWorkerState({
      active: false,
      consecutiveFails: 0,
      errorMsg: `${FAIL_STREAK} bledy z rzedu — kampania wstrzymana. Sprawdz polaczenie z LinkedIn.`,
      nextTickAt: null,
    });
    await chrome.alarms.clear(CAMPAIGN_ALARM_NAME);
    return;
  }

  const delayMin = cfg.delayMin || 45;
  const delayMax = cfg.delayMax || 120;
  const delay = (delayMin + Math.random() * (delayMax - delayMin)) * 1000;
  await setCampaignWorkerState({ nextTickAt: Date.now() + delay });
  setTimeout(campaignWorkerTick, delay);
}

async function startCampaignWorker(campaignId) {
  const bulk = await getBulkState();
  if (bulk.active) return { success: false, error: "bulk_connect_active" };
  const campaign = await getCampaignById(campaignId);
  if (!campaign) return { success: false, error: "campaign_not_found" };
  if ((campaign.config || {}).sendMode === "manual") return { success: false, error: "manual_mode" };
  const next = findNextCampaignStep(campaign, Date.now());
  if (!next) return { success: false, error: "no_pending_steps" };
  await setCampaignWorkerState({
    active: true,
    activeCampaignId: campaignId,
    errorMsg: null,
    consecutiveFails: 0,
    nextTickAt: Date.now() + 500,
    lastTickAt: null,
  });
  await chrome.alarms.create(CAMPAIGN_ALARM_NAME, { periodInMinutes: 0.4 });
  campaignWorkerTick();
  return { success: true };
}

async function stopCampaignWorker() {
  await setCampaignWorkerState({ active: false, errorMsg: null, nextTickAt: null });
  await chrome.alarms.clear(CAMPAIGN_ALARM_NAME);
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
  } else if (alarm.name === ACCEPT_CHECK_ALARM_NAME) {
    // #56A: alarm odpala co 60min; tick wewnętrznie sprawdza czy minął
    // nextScanAt + working hours + mutex. Realny scan tylko ~1× dziennie.
    acceptCheckTick({ force: false }).catch((e) =>
      console.warn("[LinkedIn MSG] acceptCheckTick fail:", e && e.message)
    );
  } else if (alarm.name === CAMPAIGN_ALARM_NAME) {
    // #74: keep-alive dla campaign worker — no-op, alarm budzi SW co 24s.
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

// v1.15.1: nagłówek X-API-Key musi być Latin-1-safe (fetch rzuca
// "non ISO-8859-1 code point" przy polskich literach / emoji / smart-quotes
// wciągniętych do "Hasła dostępu"). Czytelny błąd zamiast kryptycznego.
function assertApiKeyHeaderSafe(apiKey) {
  if (apiKey && /[^\x00-\xFF]/.test(apiKey)) {
    throw new Error('Hasło dostępu zawiera niedozwolony znak (polska litera / emoji / "inteligentny" cudzysłów). Otwórz Ustawienia i wpisz je ręcznie, używając tylko podstawowych znaków (np. DreamComeTrue!).');
  }
}

async function generateMessage(profile, options = {}) {
  const settings = await getSettings();
  assertApiKeyHeaderSafe(settings.apiKey);
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
  assertApiKeyHeaderSafe(settings.apiKey);
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
const DEFAULT_BACKUP_INTERVAL_DAYS = 1; // #68: 3 → 1 (sync z DEFAULT_SETTINGS)
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
  linkedin_export: 4, // oficjalny LinkedIn CSV-export (Connections.csv) — ta sama liga co
                      // connections_import, ale dostarcza więcej pól (Company/Position/Email).
                      // >= w mergeProfileRecord daje nowy import override gdy slug był w connections_import.
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

// #58 v1.25.0: wybór prospektów z bazy do kolejki connect. PURE helper
// (testowalny bez chrome — patrz test_profile_db.js). Odrzuca: brak rekordu,
// 1st-degree (isConnection = już połączony, nie ma czego "connectować"),
// już w kolejce. Dedup po slug. Reszta → kandydaci {slug,name,headline}.
function selectEnqueueCandidates(profiles, slugs, queueSlugs) {
  const reasons = { not_found: 0, is_connection: 0, already_in_queue: 0 };
  const toAdd = [];
  const qs = queueSlugs instanceof Set ? queueSlugs : new Set(queueSlugs || []);
  const seen = new Set();
  for (const slug of (slugs || [])) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const r = profiles && profiles[slug];
    if (!r) { reasons.not_found += 1; continue; }
    if (r.isConnection) { reasons.is_connection += 1; continue; }
    if (qs.has(slug)) { reasons.already_in_queue += 1; continue; }
    toAdd.push({ slug: r.slug, name: r.name || "", headline: r.headline || "" });
  }
  return { toAdd, reasons };
}

// Dodaj zaznaczone prospekty z dashboardu do kolejki connect (#58 v1.25.0).
// Worker bulkConnectTick odpali connectFromProfile per slug (drip dailyCap).
async function profileDbEnqueueForConnect(slugs) {
  const db = await getProfileDb();
  const state = await getBulkState();
  const queueSlugs = new Set((state.queue || []).map((q) => q.slug));
  const { toAdd, reasons } = selectEnqueueCandidates(db.profiles, slugs, queueSlugs);
  let added = 0;
  if (toAdd.length) {
    const resp = await addToQueue(toAdd);
    added = resp.added != null ? resp.added : toAdd.length;
  }
  const after = await getBulkState();
  return {
    success: true,
    added,
    skipped: (Array.isArray(slugs) ? slugs.length : 0) - added,
    reasons,
    queueSize: (after.queue || []).length,
  };
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

  // Pagination (#54 v1.21.0) — bez limit zwracamy pełną listę (backwards compat
  // dla buildProfileDbCsv / buildFullBackupJson). UI dashboardu zawsze podaje
  // limit + offset zeby nie renderować 16k+ wierszy naraz (browser muli).
  const filteredTotal = list.length;
  const limit = (typeof filter.limit === "number" && filter.limit > 0) ? filter.limit : null;
  const offset = (typeof filter.offset === "number" && filter.offset > 0) ? filter.offset : 0;
  const paged = limit ? list.slice(offset, offset + limit) : list;

  return {
    success: true,
    list: paged,
    counts: { total: Object.keys(db.profiles).length, connections: connectionsCount, inQueue: inQueueCount, filtered: filteredTotal },
    page: limit ? { limit, offset, filteredTotal } : null,
  };
}

/**
 * Usuwa rekordy z profileDb. Tryby:
 *  - slugs: ["a","b",...] — usun konkretne
 *  - deleteAllFiltered: true + filter — bg sam filtruje pelna baze po (text,
 *    source, isConnection) i usuwa pasujace. Uzywane do batch-cleanupu
 *    (np. wszystkie z source="connections_import" gdy stary scroll-import
 *    zasmiecil baze).
 * Zwraca {success, deleted, total}.
 */
async function profileDbDelete({ slugs, deleteAllFiltered, filter }) {
  const db = await getProfileDb();
  // #68: snapshot bezpieczeństwa przed masowym kasowaniem — pomyłka w
  // filtrze "usuń wszystkie przefiltrowane" jest nieodwracalna bez kopii.
  const bulkDeletion = deleteAllFiltered === true || (Array.isArray(slugs) && slugs.length > 20);
  if (bulkDeletion) {
    try { await doAutoBackup(true, "pre-delete"); } catch (_) { /* kopia best-effort */ }
  }
  let toDelete = [];
  if (deleteAllFiltered === true) {
    const text = ((filter && filter.text) || "").trim().toLowerCase();
    const wantSource = (filter && filter.source) || "";
    const wantConn = (filter && filter.isConnection) || "";
    for (const slug of Object.keys(db.profiles)) {
      const r = db.profiles[slug];
      if (text) {
        const hay = `${r.name || ""} ${r.headline || ""} ${r.slug || ""}`.toLowerCase();
        if (!hay.includes(text)) continue;
      }
      if (wantSource && r.source !== wantSource) continue;
      if (wantConn === "yes" && !r.isConnection) continue;
      if (wantConn === "no" && r.isConnection) continue;
      toDelete.push(slug);
    }
  } else if (Array.isArray(slugs) && slugs.length) {
    toDelete = slugs.filter((s) => typeof s === "string" && db.profiles[s]);
  } else {
    return { success: false, error: "no_target" };
  }

  for (const slug of toDelete) delete db.profiles[slug];
  await writeProfileDb(db);
  return { success: true, deleted: toDelete.length, total: Object.keys(db.profiles).length };
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
  // #68: settings W backupie — bez nich Remove+Add przywracał bazę, ale user
  // tracił hasło dostępu/ofertę/cele i widział "nie działa". Plik ląduje
  // lokalnie na dysku usera; hasło dostępu to współdzielony sekret zespołowy.
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    extVersion: chrome.runtime.getManifest().version,
    settings: await getSettings(),
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

async function doAutoBackup(force, tag) {
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
    // #68: settings w snapshotcie (hasło dostępu, oferta, cele) — patrz
    // buildFullBackupJson.
    settings: await getSettings(),
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
  // #68: tag odróżnia snapshoty bezpieczeństwa (pre-import / pre-delete /
  // pre-clear) od regularnych dziennych — nie nadpisują się wzajemnie.
  const today = todayDateString();
  const safeTag = tag ? `-${String(tag).replace(/[^a-z0-9-]/gi, "")}` : "";
  const filename = `linkedin-msg-backup/backup-${today}${safeTag}${lite ? "-lite" : ""}.json`;
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
// ── LinkedIn data export (Connections.csv) — parser i mapper ──────────
//
// Format (potwierdzone empirycznie 2026-05-16 z 17008-wierszowego dumpu):
//   linia 1: "Notes:"
//   linia 2: cytowany abstract w cudzysłowach (jedna logiczna linia)
//   linia 3: pusta
//   linia 4: nagłówek `First Name,Last Name,URL,Email Address,Company,Position,Connected On`
//   linie 5+: dane, RFC4180-compliant quoting + doubled-quote escape (`""`).
// Defensywnie obsługujemy BOM. Daty: format EN "DD Mon YYYY" (priorytet) + PL fallback.
// Email puste u ~96.8% (~0.5% to `urn:li:member:<id>` — wewnętrzny URN, MUSIMY blokować).

const LINKEDIN_EXPORT_HEADER_PREFIX = "First Name,Last Name,URL,";

const LINKEDIN_MONTH_MAP = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  sty: 1, lut: 2, kwi: 4, maj: 5, cze: 6,
  lip: 7, sie: 8, wrz: 9, paz: 10, "paź": 10, lis: 11, gru: 12,
};

function parseLinkedInDate(str) {
  if (!str || typeof str !== "string") return null;
  const m = String(str).trim().match(/^(\d{1,2})\s+([A-Za-zżźćńółęąśŻŹĆŃÓŁĘĄŚ]+)\s+(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = LINKEDIN_MONTH_MAP[m[2].toLowerCase().slice(0, 3)];
  const year = parseInt(m[3], 10);
  if (!mon || !day || day < 1 || day > 31 || !year) return null;
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValidEmailFromCsv(raw) {
  if (!raw || typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s) return false;
  if (s.toLowerCase().startsWith("urn:")) return false;
  return /@[^@\s]+\.[^@\s]+$/.test(s);
}

function stripBom(text) {
  if (typeof text !== "string") return "";
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function extractLinkedInExportRows(text) {
  const clean = stripBom(text || "");
  const lower = clean.toLowerCase();
  const idx = lower.indexOf(LINKEDIN_EXPORT_HEADER_PREFIX.toLowerCase());
  if (idx === -1) return { rows: [], error: "header_not_found" };
  return { rows: parseCsv(clean.slice(idx)), error: null };
}

function mapLinkedInExportRow(row, opts) {
  if (!row || typeof row !== "object") return null;
  const asProspects = !!(opts && opts.asProspects);
  const get = (k) => {
    if (row[k] != null) return String(row[k]).trim();
    const target = k.toLowerCase();
    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === target) return String(row[key]).trim();
    }
    return "";
  };
  const first = get("First Name");
  const last = get("Last Name");
  const url = get("URL");
  const emailRaw = get("Email Address");
  const company = get("Company");
  const position = get("Position");
  const connectedRaw = get("Connected On");

  let slug = url ? extractSlugFromUrl(url) : null;
  if (slug) {
    try { slug = decodeURIComponent(slug).toLowerCase(); } catch (_) { slug = String(slug).toLowerCase(); }
  }
  if (!slug) return null;

  // #60 v1.25.2: asProspects=true → traktuj jako 2nd/3rd (prospekty do connectu).
  // Domyślnie (asProspects=false) — backwards compat: zachowanie sprzed v1.25.2.
  // connectedOn pomijamy dla prospektów — z definicji nie jesteśmy z nimi
  // w sieci, więc data połączenia nie ma sensu.
  return {
    slug,
    name: `${first} ${last}`.trim() || null,
    headline: position || null,
    company: company || null,
    profile_url: `https://www.linkedin.com/in/${slug}/`,
    isConnection: !asProspects,
    connectedOn: asProspects ? null : parseLinkedInDate(connectedRaw),
    contactInfo: isValidEmailFromCsv(emailRaw) ? { email: emailRaw.trim() } : null,
  };
}

async function profileDbImportLinkedInExport({ csvText, dryRun, asProspects }) {
  if (typeof csvText !== "string" || !csvText.trim()) {
    return { success: false, error: "empty_input" };
  }
  const { rows, error } = extractLinkedInExportRows(csvText);
  if (error) return { success: false, error };
  if (!rows.length) return { success: false, error: "no_data_rows" };

  const asProspectsFlag = !!asProspects;
  let skippedNoSlug = 0, parseErrors = 0, urnEmailsBlocked = 0;
  const mapped = [];
  for (const row of rows) {
    try {
      const rawEmail = (row && (row["Email Address"] || row["email address"] || "")) || "";
      if (rawEmail && rawEmail.trim().toLowerCase().startsWith("urn:")) urnEmailsBlocked += 1;
      const rec = mapLinkedInExportRow(row, { asProspects: asProspectsFlag });
      if (!rec) { skippedNoSlug += 1; continue; }
      mapped.push(rec);
    } catch (_) { parseErrors += 1; }
  }

  const db = await getProfileDb();
  let willNew = 0, willMerged = 0;
  for (const rec of mapped) {
    if (db.profiles[rec.slug]) willMerged += 1; else willNew += 1;
  }

  if (dryRun) {
    return {
      success: true, dryRun: true,
      newSlugs: willNew, mergedSlugs: willMerged,
      skippedNoSlug, parseErrors, urnEmailsBlocked,
      total: mapped.length,
    };
  }

  const now = Date.now();
  let added = 0, updated = 0;
  for (const rec of mapped) {
    const baseRec = profileRecordFromInput(rec, "linkedin_export", now);
    if (!baseRec) continue;
    if (rec.contactInfo) baseRec.contactInfo = rec.contactInfo;
    if (rec.connectedOn) baseRec.connectedOn = rec.connectedOn;
    if (rec.company) baseRec.company = rec.company;
    if (db.profiles[baseRec.slug]) {
      const prev = db.profiles[baseRec.slug];
      const merged = mergeProfileRecord(prev, baseRec);
      const prevContact = prev.contactInfo || null;
      if (rec.contactInfo && rec.contactInfo.email) {
        merged.contactInfo = {
          ...(prevContact || {}),
          email: prevContact && prevContact.email ? prevContact.email : rec.contactInfo.email,
        };
      } else if (prevContact) {
        merged.contactInfo = prevContact;
      }
      if (rec.connectedOn && !prev.connectedOn) merged.connectedOn = rec.connectedOn;
      if (rec.company && !prev.company) merged.company = rec.company;
      db.profiles[baseRec.slug] = merged;
      updated += 1;
    } else {
      db.profiles[baseRec.slug] = baseRec;
      added += 1;
    }
  }
  await writeProfileDb(db);

  return {
    success: true,
    newSlugs: added, mergedSlugs: updated,
    skippedNoSlug, parseErrors, urnEmailsBlocked,
    total: Object.keys(db.profiles).length,
  };
}

async function profileDbImport({ json, csv, restoreQueue }) {
  let recordsInput = [];
  let bulkPayload = null;
  let settingsPayload = null;

  // #68: snapshot bezpieczeństwa PRZED importem — import merguje (nie kasuje),
  // ale błędny plik może zaśmiecić bazę tysiącami rekordów. Fire-and-forget.
  doAutoBackup(true, "pre-import").catch(() => {});

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
      settingsPayload = parsed.settings || null; // #68: pełny backup niesie settings
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

  // #68: przywróć ustawienia z pełnego backupu — intencja importu backupu to
  // "odzyskaj moje dane", a bez hasła dostępu/oferty extension "nie działa".
  // Merge defensywny: backup nadpisuje tylko tam, gdzie niesie NIEpustą
  // wartość (świeżo wpisanych lokalnych wartości nie kasujemy pustkami).
  let settingsRestored = false;
  if (settingsPayload && typeof settingsPayload === "object") {
    const cur = await getSettings();
    const merged = { ...cur };
    for (const [k, v] of Object.entries(settingsPayload)) {
      if (v === null || v === undefined || v === "") continue;
      merged[k] = v;
    }
    await saveSettings(merged);
    settingsRestored = true;
  }

  return { success: true, added, updated, total: Object.keys(db.profiles).length, queueRestored, settingsRestored };
}

// ── Import kontaktów 1st-degree z LinkedIn ────────────────────────────
//
// Otwiera (lub reusuje) kartę /mynetwork/invite-connect/connections/,
// content.js robi infinite-scroll + extractConnectionsList, wynik upsertujemy
// jako source="connections_import" z isConnection=true. Karta otwierana
// active:true bo infinite-scroll wymaga layoutu/IntersectionObserver'a.

const CONNECTIONS_TAB_URL = "https://www.linkedin.com/mynetwork/invite-connect/connections/";
const IMPORT_CONNECTIONS_TIMEOUT_MS = 6 * 60 * 1000; // generous — scroll może trwać

// Pure: klasyfikuje wynik importu kontaktow pod early-warning (#62 reliability).
// scraped=0 -> "extract_empty"; >50% rekordow bez imienia -> "extract_degraded";
// inaczej null. Wyodrebnione zeby bylo testowalne bez chrome.* (test_import_warning).
function classifyImportResult(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  const scraped = list.length;
  const named = list.filter((p) => p && p.name && String(p.name).trim()).length;
  let warning = null;
  if (scraped === 0) warning = "extract_empty";
  else if ((scraped - named) / scraped > 0.5) warning = "extract_degraded";
  return { scraped, named, warning };
}

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
    // Early-warning (#62): 0 kontaktow albo >50% bez imienia = prawdopodobnie
    // LinkedIn przerollowal layout /connections/. Telemetria na backend +
    // flaga `warning` dla UI (glosny komunikat zamiast cichego "Zaimportowano 0").
    const { scraped, named, warning } = classifyImportResult(profiles);
    if (warning) {
      reportScrapeFailure({
        url: CONNECTIONS_TAB_URL,
        event_type: warning === "extract_empty" ? "connections_extract_empty" : "connections_extract_degraded",
        error_message: "scraped=" + scraped + " named=" + named,
        diagnostics: { scraped, named, pagesProcessed: resp.pagesProcessed || 0 },
      }).catch(() => {});
    }
    return { success: true, ...up, pagesProcessed: resp.pagesProcessed || 0, hitCap: !!resp.hitCap, scraped, named, warning };
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

        case "bulkConnectRetryFailed":
          return await bulkConnectRetryFailed();

        case "bulkConnectDiagnose":
          return await bulkConnectDiagnose(message.slug || null);

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

        // #56A v1.23.0 — auto accept-tracker
        case "acceptCheckGetState":
          return { success: true, state: await getAcceptCheckState() };
        case "acceptCheckRunNow":
          return await acceptCheckTick({ force: true });
        case "acceptCheckEnable":
          return { success: true, state: await setAcceptCheckState({ enabled: true, failCount: 0, lastError: null, disabledBy: null }) };
        case "acceptCheckDisable":
          // #67: user wyłączył ręcznie — update extensionu tego NIE cofa.
          return { success: true, state: await setAcceptCheckState({ enabled: false, disabledBy: "user" }) };

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

        case "followupMarkNoConsent":
          return await bulkMarkNoConsent(message.slug);

        case "followupDefer":
          return await bulkDeferFollowup(message.slug, message.days);

        case "followupVoidSet":
          return await voidScheduledFollowupSet(message.slug, message.followupIdToCancel);

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
        case "profileDbImportLinkedInExport":
          return await profileDbImportLinkedInExport({ csvText: message.csvText, dryRun: !!message.dryRun, asProspects: !!message.asProspects });
        case "profileDbDelete":
          return await profileDbDelete({ slugs: message.slugs, deleteAllFiltered: !!message.deleteAllFiltered, filter: message.filter });
        case "profileDbEnqueueForConnect":
          return await profileDbEnqueueForConnect(message.slugs || []);
        case "importConnections":
          return await importConnectionsFlow(message.maxPages);

        // ── Campaign (#74) ────────────────────────────────────
        case "campaignScrapeConnections": {
          const db = await getProfileDb();
          const contacts = Object.values(db.profiles || {})
            .filter((p) => p && p.slug)
            .map((p) => {
              const fullName = (p.name || "").trim();
              const firstName =
                fullName.split(" ")[0] ||
                fullName ||
                (p.slug || "").split("-")[0] ||
                p.slug;
              return {
                contact_id: p.slug,
                first_name: firstName,
                headline: p.headline || "",
                profile_url: p.profileUrl || `https://www.linkedin.com/in/${p.slug}/`,
                location: p.location || null,
                company: p.company || null,
              };
            });
          return { success: true, contacts };
        }
        case "getCampaigns":
          return { success: true, campaigns: await getCampaigns() };
        case "getCampaignWorkerState":
          return { success: true, worker: await getCampaignWorkerState() };
        case "createCampaign": {
          const list = await getCampaigns();
          const camp = {
            id: "camp-" + Date.now(),
            name: message.name || "Kampania",
            createdAt: Date.now(),
            brief: message.brief || null,
            steps: message.steps || [],
            config: message.config || {},
            contacts: message.contacts || [],
          };
          list.push(camp);
          await saveCampaigns(list);
          return { success: true, campaign: camp };
        }
        case "updateCampaign": {
          const list2 = await getCampaigns();
          const idx = list2.findIndex((c) => c.id === message.campaign.id);
          if (idx < 0) return { success: false, error: "not_found" };
          list2[idx] = message.campaign;
          await saveCampaigns(list2);
          return { success: true };
        }
        case "deleteCampaign": {
          const filtered = (await getCampaigns()).filter((c) => c.id !== message.id);
          await saveCampaigns(filtered);
          return { success: true };
        }
        case "campaignWorkerStart":
          return await startCampaignWorker(message.campaignId);
        case "campaignWorkerStop":
          return await stopCampaignWorker();
        case "campaignMarkReplied": {
          const camp2 = await getCampaignById(message.campaignId);
          if (!camp2) return { success: false, error: "not_found" };
          const ci = camp2.contacts.findIndex((c) => c.slug === message.slug);
          if (ci < 0) return { success: false, error: "contact_not_found" };
          camp2.contacts[ci].repliedAt = Date.now();
          camp2.contacts[ci].status = "replied";
          await updateCampaignInList(camp2);
          return { success: true };
        }
        case "campaignDryRun": {
          const camp3 = await getCampaignById(message.campaignId);
          if (!camp3) return { success: false, error: "not_found" };
          const step = (camp3.steps || [])[0] || {};
          const sample = (camp3.contacts || []).slice(0, 3);
          if (step.mode === "ai") {
            const gen = await generateCampaignMessages(camp3, sample, step);
            if (!gen.success) return { success: false, error: gen.error };
            const byId = {};
            (gen.messages || []).forEach((m) => { byId[m.contact_id] = m; });
            const previewAi = sample.map((contact) => ({
              slug: contact.slug,
              firstName: contact.firstName,
              message: (byId[contact.slug] && byId[contact.slug].message) || "(AI nie zwrocilo tresci)",
              stepNum: step.stepNum || 1,
            }));
            return { success: true, preview: previewAi };
          }
          const preview = sample.map((contact) => ({
            slug: contact.slug,
            firstName: contact.firstName,
            message: resolveCampaignMessage(contact, step),
            stepNum: step.stepNum || 1,
          }));
          return { success: true, preview };
        }
        case "campaignGenerateBatch": {
          const cg = await getCampaignById(message.campaignId);
          if (!cg) return { success: false, error: "not_found" };
          const limit = Math.max(1, Math.min(parseInt(message.count, 10) || 25, 100));
          const now = Date.now();
          const dueByStep = {};
          let total = 0;
          for (let ci = 0; ci < cg.contacts.length && total < limit; ci++) {
            const sn = findContactNextStep(cg, cg.contacts[ci], now);
            if (sn == null) continue;
            (dueByStep[String(sn)] = dueByStep[String(sn)] || []).push(ci);
            total++;
          }
          if (!total) return { success: true, generated: [] };
          const upd = JSON.parse(JSON.stringify(cg));
          const out = [];
          for (const sn of Object.keys(dueByStep)) {
            const step = cg.steps.find((s) => String(s.stepNum) === sn) || {};
            const idxs = dueByStep[sn];
            let resolved = {};
            if (step.mode === "ai") {
              const gen = await generateCampaignMessages(cg, idxs.map((ci) => cg.contacts[ci]), step);
              if (!gen.success) return { success: false, error: gen.error };
              (gen.messages || []).forEach((m) => { if (m.status !== "error" && m.message) resolved[m.contact_id] = m.message; });
            }
            idxs.forEach((ci) => {
              const c = cg.contacts[ci];
              const txt = step.mode === "ai" ? (resolved[c.slug] || "") : resolveCampaignMessage(c, step);
              if (!txt) return;
              if (!upd.contacts[ci].steps) upd.contacts[ci].steps = {};
              upd.contacts[ci].steps[sn] = Object.assign({}, upd.contacts[ci].steps[sn] || {}, { status: "draft", message: txt });
              out.push({ slug: c.slug, firstName: c.firstName, stepNum: Number(sn), message: txt });
            });
          }
          await updateCampaignInList(upd);
          return { success: true, generated: out };
        }
        case "campaignMarkStepSent": {
          const cm = await getCampaignById(message.campaignId);
          if (!cm) return { success: false, error: "not_found" };
          const cidx = cm.contacts.findIndex((c) => c.slug === message.slug);
          if (cidx < 0) return { success: false, error: "contact_not_found" };
          const sk = String(message.stepNum);
          if (!cm.contacts[cidx].steps) cm.contacts[cidx].steps = {};
          cm.contacts[cidx].steps[sk] = Object.assign({}, cm.contacts[cidx].steps[sk] || {}, { status: "sent", sentAt: Date.now() });
          cm.contacts[cidx].status = "active";
          await updateCampaignInList(cm);
          return { success: true };
        }
        case "campaignRegenerateOne": {
          const cr = await getCampaignById(message.campaignId);
          if (!cr) return { success: false, error: "not_found" };
          const rci = cr.contacts.findIndex((c) => c.slug === message.slug);
          if (rci < 0) return { success: false, error: "contact_not_found" };
          const rstep = cr.steps.find((s) => String(s.stepNum) === String(message.stepNum));
          if (!rstep) return { success: false, error: "step_not_found" };
          let rtext;
          if (rstep.mode === "ai") {
            const rgen = await generateCampaignMessages(cr, [cr.contacts[rci]], rstep);
            if (!rgen.success) return { success: false, error: rgen.error };
            const rm = (rgen.messages || [])[0];
            if (!rm || rm.status === "error" || !rm.message) return { success: false, error: (rm && rm.error) || "empty" };
            rtext = rm.message;
          } else {
            rtext = resolveCampaignMessage(cr.contacts[rci], rstep);
          }
          const rsk = String(message.stepNum);
          if (!cr.contacts[rci].steps) cr.contacts[rci].steps = {};
          cr.contacts[rci].steps[rsk] = Object.assign({}, cr.contacts[rci].steps[rsk] || {}, { status: "draft", message: rtext });
          await updateCampaignInList(cr);
          return { success: true, message: rtext };
        }
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
  // #67: accept-tracker wyłączony AUTOMATYCZNIE (3 faile, np. rollout DOM
  // zepsuł parser) wstaje przy update — nowa wersja zwykle ZAWIERA fix
  // parsera, a bez tego tracker zostawał martwy na zawsze (scenariusz #61:
  // SDUI rollout → 3 faile → cichy disable u wszystkich → fix wydany →
  // tracker dalej wyłączony). Ręczny disable (disabledBy:"user") szanujemy.
  // BC: stany sprzed #67 nie mają disabledBy — failCount>=limit ⇒ auto.
  try {
    const ac = await getAcceptCheckState();
    if (shouldReenableAcceptTracker(ac, ACCEPT_CHECK_FAIL_LIMIT)) {
      await setAcceptCheckState({ enabled: true, failCount: 0, lastError: null, disabledBy: null, nextScanAt: null });
      console.log("[LinkedIn MSG] accept-tracker re-enabled po update (był auto-disabled)");
    }
  } catch (_) { /* defensive — brak stanu = nic do roboty */ }
  // #25: alarm reset niezależnie od reason — install/update/chrome_update.
  await chrome.alarms.create(FOLLOWUP_ALARM_NAME, { periodInMinutes: 360 });
  // #45 v1.14.0: alarm auto-backupu — sprawdza co 12h czy minął interwał.
  await chrome.alarms.create(DB_BACKUP_ALARM_NAME, { periodInMinutes: 720 });
  // #56A v1.23.0: auto accept-tracker. Alarm co 60min; tick wewnętrznie
  // decyduje czy odpalić scan (period 24h + jitter, godziny 9-18, mutex).
  await chrome.alarms.create(ACCEPT_CHECK_ALARM_NAME, { periodInMinutes: 60 });
  await updateFollowupBadge();
});

// SW może się obudzić bez onInstalled (np. po idle kill). Re-create alarm
// + recompute badge na każdy start żeby badge był aktualny.
chrome.runtime.onStartup.addListener(async () => {
  await migrateSlugEncoding();
  await chrome.alarms.create(FOLLOWUP_ALARM_NAME, { periodInMinutes: 360 });
  await chrome.alarms.create(DB_BACKUP_ALARM_NAME, { periodInMinutes: 720 });
  // #56A v1.23.0: auto accept-tracker. Alarm co 60min; tick wewnętrznie
  // decyduje czy odpalić scan (period 24h + jitter, godziny 9-18, mutex).
  await chrome.alarms.create(ACCEPT_CHECK_ALARM_NAME, { periodInMinutes: 60 });
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
