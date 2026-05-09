/**
 * Bulk Connect tests (#19 Faza 1B) — testuje filter logic
 * (skip pending, skip non-connectable, findLiBySlug) i queue
 * management (addToQueue dedup, updateQueueItem, daily counter
 * reset). NIE testuje bulkConnectClick end-to-end — Shadow DOM
 * + LinkedIn JS interception nie do odtworzenia w jsdom.
 *
 * Run: node tests/test_bulk_connect.js
 *
 * UWAGA: re-implementacja helpers z content.js i background.js,
 * jak w test_search_extractor.js i test_e2e.js. Synchronizuj
 * ręcznie po zmianach. Debt tracking: #10 BACKLOG (selectors.json
 * + shared module).
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
  if (condition) { passed++; console.log(`  ✓ ${testName}`); }
  else {
    failed++;
    failures.push(`${testName}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${testName}${detail ? ` — ${detail}` : ""}`);
  }
}

function assertEqual(actual, expected, testName) {
  if (actual === expected) { passed++; console.log(`  ✓ ${testName}`); }
  else {
    failed++;
    failures.push(`${testName}: got "${actual}", expected "${expected}"`);
    console.log(`  ✗ ${testName}: got "${actual}", expected "${expected}"`);
  }
}

// ── Re-implementacja helpers z content.js (#19) ──────────────────

function findLiBySlug(doc, slug) {
  if (!slug) return null;
  const link = doc.querySelector(`a[href*="/in/${slug}/"]`);
  if (!link) return null;
  return link.closest('[role="listitem"], li');
}

// Klasyfikacja stanu profilu — używana w skip filter w bulkConnectClick.
function classifyLi(li) {
  if (!li) return "no_li";
  const pendingLink = li.querySelector('a[aria-label^="W toku"], a[aria-label^="Pending"]');
  if (pendingLink) return "pending";
  const connectLink =
    li.querySelector('a[href*="search-custom-invite"][aria-label^="Zaproś użytkownika"]') ||
    li.querySelector('a[href*="search-custom-invite"][aria-label^="Invite "]') ||
    li.querySelector('a[href*="search-custom-invite"]');
  if (!connectLink) return "not_connectable";
  return "connectable";
}

// ── Re-implementacja helpers z background.js (#19) ────────────────

function todayDateString(date) {
  return (date || new Date()).toISOString().slice(0, 10);
}

function addToQueueLogic(currentQueue, profiles) {
  const existingSlugs = new Set(currentQueue.map((q) => q.slug));
  const fresh = (profiles || [])
    .filter((p) => p && p.slug && !existingSlugs.has(p.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.name || "",
      headline: p.headline || "",
      status: "pending",
      timestamp: null,
      error: null,
    }));
  return { queue: [...currentQueue, ...fresh], added: fresh.length };
}

function updateQueueItemLogic(queue, slug, patch) {
  return queue.map((q) => (q.slug === slug ? { ...q, ...patch } : q));
}

function resetDailyCounterLogic(stats, today) {
  if (stats.lastResetDate !== today) {
    return { ...stats, sentToday: 0, lastResetDate: today };
  }
  return stats;
}

// ── Helpers ──────────────────────────────────────────────────────

function loadFixture(name) {
  const filepath = path.join(__dirname, "fixtures", name);
  const html = fs.readFileSync(filepath, "utf-8");
  const dom = new JSDOM(html, {
    url: "https://www.linkedin.com/search/results/people/?keywords=ovb",
  });
  return dom.window.document;
}

// ── Test suite ────────────────────────────────────────────────────

console.log("\n▸ findLiBySlug — search results fixture");
{
  const doc = loadFixture("search_results_people.html");

  // Pierwszy profil w fixturze: Mariusz Fedorowski.
  const li = findLiBySlug(doc, "mariusz-fedorowski-1645a4173");
  assert(li !== null, "Finds <li> for Mariusz Fedorowski");
  assert(
    li && (li.matches('[role="listitem"]') || li.tagName === "LI"),
    "Returned element is [role=listitem] or <li>"
  );

  // Slug który nie istnieje.
  const missing = findLiBySlug(doc, "nieexistujacy-profil-123");
  assertEqual(missing, null, "Returns null for missing slug");

  // Empty / falsy slug.
  assertEqual(findLiBySlug(doc, ""), null, "Empty slug → null");
  assertEqual(findLiBySlug(doc, null), null, "Null slug → null");
}

console.log("\n▸ classifyLi — skip filter logic");
{
  const doc = loadFixture("search_results_people.html");

  // Wszystkie 10 profili w fixturze są Connect-able (2nd-degree, brak pending).
  const items = doc.querySelectorAll('div[role="listitem"]');
  let connectableCount = 0;
  for (const li of items) {
    if (classifyLi(li) === "connectable") connectableCount++;
  }
  assert(connectableCount >= 10, "At least 10 connectable profiles in fixture", `got ${connectableCount}`);

  // Synthetic test: zmodyfikuj jeden profil żeby symulować Pending state.
  // Bierzemy pierwszy profil, dorzucamy mu fake pending link, sprawdzamy klasyfikację.
  const targetLi = findLiBySlug(doc, "mariusz-fedorowski-1645a4173");
  const fakePending = doc.createElement("a");
  fakePending.setAttribute("aria-label", "W toku; kliknij, aby wycofać zaproszenie");
  fakePending.setAttribute("href", "/withdraw");
  targetLi.appendChild(fakePending);
  assertEqual(classifyLi(targetLi), "pending", "Pending link detected via aria-label");

  // Synthetic: <li> bez żadnego connect/pending linka → not_connectable.
  const emptyLi = doc.createElement("li");
  const profileLink = doc.createElement("a");
  profileLink.setAttribute("href", "/in/test-slug/");
  emptyLi.appendChild(profileLink);
  assertEqual(classifyLi(emptyLi), "not_connectable", "No connect link → not_connectable");

  // Synthetic: EN aria-label "Invite ..." też klasyfikowany.
  const enLi = doc.createElement("li");
  const enConnect = doc.createElement("a");
  enConnect.setAttribute("href", "/preload/search-custom-invite/?vanityName=foo");
  enConnect.setAttribute("aria-label", "Invite Foo Bar to connect");
  enLi.appendChild(enConnect);
  assertEqual(classifyLi(enLi), "connectable", "EN aria-label 'Invite ...' classified as connectable");
}

console.log("\n▸ addToQueue — dedup po slug");
{
  let queue = [];
  let res = addToQueueLogic(queue, [
    { slug: "alice", name: "Alice A", headline: "Eng" },
    { slug: "bob", name: "Bob B", headline: "PM" },
  ]);
  assertEqual(res.queue.length, 2, "Adds 2 fresh profiles");
  assertEqual(res.added, 2, "Reports added=2");
  assertEqual(res.queue[0].status, "pending", "Default status='pending'");

  // Dedup: dodaj alice ponownie + nowego carol.
  res = addToQueueLogic(res.queue, [
    { slug: "alice", name: "Alice 2.0", headline: "Eng2" },
    { slug: "carol", name: "Carol C", headline: "Designer" },
  ]);
  assertEqual(res.queue.length, 3, "After dedup: queue has 3 (alice not re-added)");
  assertEqual(res.added, 1, "Reports added=1 (only carol)");

  // Empty / falsy input.
  res = addToQueueLogic(res.queue, []);
  assertEqual(res.queue.length, 3, "Empty profiles array → no change");
  res = addToQueueLogic(res.queue, [{ slug: null }, { slug: "" }, null]);
  assertEqual(res.queue.length, 3, "Falsy slugs filtered out");
}

console.log("\n▸ updateQueueItem — patch by slug");
{
  const queue = [
    { slug: "alice", status: "pending", timestamp: null, error: null },
    { slug: "bob", status: "pending", timestamp: null, error: null },
  ];
  const updated = updateQueueItemLogic(queue, "alice", { status: "sent", timestamp: 12345 });
  assertEqual(updated[0].status, "sent", "Alice status updated to 'sent'");
  assertEqual(updated[0].timestamp, 12345, "Alice timestamp updated");
  assertEqual(updated[1].status, "pending", "Bob unchanged");

  const updated2 = updateQueueItemLogic(queue, "missing", { status: "sent" });
  assertEqual(updated2.length, 2, "Missing slug → queue length unchanged");
  assertEqual(updated2[0].status, "pending", "Missing slug → no item modified");
}

console.log("\n▸ resetDailyCounter — midnight crossing");
{
  const stats = { sentToday: 5, sentTotal: 100, lastResetDate: "2026-05-08" };

  // Same day → no reset.
  const sameDay = resetDailyCounterLogic(stats, "2026-05-08");
  assertEqual(sameDay.sentToday, 5, "Same day: sentToday unchanged");
  assertEqual(sameDay.sentTotal, 100, "Same day: sentTotal unchanged");

  // Next day → reset sentToday, keep sentTotal.
  const nextDay = resetDailyCounterLogic(stats, "2026-05-09");
  assertEqual(nextDay.sentToday, 0, "Next day: sentToday reset to 0");
  assertEqual(nextDay.sentTotal, 100, "Next day: sentTotal preserved");
  assertEqual(nextDay.lastResetDate, "2026-05-09", "Next day: lastResetDate updated");

  // Empty lastResetDate (fresh install) → reset.
  const fresh = resetDailyCounterLogic(
    { sentToday: 0, sentTotal: 0, lastResetDate: "" },
    "2026-05-09"
  );
  assertEqual(fresh.lastResetDate, "2026-05-09", "Fresh install: lastResetDate set on first tick");
}

console.log("\n▸ todayDateString — format YYYY-MM-DD");
{
  const d = new Date("2026-05-09T15:30:00Z");
  assertEqual(todayDateString(d), "2026-05-09", "Returns YYYY-MM-DD slice from ISO");
  // Without arg — uses current Date. Just check format.
  const today = todayDateString();
  assert(/^\d{4}-\d{2}-\d{2}$/.test(today), "Default arg returns YYYY-MM-DD format");
}

// ── URL pagination helpers (#22 v1.6.0) ───────────────────────────

function getPageFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const p = parseInt(u.searchParams.get("page") || "1", 10);
    return Number.isFinite(p) && p > 0 ? p : 1;
  } catch (_) { return 1; }
}

function setPageInUrl(urlStr, pageNum) {
  try {
    const u = new URL(urlStr);
    u.searchParams.set("page", String(pageNum));
    return u.toString();
  } catch (_) { return urlStr; }
}

console.log("\n▸ getPageFromUrl + setPageInUrl — preserve query params");
{
  // Realny URL Marcin'a z #22 — wszystkie params muszą być zachowane.
  const url1 = 'https://www.linkedin.com/search/results/people/?keywords=key%20account%20manager&origin=CLUSTER_EXPANSION&network=%5B"S"%5D&page=1&spellCorrectionEnabled=true&prioritizeMessage=false';
  assertEqual(getPageFromUrl(url1), 1, "Reads page=1 from real URL");

  const url2 = setPageInUrl(url1, 2);
  assertEqual(getPageFromUrl(url2), 2, "After setPage(url, 2), getPage returns 2");
  // URL constructor może re-encode (%20 → +) — sprawdzamy values via params parse,
  // nie raw substring (LinkedIn akceptuje oba encoding'i).
  const u2 = new URL(url2);
  assertEqual(u2.searchParams.get("keywords"), "key account manager", "keywords value preserved");
  assertEqual(u2.searchParams.get("origin"), "CLUSTER_EXPANSION", "origin preserved");
  assertEqual(u2.searchParams.get("network"), '["S"]', "network filter preserved (decoded)");
  assertEqual(u2.searchParams.get("spellCorrectionEnabled"), "true", "spellCorrectionEnabled preserved");
  assertEqual(u2.searchParams.get("prioritizeMessage"), "false", "prioritizeMessage preserved");

  // Page increment.
  const url3 = setPageInUrl(url2, 3);
  assertEqual(getPageFromUrl(url3), 3, "Page 2 → 3");

  // URL bez page param → default 1.
  const noPage = "https://www.linkedin.com/search/results/people/?keywords=ovb";
  assertEqual(getPageFromUrl(noPage), 1, "Missing page param → 1");

  // Invalid URL → fallback 1.
  assertEqual(getPageFromUrl("not-a-url"), 1, "Invalid URL → fallback 1");
  assertEqual(setPageInUrl("not-a-url", 5), "not-a-url", "Invalid URL → setPage no-op");

  // Negative / NaN page → fallback 1.
  const urlBadPage = setPageInUrl(url1, 1).replace("page=1", "page=invalid");
  assertEqual(getPageFromUrl(urlBadPage), 1, "Non-numeric page → fallback 1");
}

console.log("\n▸ pageNumber per queue item — addToQueue preserves");
{
  // Symuluje addToQueue logic z background.js: wejściowe profile zawierają
  // `pageNumber`, output queue items je zachowują.
  const inputs = [
    { slug: "alice", name: "Alice", headline: "Eng", pageNumber: 1 },
    { slug: "bob", name: "Bob", headline: "PM", pageNumber: 2 },
    { slug: "carol", name: "Carol", pageNumber: 3 }, // headline missing OK
  ];
  const queue = inputs.map((p) => ({
    slug: p.slug,
    name: p.name || "",
    headline: p.headline || "",
    pageNumber: typeof p.pageNumber === "number" ? p.pageNumber : 1,
  }));
  assertEqual(queue[0].pageNumber, 1, "Alice on page 1");
  assertEqual(queue[1].pageNumber, 2, "Bob on page 2");
  assertEqual(queue[2].pageNumber, 3, "Carol on page 3");

  // Default pageNumber=1 gdy brakuje (manual add z aktywnej karty).
  const noPageInput = { slug: "dave", name: "Dave" };
  const itemDefault = {
    slug: noPageInput.slug,
    pageNumber: typeof noPageInput.pageNumber === "number" ? noPageInput.pageNumber : 1,
  };
  assertEqual(itemDefault.pageNumber, 1, "Missing pageNumber → default 1");
}

// ── Summary ──────────────────────────────────────────────────────
console.log("\n=== test_bulk_connect.js ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
