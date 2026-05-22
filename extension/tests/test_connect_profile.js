/**
 * connectFromProfile — findConnectEl / isSuggestionEl (#58-followup 2026-05-22).
 *
 * BUG: findConnectEl(document) brało PIERWSZY "Zaproś" w całym dokumencie →
 * gdy worker ląduje na /mynetwork/ (redirect konta z limitem) albo na profilu
 * z sekcją "Osoby, które możesz znać", klikał przycisk SUGESTII = zaproszenie
 * do przypadkowej osoby. Fix: isSuggestionEl odrzuca przyciski z sekcji
 * sugestii. Synchronizuj z extension/content.js.
 *
 * Fixtures:
 *  - profile_broken_2026-05-22.html — REALNY dump (to /mynetwork/, 32 sugestie).
 *  - profile_connect_synthetic.html — syntetyczny profil (właściciel + sugestie).
 */
const fs = require("fs");
const path = require("path");
let JSDOM;
try { JSDOM = require("jsdom").JSDOM; } catch { console.error("npm install jsdom"); process.exit(1); }

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(`${name}${detail ? " — " + detail : ""}`); console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// ── Port z content.js ────────────────────────────────────────────────
function isSuggestionEl(el) {
  if (!el) return true;
  if (el.closest("aside, .scaffold-layout__aside")) return true;
  const sec = el.closest("section");
  if (sec) {
    const h = sec.querySelector('h2, h3, [role="heading"]');
    const ht = h ? (h.innerText || h.textContent || "").toLowerCase() : "";
    if (/mo[zż]esz zna|people you may know|sugestie|podobne profile|people also viewed|inne osoby przegl/.test(ht)) return true;
  }
  const CONNECTISH = 'button[aria-label*="Zaproś"], a[aria-label*="Zaproś"], ' +
    'button[aria-label*="Invite"], a[aria-label*="Invite"]';
  let cur = el;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.querySelectorAll && cur.querySelectorAll(CONNECTISH).length > 1) break;
    if (cur.querySelector && cur.querySelector(
      '[aria-label*="jako sugesti"], [aria-label*="as a suggestion"], ' +
      '[aria-label^="Usuń:"], [aria-label^="Remove:"]'
    )) return true;
    cur = cur.parentElement;
  }
  return false;
}
function findConnectEl(root) {
  const sel =
    'a[href*="/preload/custom-invite/"], a[href*="/preload/search-custom-invite/"], ' +
    'a[aria-label^="Zaproś"], button[aria-label^="Zaproś"], ' +
    'a[aria-label^="Połącz"], button[aria-label^="Połącz"], ' +
    'a[aria-label^="Invite "], button[aria-label^="Invite "], ' +
    'a[aria-label^="Connect"], button[aria-label^="Connect"]';
  const cands = Array.from(root.querySelectorAll(sel));
  for (const c of root.querySelectorAll("a, button")) {
    const t = (c.innerText || c.textContent || "").trim();
    if (/^(Połącz|Connect)$/i.test(t) && !/W toku|Pending|Anuluj|Withdraw|Cofnij/i.test(t)) cands.push(c);
  }
  const seen = new Set();
  for (const el of cands) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (!isSuggestionEl(el)) return el;
  }
  return null;
}

function load(name) {
  return new JSDOM(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8")).window.document;
}

console.log("=== test_connect_profile.js ===");

console.log("\n▸ profile_broken_2026-05-22.html — REALNY /mynetwork/ (same sugestie)");
{
  const d = load("profile_broken_2026-05-22.html");
  const rawZapros = d.querySelectorAll('button[aria-label^="Zaproś"], a[aria-label^="Zaproś"]').length;
  assert(rawZapros >= 5, "Sa przyciski 'Zapros' do odfiltrowania (sugestie)", `got ${rawZapros}`);
  // KRYTYCZNE: findConnectEl NIE może zwrócić sugestii → null (nie ma top-card).
  const el = findConnectEl(d);
  assert(el === null, "findConnectEl=null na /mynetwork/ (NIE klika sugestii)", el ? `got aria="${el.getAttribute("aria-label")}"` : "");
  // Każdy raw "Zaproś" tu jest sugestią.
  const sample = d.querySelector('button[aria-label^="Zaproś"]');
  assert(isSuggestionEl(sample) === true, "Przyklad 'Zapros' rozpoznany jako sugestia");
}

console.log("\n▸ profile_connect_synthetic.html — profil (wlasciciel + sugestie)");
{
  const d = load("profile_connect_synthetic.html");
  const el = findConnectEl(d);
  assert(!!el, "findConnectEl znajduje przycisk wlasciciela");
  const aria = el ? (el.getAttribute("aria-label") || "") : "";
  assert(/Jan Profilowy/.test(aria), "Wybrany przycisk = WLASCICIEL (Jan Profilowy)", `got "${aria}"`);
  assert(!/Sugestia|Aside/.test(aria), "NIE wybrano sugestii ani aside", `got "${aria}"`);

  // sugestie i aside poprawnie flagowane
  const sug = [...d.querySelectorAll('button[aria-label*="Sugestia"]')][0];
  assert(isSuggestionEl(sug) === true, "Przycisk sugestii (sekcja 'mozesz znac') = suggestion");
  const asideBtn = [...d.querySelectorAll('button[aria-label*="Aside"]')][0];
  assert(isSuggestionEl(asideBtn) === true, "Przycisk z <aside> = suggestion");

  // wlasciciel NIE jest sugestia
  const owner = [...d.querySelectorAll('button[aria-label*="Jan Profilowy"]')][0];
  assert(isSuggestionEl(owner) === false, "Przycisk wlasciciela NIE jest sugestia");
}

console.log("");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) { console.log("\nFailures:"); for (const f of failures) console.log("  - " + f); process.exit(1); }
