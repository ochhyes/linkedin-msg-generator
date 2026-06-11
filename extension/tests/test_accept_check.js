// Test suite for auto accept-tracker (#56A v1.23.0).
//
// Portuje pure logic z background.js (matchAndFlipAccepts, scheduleNextAcceptCheck,
// nextWorkingHourTs). Synchronizacja manualna z background.js — sprawdzaj
// po zmianach w bg. Dług: #10 BACKLOG (dedup test_e2e.js ↔ content.js + tu).

const ACCEPT_CHECK_PERIOD_MS = 24 * 60 * 60 * 1000;
const ACCEPT_CHECK_JITTER_MS = 30 * 60 * 1000;

// ─── Pure logic ports ───────────────────────────────────────────────

function matchAndFlipAccepts(queue, connections, nowMs) {
  if (!Array.isArray(queue) || !Array.isArray(connections)) {
    return { queue: queue || [], accepted: 0, matchedSlugs: [] };
  }
  const connSlugs = new Set(
    connections
      .map((c) => (c && c.slug ? String(c.slug).toLowerCase() : null))
      .filter(Boolean)
  );
  if (connSlugs.size === 0) {
    return { queue, accepted: 0, matchedSlugs: [] };
  }
  let accepted = 0;
  const matchedSlugs = [];
  const newQueue = queue.map((item) => {
    if (!item || !item.slug) return item;
    if (item.status !== "sent") return item;
    if (item.acceptedAt) return item;
    // #67: defensywny lowercase (sync z background.js).
    if (!connSlugs.has(String(item.slug).toLowerCase())) return item;
    accepted += 1;
    matchedSlugs.push(item.slug);
    return { ...item, acceptedAt: nowMs, lastAcceptCheckAt: nowMs };
  });
  return { queue: newQueue, accepted, matchedSlugs };
}

function scheduleNextAcceptCheck(nowMs, jitterFn) {
  // jitterFn dla determinizmu w testach; default Math.random
  const r = (jitterFn || Math.random)();
  const jitter = Math.floor((r - 0.5) * 2 * ACCEPT_CHECK_JITTER_MS);
  return nowMs + ACCEPT_CHECK_PERIOD_MS + jitter;
}

function nextWorkingHourTs(nowMs, hourStart, hourEnd) {
  const d = new Date(nowMs);
  const hour = d.getHours();
  if (hour >= hourStart && hour < hourEnd) return null;
  const next = new Date(d);
  if (hour < hourStart) {
    next.setHours(hourStart, 5, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(hourStart, 5, 0, 0);
  }
  return next.getTime();
}

// ─── Test helpers ────────────────────────────────────────────────────

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label); }
}
function assertEqual(actual, expected, label) {
  const ok = actual === expected ||
    (typeof actual === "object" && typeof expected === "object" &&
     JSON.stringify(actual) === JSON.stringify(expected));
  if (ok) { passed += 1; console.log("  ✓ " + label); }
  else { failed += 1; console.log("  ✗ " + label + " — expected: " + JSON.stringify(expected) + ", got: " + JSON.stringify(actual)); }
}

function makeQueueItem(slug, status, acceptedAt) {
  return {
    slug,
    name: slug,
    status: status || "sent",
    acceptedAt: acceptedAt || null,
    lastAcceptCheckAt: null,
    messageSentAt: null,
  };
}

const NOW = 1700000000000; // fixed timestamp for determinism

// ── Section A: matchAndFlipAccepts ───────────────────────────────────

console.log("\n# Section A: matchAndFlipAccepts");

// A1. Empty queue
{
  const r = matchAndFlipAccepts([], [{ slug: "alice" }], NOW);
  assertEqual(r.accepted, 0, "A1: empty queue → 0 accepted");
  assertEqual(r.matchedSlugs.length, 0, "A1: empty queue → matchedSlugs=[]");
}

// A2. Empty connections list
{
  const r = matchAndFlipAccepts([makeQueueItem("alice")], [], NOW);
  assertEqual(r.accepted, 0, "A2: empty connections → 0 accepted");
}

