/**
 * Reply tracking tests (#38 v1.11.0) — testuje pure logic mark/unmark
 * reply per stage (msg / FU#1 / FU#2) + computeStats math (funnel rates,
 * 1-decimal precision, divide-by-zero safety, BC dla legacy items).
 *
 * Pattern jak test_followup.js: re-implementacja helpers z background.js,
 * synchronizuj ręcznie po zmianach. Debt: #10 BACKLOG (shared module).
 *
 * Run: node tests/test_reply.js
 *
 * Pokrycie (≥20 asercji):
 *  A. Schema defaults (messageReplyAt / followup{1,2}ReplyAt = null)
 *  B. markReply per stage (msg / FU#1 / FU#2 → set timestamp + status)
 *  C. Idempotency (drugi mark zachowuje pierwszy timestamp)
 *  D. Unmark restore (status → "scheduled" gdy żaden inny ReplyAt)
 *  E. Stats math (acceptRate, replyRate, anyReply uniqueness)
 *  F. Edge cases (empty queue, divide-by-zero, BC undefined fields)
 *  G. 1-decimal precision (33.3, 66.7) + null den (BC)
 */

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
    failures.push(`${testName}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    console.log(`  ✗ ${testName}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

// ── Helper logic re-implementation (mirror background.js #38) ────

/**
 * Mirror bulkMarkMessageReply logic. Idempotent — drugi mark zachowuje
 * pierwszy timestamp (alreadyMarked=true). Set followupStatus="replied"
 * (auto-cancel scheduled FU#1+FU#2).
 */
function markMessageReplyLogic(item) {
  if (!item || !item.slug) return { success: false, error: "no_slug" };
  if (item.messageReplyAt) return { success: true, alreadyMarked: true, item };
  return {
    success: true,
    item: { ...item, messageReplyAt: Date.now(), followupStatus: "replied" },
  };
}

function markFollowup1ReplyLogic(item) {
  if (!item || !item.slug) return { success: false, error: "no_slug" };
  if (item.followup1ReplyAt) return { success: true, alreadyMarked: true, item };
  return {
    success: true,
    item: { ...item, followup1ReplyAt: Date.now(), followupStatus: "replied" },
  };
}

function markFollowup2ReplyLogic(item) {
  if (!item || !item.slug) return { success: false, error: "no_slug" };
  if (item.followup2ReplyAt) return { success: true, alreadyMarked: true, item };
  return {
    success: true,
    item: { ...item, followup2ReplyAt: Date.now(), followupStatus: "replied" },
  };
}

/**
 * Mirror bulkUnmarkReply logic. Restore'uje followupStatus do "scheduled"
 * gdy żaden inny ReplyAt nie set (np. user cofnął message reply ale FU#1
 * dalej replied → status zostaje "replied"). Stage ∈ {message, followup1, followup2}.
 */
function unmarkReplyLogic(item, stage) {
  if (!item || !item.slug || !stage) return { success: false, error: "no_slug_or_stage" };
  const fieldMap = {
    message: "messageReplyAt",
    followup1: "followup1ReplyAt",
    followup2: "followup2ReplyAt",
  };
  const removedField = fieldMap[stage];
  if (!removedField) return { success: false, error: "bad_stage" };

  const next = { ...item, [removedField]: null };

  // Restore followupStatus do "scheduled" gdy żaden inny ReplyAt nie set.
  const otherFields = Object.values(fieldMap).filter((f) => f !== removedField);
  const hasOtherReply = otherFields.some((f) => next[f] != null);
  if (!hasOtherReply && next.followupStatus === "replied") {
    next.followupStatus = "scheduled";
  }
  return { success: true, item: next };
}

function pct(num, den) {
  if (!den || den <= 0) return 0;
  return Math.round((num / den) * 1000) / 10;
}

function computeStats(queue) {
  const totals = {
    invitesSent: 0, accepted: 0, messagesSent: 0,
    messageReplies: 0, followup1Sent: 0, followup1Replies: 0,
    followup2Sent: 0, followup2Replies: 0, anyReply: 0,
  };
  for (const item of queue) {
    if (item.status === "sent" || item.status === "manual_sent") totals.invitesSent++;
    if (item.acceptedAt != null) totals.accepted++;
    if (item.messageSentAt != null) totals.messagesSent++;
    if (item.messageReplyAt != null) totals.messageReplies++;
    if (item.followup1SentAt != null) totals.followup1Sent++;
    if (item.followup1ReplyAt != null) totals.followup1Replies++;
    if (item.followup2SentAt != null) totals.followup2Sent++;
    if (item.followup2ReplyAt != null) totals.followup2Replies++;
    if (item.messageReplyAt != null || item.followup1ReplyAt != null || item.followup2ReplyAt != null) totals.anyReply++;
  }
  return {
    totals,
    rates: {
      acceptRate: pct(totals.accepted, totals.invitesSent),
      messageReplyRate: pct(totals.messageReplies, totals.messagesSent),
      followup1ReplyRate: pct(totals.followup1Replies, totals.followup1Sent),
      followup2ReplyRate: pct(totals.followup2Replies, totals.followup2Sent),
      overallReplyRate: pct(totals.anyReply, totals.messagesSent),
    },
  };
}

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
    pageNumber: 1,
    followup1RemindAt: null,
    followup2RemindAt: null,
    followup1Draft: null,
    followup2Draft: null,
    followup1SentAt: null,
    followup2SentAt: null,
    followupStatus: "scheduled",
    // #38 reply tracking:
    messageReplyAt: null,
    followup1ReplyAt: null,
    followup2ReplyAt: null,
  };
}

