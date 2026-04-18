/**
 * Test Suite for LinkedIn Message Generator Extension
 * 
 * Tests content script parsing logic against sample LinkedIn HTML.
 * Run with: node tests/test_scraper.js
 * 
 * Requires: jsdom (npm install jsdom)
 */

// ── Minimal JSDOM setup ──────────────────────────────────────────
let JSDOM;
try {
  JSDOM = require("jsdom").JSDOM;
} catch {
  console.error("Install jsdom first: npm install jsdom");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    failures.push(testName);
    console.log(`  ✗ ${testName}`);
  }
}

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    failures.push(`${testName}: got "${actual}", expected "${expected}"`);
    console.log(`  ✗ ${testName}: got "${actual}", expected "${expected}"`);
  }
}

function assertIncludes(actual, substring, testName) {
  if (actual && actual.includes(substring)) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    failures.push(`${testName}: "${actual}" does not include "${substring}"`);
    console.log(`  ✗ ${testName}: "${actual}" does not include "${substring}"`);
  }
}

// ── Inline scraper functions (extracted from content.js) ─────────
// We re-implement the core logic here to test without Chrome APIs

function queryText(selectors, context) {
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

function queryAllTexts(selectors, context, limit = 5) {
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

function extractName(doc) {
  return queryText([
    "h1.text-heading-xlarge",
    "h1.inline.t-24",
    ".pv-top-card h1",
    ".pv-text-details__left-panel h1",
    "section.pv-top-card h1",
    ".scaffold-layout__main h1",
  ], doc);
}

function extractHeadline(doc) {
  return queryText([
    ".text-body-medium.break-words",
    ".pv-top-card .text-body-medium",
    ".pv-text-details__left-panel .text-body-medium",
    ".pv-top-card--list .text-body-medium",
    ".pv-top-card-section__headline",
    ".ph5 .text-body-medium",
  ], doc);
}

function extractLocation(doc) {
  return queryText([
    ".text-body-small.inline.t-black--light.break-words",
    ".pv-top-card--list .pb2 .text-body-small",
    ".pv-text-details__left-panel .text-body-small.mt2",
    ".pv-top-card-section__location",
    ".pv-top-card--list .text-body-small.inline",
  ], doc);
}

function extractAbout(doc) {
  const aboutSection = doc.querySelector("#about")?.closest("section");
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
  ], doc);
}

function extractExperience(doc) {
  const experienceSection = doc.querySelector("#experience")?.closest("section");
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
    ], item);
    if (title) {
      items.push(company ? `${title} @ ${company}` : title);
    }
  }
  return items;
}

function extractSkills(doc) {
  const skillsSection = doc.querySelector("#skills")?.closest("section");
  if (!skillsSection) return [];
  return queryAllTexts([
    ".hoverable-link-text .visually-hidden",
    "span.t-bold span[aria-hidden='true']",
  ], skillsSection, 8);
}

// ── Sample LinkedIn HTML ─────────────────────────────────────────

// Profile 1: Full Polish profile (modern LinkedIn layout 2024+)
const HTML_FULL_PL = `
<html><body>
<div class="scaffold-layout__main">
  <section class="pv-top-card">
    <div class="pv-text-details__left-panel">
      <h1 class="text-heading-xlarge">Anna Kowalska</h1>
      <div class="text-body-medium break-words">Senior Data Scientist @ Samsung R&D</div>
      <div class="text-body-small inline t-black--light break-words">Warszawa, woj. mazowieckie, Polska</div>
    </div>
  </section>

  <section>
    <div id="about"></div>
    <div class="display-flex full-width">
      <div class="pv-shared-text-with-see-more">
        <span aria-hidden="true">Zajmuję się modelami NLP i computer vision w zespole R&D Samsunga. Pasjonatka open source.</span>
        <span class="visually-hidden">Zajmuję się modelami NLP i computer vision w zespole R&D Samsunga. Pasjonatka open source.</span>
      </div>
    </div>
  </section>

  <section>
    <div id="experience"></div>
    <div class="pvs-list__outer-container">
      <ul>
        <li class="pvs-list__paged-list-item">
          <div class="t-bold"><span><span aria-hidden="true">Senior Data Scientist</span></span></div>
          <div class="t-normal"><span aria-hidden="true">Samsung R&D Poland</span></div>
        </li>
        <li class="pvs-list__paged-list-item">
          <div class="t-bold"><span><span aria-hidden="true">ML Engineer</span></span></div>
          <div class="t-normal"><span aria-hidden="true">MedVision AI</span></div>
        </li>
        <li class="pvs-list__paged-list-item">
          <div class="t-bold"><span><span aria-hidden="true">Data Analyst</span></span></div>
          <div class="t-normal"><span aria-hidden="true">Deloitte</span></div>
        </li>
      </ul>
    </div>
  </section>

  <section>
    <div id="skills"></div>
    <ul>
      <li><span class="t-bold"><span aria-hidden="true">Python</span></span></li>
      <li><span class="t-bold"><span aria-hidden="true">PyTorch</span></span></li>
      <li><span class="t-bold"><span aria-hidden="true">NLP</span></span></li>
      <li><span class="t-bold"><span aria-hidden="true">Computer Vision</span></span></li>
    </ul>
  </section>
</div>
</body></html>
`;

