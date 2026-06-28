/**
 * test_campaign_worker.js — testy logiki scalonego systemu kampanii (#74 + #75)
 *
 * Testuje: buildCampaignMessage, resolveCampaignMessage, campaignStepNeedsAi,
 * findContactNextStep, findNextCampaignStep, struktury danych kampanii.
 * Uruchomienie: node tests/test_campaign_worker.js
 *
 * UWAGA: pure logic portowana z background.js (bez chrome API i fetch).
 * Synchronizuj recznie po zmianach w background.js (dlug techniczny #10).
 */
"use strict";

let pass = 0, fail = 0;

function assert(cond, label) {
  if (cond) { console.log("  PASS:", label); pass++; }
  else { console.error("  FAIL:", label); fail++; }
}

function assertEqual(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) { console.log("  PASS:", label); pass++; }
  else { console.error("  FAIL:", label, "— got:", JSON.stringify(a), "expected:", JSON.stringify(b)); fail++; }
}

// ── Port funkcji z background.js (pure logic, no chrome.* deps) ────────

function buildCampaignMessage(template, contact) {
  const c = (contact && typeof contact === "object") ? contact : { firstName: contact };
  return (template || "")
    .replace(/\[Imi[eę]\]/gi, c.firstName || "")
    .replace(/\[Nazwisko\]/gi, c.lastName || "")
    .replace(/\[Firma\]/gi, c.company || "")
    .replace(/\[Stanowisko\]/gi, c.position || "");
}

function resolveCampaignMessage(contact, step) {
  const stored = ((contact && contact.steps) || {})[String(step && step.stepNum)] || {};
  if (stored.message && String(stored.message).trim()) return String(stored.message);
  return buildCampaignMessage((step && step.template) || "", contact);
}

function campaignStepNeedsAi(contact, step) {
  if (!step || step.mode !== "ai") return false;
  const stored = ((contact && contact.steps) || {})[String(step.stepNum)] || {};
  return !(stored.message && String(stored.message).trim());
}

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

function findNextCampaignStep(campaign, nowMs) {
  if (!campaign || !Array.isArray(campaign.contacts) || !Array.isArray(campaign.steps)) return null;
  for (let ci = 0; ci < campaign.contacts.length; ci++) {
    const stepNum = findContactNextStep(campaign, campaign.contacts[ci], nowMs);
    if (stepNum != null) return { contactIdx: ci, stepNum: stepNum };
  }
  return null;
}

// ── Tests: buildCampaignMessage ────────────────────────────────────────

console.log("\n=== buildCampaignMessage ===");
assert(buildCampaignMessage("Czesc [Imie]!", "Jan") === "Czesc Jan!", "podstawia [Imie] poprawnie");
assert(buildCampaignMessage("Czesc [Imię]!", "Anna") === "Czesc Anna!", "podstawia [Imie] z ogonkiem (ę)");
assert(buildCampaignMessage("Brak podstawienia tutaj.", "Jan") === "Brak podstawienia tutaj.", "brak [Imie] — nie zmienia tekstu");
assert(buildCampaignMessage("Hej [Imię], [Imie] czy interesujesz sie?", "Marta") === "Hej Marta, Marta czy interesujesz sie?", "podstawia wielokrotne wystapienie [Imie]");
assert(buildCampaignMessage("", "Jan") === "", "pusty szablon zwraca pusty string");
assert(buildCampaignMessage("Czesc [IMIE]!", "Piotr") === "Czesc Piotr!", "case-insensitive: [IMIE] zostaje podstawiony");

// tokeny z Connections.csv (firstName/lastName/company/position)
const kontaktCsv = { firstName: "Jan", lastName: "Kowalski", company: "OVB", position: "Doradca" };
assert(buildCampaignMessage("Czesc [Imie] [Nazwisko]", kontaktCsv) === "Czesc Jan Kowalski", "[Imie] + [Nazwisko] podstawione");
assert(buildCampaignMessage("Pracujesz w [Firma] jako [Stanowisko]?", kontaktCsv) === "Pracujesz w OVB jako Doradca?", "[Firma] + [Stanowisko] podstawione");
assert(buildCampaignMessage("[Firma]", { firstName: "X" }) === "", "brak danych dla tokenu -> pusty string");
assert(buildCampaignMessage("Czesc [Imie]", "Anna") === "Czesc Anna", "wsteczna kompatybilnosc: string jako 2. arg dziala jak firstName");

// ── Tests: findNextCampaignStep ────────────────────────────────────────

console.log("\n=== findNextCampaignStep ===");
const NOW = 1000000000000;

const campSimple = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }],
  contacts: [{ slug: "jan", firstName: "Jan", status: "pending", steps: {}, repliedAt: null }],
};
assertEqual(findNextCampaignStep(campSimple, NOW), { contactIdx: 0, stepNum: 1 }, "prosty przypadek: 1 kontakt, krok 1 do wyslania");

const campAllSent = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }],
  contacts: [{ slug: "jan", firstName: "Jan", status: "active", steps: { "1": { status: "sent", sentAt: NOW - 1000 } }, repliedAt: null }],
};
assertEqual(findNextCampaignStep(campAllSent, NOW), null, "wszystkie kroki wyslane — zwraca null");