// ── Tests ────────────────────────────────────────────────────────

console.log("\n▸ A. Schema defaults");
{
  const item = makeQueueItem("test-1", "Test Person", "CEO");
  assertEqual(item.messageReplyAt, null, "Default messageReplyAt = null");
  assertEqual(item.followup1ReplyAt, null, "Default followup1ReplyAt = null");
  assertEqual(item.followup2ReplyAt, null, "Default followup2ReplyAt = null");
}

console.log("\n▸ B. markReply per stage");
{
  const base = makeQueueItem("anna", "Anna", "PM");
  const r1 = markMessageReplyLogic(base);
  assert(r1.success, "markMessageReplyLogic returns success");
  assert(typeof r1.item.messageReplyAt === "number", "messageReplyAt set to number timestamp");
  assertEqual(r1.item.followupStatus, "replied", "followupStatus = 'replied' after msg reply");

  const r2 = markFollowup1ReplyLogic(base);
  assert(typeof r2.item.followup1ReplyAt === "number", "followup1ReplyAt set to number timestamp");
  assertEqual(r2.item.followupStatus, "replied", "followupStatus = 'replied' after FU#1 reply");

  const r3 = markFollowup2ReplyLogic(base);
  assert(typeof r3.item.followup2ReplyAt === "number", "followup2ReplyAt set to number timestamp");
  assertEqual(r3.item.followupStatus, "replied", "followupStatus = 'replied' after FU#2 reply");
}

console.log("\n▸ C. Idempotency");
{
  const base = makeQueueItem("bob", "Bob", "Dev");
  const first = markMessageReplyLogic(base);
  const firstTs = first.item.messageReplyAt;
  const second = markMessageReplyLogic(first.item);
  assert(second.alreadyMarked === true, "Second markMessageReply returns alreadyMarked=true");
  assertEqual(second.item.messageReplyAt, firstTs, "messageReplyAt timestamp preserved on second mark");
}

console.log("\n▸ D. unmarkReply restore");
{
  const replied = {
    ...makeQueueItem("carol", "Carol", "CTO"),
    messageReplyAt: 1000,
    followupStatus: "replied",
  };
  const u1 = unmarkReplyLogic(replied, "message");
  assertEqual(u1.item.messageReplyAt, null, "unmark message → messageReplyAt = null");
  assertEqual(u1.item.followupStatus, "scheduled", "unmark message → followupStatus = 'scheduled' (restored)");

  const u2 = unmarkReplyLogic(replied, "bogus");
  assert(u2.success === false && u2.error === "bad_stage", "unmark with bad stage → error 'bad_stage'");

  const twoReplies = {
    ...makeQueueItem("dave", "Dave", "CEO"),
    messageReplyAt: 1000,
    followup1ReplyAt: 2000,
    followupStatus: "replied",
  };
  const u3 = unmarkReplyLogic(twoReplies, "message");
  assertEqual(u3.item.messageReplyAt, null, "unmark message (2 replies) → msg cleared");
  assertEqual(u3.item.followup1ReplyAt, 2000, "unmark message (2 replies) → FU#1 ReplyAt preserved");
  assertEqual(u3.item.followupStatus, "replied", "unmark message (2 replies) → status stays 'replied'");
}