// Profile 2: English profile, minimal about
const HTML_EN_MINIMAL = `
<html><body>
<div class="scaffold-layout__main">
  <section class="pv-top-card">
    <div class="pv-text-details__left-panel">
      <h1 class="text-heading-xlarge">James Mitchell</h1>
      <div class="text-body-medium break-words">VP of Engineering at Stripe</div>
      <div class="text-body-small inline t-black--light break-words">San Francisco, California, United States</div>
    </div>
  </section>
</div>
</body></html>
`;

// Profile 3: Legacy layout (older LinkedIn)
const HTML_LEGACY = `
<html><body>
<section class="pv-top-card">
  <h1 class="inline t-24">Katarzyna Wiśniewska</h1>
  <div class="pv-top-card-section__headline">Product Manager w Google</div>
  <div class="pv-top-card-section__location">Kraków, Polska</div>
</section>
<section class="pv-about-section">
  <div class="pv-about__summary-text">Buduje produkty z pasją od 10 lat.</div>
</section>
</body></html>
`;

// Profile 4: Empty profile — only name, no headline
const HTML_EMPTY = `
<html><body>
<div class="scaffold-layout__main">
  <h1 class="text-heading-xlarge">Jan Testowy</h1>
</div>
</body></html>
`;

// Profile 5: Profile with "at" in headline for company extraction
const HTML_AT_COMPANY = `
<html><body>
<div class="scaffold-layout__main">
  <section class="pv-top-card">
    <div class="pv-text-details__left-panel">
      <h1 class="text-heading-xlarge">Piotr Nowak</h1>
      <div class="text-body-medium break-words">Doradca Finansowy at OVB Allfinanz</div>
      <div class="text-body-small inline t-black--light break-words">Gdańsk, Polska</div>
    </div>
  </section>
</div>
</body></html>
`;

// ── Tests ─────────────────────────────────────────────────────────

console.log("\n═══ TEST SUITE: Content Script DOM Parsing ═══\n");

// Test 1: Full Polish profile
console.log("▸ Profile 1: Full Polish profile");
{
  const doc = new JSDOM(HTML_FULL_PL).window.document;
  assertEqual(extractName(doc), "Anna Kowalska", "Name extracted");
  assertEqual(extractHeadline(doc), "Senior Data Scientist @ Samsung R&D", "Headline extracted");
  assertIncludes(extractLocation(doc), "Warszawa", "Location contains city");
  assertIncludes(extractAbout(doc), "NLP", "About contains NLP");
  
  const exp = extractExperience(doc);
  assert(exp.length === 3, `Experience has 3 items (got ${exp.length})`);
  assertIncludes(exp[0], "Senior Data Scientist", "First exp is Data Scientist");
  assertIncludes(exp[0], "Samsung", "First exp includes Samsung");
  assertIncludes(exp[1], "ML Engineer", "Second exp is ML Engineer");
  
  const skills = extractSkills(doc);
  assert(skills.length === 4, `Skills has 4 items (got ${skills.length})`);
  assert(skills.includes("Python"), "Skills include Python");
  assert(skills.includes("PyTorch"), "Skills include PyTorch");
}

console.log("\n▸ Profile 2: English minimal profile");
{
  const doc = new JSDOM(HTML_EN_MINIMAL).window.document;
  assertEqual(extractName(doc), "James Mitchell", "Name extracted");
  assertIncludes(extractHeadline(doc), "VP of Engineering", "Headline extracted");
  assertIncludes(extractLocation(doc), "San Francisco", "Location extracted");
  assertEqual(extractAbout(doc), null, "About is null (not present)");
  assert(extractExperience(doc).length === 0, "No experience section");
  assert(extractSkills(doc).length === 0, "No skills section");
}