// A3. Connection matches sent item without acceptedAt → flip
{
  const q = [makeQueueItem("alice"), makeQueueItem("bob")];
  const c = [{ slug: "alice", name: "Alice" }];
  const r = matchAndFlipAccepts(q, c, NOW);
  assertEqual(r.accepted, 1, "A3: 1 match → 1 accepted");
  assertEqual(r.matchedSlugs, ["alice"], "A3: matchedSlugs=['alice']");
  assertEqual(r.queue[0].acceptedAt, NOW, "A3: alice.acceptedAt = NOW");
  assertEqual(r.queue[0].lastAcceptCheckAt, NOW, "A3: alice.lastAcceptCheckAt = NOW");
  assertEqual(r.queue[1].acceptedAt, null, "A3: bob.acceptedAt unchanged (no match)");
}

// A4. Item already accepted → skip (idempotent)
{
  const q = [makeQueueItem("alice", "sent", 1000000)];
  const c = [{ slug: "alice" }];
  const r = matchAndFlipAccepts(q, c, NOW);
  assertEqual(r.accepted, 0, "A4: already accepted → 0 accepted (idempotent)");
  assertEqual(r.queue[0].acceptedAt, 1000000, "A4: existing acceptedAt preserved");
}

// A5. Item status != "sent" → skip
{
  const q = [makeQueueItem("alice", "queued"), makeQueueItem("bob", "skipped")];
  const c = [{ slug: "alice" }, { slug: "bob" }];
  const r = matchAndFlipAccepts(q, c, NOW);
  assertEqual(r.accepted, 0, "A5: status != 'sent' → 0 accepted");
}

// A6. Case-insensitive match (slug normalization)
{
  const q = [makeQueueItem("alice-smith")];
  const c = [{ slug: "Alice-Smith" }];
  const r = matchAndFlipAccepts(q, c, NOW);
  assertEqual(r.accepted, 1, "A6: case-insensitive slug match");
}

// A7. Multiple matches in same scan
{
  const q = [makeQueueItem("a"), makeQueueItem("b"), makeQueueItem("c", "sent", 999)];
  const c = [{ slug: "a" }, { slug: "b" }, { slug: "c" }, { slug: "d" }];
  const r = matchAndFlipAccepts(q, c, NOW);
  assertEqual(r.accepted, 2, "A7: 2 fresh matches (c already accepted)");
  assertEqual(r.matchedSlugs.sort(), ["a", "b"], "A7: matchedSlugs = [a, b]");
}

// A8. Invalid inputs (null/undefined)
{
  const r1 = matchAndFlipAccepts(null, [{ slug: "x" }], NOW);
  assertEqual(r1.accepted, 0, "A8a: null queue → 0 accepted (no crash)");
  const r2 = matchAndFlipAccepts([makeQueueItem("a")], null, NOW);
  assertEqual(r2.accepted, 0, "A8b: null connections → 0 accepted (no crash)");
}

// A9. Connection without slug → skipped silently
{
  const q = [makeQueueItem("alice")];
  const c = [{ name: "no slug" }, { slug: "alice" }];
  const r = matchAndFlipAccepts(q, c, NOW);
  assertEqual(r.accepted, 1, "A9: connection bez slug ignored, alice matched");
}

// A10. Item without slug in queue → skipped silently
{
  const q = [{ status: "sent", acceptedAt: null }, makeQueueItem("alice")];
  const c = [{ slug: "alice" }];
  const r = matchAndFlipAccepts(q, c, NOW);
  assertEqual(r.accepted, 1, "A10: queue item bez slug ignored");
}

// ── Section B: scheduleNextAcceptCheck (jitter bounds) ───────────────

console.log("\n# Section B: scheduleNextAcceptCheck");

// B1. Jitter min boundary (random=0 → -ACCEPT_CHECK_JITTER_MS)
{
  const ts = scheduleNextAcceptCheck(NOW, () => 0);
  const expected = NOW + ACCEPT_CHECK_PERIOD_MS - ACCEPT_CHECK_JITTER_MS;
  assert(ts === expected, "B1: jitter min (random=0) → period - 30min");
}

