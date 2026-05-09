/**
 * Post-Connect Messaging Pipeline tests (#21 v1.5.0) — testuje pure logic
 * state extension i transitions. Orchestration end-to-end (chrome.tabs.create,
 * sendMessage round-trip) NIE testowane — wymaga e2e w realnym Chrome.
 *
 * Run: node tests/test_message_pipeline.js
 *
 * UWAGA: re-implementacja helpers z background.js + content.js, jak w
 * test_bulk_connect.js i test_e2e.js. Synchronizuj ręcznie po zmianach
 * w extension/. Debt: #10 BACKLOG (selectors.json + shared module).
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

// ── Re-implementacja helpers z background.js (#21) ──────────────

const ACCEPT_CHECK_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h

function makeQueueItem(slug, name, headline) {
  return {
    slug, name, headline,
    status: "pending",
    timestamp: null,
    error: null,
    acceptedAt: null,
    lastAcceptCheckAt: null,
    scrapedProfile: null,
    messageDraft: null,
    messageStatus: "none",
    messageApprovedAt: null,
    messageSentAt: null,
  };
}

function updateQueueItemLogic(queue, slug, patch) {
  return queue.map((q) => (q.slug === slug ? { ...q, ...patch } : q));
}

function isStaleAcceptCheck(item, nowMs) {
  if (item.status !== "sent") return false;
  if (item.acceptedAt) return false; // już accepted, nie sprawdzaj ponownie
  if (!item.lastAcceptCheckAt) return true;
  return (nowMs - item.lastAcceptCheckAt) > ACCEPT_CHECK_COOLDOWN_MS;
}

function pickAcceptCandidates(queue, nowMs) {
  return queue.filter((q) => isStaleAcceptCheck(q, nowMs));
}

// ── Re-implementacja checkProfileDegree z content.js ─────────────

function checkProfileDegree(doc) {
  const scopes = [
    doc.querySelector(".pv-top-card"),
    doc.querySelector("section.pv-top-card"),
    doc.querySelector(".scaffold-layout__main"),
    doc.querySelector(".scaffold-layout-toolbar"),
    doc, // last resort
  ].filter(Boolean);

  for (const scope of scopes) {
    const messageBtn = scope.querySelector(
      'button[aria-label^="Wiadomość"], button[aria-label^="Message"], a[aria-label^="Wiadomość"], a[aria-label^="Message"]'
    );
    if (messageBtn) return { degree: "1st", status: "accepted" };

    const pendingBtn = scope.querySelector(
      'button[aria-label^="Oczekuje"], button[aria-label^="W toku"], button[aria-label^="Pending"], a[aria-label^="Oczekuje"], a[aria-label^="W toku"], a[aria-label^="Pending"]'
    );
    if (pendingBtn) return { degree: "2nd", status: "pending" };

    const connectBtn = scope.querySelector(
      'button[aria-label^="Zaproś"], button[aria-label^="Połącz"], button[aria-label^="Invite"], button[aria-label^="Connect"], a[aria-label^="Zaproś"], a[aria-label^="Połącz"], a[aria-label^="Invite"], a[aria-label^="Connect"]'
    );
    if (connectBtn) return { degree: "2nd", status: "connectable" };
  }
  return { degree: "unknown", status: "unknown" };
}

// ── Test suite ───────────────────────────────────

console.log("\n▸ makeQueueItem — Faza 2 fields default'y");
{
  const item = makeQueueItem("alice-123", "Alice A.", "Engineer");
  assertEqual(item.slug, "alice-123", "slug set");
  assertEqual(item.name, "Alice A.", "name set");
  assertEqual(item.status, "pending", "status default 'pending'");
  assertEqual(item.acceptedAt, null, "acceptedAt default null");
  assertEqual(item.lastAcceptCheckAt, null, "lastAcceptCheckAt default null");
  assertEqual(item.scrapedProfile, null, "scrapedProfile default null");
  assertEqual(item.messageDraft, null, "messageDraft default null");
  assertEqual(item.messageStatus, "none", "messageStatus default 'none'");
  assertEqual(item.messageApprovedAt, null, "messageApprovedAt default null");
  assertEqual(item.messageSentAt, null, "messageSentAt default null");
}

console.log("\n▸ updateQueueItem — patch Faza 2 pola");
{
  const queue = [
    makeQueueItem("alice", "Alice", "Eng"),
    makeQueueItem("bob", "Bob", "PM"),
  ];
  // Mark sent.
  let updated = updateQueueItemLogic(queue, "alice", { status: "sent", timestamp: 1000 });
  assertEqual(updated[0].status, "sent", "Alice status 'sent'");
  assertEqual(updated[1].status, "pending", "Bob unchanged");

  // Mark accepted.
  updated = updateQueueItemLogic(updated, "alice", { acceptedAt: 5000, lastAcceptCheckAt: 5000 });
  assertEqual(updated[0].acceptedAt, 5000, "Alice acceptedAt set");
  assertEqual(updated[0].lastAcceptCheckAt, 5000, "Alice lastAcceptCheckAt set");

  // Set draft.
  updated = updateQueueItemLogic(updated, "alice", { messageDraft: "Hej Alice...", messageStatus: "draft" });
  assertEqual(updated[0].messageDraft, "Hej Alice...", "Alice draft set");
  assertEqual(updated[0].messageStatus, "draft", "Alice messageStatus 'draft'");

  // Approve + send.
  updated = updateQueueItemLogic(updated, "alice", { messageStatus: "approved", messageApprovedAt: 6000 });
  assertEqual(updated[0].messageStatus, "approved", "Alice messageStatus 'approved'");
  updated = updateQueueItemLogic(updated, "alice", { messageStatus: "sent", messageSentAt: 7000 });
  assertEqual(updated[0].messageStatus, "sent", "Alice messageStatus 'sent'");
  assertEqual(updated[0].messageSentAt, 7000, "Alice messageSentAt set");
}

console.log("\n▸ Rate-limit accept check — 4h cooldown");
{
  const NOW = 1_000_000_000;
  const FOUR_H = 4 * 60 * 60 * 1000;

  // Sent + nigdy nie sprawdzane → stale (do scan).
  let item = makeQueueItem("alice", "Alice", "Eng");
  item.status = "sent";
  assertEqual(isStaleAcceptCheck(item, NOW), true, "Sent + never checked → stale");

  // Sent + sprawdzane 5h temu → stale.
  item.lastAcceptCheckAt = NOW - 5 * 60 * 60 * 1000;
  assertEqual(isStaleAcceptCheck(item, NOW), true, "Sent + 5h ago → stale");

  // Sent + sprawdzane 3h temu → fresh (skip).
  item.lastAcceptCheckAt = NOW - 3 * 60 * 60 * 1000;
  assertEqual(isStaleAcceptCheck(item, NOW), false, "Sent + 3h ago → fresh, skip");

  // Sent + lastCheckAt = NOW - exactly 4h → na granicy (fresh, bo > nie ≥).
  item.lastAcceptCheckAt = NOW - FOUR_H;
  assertEqual(isStaleAcceptCheck(item, NOW), false, "Exactly 4h boundary → fresh");
  item.lastAcceptCheckAt = NOW - FOUR_H - 1;
  assertEqual(isStaleAcceptCheck(item, NOW), true, "4h + 1ms → stale");

  // Already accepted → nigdy nie stale.
  item.acceptedAt = NOW - 24 * 60 * 60 * 1000;
  item.lastAcceptCheckAt = NOW - 10 * 60 * 60 * 1000;
  assertEqual(isStaleAcceptCheck(item, NOW), false, "Already accepted → never stale");

  // Status != sent (pending/failed) → nigdy nie stale.
  item.acceptedAt = null;
  item.status = "pending";
  assertEqual(isStaleAcceptCheck(item, NOW), false, "Pending status → not stale");
  item.status = "failed";
  assertEqual(isStaleAcceptCheck(item, NOW), false, "Failed status → not stale");
}

console.log("\n▸ pickAcceptCandidates — filter sent + stale");
{
  const NOW = 1_000_000_000;
  const queue = [
    { ...makeQueueItem("alice", "Alice", "Eng"), status: "sent", lastAcceptCheckAt: null },
    { ...makeQueueItem("bob", "Bob", "PM"), status: "sent", lastAcceptCheckAt: NOW - 5 * 60 * 60 * 1000 },
    { ...makeQueueItem("carol", "Carol", "Designer"), status: "sent", lastAcceptCheckAt: NOW - 1 * 60 * 60 * 1000 },
    { ...makeQueueItem("dave", "Dave", "Sales"), status: "sent", lastAcceptCheckAt: null, acceptedAt: NOW - 24 * 60 * 60 * 1000 },
    { ...makeQueueItem("eve", "Eve", "QA"), status: "pending" },
    { ...makeQueueItem("frank", "Frank", "Eng"), status: "failed" },
  ];
  const candidates = pickAcceptCandidates(queue, NOW);
  assertEqual(candidates.length, 2, "Picks 2 candidates (alice + bob)");
  const slugs = candidates.map((c) => c.slug).sort();
  assertEqual(slugs[0], "alice", "Alice in candidates (never checked)");
  assertEqual(slugs[1], "bob", "Bob in candidates (>4h ago)");
}

console.log("\n▸ checkProfileDegree — 1st degree (Wiadomość button)");
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <main><section class="pv-top-card">
      <button aria-label="Wiadomość Alice">Wiadomość</button>
    </section></main>
  </body></html>`);
  const result = checkProfileDegree(dom.window.document);
  assertEqual(result.degree, "1st", "1st degree detected (PL)");
  assertEqual(result.status, "accepted", "status 'accepted'");
}

console.log("\n▸ checkProfileDegree — EN locale (Message button)");
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="pv-top-card">
      <button aria-label="Message Alice">Message</button>
    </section>
  </body></html>`);
  const result = checkProfileDegree(dom.window.document);
  assertEqual(result.degree, "1st", "1st degree detected (EN)");
}

console.log("\n▸ checkProfileDegree — pending invite");
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="pv-top-card">
      <button aria-label="Oczekuje">Oczekuje</button>
    </section>
  </body></html>`);
  const result = checkProfileDegree(dom.window.document);
  assertEqual(result.degree, "2nd", "Pending → 2nd");
  assertEqual(result.status, "pending", "status 'pending' (PL Oczekuje)");

  const dom2 = new JSDOM(`<!doctype html><html><body>
    <section class="pv-top-card">
      <button aria-label="W toku">W toku</button>
    </section>
  </body></html>`);
  const r2 = checkProfileDegree(dom2.window.document);
  assertEqual(r2.status, "pending", "status 'pending' (PL W toku)");

  const dom3 = new JSDOM(`<!doctype html><html><body>
    <section class="pv-top-card">
      <button aria-label="Pending invitation">Pending</button>
    </section>
  </body></html>`);
  const r3 = checkProfileDegree(dom3.window.document);
  assertEqual(r3.status, "pending", "status 'pending' (EN)");
}

console.log("\n▸ checkProfileDegree — connectable (Połącz / Connect)");
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="pv-top-card">
      <button aria-label="Zaproś użytkownika Alice do nawiązania kontaktu">Połącz</button>
    </section>
  </body></html>`);
  const result = checkProfileDegree(dom.window.document);
  assertEqual(result.degree, "2nd", "Connectable → 2nd");
  assertEqual(result.status, "connectable", "status 'connectable' (PL Zaproś)");

  const dom2 = new JSDOM(`<!doctype html><html><body>
    <section class="pv-top-card">
      <button aria-label="Connect with Alice">Connect</button>
    </section>
  </body></html>`);
  const r2 = checkProfileDegree(dom2.window.document);
  assertEqual(r2.status, "connectable", "status 'connectable' (EN Connect)");
}

console.log("\n▸ checkProfileDegree — pierwszeństwo: Wiadomość przed Połącz");
{
  // Edge case: top-card profile 1st degree pokazuje Wiadomość, ale w innej
  // sekcji może być "Połącz" (np. sidebar PYMK). Helper iteruje scope'y od
  // najwęższego. Wiadomość w pv-top-card → 1st, ignore Połącz w sidebarze.
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="pv-top-card">
      <button aria-label="Wiadomość Alice">Wiadomość</button>
    </section>
    <aside><button aria-label="Połącz Bob">Połącz</button></aside>
  </body></html>`);
  const result = checkProfileDegree(dom.window.document);
  assertEqual(result.degree, "1st", "Wiadomość in top-card wygrywa nad Połącz w aside");
}

console.log("\n▸ checkProfileDegree — unknown gdy brak buttonów");
{
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="pv-top-card"><h1>Profile</h1></section>
  </body></html>`);
  const result = checkProfileDegree(dom.window.document);
  assertEqual(result.degree, "unknown", "Brak buttonów → unknown");
  assertEqual(result.status, "unknown", "status 'unknown'");
}

console.log("\n▸ Message status transitions — pełen lifecycle");
{
  let queue = [makeQueueItem("alice", "Alice", "Eng")];

  // Initial: messageStatus=none.
  assertEqual(queue[0].messageStatus, "none", "Initial messageStatus 'none'");

  // After bulkConnectClick: status=sent (Faza 1B side).
  queue = updateQueueItemLogic(queue, "alice", { status: "sent", timestamp: 1000 });
  assertEqual(queue[0].status, "sent", "Connect sent");

  // After bulkCheckAccepts: acceptedAt set.
  queue = updateQueueItemLogic(queue, "alice", { acceptedAt: 5000, lastAcceptCheckAt: 5000 });
  assert(queue[0].acceptedAt !== null, "Accept detected");

  // After bulkGenerateMessage: messageDraft set, messageStatus='draft'.
  queue = updateQueueItemLogic(queue, "alice", { messageDraft: "Hej Alice, dzięki za przyjęcie!", messageStatus: "draft" });
  assertEqual(queue[0].messageStatus, "draft", "After generate: messageStatus 'draft'");

  // User edytuje draft → messageDraft updated, status nadal draft.
  queue = updateQueueItemLogic(queue, "alice", { messageDraft: "Hej Alice, miło że dołączyliśmy!" });
  assertEqual(queue[0].messageStatus, "draft", "Edit keeps messageStatus 'draft'");
  assertEqual(queue[0].messageDraft, "Hej Alice, miło że dołączyliśmy!", "Draft edited");

  // After approveMessage: messageStatus='approved'.
  queue = updateQueueItemLogic(queue, "alice", { messageStatus: "approved", messageApprovedAt: 6000 });
  assertEqual(queue[0].messageStatus, "approved", "After approve: 'approved'");

  // After bulkMarkMessageSent: messageStatus='sent'.
  queue = updateQueueItemLogic(queue, "alice", { messageStatus: "sent", messageSentAt: 7000 });
  assertEqual(queue[0].messageStatus, "sent", "After send: 'sent'");
  assert(queue[0].messageSentAt !== null, "messageSentAt timestamp set");
}

console.log("\n▸ Skip path — bezpośrednio z draft → skipped");
{
  let queue = [makeQueueItem("alice", "Alice", "Eng")];
  queue = updateQueueItemLogic(queue, "alice", { status: "sent", acceptedAt: 5000, messageDraft: "draft", messageStatus: "draft" });
  // User klika "Pomiń" → skipped, draft pozostaje (history).
  queue = updateQueueItemLogic(queue, "alice", { messageStatus: "skipped" });
  assertEqual(queue[0].messageStatus, "skipped", "Skipped status");
  assertEqual(queue[0].messageDraft, "draft", "Draft preserved (history)");
}

// ── Summary ──────────────────────────────────
console.log("\n=== test_message_pipeline.js ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