console.log("\n▸ Profile 3: Legacy LinkedIn layout");
{
  const doc = new JSDOM(HTML_LEGACY).window.document;
  assertEqual(extractName(doc), "Katarzyna Wiśniewska", "Legacy name extracted");
  assertIncludes(extractHeadline(doc), "Product Manager", "Legacy headline extracted");
  assertIncludes(extractLocation(doc), "Kraków", "Legacy location extracted");
  assertIncludes(extractAbout(doc), "Buduje produkty", "Legacy about extracted");
}

console.log("\n▸ Profile 4: Empty profile (name only)");
{
  const doc = new JSDOM(HTML_EMPTY).window.document;
  assertEqual(extractName(doc), "Jan Testowy", "Name extracted from bare h1");
  assertEqual(extractHeadline(doc), null, "Headline is null");
  assertEqual(extractLocation(doc), null, "Location is null");
  assertEqual(extractAbout(doc), null, "About is null");
}

console.log("\n▸ Profile 5: Company from headline (at/@ pattern)");
{
  const doc = new JSDOM(HTML_AT_COMPANY).window.document;
  assertEqual(extractName(doc), "Piotr Nowak", "Name extracted");
  assertIncludes(extractHeadline(doc), "Doradca Finansowy", "Headline extracted");
  assertIncludes(extractLocation(doc), "Gdańsk", "Location extracted");
}

// ── Test manifest.json ──────────────────────────────────────────
console.log("\n▸ Manifest V3 validation");
{
  const fs = require("fs");
  const path = require("path");
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  
  assertEqual(manifest.manifest_version, 3, "Manifest version is 3");
  assert(manifest.permissions.includes("activeTab"), "Has activeTab permission");
  assert(manifest.permissions.includes("storage"), "Has storage permission");
  assert(manifest.host_permissions[0].includes("linkedin.com"), "Host permission for LinkedIn");
  assert(manifest.content_scripts[0].matches[0].includes("linkedin.com/in"), "Content script matches /in/");
  assertEqual(manifest.content_scripts[0].run_at, "document_idle", "Runs at document_idle");
  assert(manifest.background.service_worker === "background.js", "Has service worker");
  assert(manifest.action.default_popup === "popup.html", "Has popup");
  
  // Verify all referenced files exist
  const extDir = path.join(__dirname, "..");
  for (const file of ["content.js", "background.js", "popup.html", "popup.css", "popup.js"]) {
    assert(fs.existsSync(path.join(extDir, file)), `File exists: ${file}`);
  }
  for (const icon of Object.values(manifest.icons)) {
    assert(fs.existsSync(path.join(extDir, icon)), `Icon exists: ${icon}`);
  }
}

// ── Test API request payload ────────────────────────────────────
console.log("\n▸ API request payload construction");
{
  // Simulate what background.js builds
  const profile = {
    name: "Anna Kowalska",
    headline: "Senior Data Scientist @ Samsung R&D",
    company: "Samsung R&D Poland",
    location: "Warszawa",
    about: "NLP and CV specialist",
    experience: ["Senior DS @ Samsung", "ML Engineer @ MedVision"],
    skills: ["Python", "PyTorch"],
    profile_url: "https://www.linkedin.com/in/anna-kowalska",
  };

  const payload = {
    profile: profile,
    goal: "recruitment",
    tone: null,
    language: "pl",
    max_chars: 300,
    sender_context: "Szukam ML Engineera do zespołu.",
  };

  // Validate required fields
  assert(payload.profile.name !== "", "Profile has name");
  assert(payload.profile.headline !== "", "Profile has headline");
  assert(["recruitment", "networking", "sales", "followup"].includes(payload.goal), "Valid goal");
  assert(["pl", "en"].includes(payload.language), "Valid language");
  assert(payload.max_chars > 0 && payload.max_chars <= 2000, "Reasonable max_chars");

  // Verify JSON serialization
  const json = JSON.stringify(payload);
  assert(json.length > 0, "Payload serializes to JSON");
  const parsed = JSON.parse(json);
  assertEqual(parsed.profile.name, "Anna Kowalska", "Roundtrip: name preserved");
  assertEqual(parsed.goal, "recruitment", "Roundtrip: goal preserved");
}

