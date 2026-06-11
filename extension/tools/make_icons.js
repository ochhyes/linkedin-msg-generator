/**
 * Generator ikon rozszerzenia 2.0 — monogram "in" jak w headerze popupu
 * i bootloader-mark ovb.szmidtke.pl: navy kwadrat (radius ~22%), złote
 * "in" w serifie (Georgia — systemowy, render przez sharp/librsvg).
 *
 * Run: node tools/make_icons.js   (z katalogu extension/)
 * Nadpisuje icons/icon16.png, icon48.png, icon128.png + zapisuje
 * icons/source-2.0.svg (źródło wektorowe do przyszłych edycji).
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const NAVY = "#1A2E4C";
const GOLD = "#C7956D";

// Parametry per rozmiar: w 16 px litery muszą być proporcjonalnie większe
// i grubsze, inaczej zlewają się w plamę.
const SIZES = [
  { px: 128, radius: 28, font: 78, y: 90 },
  { px: 48, radius: 11, font: 30, y: 34 },
  { px: 16, radius: 4, font: 11, y: 12 },
];

function iconSvg({ px, radius, font, y }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
  <rect x="0" y="0" width="${px}" height="${px}" rx="${radius}" fill="${NAVY}"/>
  <text x="${px / 2}" y="${y}" text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif" font-weight="bold"
        font-size="${font}" letter-spacing="${-font * 0.02}" fill="${GOLD}">in</text>
</svg>`;
}

(async () => {
  const outDir = path.join(__dirname, "..", "icons");
  for (const spec of SIZES) {
    const svg = iconSvg(spec);
    const out = path.join(outDir, `icon${spec.px}.png`);
    await sharp(Buffer.from(svg), { density: 300 })
      .resize(spec.px, spec.px)
      .png()
      .toFile(out);
    console.log(`icon${spec.px}.png OK`);
  }
  fs.writeFileSync(path.join(outDir, "source-2.0.svg"), iconSvg(SIZES[0]), "utf8");
  console.log("source-2.0.svg OK");
})();
