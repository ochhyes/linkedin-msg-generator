/**
 * Search Results extractor tests (#18 Faza 1A) — wykrywa regresje
 * DOM SDUI dla `/search/results/people/` ZANIM zespół OVB zauważy.
 * Fixture to realny DOM zrzucony przez Marcina z search "OVB".
 *
 * Run: node tests/test_search_extractor.js
 *
 * Fixtures:
 *  - search_results_people.html — search "ovb", 10 listitems, all 2nd degree
 *
 * UWAGA: `extractSearchResults(doc)` jest tu RE-IMPLEMENTOWANY (taka sama
 * logika jak w extension/content.js). Vanilla JS / brak modułów ES, więc
 * import niemożliwy bez dodatkowego bundlera. Synchronizuj ręcznie po
 * zmianach w content.js. To samo dług co w test_e2e.js — refaktor
 * tracking'owany w #10 BACKLOG (selectors.json + auto-fallback chain).
 */

const fs = require("fs");
const path = require("path");

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

function assert(condition, testName, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    failures.push(`${testName}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${testName}${detail ? ` — ${detail}` : ""}`);
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

// ── Search results extractor (port z extension/content.js) ────────
//
// Plan implementacji #18 step 2 — re-implementowane tu dla testów
// (parametryzacja po `doc`, nie globalne `window.document`).
//
// Pseudocode:
//  - Root: doc.querySelectorAll('div[role="listitem"]'), filter
//    przez obecność a[href*="/in/"] (skip cards bez profilu).
//  - Per item: parsuj p[0] → name + degree po " • " (lastIndexOf,
//    bo nazwy mogą mieć kropki/bullets). headline = p[1], location = p[2].
//  - Slug: regex /\/in\/([^/?#]+)/ na href profilowego linka.
//  - buttonState: connect link (a[href*="/preload/search-custom-invite/"])
//    → "Connect"; message link (a[href*="/messaging/"]) → "Message";
//    fallback "Pending" gdy textContent zawiera "Oczekuje" lub "Pending";
//    else "Unknown".

function extractSearchResults(doc) {
  const items = doc.querySelectorAll('div[role="listitem"]');
  const results = [];
  const isMutualText = (s) =>
    /wspóln[ay]+\s+kontakt|mutual\s+connection|innych\s+wspólnych/i.test(s);

  for (const item of items) {
    try {
      const allProfileLinks = Array.from(item.querySelectorAll('a[href*="/in/"]'));
      if (allProfileLinks.length === 0) continue;

      const allParagraphs = Array.from(item.querySelectorAll("p"))
        .map((p) => (p.textContent || "").trim())
        .filter(Boolean);
      const paragraphs = allParagraphs.filter((p) => !isMutualText(p));

      let nameLine = paragraphs.find((p) => p.includes(" • ")) || paragraphs[0] || "";
      const lines = nameLine.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        nameLine = lines.find((l) => l.includes(" • ")) || lines[0];
      }

      let name = nameLine;
      let degree = null;
      const sepIdx = nameLine.lastIndexOf(" • ");
      if (sepIdx !== -1) {
        name = nameLine.slice(0, sepIdx).trim();
        degree = nameLine.slice(sepIdx + 3).trim();
      }

      const namePIdx = paragraphs.indexOf(nameLine);
      const headline = namePIdx >= 0 ? (paragraphs[namePIdx + 1] || "") : (paragraphs[0] || "");
      const location = namePIdx >= 0 ? (paragraphs[namePIdx + 2] || "") : (paragraphs[1] || "");

      // Slug: prefer link którego text zawiera name (skip mutual connection links).
      let chosenLink = null;
      if (name) {
        chosenLink = allProfileLinks.find((a) => {
          const t = (a.textContent || "").trim();
          return t && t.includes(name);
        }) || null;
      }
      if (!chosenLink) {
        chosenLink = allProfileLinks.find((a) => {
          const t = (a.textContent || "").trim();
          return t && !isMutualText(t);
        }) || allProfileLinks[0];
      }
      const href = chosenLink ? (chosenLink.getAttribute("href") || "") : "";
      const slugMatch = href.match(/\/in\/([^/?#]+)/);
      const slug = slugMatch ? decodeURIComponent(slugMatch[1]) : null;

      // Button state — structural: pendingLink po aria-label prefix.
      const connectLink = item.querySelector('a[href*="/preload/search-custom-invite/"]');
      const messageLink = item.querySelector('a[href*="/messaging/"]');
      const pendingLink = item.querySelector(
        'a[aria-label^="W toku"], a[aria-label^="Pending"]'
      );
      let buttonState = "Unknown";
      if (pendingLink) buttonState = "Pending";
      else if (connectLink) buttonState = "Connect";
      else if (messageLink) buttonState = "Message";
      else {
        const txt = (item.textContent || "").toLowerCase();
        if (txt.includes("obserwuj") || txt.includes("follow")) buttonState = "Follow";
      }

      results.push({ name, slug, headline, location, degree, buttonState });
    } catch (err) {
      // Per-item try/catch — fail jednego li nie wywala całej listy.
      results.push({ slug: null, error: String(err && err.message || err) });
    }
  }
  return results;
}

// ── Helpers ────────────────────────────────────────────────────────

function loadFixture(name) {
  const filepath = path.join(__dirname, "fixtures", name);
  const html = fs.readFileSync(filepath, "utf-8");
  // URL fixture'u — fallback na search results URL.
  const urlMatch = html.match(/<!--\s*(https:\/\/[^\s]+)\s*-->/);
  const url = urlMatch
    ? urlMatch[1]
    : "https://www.linkedin.com/search/results/people/?keywords=ovb";
  const dom = new JSDOM(html, { url });
  return { doc: dom.window.document, url };
}

// ── Test suite ────────────────────────────────────────────────────

console.log("\n▸ search_results_people.html — SDUI extractor (10 OVB profiles)");
{
  const { doc } = loadFixture("search_results_people.html");
  const profiles = extractSearchResults(doc);

  // AC: length === 10
  assertEqual(profiles.length, 10, "Returns array of length 10");

  // AC: First profile asserts
  const first = profiles[0];
  assertEqual(first.name, "Mariusz Fedorowski", "First profile: name");
  assertEqual(first.slug, "mariusz-fedorowski-1645a4173", "First profile: slug");
  assertEqual(first.degree, "2", "First profile: degree");
  assertEqual(first.buttonState, "Connect", "First profile: buttonState");

  // AC: Sample name on item[1]
  assertEqual(profiles[1].name, "Tomek Kler", "Second profile: name (Tomek Kler)");

  // AC: All 10 have truthy name, slug, headline
  let truthyCount = 0;
  for (const p of profiles) {
    if (p.name && p.slug && p.headline) truthyCount++;
  }
  assertEqual(truthyCount, 10, "All 10 profiles have truthy name+slug+headline");

  // AC: All 10 have buttonState === "Connect"
  const connectCount = profiles.filter((p) => p.buttonState === "Connect").length;
  assertEqual(connectCount, 10, "All 10 profiles have buttonState=Connect");

  // AC: All 10 have degree === "2"
  const degree2Count = profiles.filter((p) => p.degree === "2").length;
  assertEqual(degree2Count, 10, "All 10 profiles have degree='2'");

  // AC: at least 6/10 headlines contain "OVB" (loose check, fixture is OVB search)
  const ovbCount = profiles.filter((p) => p.headline && p.headline.includes("OVB")).length;
  assert(
    ovbCount >= 6,
    `At least 6/10 headlines contain "OVB"`,
    `got ${ovbCount}/10`
  );
}

// ── Defensive: per-item try/catch when one item is corrupt ────────
console.log("\n▸ Per-item try/catch resilience — corrupt one item, expect length still 10");
{
  const { doc } = loadFixture("search_results_people.html");
  const items = doc.querySelectorAll('div[role="listitem"]');
  // Korupcja: usuń wszystkie <p> z 5. itemu (środek listy).
  // Powinno zwrócić item z error key (lub pustym name/headline), ale
  // NIE crashować całej listy.
  const target = items[5];
  const ps = target.querySelectorAll("p");
  ps.forEach((p) => p.remove());

  const profiles = extractSearchResults(doc);
  assertEqual(profiles.length, 10, "Length still 10 after corrupting item[5]");

  // Item[5] should have empty name/headline (graceful degradation), not crash.
  // Either: (a) error key set if extractor threw, OR (b) name/headline empty.
  const broken = profiles[5];
  const gracefullyDegraded =
    broken.error !== undefined || (broken.name === "" && broken.headline === "");
  assert(
    gracefullyDegraded,
    "Corrupted item degrades gracefully (error key OR empty name/headline)",
    `got ${JSON.stringify(broken)}`
  );

  // Inne itemy nadal poprawne
  assertEqual(profiles[0].name, "Mariusz Fedorowski", "Item[0] still intact after corrupting [5]");
  assertEqual(profiles[9].slug, "cezary-matyska-694b2a2b8", "Item[9] still intact after corrupting [5]");
}

// ── Summary ───────────────────────────────────────────────────────
console.log("\n=== test_search_extractor.js ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
