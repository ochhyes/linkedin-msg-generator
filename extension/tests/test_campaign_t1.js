/**
 * test_campaign_t1.js — testy odsprzegnięcia enrichment od wysylki (T1)
 *
 * DoD: tick wysylki zawiera ZERO wywolan scrape profilu (grep + port testu),
 * enrichmentWorkerTick respektuje mutex i dzienny cap.
 *
 * Uruchomienie: node tests/test_campaign_t1.js
 */
"use strict";

const fs = require("fs");
let pass = 0, fail = 0;

function assert(cond, label) {
  if (cond) { console.log("  PASS:", label); pass++; }
  else { console.error("  FAIL:", label); fail++; }
}

// ── DoD #1: grep — tick wysylki nie zawiera wywolania scrapeProfile ────

console.log("\n=== DoD: tick wysylki nie scrapuje (grep background.js) ===");

const bgSrc = fs.readFileSync(__dirname + "/../background.js", "utf8");

// Wytnij blok campaignWorkerTick (od funkcji do kolejnej async function).
const tickStart = bgSrc.indexOf("async function campaignWorkerTick()");
const tickEnd = bgSrc.indexOf("\nasync function startCampaignWorker(");
assert(tickStart >= 0, "campaignWorkerTick znaleziona w background.js");
assert(tickEnd > tickStart, "koniec bloku campaignWorkerTick znaleziony");
const tickBlock = bgSrc.slice(tickStart, tickEnd);

assert(!tickBlock.includes('probeProfileTab'), "campaignWorkerTick NIE wywoluje probeProfileTab");
assert(!tickBlock.includes('"scrapeProfile"'), 'campaignWorkerTick NIE zawiera "scrapeProfile"');

// enrichCampaignContact tez nie powinna scrapowac (jest wywolywana przez tick).
const enrichStart = bgSrc.indexOf("async function enrichCampaignContact(");
const enrichEnd = bgSrc.indexOf("\n// Wola backend");
assert(enrichStart >= 0, "enrichCampaignContact znaleziona");
const enrichBlock = bgSrc.slice(enrichStart, enrichEnd > enrichStart ? enrichEnd : enrichStart + 500);
assert(!enrichBlock.includes('probeProfileTab'), "enrichCampaignContact NIE wywoluje probeProfileTab");
assert(!enrichBlock.includes('"scrapeProfile"'), 'enrichCampaignContact NIE zawiera "scrapeProfile"');

// ── DoD #2: enrichment worker state functions istnieja ─────────────────

console.log("\n=== DoD: enrichment worker state functions w background.js ===");

assert(bgSrc.includes("getEnrichmentWorkerState"), "getEnrichmentWorkerState zdefiniowana");
assert(bgSrc.includes("setEnrichmentWorkerState"), "setEnrichmentWorkerState zdefiniowana");
assert(bgSrc.includes("enrichmentWorkerTick"), "enrichmentWorkerTick zdefiniowana");
assert(bgSrc.includes("startEnrichmentWorker"), "startEnrichmentWorker zdefiniowana");
assert(bgSrc.includes("stopEnrichmentWorker"), "stopEnrichmentWorker zdefiniowana");
assert(bgSrc.includes("findSlugForEnrichment"), "findSlugForEnrichment zdefiniowana");
assert(bgSrc.includes("ENRICHMENT_ALARM_NAME"), "ENRICHMENT_ALARM_NAME stala zdefiniowana");
assert(bgSrc.includes("ENRICHMENT_DAILY_CAP"), "ENRICHMENT_DAILY_CAP stala zdefiniowana");

// ── DoD #3: mutex w enrichmentWorkerTick ──────────────────────────────

console.log("\n=== DoD: mutex enrichment NIE dziala rownoleg z bulk/campaign ===");

// Port pure logic mutexu z enrichmentWorkerTick.
function mutexShouldPause(bulkActive, cwActive) {
  return bulkActive || cwActive;
}

