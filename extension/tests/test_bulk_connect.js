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

// ── Summary ──────────────────────────────────────────────────────
console.log("\n=== test_bulk_connect.js ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
