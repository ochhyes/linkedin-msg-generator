/**
 * LinkedIn Profile Scraper — Content Script
 * 
 * Runs on linkedin.com/in/* pages.
 * Uses MutationObserver + polling to wait for LinkedIn's SPA
 * to finish rendering before scraping.
 * 
 * LinkedIn DOM is unstable — selectors use multiple fallbacks.
 */

(() => {
  "use strict";

  // ── Configuration ────────────────────────────────────────────────

  const CONFIG = {
    // Max time to wait for primary elements (name, headline)
    PRIMARY_TIMEOUT_MS: 8000,
    // Extra wait for lazy sections (experience, skills, about)
    LAZY_TIMEOUT_MS: 4000,
    // Polling interval when MutationObserver doesn't fire
    POLL_INTERVAL_MS: 300,
    // How many retry rounds for lazy sections
    LAZY_RETRIES: 3,
    // Delay between lazy retries
    LAZY_RETRY_DELAY_MS: 800,
  };

  // ── Utility ──────────────────────────────────────────────────────

  function queryText(selectors, context = document) {
    for (const sel of selectors) {
      try {
        const el = context.querySelector(sel);
        if (el && el.textContent.trim()) {
          return el.textContent.trim();
        }
      } catch (e) {}
    }
    return null;
  }

  function queryAllTexts(selectors, context = document, limit = 5) {
    const results = [];
    for (const sel of selectors) {
      try {
        const els = context.querySelectorAll(sel);
        for (const el of els) {
          const text = el.textContent.trim();
          if (text && !results.includes(text)) {
            results.push(text);
            if (results.length >= limit) return results;
          }
        }
      } catch (e) {}
    }
    return results;
  }

  // ── DOM Ready Waiter ─────────────────────────────────────────────

  /**
   * Wait for at least one of the given selectors to match a non-empty element.
   * Uses MutationObserver as primary mechanism + polling as fallback.
   * 
   * @param {string[]} selectors - CSS selectors to watch for
   * @param {number} timeoutMs - Max wait time
   * @returns {Promise<Element|null>} - The matched element or null on timeout
   */
  function waitForElement(selectors, timeoutMs = CONFIG.PRIMARY_TIMEOUT_MS) {
    return new Promise((resolve) => {
      // Immediate check — element might already exist
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim()) {
            return resolve(el);
          }
        } catch (e) {}
      }

      let resolved = false;
      let observer = null;
      let pollTimer = null;
      let timeoutTimer = null;

      function cleanup() {
        resolved = true;
        if (observer) { observer.disconnect(); observer = null; }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
      }

      function check() {
        if (resolved) return;
        for (const sel of selectors) {
          try {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim()) {
              cleanup();
              resolve(el);
              return;
            }
          } catch (e) {}
        }
      }

      // MutationObserver — watches for any DOM changes in body
      observer = new MutationObserver(() => { check(); });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
      });

      // Polling fallback — catches cases MutationObserver misses
      // (text content changes, attribute-only mutations, etc.)
      pollTimer = setInterval(check, CONFIG.POLL_INTERVAL_MS);

      // Hard timeout — resolve with null
      timeoutTimer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Profile Extractors ───────────────────────────────────────────

  const NAME_SELECTORS = [
    "h1.text-heading-xlarge",
    "h1.inline.t-24",
    ".pv-top-card h1",
    ".pv-text-details__left-panel h1",
    "section.pv-top-card h1",
    ".scaffold-layout__main h1",
  ];

  const HEADLINE_SELECTORS = [
    ".text-body-medium.break-words",
    ".pv-top-card .text-body-medium",
    ".pv-text-details__left-panel .text-body-medium",
    ".pv-top-card--list .text-body-medium",
    ".pv-top-card-section__headline",
    ".ph5 .text-body-medium",
  ];

  function extractName() {
    return queryText(NAME_SELECTORS);
  }

  function extractHeadline() {
    return queryText(HEADLINE_SELECTORS);
  }

  function extractCompany() {
    const expCompany = queryText([
      "#experience ~ .pvs-list__outer-container .hoverable-link-text span[aria-hidden='true']",
      ".experience-section .pv-entity__secondary-title",
      "[data-field='experience_company_logo'] + div span",
    ]);
    if (expCompany) return expCompany;

    const headline = extractHeadline();
    if (headline) {
      const match = headline.match(/(?:at|@|w|w firmie)\s+(.+)$/i);
      if (match) return match[1].trim();
    }
    return null;
  }

  function extractLocation() {
    return queryText([
      ".text-body-small.inline.t-black--light.break-words",
      ".pv-top-card--list .pb2 .text-body-small",
      ".pv-text-details__left-panel .text-body-small.mt2",
      ".pv-top-card-section__location",
      ".pv-top-card--list .text-body-small.inline",
    ]);
  }

  function extractAbout() {
    const aboutSection = document.querySelector("#about")?.closest("section");
    if (aboutSection) {
      const text = queryText([
        ".pv-shared-text-with-see-more span.visually-hidden",
        ".pv-shared-text-with-see-more span[aria-hidden='true']",
        ".inline-show-more-text span[aria-hidden='true']",
        ".display-flex.full-width span[aria-hidden='true']",
        ".full-width span",
      ], aboutSection);
      if (text) return text;
    }
    return queryText([
      "#about ~ div .inline-show-more-text",
      "#about + .display-flex .pv-shared-text-with-see-more",
      "section.pv-about-section .pv-about__summary-text",
    ]);
  }

  function extractExperience() {
    const experienceSection = document.querySelector("#experience")?.closest("section");
    if (!experienceSection) return [];
    const items = [];
    const listItems = experienceSection.querySelectorAll(
      ".pvs-list__paged-list-item, li.pvs-list__item--line-separated"
    );
    for (const item of Array.from(listItems).slice(0, 3)) {
      const title = queryText([
        ".hoverable-link-text .visually-hidden",
        ".t-bold span[aria-hidden='true']",
        "span.t-bold span",
        ".mr1.t-bold span",
      ], item);
      const company = queryText([
        ".t-normal:not(.t-black--light) span[aria-hidden='true']",
        ".t-14.t-normal span[aria-hidden='true']",
        ".pv-entity__secondary-title",
      ], item);
      if (title) {
        items.push(company ? `${title} @ ${company}` : title);
      }
    }
    return items;
  }

  function extractSkills() {
    const skillsSection = document.querySelector("#skills")?.closest("section");
    if (!skillsSection) return [];
    return queryAllTexts([
      ".hoverable-link-text .visually-hidden",
      "span.t-bold span[aria-hidden='true']",
      ".pv-skill-category-entity__name-text",
    ], skillsSection, 8);
  }

  function extractFeatured() {
    const featuredSection = document.querySelector("#featured")?.closest("section");
    if (!featuredSection) return [];
    return queryAllTexts([
      ".t-bold span[aria-hidden='true']",
      ".hoverable-link-text span[aria-hidden='true']",
      ".feed-shared-text span[aria-hidden='true']",
      "span.visually-hidden",
    ], featuredSection, 3);
  }

  function extractEducation() {
    const educationSection = document.querySelector("#education")?.closest("section");
    if (!educationSection) return [];
    const items = [];
    const listItems = educationSection.querySelectorAll(
      ".pvs-list__paged-list-item, li.pvs-list__item--line-separated"
    );
    for (const item of Array.from(listItems).slice(0, 2)) {
      const school = queryText([
        ".t-bold span[aria-hidden='true']",
        ".mr1.t-bold span",
        "span.visually-hidden",
      ], item);
      const field = queryText([
        ".t-normal:not(.t-black--light) span[aria-hidden='true']",
        ".t-14.t-normal span[aria-hidden='true']",
      ], item);
      if (school) {
        items.push(field ? `${school} — ${field}` : school);
      }
    }
    return items;
  }

  function extractMutualConnections() {
    // LinkedIn renders this in the top card area
    const candidates = [
      ".pv-top-card--list .link-without-visited-state",
      ".pv-top-card--list-bullet .link-without-visited-state",
      "[href*='search/results/people'] span[aria-hidden='true']",
      ".distance-badge ~ span",
    ];
    const text = queryText(candidates);
    if (text && /\d/.test(text) && /(wspólnych|mutual)/i.test(text)) return text;

    // Fallback: scan all small texts in top card area for the pattern
    const topCard =
      document.querySelector("section.pv-top-card") ||
      document.querySelector(".pv-top-card--list") ||
      document.querySelector(".scaffold-layout__main");
    if (topCard) {
      const allSpans = topCard.querySelectorAll(".text-body-small, .t-14, span");
      for (const el of allSpans) {
        const t = el.textContent.trim();
        if (/\d+\s+(wspólnych kontaktów|mutual connections)/i.test(t)) return t;
      }
    }
    return null;
  }

  function extractFollowerCount() {
    const candidates = [
      ".pv-top-card--list .text-body-small",
      ".pv-top-card .follower-count",
      ".pvs-header__optional-link",
    ];
    const text = queryText(candidates);
    if (text && /(obserwuj|follower)/i.test(text)) return text;

    // Fallback: scan top card area for follower pattern
    const topCard =
      document.querySelector("section.pv-top-card") ||
      document.querySelector(".scaffold-layout__main");
    if (topCard) {
      const allSmall = topCard.querySelectorAll(".text-body-small, .t-14, span");
      for (const el of allSmall) {
        const t = el.textContent.trim();
        if (/[\d,]+\s*(obserwuj|follower)/i.test(t)) return t;
      }
    }
    return null;
  }

  function extractRecentActivity() {
    const activitySection =
      document.querySelector("#recent-activity")?.closest("section") ||
      document.querySelector("[data-generated-suggestion-target='recent_activity']")?.closest("section") ||
      document.querySelector(".pv-recent-activity-section");
    if (!activitySection) return [];
    return queryAllTexts([
      ".feed-shared-text span[aria-hidden='true']",
      ".t-bold span[aria-hidden='true']",
      ".update-components-text span[aria-hidden='true']",
      ".feed-shared-article__title span[aria-hidden='true']",
      "span.break-words",
    ], activitySection, 3);
  }

  function extractProfileUrl() {
    return window.location.href.split("?")[0].replace(/\/$/, "");
  }

  // ── Sync Extraction ──────────────────────────────────────────────

  function scrapeProfileNow() {
    const profile = {
      name: extractName(),
      headline: extractHeadline(),
      company: extractCompany(),
      location: extractLocation(),
      about: extractAbout(),
      experience: extractExperience(),
      skills: extractSkills(),
      featured: extractFeatured(),
      education: extractEducation(),
      mutual_connections: extractMutualConnections(),
      follower_count: extractFollowerCount(),
      recent_activity: extractRecentActivity(),
      profile_url: extractProfileUrl(),
    };

    const isValid = profile.name && profile.headline;

    return {
      success: isValid,
      profile: profile,
      error: isValid
        ? null
        : "Nie udało się wyciągnąć danych profilu. Czy jesteś na stronie linkedin.com/in/...?",
      timestamp: new Date().toISOString(),
    };
  }

  // ── Async Extraction (waits for SPA, retries lazy sections) ──────

  /**
   * Full scrape flow:
   * 
   * 1. WAIT for primary elements (name) via MutationObserver + polling.
   *    LinkedIn's React hydration can take 1-5s on slow connections.
   * 
   * 2. SCRAPE everything currently available in DOM.
   * 
   * 3. CHECK for lazy sections (experience, skills, about).
   *    These are loaded separately by LinkedIn after initial render.
   *    If missing → RETRY up to N times with delay.
   * 
   * 4. MERGE best results from all attempts.
   */
  async function scrapeProfileAsync() {
    // Step 1: Wait for name to appear
    const nameEl = await waitForElement(NAME_SELECTORS, CONFIG.PRIMARY_TIMEOUT_MS);

    if (!nameEl) {
      return {
        success: false,
        profile: null,
        error: "Timeout: LinkedIn nie wyrenderował profilu w ciągu "
             + (CONFIG.PRIMARY_TIMEOUT_MS / 1000) + "s. "
             + "Odśwież stronę i spróbuj ponownie.",
        timestamp: new Date().toISOString(),
      };
    }

    // Small grace period — headline often renders 100-300ms after name
    await delay(200);

    // Step 2: First scrape
    let bestResult = scrapeProfileNow();

    if (!bestResult.success) {
      return bestResult;
    }

    // Step 3: Check if lazy sections are missing
    const hasLazySections =
      bestResult.profile.about ||
      bestResult.profile.experience.length > 0 ||
      bestResult.profile.skills.length > 0;

    if (!hasLazySections) {
      for (let attempt = 1; attempt <= CONFIG.LAZY_RETRIES; attempt++) {
        await delay(CONFIG.LAZY_RETRY_DELAY_MS);

        // Wait for any lazy section anchor to appear
        await waitForElement(
          ["#experience", "#about", "#skills"],
          CONFIG.LAZY_TIMEOUT_MS
        );

        const retryResult = scrapeProfileNow();

        const nowHasLazy =
          retryResult.profile.about ||
          retryResult.profile.experience.length > 0 ||
          retryResult.profile.skills.length > 0;

        // Merge: keep version with more data
        mergeProfiles(bestResult.profile, retryResult.profile);

        if (nowHasLazy) {
          console.log(`[LinkedIn MSG] Lazy sections found on retry ${attempt}`);
          break;
        }

        console.log(
          `[LinkedIn MSG] Retry ${attempt}/${CONFIG.LAZY_RETRIES} — lazy sections still empty`
        );
      }
    }

    // Step 4: One final pass
    const finalResult = scrapeProfileNow();
    if (finalResult.success) {
      mergeProfiles(bestResult.profile, finalResult.profile);
    }

    return bestResult;
  }

  /**
   * Merge new data into base profile — only fills in missing or improves.
   */
  function mergeProfiles(base, newer) {
    if (!base || !newer) return;
    if (!base.about && newer.about) base.about = newer.about;
    if (!base.company && newer.company) base.company = newer.company;
    if (!base.location && newer.location) base.location = newer.location;
    if (!base.mutual_connections && newer.mutual_connections) base.mutual_connections = newer.mutual_connections;
    if (!base.follower_count && newer.follower_count) base.follower_count = newer.follower_count;
    if (newer.experience.length > base.experience.length) base.experience = newer.experience;
    if (newer.skills.length > base.skills.length) base.skills = newer.skills;
    if (newer.featured.length > base.featured.length) base.featured = newer.featured;
    if (newer.education.length > base.education.length) base.education = newer.education;
    if (newer.recent_activity.length > base.recent_activity.length) base.recent_activity = newer.recent_activity;
  }

  // ── SPA Navigation Detection ─────────────────────────────────────

  let lastUrl = window.location.href;

  function onUrlChange() {
    const newUrl = window.location.href;
    if (newUrl !== lastUrl) {
      lastUrl = newUrl;
      console.log("[LinkedIn MSG] SPA navigation detected:", newUrl);
    }
  }

  // Intercept History API (LinkedIn uses pushState for navigation)
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    onUrlChange();
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    onUrlChange();
  };

  window.addEventListener("popstate", onUrlChange);

  // ── Message Listener ─────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "scrapeProfile") {
      scrapeProfileAsync()
        .then(sendResponse)
        .catch((err) => {
          sendResponse({
            success: false,
            profile: null,
            error: `Błąd scrapowania: ${err.message}`,
          });
        });
      return true; // Keep channel open for async
    }
  });

  console.log("[LinkedIn MSG] Content script loaded on:", window.location.href);
})();
