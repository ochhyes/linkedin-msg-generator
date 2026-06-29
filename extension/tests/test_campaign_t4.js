/**
 * test_campaign_t4.js — testy bezpiecznikow T4 (HITL, idempotencja, account-limit, log)
 *
 * Pokrywa pure functions portowane z background.js:
 *   isAccountLimitError, appendStepLogPure, isAlreadySent,
 *   shouldPauseForHITL, isCapReached
 *
 * Uruchomienie: node tests/test_campaign_t4.js
 */
"use strict";

let pass = 0, fail = 0;

function assert(cond, label) {
  if (cond) { console.log("  PASS:", label); pass++; }
  else { console.error("  FAIL:", label); fail++; }
}

// ── Port pure functions z background.js ────────────────────────────────

function isAccountLimitError(error) {
  return error === "redirected_off_profile" || error === "account_limit";
}

function appendStepLogPure(existing, entry, maxSize) {
  const log = Array.isArray(existing) ? existing.slice() : [];
  log.push(entry);
  if (log.length > maxSize) log.splice(0, log.length - maxSize);
  return log;
}

function isAlreadySent(freshContact, stepKey) {
  if (!freshContact) return false;
  const st = (freshContact.steps || {})[stepKey] || {};
  return st.status === "sent";
}

function shouldPauseForHITL(worker) {
  return !!(worker && worker.awaitingHITL);
}

function isCapReached(sentToday, dailyCap) {
  return sentToday >= dailyCap;
}

// ── findContactNextStep (port) ─────────────────────────────────────────

function findContactNextStep(campaign, contact, nowMs) {
  if (!campaign || !Array.isArray(campaign.steps)) return null;
  if (!contact || contact.status === "replied" || contact.status === "done") return null;
  for (let si = 0; si < campaign.steps.length; si++) {
    const step = campaign.steps[si];
    const stepState = (contact.steps || {})[String(step.stepNum)] || { status: "pending" };
    if (stepState.status === "sent") continue;
    if (stepState.status === "failed") continue;
    if (si > 0) {
      const prevStep = campaign.steps[si - 1];
      const prevState = (contact.steps || {})[String(prevStep.stepNum)] || {};
      if (prevState.status !== "sent") break;
      const delayMs = (step.delayDays || 0) * 24 * 60 * 60 * 1000;
      if ((prevState.sentAt || 0) + delayMs > nowMs) break;
    }
    if (stepState.status === "pending" || !stepState.status || stepState.status === "draft") {
      return step.stepNum;
    }
  }
  return null;
}

const NOW = 1000000000000;

// ── Tests: isAccountLimitError ─────────────────────────────────────────

console.log("\n=== isAccountLimitError ===");
assert(isAccountLimitError("redirected_off_profile") === true, "redirected_off_profile jest account-limit");
assert(isAccountLimitError("account_limit") === true, "account_limit jest account-limit");
assert(isAccountLimitError("compose_form_not_found") === false, "compose_form_not_found NIE jest account-limit — liczy do breaker'a");
assert(isAccountLimitError("tick_timeout") === false, "tick_timeout NIE jest account-limit");
assert(isAccountLimitError(null) === false, "null NIE jest account-limit");
assert(isAccountLimitError("not_1st_degree") === false, "not_1st_degree NIE jest account-limit — skip kontaktu, nie stop");
assert(isAccountLimitError("") === false, "pusty string NIE jest account-limit");

// ── Tests: shouldPauseForHITL ──────────────────────────────────────────

console.log("\n=== shouldPauseForHITL (HITL gate) ===");
assert(shouldPauseForHITL({ active: true, awaitingHITL: true }) === true, "awaitingHITL=true — tick powinien sie wstrzymac");
assert(shouldPauseForHITL({ active: true, awaitingHITL: false }) === false, "awaitingHITL=false — tick kontynuuje normalnie");
assert(shouldPauseForHITL({ active: true }) === false, "brak awaitingHITL — tick kontynuuje (domyslnie false)");
assert(shouldPauseForHITL(null) === false, "null worker — nie pausuje");
assert(shouldPauseForHITL({ active: false, awaitingHITL: true }) === true, "HITL wykrywany nawet jesli active=false (edge case)");

// ── Tests: isCapReached ────────────────────────────────────────────────

console.log("\n=== isCapReached (dzienny cap) ===");
assert(isCapReached(0, 25) === false, "0 wyslanych z 25 — cap nie osiagniety");
assert(isCapReached(24, 25) === false, "24/25 — cap nie osiagniety, jeszcze 1 do wyslania");
assert(isCapReached(25, 25) === true, "25/25 — cap osiagniety, stop");
assert(isCapReached(26, 25) === true, "26/25 — ponad cap, stop");
assert(isCapReached(0, 0) === true, "cap=0 — zawsze zatrzymany");

// ── Tests: isAlreadySent (idempotencja pre-send) ───────────────────────

