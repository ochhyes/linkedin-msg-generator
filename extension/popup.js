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
  })();
})();
