/**
 * test_connections_extractor.js — parser strony kontaktów
 * /mynetwork/invite-connect/connections/ (extractConnectionsList).
 *
 * Używany przez: RĘCZNY import ("Importuj kontakty z LinkedIn") ORAZ auto
 * accept-tracker (#56A: fetchRecentConnections → extractRecentConnections →
 * extractConnectionsList). Jeden fix → dwie ścieżki.
 *
 * Run: node tests/test_connections_extractor.js
 *
 * UWAGA (#10 spłacony częściowo): ten test NIE re-implementuje parsera —
 * wyciąga ŹRÓDŁO extractConnectionsList z extension/content.js po ASCII-
 * anchorach i odpala je w jsdom. Testujemy realny shipowany kod. Funkcja
 * musi pozostać self-contained (jedyna zależność: globalny `document`).
 *
 * Fixtures (syntetyczne, dane fikcyjne — bez PII):
 *  - connections_page.html    — classic Ember mn-connection-card (#45), 4 kontakty
 *  - connections_sdui.html    — wariant SDUI (2026-06), 4 kontakty + edge case'y
 *  - connections_classic.html — classic Ember (imię w <span> w linku), 2 kontakty
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

// ── Załaduj REALNY extractConnectionsList z content.js ─────────────────
const contentSrc = fs.readFileSync(path.resolve(__dirname, "..", "content.js"), "utf8");
const START = "  function extractConnectionsList() {";
const END = "  async function importAllConnections(maxPages) {";
const s = contentSrc.indexOf(START);
const e = contentSrc.indexOf(END);
if (s < 0 || e < 0 || e < s) {
  console.error("FATAL: nie znaleziono extractConnectionsList w content.js (anchory się zmieniły?)");
  process.exit(1);
}
const fnSource = contentSrc.slice(s, e).trim();
function runFixture(file) {
  const html = fs.readFileSync(path.resolve(__dirname, "fixtures", file), "utf8");
  const doc = new JSDOM(html).window.document;
  return new Function("document", fnSource + "\n return extractConnectionsList();")(doc);
}
const bySlug = (rows, slug) => rows.find((r) => r.slug === slug);

console.log("=== test_connections_extractor.js (real code z content.js) ===");

// ── classic Ember #45 (connections_page.html) ──────────────────────────
console.log("\n[1] connections_page.html — classic Ember mn-connection-card:");
const page = runFixture("connections_page.html");
assert(page.length === 4, "wyciąga 4 kontakty (śmieciowe linki bez /in/ pominięte)", `dostał ${page.length}`);
const jan = bySlug(page, "jan-kowalski-12345") || {};
assert(!!bySlug(page, "jan-kowalski-12345"), "ma jan-kowalski-12345");
assertEqual(jan.name, "Jan Kowalski", "name Jana poprawne");
assertEqual(jan.headline, "Sales Director w OVB Allfinanz", "headline Jana (nie 'Połączono 3 dni temu')");
assertEqual(jan.degree, "1st", "degree = 1st");
assert(/linkedin\.com\/in\/jan-kowalski-12345\//.test(jan.profileUrl), "profileUrl zbudowany");
assert(!!bySlug(page, "radosław-paczyński-72307a"), "encoded slug zdekodowany do radosław-paczyński-72307a", "klucze: " + page.map((r) => r.slug).join(", "));
assert(!!bySlug(page, "marek-bez-headline"), "ma marek-bez-headline");
assertEqual((bySlug(page, "marek-bez-headline") || {}).headline, "", "headline pusty gdy brak occupation");
assertEqual(new Set(page.map((r) => r.slug)).size, page.length, "brak duplikatów slug");
assert(page.every((r) => r.slug), "każdy rekord ma slug");

// ── SDUI variant (connections_sdui.html) ───────────────────────────────
console.log("\n[2] connections_sdui.html — wariant SDUI 2026-06:");
const sdui = runFixture("connections_sdui.html");
assertEqual(sdui.length, 4, "SDUI: 4 kontakty (nav + aside wykluczone)");
assert(!!bySlug(sdui, "jan-testowy-1"), "SDUI: slug jan-testowy-1 obecny");
assert(!!bySlug(sdui, "maria-otwarta-2"), "SDUI: slug maria-otwarta-2 obecny");
assert(!!bySlug(sdui, "zofia-średni-123"), "SDUI: slug %-encoded zdekodowany (zofia-średni-123)");
assert(!!bySlug(sdui, "adam-pierwszy-4"), "SDUI: slug adam-pierwszy-4 obecny");
assert(!bySlug(sdui, "self-nav-99"), "SDUI: własny profil z <header.global-nav> POMINIĘTY");
assert(!bySlug(sdui, "pymk-suggest-1"), "SDUI: PYMK z <aside.scaffold-layout__aside> POMINIĘTY");
assertEqual((bySlug(sdui, "jan-testowy-1") || {}).name, "Jan Testowy", "SDUI: imię zwykłego kontaktu (z link-zdjęcie + link-nazwa)");
assertEqual((bySlug(sdui, "jan-testowy-1") || {}).headline, "Doradca finansowy w OVB", "SDUI: headline zwykłego kontaktu");
const maria = bySlug(sdui, "maria-otwarta-2") || {};
assertEqual(maria.name, "Maria Otwarta", "SDUI: open-to-work — badge zdjęty, legalne nazwisko 'Otwarta' przetrwało");
assert(!/na oferty pracy|open to work/i.test(maria.name), "SDUI: imię NIE zawiera frazy badge open-to-work", `name="${maria.name}"`);
assertEqual(maria.headline, "Konsultant ds. ubezpieczeń", "SDUI: open-to-work — headline poprawny (nie imię sąsiada z rodzica)");
assertEqual((bySlug(sdui, "zofia-średni-123") || {}).name, "Zofia Średni", "SDUI: imię przy slugu %-encoded");
const adam = bySlug(sdui, "adam-pierwszy-4") || {};
assertEqual(adam.name, "Adam Pierwszy", "SDUI: order-independence — imię gdy link-nazwa pierwszy");
assertEqual(adam.headline, "Inżynier oprogramowania", "SDUI: order-independence — headline gdy link-nazwa pierwszy");
assertEqual(sdui.filter((r) => !r.name).length, 0, "SDUI: 0 kontaktów z pustym imieniem");
assert(sdui.every((r) => r.slug === r.slug.toLowerCase()), "SDUI: wszystkie slugi lowercase");
assert(sdui.every((r) => r.degree === "1st"), "SDUI: degree = '1st' dla wszystkich");
assertEqual((bySlug(sdui, "jan-testowy-1") || {}).profileUrl, "https://www.linkedin.com/in/jan-testowy-1/", "SDUI: profileUrl zbudowany ze slugu");

// ── classic Ember 2 (connections_classic.html) ─────────────────────────
console.log("\n[3] connections_classic.html — classic Ember (imię w <span> w linku):");
const classic = runFixture("connections_classic.html");
assertEqual(classic.length, 2, "classic: 2 kontakty");
assertEqual((bySlug(classic, "old-jan-kowalski") || {}).name, "Jan Kowalski", "classic: imię z <span> w linku");
assertEqual((bySlug(classic, "old-jan-kowalski") || {}).headline, "Kierownik sprzedaży w ACME", "classic: headline z rodzeństwa w karcie");
assertEqual((bySlug(classic, "old-ewa-nowak-77") || {}).name, "Ewa Nowak", "classic: imię drugiego kontaktu");
assertEqual((bySlug(classic, "old-ewa-nowak-77") || {}).headline, "Specjalista ds. marketingu", "classic: headline drugiego kontaktu");

// ── Podsumowanie ───────────────────────────────────────────────────────
console.log(`\n${"=".repeat(50)}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("ALL PASS");
