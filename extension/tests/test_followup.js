/**
 * Follow-upy 3d/7d tests (#25 v1.7.0) — testuje pure logic state extension
 * dla follow-up reminderów po wysłaniu pierwszej wiadomości. Pattern jak
 * test_message_pipeline.js: re-implementacja helpers z background.js,
 * synchronizuj ręcznie po zmianach. Debt: #10 BACKLOG (shared module).
 *
 * Run: node tests/test_followup.js
 *
 * Pokrycie (≥15 asercji):
 *  A. Schema defaults dla nowego queue item (followup pola = null /
 *     followupStatus = "scheduled")
 *  B. Hook w bulkMarkMessageSent — set RemindAt'y + idempotency
 *  C. Due math (past/future, sentAt guard, skipped, !messageSentAt)
 *  D. Filter/list due — A/B/C/D scenariusze (B daje DWA entries)
 *  E. State transitions — markFollowupSent znika z due, skip permanent
 *  F. Backward-compat — item bez nowych pól nie crashuje filter
 *  G. Badge counter formatting — 0 / N / 99+
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
    failures.push(`${testName}: got "${actual}", expected "${expected}"`);
    console.log(`  ✗ ${testName}: got "${actual}", expected "${expected}"`);
  }
}

function assertClose(actual, expected, tolerance, testName) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passed++;
    console.log(`  ✓ ${testName} (diff=${diff}ms ≤ ${tolerance}ms)`);
  } else {
    failed++;
    failures.push(`${testName}: |${actual} - ${expected}| = ${diff} > ${tolerance}`);
    console.log(`  ✗ ${testName}: |${actual} - ${expected}| = ${diff} > ${tolerance}`);
  }
}

// ── Re-implementacja helpers z background.js (#25) ───────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Zwraca queue item z domyślnymi polami follow-up. Mirror addToQueue
 * w background.js:230-272 (Sprint #4 #25 v1.7.0).
 */
function makeQueueItem(slug, name, headline) {
  return {
    slug, name, headline,
    status: "pending",
    timestamp: null,
    error: null,
    // Faza 2 (#21):
    acceptedAt: null,
    lastAcceptCheckAt: null,
    scrapedProfile: null,
    messageDraft: null,
    messageStatus: "none",
    messageApprovedAt: null,
    messageSentAt: null,
    // Faza 3 (#22):
    pageNumber: 1,
    // Sprint #4 (#25):
    followup1RemindAt: null,
    followup2RemindAt: null,
    followup1Draft: null,
    followup2Draft: null,
    followup1SentAt: null,
    followup2SentAt: null,
    followupStatus: "scheduled",
  };
}

function updateQueueItemLogic(queue, slug, patch) {
  return queue.map((q) => (q.slug === slug ? { ...q, ...patch } : q));
}

/**
 * Mirror hook w bulkMarkMessageSent (background.js:439-459). Idempotent —
 * gdy followup1RemindAt już ustawiony, NIE nadpisuje (drugi klik "Wysłałem"
 * nie restartuje 3d/7d odliczania).
 */
function bulkMarkMessageSentLogic(queue, slug, now) {
  let next = updateQueueItemLogic(queue, slug, {
    messageStatus: "sent",
    messageSentAt: now,
  });
  const item = next.find((q) => q.slug === slug);
  if (item && item.followup1RemindAt == null) {
    next = updateQueueItemLogic(next, slug, {
      followup1RemindAt: now + 3 * DAY_MS,
      followup2RemindAt: now + 7 * DAY_MS,
      followupStatus: "scheduled",
    });
  }
  return next;
}

/**
 * Mirror bulkListDueFollowups (background.js:508-541). Per-profil może być
 * dwa entries (FU#1 + FU#2) gdy oba RemindAt'y minęły. Sort po messageSentAt
 * asc (najstarszy sent first).
 */
function bulkListDueFollowupsLogic(queue, now) {
  const items = [];
  for (const item of queue) {
    if (item.followupStatus !== "scheduled") continue;
    if (!item.messageSentAt) continue;
    const daysSinceSent = Math.floor((now - item.messageSentAt) / DAY_MS);
    if (item.followup1RemindAt && item.followup1RemindAt <= now && !item.followup1SentAt) {
      items.push({
        slug: item.slug,
        name: item.name,
        headline: item.headline,
        messageSentAt: item.messageSentAt,
        dueFollowup: 1,
        daysSinceSent,
        draft: item.followup1Draft || "",
      });
    }
    if (item.followup2RemindAt && item.followup2RemindAt <= now && !item.followup2SentAt) {
      items.push({
        slug: item.slug,
        name: item.name,
        headline: item.headline,
        messageSentAt: item.messageSentAt,
        dueFollowup: 2,
        daysSinceSent,
        draft: item.followup2Draft || "",
      });
    }
  }
  items.sort((a, b) => a.messageSentAt - b.messageSentAt);
  return items;
}

