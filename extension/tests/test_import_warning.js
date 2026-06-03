/**
 * test_import_warning.js (#62) — klasyfikacja wyniku importu kontaktów pod
 * early-warning. classifyImportResult zwraca {scraped, named, warning}:
 *   • scraped === 0                 → "extract_empty"
 *   • >50% rekordów bez imienia     → "extract_degraded"
 *   • inaczej                       → null
 * Steruje telemetrią (connections_extract_*) i głośnym komunikatem w UI.
 *
 * Run: node tests/test_import_warning.js
 *
 * Ładuje REALNY kod z background.js (anchor-extract, jak test_connections_extractor)
 * — bez stale-portu. Funkcja musi pozostać self-contained (Array/String only).
 */
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
const failures = [];
function assertEqual(actual, expected, name) {
  if (actual === expected) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(`${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); console.log(`  ✗ ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
}

const bg = fs.readFileSync(path.resolve(__dirname, "..", "background.js"), "utf8");
const S = "function classifyImportResult(profiles) {";
const E = "async function importConnectionsFlow(maxPages) {";
const s = bg.indexOf(S), e = bg.indexOf(E);
if (s < 0 || e < 0 || e < s) { console.error("FATAL: nie znaleziono classifyImportResult w background.js"); process.exit(1); }
const classify = new Function(bg.slice(s, e).trim() + "\n return classifyImportResult;")();

console.log("=== test_import_warning.js (real code z background.js) ===");

// scraped = 0 → extract_empty
let r = classify([]);
assertEqual(r.warning, "extract_empty", "pusta lista → extract_empty");
assertEqual(r.scraped, 0, "pusta lista → scraped 0");
assertEqual(r.named, 0, "pusta lista → named 0");

// null/undefined → defensywnie extract_empty
assertEqual(classify(null).warning, "extract_empty", "null → extract_empty (defensywnie)");
assertEqual(classify(undefined).warning, "extract_empty", "undefined → extract_empty");

// wszyscy z imieniem → null
r = classify([{ name: "Jan" }, { name: "Ewa" }]);
assertEqual(r.warning, null, "2/2 z imieniem → brak warning");
assertEqual(r.named, 2, "2/2 z imieniem → named 2");

// >50% bez imienia → extract_degraded (1 z 3)
r = classify([{ name: "Jan" }, { name: "" }, { name: "" }]);
assertEqual(r.warning, "extract_degraded", "1/3 z imieniem (>50% pustych) → extract_degraded");
assertEqual(r.named, 1, "1/3 → named 1");
assertEqual(r.scraped, 3, "1/3 → scraped 3");

// dokładnie 50% pustych → NIE degraded (warunek to >0.5, nie >=)
r = classify([{ name: "Jan" }, { name: "" }]);
assertEqual(r.warning, null, "dokładnie 50% pustych → brak warning (boundary >0.5)");

// białe znaki liczą się jako brak imienia
r = classify([{ name: "   " }, { name: "\t" }, { name: "Jan" }]);
assertEqual(r.warning, "extract_degraded", "whitespace-only imiona → liczone jako puste → degraded");
assertEqual(r.named, 1, "whitespace → named 1 (tylko Jan)");

// brak pola name → brak imienia
r = classify([{}, { slug: "x" }, { name: "Jan" }]);
assertEqual(r.named, 1, "brak pola name → named tylko realne");
assertEqual(r.warning, "extract_degraded", "2/3 bez name → degraded");

console.log(`\n${"=".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) { console.log("\nFailures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
console.log("ALL PASS");
