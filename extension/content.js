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

  // Guard: content.js can be injected multiple times (manifest + popup's
  // executeScript fallback + SPA navigations). Without this guard each
  // injection registers another chrome.runtime.onMessage listener — every
  // scrape request then gets N responses, and the late ones fire after the
  // channel is closed, spamming "chrome-extension://invalid/ net::ERR_FAILED".
  if (window.__LINKEDIN_MSG_LOADED__) {
    console.log("[LinkedIn MSG] Already loaded, skipping re-injection");
    return;
  }
  window.__LINKEDIN_MSG_LOADED__ = true;

  // ── Configuration ────────────────────────────────────────────────

  const CONFIG = {
    // Max time to wait for primary elements (name, headline)
    PRIMARY_TIMEOUT_MS: 15000,
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
    // Known historical class names (LinkedIn rotates these)
    "h1.text-heading-xlarge",
    "h1.inline.t-24",
    "h1.top-card-layout__title",
    // Container-scoped
    ".pv-top-card h1",
    ".pv-text-details__left-panel h1",
    "section.pv-top-card h1",
    ".scaffold-layout__main h1",
    ".ph5 h1",
    "[data-view-name='profile-card'] h1",
    // Generic fallback: any h1 under main content
    "main h1",
    "main section h1",
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
    const fromSelectors = queryText(NAME_SELECTORS);
    if (fromSelectors) return fromSelectors;
    // Fallback — any h1 under main content with plausible name text
    const h = findAnyLikelyNameHeading();
    return h ? h.textContent.trim() : null;
  }

  /**
   * Last-resort name finder: scans all h1 on the page, picks the first one
   * whose text looks like a name (short, no typical UI labels, 2+ words).
   * Used when brand-specific selectors all fail (LinkedIn DOM change).
   */
  function findAnyLikelyNameHeading() {
    const UI_NOISE = /^(home|profil|wiadomo|messag|search|szukaj|notification|powiadom|menu|nav)/i;
    const h1s = document.querySelectorAll("main h1, .scaffold-layout h1, h1");
    for (const h of h1s) {
      const t = (h.textContent || "").trim();
      if (!t) continue;
      if (t.length < 3 || t.length > 120) continue;
      if (UI_NOISE.test(t)) continue;
      return h;
    }
    return null;
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

  // ── Voyager JSON extraction (primary source) ─────────────────────
  //
  // LinkedIn pre-renders API responses into <code id="bpr-guid-..."> tags
  // for React hydration. Parsing these is layout-independent — survives
  // DOM class rotations and A/B layout tests.
  //
  // We detect entities by SHAPE, not by $type strings, because Voyager
  // URN schemas vary (com.linkedin.voyager.identity.profile.Profile,
  // com.linkedin.voyager.dash.identity.profile.Profile, etc.).

  function collectVoyagerIncluded() {
    const tags = document.querySelectorAll('code[id^="bpr-guid-"]');
    const all = [];
    for (const tag of tags) {
      let payload;
      try { payload = JSON.parse(tag.textContent); } catch { continue; }
      // Voyager responses wrap data differently across endpoints.
      // Search multiple plausible locations for an `included` array.
      const candidates = [
        payload?.included,
        payload?.data?.included,
        payload?.response?.included,
      ];
      for (const arr of candidates) {
        if (Array.isArray(arr)) {
          for (const e of arr) if (e && typeof e === "object") all.push(e);
        }
      }
    }
    return all;
  }

  function isProfileEntity(e) {
    return e.firstName && e.lastName && (e.headline || e.summary || e.locationName || e.geoLocationName);
  }
  function isPositionEntity(e) {
    return e.title && (e.companyName || e.companyUrn || e.company) && (e.timePeriod || e.dateRange);
  }
  function isCompanyEntity(e) {
    return e.name && e.entityUrn && /company/i.test(String(e.entityUrn));
  }
  function isEducationEntity(e) {
    return (e.schoolName || (e.school && e.school.name)) && (e.degreeName || e.fieldOfStudy || e.schoolUrn);
  }

  function currentFlag(e) {
    // Position has open-ended date range if endDate/endMonth is null/missing.
    const tp = e.timePeriod || e.dateRange;
    if (!tp) return false;
    const end = tp.endDate || tp.end || null;
    return !end || (end && end.year == null && end.month == null);
  }

  function resolveCompanyNameFromPos(pos, companiesByUrn) {
    if (pos.companyName) return pos.companyName;
    if (pos.company && typeof pos.company === "object" && pos.company.name) return pos.company.name;
    const urn = pos.companyUrn || pos.company;
    if (typeof urn === "string" && companiesByUrn.has(urn)) {
      return companiesByUrn.get(urn).name || "";
    }
    return "";
  }

  function extractFromVoyagerPayloads() {
    const included = collectVoyagerIncluded();
    if (included.length === 0) return null;

    const profile = included.find(isProfileEntity);
    if (!profile) return null;

    const positions = included.filter(isPositionEntity);
    const educations = included.filter(isEducationEntity);
    const companies = new Map();
    for (const e of included) if (isCompanyEntity(e)) companies.set(e.entityUrn, e);

    const currentPos = positions.find(currentFlag) || positions[0];
    const company = currentPos ? resolveCompanyNameFromPos(currentPos, companies) : "";

    const name = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    const headline = profile.headline || "";
    const about = profile.summary || "";
    const location = profile.locationName || profile.geoLocationName || "";

    const experience = positions.slice(0, 5).map((p) => {
      const c = resolveCompanyNameFromPos(p, companies);
      return c ? `${p.title} @ ${c}` : p.title;
    });

    const education = educations.slice(0, 3).map((e) => {
      const school = e.schoolName || (e.school && e.school.name) || "";
      const field = e.degreeName || e.fieldOfStudy || "";
      return field ? `${school} — ${field}` : school;
    }).filter(Boolean);

    return {
      name,
      headline,
      company,
      location,
      about,
      experience,
      education,
      skills: [],
      featured: [],
      mutual_connections: null,
      follower_count: null,
      recent_activity: [],
      profile_url: extractProfileUrl(),
    };
  }

  // ── Feed-layout extraction (LinkedIn 2025 SPA variant) ───────────
  //
  // On the new LinkedIn variant, /in/<slug> renders as a feed of the
  // person's posts (not a classic top card). Classes are opaque hashes
  // that rotate between deploys, so we navigate by stable anchors:
  // the profile URL link and its author card.
  //
  // Author card structure (repeated per post):
  //   <a href="https://linkedin.com/in/<slug>/">
  //     <div aria-label="<Name> Zweryfikowano Profil <n>.">
  //       <p>Name</p>
  //       <p>• <n></p>                         (verification + connection)
  //       <p>Tagline / headline...</p>
  //     </div>
  //   </a>
  //
  // Post body uses data-testid="expandable-text-box" — stable across deploys.

  function extractSlugFromUrl() {
    const m = window.location.pathname.match(/\/in\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function extractFromFeedLayout() {
    const slug = extractSlugFromUrl();
    if (!slug) return null;

    // Derive name fragments from the URL slug (handles Polish diacritics etc.)
    // "anna-wo%C5%82osz-b34517386" → ["anna", "wołosz"]  (numeric suffix dropped)
    let decodedSlug;
    try { decodedSlug = decodeURIComponent(slug).toLowerCase(); }
    catch { decodedSlug = slug.toLowerCase(); }
    // LinkedIn slugs end with an alphanumeric id like "b34517386" or
    // "315531199" — drop anything containing a digit, keep pure name parts.
    const slugParts = decodedSlug.split(/[-_]/).filter((p) => !/\d/.test(p) && p.length >= 2);
    if (slugParts.length === 0) return null;

    const main = document.querySelector("main");
    if (!main) return null;

    // Guard 1: classic top-card layout always includes <h1> with the person's
    // name. If present, let the DOM path handle the scrape — it gets full
    // experience / about / skills, which this extractor cannot reach.
    if (main.querySelector("h1")) return null;

    // Guard 2: real feed-layout pages render posts via data-testid=
    // "expandable-text-box". Absence means this is neither classic nor feed
    // — skip, let DOM path try and fall through to a diagnostic if it fails.
    if (!main.querySelector('[data-testid="expandable-text-box"]')) return null;

    // Primary: find the aria-label marker naming the profile owner. The marker
    // looks like <div aria-label="Anna Wołosz Zweryfikowano Profil 2."> and is
    // LinkedIn's stable handle for the author card; the div itself only wraps
    // name + connection level — the headline and timestamp live in SIBLING
    // divs, so we expand to the surrounding <a href="/in/slug"> which
    // contains the full card.
    let authorAnchor = null;
    for (const el of main.querySelectorAll("[aria-label]")) {
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      if (!slugParts.every((p) => label.includes(p))) continue;
      const anchor = el.closest("a[href*='/in/']");
      if (anchor && anchor.querySelectorAll("p").length >= 2) {
        authorAnchor = anchor;
        break;
      }
    }

    // Fallback: any <a href="/in/SLUG"> whose decoded href contains all name
    // fragments AND whose first <p> looks like a two-word name. Filters out
    // sponsored cards that happen to link to the profile.
    if (!authorAnchor) {
      for (const a of main.querySelectorAll("a[href*='/in/']")) {
        const rawHref = a.getAttribute("href") || "";
        let href;
        try { href = decodeURIComponent(rawHref).toLowerCase(); }
        catch { href = rawHref.toLowerCase(); }
        if (!slugParts.every((p) => href.includes(p))) continue;
        if (a.querySelectorAll("p").length < 2) continue;
        const firstP = (a.querySelector("p")?.textContent || "").trim();
        if (firstP.length > 0 && firstP.length < 80 && /^\S+\s+\S+/.test(firstP)) {
          authorAnchor = a;
          break;
        }
      }
    }

    if (!authorAnchor) return null;

    const paragraphs = Array.from(authorAnchor.querySelectorAll("p"))
      .map((p) => p.textContent.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) return null;

    const name = paragraphs[0];

    // Sanity: the name we picked must actually contain a slug fragment, else
    // we grabbed a promoted post card that slipped through the filter.
    const nameLower = name.toLowerCase();
    if (!slugParts.some((p) => nameLower.includes(p))) return null;

    // Headline = first paragraph after the name that isn't:
    //  - the verification / connection-level pill ("• 2", "1st")
    //  - a relative-time stamp ("4 dni • Edytowano", "2 tyg. temu")
    const headline = paragraphs.slice(1).find((t) =>
      t.length > 10
      && !/^[•·]\s*\d+$/.test(t)
      && !/^\d+(st|nd|rd|\.)?$/i.test(t)
      && !/\bEdytowano\b/i.test(t)
      && !/^\d+\s*(dni|dzień|godz|tyg|mies|rok|lat|min|sek)\b/i.test(t)
    ) || "";

    if (!headline) return null;

    // Collect recent posts — iterate over all expandable-text-box elements
    // (each is one post body) and walk upward until we find the first
    // <a href="/in/"> — that's the post's author. Keep only posts where the
    // author is the profile owner (filters out promoted / reactor content).
    const posts = [];
    const seen = new Set();
    const textEls = main.querySelectorAll('[data-testid="expandable-text-box"]');
    const FOLLOWING = 0x04; // Node.DOCUMENT_POSITION_FOLLOWING
    for (const textEl of textEls) {
      // Walk up, at each level look for the NEAREST author link preceding
      // textEl in DOM order (reversed iteration). The closest-before author
      // is the post author — anyone further back is a reactor / commenter
      // from a prior post in the feed.
      let p = textEl.parentElement;
      let depth = 0;
      let nearestAuthorHref = null;
      while (p && depth < 20 && !nearestAuthorHref) {
        const authors = Array.from(p.querySelectorAll("a[href*='/in/']")).reverse();
        for (const a of authors) {
          // a precedes textEl iff textEl is positioned FOLLOWING a.
          if (a.compareDocumentPosition(textEl) & FOLLOWING) {
            nearestAuthorHref = a.getAttribute("href") || "";
            break;
          }
        }
        p = p.parentElement;
        depth++;
      }
      if (!nearestAuthorHref) continue;
      let fh;
      try { fh = decodeURIComponent(nearestAuthorHref).toLowerCase(); }
      catch { fh = nearestAuthorHref.toLowerCase(); }
      if (!slugParts.every((sp) => fh.includes(sp))) continue;

      const text = textEl.textContent.trim().replace(/\s+/g, " ").slice(0, 500);
      if (text && !seen.has(text) && text.length > 40) {
        seen.add(text);
        posts.push(text);
      }
      if (posts.length >= 3) break;
    }

    return {
      name,
      headline,
      company: "",
      location: "",
      about: "",
      experience: [],
      skills: [],
      featured: [],
      education: [],
      mutual_connections: null,
      follower_count: null,
      recent_activity: posts,
      profile_url: extractProfileUrl(),
    };
  }

  // ── JSON-LD extraction (secondary source) ────────────────────────

  function extractFromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      let data;
      try { data = JSON.parse(script.textContent); } catch { continue; }
      const candidates = Array.isArray(data?.["@graph"]) ? data["@graph"] : [data];
      const person = candidates.find((c) => c && c["@type"] === "Person" && c.name);
      if (!person) continue;

      return {
        name: person.name || "",
        headline: person.jobTitle || "",
        company: (person.worksFor && person.worksFor.name) || "",
        location: (person.address && person.address.addressLocality)
          || (person.homeLocation && person.homeLocation.name) || "",
        about: person.description || "",
        experience: [],
        education: [],
        skills: [],
        featured: [],
        mutual_connections: null,
        follower_count: null,
        recent_activity: [],
        profile_url: person.url || extractProfileUrl(),
      };
    }
    return null;
  }

  // ── Enriched diagnostics ─────────────────────────────────────────

  function collectDiagnostics() {
    const voyagerTags = document.querySelectorAll('code[id^="bpr-guid-"]');
    const jsonLdTags = document.querySelectorAll('script[type="application/ld+json"]');

    let voyagerHasProfile = false;
    let voyagerProfileFields = null;
    for (const tag of voyagerTags) {
      try {
        const p = JSON.parse(tag.textContent);
        const arrs = [p?.included, p?.data?.included, p?.response?.included].filter(Array.isArray);
        for (const arr of arrs) {
          const prof = arr.find((e) => e && isProfileEntity(e));
          if (prof) {
            voyagerHasProfile = true;
            voyagerProfileFields = Object.keys(prof).slice(0, 20);
            break;
          }
        }
        if (voyagerHasProfile) break;
      } catch {}
    }

    return {
      url: window.location.href,
      readyState: document.readyState,
      title: document.title,
      hasMain: !!document.querySelector("main"),
      h1Count: document.querySelectorAll("h1").length,
      h1Texts: Array.from(document.querySelectorAll("h1")).map((h) => h.textContent.trim().slice(0, 80)),
      h2Count: document.querySelectorAll("h2").length,
      ariaHeadingCount: document.querySelectorAll("[role=heading]").length,
      voyagerPayloadCount: voyagerTags.length,
      voyagerHasProfile,
      voyagerProfileFields,
      jsonLdCount: jsonLdTags.length,
      hasTopCard: !!document.querySelector(".pv-top-card, section.pv-top-card, .ph5"),
      hasExperience: !!document.querySelector("#experience"),
      hasAbout: !!document.querySelector("#about"),
      hasAuthGate: !!document.querySelector(
        ".authwall, .auth-wall, [data-tracking-control-name*='public_profile'], " +
        ".join-form, .sign-in-form, .cold-join-form"
      ),
      mainClass: document.querySelector("main")?.className?.slice(0, 200) || null,
      topSectionIds: Array.from(document.querySelectorAll("main section"))
        .slice(0, 10)
        .map((s) => s.id || s.getAttribute("aria-label") || "anon"),
    };
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
    // Priority 1: Voyager JSON (layout-independent, most reliable)
    // Give React one short tick to paste payloads into the DOM.
    await waitForElement(
      ['code[id^="bpr-guid-"]', "main h1", "main h2"],
      3000
    );
    let voyager = extractFromVoyagerPayloads();
    if (voyager && voyager.name && voyager.headline) {
      console.log("[LinkedIn MSG] Extracted via Voyager JSON");
      voyager._source = "voyager";
      return { success: true, profile: voyager, error: null, timestamp: new Date().toISOString() };
    }

    // Priority 2: JSON-LD Person schema (secondary, often present on profiles)
    const jsonLd = extractFromJsonLd();
    if (jsonLd && jsonLd.name) {
      // If Voyager gave partial data (e.g. name but no headline), merge.
      const base = voyager || jsonLd;
      const merged = { ...jsonLd, ...(voyager || {}) };
      // Fill blanks from jsonLd where voyager was empty
      if (!merged.headline && jsonLd.headline) merged.headline = jsonLd.headline;
      if (!merged.about && jsonLd.about) merged.about = jsonLd.about;
      if (!merged.company && jsonLd.company) merged.company = jsonLd.company;
      if (!merged.location && jsonLd.location) merged.location = jsonLd.location;
      if (merged.name && merged.headline) {
        console.log("[LinkedIn MSG] Extracted via JSON-LD", voyager ? "(merged with partial Voyager)" : "");
        merged._source = voyager ? "voyager+jsonld" : "jsonld";
        return { success: true, profile: merged, error: null, timestamp: new Date().toISOString() };
      }
    }

    // Priority 2.5: Feed-layout variant (LinkedIn 2025 SPA — no top card,
    // profile page renders as author's post feed). Navigates via stable
    // <a href="/in/slug"> anchors + aria-label-marked author cards.
    const feed = extractFromFeedLayout();
    if (feed && feed.name && feed.headline) {
      console.log("[LinkedIn MSG] Extracted via feed layout");
      feed._source = "feed";
      return { success: true, profile: feed, error: null, timestamp: new Date().toISOString() };
    }

    // Priority 3: DOM scraping (legacy path, retained for the classic layout).
    // Step 1: Wait for name to appear
    const nameEl = await waitForElement(NAME_SELECTORS, CONFIG.PRIMARY_TIMEOUT_MS);

    if (!nameEl) {
      const lastResort = findAnyLikelyNameHeading();
      if (lastResort) {
        console.warn("[LinkedIn MSG] Primary selectors failed; using fallback h1:", lastResort);
      } else {
        const diagnostic = collectDiagnostics();
        console.warn("[LinkedIn MSG] Scrape timeout. Diagnostic:", diagnostic);

        // If Voyager payloads are present but we couldn't extract — log that too.
        if (diagnostic.voyagerPayloadCount > 0 && !diagnostic.voyagerHasProfile) {
          console.warn(
            "[LinkedIn MSG] Voyager payloads present but no profile entity detected. " +
            "Shape may have changed — paste this diagnostic to report."
          );
        }

        const looksLikeAuthwall =
          diagnostic.h1Count === 0 && !diagnostic.hasTopCard
          && !diagnostic.hasExperience && !diagnostic.hasAbout
          && diagnostic.voyagerPayloadCount === 0
          && diagnostic.jsonLdCount === 0;

        let message;
        if (diagnostic.hasAuthGate || looksLikeAuthwall) {
          message =
            "LinkedIn nie pokazuje tego profilu. Najczęstsze przyczyny:\n"
            + "1) Nie jesteś zalogowany — wejdź na linkedin.com, zaloguj się i odśwież tę stronę.\n"
            + "2) LinkedIn zablokował Cię tymczasowo (zbyt dużo wejść na profile). Poczekaj 15-30 min.\n"
            + "3) Profil jest widoczny tylko dla kontaktów, z którymi masz koneksję.";
        } else if (diagnostic.voyagerPayloadCount > 0 || diagnostic.jsonLdCount > 0) {
          message =
            "Nie umiem wyciągnąć danych z tego wariantu LinkedIn. "
            + "Otwórz DevTools (F12) → Console, znajdź wpis [LinkedIn MSG] Scrape timeout "
            + "i prześlij diagnostykę.";
        } else {
          message =
            "Timeout: LinkedIn nie wyrenderował profilu w "
            + (CONFIG.PRIMARY_TIMEOUT_MS / 1000) + "s. "
            + "Odśwież stronę i spróbuj ponownie.";
        }

        return {
          success: false,
          profile: null,
          error: message,
          diagnostics: diagnostic,
          timestamp: new Date().toISOString(),
        };
      }
    }

    await delay(200);

    let bestResult = scrapeProfileNow();
    if (!bestResult.success) return bestResult;

    const hasLazySections =
      bestResult.profile.about ||
      bestResult.profile.experience.length > 0 ||
      bestResult.profile.skills.length > 0;

    if (!hasLazySections) {
      for (let attempt = 1; attempt <= CONFIG.LAZY_RETRIES; attempt++) {
        await delay(CONFIG.LAZY_RETRY_DELAY_MS);
        await waitForElement(["#experience", "#about", "#skills"], CONFIG.LAZY_TIMEOUT_MS);
        const retryResult = scrapeProfileNow();
        const nowHasLazy =
          retryResult.profile.about ||
          retryResult.profile.experience.length > 0 ||
          retryResult.profile.skills.length > 0;
        mergeProfiles(bestResult.profile, retryResult.profile);
        if (nowHasLazy) {
          console.log(`[LinkedIn MSG] Lazy sections found on retry ${attempt}`);
          break;
        }
      }
    }

    const finalResult = scrapeProfileNow();
    if (finalResult.success) mergeProfiles(bestResult.profile, finalResult.profile);

    bestResult.profile._source = "dom";
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
    // Orphan check: after the extension is reloaded/updated, old content
    // scripts in already-open tabs lose their runtime connection. Calling
    // sendResponse here would throw "chrome-extension://invalid/ ERR_FAILED".
    if (!chrome.runtime?.id) return;

    if (message.action === "scrapeProfile") {
      scrapeProfileAsync()
        .then((result) => {
          if (!chrome.runtime?.id) return;
          sendResponse(result);
        })
        .catch((err) => {
          if (!chrome.runtime?.id) return;
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
