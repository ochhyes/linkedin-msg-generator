/**
 * Search Results extractor tests (#18 Faza 1A) — wykrywa regresje
 * DOM dla `/search/results/people/` ZANIM zespół OVB zauważy.
 * Fixture'y to realny DOM zrzucony przez Marcina.
 *
 * Run: node tests/test_search_extractor.js
 *
 * Fixtures:
 *  - search_results_people.html — wariant SDUI, search "ovb", 10 listitems
 *  - search_entity_result.html  — wariant classic Ember `entity-result`,
 *    search "obsługa klienta", 10 wierszy div[data-chameleon-result-urn]
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
// extractSearchResults(doc) = orchestrator dwóch wariantów LinkedIn'a:
//  - classic Ember `entity-result` → extractSearchResultsEmber()
//  - SDUI (role="listitem", <p>) → parser inline
// Parametryzacja po `doc` (nie globalne window.document). Synchronizuj
// z extension/content.js po każdej zmianie.

function normalizeDegree(raw) {
  if (!raw) return null;
  const m = String(raw).match(/[123]/);
  if (!m) return null;
  return { "1": "1st", "2": "2nd", "3": "3rd" }[m[0]] || null;
}

// Wariant classic Ember `entity-result`.
function extractSearchResultsEmber(rows) {
  const results = [];
  for (const row of rows) {
    try {
      const profileLinks = Array.from(
        row.querySelectorAll('a[href*="/in/"]')
      ).filter((a) => !a.closest(".entity-result__insights"));
      if (profileLinks.length === 0) continue;

      let name = null;
      let nameLink = null;
      for (const a of profileLinks) {
        const span = a.querySelector('span[aria-hidden="true"]');
        const txt = span ? (span.textContent || "").trim() : "";
        if (txt) { name = txt; nameLink = a; break; }
      }
      const chosenLink = nameLink || profileLinks[0];
      const href = chosenLink.getAttribute("href") || "";
      const slugMatch = href.match(/\/in\/([^/?#]+)/);
      let slug = null;
      if (slugMatch) {
        try { slug = decodeURIComponent(slugMatch[1]).toLowerCase(); }
        catch (_) { slug = slugMatch[1].toLowerCase(); }
      }

      const badge = row.querySelector(".entity-result__badge-text");
      let degree = null;
      if (badge) {
        const badgeAh = badge.querySelector('span[aria-hidden="true"]');
        degree =
          normalizeDegree(badgeAh && badgeAh.textContent) ||
          normalizeDegree(badge.textContent);
      }

      let headline = null;
      let location = null;
      const textDivs = Array.from(row.querySelectorAll("div.t-14"));
      for (const d of textDivs) {
        const txt = (d.textContent || "").trim();
        if (!txt) continue;
        if (d.classList.contains("t-black")) {
          if (!headline) headline = txt;
        } else if (d.classList.contains("t-normal")) {
          if (!location) location = txt;
        }
      }

      const q = (sel) => row.querySelector(sel);
      const pendingBtn = q(
        'button[aria-label^="W toku"], a[aria-label^="W toku"], ' +
        'button[aria-label^="Oczekuje"], a[aria-label^="Oczekuje"], ' +
        'button[aria-label^="Pending"], a[aria-label^="Pending"]'
      );
      const connectBtn = q(
        'button[aria-label^="Zaproś"], a[aria-label^="Zaproś"], ' +
        'button[aria-label^="Invite "], a[aria-label^="Invite "], ' +
        'button[aria-label^="Connect"], a[aria-label^="Connect"], ' +
        'a[href*="search-custom-invite"]'
      );
      const messageBtn = q(
        'button[aria-label^="Wiadomość"], a[aria-label^="Wiadomość"], ' +
        'button[aria-label^="Wyślij wiadomość"], a[aria-label^="Wyślij wiadomość"], ' +
        'button[aria-label^="Napisz wiadomość"], a[aria-label^="Napisz wiadomość"], ' +
        'button[aria-label^="Message"], a[aria-label^="Message"], ' +
        'a[href*="/messaging/"]'
      );
      const followBtn = q(
        'button[aria-label^="Obserwuj"], a[aria-label^="Obserwuj"], ' +
        'button[aria-label^="Follow"], a[aria-label^="Follow"]'
      );

      let buttonState = "Unknown";
      if (pendingBtn) buttonState = "Pending";
      else if (connectBtn) buttonState = "Connect";
      else if (messageBtn) buttonState = "Message";
      else if (followBtn) buttonState = "Follow";

      results.push({ name: name || null, headline, location, degree, slug, buttonState });
    } catch (err) {
      results.push({ slug: null, error: String((err && err.message) || err) });
    }
  }
  return results;
}

function extractSearchResultsCore(doc) {
  // Wykryj wariant Ember po data-chameleon-result-urn.
  const emberRows = doc.querySelectorAll(
    'div[data-chameleon-result-urn], ' +
    'div[data-view-name="search-entity-result-universal-template"]'
  );
  if (emberRows.length > 0) return extractSearchResultsEmber(emberRows);

  // ── Wariant SDUI ──────────────────────────────────────────────
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
      results.push({ slug: null, error: String((err && err.message) || err) });
    }
  }
  return results;
}

// ── Helpers ────────────────────────────────────────────────────────

// ── Generyczny fallback (port z content.js, resilience 2026-05-22) ──
// Last-resort gdy ani Ember ani SDUI nie złapią layoutu. Synchronizuj
// z extension/content.js: classifySearchButtonState + extractSearchResultsGeneric.

function classifySearchButtonState(root) {
  const has = (sel) => !!root.querySelector(sel);
  if (
    has(
      'a[aria-label^="W toku"], button[aria-label^="W toku"], ' +
      'a[aria-label^="Oczekuje"], button[aria-label^="Oczekuje"], ' +
      'a[aria-label^="Pending"], button[aria-label^="Pending"], ' +
      'a[href*="/preload/withdraw-invite/"]'
    )
  ) return "Pending";
  if (
    has(
      'a[href*="search-custom-invite"], a[href*="/preload/custom-invite/"], ' +
      'a[aria-label^="Zaproś"], button[aria-label^="Zaproś"], ' +
      'a[aria-label^="Invite "], button[aria-label^="Invite "], ' +
      'a[aria-label^="Connect"], button[aria-label^="Connect"]'
    )
  ) return "Connect";
  const textConnect = Array.from(root.querySelectorAll("button, a")).some((b) => {
    const t = (b.textContent || "").trim();
    return /^(Połącz|Connect)$/i.test(t) && !/W toku|Pending|Anuluj|Withdraw|Cofnij/i.test(t);
  });
  if (textConnect) return "Connect";
  if (
    has(
      'a[href*="/messaging/"], ' +
      'a[aria-label^="Wiadomość"], button[aria-label^="Wiadomość"], ' +
      'a[aria-label^="Message"], button[aria-label^="Message"]'
    )
  ) return "Message";
  if (
    has(
      'a[aria-label^="Obserwuj"], button[aria-label^="Obserwuj"], ' +
      'a[aria-label^="Follow"], button[aria-label^="Follow"]'
    )
  ) return "Follow";
  const txt = (root.textContent || "").toLowerCase();
  if (/\bobserwuj\b|\bfollow\b/.test(txt) && !/połącz|connect/i.test(txt)) return "Follow";
  return "Unknown";
}

function extractSearchResultsGeneric(doc) {
  const results = [];
  const seen = new Set();
  const EXCLUDE =
    'nav, header, footer, aside, .global-nav, .scaffold-layout__aside, ' +
    '.entity-result__insights, [class*="insights"]';
  const isMutualText = (s) =>
    /wspóln[ay]+\s+kontakt|mutual\s+connection|innych\s+wspólnych/i.test(s);
  const BTN_TXT =
    /^(Połącz|Connect|Wiadomość|Message|Obserwuj|Follow|W toku|Pending|Zaproś|Invite)\b/i;

  const links = Array.from(doc.querySelectorAll('a[href*="/in/"]'));
  for (const link of links) {
    try {
      if (link.closest(EXCLUDE)) continue;
      const href = link.getAttribute("href") || "";
      const m = href.match(/\/in\/([^/?#]+)/);
      if (!m) continue;
      let slug;
      try { slug = decodeURIComponent(m[1]).toLowerCase(); }
      catch (_) { slug = m[1].toLowerCase(); }
      if (!slug || seen.has(slug) || /^acoaa/i.test(slug)) continue;

      let name = null;
      const ah = link.querySelector('span[aria-hidden="true"]');
      if (ah) name = (ah.textContent || "").trim();
      if (!name) {
        const raw = (link.textContent || "").trim();
        const firstLine =
          raw.split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
        name = firstLine.replace(/\s*•\s*\d.*$/, "").trim();
      }
      if (!name || name.length < 2 || name.length > 120) continue;
      if (BTN_TXT.test(name) || isMutualText(name)) continue;

      let cur = link.parentElement;
      let card = null;
      for (let depth = 0; cur && depth < 8; depth++) {
        if (classifySearchButtonState(cur) !== "Unknown") { card = cur; break; }
        if (cur.querySelectorAll('a[href*="/in/"]').length > 1) {
          card = card || cur;
          break;
        }
        cur = cur.parentElement;
      }
      card = card || link.parentElement || link;
      const buttonState = classifySearchButtonState(card);

      let degree = null;
      const dm = (card.textContent || "").match(
        /•\s*([123])\b|\b([123])\.\s*stopni|\b([123])(?:st|nd|rd)\b/i
      );
      if (dm) degree = normalizeDegree(dm[0]);

      const texts = [];
      const leafEls = card.querySelectorAll("p, span, div");
      for (const el of leafEls) {
        if (el.childElementCount !== 0) continue;
        const t = (el.textContent || "").trim();
        if (!t || t === name) continue;
        if (BTN_TXT.test(t) || isMutualText(t) || /^•\s*\d/.test(t)) continue;
        if (!texts.includes(t)) texts.push(t);
      }
      const headline = texts[0] || null;
      const location = texts[1] || null;

      seen.add(slug);
      results.push({ name, headline, location, degree, slug, buttonState });
    } catch (err) {
      results.push({ slug: null, error: String((err && err.message) || err) });
    }
  }
  return results;
}

// Orchestrator publiczny — Ember → SDUI (core) → generic last-resort.
// "Usable" wymaga slug ORAZ niepustego name (wyłapuje objaw "imiona —").
function extractSearchResults(doc) {
  let primary = [];
  try { primary = extractSearchResultsCore(doc); }
  catch (_) { primary = []; }
  const usable = primary.filter(
    (p) => p && p.slug && p.name && String(p.name).trim()
  ).length;
  if (usable > 0) return primary;
  let generic = [];
  try { generic = extractSearchResultsGeneric(doc); }
  catch (_) { generic = []; }
  const gu = generic.filter(
    (p) => p && p.slug && p.name && String(p.name).trim()
  ).length;
  return gu > 0 ? generic : primary;
}

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

// ── Wariant classic Ember `entity-result` (regresja v1.22.1) ──────
//
// LinkedIn A/B-serwuje classic Ember layout zamiast SDUI. Dump Marcina
// z search "obsługa klienta": 10 wierszy div[data-chameleon-result-urn],
// Connect = <button aria-label="Zaproś...">, imię w span[aria-hidden].
console.log("\n▸ search_entity_result.html — Ember entity-result extractor");
{
  const { doc } = loadFixture("search_entity_result.html");
  const profiles = extractSearchResults(doc);

  // AC: 10 wierszy (data-chameleon-result-urn × 10).
  assertEqual(profiles.length, 10, "Ember: returns array of length 10");

  // AC: imiona NIE puste — to był objaw bugu ("—" w popupie).
  const namedCount = profiles.filter((p) => p.name && p.name.length > 1).length;
  assertEqual(namedCount, 10, "Ember: all 10 rows have non-empty name");

  // AC: konkretne imię z dumpu.
  const toron = profiles.find((p) => p.name === "Małgorzata Toroń");
  assert(!!toron, "Ember: 'Małgorzata Toroń' wyekstrahowana");

  // AC: slug = czysty vanity, mutual connections (ACoAA...) odfiltrowane.
  if (toron) {
    assertEqual(toron.slug, "malgorzatatoron", "Ember: Toroń slug = czysty vanity");
  }
  const obfuscatedSlugs = profiles.filter(
    (p) => p.slug && /^acoaa/i.test(p.slug)
  ).length;
  assertEqual(obfuscatedSlugs, 0, "Ember: zero obfuskowanych slugów (mutual conn. odfiltrowane)");

  // AC: każdy wiersz ma slug.
  const sluggedCount = profiles.filter((p) => p.slug).length;
  assertEqual(sluggedCount, 10, "Ember: all 10 rows have slug");

  // AC: Connect rozpoznany — to był drugi objaw bugu ("0 dostępnych").
  const connectCount = profiles.filter((p) => p.buttonState === "Connect").length;
  assert(connectCount >= 6, "Ember: ≥6 rows buttonState=Connect", `got ${connectCount}`);

  // AC: Follow rozpoznany (≥1 profil follow-only w dumpie).
  const followCount = profiles.filter((p) => p.buttonState === "Follow").length;
  assert(followCount >= 1, "Ember: ≥1 row buttonState=Follow", `got ${followCount}`);

  // AC: żaden wiersz nie ma buttonState=Unknown (objaw "?" w popupie).
  const unknownCount = profiles.filter((p) => p.buttonState === "Unknown").length;
  assertEqual(unknownCount, 0, "Ember: zero rows buttonState=Unknown");

  // AC: degree znormalizowany do "2nd" (kontrakt isFirstDegree).
  if (toron) {
    assertEqual(toron.degree, "2nd", "Ember: Toroń degree = '2nd'");
  }
  const degreeOk = profiles.filter(
    (p) => p.degree === "1st" || p.degree === "2nd" || p.degree === "3rd"
  ).length;
  assert(degreeOk >= 8, "Ember: ≥8 rows mają znormalizowany degree", `got ${degreeOk}`);

  // AC: headline + location wyekstrahowane.
  if (toron) {
    assert(
      toron.headline && toron.headline.includes("Obsługa klienta"),
      "Ember: Toroń headline zawiera 'Obsługa klienta'",
      `got "${toron && toron.headline}"`
    );
    assert(
      toron.location && /Cracow|Krak/i.test(toron.location),
      "Ember: Toroń location wyekstrahowana",
      `got "${toron && toron.location}"`
    );
  }
  const headlineCount = profiles.filter((p) => p.headline).length;
  assert(headlineCount >= 8, "Ember: ≥8 rows mają headline", `got ${headlineCount}`);
}

// ── Ember: per-row try/catch resilience ───────────────────────────
console.log("\n▸ Ember per-row try/catch — corrupt one row, expect length still 10");
{
  const { doc } = loadFixture("search_entity_result.html");
  const rows = doc.querySelectorAll("div[data-chameleon-result-urn]");
  // Korupcja: wywal querySelector na 4. wierszu podmieniając go na thrower.
  const target = rows[4];
  target.querySelector = () => { throw new Error("corrupt-row"); };
  target.querySelectorAll = () => { throw new Error("corrupt-row"); };

  const profiles = extractSearchResults(doc);
  assertEqual(profiles.length, 10, "Ember: length still 10 after corrupting row[4]");
  assert(
    profiles[4].error !== undefined,
    "Ember: corrupted row[4] degrades to {error}",
    `got ${JSON.stringify(profiles[4])}`
  );
  assert(
    profiles[0].name && profiles[9].name,
    "Ember: rows [0] and [9] still intact after corrupting [4]"
  );
}

// ── Generyczny fallback — nowy/nieznany layout (resilience 2026-05-22) ──
//
// Fixture search_generic_layout.html NIE jest ani Ember (data-chameleon-result-urn)
// ani SDUI (div[role="listitem"]) → core zwraca []. Wrapper MUSI przełączyć
// na extractSearchResultsGeneric i odzyskać profile z gołych <a href="/in/">.
console.log("\n▸ search_generic_layout.html — generyczny fallback (nieznany layout)");
{
  const { doc } = loadFixture("search_generic_layout.html");

  // Sanity: core (Ember+SDUI) faktycznie nic nie łapie na tym layoucie.
  assertEqual(extractSearchResultsCore(doc).length, 0, "Generic: core zwraca 0 (nieznany layout)");

  const profiles = extractSearchResults(doc);

  // AC: 5 kart z <main>; sidebar (aside) + nav + footer wykluczone.
  assertEqual(profiles.length, 5, "Generic: 5 profili (sidebar/nav/footer wykluczone)");

  // AC: objaw bugu "imiona —" naprawiony — wszystkie mają niepuste imię.
  const named = profiles.filter((p) => p.name && p.name.length > 1).length;
  assertEqual(named, 5, "Generic: wszystkie 5 mają niepuste imię");

  const bySlug = (s) => profiles.find((p) => p.slug === s);
  const jan = bySlug("jan-kowalski-doradca-123");
  const anna = bySlug("anna-nowak-456");
  const piotr = bySlug("piotr-wisniewski-789");
  const maria = bySlug("maria-lewandowska-321");
  const krzys = bySlug("krzysztof-influencer-654");

  assert(!!jan && jan.name === "Jan Kowalski", "Generic: Jan Kowalski wyekstrahowany");
  // AC: Connect rozpoznany oboma drogami (button aria-label + preload <a>).
  assertEqual(jan && jan.buttonState, "Connect", "Generic: Jan = Connect (button aria-label)");
  assertEqual(anna && anna.buttonState, "Connect", "Generic: Anna = Connect (preload link)");
  // AC: Pending NIE mylony z Connect (klik na 'W toku' = withdraw flow).
  assertEqual(piotr && piotr.buttonState, "Pending", "Generic: Piotr = Pending (nie Connect)");
  // AC: Message (1st) i Follow (only) rozpoznane.
  assertEqual(maria && maria.buttonState, "Message", "Generic: Maria = Message (1st)");
  assertEqual(krzys && krzys.buttonState, "Follow", "Generic: Krzysztof = Follow (only)");

  // AC: degree heurystyka z tekstu karty.
  assertEqual(jan && jan.degree, "2nd", "Generic: Jan degree = 2nd");
  assertEqual(maria && maria.degree, "1st", "Generic: Maria degree = 1st");

  // AC: headline + location best-effort.
  assert(jan && jan.headline && jan.headline.includes("Doradca"), "Generic: Jan headline = Doradca...", `got "${jan && jan.headline}"`);
  assert(jan && jan.location && jan.location.includes("Warszawa"), "Generic: Jan location = Warszawa", `got "${jan && jan.location}"`);

  // AC: mutual connection (ACoAA slug) odfiltrowany — nie jest osobnym profilem.
  const acoaa = profiles.filter((p) => p.slug && /^acoaa/i.test(p.slug)).length;
  assertEqual(acoaa, 0, "Generic: zero slugów ACoAA (mutual odfiltrowany)");

  // AC: sidebar/nav/footer NIE w wynikach.
  assert(!bySlug("sidebar-wykluczony-999"), "Generic: sidebar (aside) wykluczony");
  assert(!bySlug("my-own-profile"), "Generic: nav link wykluczony");
  assert(!bySlug("footer-link-000"), "Generic: footer link wykluczony");

  // AC: zero Unknown (każdy ma rozpoznany stan przycisku).
  const unk = profiles.filter((p) => p.buttonState === "Unknown").length;
  assertEqual(unk, 0, "Generic: zero buttonState=Unknown");
}

// ── Brak regresji: wrapper nie odpala generic gdy core ma wyniki ──────
// Na fixture'ach SDUI/Ember (powyżej, przez extractSearchResults) generic
// NIE może się odpalić — primary usable > 0. Sprawdzamy że wrapper zwraca
// dokładnie to co core dla obu znanych wariantów.
console.log("\n▸ Wrapper = core gdy znany layout (brak regresji SDUI/Ember)");
{
  const sdui = loadFixture("search_results_people.html").doc;
  const ember = loadFixture("search_entity_result.html").doc;
  assertEqual(
    JSON.stringify(extractSearchResults(sdui)),
    JSON.stringify(extractSearchResultsCore(sdui)),
    "Wrapper==core na SDUI (generic nie odpalony)"
  );
  assertEqual(
    JSON.stringify(extractSearchResults(ember)),
    JSON.stringify(extractSearchResultsCore(ember)),
    "Wrapper==core na Ember (generic nie odpalony)"
  );
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