function bulkMarkFollowupSentLogic(queue, slug, followupNum, now) {
  const patch = followupNum === 1
    ? { followup1SentAt: now }
    : { followup2SentAt: now };
  return updateQueueItemLogic(queue, slug, patch);
}

function bulkSkipFollowupLogic(queue, slug) {
  return updateQueueItemLogic(queue, slug, { followupStatus: "skipped" });
}

/**
 * Mirror inline format z updateFollowupBadge (background.js:492). Wyodrębnione
 * jako pure function dla testów — w background.js logika siedzi inline w
 * setBadgeText call. Jeśli kiedyś wyniesiona jako helper, test pokryje też ją.
 */
function formatBadgeText(count) {
  return count > 0 ? (count > 99 ? "99+" : String(count)) : "";
}

// ── Test suite ───────────────────────────────────────────────────

// A. Schema defaults dla nowego queue item ────────────────────────
console.log("\n▸ A. Schema defaults — nowy queue item ma followup pola null / scheduled");
{
  const item = makeQueueItem("alice", "Alice A.", "Engineer");

  // Single deep check obejmuje wszystkie 7 nowych pól + status — 1 asercja na całość.
  const followupShape = {
    followup1RemindAt: item.followup1RemindAt,
    followup2RemindAt: item.followup2RemindAt,
    followup1Draft: item.followup1Draft,
    followup2Draft: item.followup2Draft,
    followup1SentAt: item.followup1SentAt,
    followup2SentAt: item.followup2SentAt,
    followupStatus: item.followupStatus,
  };
  const expected = {
    followup1RemindAt: null, followup2RemindAt: null,
    followup1Draft: null, followup2Draft: null,
    followup1SentAt: null, followup2SentAt: null,
    followupStatus: "scheduled",
  };
  assertEqual(JSON.stringify(followupShape), JSON.stringify(expected),
    "All 7 follow-up fields default'y poprawne (RemindAt/Draft/SentAt = null, status = 'scheduled')");

  // Granularne — easier debug gdy fail.
  assertEqual(item.followup1RemindAt, null, "followup1RemindAt default null");
  assertEqual(item.followupStatus, "scheduled", "followupStatus default 'scheduled'");
}

// B. Hook w bulkMarkMessageSent ───────────────────────────────────
console.log("\n▸ B. Hook bulkMarkMessageSent — set RemindAt'y + idempotency");
{
  const NOW = 1_700_000_000_000;
  const queue = [makeQueueItem("alice", "Alice", "Eng")];

  // Pierwszy call: ustaw messageSentAt + RemindAt'y.
  const after1 = bulkMarkMessageSentLogic(queue, "alice", NOW);
  const alice1 = after1.find((q) => q.slug === "alice");

  assertClose(alice1.messageSentAt, NOW, 100, "messageSentAt ≈ now");
  assertClose(alice1.followup1RemindAt, NOW + 3 * DAY_MS, 100, "followup1RemindAt ≈ now + 3d");
  assertClose(alice1.followup2RemindAt, NOW + 7 * DAY_MS, 100, "followup2RemindAt ≈ now + 7d");
  assertEqual(alice1.followupStatus, "scheduled", "followupStatus = 'scheduled' po hook'u");

  // Drugi call (user kliknął "Wysłałem" ponownie) → idempotent: NIE nadpisuje.
  const LATER = NOW + 3600_000; // godzinę później
  const after2 = bulkMarkMessageSentLogic(after1, "alice", LATER);
  const alice2 = after2.find((q) => q.slug === "alice");

  // messageSentAt MOŻE być nadpisany (status update jest niezależny od idempotent
  // hook'u w live kodzie — drugi call updatuje messageSentAt = LATER), ale
  // RemindAt'y MUSZĄ pozostać przy oryginalnym NOW.
  assertEqual(alice2.followup1RemindAt, alice1.followup1RemindAt,
    "Idempotency: drugi call NIE nadpisuje followup1RemindAt");
  assertEqual(alice2.followup2RemindAt, alice1.followup2RemindAt,
    "Idempotency: drugi call NIE nadpisuje followup2RemindAt");
}