const campReplied = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }],
  contacts: [{ slug: "jan", firstName: "Jan", status: "replied", steps: {}, repliedAt: NOW - 1000 }],
};
assertEqual(findNextCampaignStep(campReplied, NOW), null, "kontakt replied — pomijany");

const campFollowup = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }, { stepNum: 2, template: "Krok2", delayDays: 3 }],
  contacts: [{ slug: "jan", firstName: "Jan", status: "active", steps: { "1": { status: "sent", sentAt: NOW - 4 * 24 * 60 * 60 * 1000 } }, repliedAt: null }],
};
assertEqual(findNextCampaignStep(campFollowup, NOW), { contactIdx: 0, stepNum: 2 }, "follow-up: delay 3 dni minal — krok 2 gotowy");

const campFollowupTooEarly = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }, { stepNum: 2, template: "Krok2", delayDays: 3 }],
  contacts: [{ slug: "jan", firstName: "Jan", status: "active", steps: { "1": { status: "sent", sentAt: NOW - 1 * 24 * 60 * 60 * 1000 } }, repliedAt: null }],
};
assertEqual(findNextCampaignStep(campFollowupTooEarly, NOW), null, "follow-up: delay 3 dni NIE minal — null (za wczesnie)");

const campMultiContact = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }],
  contacts: [
    { slug: "jan", firstName: "Jan", status: "active", steps: { "1": { status: "sent", sentAt: NOW - 1000 } }, repliedAt: null },
    { slug: "anna", firstName: "Anna", status: "pending", steps: {}, repliedAt: null },
  ],
};
assertEqual(findNextCampaignStep(campMultiContact, NOW), { contactIdx: 1, stepNum: 1 }, "2 kontakty: pierwszy wyslany, drugi pending — zwraca drugiego");

// ── Tests: resolveCampaignMessage (priorytet zapisana > szablon) ───────

console.log("\n=== resolveCampaignMessage ===");
const stepTpl = { stepNum: 1, template: "Czesc [Imie]!", mode: "template" };
const stepAi = { stepNum: 1, template: "", mode: "ai" };

assert(
  resolveCampaignMessage({ firstName: "Jan", steps: {} }, stepTpl) === "Czesc Jan!",
  "szablon bez zapisanej wiadomosci — podstawia [Imie]"
);
assert(
  resolveCampaignMessage({ firstName: "Jan", steps: { "1": { status: "sent", message: "Gotowy tekst AI" } } }, stepTpl) === "Gotowy tekst AI",
  "zapisana wiadomosc ma priorytet nad szablonem"
);
assert(
  resolveCampaignMessage({ firstName: "Ola", steps: { "1": { message: "   " } } }, stepTpl) === "Czesc Ola!",
  "pusta/bialymi-znakami zapisana wiadomosc — fallback do szablonu"
);
assert(
  resolveCampaignMessage({ firstName: "Ewa", steps: { "1": { message: "Wygenerowane AI dla Ewy" } } }, stepAi) === "Wygenerowane AI dla Ewy",
  "krok AI z zapisana wiadomoscia — zwraca ja"
);

// ── Tests: campaignStepNeedsAi ─────────────────────────────────────────

console.log("\n=== campaignStepNeedsAi ===");
assert(campaignStepNeedsAi({ steps: {} }, stepAi) === true, "krok AI bez wiadomosci — wymaga generacji");
assert(campaignStepNeedsAi({ steps: { "1": { message: "juz jest" } } }, stepAi) === false, "krok AI z wiadomoscia — nie wymaga");
assert(campaignStepNeedsAi({ steps: {} }, stepTpl) === false, "krok szablonowy — nigdy nie wymaga AI");
assert(campaignStepNeedsAi({ steps: { "1": { message: "" } } }, stepAi) === true, "krok AI z pusta wiadomoscia — wymaga generacji");

// ── Tests: draft (tryb reczny — wygenerowane, jeszcze nie wyslane) ─────

console.log("\n=== status draft (tryb reczny) ===");
const campDraft = {
  steps: [{ stepNum: 1, template: "X", delayDays: 0, mode: "ai" }],
  contacts: [{ slug: "jan", firstName: "Jan", status: "pending", steps: { "1": { status: "draft", message: "szkic" } }, repliedAt: null }],
};
assertEqual(findNextCampaignStep(campDraft, NOW), { contactIdx: 0, stepNum: 1 }, "draft (nie wyslany) — nadal due (mozna regenerowac/wyslac)");
assert(campaignStepNeedsAi(campDraft.contacts[0], campDraft.steps[0]) === false, "draft ma message — AI nie regeneruje przy wysylce");

const campDraftThenSent = {
  steps: [{ stepNum: 1, template: "X", delayDays: 0 }, { stepNum: 2, template: "Y", delayDays: 2 }],
  contacts: [{ slug: "jan", firstName: "Jan", status: "active", steps: { "1": { status: "sent", sentAt: NOW - 3 * 24 * 60 * 60 * 1000 } }, repliedAt: null }],
};
assertEqual(findContactNextStep(campDraftThenSent, campDraftThenSent.contacts[0], NOW), 2, "po wyslaniu kroku 1 + delay — krok 2 due (per-contact)");

// ── Podsumowanie ───────────────────────────────────────────────────────
console.log(`\n=== Wyniki: ${pass} PASS / ${fail} FAIL ===\n`);
if (fail > 0) process.exit(1);