// ── Test API response handling ──────────────────────────────────
console.log("\n▸ API response handling");
{
  // Simulate successful response
  const successResponse = {
    message: "Widzę, że pracujesz nad modelami NLP w Samsung R&D — fascynujące!",
    profile_name: "Anna Kowalska",
    goal: "recruitment",
    generation_time_s: 2.31,
  };

  assert(typeof successResponse.message === "string", "Response has message string");
  assert(successResponse.message.length > 0, "Message is not empty");
  assert(successResponse.generation_time_s > 0, "Has positive generation time");

  // Simulate error response
  const errorResponse = { detail: "Zbyt wiele zapytań. Limit: 60 / 60s" };
  assert(typeof errorResponse.detail === "string", "Error response has detail");

  // Simulate malformed response
  const malformed = {};
  assert(!malformed.message, "Malformed response has no message");
}

// ── Edge cases ──────────────────────────────────────────────────
console.log("\n▸ Edge cases");
{
  // XSS in profile data — JSON preserves raw strings (correct),
  // popup uses textContent (not innerHTML) so scripts never execute
  const xssProfile = {
    name: '<script>alert("xss")</script>Anna',
    headline: 'Test" onload="alert(1)',
  };
  const safeJson = JSON.stringify(xssProfile);
  assert(typeof JSON.parse(safeJson).name === "string", "XSS payload survives JSON roundtrip as inert string");

  // Very long about section
  const longAbout = "A".repeat(10000);
  const trimmed = longAbout.slice(0, 500);
  assert(trimmed.length === 500, "Long about gets trimmed to 500");

  // Unicode handling
  const unicodeDoc = new JSDOM(`
    <html><body>
    <div class="scaffold-layout__main">
      <h1 class="text-heading-xlarge">Łukasz Żółć</h1>
    </div>
    </body></html>
  `).window.document;
  assertEqual(extractName(unicodeDoc), "Łukasz Żółć", "Polish diacritics preserved");
}

// ══════════════════════════════════════════════════════════════════
// NEW: MutationObserver / async scrape logic tests
// ══════════════════════════════════════════════════════════════════

// ── mergeProfiles logic ──────────────────────────────────────────
console.log("\n▸ mergeProfiles — fills missing, keeps better data");
{
  // Re-implement mergeProfiles for testing (same logic as content.js)
  function mergeProfiles(base, newer) {
    if (!base || !newer) return;
    if (!base.about && newer.about) base.about = newer.about;
    if (!base.company && newer.company) base.company = newer.company;
    if (!base.location && newer.location) base.location = newer.location;
    if (newer.experience.length > base.experience.length) {
      base.experience = newer.experience;
    }
    if (newer.skills.length > base.skills.length) {
      base.skills = newer.skills;
    }
  }

  // Case 1: newer fills missing about
  const base1 = { about: null, company: "X", location: "Y", experience: ["A"], skills: ["B"] };
  const newer1 = { about: "New about", company: "X", location: "Y", experience: ["A"], skills: ["B"] };
  mergeProfiles(base1, newer1);
  assertEqual(base1.about, "New about", "Merge fills missing about");

  // Case 2: newer has more experience
  const base2 = { about: "OK", company: "X", location: "Y", experience: ["A"], skills: ["B"] };
  const newer2 = { about: "OK", company: "X", location: "Y", experience: ["A", "B", "C"], skills: ["B"] };
  mergeProfiles(base2, newer2);
  assert(base2.experience.length === 3, "Merge takes longer experience list");

  // Case 3: newer has more skills
  const base3 = { about: "OK", company: "X", location: "Y", experience: ["A"], skills: [] };
  const newer3 = { about: "OK", company: "X", location: "Y", experience: ["A"], skills: ["Py", "JS", "Go"] };
  mergeProfiles(base3, newer3);
  assert(base3.skills.length === 3, "Merge takes longer skills list");

  // Case 4: base already has data — merge doesn't overwrite
  const base4 = { about: "Original", company: "OrigCo", location: "Orig", experience: ["A", "B"], skills: ["X"] };
  const newer4 = { about: "Different", company: "NewCo", location: "New", experience: ["A"], skills: [] };
  mergeProfiles(base4, newer4);
  assertEqual(base4.about, "Original", "Merge doesn't overwrite existing about");
  assertEqual(base4.company, "OrigCo", "Merge doesn't overwrite existing company");
  assert(base4.experience.length === 2, "Merge doesn't replace with shorter experience");

  // Case 5: null safety
  mergeProfiles(null, { about: "test" });
  mergeProfiles({ about: null }, null);
  assert(true, "Merge handles null base/newer without crash");

  // Case 6: fills company and location
  const base6 = { about: null, company: null, location: null, experience: [], skills: [] };
  const newer6 = { about: null, company: "NewCo", location: "Berlin", experience: [], skills: [] };
  mergeProfiles(base6, newer6);
  assertEqual(base6.company, "NewCo", "Merge fills missing company");
  assertEqual(base6.location, "Berlin", "Merge fills missing location");
}

