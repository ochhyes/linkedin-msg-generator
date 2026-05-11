/**
 * E2E fixture tests (#8) — wykrywa regresje DOM scrapera ZANIM
 * zespół OVB zauważy. Każdy fixture to realny DOM z LinkedIn'a
 * zrzucony w konkretnym stanie.
 *
 * Run: node tests/test_e2e.js
 *
 * Fixtures:
 *  - anna_voyager.html      — shell phase + 9 Voyager payloadów (positive)
 *  - mynetwork.html         — /mynetwork/grow/ landing (negative)
 *  - search_results.html    — /search/results/all/ (negative)
 *  - empty_main.html        — pusta page bez profilu (negative)
 *
 * Sprawdzamy:
 *  - extractFromVoyagerPayloads(doc, slug) na anna_voyager.html
 *    zwraca name="Anna ...", headline truthy
 *  - na 3 negatywnych zwraca null
 *  - extractName (DOM h1) na 4 fixture'ach zwraca null (żaden nie ma h1)
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

// ── Voyager parser (port z extension/content.js) ──────────────────
//
// Te funkcje DUPLIKUJĄ logikę content.js. Synchronizuj ręcznie po
// zmianach w extension/content.js → collectVoyagerIncluded /
// isProfileEntity / extractFromVoyagerPayloads.

function collectVoyagerIncluded(doc) {
  const tags = doc.querySelectorAll('code[id^="bpr-guid-"]');
  const all = [];
  for (const tag of tags) {
    let payload;
    try {
      payload = JSON.parse(tag.textContent);
    } catch {
      continue;
    }
    const candidates = [
      payload?.included,
      payload?.data?.included,
      payload?.response?.included,
    ];
    for (const arr of candidates) {
      if (Array.isArray(arr)) {
        for (const e of arr) if (e && typeof e === "object") all.push(e);
      }
    }
  }
  return all;
}

function isProfileEntity(e) {
  return (
    e.firstName &&
    e.lastName &&
    (e.headline || e.summary || e.locationName || e.geoLocationName)
  );
}

function extractSlugFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/\/in\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function extractFromVoyagerPayloads(doc, url) {
  const included = collectVoyagerIncluded(doc);
  if (included.length === 0) return null;

  const slug = extractSlugFromUrl(url);
  const slugLower = slug ? slug.toLowerCase() : null;

  const profiles = included.filter(isProfileEntity);
  if (profiles.length === 0) return null;

  let profile = null;
  if (slugLower) {
    profile = profiles.find((p) => {
      const pid = String(p.publicIdentifier || p.vanityName || "").toLowerCase();
      return pid && pid === slugLower;
    });
  }
  if (!profile) {
    if (profiles.length === 1) profile = profiles[0];
    else return null;
  }

  const name = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
  const headline = profile.headline || "";
  const about = profile.summary || "";
  const location = profile.locationName || profile.geoLocationName || "";

  return { name, headline, about, location };
}

// ── Helpers ────────────────────────────────────────────────────────

function loadFixture(name) {
  const filepath = path.join(__dirname, "fixtures", name);
  const html = fs.readFileSync(filepath, "utf-8");
  // URL z pierwszej linii komentarza HTML: <!-- https://... -->
  const urlMatch = html.match(/<!--\s*(https:\/\/[^\s]+)\s*-->/);
  const url = urlMatch ? urlMatch[1] : "https://www.linkedin.com/in/test/";
  const dom = new JSDOM(html, { url });
  return { doc: dom.window.document, url };
}

function countH1(doc) {
  return doc.querySelectorAll("h1").length;
}

function countVoyagerCodes(doc) {
  return doc.querySelectorAll('code[id^="bpr-guid-"]').length;
}

// ── Test suites ───────────────────────────────────────────────────

console.log("\n▸ F1: anna_voyager.html — feed-layout h1 + Voyager POSITIVE");
{
  const { doc, url } = loadFixture("anna_voyager.html");
  const slug = extractSlugFromUrl(url);
  assert(slug && slug.startsWith("anna"), "F1 URL slug zaczyna się od 'anna'");
  // Feed-layout LinkedIn renderuje h1 z imieniem w author-card (nested <a>),
  // a sekcja /pv-top-card/ nie istnieje. Dlatego grep widzi 0 h1, ale jsdom
  // — który parsuje pełny DOM — widzi 1 h1 z "Anna Rutkowska".
  assert(countH1(doc) === 1, "F1 dokładnie 1 <h1> (feed-layout author card)", `got ${countH1(doc)}`);
  const h1Text = doc.querySelector("h1")?.textContent.trim();
  assert(h1Text && h1Text.startsWith("Anna"), `F1 h1 text zaczyna się od 'Anna'`, `got "${h1Text}"`);
  assert(
    countVoyagerCodes(doc) >= 5,
    "F1 ma co najmniej 5 Voyager payloadów",
    `got ${countVoyagerCodes(doc)}`
  );

  const result = extractFromVoyagerPayloads(doc, url);
  assert(result !== null, "F1 Voyager fallback zwraca obiekt (nie null)");
  if (result) {
    assert(result.name.startsWith("Anna"), `F1 name zaczyna się od 'Anna'`, `got "${result.name}"`);
    assert(
      result.name.split(" ").length >= 2,
      "F1 name ma co najmniej 2 słowa (imię + nazwisko)",
      `got "${result.name}"`
    );
    assert(
      typeof result.headline === "string" && result.headline.length > 0,
      "F1 headline truthy non-empty",
      `got "${result.headline}"`
    );
  }
}

console.log("\n▸ F2: mynetwork.html — /mynetwork/ NEGATIVE");
{
  const { doc, url } = loadFixture("mynetwork.html");
  assert(!url.includes("/in/"), "F2 URL nie jest profilem (/in/)", url);
  assert(countH1(doc) === 0, "F2 brak <h1> profilu");

  const result = extractFromVoyagerPayloads(doc, url);
  assert(result === null, "F2 Voyager fallback zwraca null", `got ${JSON.stringify(result)}`);
}

console.log("\n▸ F3: search_results.html — /search/results/ NEGATIVE");
{
  const { doc, url } = loadFixture("search_results.html");
  assert(!url.includes("/in/"), "F3 URL nie jest profilem", url);
  assert(countH1(doc) === 0, "F3 brak <h1> profilu");

  const result = extractFromVoyagerPayloads(doc, url);
  assert(result === null, "F3 Voyager fallback zwraca null", `got ${JSON.stringify(result)}`);
}

console.log("\n▸ F4: empty_main.html — pusta page NEGATIVE");
{
  const { doc, url } = loadFixture("empty_main.html");
  assert(countH1(doc) === 0, "F4 brak <h1>");
  assert(countVoyagerCodes(doc) === 0, "F4 brak Voyager payloadów");

  const result = extractFromVoyagerPayloads(doc, url);
  assert(result === null, "F4 Voyager fallback zwraca null", `got ${JSON.stringify(result)}`);
}

// ── isProfileEntity unit ──────────────────────────────────────────
console.log("\n▸ isProfileEntity — guards");
{
  assert(
    isProfileEntity({ firstName: "Anna", lastName: "K", headline: "Dev" }),
    "valid profile entity → true"
  );
  assert(
    !isProfileEntity({ firstName: "Anna", lastName: "K" }),
    "no headline/summary/location → false"
  );
  assert(
    !isProfileEntity({ firstName: "Anna", headline: "Dev" }),
    "no lastName → false"
  );
  assert(!isProfileEntity({}), "empty object → false");
  assert(
    isProfileEntity({ firstName: "X", lastName: "Y", locationName: "PL" }),
    "with locationName only → true"
  );
}

// ── Slug extraction ───────────────────────────────────────────────
console.log("\n▸ extractSlugFromUrl");
{
  assert(
    extractSlugFromUrl("https://www.linkedin.com/in/anna-rutkowska-0551b120b/") ===
      "anna-rutkowska-0551b120b",
    "/in/<slug>/ → slug"
  );
  assert(
    extractSlugFromUrl("https://www.linkedin.com/in/grzegorz-b%C5%82yszczek-2a413270/") ===
      "grzegorz-błyszczek-2a413270",
    "URL-encoded polskie znaki → decoded"
  );
  assert(
    extractSlugFromUrl("https://www.linkedin.com/mynetwork/grow/") === null,
    "/mynetwork/ → null"
  );
  assert(extractSlugFromUrl("") === null, "empty string → null");
  assert(extractSlugFromUrl(null) === null, "null → null");
}

// ── SDUI extractor (port z extension/content.js — #4 v1.12.0) ────
//
// DUPLIKAT logiki content.js extractFromSdui. Synchronizuj ręcznie
// po zmianach.
function extractFromSdui(doc, url) {
  const topcard = doc.querySelector('section[componentkey*="Topcard"]');
  if (!topcard) return null;

  const name = topcard.querySelector("h2")?.textContent.trim() || null;
  if (!name) return null;

  const ps = Array.from(topcard.querySelectorAll("p"))
    .map((p) => p.textContent.trim())
    .filter(
      (t) => t && t !== "·" && !/^[·•]\s*\d+\.?$/.test(t)
    );

  let headline = null;
  let company = null;
  let location = null;
  let mutual = null;
  for (const t of ps) {
    if (
      !headline &&
      /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\s/.test(t) &&
      t.length > 10 &&
      !t.includes(" · ")
    ) {
      headline = t;
      continue;
    }
    if (!company && t.includes(" · ")) {
      company = t.split(" · ")[0].trim();
      continue;
    }
    if (
      !location &&
      /,\s*(Polska|Polsk|woj|Wielkopolsk|Mazow|Pomor|United|Germany|UK)/i.test(t)
    ) {
      location = t;
      continue;
    }
    if (
      !mutual &&
      /wspóln[ay]\s+kontakt|innych\s+wspólnych\s+kontaktów|mutual\s+connection/i.test(t)
    ) {
      mutual = t;
    }
  }

  let about = null;
  const aboutSection =
    doc.querySelector('section[componentkey$="HQAbout"]') ||
    doc.querySelector(
      'section[componentkey*="HQAbout"]:not([componentkey*="Suggested"])'
    );
  if (aboutSection) {
    const clone = aboutSection.cloneNode(true);
    clone.querySelectorAll("h2, svg, button").forEach((el) => el.remove());
    about = clone.textContent.replace(/\s+/g, " ").trim() || null;
    if (about) {
      about =
        about.split(/\s*(?:Aktywność|obserwując|Publikacje|Komentarz)/)[0].trim() ||
        null;
    }
  }

  return {
    name,
    headline,
    company,
    location,
    about,
    mutual_connections: mutual,
    profile_url: url,
  };
}

console.log("\n▸ F5: profile_sdui_dump.html — Majkowski SDUI POSITIVE (#4)");
{
  const { doc, url } = loadFixture("profile_sdui_dump.html");
  // Detect markery — to NIE są pełnoprawne asercje extraktora, tylko sanity
  // że fixture rzeczywiście jest SDUI (a nie classic Ember zaczepiony przez
  // pomyłkę).
  assert(
    !!doc.querySelector('[componentkey*="Topcard"]'),
    "F5 fixture ma section componentkey*=Topcard (SDUI marker)"
  );
  assert(
    !!doc.querySelector('section[componentkey$="HQAbout"]'),
    "F5 fixture ma section componentkey$=HQAbout (ends-with)"
  );
  assert(
    doc.querySelectorAll("h1").length === 0,
    "F5 brak <h1> (classic Ember marker negatywny)"
  );
  assert(
    doc.querySelectorAll('code[id^="bpr-guid-"]').length === 0,
    "F5 brak Voyager payloadów"
  );

  const result = extractFromSdui(doc, url);
  assert(result !== null, "F5 extractFromSdui zwraca obiekt (nie null)");
  if (result) {
    assert(
      result.name === "Mateusz Majkowski",
      "F5 name === 'Mateusz Majkowski'",
      `got "${result.name}"`
    );
    assert(
      result.headline === "Terenowy przedstawiciel handlowy w Bosch Home Comfort Group",
      "F5 headline === 'Terenowy przedstawiciel handlowy w Bosch Home Comfort Group'",
      `got "${result.headline}"`
    );
    assert(
      result.company === "Bosch Home Comfort Group",
      "F5 company === 'Bosch Home Comfort Group'",
      `got "${result.company}"`
    );
    assert(
      typeof result.location === "string" && result.location.startsWith("Gdynia"),
      "F5 location startsWith 'Gdynia'",
      `got "${result.location}"`
    );
    assert(
      typeof result.about === "string" &&
        result.about.startsWith("Liczą się dla mnie nowe doświadczenia"),
      "F5 about startsWith 'Liczą się dla mnie nowe doświadczenia'",
      `got "${result.about?.slice(0, 60)}…"`
    );
    assert(
      typeof result.mutual_connections === "string" &&
        result.mutual_connections.includes("wspólnych kontaktów"),
      "F5 mutual_connections includes 'wspólnych kontaktów'",
      `got "${result.mutual_connections}"`
    );
  }
}

// Summary
console.log("\n=================================================");
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("=================================================\n");

if (failed > 0) {
  console.log("Failures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
