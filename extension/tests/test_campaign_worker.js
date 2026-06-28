/**
 * test_campaign_worker.js — testy jednostkowe logiki kampanii sekwencyjnej (#74)
 *
 * Testuje: buildCampaignMessage, findNextCampaignStep, struktury danych kampanii.
 * Uruchomienie: node tests/test_campaign_worker.js
 */
"use strict";

let pass = 0, fail = 0;

function assert(cond, label) {
  if (cond) {
    console.log("  PASS:", label);
    pass++;
  } else {
    console.error("  FAIL:", label);
    fail++;
  }
}

function assertEqual(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (ok) {
    console.log("  PASS:", label);
    pass++;
  } else {
    console.error("  FAIL:", label, "— got:", JSON.stringify(a), "expected:", JSON.stringify(b));
    fail++;
  }
}

// ── Port funkcji z background.js (pure logic, no chrome.* deps) ────────

function buildCampaignMessage(template, firstName) {
  return (template || "").replace(/\[Imi[eę]\]/gi, firstName || "");
}

function findNextCampaignStep(campaign, nowMs) {
  if (!campaign || !Array.isArray(campaign.contacts) || !Array.isArray(campaign.steps)) return null;
  for (let ci = 0; ci < campaign.contacts.length; ci++) {
    const contact = campaign.contacts[ci];
    if (!contact || contact.status === "replied" || contact.status === "done") continue;
    for (let si = 0; si < campaign.steps.length; si++) {
      const step = campaign.steps[si];
      const stepKey = String(step.stepNum);
      const stepState = (contact.steps || {})[stepKey] || { status: "pending" };
      if (stepState.status === "sent") continue;
      if (stepState.status === "failed") continue;
      if (si > 0) {
        const prevStep = campaign.steps[si - 1];
        const prevKey = String(prevStep.stepNum);
        const prevState = (contact.steps || {})[prevKey] || {};
        if (prevState.status !== "sent") break;
        const delayMs = (step.delayDays || 0) * 24 * 60 * 60 * 1000;
        if ((prevState.sentAt || 0) + delayMs > nowMs) break;
      }
      if (stepState.status === "pending" || !stepState.status) {
        return { contactIdx: ci, stepNum: step.stepNum };
      }
    }
  }
  return null;
}

// ── Tests ──────────────────────────────────────────────────────────────

console.log("\n=== buildCampaignMessage ===");

assert(
  buildCampaignMessage("Czesc [Imie]!", "Jan") === "Czesc Jan!",
  "podstawia [Imie] poprawnie"
);

assert(
  buildCampaignMessage("Czesc [Imię]!", "Anna") === "Czesc Anna!",
  "podstawia [Imie] z ogonkiem (ę)"
);

assert(
  buildCampaignMessage("Brak podstawienia tutaj.", "Jan") === "Brak podstawienia tutaj.",
  "brak [Imie] — nie zmienia tekstu"
);

assert(
  buildCampaignMessage("Hej [Imię], [Imie] czy interesujesz sie?", "Marta") ===
    "Hej Marta, Marta czy interesujesz sie?",
  "podstawia wielokrotne wystapienie [Imie]"
);

assert(
  buildCampaignMessage("", "Jan") === "",
  "pusty szablon zwraca pusty string"
);

assert(
  buildCampaignMessage("Czesc [IMIE]!", "Piotr") === "Czesc Piotr!",
  "case-insensitive: [IMIE] zostaje podstawiony"
);

console.log("\n=== findNextCampaignStep ===");

const NOW = 1000000000000; // staly timestamp

const campSimple = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }],
  contacts: [
    { slug: "jan", firstName: "Jan", status: "pending", steps: {}, repliedAt: null },
  ],
};

assertEqual(
  findNextCampaignStep(campSimple, NOW),
  { contactIdx: 0, stepNum: 1 },
  "prosty przypadek: 1 kontakt, krok 1 do wyslania"
);

const campAllSent = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }],
  contacts: [
    { slug: "jan", firstName: "Jan", status: "active", steps: { "1": { status: "sent", sentAt: NOW - 1000 } }, repliedAt: null },
  ],
};

assertEqual(
  findNextCampaignStep(campAllSent, NOW),
  null,
  "wszystkie kroki wyslane — zwraca null"
);

const campReplied = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }],
  contacts: [
    { slug: "jan", firstName: "Jan", status: "replied", steps: {}, repliedAt: NOW - 1000 },
  ],
};

assertEqual(
  findNextCampaignStep(campReplied, NOW),
  null,
  "kontakt replied — pomijany"
);

const campFollowup = {
  steps: [
    { stepNum: 1, template: "Krok1", delayDays: 0 },
    { stepNum: 2, template: "Krok2", delayDays: 3 },
  ],
  contacts: [
    {
      slug: "jan", firstName: "Jan", status: "active",
      steps: { "1": { status: "sent", sentAt: NOW - 4 * 24 * 60 * 60 * 1000 } },
      repliedAt: null,
    },
  ],
};

assertEqual(
  findNextCampaignStep(campFollowup, NOW),
  { contactIdx: 0, stepNum: 2 },
  "follow-up: delay 3 dni minal — krok 2 gotowy"
);

const campFollowupTooEarly = {
  steps: [
    { stepNum: 1, template: "Krok1", delayDays: 0 },
    { stepNum: 2, template: "Krok2", delayDays: 3 },
  ],
  contacts: [
    {
      slug: "jan", firstName: "Jan", status: "active",
      steps: { "1": { status: "sent", sentAt: NOW - 1 * 24 * 60 * 60 * 1000 } },
      repliedAt: null,
    },
  ],
};

assertEqual(
  findNextCampaignStep(campFollowupTooEarly, NOW),
  null,
  "follow-up: delay 3 dni NIE minal — null (za wczesnie)"
);

const campMultiContact = {
  steps: [{ stepNum: 1, template: "Krok1", delayDays: 0 }],
  contacts: [
    { slug: "jan", firstName: "Jan", status: "active", steps: { "1": { status: "sent", sentAt: NOW - 1000 } }, repliedAt: null },
    { slug: "anna", firstName: "Anna", status: "pending", steps: {}, repliedAt: null },
  ],
};

assertEqual(
  findNextCampaignStep(campMultiContact, NOW),
  { contactIdx: 1, stepNum: 1 },
  "2 kontakty: pierwszy wyslany, drugi pending — zwraca drugiego"
);

// ── Podsumowanie ───────────────────────────────────────────────────────
console.log(`\n=== Wyniki: ${pass} PASS / ${fail} FAIL ===\n`);
if (fail > 0) process.exit(1);
