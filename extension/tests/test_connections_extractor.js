/**
 * test_connections_extractor.js (#45 v1.14.0)
 *
 * Testuje extractConnectionsList() — parser strony
 * /mynetwork/invite-connect/connections/ używany przy imporcie kontaktów
 * 1st-degree do trwałej bazy profili.
 *
 * Run: node tests/test_connections_extractor.js
 *
 * UWAGA: re-implementacja logiki z extension/content.js (tak jak
 * test_search_extractor.js / test_bulk_connect.js / test_e2e.js — vanilla
 * JS bez modułów, import niemożliwy bez bundlera). Synchronizuj ręcznie
 * po zmianach w content.js extractConnectionsList(). Debt: #10 BACKLOG.
 *
 * Fixture: tests/fixtures/connections_page.html
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

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function assertEqual(actual, expected, name) { assert(actual === expected, name, `got "${actual}", expected "${expected}"`); }

// ── Port extractConnectionsList z extension/content.js ────────────
function extractConnectionsList(document) {
  const results = [];
  const seen = new Set();
  const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
  for (const link of links) {
    try {
      const href = link.getAttribute("href") || "";
      const m = href.match(/\/in\/([^/?#]+)/);
      if (!m) continue;
      let slug;
      try { slug = decodeURIComponent(m[1]).toLowerCase(); } catch (_) { slug = m[1].toLowerCase(); }
      if (!slug || seen.has(slug)) continue;

      const card = link.closest('li, [componentkey], .mn-connection-card, .artdeco-list__item, [data-view-name]') || link.parentElement;
      if (!card) continue;
      const linkText = (link.textContent || "").trim();
      let name = "";
      const looksLikeName = (s) => s && s.length > 1 && s.length < 60 &&
        !/obserwuj|wiadomo|connect|follow|message|stopni|·/i.test(s) && /\p{L}/u.test(s);
      if (looksLikeName(linkText)) {
        name = linkText.split("\n").map((x) => x.trim()).find(looksLikeName) || linkText.trim();
      }
      if (!name) {
        const cand = Array.from(card.querySelectorAll("span, p"))
          .map((el) => (el.textContent || "").trim())
          .find(looksLikeName);
        if (cand) name = cand;
      }
      let headline = null;
      const texts = Array.from(card.querySelectorAll("p, span"))
        .map((el) => (el.textContent || "").trim())
        .filter(Boolean);
      for (const t of texts) {
        if (!t || t === name) continue;
        if (/^połączono|^connected|^zaproszenie|^stopień|·\s*\d/i.test(t)) continue;
        if (t.length < 3) continue;
        headline = t;
        break;
      }
      seen.add(slug);
      results.push({
        slug, name: name || "", headline: headline || "",
        location: null, degree: "1st",
        profileUrl: `https://www.linkedin.com/in/${slug}/`,
        mutual_connections: null, pageNumber: null,
      });
    } catch (_) { /* skip broken card */ }
  }
  return results;
}

// ── Tests ─────────────────────────────────────────────────────────
console.log("=== test_connections_extractor.js ===");

const html = fs.readFileSync(path.resolve(__dirname, "fixtures", "connections_page.html"), "utf8");
const dom = new JSDOM(html);
const doc = dom.window.document;
const list = extractConnectionsList(doc);

assert(list.length === 4, "wyciąga 4 kontakty (śmieciowe linki bez /in/ pominięte)", `dostał ${list.length}`);

const bySlug = Object.fromEntries(list.map((r) => [r.slug, r]));
assert(!!bySlug["jan-kowalski-12345"], "ma jan-kowalski-12345");
assertEqual(bySlug["jan-kowalski-12345"] && bySlug["jan-kowalski-12345"].name, "Jan Kowalski", "name Jana poprawne");
assertEqual(bySlug["jan-kowalski-12345"] && bySlug["jan-kowalski-12345"].headline, "Sales Director w OVB Allfinanz", "headline Jana poprawny (nie 'Połączono 3 dni temu')");
assertEqual(bySlug["jan-kowalski-12345"] && bySlug["jan-kowalski-12345"].degree, "1st", "degree = 1st");
assert(/linkedin\.com\/in\/jan-kowalski-12345\//.test(bySlug["jan-kowalski-12345"].profileUrl), "profileUrl zbudowany");

// Encoded slug → decoded lowercase.
assert(!!bySlug["radosław-paczyński-72307a"], "encoded slug zdekodowany do radosław-paczyński-72307a", "klucze: " + Object.keys(bySlug).join(", "));

// Karta bez occupation — name jest, headline pusty (nie crash).
assert(!!bySlug["marek-bez-headline"], "ma marek-bez-headline");
assertEqual(bySlug["marek-bez-headline"] && bySlug["marek-bez-headline"].headline, "", "headline pusty gdy brak occupation");

// Dedup — żaden slug nie powtórzony.
const uniq = new Set(list.map((r) => r.slug));
assertEqual(uniq.size, list.length, "brak duplikatów slug");

// Brak rekordu dla feedu/invitation-manager (linki bez /in/).
assert(!list.some((r) => !r.slug), "każdy rekord ma slug");

console.log("");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