console.log("\n=== isAlreadySent (pre-send idempotency) ===");
const contactSent = { slug: "jan", steps: { "1": { status: "sent", sentAt: NOW - 1000 } } };
const contactPending = { slug: "jan", steps: { "1": { status: "pending" } } };
const contactNoSteps = { slug: "jan", steps: {} };
const contactFailed = { slug: "jan", steps: { "1": { status: "failed" } } };

assert(isAlreadySent(contactSent, "1") === true, "status=sent — juz wyslane, skip przed wysylka");
assert(isAlreadySent(contactPending, "1") === false, "status=pending — nie wyslane, kontynuuj");
assert(isAlreadySent(contactNoSteps, "1") === false, "brak kroku — nie wyslane");
assert(isAlreadySent(contactFailed, "1") === false, "status=failed — nie wyslane, moze byc retry");
assert(isAlreadySent(null, "1") === false, "null contact — bezpieczny fallback");
assert(isAlreadySent(contactSent, "2") === false, "inny krok nie jest sent — OK do wyslania");

// ── Tests: appendStepLogPure (log krokow) ─────────────────────────────

console.log("\n=== appendStepLogPure (log krokow T4) ===");
const entry1 = { ts: 1000, slug: "jan", stepNum: 1, result: "sent" };
const entry2 = { ts: 2000, slug: "anna", stepNum: 1, result: "failed" };

const log0 = appendStepLogPure([], entry1, 500);
assert(log0.length === 1 && log0[0] === entry1, "append do pustego logu — 1 wpis");

const log1 = appendStepLogPure([entry1], entry2, 500);
assert(log1.length === 2 && log1[1] === entry2, "append drugiego wpisu — 2 wpisow");

const bigLog = Array.from({ length: 500 }, (_, i) => ({ ts: i, slug: "x" + i, result: "sent" }));
const logTrimmed = appendStepLogPure(bigLog, { ts: 999, slug: "new" }, 500);
assert(logTrimmed.length === 500, "po przycieci do maxSize=500 — dokladnie 500 wpisow");
assert(logTrimmed[0].slug === "x1", "najstarszy (x0) usuniety po przekroczeniu limitu");
assert(logTrimmed[499].slug === "new", "najnowszy (new) na koncu");

const logNull = appendStepLogPure(null, entry1, 500);
assert(logNull.length === 1, "null existing — inicjalizuje jako pusty array");

// ── Tests: runaway safety — cap enforced ──────────────────────────────

console.log("\n=== Runaway safety: cap egzekwowany ===");
// Udowodnienie ze wiescej niz dailyCap wysylek jest niemozliwe:
// przy sentToday >= dailyCap isCapReached zwraca true -> worker.stop w tick
let sentToday = 0;
const CAP = 25;
let ticks = 0;
while (!isCapReached(sentToday, CAP) && ticks < 1000) {
  sentToday++;
  ticks++;
}
assert(ticks === CAP, "worker zatrzymuje sie dokladnie po osiagnieciu cap (" + CAP + " tickow)");
assert(isCapReached(sentToday, CAP) === true, "po " + CAP + " wysylkach cap jest osiagniety");

// Udowodnienie ze HITL blokuje wysylke od razu:
const workerWithHITL = { active: true, awaitingHITL: true, sentToday: 0 };
let sentWithHITL = 0;
// Symulacja tick — gdyby HITL nie blokował, sentWithHITL wzrosłby:
if (!shouldPauseForHITL(workerWithHITL)) sentWithHITL++;
assert(sentWithHITL === 0, "HITL gate blokuje wysylke — 0 wyslano bez zatwierdzenia");

// ── Tests: findContactNextStep — idempotencja sent nigdy nie wraca ─────

console.log("\n=== findContactNextStep — sent step nigdy nie wraca ===");
const campSentFinal = {
  steps: [{ stepNum: 1, template: "X", delayDays: 0 }],
  contacts: [{ slug: "jan", status: "active", steps: { "1": { status: "sent", sentAt: NOW - 1000 } } }],
};
assert(findContactNextStep(campSentFinal, campSentFinal.contacts[0], NOW) === null, "wyslany krok 1 — findContactNextStep zwraca null (nie wysle ponownie)");

const campMultiSent = {
  steps: [
    { stepNum: 1, template: "X", delayDays: 0 },
    { stepNum: 2, template: "Y", delayDays: 1 },
  ],
  contacts: [{
    slug: "jan",
    status: "active",
    steps: {
      "1": { status: "sent", sentAt: NOW - 2 * 24 * 60 * 60 * 1000 },
      "2": { status: "sent", sentAt: NOW - 1000 },
    },
  }],
};
assert(findContactNextStep(campMultiSent, campMultiSent.contacts[0], NOW) === null, "oba kroki wyslane — null (kompletna sekwencja)");

// ── Podsumowanie ───────────────────────────────────────────────────────
console.log(`\n=== Wyniki: ${pass} PASS / ${fail} FAIL ===\n`);
if (fail > 0) process.exit(1);