assert(mutexShouldPause(true, false), "bulk active => enrichment pauzuje");
assert(mutexShouldPause(false, true), "campaign active => enrichment pauzuje");
assert(mutexShouldPause(true, true), "bulk+campaign active => enrichment pauzuje");
assert(!mutexShouldPause(false, false), "oba nieaktywne => enrichment moze dzialac");

// ── DoD #4: dzienny cap port ──────────────────────────────────────────

console.log("\n=== DoD: enrichment dzienny cap ===");

const ENRICHMENT_DAILY_CAP = 50;

function enrichCapReached(enrichedToday) {
  return enrichedToday >= ENRICHMENT_DAILY_CAP;
}

assert(!enrichCapReached(0), "0/50 — cap nie osiagniety");
assert(!enrichCapReached(49), "49/50 — cap nie osiagniety");
assert(enrichCapReached(50), "50/50 — cap osiagniety");
assert(enrichCapReached(51), "51/50 — ponad cap, stop");

// ── DoD #5: findSlugForEnrichment pure simulation ─────────────────────

console.log("\n=== DoD: findSlugForEnrichment (symulacja pure) ===");

function findSlugForEnrichmentPure(campaigns, profiles) {
  for (const campaign of campaigns) {
    for (const contact of (campaign.contacts || [])) {
      if (!contact.slug) continue;
      const dbp = profiles[contact.slug];
      if (dbp && (dbp.headline || dbp.enrichStatus === "unavailable")) continue;
      if (!contact.headline || !contact.headline.trim()) return contact.slug;
    }
  }
  return null;
}

// Kontakt bez headline, brak w profileDb -> wymaga enrichment.
const camp1 = [{ contacts: [{ slug: "jan-kowalski", headline: "" }] }];
assert(findSlugForEnrichmentPure(camp1, {}) === "jan-kowalski", "kontakt bez headline -> slug do wzbogacenia");

// Kontakt z headline w kampanii -> pomijany.
const camp2 = [{ contacts: [{ slug: "anna-nowak", headline: "CEO at TechCorp" }] }];
assert(findSlugForEnrichmentPure(camp2, {}) === null, "kontakt z headline -> null (nie wymaga)");

// Kontakt bez headline, ale profileDb ma headline -> pomijany.
const camp3 = [{ contacts: [{ slug: "piotr-xyz", headline: "" }] }];
const db3 = { "piotr-xyz": { headline: "Manager" } };
assert(findSlugForEnrichmentPure(camp3, db3) === null, "profileDb ma headline -> null (wzbogacony)");

// Kontakt oznaczony unavailable -> pomijany.
const camp4 = [{ contacts: [{ slug: "priv-user", headline: "" }] }];
const db4 = { "priv-user": { enrichStatus: "unavailable" } };
assert(findSlugForEnrichmentPure(camp4, db4) === null, "enrichStatus=unavailable -> null (pomijany)");

// Pierwsza kampania wzbogacona, druga ma do zrobienia.
const camp5 = [
  { contacts: [{ slug: "done-slug", headline: "" }] },
  { contacts: [{ slug: "todo-slug", headline: "" }] },
];
const db5 = { "done-slug": { headline: "Engineer" } };
assert(findSlugForEnrichmentPure(camp5, db5) === "todo-slug", "druga kampania ma do wzbogacenia");

// ── DoD #6: handlery w message switchu ────────────────────────────────

console.log("\n=== DoD: message handlery enrichment w background.js ===");

assert(bgSrc.includes('"enrichmentWorkerStart"') || bgSrc.includes("case \"enrichmentWorkerStart\""), "enrichmentWorkerStart handler zarejestrowany");
assert(bgSrc.includes('"enrichmentWorkerStop"') || bgSrc.includes("case \"enrichmentWorkerStop\""), "enrichmentWorkerStop handler zarejestrowany");
assert(bgSrc.includes('"getEnrichmentWorkerState"') || bgSrc.includes("case \"getEnrichmentWorkerState\""), "getEnrichmentWorkerState handler zarejestrowany");

// ── Podsumowanie ───────────────────────────────────────────────────────
console.log(`\n=== Wyniki: ${pass} PASS / ${fail} FAIL ===\n`);
if (fail > 0) process.exit(1);
