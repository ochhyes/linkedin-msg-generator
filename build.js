#!/usr/bin/env node
/**
 * build.js — generuje outreach/ : publikacyjna wersja rozszerzenia.
 *
 * Kopiuje extension/ -> outreach/, wycina pliki dev (tests, node_modules,
 * itp.), podmienia w manifescie name -> "Outreach" oraz key na osobny klucz
 * publikacyjny (stabilne ID, odrebne od folderu dev).
 *
 * extension/ to JEDYNE zrodlo prawdy. outreach/ to artefakt builda
 * (gitignored) — NIGDY nie edytuj go recznie. Po kazdej zmianie w
 * extension/ uruchom ponownie:  node build.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const root = __dirname;
const src = path.join(root, "extension");
const dst = path.join(root, "outreach");

// Klucz publikacyjny — STALY. Daje rozszerzeniu "Outreach" wlasne, stabilne
// ID, odrebne od folderu dev (oba mozna zaladowac przez Load Unpacked obok
// siebie bez kolizji ID). Klucz prywatny: .keys/outreach.pem (gitignored).
const PUB_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArYIbMpaKRXdjtagYfRXgpeR/VC56jLN8o7YQCCVMKlnXHAVsjcpBRJwC0p0M1ClzDhdlMy4y1KGSvA1RnYlREBNqVu7L4eoIsF7w62wH90jADNo/Yhw8X248/DCDO1eG2fbP367AQyLWHEQ1DI2yWKKsygg3dv6V+Iic/qzalo4JmOcH9GqO6CWrbmjYwr9Kt9RTSTNf5xriUKjEn1A29zKbjobl+D8uXzXCrpA4UqfKAVUJ7MJ1VDg39l/3wTl2hU3zuOvnXep8CkRI3wDfO+4hFS1alub53kEAS1kKV6vlnlhgd0Xzn0oGPYM7C6RaLNTINmOCgnuApUq9n8gxuwIDAQAB";

// Pliki/foldery dev — NIE trafiaja do wersji publikacyjnej.
const EXCLUDE = new Set([
  "tests", "node_modules", "{icons,tests}", "dom_sample.txt",
  "package.json", "package-lock.json", "README.md",
]);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

if (!fs.existsSync(src)) {
  console.error("BLAD: brak folderu extension/ — uruchom z korzenia repo.");
  process.exit(1);
}

// 1. Czysty rebuild outreach/
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });

// 2. Kopiuj extension/ -> outreach/ z pominieciem plikow dev
for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  if (EXCLUDE.has(entry.name)) continue;
  const s = path.join(src, entry.name);
  const d = path.join(dst, entry.name);
  if (entry.isDirectory()) copyDir(s, d);
  else fs.copyFileSync(s, d);
}

// 3. Patch manifest.json — name + key (string-replace zachowuje formatowanie)
const manifestPath = path.join(dst, "manifest.json");
let txt = fs.readFileSync(manifestPath, "utf8");
if (!/"name":\s*"[^"]*"/.test(txt) || !/"key":\s*"[^"]*"/.test(txt)) {
  console.error("BLAD: manifest.json nie ma pola name lub key — przerwane.");
  process.exit(1);
}
txt = txt.replace(/"name":\s*"[^"]*"/, '"name": "Outreach"');
txt = txt.replace(/"key":\s*"[^"]*"/, () => '"key": "' + PUB_KEY + '"');
fs.writeFileSync(manifestPath, txt);

const version = (txt.match(/"version":\s*"([^"]+)"/) || [])[1] || "?";
const fileCount = countFiles(dst);

console.log("");
console.log("  Build OK — Outreach v" + version);
console.log("  outreach/  (" + fileCount + " plikow, name='Outreach', osobny key)");
console.log("");
console.log("  Load Unpacked: chrome://extensions/ -> Wczytaj rozpakowane -> folder outreach/");
console.log("  Dystrybucja: spakuj folder outreach/ do zip (Explorer: prawy klik");
console.log("  -> Wyslij do -> Folder skompresowany) i przeslij zespolowi.");
console.log("");