// B2. Jitter max boundary (random=1 → +ACCEPT_CHECK_JITTER_MS, but Math.floor caps just below)
{
  const ts = scheduleNextAcceptCheck(NOW, () => 0.9999);
  const expected = NOW + ACCEPT_CHECK_PERIOD_MS + ACCEPT_CHECK_JITTER_MS - 1; // floor((0.4999*2)*30min)
  assert(ts >= NOW + ACCEPT_CHECK_PERIOD_MS + ACCEPT_CHECK_JITTER_MS - 60000, "B2: jitter max (random→1) ≈ period + 30min");
  assert(ts <= NOW + ACCEPT_CHECK_PERIOD_MS + ACCEPT_CHECK_JITTER_MS, "B2: jitter max never exceeds +30min");
}

// B3. Jitter middle (random=0.5 → 0 jitter)
{
  const ts = scheduleNextAcceptCheck(NOW, () => 0.5);
  assert(ts === NOW + ACCEPT_CHECK_PERIOD_MS, "B3: jitter middle (random=0.5) → exactly period");
}

// B4. Multiple calls within bounds
{
  let allInRange = true;
  for (let i = 0; i < 50; i++) {
    const ts = scheduleNextAcceptCheck(NOW, () => Math.random());
    const min = NOW + ACCEPT_CHECK_PERIOD_MS - ACCEPT_CHECK_JITTER_MS;
    const max = NOW + ACCEPT_CHECK_PERIOD_MS + ACCEPT_CHECK_JITTER_MS;
    if (ts < min || ts > max) { allInRange = false; break; }
  }
  assert(allInRange, "B4: 50 random calls all in [period-30min, period+30min]");
}

// ── Section C: nextWorkingHourTs ─────────────────────────────────────

console.log("\n# Section C: nextWorkingHourTs (godziny 9-18)");

function makeTs(hour, minute) {
  const d = new Date(2026, 4, 20, hour, minute || 0, 0, 0); // 20 May 2026
  return d.getTime();
}

// C1. In working hours → null
{
  const r = nextWorkingHourTs(makeTs(10, 30), 9, 18);
  assertEqual(r, null, "C1: 10:30 in 9-18 → null");
  const r2 = nextWorkingHourTs(makeTs(9, 0), 9, 18);
  assertEqual(r2, null, "C1b: 9:00 boundary → null (>=hourStart)");
  const r3 = nextWorkingHourTs(makeTs(17, 59), 9, 18);
  assertEqual(r3, null, "C1c: 17:59 → null (<hourEnd)");
}

// C2. Before working hours → today 9:05
{
  const r = nextWorkingHourTs(makeTs(7, 30), 9, 18);
  const expected = makeTs(9, 5);
  assertEqual(r, expected, "C2: 7:30 → today 9:05");
}

// C3. After working hours → tomorrow 9:05
{
  const r = nextWorkingHourTs(makeTs(19, 30), 9, 18);
  const d = new Date(makeTs(19, 30));
  d.setDate(d.getDate() + 1);
  d.setHours(9, 5, 0, 0);
  assertEqual(r, d.getTime(), "C3: 19:30 → tomorrow 9:05");
}

// C4. Exactly 18:00 → tomorrow 9:05 (boundary: hour >= hourEnd treated as after)
{
  const r = nextWorkingHourTs(makeTs(18, 0), 9, 18);
  const d = new Date(makeTs(18, 0));
  d.setDate(d.getDate() + 1);
  d.setHours(9, 5, 0, 0);
  assertEqual(r, d.getTime(), "C4: 18:00 boundary → tomorrow 9:05");
}

// ── Section D: Integration ──────────────────────────────────────────

console.log("\n# Section D: integration scenario");