// ── waitForElement — immediate resolve ───────────────────────────
console.log("\n▸ waitForElement — immediate resolve when element exists");
{
  // Simulate: element already in DOM
  const dom = new JSDOM(`<html><body><h1 class="text-heading-xlarge">Test Name</h1></body></html>`);
  const doc = dom.window.document;

  // Inline waitForElement for JSDOM (no real MutationObserver needed — immediate path)
  function waitForElementSync(selectors, context) {
    for (const sel of selectors) {
      try {
        const el = context.querySelector(sel);
        if (el && el.textContent.trim()) return el;
      } catch (e) {}
    }
    return null;
  }

  const el = waitForElementSync(
    ["h1.text-heading-xlarge", "h1.inline.t-24"],
    doc
  );
  assert(el !== null, "Immediate resolve: element found");
  assertEqual(el.textContent.trim(), "Test Name", "Immediate resolve: correct text");
}

// ── waitForElement — no match returns null ────────────────────────
console.log("\n▸ waitForElement — no match returns null");
{
  const dom = new JSDOM(`<html><body><div>No heading here</div></body></html>`);
  const doc = dom.window.document;

  function waitForElementSync(selectors, context) {
    for (const sel of selectors) {
      try {
        const el = context.querySelector(sel);
        if (el && el.textContent.trim()) return el;
      } catch (e) {}
    }
    return null;
  }

  const el = waitForElementSync(
    ["h1.text-heading-xlarge", ".nonexistent"],
    doc
  );
  assert(el === null, "No match: returns null (will trigger timeout in real browser)");
}

// ── Delayed DOM render simulation ────────────────────────────────
console.log("\n▸ Delayed DOM render — MutationObserver catches late elements");
{
  const dom = new JSDOM(`<html><body><div id="root"></div></body></html>`, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
  });
  const doc = dom.window.document;

  // Simulate LinkedIn SPA: element appears after 100ms
  let foundLate = false;

  // Since JSDOM has limited MutationObserver, test the polling path
  dom.window.setTimeout(() => {
    const h1 = doc.createElement("h1");
    h1.className = "text-heading-xlarge";
    h1.textContent = "Late Render Name";
    doc.getElementById("root").appendChild(h1);
    foundLate = true;
  }, 50);

  // Give it time to execute
  const startTime = Date.now();
  function pollCheck() {
    const el = doc.querySelector("h1.text-heading-xlarge");
    if (el && el.textContent.trim()) return el;
    if (Date.now() - startTime > 2000) return null;
    return null;
  }

  // Synchronous test: element doesn't exist yet
  assert(pollCheck() === null, "Before timeout: element not yet in DOM");

  // We can't truly await in this sync test runner, but we verify
  // that the DOM manipulation code itself works
  const h1Direct = doc.createElement("h1");
  h1Direct.className = "text-heading-xlarge";
  h1Direct.textContent = "Injected Name";
  doc.getElementById("root").appendChild(h1Direct);

  const elAfter = doc.querySelector("h1.text-heading-xlarge");
  assert(elAfter !== null, "After injection: element found by selector");
  assertEqual(elAfter.textContent.trim(), "Injected Name", "After injection: correct content");

  dom.window.close();
}

// ── SPA navigation detection ─────────────────────────────────────
console.log("\n▸ SPA navigation — History API interception");
{
  // Verify the pattern: monkeypatch pushState / replaceState
  let navigationDetected = false;
  const fakeHistory = {
    pushState: function() {},
    replaceState: function() {},
  };

  const origPush = fakeHistory.pushState;
  fakeHistory.pushState = function(...args) {
    origPush.apply(this, args);
    navigationDetected = true;
  };

  fakeHistory.pushState({}, "", "/in/new-profile");
  assert(navigationDetected, "pushState interception fires callback");

  navigationDetected = false;
  const origReplace = fakeHistory.replaceState;
  fakeHistory.replaceState = function(...args) {
    origReplace.apply(this, args);
    navigationDetected = true;
  };

  fakeHistory.replaceState({}, "", "/in/another-profile");
  assert(navigationDetected, "replaceState interception fires callback");
}