console.log("\n▸ E. Stats math — funnel + rates");
{
  // Empty queue
  const empty = computeStats([]);
  assertEqual(empty.totals.invitesSent, 0, "Empty queue → invitesSent=0");
  assertEqual(empty.rates.acceptRate, 0, "Empty queue → acceptRate=0 (NOT NaN)");
  assertEqual(empty.rates.messageReplyRate, 0, "Empty queue → messageReplyRate=0");

  // 10 invites, 5 accepted → acceptRate=50
  const q1 = [];
  for (let i = 0; i < 10; i++) {
    const it = makeQueueItem(`p${i}`, `P${i}`, "");
    it.status = "sent";
    if (i < 5) it.acceptedAt = 1000 + i;
    q1.push(it);
  }
  const s1 = computeStats(q1);
  assertEqual(s1.totals.invitesSent, 10, "10 sent invites counted");
  assertEqual(s1.totals.accepted, 5, "5 accepted counted");
  assertEqual(s1.rates.acceptRate, 50, "10 invites / 5 accepted → acceptRate=50");

  // 10 msgs sent, 3 replied → messageReplyRate=30
  const q2 = [];
  for (let i = 0; i < 10; i++) {
    const it = makeQueueItem(`m${i}`, `M${i}`, "");
    it.messageSentAt = 1000 + i;
    if (i < 3) it.messageReplyAt = 2000 + i;
    q2.push(it);
  }
  const s2 = computeStats(q2);
  assertEqual(s2.rates.messageReplyRate, 30, "10 msgs / 3 replies → messageReplyRate=30");

  // Divide-by-zero — 0 msgs sent
  const q3 = [makeQueueItem("x", "X", "")];
  const s3 = computeStats(q3);
  assertEqual(s3.rates.messageReplyRate, 0, "0 msgs sent → messageReplyRate=0 (NOT NaN/Infinity)");

  // 1 msg sent, 1 replied → 100
  const oneItem = makeQueueItem("solo", "Solo", "");
  oneItem.messageSentAt = 1000;
  oneItem.messageReplyAt = 2000;
  const s4 = computeStats([oneItem]);
  assertEqual(s4.rates.messageReplyRate, 100, "1 msg / 1 reply → messageReplyRate=100");

  // Mixed scenario
  const mixed = [];
  for (let i = 0; i < 5; i++) {
    const it = makeQueueItem(`mix${i}`, `Mix${i}`, "");
    it.status = "sent";
    if (i < 3) it.acceptedAt = 1000 + i;
    if (i < 2) it.messageSentAt = 2000 + i;
    if (i < 1) it.messageReplyAt = 3000;
    mixed.push(it);
  }
  const sm = computeStats(mixed);
  assertEqual(sm.rates.acceptRate, 60, "Mixed: 5 invites / 3 accept → acceptRate=60");
  assertEqual(sm.rates.messageReplyRate, 50, "Mixed: 2 msg / 1 reply → messageReplyRate=50");
  assertEqual(sm.rates.followup1ReplyRate, 0, "Mixed: 0 FU#1 sent → FU#1 reply rate=0");
  assertEqual(sm.rates.overallReplyRate, 50, "Mixed: anyReply=1 / msgsSent=2 → overall=50");
}

console.log("\n▸ F. anyReply uniqueness + counter sanity");
{
  // Item z reply na msg liczy się w messageReplies AND anyReply
  const justMsg = makeQueueItem("a", "A", "");
  justMsg.messageSentAt = 1000;
  justMsg.messageReplyAt = 2000;
  const s5 = computeStats([justMsg]);
  assertEqual(s5.totals.messageReplies, 1, "msg reply counted in messageReplies");
  assertEqual(s5.totals.anyReply, 1, "msg reply counted in anyReply");

  // Item z replies na msg + FU1 + FU2 → anyReply=1 (uniqueness per item, NOT 3)
  const allThree = makeQueueItem("b", "B", "");
  allThree.messageSentAt = 1000;
  allThree.messageReplyAt = 2000;
  allThree.followup1SentAt = 3000;
  allThree.followup1ReplyAt = 4000;
  allThree.followup2SentAt = 5000;
  allThree.followup2ReplyAt = 6000;
  const s6 = computeStats([allThree]);
  assertEqual(s6.totals.anyReply, 1, "Item z 3 reply stages → anyReply=1 (uniqueness per item)");
  assertEqual(s6.totals.messageReplies, 1, "msg reply count = 1");
  assertEqual(s6.totals.followup1Replies, 1, "FU#1 reply count = 1");
  assertEqual(s6.totals.followup2Replies, 1, "FU#2 reply count = 1");
}

console.log("\n▸ G. Backward-compat (legacy items bez ReplyAt fields)");
{
  // Legacy item (sprzed v1.11.0) — fields undefined zamiast null
  const legacy = {
    slug: "legacy", name: "Legacy", headline: "",
    status: "sent",
    acceptedAt: 1000,
    messageSentAt: 2000,
    // BRAK: messageReplyAt, followup1ReplyAt, followup2ReplyAt
  };
  const s7 = computeStats([legacy]);
  assertEqual(s7.totals.messageReplies, 0, "Legacy item bez messageReplyAt → messageReplies=0 (undefined != null is false)");
  assertEqual(s7.totals.anyReply, 0, "Legacy item → anyReply=0");
  assertEqual(s7.rates.messageReplyRate, 0, "Legacy item z msgSent ale bez ReplyAt → messageReplyRate=0/1=0");
}

console.log("\n▸ H. 1-decimal precision");
{
  assertEqual(pct(1, 3), 33.3, "pct(1, 3) = 33.3 (rounded to 1 decimal)");
  assertEqual(pct(2, 3), 66.7, "pct(2, 3) = 66.7 (rounded to 1 decimal)");
}

console.log("\n▸ I. pct edge cases");
{
  assertEqual(pct(0, 0), 0, "pct(0, 0) = 0 (NOT NaN)");
  assertEqual(pct(5, null), 0, "pct(5, null) = 0 (BC dla missing den)");
  assertEqual(pct(5, undefined), 0, "pct(5, undefined) = 0");
}

// ── Summary ──────────────────────────────────────────────────────
console.log("\n=== test_reply.js ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