// D1. Realistic funnel: 5 invites sent, 3 already accepted manually, 2 nowo accepted via scan
{
  const queue = [
    makeQueueItem("alice", "sent", 1000000),      // already accepted
    makeQueueItem("bob", "sent", null),           // pending → will accept
    makeQueueItem("carol", "sent", 2000000),      // already accepted
    makeQueueItem("dave", "sent", null),          // pending → will accept
    makeQueueItem("eve", "sent", null),           // pending, NOT in connections (not accepted yet)
    makeQueueItem("frank", "queued", null),       // status=queued — skip
  ];
  const connections = [
    { slug: "alice" },     // already accepted, won't be re-marked
    { slug: "bob" },       // new accept
    { slug: "dave" },      // new accept
    { slug: "george" },    // not in queue
  ];
  const r = matchAndFlipAccepts(queue, connections, NOW);
  assertEqual(r.accepted, 2, "D1: 2 nowo accepted (bob + dave)");
  assertEqual(r.matchedSlugs.sort(), ["bob", "dave"], "D1: matchedSlugs = [bob, dave]");
  assertEqual(r.queue[0].acceptedAt, 1000000, "D1: alice preserves existing acceptedAt");
  assertEqual(r.queue[1].acceptedAt, NOW, "D1: bob new acceptedAt");
  assertEqual(r.queue[2].acceptedAt, 2000000, "D1: carol preserves existing acceptedAt");
  assertEqual(r.queue[3].acceptedAt, NOW, "D1: dave new acceptedAt");
  assertEqual(r.queue[4].acceptedAt, null, "D1: eve NOT accepted (nie ma w connections)");
  assertEqual(r.queue[5].acceptedAt, null, "D1: frank skipped (status=queued)");
}

// ── #67: re-enable po update + mixed-case match ─────────────────────

// Port z background.js (sync manualny — debt #10).
function shouldReenableAcceptTracker(ac, failLimit) {
  if (!ac || ac.enabled) return false;
  if (ac.disabledBy === "user") return false;
  if (ac.disabledBy === "auto") return true;
  return (ac.failCount || 0) >= failLimit;
}

console.log("\n[E] #67 shouldReenableAcceptTracker — auto-disable wstaje po update");
{
  const LIMIT = 3;
  assertEqual(
    shouldReenableAcceptTracker({ enabled: false, disabledBy: "auto", failCount: 3 }, LIMIT),
    true, "E1: auto-disabled → re-enable"
  );
  assertEqual(
    shouldReenableAcceptTracker({ enabled: false, disabledBy: "user", failCount: 5 }, LIMIT),
    false, "E1: user-disabled → zostaje wyłączony (nawet z failCount)"
  );
  assertEqual(
    shouldReenableAcceptTracker({ enabled: false, disabledBy: null, failCount: 3 }, LIMIT),
    true, "E1: BC (sprzed #67) failCount>=limit → traktuj jak auto"
  );
  assertEqual(
    shouldReenableAcceptTracker({ enabled: false, disabledBy: null, failCount: 1 }, LIMIT),
    false, "E1: BC failCount<limit → user wyłączył, zostaje"
  );
  assertEqual(
    shouldReenableAcceptTracker({ enabled: true, disabledBy: null, failCount: 0 }, LIMIT),
    false, "E1: włączony → nic do roboty"
  );
  assertEqual(shouldReenableAcceptTracker(null, LIMIT), false, "E1: null state → false");
}

console.log("\n[E] #67 matchAndFlipAccepts — mixed-case slug w queue");
{
  const NOW = 9999;
  const r = matchAndFlipAccepts(
    [{ slug: "Jan-KOWALSKI-123", status: "sent", acceptedAt: null }],
    [{ slug: "jan-kowalski-123" }],
    NOW
  );
  assertEqual(r.accepted, 1, "E2: mixed-case slug w queue matchuje lowercase connection");
  assertEqual(r.queue[0].acceptedAt, NOW, "E2: acceptedAt ustawiony");
}

// ── Summary ─────────────────────────────────────────────────────────

console.log("\n────────────────────");
console.log("PASS: " + passed + " · FAIL: " + failed);
process.exit(failed > 0 ? 1 : 0);
