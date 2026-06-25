/**
 * #72 v2.1.0 — testy "Ponów błędy" + detekcji tygodniowego limitu LinkedIna.
 *
 * Run: node tests/test_bulk_retry.js
 *
 * UWAGA: re-implementacja czystych helperów z background.js (resetFailedToPending)
 * content.js (inviteLimitText) i popup.js (friendlyBulkError). Synchronizuj
 * ręcznie po zmianach. Debt: #10 BACKLOG (shared module).
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
  assert(actual === expected, testName, `got "${actual}", expected "${expected}"`);
}

// ── Port: resetFailedToPending (background.js) ────────────────────
function resetFailedToPending(queue) {
  let retried = 0;
  const next = (queue || []).map((q) => {
    if (q && q.status === "failed") {
      retried += 1;
      return { ...q, status: "pending", error: null, timestamp: null };
    }
    return q;
  });
  return { queue: next, retried };
}

// ── Port: friendlyBulkError (popup.js) ───────────────────────────
function friendlyBulkError(code) {
  if (!code) return "";
  const c = String(code);
  const is = (p) => c.indexOf(p) === 0;
  if (is("weekly_limit")) return "limit LinkedIna";
  if (is("redirected_off_profile") || is("wrong_profile_loaded")) return "przekierowanie (limit konta?)";
  if (is("tab_load_timeout")) return "karta nie załadowała się (przekierowanie/limit?)";
  if (is("modal_did_not_appear")) return "okno zaproszenia nie wykryte";
  if (is("send_button_missing")) return "brak przycisku „Wyślij” w oknie";
  if (is("pending_not_visible")) return "kliknięto, brak potwierdzenia";
  if (c === "bulk_tick_timeout" || c === "no_response") return "przekroczono czas";
  if (is("Could not establish")) return "karta nie odpowiedziała (przekierowanie?)";
  if (c === "already_pending") return "już zaproszony";
  if (c === "follow_only") return "tylko obserwowanie";
  if (c === "not_connectable") return "nie można zaprosić";
  if (c.indexOf("connect_click_failed") === 0 || c.indexOf("send_click_failed") === 0) return "nie udało się kliknąć";
  return c;
}

// ── Port: inviteLimitText (content.js) — wersja na string ─────────
function inviteLimitText(text) {
  const t = (text || "").toLowerCase();
  if (!t) return false;
  return /osi[aą]gni[eę]to.{0,30}limit|wykorzysta[łl]e[śs].{0,20}limit|tygodniowy limit zapros|limit zapros[zeń]*\b|nie mo[żz]esz (teraz )?wys[ył]a[ćc] (wi[eę]cej )?zapros|reached (the |your )?(weekly )?invitation limit|you['’`]?ve reached your (weekly )?(invitation )?limit|invitation limit (for|reached)|try again (later|next week)/.test(t);
}

// ── Port: selectEnqueueCandidates (background.js) — augmentacja z bazy ──
function selectEnqueueCandidates(profiles, slugs, queueSlugs) {
  const reasons = { not_found: 0, is_connection: 0, already_in_queue: 0 };
  const toAdd = [];
  const qs = queueSlugs instanceof Set ? queueSlugs : new Set(queueSlugs || []);
  const seen = new Set();
  for (const slug of (slugs || [])) {
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const r = profiles && profiles[slug];
    if (!r) { reasons.not_found += 1; continue; }
    if (r.isConnection) { reasons.is_connection += 1; continue; }
    if (qs.has(slug)) { reasons.already_in_queue += 1; continue; }
    toAdd.push({ slug: r.slug, name: r.name || "", headline: r.headline || "" });
  }
  return { toAdd, reasons };
}

console.log("\n=== test_bulk_retry (#72 v2.1.0) ===\n");

// ── resetFailedToPending ─────────────────────────────────────────
console.log("resetFailedToPending:");
{
  const q = [
    { slug: "a", status: "failed", error: "weekly_limit", timestamp: 111 },
    { slug: "b", status: "sent", error: null, timestamp: 222 },
    { slug: "c", status: "failed", error: "send_button_missing", timestamp: 333 },
    { slug: "d", status: "skipped", error: "already_pending" },
    { slug: "e", status: "pending", error: null },
    { slug: "f", status: "manual_sent", error: null },
  ];
  const { queue, retried } = resetFailedToPending(q);
  assertEqual(retried, 2, "liczy tylko failed");
  assertEqual(queue[0].status, "pending", "a: failed -> pending");
  assertEqual(queue[0].error, null, "a: error wyczyszczony");
  assertEqual(queue[0].timestamp, null, "a: timestamp wyczyszczony");
  assertEqual(queue[1].status, "sent", "b: sent nietkniety");
  assertEqual(queue[2].status, "pending", "c: failed -> pending");
  assertEqual(queue[3].status, "skipped", "d: skipped nietkniety");
  assertEqual(queue[4].status, "pending", "e: pending bez zmian");
  assertEqual(queue[5].status, "manual_sent", "f: manual_sent nietkniety");
  // nie mutuje oryginalu
  assertEqual(q[0].status, "failed", "oryginal niezmutowany");
}
{
  const { queue, retried } = resetFailedToPending([]);
  assertEqual(retried, 0, "pusta kolejka: 0 retried");
  assertEqual(queue.length, 0, "pusta kolejka: pusta");
  const r2 = resetFailedToPending(null);
  assertEqual(r2.retried, 0, "null kolejka: 0 retried");
}

// ── friendlyBulkError ────────────────────────────────────────────
console.log("\nfriendlyBulkError:");
assertEqual(friendlyBulkError("weekly_limit"), "limit LinkedIna", "weekly_limit");
assertEqual(friendlyBulkError("redirected_off_profile"), "przekierowanie (limit konta?)", "redirect");
assertEqual(friendlyBulkError("modal_did_not_appear"), "okno zaproszenia nie wykryte", "modal_did_not_appear");
assertEqual(friendlyBulkError('modal_did_not_appear [dlg=1 shadow=0 btns="Wyślij"]'), "okno zaproszenia nie wykryte", "modal_did_not_appear z sufiksem diag (prefix-match)");
assertEqual(friendlyBulkError("send_button_missing [dlg=2]"), "brak przycisku „Wyślij” w oknie", "send_button_missing prefix");
assertEqual(friendlyBulkError("pending_not_visible"), "kliknięto, brak potwierdzenia", "pending_not_visible");
assertEqual(friendlyBulkError("tab_load_timeout [path=/mynetwork/ status=complete inject=ok tries=8]"), "karta nie załadowała się (przekierowanie/limit?)", "tab_load_timeout prefix z diag");
assertEqual(friendlyBulkError("Could not establish connection."), "karta nie odpowiedziała (przekierowanie?)", "could not establish");
assertEqual(friendlyBulkError("already_pending"), "już zaproszony", "already_pending");
assertEqual(friendlyBulkError("not_connectable"), "nie można zaprosić", "not_connectable");
assertEqual(friendlyBulkError("connect_click_failed: x"), "nie udało się kliknąć", "connect_click_failed prefix");
assertEqual(friendlyBulkError(""), "", "pusty -> pusty");
assertEqual(friendlyBulkError("jakis_nowy_kod"), "jakis_nowy_kod", "nieznany -> passthrough");

// ── inviteLimitText ──────────────────────────────────────────────
console.log("\ninviteLimitText (detekcja limitu):");
assert(inviteLimitText("Osiągnięto tygodniowy limit zaproszeń"), "PL: osiagnieto ... limit");
assert(inviteLimitText("Tygodniowy limit zaproszeń został wyczerpany"), "PL: tygodniowy limit zaproszen");
assert(inviteLimitText("You've reached the weekly invitation limit"), "EN: weekly invitation limit");
assert(inviteLimitText("You’ve reached your weekly limit"), "EN: reached your weekly limit (curly apos)");
assert(inviteLimitText("Please try again next week"), "EN: try again next week");
assert(!inviteLimitText("Wyślij bez notatki"), "negatyw: zwykly modal zaproszenia");
assert(!inviteLimitText("Dołącz do sieci kontaktów"), "negatyw: zwykly tekst");
assert(!inviteLimitText(""), "negatyw: pusty string");

// ── augmentacja z bazy (re-add "tez z historii") ─────────────────
console.log("\nselectEnqueueCandidates (re-add z bazy):");
{
  const profiles = {
    "jan-kowalski": { slug: "jan-kowalski", name: "Jan", isConnection: false },
    "anna-nowak": { slug: "anna-nowak", name: "Anna", isConnection: true },   // 1st degree
    "piotr-zielinski": { slug: "piotr-zielinski", name: "Piotr", isConnection: false },
  };
  const queueSlugs = new Set(["piotr-zielinski"]); // juz w kolejce
  const { toAdd, reasons } = selectEnqueueCandidates(profiles, Object.keys(profiles), queueSlugs);
  assertEqual(toAdd.length, 1, "tylko nie-kontakt spoza kolejki");
  assertEqual(toAdd[0].slug, "jan-kowalski", "kandydat = jan-kowalski");
  assertEqual(reasons.is_connection, 1, "anna odrzucona (kontakt)");
  assertEqual(reasons.already_in_queue, 1, "piotr odrzucony (w kolejce)");
}

// ── Podsumowanie ─────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("\nFAILURES:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