// C. Due math ──────────────────────────────────────────────────────
console.log("\n▸ C. Due math — past/future, sent guard, skipped, !messageSentAt");
{
  const NOW = 1_700_000_000_000;

  // Due: RemindAt past, !followup1SentAt.
  const dueItem = {
    ...makeQueueItem("a1", "A1", ""),
    messageSentAt: NOW - 4 * DAY_MS,
    followup1RemindAt: NOW - 1000, // 1 sek temu
    followup2RemindAt: NOW + DAY_MS,
  };
  let due = bulkListDueFollowupsLogic([dueItem], NOW);
  assertEqual(due.length, 1, "RemindAt past + !sentAt → due");
  assertEqual(due[0].dueFollowup, 1, "  dueFollowup = 1");

  // NOT due: RemindAt future.
  const futureItem = {
    ...makeQueueItem("a2", "A2", ""),
    messageSentAt: NOW - DAY_MS,
    followup1RemindAt: NOW + DAY_MS, // jutro
    followup2RemindAt: NOW + 6 * DAY_MS,
  };
  due = bulkListDueFollowupsLogic([futureItem], NOW);
  assertEqual(due.length, 0, "RemindAt future → NOT due");

  // NOT due: RemindAt past ALE followup1SentAt set.
  const sentItem = {
    ...makeQueueItem("a3", "A3", ""),
    messageSentAt: NOW - 4 * DAY_MS,
    followup1RemindAt: NOW - 1000,
    followup1SentAt: NOW - 500, // już wysłany follow-up #1
    followup2RemindAt: NOW + 3 * DAY_MS,
  };
  due = bulkListDueFollowupsLogic([sentItem], NOW);
  assertEqual(due.length, 0, "RemindAt past + sentAt set → NOT due");

  // NOT due: followupStatus skipped (RemindAt past ignored).
  const skipItem = {
    ...makeQueueItem("a4", "A4", ""),
    messageSentAt: NOW - 4 * DAY_MS,
    followup1RemindAt: NOW - 1000,
    followupStatus: "skipped",
  };
  due = bulkListDueFollowupsLogic([skipItem], NOW);
  assertEqual(due.length, 0, "followupStatus 'skipped' → NOT due (mimo RemindAt past)");

  // NOT due: messageSentAt = null (pierwsza wiadomość nigdy nie wysłana).
  const noSendItem = {
    ...makeQueueItem("a5", "A5", ""),
    messageSentAt: null,
    followup1RemindAt: NOW - 1000, // (nielegal state, ale guard musi go odfiltrować)
  };
  due = bulkListDueFollowupsLogic([noSendItem], NOW);
  assertEqual(due.length, 0, "messageSentAt null → NOT due (guard pierwszej wiadomości)");
}

// D. Filter/list due — multi-item scenario ────────────────────────
console.log("\n▸ D. Filter/list due — A/B/C/D combined queue");
{
  const NOW = 1_700_000_000_000;

  // A: tylko FU#1 due
  const A = {
    ...makeQueueItem("alice", "Alice", "Eng"),
    messageSentAt: NOW - 4 * DAY_MS,
    followup1RemindAt: NOW - DAY_MS, // due
    followup2RemindAt: NOW + 3 * DAY_MS, // future
  };
  // B: FU#1 + FU#2 oba due (najstarszy sent → idzie pierwszy w sort'cie)
  const B = {
    ...makeQueueItem("bob", "Bob", "PM"),
    messageSentAt: NOW - 8 * DAY_MS, // older than A
    followup1RemindAt: NOW - 5 * DAY_MS,
    followup2RemindAt: NOW - DAY_MS,
  };
  // C: skipped — w ogóle nie pokazany
  const C = {
    ...makeQueueItem("carol", "Carol", "Designer"),
    messageSentAt: NOW - 5 * DAY_MS,
    followup1RemindAt: NOW - 2 * DAY_MS,
    followup2RemindAt: NOW + 2 * DAY_MS,
    followupStatus: "skipped",
  };
  // D: messageSentAt null — w ogóle nie pokazany
  const D = {
    ...makeQueueItem("dave", "Dave", "Sales"),
    messageSentAt: null,
  };

  const items = bulkListDueFollowupsLogic([A, B, C, D], NOW);
  // Expected: A jako FU#1, B jako FU#1, B jako FU#2 → 3 entries total.
  assertEqual(items.length, 3, "Queue [A,B,C,D] → 3 due entries (A#1, B#1, B#2)");

  // Sort: B (older sent) przed A. B daje dwa entries (oba dueFollowup'y).
  assertEqual(items[0].slug, "bob", "Sort by messageSentAt asc → bob first (8d ago)");
  assertEqual(items[1].slug, "bob", "B#2 — drugi entry tego samego profilu");
  assertEqual(items[2].slug, "alice", "alice last (4d ago)");

  // Oba dueFollowup'y B obecne.
  const bobEntries = items.filter((it) => it.slug === "bob");
  const bobNums = bobEntries.map((b) => b.dueFollowup).sort();
  assertEqual(bobNums.join(","), "1,2", "Bob ma DWA entries (FU#1 i FU#2)");
}

