/**
 * Popup Controller
 * 
 * Handles UI state, communicates with content script (scrape)
 * and background worker (API calls, settings).
 */

(() => {
  "use strict";

  // ── DOM refs ─────────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const statusBar = $("#status-bar");
  const statusText = $("#status-text");
  const profilePreview = $("#profile-preview");
  const profileName = $("#profile-name");
  const profileHeadline = $("#profile-headline");
  const profileMeta = $("#profile-meta");
  const selectGoal = $("#select-goal");
  const selectLang = $("#select-lang");
  const inputTone = $("#input-tone");
  const btnScrape = $("#btn-scrape");
  const btnGenerate = $("#btn-generate");
  const resultArea = $("#result-area");
  const resultText = $("#result-text");
  const resultMeta = $("#result-meta");
  const btnCopy = $("#btn-copy");
  const btnRegenerate = $("#btn-regenerate");
  const errorArea = $("#error-area");
  const errorText = $("#error-text");
  const btnSettings = $("#btn-settings");
  const viewMain = $("#view-main");
  const viewSettings = $("#view-settings");
  const setApiUrl = $("#set-api-url");
  const setApiKey = $("#set-api-key");
  const setSender = $("#set-sender");
  const setMaxChars = $("#set-max-chars");
  const btnSaveSettings = $("#btn-save-settings");
  const btnBack = $("#btn-back");
  // Bulk Connect (#18) refs
  const bulkConnect = $("#bulk-connect");
  const bulkInfo = $("#bulk-info");
  const profilesList = $("#profiles-list");
  const btnRefreshList = $("#btn-refresh-list");
  // Bulk queue (#19) refs
  const btnAddQueue = $("#btn-add-queue");
  const bulkAddRow = $("#bulk-add-row");
  const btnBulkFill = $("#btn-bulk-fill");
  const bulkStatus = $("#bulk-status");
  const bulkCountdown = $("#bulk-countdown");
  const queueSection = $("#queue-section");
  const queueList = $("#queue-list");
  const bulkProgress = $("#bulk-progress");
  const btnBulkStart = $("#btn-bulk-start");
  const btnBulkStop = $("#btn-bulk-stop");
  const btnBulkResume = $("#btn-bulk-resume");
  const btnBulkClear = $("#btn-bulk-clear");
  const bulkError = $("#bulk-error");
  const bulkSettings = $("#bulk-settings");
  const setBulkDelayMin = $("#set-bulk-delaymin");
  const setBulkDelayMax = $("#set-bulk-delaymax");
  const setBulkCap = $("#set-bulk-cap");
  const setBulkHStart = $("#set-bulk-hstart");
  const setBulkHEnd = $("#set-bulk-hend");
  const btnBulkSaveSettings = $("#btn-bulk-save-settings");
  // Message pipeline (#21) refs
  const messagePipeline = $("#message-pipeline");
  const messagePipelineCount = $("#message-pipeline-count");
  const messagePipelineStatus = $("#message-pipeline-status");
  const btnCheckAccepts = $("#btn-check-accepts");
  const btnGenerateAllMsg = $("#btn-generate-all-msg");
  const messageList = $("#message-list");
  // Follow-up (#25) refs
  const followupSection = $("#followup-section");
  const followupCountBadge = $("#followup-count-badge");
  const followupList = $("#followup-list");

  // ── State ────────────────────────────────────────────────────────
  let currentProfile = null;
  let currentMessage = null;
  let currentGenTime = null;

  // ── Session persistence ──────────────────────────────────────────

  async function saveSession() {
    const lastSession = {
      profile: currentProfile,
      message: currentMessage,
      genTime: currentGenTime,
      goal: selectGoal.value,
      language: selectLang.value,
      tone: inputTone.value || "",
      savedAt: Date.now(),
    };
    try {
      await chrome.storage.local.set({ lastSession });
    } catch (e) {
      // Ignore storage errors — non-critical
    }
  }

  async function loadSession() {
    try {
      const data = await chrome.storage.local.get("lastSession");
      return data.lastSession || null;
    } catch {
      return null;
    }
  }

  // ── UI Helpers ───────────────────────────────────────────────────

  function setStatus(text, type = "idle") {
    statusText.textContent = text;
    statusBar.className = `status-bar status-bar--${type}`;
  }

  function showError(msg) {
    errorText.textContent = msg;
    errorArea.classList.remove("hidden");
    setStatus("Błąd", "error");
  }

  function hideError() {
    errorArea.classList.add("hidden");
  }

  function setLoading(btn, loading) {
    if (loading) {
      btn.classList.add("btn--loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("btn--loading");
      btn.disabled = false;
    }
  }

  function showProfile(profile) {
    profileName.textContent = profile.name || "—";
    profileHeadline.textContent = profile.headline || "—";

    const metaParts = [];
    if (profile.company) metaParts.push(profile.company);
    if (profile.location) metaParts.push(profile.location);
    if (profile.experience?.length) metaParts.push(`${profile.experience.length} dośw.`);
    if (profile.skills?.length) metaParts.push(`${profile.skills.length} umiej.`);
    if (profile.education?.length) metaParts.push(`${profile.education.length} wykszт.`);
    if (profile.featured?.length) metaParts.push(`${profile.featured.length} featured`);
    if (profile.mutual_connections) metaParts.push(profile.mutual_connections);
    if (profile.follower_count) metaParts.push(profile.follower_count);
    if (profile.recent_activity?.length) metaParts.push(`${profile.recent_activity.length} post.`);
    if (profile._source) metaParts.push(`[${profile._source}]`);
    profileMeta.textContent = metaParts.join(" · ") || "Minimalny profil";

    // Show about preview so user can verify it was scraped
    let aboutEl = profilePreview.querySelector(".profile-card__about");
    if (profile.about) {
      if (!aboutEl) {
        aboutEl = document.createElement("div");
        aboutEl.className = "profile-card__about";
        profilePreview.appendChild(aboutEl);
      }
      const preview = profile.about.length > 120
        ? profile.about.slice(0, 120) + "…"
        : profile.about;
      aboutEl.textContent = `O mnie: ${preview}`;
    } else if (aboutEl) {
      aboutEl.textContent = "O mnie: (brak)";
    }

    profilePreview.classList.remove("hidden");
  }

  function showResult(message, timeSec) {
    resultText.value = message;
    resultText.readOnly = false; // Let user edit
    resultMeta.textContent = `${timeSec}s · ${message.length} znaków`;
    resultArea.classList.remove("hidden");
  }

  /**
   * Reset profile-related UI and state to a "no profile loaded" baseline.
   * Hides profile preview + result area, clears in-memory caches, disables
   * Generuj. Does NOT touch errorArea, statusBar, or user preferences
   * (goal/lang/tone) — those are deliberately preserved across resets.
   *
   * Used in two places (#3): (1) failed scrape, (2) popup init when the
   * active tab's profile slug doesn't match the cached one.
   */
  function resetProfileUI() {
    profilePreview.classList.add("hidden");
    resultArea.classList.add("hidden");
    currentProfile = null;
    currentMessage = null;
    currentGenTime = null;
    btnGenerate.disabled = true;
  }

  /**
   * Extract the canonical /in/<slug> identifier from a LinkedIn profile URL.
   * Returns lowercase slug with trailing slash stripped, or null when the URL
   * isn't a profile page. Used to compare cached profile vs active tab (#3).
   */
  function extractSlugFromUrl(url) {
    if (!url || typeof url !== "string") return null;
    const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  // ── Content Script Communication ─────────────────────────────────

  async function scrapeCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes("linkedin.com/in/")) {
      throw new Error("Otwórz profil na LinkedIn (linkedin.com/in/...)");
    }

    // Capture the slug we EXPECT scrape to return data for. If LinkedIn
    // SPA-navigates between request and response, the content script may
    // scrape a different profile than what's currently active — we'll
    // reject the response and ask the user to refresh (#7).
    const expectedSlug = extractSlugFromUrl(tab.url);

    // Inject content script if not already there
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (e) {
      // Already injected or no permission — try sending anyway
    }

    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: "scrapeProfile" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(
            "Nie mogę połączyć się ze stroną. Odśwież stronę LinkedIn i spróbuj ponownie."
          ));
          return;
        }
        if (!response) {
          reject(new Error("Brak odpowiedzi z content scriptu."));
          return;
        }
        if (!response.success) {
          reject(new Error(response.error || "Nie udało się pobrać profilu."));
          return;
        }
        // Slug validation (#7): scrape must return data for the slug we
        // started on. Mismatch indicates the content script saw a different
        // URL by the time it ran — possible during fast SPA navigation.
        const returnedSlug = extractSlugFromUrl(response.profile?.profile_url);
        if (expectedSlug && returnedSlug && expectedSlug !== returnedSlug) {
          reject(new Error(
            "Scraper zwrócił dane innego profilu — odśwież stronę i spróbuj ponownie."
          ));
          return;
        }
        resolve(response.profile);
      });
    });
  }

  // ── Background Communication ─────────────────────────────────────

  function sendToBackground(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  // ── Event Handlers ───────────────────────────────────────────────

  // Scrape profile
  btnScrape.addEventListener("click", async () => {
    hideError();
    setLoading(btnScrape, true);
    setStatus("Pobieram dane profilu...", "loading");

    try {
      currentProfile = await scrapeCurrentTab();
      showProfile(currentProfile);
      setStatus("Profil pobrany", "success");
      btnGenerate.disabled = false;
      // Reset previous message — new profile = new context
      currentMessage = null;
      currentGenTime = null;
      resultArea.classList.add("hidden");
      saveSession();
    } catch (err) {
      showError(err.message);
      // Hide stale profile/result, clear in-memory state. Without this the
      // popup keeps showing the previous profile after a fail — looks like
      // it worked when it didn't (#3).
      resetProfileUI();
    } finally {
      setLoading(btnScrape, false);
    }
  });

  // Generate message
  async function doGenerate() {
    if (!currentProfile) return;

    hideError();
    setLoading(btnGenerate, true);
    setStatus("Generuję wiadomość...", "loading");

    try {
      const result = await sendToBackground({
        action: "generateMessage",
        profile: currentProfile,
        options: {
          goal: selectGoal.value,
          language: selectLang.value,
          tone: inputTone.value || null,
        },
      });

      currentMessage = result.message;
      currentGenTime = result.generation_time_s;
      showResult(result.message, result.generation_time_s);
      setStatus("Wiadomość gotowa", "success");
      saveSession();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(btnGenerate, false);
    }
  }

  btnGenerate.addEventListener("click", doGenerate);
  btnRegenerate.addEventListener("click", doGenerate);

  // Copy to clipboard
  btnCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(resultText.value);
      btnCopy.querySelector("svg + *")?.remove();
      const origHTML = btnCopy.innerHTML;
      btnCopy.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg> Skopiowano!`;
      setTimeout(() => { btnCopy.innerHTML = origHTML; }, 1500);
    } catch {
      // Fallback
      resultText.select();
      document.execCommand("copy");
    }
  });

  // ── Settings ─────────────────────────────────────────────────────

  btnSettings.addEventListener("click", async () => {
    viewMain.classList.add("hidden");
    viewSettings.classList.remove("hidden");

    const settings = await sendToBackground({ action: "getSettings" });
    setApiUrl.value = settings.apiUrl || "";
    setApiKey.value = settings.apiKey || "";
    setSender.value = settings.senderContext || "";
    setMaxChars.value = settings.defaultMaxChars || 300;
  });

  btnBack.addEventListener("click", () => {
    viewSettings.classList.add("hidden");
    viewMain.classList.remove("hidden");
  });

  const btnOpenOptions = $("#btn-open-options");
  if (btnOpenOptions) {
    btnOpenOptions.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }

  btnSaveSettings.addEventListener("click", async () => {
    const settings = {
      apiUrl: setApiUrl.value.trim(),
      apiKey: setApiKey.value.trim(),
      senderContext: setSender.value.trim(),
      defaultMaxChars: parseInt(setMaxChars.value, 10) || 1000,
    };

    try {
      await sendToBackground({ action: "saveSettings", settings });
      viewSettings.classList.add("hidden");
      viewMain.classList.remove("hidden");
      setStatus("Ustawienia zapisane", "success");
    } catch (err) {
      showError("Nie udało się zapisać ustawień: " + err.message);
    }
  });

  // Persist user's selections as they change
  selectGoal.addEventListener("change", saveSession);
  selectLang.addEventListener("change", saveSession);
  inputTone.addEventListener("input", saveSession);
  // Persist edits to the generated message so they survive popup close
  resultText.addEventListener("input", () => {
    currentMessage = resultText.value;
    saveSession();
  });

  // ── Bulk Connect (#18) ───────────────────────────────────────────

  /**
   * Translate the buttonState string returned by extractSearchResults()
   * into the user-facing Polish label shown on the badge.
   */
  function badgeLabel(state) {
    switch (state) {
      case "Connect": return "Połącz";
      case "Pending": return "Wysłano";
      case "Message": return "Wiadomość";
      case "Follow":  return "Obserwuj";
      default:        return "?";
    }
  }

  /**
   * Render the search results list inside the popup. Each row shows name
   * + headline + a badge for the action available. 1st-degree connections,
   * pending invites and follow-only profiles are rendered greyed-out and
   * non-clickable so the user still sees them but can't open them by mistake.
   */
  function renderProfilesList(profiles) {
    profilesList.innerHTML = "";

    if (!Array.isArray(profiles) || profiles.length === 0) {
      bulkInfo.textContent = "Brak profili na tej stronie";
      return;
    }

    let connectable = 0;
    for (const p of profiles) {
      const slug = p?.slug || "";
      const state = p?.buttonState || "Unknown";
      const degree = p?.degree || "";
      const isFirstDegree = typeof degree === "string" && degree.trim().startsWith("1");
      const disabled = state !== "Connect" || isFirstDegree;
      if (!disabled) connectable += 1;

      const li = document.createElement("li");
      li.className = "bulk-connect__row" + (disabled ? " bulk-connect__row--disabled" : "");
      if (slug) li.dataset.slug = slug;

      // Checkbox per profil (#19): zaznaczamy domyślnie tylko Connect-able.
      // Disabled rows mają opacity:0.5+pointer-events:none na całym row,
      // więc checkbox i tak będzie nieklikalny przez gray-out.
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "bulk-connect__row-checkbox";
      if (slug) checkbox.dataset.slug = slug;
      checkbox.checked = !disabled;
      li.appendChild(checkbox);

      const textCol = document.createElement("div");
      textCol.className = "bulk-connect__row-text";

      const nameEl = document.createElement("span");
      nameEl.className = "bulk-connect__row-name";
      nameEl.textContent = p?.name || "—";

      const headlineEl = document.createElement("span");
      headlineEl.className = "bulk-connect__row-headline";
      headlineEl.textContent = p?.headline || "";

      textCol.appendChild(nameEl);
      textCol.appendChild(headlineEl);

      const badge = document.createElement("span");
      badge.className = `badge badge--${String(state).toLowerCase()}`;
      badge.textContent = badgeLabel(state);

      li.appendChild(textCol);
      li.appendChild(badge);
      profilesList.appendChild(li);
    }

    bulkInfo.textContent = `${profiles.length} profili, ${connectable} dostępnych do Connect`;
  }

  /**
   * Ask the content script for the search results visible on the page,
   * then render them. Silent failure path — a missing content script or
   * a non-LinkedIn tab just shows an info message.
   */
  async function loadProfilesList() {
    bulkInfo.textContent = "Ładuję listę profili...";
    profilesList.innerHTML = "";

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        bulkInfo.textContent = "Brak aktywnej karty";
        return;
      }
      const response = await chrome.tabs.sendMessage(tab.id, { action: "extractSearchResults" });
      if (response?.success) {
        renderProfilesList(response.profiles || []);
      } else {
        bulkInfo.textContent = "Nie udało się pobrać listy profili";
      }
    } catch (err) {
      console.warn("[LinkedIn MSG] loadProfilesList failed:", err);
      bulkInfo.textContent = "Nie udało się pobrać listy profili";
    }
  }

  // Delegated click handler: open the clicked profile in a background tab.
  // Checkbox click przepuszczamy (default toggle behavior) — zaznaczanie
  // do batch'a nie powinno otwierać profilu w nowej karcie.
  profilesList.addEventListener("click", (e) => {
    if (e.target && e.target.tagName === "INPUT") return;
    const row = e.target.closest(".bulk-connect__row");
    if (!row) return;
    if (row.classList.contains("bulk-connect__row--disabled")) return;
    const slug = row.dataset.slug;
    if (!slug) return;
    chrome.tabs.create({ url: `https://www.linkedin.com/in/${slug}/`, active: false });
  });

  btnRefreshList.addEventListener("click", loadProfilesList);

  // ── Bulk queue render + handlers (#19) ────────────────────────────

  // Cache ostatnio pobranego stanu — przydatne gdyby coś chciało go
  // odczytać synchronicznie. Trzymane w IIFE (popup ma jeden scope).
  let _lastBulkState = null;

  /**
   * Pobiera bulkState z background workera i renderuje UI.
   * Silent fail — jeśli SW nie odpowiada, po prostu nic się nie dzieje.
   */
  async function loadBulkState() {
    try {
      const state = await chrome.runtime.sendMessage({ action: "getBulkState" });
      _lastBulkState = state;
      renderBulkUI(state);
      // Toggle countdown w zależności od active flag — ważne przy popup reopen
      // gdy worker chodzi w tle (storage.onChanged nie fire'uje przy fresh load).
      if (state?.active) startCountdownTimer();
      else stopCountdownTimer();
    } catch (err) {
      console.warn("[LinkedIn MSG] getBulkState failed:", err);
    }
  }

  /**
   * Renderuje całe queue UI: settings inputs, queue list, progress, controls,
   * error message. Wywoływane po loadBulkState() oraz przy storage.onChanged.
   */
  function renderBulkUI(state) {
    if (!state) return;

    // Settings inputs.
    if (setBulkDelayMin) setBulkDelayMin.value = state.config.delayMin;
    if (setBulkDelayMax) setBulkDelayMax.value = state.config.delayMax;
    if (setBulkCap) setBulkCap.value = state.config.dailyCap;
    if (setBulkHStart) setBulkHStart.value = state.config.workingHoursStart;
    if (setBulkHEnd) setBulkHEnd.value = state.config.workingHoursEnd;

    // Queue.
    const hasQueue = state.queue && state.queue.length > 0;
    queueSection.classList.toggle("hidden", !hasQueue);
    // Add row (Dodaj zaznaczone + Wypełnij do limitu) widoczny tylko gdy
    // bulk-connect section (lista profili) jest unhide'owana.
    if (bulkAddRow) {
      bulkAddRow.hidden = !document.querySelector("#bulk-connect:not(.hidden)");
    }

    // Status badge: ● Aktywne / Pauza / Oczekuje.
    if (bulkStatus) {
      bulkStatus.classList.remove(
        "bulk-queue__status--active",
        "bulk-queue__status--paused",
        "bulk-queue__status--idle"
      );
      if (state.active) {
        bulkStatus.classList.add("bulk-queue__status--active");
        bulkStatus.textContent = "Aktywne";
      } else if (hasQueue && state.queue.some((q) => q.status === "pending")) {
        bulkStatus.classList.add("bulk-queue__status--paused");
        bulkStatus.textContent = "Pauza";
      } else {
        bulkStatus.classList.add("bulk-queue__status--idle");
        bulkStatus.textContent = "Bezczynne";
      }
    }

    if (hasQueue) {
      queueList.innerHTML = "";
      for (const item of state.queue) {
        const li = document.createElement("li");
        li.className = "bulk-queue__item";
        const name = document.createElement("span");
        name.className = "bulk-queue__item-name";
        name.textContent = item.name || item.slug;
        const status = document.createElement("span");
        status.className = `bulk-queue__item-status bulk-queue__item-status--${item.status}`;
        status.textContent = ({
          pending: "oczekuje",
          sent: "wysłane",
          failed: "błąd",
          skipped: "pominięto",
        })[item.status] || item.status;
        if (item.status === "failed" && item.error) status.title = item.error;
        if (item.status === "skipped" && item.error) status.title = item.error;
        li.appendChild(name);
        li.appendChild(status);
        queueList.appendChild(li);
      }

      // Progress.
      const sent = state.queue.filter((q) => q.status === "sent").length;
      const total = state.queue.length;
      bulkProgress.textContent = `${sent}/${total}  ·  dziś ${state.stats.sentToday}/${state.config.dailyCap}`;

      // Controls visibility.
      const hasPending = state.queue.some((q) => q.status === "pending");
      const hasSent = state.queue.some((q) => q.status === "sent");
      btnBulkStart.hidden = !hasPending || state.active || hasSent;
      btnBulkStop.hidden = !state.active;
      btnBulkResume.hidden = state.active || !hasPending || !hasSent;
    }

    // Error message.
    if (state.errorMsg) {
      bulkError.textContent = state.errorMsg;
      bulkError.classList.remove("hidden");
    } else {
      bulkError.classList.add("hidden");
    }

    // Post-Connect messaging pipeline (#21).
    renderMessagePipeline(state);
  }

  /**
   * Zbiera zaznaczone profile z listy i wysyła do background'u jako batch.
   * Po sukcesie odznacza checkboxy (UX: clear selection po commit'cie).
   */
  async function handleAddToQueue() {
    if (!profilesList) return;
    const checkboxes = profilesList.querySelectorAll('input[type="checkbox"]:checked');
    const profiles = Array.from(checkboxes).map((cb) => {
      const li = cb.closest("li");
      const slug = cb.dataset.slug;
      const nameEl = li?.querySelector(".bulk-connect__row-name");
      const headlineEl = li?.querySelector(".bulk-connect__row-headline");
      return {
        slug,
        name: nameEl?.textContent || "",
        headline: headlineEl?.textContent || "",
      };
    }).filter((p) => p.slug);

    if (profiles.length === 0) return;

    try {
      const resp = await chrome.runtime.sendMessage({
        action: "bulkConnectAddToQueue",
        profiles,
      });
      if (resp?.success) {
        await loadBulkState();
        // Uncheck wszystkie po dodaniu (UX: clear selection po komitcie).
        checkboxes.forEach((cb) => { cb.checked = false; });
      }
    } catch (err) {
      console.warn("[LinkedIn MSG] addToQueue failed:", err);
    }
  }

  async function handleBulkStart() {
    await chrome.runtime.sendMessage({ action: "bulkConnectStart" });
    await loadBulkState();
  }

  async function handleBulkStop() {
    await chrome.runtime.sendMessage({ action: "bulkConnectStop" });
    await loadBulkState();
  }

  /**
   * Czyści całą kolejkę. Najpierw stop'uje worker (jeśli leci), potem
   * zapisuje czysty queue + null errorMsg bezpośrednio przez storage.local.
   * Decyzja: nie ma osobnego action'u w background.js dla "clear" — popup
   * pisze do storage bezpośrednio, a background obserwuje storage.onChanged.
   */
  async function handleBulkClear() {
    if (!confirm("Wyczyścić całą kolejkę? Statusy zostaną utracone.")) return;
    // Stop najpierw, potem clear queue (bezpośrednio przez storage.local.set).
    await chrome.runtime.sendMessage({ action: "bulkConnectStop" });
    const state = await chrome.runtime.sendMessage({ action: "getBulkState" });
    await chrome.storage.local.set({
      bulkConnect: { ...state, queue: [], errorMsg: null },
    });
    await loadBulkState();
  }

  /**
   * Walidacja wartości settings'ów (clamp do sensownych zakresów),
   * potem zapis do storage. Background obserwuje storage.onChanged
   * i podchwyci config przy najbliższym tick'u.
   */
  async function handleBulkSaveSettings() {
    const config = {
      delayMin: Math.max(10, parseInt(setBulkDelayMin.value) || 45),
      delayMax: Math.max(10, parseInt(setBulkDelayMax.value) || 120),
      dailyCap: Math.max(1, parseInt(setBulkCap.value) || 25),
      workingHoursStart: Math.max(0, Math.min(23, parseInt(setBulkHStart.value) || 9)),
      workingHoursEnd: Math.max(0, Math.min(23, parseInt(setBulkHEnd.value) || 18)),
    };
    if (config.delayMax < config.delayMin) config.delayMax = config.delayMin;
    if (config.workingHoursEnd <= config.workingHoursStart) config.workingHoursEnd = config.workingHoursStart + 1;

    const state = await chrome.runtime.sendMessage({ action: "getBulkState" });
    await chrome.storage.local.set({ bulkConnect: { ...state, config } });
    await loadBulkState();
  }

  // Re-render queue at any storage change. Plus countdown timer toggle.
  // Każda zmiana queue (mark_sent, generate, skip etc.) potencjalnie
  // wpływa też na listę due follow-up'ów — re-load sekcji follow-up.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.bulkConnect) {
      const newState = changes.bulkConnect.newValue;
      _lastBulkState = newState;
      renderBulkUI(newState);
      if (newState?.active) startCountdownTimer();
      else stopCountdownTimer();
      // Follow-up section (#25) — refresh listy due po każdej zmianie queue.
      loadFollowupList();
    }
  });

  // ── Post-Connect Messaging Pipeline (#21) ────────────────────────

  /**
   * Renderuje sekcję "Wiadomości po-Connect": lista accepted profili z
   * draftami, edytowalna textarea per item, buttony Generuj/Kopiuj/Pomiń.
   * Sekcja widoczna tylko gdy queue zawiera co najmniej jeden item z
   * `acceptedAt` — bez akceptów nie ma czego pokazać.
   */
  function renderMessagePipeline(state) {
    if (!messagePipeline || !state) return;
    const queue = state.queue || [];
    const accepted = queue.filter((q) => q.acceptedAt);

    // Hide gdy brak accepted.
    if (accepted.length === 0) {
      messagePipeline.classList.add("hidden");
      return;
    }
    messagePipeline.classList.remove("hidden");

    // Counter (akcept · wysł. · pom. · do zrobienia).
    const sent = accepted.filter((q) => q.messageStatus === "sent").length;
    const skipped = accepted.filter((q) => q.messageStatus === "skipped").length;
    const pending = accepted.length - sent - skipped;
    messagePipelineCount.textContent =
      `${accepted.length} akcept · ${sent} wysł. · ${skipped} pom. · ${pending} do zrobienia`;

    // "Generuj wszystkie" widoczny tylko gdy są accepted bez draftu.
    const needsGen = accepted.filter(
      (q) => !q.messageDraft && q.messageStatus !== "skipped" && q.messageStatus !== "sent"
    );
    btnGenerateAllMsg.hidden = needsGen.length === 0;
    if (!btnGenerateAllMsg.hidden) {
      btnGenerateAllMsg.textContent = `Generuj wszystkie (${needsGen.length})`;
    }

    // Render listy.
    messageList.innerHTML = "";
    for (const item of accepted) {
      const li = document.createElement("li");
      li.className = `message-item message-item--${item.messageStatus || "none"}`;
      li.dataset.slug = item.slug;

      const head = document.createElement("div");
      head.className = "message-item__head";
      const name = document.createElement("span");
      name.className = "message-item__name";
      name.textContent = item.name || item.slug;
      const status = document.createElement("span");
      const statusClass =
        item.messageStatus && item.messageStatus !== "none" ? item.messageStatus : "accepted";
      status.className = `message-item__status message-item__status--${statusClass}`;
      status.textContent = ({
        "none": "do zrobienia",
        "draft": "draft",
        "approved": "zatw.",
        "sent": "wysłane",
        "skipped": "pominięte",
      })[item.messageStatus] || "zaakcept.";
      head.appendChild(name);
      head.appendChild(status);

      const draftArea = document.createElement("textarea");
      draftArea.className = "message-item__draft";
      draftArea.placeholder = item.messageDraft === null
        ? "Klik 'Generuj' żeby wygenerować draft…"
        : "";
      draftArea.value = item.messageDraft || "";
      draftArea.dataset.slug = item.slug;
      if (item.messageStatus === "sent" || item.messageStatus === "skipped") {
        draftArea.disabled = true;
      }

      const actions = document.createElement("div");
      actions.className = "message-item__actions";

      if (item.messageStatus !== "sent" && item.messageStatus !== "skipped") {
        const btnGen = document.createElement("button");
        btnGen.className = "btn btn--small btn--outline";
        btnGen.textContent = item.messageDraft ? "Regeneruj" : "Generuj";
        btnGen.dataset.action = "generate";
        btnGen.dataset.slug = item.slug;
        actions.appendChild(btnGen);

        const btnCopy = document.createElement("button");
        btnCopy.className = "btn btn--small btn--primary";
        btnCopy.textContent = "Skopiuj i otwórz";
        btnCopy.dataset.action = "copy-open";
        btnCopy.dataset.slug = item.slug;
        btnCopy.disabled = !item.messageDraft;
        actions.appendChild(btnCopy);

        const btnSkip = document.createElement("button");
        btnSkip.className = "btn btn--small btn--outline";
        btnSkip.textContent = "Pomiń";
        btnSkip.dataset.action = "skip";
        btnSkip.dataset.slug = item.slug;
        actions.appendChild(btnSkip);
      }

      li.appendChild(head);
      li.appendChild(draftArea);
      li.appendChild(actions);
      messageList.appendChild(li);
    }
  }

  /**
   * Wywołuje background.bulkCheckAccepts — otwiera w tle karty LinkedIn
   * dla pending invites i sprawdza czy któreś zostały zaakceptowane.
   */
  async function handleCheckAccepts() {
    if (!btnCheckAccepts) return;
    btnCheckAccepts.disabled = true;
    btnCheckAccepts.textContent = "Sprawdzam…";
    if (messagePipelineStatus) {
      messagePipelineStatus.className = "message-pipeline__status";
      messagePipelineStatus.textContent =
        "Otwieram zakładki LinkedIn — to potrwa kilka–kilkadziesiąt sekund…";
    }
    try {
      const resp = await chrome.runtime.sendMessage({ action: "bulkCheckAccepts" });
      if (resp?.success) {
        if (messagePipelineStatus) {
          messagePipelineStatus.className = "message-pipeline__status message-pipeline__status--success";
          messagePipelineStatus.textContent =
            `Zeskanowano ${resp.scanned}, zaakceptowanych: ${resp.accepted}` +
            (resp.skipped_recent ? ` (${resp.skipped_recent} pominięto — sprawdzone < 4h temu)` : "");
        }
        await loadBulkState();
      } else {
        if (messagePipelineStatus) {
          messagePipelineStatus.className = "message-pipeline__status message-pipeline__status--error";
          messagePipelineStatus.textContent = `Błąd: ${resp?.error || "unknown"}`;
        }
      }
    } catch (err) {
      if (messagePipelineStatus) {
        messagePipelineStatus.className = "message-pipeline__status message-pipeline__status--error";
        messagePipelineStatus.textContent = `Błąd: ${(err && err.message) || err}`;
      }
    } finally {
      btnCheckAccepts.disabled = false;
      btnCheckAccepts.textContent = "Sprawdź akceptacje";
    }
  }

  /**
   * Generuje draft dla pojedynczego accepted profilu. Background scrape'uje
   * profil (jeśli jeszcze nie ma w storage) i woła generator AI.
   */
  async function handleGenerateMessage(slug) {
    if (messagePipelineStatus) {
      messagePipelineStatus.className = "message-pipeline__status";
      messagePipelineStatus.textContent = `Generuję dla ${slug}…`;
    }
    const options = {
      goal: selectGoal?.value || "networking",
      language: selectLang?.value || "pl",
      tone: (inputTone?.value || "").trim() || null,
    };
    try {
      const resp = await chrome.runtime.sendMessage({
        action: "bulkGenerateMessage",
        slug,
        options,
      });
      if (resp?.success) {
        if (messagePipelineStatus) {
          messagePipelineStatus.className = "message-pipeline__status message-pipeline__status--success";
          messagePipelineStatus.textContent = `Wygenerowano draft dla ${slug}.`;
        }
        await loadBulkState();
      } else {
        if (messagePipelineStatus) {
          messagePipelineStatus.className = "message-pipeline__status message-pipeline__status--error";
          messagePipelineStatus.textContent = `Generowanie ${slug} nieudane: ${resp?.error || "unknown"}`;
        }
      }
    } catch (err) {
      if (messagePipelineStatus) {
        messagePipelineStatus.className = "message-pipeline__status message-pipeline__status--error";
        messagePipelineStatus.textContent = `Błąd: ${(err && err.message) || err}`;
      }
    }
  }

  /**
   * Generuje drafty dla wszystkich accepted bez draftu, sekwencyjnie.
   * Sekwencyjnie (NIE Promise.all) bo backend ma rate limity i UX progress
   * łatwiejszy do śledzenia.
   */
  async function handleGenerateAll() {
    if (!_lastBulkState) return;
    const accepted = (_lastBulkState.queue || []).filter(
      (q) =>
        q.acceptedAt &&
        !q.messageDraft &&
        q.messageStatus !== "skipped" &&
        q.messageStatus !== "sent"
    );
    if (accepted.length === 0) return;
    btnGenerateAllMsg.disabled = true;
    let done = 0;
    for (const item of accepted) {
      btnGenerateAllMsg.textContent = `Generowanie ${++done}/${accepted.length}…`;
      await handleGenerateMessage(item.slug);
    }
    btnGenerateAllMsg.disabled = false;
    btnGenerateAllMsg.textContent = "Generuj wszystkie";
    if (messagePipelineStatus) {
      messagePipelineStatus.className = "message-pipeline__status message-pipeline__status--success";
      messagePipelineStatus.textContent = `Wygenerowano ${accepted.length} wiadomości.`;
    }
  }

  /**
   * Kopiuje draft do schowka, otwiera tab LinkedIn'a z compose'em (recipient
   * pre-filled przez slug w URL'u), i mark'uje jako sent w storage.
   * User wkleja Ctrl+V w już-otwartej karcie i klika Wyślij ręcznie.
   */
  async function handleCopyAndOpen(slug) {
    if (!_lastBulkState) return;
    const item = _lastBulkState.queue.find((q) => q.slug === slug);
    if (!item || !item.messageDraft) return;
    try {
      await navigator.clipboard.writeText(item.messageDraft);
      chrome.tabs.create({
        url: `https://www.linkedin.com/messaging/compose/?recipient=${encodeURIComponent(slug)}`,
        active: true,
      });
      await chrome.runtime.sendMessage({ action: "bulkMarkMessageSent", slug });
      if (messagePipelineStatus) {
        messagePipelineStatus.className = "message-pipeline__status message-pipeline__status--success";
        messagePipelineStatus.textContent =
          `Skopiowano do schowka. Wklej (Ctrl+V) w otwartej karcie LinkedIn'a i kliknij Wyślij.`;
      }
      await loadBulkState();
    } catch (err) {
      if (messagePipelineStatus) {
        messagePipelineStatus.className = "message-pipeline__status message-pipeline__status--error";
        messagePipelineStatus.textContent = `Błąd kopiowania: ${(err && err.message) || err}`;
      }
    }
  }

  async function handleSkipMessage(slug) {
    await chrome.runtime.sendMessage({ action: "bulkSkipMessage", slug });
    await loadBulkState();
  }

  /**
   * Auto-save edycji draftu po blur. Decyzja: blur > input + debounce —
   * mniej wywołań background.bulkUpdateMessageDraft, prościej, user w popupie
   * zwykle klika gdzieś poza textarea zanim chce kontynuować flow.
   * NIE wywołujemy loadBulkState — storage.onChanged i tak podchwyci zmianę.
   */
  async function handleDraftEdit(slug, draft) {
    await chrome.runtime.sendMessage({ action: "bulkUpdateMessageDraft", slug, draft });
  }

  // Wire up event listeners.
  if (btnAddQueue) btnAddQueue.addEventListener("click", handleAddToQueue);
  if (btnBulkStart) btnBulkStart.addEventListener("click", handleBulkStart);
  if (btnBulkStop) btnBulkStop.addEventListener("click", handleBulkStop);
  if (btnBulkResume) btnBulkResume.addEventListener("click", handleBulkStart); // Resume = Start
  if (btnBulkClear) btnBulkClear.addEventListener("click", handleBulkClear);
  if (btnBulkSaveSettings) btnBulkSaveSettings.addEventListener("click", handleBulkSaveSettings);
  if (btnBulkFill) btnBulkFill.addEventListener("click", handleAutoFillQueue);

  // Message pipeline (#21) listeners.
  if (btnCheckAccepts) btnCheckAccepts.addEventListener("click", handleCheckAccepts);
  if (btnGenerateAllMsg) btnGenerateAllMsg.addEventListener("click", handleGenerateAll);

  // Delegated click handler dla actions w message-list (Generuj/Kopiuj/Pomiń).
  if (messageList) {
    messageList.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const slug = btn.dataset.slug;
      const action = btn.dataset.action;
      if (action === "generate") handleGenerateMessage(slug);
      else if (action === "copy-open") handleCopyAndOpen(slug);
      else if (action === "skip") handleSkipMessage(slug);
    });

    // Auto-save draft po blur (capture phase, bo blur nie bubbles).
    messageList.addEventListener(
      "blur",
      (e) => {
        if (e.target.tagName === "TEXTAREA" && e.target.dataset.slug) {
          const slug = e.target.dataset.slug;
          const draft = e.target.value;
          handleDraftEdit(slug, draft);
        }
      },
      true
    );
  }

  // ── Follow-up reminders 3d/7d (#25 v1.7.0) ───────────────────────
  //
  // Sekcja "Do follow-up'u" — lista profili, dla których minęły 3 lub 7
  // dni od pierwszej wysłanej wiadomości. Background.js odpowiada za
  // recompute due/badge na alarm 6h + storage.onChanged. Popup pyta
  // background o snapshot (`followupListDue`) i renderuje DOM.

  // Map per-row dla debounce auto-save edycji draftu (klucz = `${slug}#${N}`).
  const _followupDraftDebounce = new Map();

  /**
   * Pyta background o aktualną listę due follow-upów i renderuje sekcję.
   * Silent fail — gdy SW nie odpowiada, sekcja zostaje w poprzednim stanie.
   */
  async function loadFollowupList() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: "followupListDue" });
      if (resp && resp.success) {
        renderFollowupList(resp.items || []);
      }
    } catch (err) {
      console.warn("[LinkedIn MSG] loadFollowupList failed:", err);
    }
  }

  /**
   * Renderuje sekcję Follow-up. Gdy items.length === 0 sekcja jest
   * całkowicie ukryta (display:none) — bez badge'a, bez nagłówka.
   */
  function renderFollowupList(items) {
    if (!followupSection || !followupList) return;
    if (!Array.isArray(items) || items.length === 0) {
      followupSection.classList.add("hidden");
      followupList.innerHTML = "";
      if (followupCountBadge) followupCountBadge.textContent = "";
      return;
    }
    followupSection.classList.remove("hidden");
    if (followupCountBadge) followupCountBadge.textContent = String(items.length);
    followupList.innerHTML = "";
    for (const item of items) {
      followupList.appendChild(createFollowupRow(item));
    }
  }

  /**
   * Buduje DOM jednego rzędu follow-up. textContent dla user data
   * (imię, headline) — NIE innerHTML, ochrona przed XSS gdyby LinkedIn
   * podsunął złośliwy headline.
   */
  function createFollowupRow(item) {
    const slug = item.slug || "";
    const followupNum = item.dueFollowup === 2 ? 2 : 1;
    const days = followupNum === 2 ? 7 : 3;

    const li = document.createElement("li");
    li.className = "followup-row";
    li.dataset.slug = slug;
    li.dataset.followupNum = String(followupNum);

    const head = document.createElement("div");
    head.className = "followup-row__head";

    const nameEl = document.createElement("span");
    nameEl.className = "followup-row__name";
    nameEl.textContent = item.name || slug || "—";

    const tag = document.createElement("span");
    tag.className = "followup-row__tag" + (followupNum === 2 ? " followup-row__tag--second" : "");
    tag.textContent = `Follow-up #${followupNum} (${days}d po wysłaniu)`;

    head.appendChild(nameEl);
    head.appendChild(tag);

    const headlineEl = document.createElement("div");
    headlineEl.className = "followup-row__headline";
    headlineEl.textContent = item.headline || "";

    const draftArea = document.createElement("textarea");
    draftArea.className = "followup-row__draft";
    draftArea.dataset.slug = slug;
    draftArea.dataset.followupNum = String(followupNum);
    draftArea.placeholder = item.draft
      ? ""
      : "Klik 'Generuj follow-up' żeby wygenerować draft…";
    draftArea.value = item.draft || "";

    const actions = document.createElement("div");
    actions.className = "followup-row__actions";

    const btnGen = document.createElement("button");
    btnGen.className = "btn btn--small btn--outline";
    btnGen.textContent = item.draft ? "Regeneruj follow-up" : "Generuj follow-up";
    btnGen.dataset.action = "followup-generate";
    btnGen.dataset.slug = slug;
    btnGen.dataset.followupNum = String(followupNum);
    actions.appendChild(btnGen);

    const btnCopyOpen = document.createElement("button");
    btnCopyOpen.className = "btn btn--small btn--primary";
    btnCopyOpen.textContent = "Skopiuj i otwórz";
    btnCopyOpen.dataset.action = "followup-copy-open";
    btnCopyOpen.dataset.slug = slug;
    btnCopyOpen.dataset.followupNum = String(followupNum);
    actions.appendChild(btnCopyOpen);

    const btnSent = document.createElement("button");
    btnSent.className = "btn btn--small btn--outline";
    btnSent.textContent = "Wysłałem";
    btnSent.dataset.action = "followup-mark-sent";
    btnSent.dataset.slug = slug;
    btnSent.dataset.followupNum = String(followupNum);
    actions.appendChild(btnSent);

    const btnSkip = document.createElement("button");
    btnSkip.className = "btn btn--small btn--outline";
    btnSkip.textContent = "Pomiń";
    btnSkip.dataset.action = "followup-skip";
    btnSkip.dataset.slug = slug;
    actions.appendChild(btnSkip);

    li.appendChild(head);
    li.appendChild(headlineEl);
    li.appendChild(draftArea);
    li.appendChild(actions);
    return li;
  }

  /**
   * Generuje AI draft follow-up'a. Background reads queue[slug].messageDraft
   * + scrapedProfile, woła generator z goal="followup", zapisuje do storage.
   * UI: button disabled + "Generuję…" do response, potem fill textarea.
   */
  async function handleFollowupGenerate(slug, followupNum, btn) {
    if (!slug || !btn) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generuję…";
    try {
      const resp = await chrome.runtime.sendMessage({
        action: "followupGenerate",
        slug,
        followupNum,
      });
      if (resp?.success) {
        // Update textarea — storage.onChanged też triggernie loadFollowupList(),
        // ale nie polegamy na nim (wymiana całego DOM zaorałaby focus).
        const ta = followupList?.querySelector(
          `textarea[data-slug="${CSS.escape(slug)}"][data-followup-num="${followupNum}"]`
        );
        if (ta) ta.value = resp.draft || "";
      } else {
        alert("Nie udało się wygenerować follow-up'a: " + (resp?.error || "unknown"));
      }
    } catch (err) {
      alert("Błąd generowania: " + ((err && err.message) || err));
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  /**
   * Auto-save edycji draftu po blur z debounce 500ms. Klucz dedupe
   * `slug#N` żeby followup #1 i #2 nie konkurowały o ten sam timer.
   */
  function scheduleFollowupDraftSave(slug, followupNum, text) {
    if (!slug) return;
    const key = `${slug}#${followupNum}`;
    const prev = _followupDraftDebounce.get(key);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(async () => {
      _followupDraftDebounce.delete(key);
      try {
        await chrome.runtime.sendMessage({
          action: "followupUpdateDraft",
          slug,
          followupNum,
          text,
        });
      } catch (err) {
        console.warn("[LinkedIn MSG] followupUpdateDraft failed:", err);
      }
    }, 500);
    _followupDraftDebounce.set(key, timer);
  }

  async function handleFollowupCopyAndOpen(slug, followupNum) {
    if (!slug) return;
    try {
      const resp = await chrome.runtime.sendMessage({
        action: "followupCopyAndOpen",
        slug,
        followupNum,
      });
      if (!resp?.success) {
        if (resp?.error === "empty_draft") {
          alert("Najpierw wygeneruj draft");
        } else {
          alert("Nie udało się skopiować: " + (resp?.error || "unknown"));
        }
        return;
      }
      // Background otworzył tab + zwrócił draft. Clipboard write robi popup
      // bo navigator.clipboard.writeText nie działa niezawodnie w MV3 SW.
      if (resp.draft) {
        try {
          await navigator.clipboard.writeText(resp.draft);
        } catch (clipErr) {
          console.warn("[LinkedIn MSG] clipboard write failed:", clipErr);
        }
      }
    } catch (err) {
      alert("Błąd: " + ((err && err.message) || err));
    }
  }

  async function handleFollowupMarkSent(slug, followupNum, name) {
    if (!slug) return;
    const label = name || slug;
    if (!confirm(`Wysłałeś follow-up #${followupNum} do ${label}?`)) return;
    try {
      await chrome.runtime.sendMessage({
        action: "followupMarkSent",
        slug,
        followupNum,
      });
      await loadFollowupList();
    } catch (err) {
      console.warn("[LinkedIn MSG] followupMarkSent failed:", err);
    }
  }

  async function handleFollowupSkip(slug, name) {
    if (!slug) return;
    const label = name || slug;
    if (!confirm(`Pomiń follow-upy dla ${label}?`)) return;
    try {
      await chrome.runtime.sendMessage({ action: "followupSkip", slug });
      await loadFollowupList();
    } catch (err) {
      console.warn("[LinkedIn MSG] followupSkip failed:", err);
    }
  }

  // Delegated click handler dla wszystkich buttonów w sekcji follow-up.
  if (followupList) {
    followupList.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const slug = btn.dataset.slug;
      const followupNum = parseInt(btn.dataset.followupNum, 10) || 1;
      const row = btn.closest(".followup-row");
      const name = row?.querySelector(".followup-row__name")?.textContent || "";
      if (action === "followup-generate") handleFollowupGenerate(slug, followupNum, btn);
      else if (action === "followup-copy-open") handleFollowupCopyAndOpen(slug, followupNum);
      else if (action === "followup-mark-sent") handleFollowupMarkSent(slug, followupNum, name);
      else if (action === "followup-skip") handleFollowupSkip(slug, name);
    });

    // Auto-save draft po blur (capture phase, blur nie bubbles).
    followupList.addEventListener(
      "blur",
      (e) => {
        const t = e.target;
        if (t && t.tagName === "TEXTAREA" && t.dataset.slug) {
          const slug = t.dataset.slug;
          const followupNum = parseInt(t.dataset.followupNum, 10) || 1;
          scheduleFollowupDraftSave(slug, followupNum, t.value);
        }
      },
      true
    );
  }

  // ── Countdown timer (#19/v1.4.1) ─────────────────────────────────
  //
  // Live update co 1s pokazujący czas do następnego ticku worker loop'u
  // ("Następne za 1m 23s"). Bez tego user nie wie czy bulk faktycznie
  // chodzi w tle (popup może być schowany przez większość delay'a).

  let _countdownInterval = null;

  function formatCountdown(ms) {
    if (ms <= 0) return "za chwilę…";
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m > 0) return `za ${m}m ${s}s`;
    return `za ${s}s`;
  }

  function updateCountdownView() {
    if (!bulkCountdown || !_lastBulkState) return;
    const s = _lastBulkState;
    if (s.active && s.nextTickAt) {
      const remaining = s.nextTickAt - Date.now();
      bulkCountdown.classList.remove("hidden");
      const lastInfo = s.lastTickAt
        ? `  ·  ostatnia akcja ${Math.floor((Date.now() - s.lastTickAt) / 1000)}s temu`
        : "";
      bulkCountdown.textContent = `Następne dodanie ${formatCountdown(remaining)}${lastInfo}`;
    } else {
      bulkCountdown.classList.add("hidden");
    }
  }

  function startCountdownTimer() {
    stopCountdownTimer();
    _countdownInterval = setInterval(updateCountdownView, 1000);
    updateCountdownView();
  }

  function stopCountdownTimer() {
    if (_countdownInterval) {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
    }
  }

  // ── Auto-fill kolejki przez paginację LinkedIn'a (#22 wcielona w 1.4.1) ──

  async function handleAutoFillQueue() {
    if (!btnBulkFill) return;
    btnBulkFill.disabled = true;
    btnBulkFill.textContent = "Pobieranie z kolejnych stron…";
    try {
      const state = await chrome.runtime.sendMessage({ action: "getBulkState" });
      const inQueue = state.queue.filter((q) => q.status === "pending").length;
      const remaining = state.config.dailyCap - inQueue;
      if (remaining <= 0) {
        if (bulkError) {
          bulkError.textContent = "Kolejka pełna do limitu dziennego.";
          bulkError.classList.remove("hidden");
        }
        return;
      }

      // #22 v1.6.0: pagination orchestrowany przez background.js (URL-based,
      // zachowuje wszystkie query params LinkedIn'a). Background navigates
      // aktywną kartą przez ?page=N, scrapuje, dorzuca z pageNumber field.
      const resp = await chrome.runtime.sendMessage({
        action: "bulkAutoFillByUrl",
        maxProfiles: remaining,
      });

      if (resp?.success && resp?.added > 0) {
        await loadBulkState();
        if (bulkError) {
          bulkError.textContent = `Dodano ${resp.added} profili (zeskanowano ${resp.pagesScanned || 0} stron, ostatnia: ${resp.finalPage || "?"}).`;
          bulkError.classList.remove("hidden");
          setTimeout(() => bulkError.classList.add("hidden"), 5000);
        }
      } else if (resp?.success) {
        if (bulkError) {
          bulkError.textContent = `Brak nowych profili Connect-able do dodania (zeskanowano ${resp.pagesScanned || 0} stron).`;
          bulkError.classList.remove("hidden");
        }
      } else {
        if (bulkError) {
          bulkError.textContent = `Błąd pagination: ${resp?.error || "unknown"}`;
          bulkError.classList.remove("hidden");
        }
      }
    } catch (err) {
      console.warn("[LinkedIn MSG] autoFill failed:", err);
      if (bulkError) {
        bulkError.textContent = `Błąd: ${err && err.message || err}`;
        bulkError.classList.remove("hidden");
      }
    } finally {
      btnBulkFill.disabled = false;
      btnBulkFill.textContent = "Wypełnij do limitu";
    }
  }

  // ── Init ─────────────────────────────────────────────────────────

  (async () => {
    // Apply user defaults first
    try {
      const settings = await sendToBackground({ action: "getSettings" });
      if (settings.defaultGoal) selectGoal.value = settings.defaultGoal;
      if (settings.defaultLanguage) selectLang.value = settings.defaultLanguage;
    } catch {
      // Fresh install, defaults are fine
    }

    // Then overlay last session state (takes precedence)
    const last = await loadSession();
    if (!last) return;

    // User preferences are always restored — they're not tied to a specific
    // profile and the user has set them deliberately.
    if (last.goal) selectGoal.value = last.goal;
    if (last.language) selectLang.value = last.language;
    if (typeof last.tone === "string") inputTone.value = last.tone;

    // Profile + message restore is gated by URL slug match (#3).
    // Without this gate, opening the popup on Olga while last session
    // cached Konrad would show Konrad in the preview before the user even
    // clicks Pobierz — masking that the cache is stale.
    if (last.profile) {
      let slugMatch = false;
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeSlug = extractSlugFromUrl(activeTab?.url);
        const cachedSlug = extractSlugFromUrl(last.profile.profile_url);
        slugMatch = !!(activeSlug && cachedSlug && activeSlug === cachedSlug);
      } catch {
        // No tabs permission or tab unavailable — fall through as mismatch.
      }

      if (slugMatch) {
        currentProfile = last.profile;
        showProfile(currentProfile);
        btnGenerate.disabled = false;
        setStatus("Ostatnio pobrany profil", "success");

        if (last.message) {
          currentMessage = last.message;
          currentGenTime = last.genTime;
          showResult(last.message, last.genTime || 0);
        }
      }
      // Mismatch — leave profilePreview / resultArea hidden by default.
      // currentProfile stays null, btnGenerate stays disabled. User clicks
      // Pobierz to scrape the active profile fresh.
    }

    // Bulk Connect detection (#18): if the active tab is a LinkedIn search
    // results page, reveal the bulk-connect section and load the visible
    // profiles. Silent on every failure — non-LinkedIn tabs and not-yet-ready
    // content scripts simply leave the section hidden.
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const detection = await chrome.tabs.sendMessage(tab.id, { action: "detectPageType" });
        if (detection?.type === "search_results") {
          bulkConnect.classList.remove("hidden");
          loadProfilesList();
          // Bulk-connect widoczny → "Dodaj zaznaczone do kolejki" musi być widoczny.
          if (btnAddQueue) btnAddQueue.hidden = false;
        }
      }
    } catch (_) {
      // not on linkedin or content script not ready — silent
    }

    // Bulk queue state (#19): zawsze ładujemy — queue jest persistowane w
    // storage.local i user może mieć aktywną kolejkę z poprzedniej sesji
    // nawet jeśli akurat jest na stronie profilu / feed'a.
    loadBulkState();

    // Follow-up reminders (#25): zawsze pytamy background o due,
    // sekcja sama się pokaże/ukryje w renderFollowupList.
    loadFollowupList();
  })();
})();
