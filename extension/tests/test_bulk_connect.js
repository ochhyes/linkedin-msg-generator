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

// (v2.0-cleanup) Porty findLiBySlug/classifyLi usunięte razem z martwym
// bulkConnectClick w content.js (#49: worker łączy z profilu). Klasyfikację
// stanu przycisków testuje test_search_extractor.js (classifySearchButtonState).

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

// ── Bulk worker resilience (#39 v1.10.0) ──────────────────────────

function buildSearchUrl(keywords, pageNum) {
  try {
    const u = new URL("https://www.linkedin.com/search/results/people/");
    if (keywords) u.searchParams.set("keywords", keywords);
    if (pageNum && pageNum > 1) u.searchParams.set("page", String(pageNum));
    u.searchParams.set("origin", "FACETED_SEARCH");
    return u.toString();
  } catch (_) {
    return "https://www.linkedin.com/search/results/people/";
  }
}

function urlMatchesSearch(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return false;
  return urlStr.includes("/search/results/people/");
}

function getJitterMs() {
  return 2000 + Math.random() * 3000;
}

function parseKeywordsFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.searchParams.get("keywords");
  } catch (_) {
    return null;
  }
}

function shouldAbortAfterNavigateFails(failCount) {
  return failCount >= 3;
}

console.log("\n▸ buildSearchUrl — auto-navigate target URL");
{
  const u1 = buildSearchUrl("ovb", 1);
  assert(u1.includes("/search/results/people/"), "Page 1 URL contains search path");
  assert(u1.includes("keywords=ovb"), "Page 1 URL contains keywords");
  assert(!u1.includes("page="), "Page 1 — page param OMITTED (default)");

  const u3 = buildSearchUrl("ovb", 3);
  assert(u3.includes("page=3"), "Page 3 URL contains page=3");

  const uEmpty = buildSearchUrl("", 1);
  assert(uEmpty.includes("/search/results/people/"), "Empty keywords — fallback URL valid");
  assert(!uEmpty.includes("keywords="), "Empty keywords — keywords param OMITTED");

  const uNull = buildSearchUrl(null, 1);
  assert(uNull.includes("/search/results/people/"), "null keywords — fallback URL valid");

  const uEnc = buildSearchUrl("key account manager", 2);
  const parsed = new URL(uEnc);
  assertEqual(parsed.searchParams.get("keywords"), "key account manager", "Multi-word keywords decoded back correctly");
  assertEqual(parsed.searchParams.get("page"), "2", "page=2 set correctly");
  assertEqual(parsed.searchParams.get("origin"), "FACETED_SEARCH", "origin=FACETED_SEARCH default");
}

console.log("\n▸ urlMatchesSearch — auto-navigate trigger condition");
{
  assertEqual(urlMatchesSearch("https://www.linkedin.com/search/results/people/?keywords=ovb"), true, "Search URL matches");
  assertEqual(urlMatchesSearch("https://www.linkedin.com/search/results/people/?keywords=ovb&page=3"), true, "Search URL with page matches");
  assertEqual(urlMatchesSearch("https://www.linkedin.com/in/john-doe/"), false, "Profile URL does NOT match (worker should auto-nav)");
  assertEqual(urlMatchesSearch("https://www.linkedin.com/feed/"), false, "Feed URL does NOT match");
  assertEqual(urlMatchesSearch("https://www.linkedin.com/search/results/all/?keywords=ovb"), false, "search/results/all/ does NOT match (we want people/ only)");
  assertEqual(urlMatchesSearch(""), false, "Empty string does NOT match");
  assertEqual(urlMatchesSearch(null), false, "null does NOT match");
  assertEqual(urlMatchesSearch(undefined), false, "undefined does NOT match");
}

console.log("\n▸ getJitterMs — anti-detection delay range 2-5s");
{
  for (let i = 0; i < 100; i++) {
    const ms = getJitterMs();
    assert(ms >= 2000 && ms <= 5000, `Jitter sample ${i} in [2000, 5000] (got ${ms})`);
    if (ms < 2000 || ms > 5000) break; // early exit on first fail
  }
}

console.log("\n▸ parseKeywordsFromUrl — lastSearchKeywords source");
{
  assertEqual(parseKeywordsFromUrl("https://www.linkedin.com/search/results/people/?keywords=ovb"), "ovb", "Single-word keywords parsed");
  assertEqual(parseKeywordsFromUrl("https://www.linkedin.com/search/results/people/?keywords=key%20account&page=2"), "key account", "URL-encoded multi-word decoded");
  assertEqual(parseKeywordsFromUrl("https://www.linkedin.com/search/results/people/"), null, "Missing keywords param → null");
  assertEqual(parseKeywordsFromUrl("not-a-url"), null, "Invalid URL → null");
  assertEqual(parseKeywordsFromUrl(""), null, "Empty string → null");
}

console.log("\n▸ canRecoverClosedTab — recovery gating (#43 v1.11.4)");
{
  function canRecoverClosedTab(state) {
    return !!(state && state.lastSearchKeywords);
  }
  assertEqual(canRecoverClosedTab({ lastSearchKeywords: "ovb" }), true, "Keywords saved → can recover");
  assertEqual(canRecoverClosedTab({ lastSearchKeywords: null }), false, "No keywords → cannot recover (skip)");
  assertEqual(canRecoverClosedTab({ lastSearchKeywords: "" }), false, "Empty keywords → cannot recover");
  assertEqual(canRecoverClosedTab(null), false, "No state → cannot recover");
}

console.log("\n▸ shouldAbortAfterNavigateFails — loop guard");
{
  assertEqual(shouldAbortAfterNavigateFails(0), false, "0 fails → continue");
  assertEqual(shouldAbortAfterNavigateFails(1), false, "1 fail → continue");
  assertEqual(shouldAbortAfterNavigateFails(2), false, "2 fails → continue");
  assertEqual(shouldAbortAfterNavigateFails(3), true, "3 fails → ABORT (circuit breaker)");
  assertEqual(shouldAbortAfterNavigateFails(10), true, "10 fails → ABORT");
}

console.log("\n▸ Auto-navigate idempotency — URL match → no-op");
{
  // Symulacja: gdy URL już matchuje, NIE navigate.
  const decisions = [];
  function tickDecision(currentUrl) {
    if (urlMatchesSearch(currentUrl)) return "click"; // continue normal tick
    return "navigate"; // recovery path
  }
  decisions.push(tickDecision("https://www.linkedin.com/search/results/people/?keywords=ovb"));
  decisions.push(tickDecision("https://www.linkedin.com/in/profile/"));
  decisions.push(tickDecision("https://www.linkedin.com/search/results/people/?keywords=ovb&page=3"));
  assertEqual(decisions[0], "click", "On search URL → tick proceeds with click");
  assertEqual(decisions[1], "navigate", "On profile URL → tick navigates first");
  assertEqual(decisions[2], "click", "On search URL with page → tick proceeds with click");
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
