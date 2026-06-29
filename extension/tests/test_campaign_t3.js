/**
 * test_campaign_t3.js — testy bramki anty-halucynacja (T3)
 *
 * Pokrywa checkHallucinations (port z background.js) + logike regenerate/fallback.
 * Uruchomienie: node tests/test_campaign_t3.js
 */
"use strict";

let pass = 0, fail = 0;

function assert(cond, label) {
  if (cond) { console.log("  PASS:", label); pass++; }
  else { console.error("  FAIL:", label); fail++; }
}

// ── Port checkHallucinations z background.js ──────────────────────────

function checkHallucinations(message, facts) {
  const violations = [];
  const msg = (message || "");

  if (/\bTw[oó]j\b|\bTw[oó]je\b|\bTw[oó]ja\b|\bTwoi[ck]h\b|\bTwoim\b|\bMasz\b|\bjest[eę][sś]\s+otwarty\b/i.test(msg)) {
    violations.push("ty_form");
  }

  if (/^(Cze[sś][cć]|Hej|Hey|Witam|Szanown[ay]|Dzie[nń] dobry)/im.test(msg)) {
    violations.push("forbidden_greeting");
  }

  const firstName = facts && (facts.firstName || facts.first_name);
  if (firstName && firstName.length > 1) {
    const vocRe = new RegExp("(Panie|Pani)\\s+" + firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[,!]", "i");
    if (vocRe.test(msg)) violations.push("vocative");
  }

  const falseRelPats = [
    /wsp[oó]ln[ay]ch\s+kontakt[oó]w/i,
    /wsp[oó]lny\s+kontakt/i,
    /rozmawiali[sś]my/i,
    /mi[lł]o\s+by[lł]o.{0,20}pozna[cć]/i,
    /dzi[eę]ki\s+za\s+(po[lł][aą]czenie|nawi[aą]zanie)/i,
    /przy\s+okazji\s+naszej\s+rozmow/i,
    /jak\s+(wspomnia[lł]em|mówi[lł]em|pisa[lł]em)/i,
  ];
  for (const re of falseRelPats) {
    if (re.test(msg)) { violations.push("false_relation"); break; }
  }

  return { passed: violations.length === 0, violations };
}

// ── Port buildCampaignMessage (do testu fallback) ─────────────────────

function buildCampaignMessage(template, contact) {
  const c = (contact && typeof contact === "object") ? contact : { firstName: contact };
  return (template || "")
    .replace(/\[Imi[eę]\]/gi, c.firstName || "")
    .replace(/\[Nazwisko\]/gi, c.lastName || "")
    .replace(/\[Firma\]/gi, c.company || "")
    .replace(/\[Stanowisko\]/gi, c.position || "");
}

// ── Wiadomosci poprawne (powinny przejsc) ─────────────────────────────

console.log("\n=== Wiadomosci poprawne ===");

const cleanMsg = "Widze, ze od pieciu lat prowadzi Pan wlasny biznes treningowy. Rekrytuje do OVB. Czy mialby Pan 30 minut w srode?";
const facts = { firstName: "Jan", company: "TechCorp" };
assert(checkHallucinations(cleanMsg, facts).passed, "czysta wiadomosc przechodzi");

const cleanFormal = "Pana doswiadczenie w zarzadzaniu projektami jest dokladnie tym, czego szukam. Czy mialaby Pani 30 minut?";
assert(checkHallucinations(cleanFormal, facts).passed, "formalna z Pan/Pani przechodzi");

const cleanNoName = "Widze w profilu 10 lat w branzy finansowej. Buduję zespol OVB. Proponuje 30 minut w piatek.";
assert(checkHallucinations(cleanNoName, null).passed, "bez facts (null) — bezpieczny fallback");

const cleanEnglish = "I see you have 5 years in finance. Would you have 30 minutes this week?";
assert(checkHallucinations(cleanEnglish, facts).passed, "angielski bez zakazanych wzorcow — przechodzi");

// ── Ty-formy (zakaz) ──────────────────────────────────────────────────

console.log("\n=== Ty-formy (forbidden) ===");

const tyTwoj = "Twoj profil wyglada imponujaco i chcialem sie z Toba podzielic.";
const r1 = checkHallucinations(tyTwoj, facts);
assert(!r1.passed, "Twoj — wykryty");
assert(r1.violations.includes("ty_form"), "Twoj — violation=ty_form");

const tyMasz = "Masz doswiadczenie, ktore idealnie pasuje do naszego zespolu.";
assert(!checkHallucinations(tyMasz, facts).passed, "Masz — wykryty");

const tyOtwarty = "Czy jestes otwarty na nowe mozliwosci?";
assert(!checkHallucinations(tyOtwarty, facts).passed, "jestes otwarty — wykryty");

const tyTwoje = "Twoje osiagniecia sa imponujace.";
assert(!checkHallucinations(tyTwoje, facts).passed, "Twoje — wykryty");

// ── Zakazane powitania ────────────────────────────────────────────────

console.log("\n=== Zakazane powitania (forbidden) ===");

assert(!checkHallucinations("Czesc, pisalam w sprawie wspolpracy.", facts).passed, "Czesc — wykryta");
assert(!checkHallucinations("Hej, widze ze pracujesz w finansach.", facts).passed, "Hej — wykryty");
assert(!checkHallucinations("Hey Jan, chcialem napisac.", facts).passed, "Hey — wykryty");
assert(!checkHallucinations("Witam serdecznie i proponuje wspolprace.", facts).passed, "Witam — wykryte");
assert(!checkHallucinations("Dzien dobry, pisze w sprawie rekrutacji.", facts).passed, "Dzien dobry — wykryte");
assert(!checkHallucinations("Szanowna Pani, mam propozycje.", facts).passed, "Szanowna Pani — wykryte");

// ── Wolacz (zakaz) ────────────────────────────────────────────────────

console.log("\n=== Wolacz imienia (forbidden) ===");

const vocFacts = { firstName: "Rafal" };
assert(!checkHallucinations("Panie Rafal, pisalam w sprawie rekrutacji.", vocFacts).passed, "Panie Rafal, — wykryty");
assert(!checkHallucinations("Pani Anna, zapraszam do wspolpracy.", { firstName: "Anna" }).passed, "Pani Anna, — wykryta");
// Imie w srodku zdania (nie wolacz na poczatku) — NIE powinno wykrywac
assert(checkHallucinations("Milo mi bylo poznac pana Rafala na konferencji.", vocFacts).passed, "imie w srodku — nie wolacz, przechodzi");

// ── Halucynacja relacji ───────────────────────────────────────────────

console.log("\n=== Halucynacja relacji (forbidden) ===");

assert(!checkHallucinations("Mamy wspolnych kontaktow w branzy finansowej.", facts).passed, "wspolnych kontaktow — wykryte");
assert(!checkHallucinations("Jak rozmawialismy na ostatnim eventcie — chcialem kontynuowac.", facts).passed, "rozmawialismy — wykryte");
assert(!checkHallucinations("Dzieki za polaczenie — widze ze zajmujesz sie finansami.", facts).passed, "dzieki za polaczenie — wykryte");
assert(!checkHallucinations("Dzieki za nawiazanie kontaktu na LinkedIn.", facts).passed, "dzieki za nawiazanie — wykryte");
assert(!checkHallucinations("Przy okazji naszej rozmowy wspomniales o projektach.", facts).passed, "przy okazji naszej rozmowy — wykryte");
assert(!checkHallucinations("Jak wspomnialem w poprzedniej wiadomosci...", facts).passed, "jak wspomnialem — wykryte");
assert(!checkHallucinations("Mamy wspolny kontakt — Marek Kowalski.", facts).passed, "wspolny kontakt — wykryty");

// ── Wielokrotne naruszenia ─────────────────────────────────────────────

console.log("\n=== Wielokrotne naruszenia ===");

const multiViolation = "Czesc Rafal, Twoj profil jest swietny i milo bylo Cie poznac. Dzieki za polaczenie!";
const rMulti = checkHallucinations(multiViolation, { firstName: "Rafal" });
assert(!rMulti.passed, "wielokrotne naruszenia — nie przechodzi");
assert(rMulti.violations.length >= 2, "wielokrotne naruszenia — conajmniej 2 violations");

// ── Logika regenerate/fallback (pure simulation) ──────────────────────

console.log("\n=== Logika regenerate/fallback (symulacja) ===");

function simulateT3Gate(aiMsg1, aiMsg2, templateMsg, contact) {
  let msgText = aiMsg1;
  const hcheck1 = checkHallucinations(msgText, contact);
  if (!hcheck1.passed) {
    const msg2 = aiMsg2;
    if (msg2 && checkHallucinations(msg2, contact).passed) {
      msgText = msg2;
    } else {
      const fallback = buildCampaignMessage(templateMsg || "", contact);
      if (fallback && fallback.trim()) {
        msgText = fallback;
      } else {
        return { msgText: null, error: "hallucination_check_fail" };
      }
    }
  }
  return { msgText, error: null };
}

const contactA = { firstName: "Anna", lastName: "Kowalska" };

// Scenariusz 1: ai1 fail -> ai2 OK -> wysyla ai2
const s1 = simulateT3Gate("Czesc Anna, Twoj profil wygladna super.", "Widze Pani doswiadczenie w zarzadzaniu. Czy mialaby Pani 30 minut?", "[Imie] — zapraszam do rozmowy.", contactA);
assert(s1.error === null, "ai1 fail, ai2 OK — brak bledu");
assert(s1.msgText && s1.msgText.includes("doswiadczenie"), "ai1 fail, ai2 OK — wysyla ai2");

// Scenariusz 2: ai1 fail -> ai2 fail -> template OK
const s2 = simulateT3Gate("Hej Anna, Twoje CV jest swietne.", "Masz super doswiadczenie.", "Hej [Imie] — zapraszam na 30 min.", contactA);
assert(s2.error === null, "ai1+ai2 fail, template OK — brak bledu");
assert(s2.msgText && s2.msgText.includes("Anna"), "ai1+ai2 fail, template OK — wysyla template z [Imie]");

// Scenariusz 3: ai1 fail -> ai2 fail -> pusty template -> skip
const s3 = simulateT3Gate("Hej, Twoje doswiadczenie.", "Masz skille.", "", contactA);
assert(s3.error === "hallucination_check_fail", "ai1+ai2 fail, brak szablonu — hallucination_check_fail");
assert(s3.msgText === null, "ai1+ai2 fail, brak szablonu — msgText null");

// Scenariusz 4: ai1 OK -> nie wymaga sprawdzania dalej
const s4 = simulateT3Gate("Widze w profilu Pani 10 lat w finansach. Czy mialaby Pani 30 minut?", "NEVER_USED", "[Imie]", contactA);
assert(s4.error === null && s4.msgText && s4.msgText.includes("finansach"), "ai1 OK — brak sprawdzania ai2");

// ── Podsumowanie ───────────────────────────────────────────────────────
console.log(`\n=== Wyniki: ${pass} PASS / ${fail} FAIL ===\n`);
if (fail > 0) process.exit(1);
