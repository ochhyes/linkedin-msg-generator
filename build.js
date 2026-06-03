#!/usr/bin/env node
/**
 * build.js — generuje outreach/ : publikacyjna wersja rozszerzenia.
 *
 * Kopiuje extension/ -> outreach/, wycina pliki dev (tests, node_modules,
 * itp.), podmienia w manifescie name -> "Outreach" oraz key na osobny klucz
 * publikacyjny (stabilne ID, odrebne od folderu dev), po czym PAKUJE wynik do
 * Outreach-<wersja>.zip w korzeniu repo (gotowe do wyslania zespolowi).
 *
 * extension/ to JEDYNE zrodlo prawdy. outreach/ to artefakt builda
 * (gitignored) — NIGDY nie edytuj go recznie. Po kazdej zmianie w
 * extension/ uruchom ponownie:  node build.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

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

// 4. Spakuj outreach/ -> Outreach-<wersja>.zip w korzeniu repo. To OSTATNI krok
//    kazdego release'u (patrz DEFINITION OF DONE w CLAUDE.md) — bez paczki
//    zespol siedzi na starej wersji. Pakujemy ZAWARTOSC outreach/ (manifest.json
//    w korzeniu zipa). Bez zaleznosci npm: Windows -> systemowy PowerShell
//    Compress-Archive, Unix -> `zip`. Fallback: instrukcja recznego pakowania.
const zipName = "Outreach-" + version + ".zip";
const zipPath = path.join(root, zipName);
try { fs.rmSync(zipPath, { force: true }); } catch (_) {}

let zipped = false;
try {
  if (process.platform === "win32") {
    const psCmd =
      "Compress-Archive -Path '" + path.join(dst, "*") +
      "' -DestinationPath '" + zipPath + "' -Force";
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psCmd], { stdio: "ignore" });
  } else {
    // Unix: zip CLI (jezeli dostepny); -j NIE, bo gubi podfoldery (icons/assets).
    execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: dst, stdio: "ignore" });
  }
  zipped = fs.existsSync(zipPath);
} catch (_) {
  zipped = false;
}

// 5. Publikacja na wspolny dysk (opcjonalna). Sciezka w gitignored
//    .outreach-publish (jedna linia, np. G:\...\Outreach). Jesli plik istnieje
//    i cel jest zamontowany, nadpisujemy pliki w docelowym folderze (zespol
//    tylko reloaduje extension). Build NIE pada gdy publikacja sie nie uda.
const publishCfg = path.join(root, ".outreach-publish");
let published = null;
let publishErr = null;
if (fs.existsSync(publishCfg)) {
  try {
    const target = fs.readFileSync(publishCfg, "utf8").trim();
    if (target) {
      const parent = path.dirname(target);
      if (!fs.existsSync(parent)) {
        publishErr = "cel niezamontowany (" + parent + ")";
      } else if (process.platform === "win32") {
        // robocopy radzi sobie z wirtualnym FS Google Drive (fs.cpSync rzuca
        // tam ESRCH na \\?\ extended-path). /E = z podfolderami, BEZ /PURGE
        // (nie kasuje cudzych plikow w celu). Exit < 8 = sukces (0/1/2/3...).
        const r = spawnSync("robocopy", [dst, target, "/E", "/NJH", "/NJS", "/NFL", "/NDL", "/R:2", "/W:2"], { stdio: "ignore" });
        if (r.error) throw r.error;
        if (typeof r.status === "number" && r.status >= 8) throw new Error("robocopy exit " + r.status);
        published = target;
      } else {
        fs.mkdirSync(target, { recursive: true });
        fs.cpSync(dst, target, { recursive: true, force: true });
        published = target;
      }
    }
  } catch (err) {
    publishErr = err && err.message ? err.message : String(err);
  }
}

console.log("");
console.log("  Build OK — Outreach v" + version);
console.log("  outreach/  (" + fileCount + " plikow, name='Outreach', osobny key)");
if (zipped) {
  const kb = Math.round(fs.statSync(zipPath).size / 1024);
  console.log("  " + zipName + "  (" + kb + " KB) — spakowane, gotowe do wyslania");
} else {
  console.log("  UWAGA: auto-pakowanie zip sie nie powiodlo. Spakuj recznie:");
  console.log("    Compress-Archive -Path outreach\\* -DestinationPath " + zipName + " -Force");
}
if (published) console.log("  Opublikowano na wspolny dysk: " + published);
else if (publishErr) console.log("  Publikacja pominieta: " + publishErr);
console.log("");
console.log("  Load Unpacked: chrome://extensions/ -> Wczytaj rozpakowane -> folder outreach/");
console.log("");
