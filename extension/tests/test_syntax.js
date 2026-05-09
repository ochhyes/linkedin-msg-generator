/**
 * test_syntax.js — lint guard dla głównych plików extension'a (#31 v1.8.1).
 *
 * Powód powstania: w 1.8.0 (commit 56d08d6) duplicate const w popup.js
 * przeszedł review bo żaden test nie sprawdzał czy pliki w ogóle parsują
 * się jako JS. Cały popup był martwy aż do 1.8.1 hotfix'a — wszystkie
 * event listenery odpadły. Ten test = tania siatka bezpieczeństwa.
 *
 * Wywołuje `node --check <file>` na każdym z 5 entry-pointów extension'a.
 * Exit 0 = OK (PASS), throw (non-zero exit + stderr) = SyntaxError (FAIL
 * z dosłowną treścią błędu node'a — plik + linia).
 *
 * Run: node tests/test_syntax.js (z PWD = extension/)
 *
 * Hardcoded lista 5 plików — żadnego globbingu. tests/ i node_modules/
 * świadomie nie sprawdzane (mocki Chrome API mogą być niezależnie invalid).
 */

const { execSync } = require("child_process");
const path = require("path");

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

// Hardcoded — 5 entry-pointów z manifest'u (background SW, content script,
// popup, dashboard, options). Bez globbingu *.js żeby nie złapać node_modules
// ani plików testowych.
const FILES = [
  "popup.js",
  "background.js",
  "content.js",
  "dashboard.js",
  "options.js",
];

console.log("=== test_syntax.js ===");

for (const file of FILES) {
  const fullPath = path.resolve(file);
  try {
    // stdio: 'pipe' — przechwytujemy stderr, nie chcemy spamić konsoli
    // gdy wszystko OK. Przy błędzie execSync rzuca z .stderr w buforze.
    execSync(`node --check "${fullPath}"`, { stdio: "pipe" });
    assert(true, `${file} parsuje się`);
  } catch (err) {
    // stderr node'a zawiera ścieżkę + linia + opis (np. "popup.js:422
    // SyntaxError: Identifier 'action' has already been declared").
    const stderr = (err.stderr && err.stderr.toString()) || err.message || "";
    // Wyciągnij pierwszą linię z konkretem (plik:linia) plus typ błędu —
    // resztę stack trace'a node'a pomijamy żeby raport był czytelny.
    const lines = stderr.split(/\r?\n/).filter((l) => l.trim());
    const detail = lines.slice(0, 3).join(" | ") || "unknown error";
    assert(false, `${file} parsuje się`, detail);
  }
}

console.log("");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log("");
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