// E. State transitions ────────────────────────────────────────────
console.log("\n▸ E. State transitions — markSent #1 znika, skip permanent");
{
  const NOW = 1_700_000_000_000;
  let queue = [
    {
      ...makeQueueItem("alice", "Alice", "Eng"),
      messageSentAt: NOW - 4 * DAY_MS,
      followup1RemindAt: NOW - DAY_MS,
      followup2RemindAt: NOW + 3 * DAY_MS,
    },
  ];

  // Initial: alice is due as FU#1.
  let due = bulkListDueFollowupsLogic(queue, NOW);
  assertEqual(due.length, 1, "Initial: alice due as FU#1");

  // bulkMarkFollowupSent — followup1SentAt set.
  queue = bulkMarkFollowupSentLogic(queue, "alice", 1, NOW);
  const alice = queue.find((q) => q.slug === "alice");
  assertClose(alice.followup1SentAt, NOW, 100, "followup1SentAt ≈ now po markFollowupSent");
  assertEqual(alice.followup2SentAt, null, "followup2SentAt nadal null (NIE tknięte)");

  // Po markFollowupSent #1 → alice znika z due (FU#1 sent, FU#2 future).
  due = bulkListDueFollowupsLogic(queue, NOW);
  assertEqual(due.length, 0, "Po markSent #1 + FU#2 future → alice NIE due");

  // bulkSkipFollowup — followupStatus 'skipped' permanent (nie pokazuje się
  // też dla FU#2 nawet gdy RemindAt minie). Reset alice w queue.
  queue = [
    {
      ...makeQueueItem("alice", "Alice", "Eng"),
      messageSentAt: NOW - 8 * DAY_MS,
      followup1RemindAt: NOW - 5 * DAY_MS,
      followup2RemindAt: NOW - DAY_MS, // FU#2 też due
    },
  ];
  // Pre-skip: dwa entries due.
  due = bulkListDueFollowupsLogic(queue, NOW);
  assertEqual(due.length, 2, "Pre-skip: alice ma dwa due entries");

  queue = bulkSkipFollowupLogic(queue, "alice");
  due = bulkListDueFollowupsLogic(queue, NOW);
  assertEqual(due.length, 0, "Po skip: alice znika z due permanent (oba FU#1 i FU#2)");
  const aliceSkipped = queue.find((q) => q.slug === "alice");
  assertEqual(aliceSkipped.followupStatus, "skipped", "followupStatus = 'skipped'");
}

// F. Backward-compat — legacy item bez nowych pól ─────────────────
console.log("\n▸ F. Backward-compat — queue item bez followup pól");
{
  const NOW = 1_700_000_000_000;

  // Legacy item ze storage v1.6.0 (przed Sprint #4 #25). NIE ma followup* pól
  // w ogóle — wszystkie undefined.
  const legacy = {
    slug: "legacy", name: "Legacy User", headline: "Old",
    status: "sent", timestamp: NOW - 4 * DAY_MS, error: null,
    acceptedAt: null, lastAcceptCheckAt: null,
    scrapedProfile: null, messageDraft: "Stara wiadomość",
    messageStatus: "sent", messageApprovedAt: NOW - 4 * DAY_MS,
    messageSentAt: NOW - 4 * DAY_MS,
    pageNumber: 1,
    // CELOWO brak followup1RemindAt/.../followupStatus
  };
  const fresh = {
    ...makeQueueItem("fresh", "Fresh User", "New"),
    messageSentAt: NOW - 4 * DAY_MS,
    followup1RemindAt: NOW - DAY_MS, // due
    followup2RemindAt: NOW + 3 * DAY_MS,
  };

  // Filter NIE crashuje na undefined polach legacy, fresh wraca jako due.
  let due;
  let crashed = false;
  try {
    due = bulkListDueFollowupsLogic([legacy, fresh], NOW);
  } catch (err) {
    crashed = true;
    failures.push(`Backward-compat crashed: ${err.message}`);
  }
  assert(!crashed, "Filter NIE crashuje na legacy item bez followup pól");
  assertEqual(due ? due.length : -1, 1, "Tylko fresh due (legacy odfiltrowany przez followupStatus !== 'scheduled')");
  assertEqual(due && due[0] && due[0].slug, "fresh", "  due[0] to fresh");
}

// G. Badge counter formatting ──────────────────────────────────────
console.log("\n▸ G. Badge counter formatting — 0 / N / 99+");
{
  assertEqual(formatBadgeText(0), "", "count=0 → empty string (badge ukryty)");
  assertEqual(formatBadgeText(5), "5", "count=5 → '5'");
  assertEqual(formatBadgeText(100), "99+", "count=100 → '99+'");

  // Edge cases (bonus, nie obowiązkowe ale tanie).
  assertEqual(formatBadgeText(99), "99", "count=99 → '99' (boundary, not '99+')");
  assertEqual(formatBadgeText(1), "1", "count=1 → '1'");
}

// ── Summary ──────────────────────────────────────────────────────
console.log("\n=== test_followup.js ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}

process.exit(failed > 0 ? 1 : 0);