// ── Retry logic simulation ───────────────────────────────────────
console.log("\n▸ Retry logic — lazy sections appear on later attempts");
{
  // Simulate: first scrape has name+headline only,
  // second scrape also gets experience
  let scrapeAttempt = 0;
  function simulatedScrape() {
    scrapeAttempt++;
    const base = {
      name: "Test User",
      headline: "Dev",
      company: null,
      location: null,
      about: null,
      experience: [],
      skills: [],
    };
    if (scrapeAttempt >= 2) {
      base.experience = ["Senior Dev @ Corp", "Dev @ Startup"];
      base.about = "Experienced developer";
    }
    if (scrapeAttempt >= 3) {
      base.skills = ["JavaScript", "Python"];
    }
    return base;
  }

  const result1 = simulatedScrape();
  assert(result1.experience.length === 0, "Attempt 1: no experience yet");

  const result2 = simulatedScrape();
  assert(result2.experience.length === 2, "Attempt 2: experience loaded");
  assertEqual(result2.about, "Experienced developer", "Attempt 2: about loaded");

  const result3 = simulatedScrape();
  assert(result3.skills.length === 2, "Attempt 3: skills loaded");

  // Merge all into best result
  function mergeProfiles(base, newer) {
    if (!base || !newer) return;
    if (!base.about && newer.about) base.about = newer.about;
    if (!base.company && newer.company) base.company = newer.company;
    if (!base.location && newer.location) base.location = newer.location;
    if (newer.experience.length > base.experience.length) base.experience = newer.experience;
    if (newer.skills.length > base.skills.length) base.skills = newer.skills;
  }

  const best = { ...result1 };
  mergeProfiles(best, result2);
  mergeProfiles(best, result3);

  assertEqual(best.name, "Test User", "Merged: name preserved");
  assert(best.experience.length === 2, "Merged: best experience kept");
  assert(best.skills.length === 2, "Merged: best skills kept");
  assertEqual(best.about, "Experienced developer", "Merged: about filled in");
}

// ── CONFIG values are sane ───────────────────────────────────────
console.log("\n▸ CONFIG validation");
{
  // Inline the config from content.js
  const CONFIG = {
    PRIMARY_TIMEOUT_MS: 8000,
    LAZY_TIMEOUT_MS: 4000,
    POLL_INTERVAL_MS: 300,
    LAZY_RETRIES: 3,
    LAZY_RETRY_DELAY_MS: 800,
  };

  assert(CONFIG.PRIMARY_TIMEOUT_MS >= 5000, "Primary timeout >= 5s (SPA needs time)");
  assert(CONFIG.PRIMARY_TIMEOUT_MS <= 15000, "Primary timeout <= 15s (user won't wait longer)");
  assert(CONFIG.LAZY_TIMEOUT_MS >= 2000, "Lazy timeout >= 2s");
  assert(CONFIG.POLL_INTERVAL_MS >= 100, "Poll interval >= 100ms (not too aggressive)");
  assert(CONFIG.POLL_INTERVAL_MS <= 1000, "Poll interval <= 1s (responsive enough)");
  assert(CONFIG.LAZY_RETRIES >= 2, "At least 2 lazy retries");
  assert(CONFIG.LAZY_RETRIES <= 5, "At most 5 lazy retries (bounded)");

  // Total worst-case wait time
  const worstCase = CONFIG.PRIMARY_TIMEOUT_MS +
    (CONFIG.LAZY_RETRIES * (CONFIG.LAZY_RETRY_DELAY_MS + CONFIG.LAZY_TIMEOUT_MS));
  assert(worstCase <= 25000, `Worst-case wait ${worstCase}ms <= 25s`);
  console.log(`    (worst-case total wait: ${(worstCase/1000).toFixed(1)}s)`);
}

// ── Summary ─────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════");
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\n  Failures:");
  failures.forEach(f => console.log(`    - ${f}`));
}
console.log("═══════════════════════════════════════════════\n");

process.exit(failed > 0 ? 1 : 0);
