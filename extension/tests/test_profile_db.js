/**
 * test_profile_db.js (#45 v1.14.0)
 *
 * Testuje logikę trwałej bazy profili z extension/background.js:
 *  - profileRecordFromInput / mergeProfileRecord (merge: truthy nie nadpisywane
 *    falsy, lastSeenAt update, source rośnie tylko "w górę", isConnection sticky)
 *  - upsertProfilesToDb (dedup po slug, added/updated counts)
 *  - csvEscape + buildProfileDbCsv (escaping przecinków/cudzysłowów/newline)
 *  - parseCsv round-trip
 *  - buildFullBackupJson / restoreBackup-podobny merge round-trip
 *
 * Run: node tests/test_profile_db.js
 *
 * UWAGA: re-implementacja czystych funkcji z background.js (bez chrome.*),
 * tak jak inne testy w tym repo (vanilla JS, brak modułów). Synchronizuj
 * ręcznie po zmianach. Debt: #10 BACKLOG.
 */

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function assertEqual(actual, expected, name) { assert(actual === expected, name, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }

// ── Port z background.js ──────────────────────────────────────────
const SOURCE_RANK = { search: 1, bulk: 2, manual: 3, connections_import: 4, linkedin_export: 4, profile_scrape: 5 };

function extractSlugFromUrl(url) {
  if (!url || typeof url !== "string") return "";
  const m = url.match(/\/in\/([^/?#]+)/);
  if (!m) return "";
  try { return decodeURIComponent(m[1]).toLowerCase(); } catch (_) { return m[1].toLowerCase(); }
}

function profileRecordFromInput(p, source, nowMs) {
  if (!p) return null;
  let slug = p.slug || null;
  if (!slug && p.profile_url) slug = extractSlugFromUrl(p.profile_url);
  if (!slug && p.profileUrl) slug = extractSlugFromUrl(p.profileUrl);
  if (slug) { try { slug = decodeURIComponent(slug).toLowerCase(); } catch (_) { slug = String(slug).toLowerCase(); } }
  if (!slug) return null;
  const isScrape = source === "profile_scrape";
  const degreeRaw = p.degree || (p.buttonState === "Message" ? "1st" : null);
  return {
    slug,
    name: p.name || "",
    headline: p.headline || "",
    location: p.location || null,
    degree: degreeRaw || null,
    profileUrl: `https://www.linkedin.com/in/${slug}/`,
    mutualConnections: p.mutualConnections || p.mutual_connections || null,
    source,
    pageNumber: typeof p.pageNumber === "number" ? p.pageNumber : null,
    firstSeenAt: nowMs,
    lastSeenAt: nowMs,
    scrapedProfile: isScrape ? (p.scrapedProfile || (p.profile_url ? p : null)) : (p.scrapedProfile || null),
    isConnection: source === "connections_import" ? true : (degreeRaw === "1st" || !!p.isConnection || p.buttonState === "Message"),
    inQueue: false,
    notes: typeof p.notes === "string" ? p.notes : "",
    tags: Array.isArray(p.tags) ? p.tags : [],
  };
}

function mergeProfileRecord(prev, next) {
  if (!prev) return next;
  const out = { ...prev };
  out.lastSeenAt = next.lastSeenAt || prev.lastSeenAt;
  out.firstSeenAt = Math.min(prev.firstSeenAt || next.firstSeenAt, next.firstSeenAt || prev.firstSeenAt);
  for (const k of ["name", "headline", "location", "degree", "mutualConnections", "profileUrl"]) {
    if (next[k]) out[k] = next[k];
  }
  if (typeof next.pageNumber === "number") out.pageNumber = next.pageNumber;
  if (next.scrapedProfile) out.scrapedProfile = next.scrapedProfile;
  out.isConnection = prev.isConnection || next.isConnection;
  if ((SOURCE_RANK[next.source] || 0) >= (SOURCE_RANK[prev.source] || 0)) out.source = next.source;
  if (next.notes && !prev.notes) out.notes = next.notes;
  if (Array.isArray(next.tags) && next.tags.length && (!prev.tags || !prev.tags.length)) out.tags = next.tags;
  return out;
}

function upsertProfilesToDb(db, profiles, source, nowMs) {
  let added = 0, updated = 0;
  for (const p of profiles) {
    const rec = profileRecordFromInput(p, source, nowMs);
    if (!rec) continue;
    if (db.profiles[rec.slug]) { db.profiles[rec.slug] = mergeProfileRecord(db.profiles[rec.slug], rec); updated += 1; }
    else { db.profiles[rec.slug] = rec; added += 1; }
  }
  return { added, updated, total: Object.keys(db.profiles).length };
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch === "\r") { /* skip */ }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((r) => r.some((c) => c && c.trim())).map((r) => {
    const o = {}; header.forEach((h, idx) => { o[h] = r[idx] != null ? r[idx] : ""; }); return o;
  });
}

// ── Tests ─────────────────────────────────────────────────────────
console.log("=== test_profile_db.js ===");

const T0 = 1_700_000_000_000;

// A) Upsert + dedup
{
  const db = { version: 1, profiles: {}, lastBackupAt: null };
  let r = upsertProfilesToDb(db, [
    { slug: "alice-1", name: "Alice", headline: "Eng", buttonState: "Connect" },
    { slug: "bob-2", name: "Bob", headline: "PM", buttonState: "Connect" },
    { slug: "alice-1", name: "Alice", headline: "Eng" }, // dup w tej samej partii
  ], "search", T0);
  assertEqual(r.added, 2, "A: 2 nowe rekordy");
  assertEqual(r.updated, 1, "A: 1 update (dup alice w partii)");
  assertEqual(r.total, 2, "A: total 2");
  assertEqual(db.profiles["alice-1"].source, "search", "A: source = search");
}

// B) Merge — truthy nie nadpisywane falsy + source rośnie + scrapedProfile sticky
{
  const db = { version: 1, profiles: {}, lastBackupAt: null };
  upsertProfilesToDb(db, [{ slug: "carl-3", name: "Carl", headline: "Sales Director", location: "Kraków" }], "search", T0);
  // scrape: dorzuca scrapedProfile, ale headline w scrape jest pusty → nie kasuje
  upsertProfilesToDb(db, [{ slug: "carl-3", name: "Carl", headline: "", profile_url: "https://www.linkedin.com/in/carl-3/", about: "Bio" }], "profile_scrape", T0 + 1000);
  assertEqual(db.profiles["carl-3"].headline, "Sales Director", "B: headline z search przeżył scrape z pustym headline");
  assert(!!db.profiles["carl-3"].scrapedProfile, "B: scrapedProfile zapisany przez scrape");
  assertEqual(db.profiles["carl-3"].source, "profile_scrape", "B: source podbity search→profile_scrape");
  assertEqual(db.profiles["carl-3"].lastSeenAt, T0 + 1000, "B: lastSeenAt zaktualizowany");
  assertEqual(db.profiles["carl-3"].firstSeenAt, T0, "B: firstSeenAt nie ruszony");
  // kolejny upsert z samego search NIE kasuje scrapedProfile ani nie cofa source
  upsertProfilesToDb(db, [{ slug: "carl-3", name: "Carl", buttonState: "Connect" }], "search", T0 + 2000);
  assert(!!db.profiles["carl-3"].scrapedProfile, "B: scrapedProfile przeżył kolejny upsert z search");
  assertEqual(db.profiles["carl-3"].source, "profile_scrape", "B: source nie cofnięty do search");
}

// C) isConnection sticky + connections_import wymusza true
{
  const db = { version: 1, profiles: {}, lastBackupAt: null };
  upsertProfilesToDb(db, [{ slug: "dana-4", name: "Dana", buttonState: "Connect" }], "search", T0);
  assertEqual(db.profiles["dana-4"].isConnection, false, "C: search/Connect → isConnection false");
  upsertProfilesToDb(db, [{ slug: "dana-4", name: "Dana" }], "connections_import", T0 + 1000);
  assertEqual(db.profiles["dana-4"].isConnection, true, "C: connections_import → isConnection true");
  upsertProfilesToDb(db, [{ slug: "dana-4", name: "Dana", buttonState: "Connect" }], "search", T0 + 2000);
  assertEqual(db.profiles["dana-4"].isConnection, true, "C: isConnection sticky (nie cofnięty przez search)");
}

// D) Slug normalization — encoded / mixed-case / z profile_url
{
  const db = { version: 1, profiles: {}, lastBackupAt: null };
  upsertProfilesToDb(db, [{ slug: "Rados%C5%82aw-PACZYNSKI" }], "search", T0);
  assert(!!db.profiles["radosław-paczynski"] || !!db.profiles["radosław-paczynski".toLowerCase()], "D: encoded+mixed-case slug znormalizowany", "klucze: " + Object.keys(db.profiles));
  upsertProfilesToDb(db, [{ profile_url: "https://www.linkedin.com/in/eric-5/?foo=bar" }], "manual", T0 + 1000);
  assert(!!db.profiles["eric-5"], "D: slug wyciągnięty z profile_url");
  // brak slug-a i brak profile_url → pominięty
  const before = Object.keys(db.profiles).length;
  upsertProfilesToDb(db, [{ name: "No Slug" }, null, undefined], "manual", T0 + 2000);
  assertEqual(Object.keys(db.profiles).length, before, "D: rekordy bez slug/null/undefined pominięte");
}

// E) csvEscape
{
  assertEqual(csvEscape("plain"), "plain", "E: zwykły tekst bez zmian");
  assertEqual(csvEscape("a,b"), '"a,b"', "E: przecinek → cudzysłowy");
  assertEqual(csvEscape('say "hi"'), '"say ""hi"""', "E: cudzysłów → podwojony");
  assertEqual(csvEscape("line1\nline2"), '"line1\nline2"', "E: newline → cudzysłowy");
  assertEqual(csvEscape(null), "", "E: null → pusty string");
}

// F) CSV round-trip — buduj wiersz, sparsuj, sprawdź wartości z przecinkami/cudzysłowami
{
  const cols = ["slug", "name", "headline", "isConnection"];
  const recs = [
    { slug: "frank-6", name: "Frank, Jr.", headline: 'CEO "BigCo"', isConnection: true },
    { slug: "gina-7", name: "Gina\nNewline", headline: "Plain", isConnection: false },
  ];
  const lines = [cols.join(",")];
  for (const r of recs) {
    lines.push(cols.map((c) => c === "isConnection" ? (r[c] ? "1" : "0") : csvEscape(r[c])).join(","));
  }
  const csv = lines.join("\r\n");
  const parsed = parseCsv(csv);
  assertEqual(parsed.length, 2, "F: sparsowano 2 wiersze");
  assertEqual(parsed[0].slug, "frank-6", "F: slug ok");
  assertEqual(parsed[0].name, "Frank, Jr.", "F: name z przecinkiem zachowany");
  assertEqual(parsed[0].headline, 'CEO "BigCo"', "F: headline z cudzysłowami zachowany");
  assertEqual(parsed[0].isConnection, "1", "F: isConnection=1");
  assertEqual(parsed[1].name, "Gina\nNewline", "F: name z newline zachowany");
  assertEqual(parsed[1].isConnection, "0", "F: isConnection=0");
}

// G) Backup JSON round-trip — serializuj bazę, sparsuj, zmerguj z pustą bazą
{
  const db = { version: 1, profiles: {}, lastBackupAt: null };
  upsertProfilesToDb(db, [
    { slug: "harry-8", name: "Harry", headline: "Dev", buttonState: "Connect" },
    { slug: "ivy-9", name: "Ivy", buttonState: "Message" },
  ], "search", T0);
  upsertProfilesToDb(db, [{ slug: "harry-8", profile_url: "https://www.linkedin.com/in/harry-8/", about: "x" }], "profile_scrape", T0 + 500);
  const backup = JSON.stringify({ exportedAt: new Date(T0).toISOString(), extVersion: "1.14.0", profileDb: db, bulkConnect: { queue: [{ slug: "harry-8", status: "pending" }] } });
  const parsed = JSON.parse(backup);
  assert(parsed.profileDb && parsed.profileDb.profiles && parsed.profileDb.profiles["harry-8"], "G: backup zawiera profile");
  // Restore: merge do świeżej bazy zachowując timestampy.
  const fresh = { version: 1, profiles: {}, lastBackupAt: null };
  const recs = Object.values(parsed.profileDb.profiles);
  let added = 0;
  for (const p of recs) {
    const src = (p.source && SOURCE_RANK[p.source]) ? p.source : "manual";
    const rec = profileRecordFromInput(p, src, Date.now());
    if (p.firstSeenAt) rec.firstSeenAt = p.firstSeenAt;
    if (p.lastSeenAt) rec.lastSeenAt = p.lastSeenAt;
    if (fresh.profiles[rec.slug]) fresh.profiles[rec.slug] = mergeProfileRecord(fresh.profiles[rec.slug], rec);
    else { fresh.profiles[rec.slug] = rec; added += 1; }
  }
  assertEqual(added, 2, "G: restore dodał 2 rekordy do świeżej bazy");
  assertEqual(fresh.profiles["harry-8"].firstSeenAt, T0, "G: firstSeenAt zachowany z backupu");
  assertEqual(fresh.profiles["harry-8"].source, "profile_scrape", "G: source zachowany z backupu");
  assert(!!fresh.profiles["harry-8"].scrapedProfile, "G: scrapedProfile zachowany z backupu");
  assertEqual(fresh.profiles["ivy-9"].isConnection, true, "G: Ivy (Message) → isConnection true po restore");
}

// ── Sekcja H: LinkedIn data export (Connections.csv) — #52 v1.20.0 ───
const LINKEDIN_EXPORT_HEADER_PREFIX = "First Name,Last Name,URL,";
const LINKEDIN_MONTH_MAP = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
  sty:1,lut:2,kwi:4,maj:5,cze:6,lip:7,sie:8,wrz:9,paz:10,"paź":10,lis:11,gru:12,
};
function parseLinkedInDate(str) {
  if (!str || typeof str !== "string") return null;
  const m = String(str).trim().match(/^(\d{1,2})\s+([A-Za-zżźćńółęąśŻŹĆŃÓŁĘĄŚ]+)\s+(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = LINKEDIN_MONTH_MAP[m[2].toLowerCase().slice(0,3)];
  const year = parseInt(m[3], 10);
  if (!mon || !day || day < 1 || day > 31 || !year) return null;
  return `${year}-${String(mon).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function isValidEmailFromCsv(raw) {
  if (!raw || typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s) return false;
  if (s.toLowerCase().startsWith("urn:")) return false;
  return /@[^@\s]+\.[^@\s]+$/.test(s);
}
function stripBom(text) {
  if (typeof text !== "string") return "";
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
function extractLinkedInExportRows(text) {
  const clean = stripBom(text || "");
  const idx = clean.toLowerCase().indexOf(LINKEDIN_EXPORT_HEADER_PREFIX.toLowerCase());
  if (idx === -1) return { rows: [], error: "header_not_found" };
  return { rows: parseCsv(clean.slice(idx)), error: null };
}
function mapLinkedInExportRow(row) {
  if (!row || typeof row !== "object") return null;
  const get = (k) => row[k] != null ? String(row[k]).trim() : "";
  const first = get("First Name"), last = get("Last Name"), url = get("URL");
  const emailRaw = get("Email Address"), company = get("Company");
  const position = get("Position"), connectedRaw = get("Connected On");
  let slug = url ? extractSlugFromUrl(url) : null;
  if (!slug) return null;
  return {
    slug,
    name: `${first} ${last}`.trim() || null,
    headline: position || null,
    company: company || null,
    profile_url: `https://www.linkedin.com/in/${slug}/`,
    isConnection: true,
    connectedOn: parseLinkedInDate(connectedRaw),
    contactInfo: isValidEmailFromCsv(emailRaw) ? { email: emailRaw.trim() } : null,
  };
}

(function testH() {
  console.log("\n— H: LinkedIn export parsing —");
  assertEqual(parseLinkedInDate("16 May 2026"), "2026-05-16", "H.1: EN '16 May 2026' → 2026-05-16");
  assertEqual(parseLinkedInDate("08 Aug 2025"), "2025-08-08", "H.1: zero-padded day '08 Aug 2025'");
  assertEqual(parseLinkedInDate("10 Jan 2014"), "2014-01-10", "H.1: stara data 2014");
  assertEqual(parseLinkedInDate("1 Mar 2024"), "2024-03-01", "H.1: jedna cyfra dnia '1 Mar 2024'");
  assertEqual(parseLinkedInDate("15 maj 2024"), "2024-05-15", "H.2: PL 'maj' → 5");
  assertEqual(parseLinkedInDate("01 paź 2023"), "2023-10-01", "H.2: PL 'paź' → 10");
  assertEqual(parseLinkedInDate("invalid"), null, "H.3: 'invalid' → null");
  assertEqual(parseLinkedInDate(""), null, "H.3: '' → null");
  assertEqual(parseLinkedInDate("32 May 2026"), null, "H.3: day > 31 → null");
  assertEqual(parseLinkedInDate("15 Xyz 2024"), null, "H.3: nieznany miesiąc → null");
  assert(!isValidEmailFromCsv("urn:li:member:1629761317"), "H.4: urn:li:member: → false");
  assert(!isValidEmailFromCsv("urn:li:other:foo"), "H.4: urn:li:other: → false");
  assert(!isValidEmailFromCsv(""), "H.4: pusty string → false");
  assert(!isValidEmailFromCsv("not-an-email"), "H.4: bez @ → false");
  assert(isValidEmailFromCsv("foo@bar.com"), "H.4: literal email → true");
  assert(isValidEmailFromCsv("a.b+c@example.co.uk"), "H.4: złożony literal → true");
  assertEqual(stripBom("﻿First Name,Last Name"), "First Name,Last Name", "H.5: BOM strip");
  assertEqual(stripBom("First Name"), "First Name", "H.5: brak BOM zostaje");
  assertEqual(stripBom(""), "", "H.5: empty");

  const csvWithPreamble = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing..."

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Anna,Kowalska,https://www.linkedin.com/in/anna-kowalska,,Firma X,CEO,15 May 2024
`;
  const r1 = extractLinkedInExportRows(csvWithPreamble);
  assertEqual(r1.error, null, "H.6: brak błędu");
  assertEqual(r1.rows.length, 1, "H.6: 1 wiersz danych");
  assertEqual(r1.rows[0]["First Name"], "Anna", "H.6: First Name = Anna");
  assertEqual(r1.rows[0]["Position"], "CEO", "H.6: Position = CEO");
  const r2 = extractLinkedInExportRows("Notes:\nrandom text without header");
  assertEqual(r2.error, "header_not_found", "H.7: brak headera → error");
  const csvBom = "﻿" + csvWithPreamble;
  const r3 = extractLinkedInExportRows(csvBom);
  assertEqual(r3.error, null, "H.8: BOM+preamble → ok");
  assertEqual(r3.rows.length, 1, "H.8: BOM+preamble → 1 wiersz");

  const m1 = mapLinkedInExportRow({
    "First Name": "Marek", "Last Name": "Kowalski",
    "URL": "https://www.linkedin.com/in/marek-kowalski",
    "Email Address": "marek@firma.pl",
    "Company": "Acme", "Position": "CTO", "Connected On": "15 Mar 2024",
  });
  assertEqual(m1.slug, "marek-kowalski", "H.9: slug");
  assertEqual(m1.name, "Marek Kowalski", "H.9: name = First+Last");
  assertEqual(m1.headline, "CTO", "H.9: headline = Position");
  assertEqual(m1.company, "Acme", "H.9: company");
  assertEqual(m1.contactInfo && m1.contactInfo.email, "marek@firma.pl", "H.9: contactInfo.email");
  assertEqual(m1.connectedOn, "2024-03-15", "H.9: connectedOn");
  assertEqual(m1.isConnection, true, "H.9: isConnection = true");

  const m2 = mapLinkedInExportRow({
    "First Name": "Aleksandra", "Last Name": "Sołtys",
    "URL": "https://www.linkedin.com/in/aleksandra-so%C5%82tys-ab1978395",
    "Email Address": "urn:li:member:1629761317",
    "Company": "Concept13", "Position": "Doradca", "Connected On": "13 May 2026",
  });
  assertEqual(m2.contactInfo, null, "H.10: urn:li:member: → contactInfo null");
  assertEqual(m2.slug, "aleksandra-sołtys-ab1978395", "H.10: slug z percent-encoded polskim znakiem zdekodowany");

  const m3 = mapLinkedInExportRow({
    "First Name": "Justyna", "Last Name": "Zązel",
    "URL": "https://www.linkedin.com/in/justyna-z-2a29b6166",
    "Email Address": "", "Company": "ING", "Position": "Specialist", "Connected On": "16 May 2026",
  });
  assertEqual(m3.contactInfo, null, "H.11: pusty Email → contactInfo null");

  const m4 = mapLinkedInExportRow({
    "First Name": "Dawid", "Last Name": "Michalski",
    "URL": "https://www.linkedin.com/in/dawid-michalski-b25479345",
    "Email Address": "", "Company": "PKO BP", "Position": "Doradca Klienta Indywidualnego ",
    "Connected On": "14 May 2026",
  });
  assertEqual(m4.headline, "Doradca Klienta Indywidualnego", "H.12: trailing space trim");

  assertEqual(mapLinkedInExportRow({ "First Name":"X", "Last Name":"Y", "URL":"" }), null, "H.13: brak URL → null");

  const csvDoubled = `Notes:
"abstract"

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Izabella,Goździewska,https://www.linkedin.com/in/izabella-go%C5%BAdziewska,,"Agencja Celna ""Betrę""","Agent celny w Agencja Celna ""BeTrę""",31 Oct 2022
`;
  const r4 = extractLinkedInExportRows(csvDoubled);
  assertEqual(r4.rows.length, 1, "H.14: 1 wiersz z doubled-quote");
  const m5 = mapLinkedInExportRow(r4.rows[0]);
  assertEqual(m5.company, 'Agencja Celna "Betrę"', "H.14: doubled quote w Company → unescaped");
  assertEqual(m5.headline, 'Agent celny w Agencja Celna "BeTrę"', "H.14: doubled quote w Position → unescaped");

  const db = { profiles: {} };
  const recScrape = profileRecordFromInput({
    slug: "marek-kowalski", name: "Marek Kowalski", headline: "CTO @ Acme (scraped)",
    scrapedProfile: { about: "long about text" },
  }, "profile_scrape", T0);
  db.profiles["marek-kowalski"] = recScrape;
  const recExport = profileRecordFromInput({
    slug: "marek-kowalski", name: "Marek Kowalski", headline: "CTO",
  }, "linkedin_export", T0 + 1000);
  recExport.company = "Acme";
  recExport.connectedOn = "2024-03-15";
  const prev = db.profiles["marek-kowalski"];
  const merged = mergeProfileRecord(prev, recExport);
  if (recExport.connectedOn && !prev.connectedOn) merged.connectedOn = recExport.connectedOn;
  if (recExport.company && !prev.company) merged.company = recExport.company;
  db.profiles["marek-kowalski"] = merged;
  assertEqual(db.profiles["marek-kowalski"].source, "profile_scrape", "H.15: source zostaje profile_scrape");
  assert(!!db.profiles["marek-kowalski"].scrapedProfile, "H.15: scrapedProfile zachowany");
  assertEqual(db.profiles["marek-kowalski"].company, "Acme", "H.15: company dodany");
  assertEqual(db.profiles["marek-kowalski"].connectedOn, "2024-03-15", "H.15: connectedOn dodany");

  const db2 = { profiles: {} };
  db2.profiles["jan-nowak"] = profileRecordFromInput({
    slug: "jan-nowak", name: "Jan Nowak", headline: "",
  }, "connections_import", T0);
  const recExp2 = profileRecordFromInput({
    slug: "jan-nowak", name: "Jan Nowak", headline: "Sales Manager",
  }, "linkedin_export", T0 + 1000);
  db2.profiles["jan-nowak"] = mergeProfileRecord(db2.profiles["jan-nowak"], recExp2);
  assertEqual(db2.profiles["jan-nowak"].headline, "Sales Manager", "H.16: headline nadpisany");
  assertEqual(db2.profiles["jan-nowak"].source, "linkedin_export", "H.16: source upgraded");
})();

// ── Sekcja I: pagination + delete (#54 v1.21.0) ──────────────────────
function profileDbListLogic(db, filter = {}) {
  const text = (filter.text || "").trim().toLowerCase();
  const wantSource = filter.source || "";
  const wantConn = filter.isConnection || "";
  let list = Object.values(db.profiles);
  if (text) list = list.filter((r) => `${r.name||""} ${r.headline||""} ${r.slug||""}`.toLowerCase().includes(text));
  if (wantSource) list = list.filter((r) => r.source === wantSource);
  if (wantConn === "yes") list = list.filter((r) => r.isConnection);
  if (wantConn === "no") list = list.filter((r) => !r.isConnection);
  list.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  const filteredTotal = list.length;
  const limit = (typeof filter.limit === "number" && filter.limit > 0) ? filter.limit : null;
  const offset = (typeof filter.offset === "number" && filter.offset > 0) ? filter.offset : 0;
  const paged = limit ? list.slice(offset, offset + limit) : list;
  return {
    list: paged,
    counts: { total: Object.keys(db.profiles).length, filtered: filteredTotal },
    page: limit ? { limit, offset, filteredTotal } : null,
  };
}

function profileDbDeleteLogic(db, { slugs, deleteAllFiltered, filter }) {
  let toDelete = [];
  if (deleteAllFiltered === true) {
    const text = ((filter && filter.text) || "").trim().toLowerCase();
    const wantSource = (filter && filter.source) || "";
    const wantConn = (filter && filter.isConnection) || "";
    for (const slug of Object.keys(db.profiles)) {
      const r = db.profiles[slug];
      if (text && !`${r.name||""} ${r.headline||""} ${r.slug||""}`.toLowerCase().includes(text)) continue;
      if (wantSource && r.source !== wantSource) continue;
      if (wantConn === "yes" && !r.isConnection) continue;
      if (wantConn === "no" && r.isConnection) continue;
      toDelete.push(slug);
    }
  } else if (Array.isArray(slugs) && slugs.length) {
    toDelete = slugs.filter((s) => db.profiles[s]);
  } else { return { deleted: 0 }; }
  for (const slug of toDelete) delete db.profiles[slug];
  return { deleted: toDelete.length, total: Object.keys(db.profiles).length };
}

(function testI() {
  console.log("\n— I: pagination + delete —");
  const db = { profiles: {} };
  const mkRec = (slug, source, isConnection, ts) => ({
    slug, name: `Person ${slug}`, headline: `Role ${slug}`,
    source, isConnection, lastSeenAt: ts, firstSeenAt: ts,
  });
  db.profiles["a"] = mkRec("a", "linkedin_export", true, T0 + 1000);
  db.profiles["b"] = mkRec("b", "linkedin_export", true, T0 + 2000);
  db.profiles["c"] = mkRec("c", "connections_import", true, T0 + 3000);
  db.profiles["d"] = mkRec("d", "search", false, T0 + 4000);
  db.profiles["e"] = mkRec("e", "manual", true, T0 + 5000);

  const r1 = profileDbListLogic(db);
  assertEqual(r1.list.length, 5, "I.1: bez limit → wszystkie 5");
  assertEqual(r1.page, null, "I.1: bez limit → page=null");

  const r2 = profileDbListLogic(db, { limit: 2, offset: 0 });
  assertEqual(r2.list.length, 2, "I.2: limit=2 → 2 wiersze");
  assertEqual(r2.list[0].slug, "e", "I.2: sort lastSeenAt desc — e pierwszy");
  assertEqual(r2.list[1].slug, "d", "I.2: d drugi");
  assertEqual(r2.page.filteredTotal, 5, "I.2: filteredTotal = 5");

  const r3 = profileDbListLogic(db, { limit: 2, offset: 2 });
  assertEqual(r3.list[0].slug, "c", "I.3: offset=2 → trzeci wiersz");
  assertEqual(r3.list[1].slug, "b", "I.3: czwarty wiersz");

  const r4 = profileDbListLogic(db, { source: "linkedin_export", limit: 1, offset: 0 });
  assertEqual(r4.list.length, 1, "I.4: limit=1 zwraca 1 wiersz");
  assertEqual(r4.page.filteredTotal, 2, "I.4: filteredTotal=2 (a+b pasują)");
  assertEqual(r4.list[0].slug, "b", "I.4: b ma nowszy lastSeenAt z dwóch linkedin_export");

  const r5 = profileDbListLogic(db, { limit: 10, offset: 100 });
  assertEqual(r5.list.length, 0, "I.5: offset poza zakresem → []");
  assertEqual(r5.page.filteredTotal, 5, "I.5: filteredTotal niezależny od offset");

  const db2 = JSON.parse(JSON.stringify(db));
  const d1 = profileDbDeleteLogic(db2, { slugs: ["a", "c"] });
  assertEqual(d1.deleted, 2, "I.6: usunięto 2");
  assertEqual(d1.total, 3, "I.6: zostały 3");
  assert(!db2.profiles["a"], "I.6: 'a' nie istnieje");
  assert(!db2.profiles["c"], "I.6: 'c' nie istnieje");
  assert(!!db2.profiles["b"], "I.6: 'b' nietknięty");

  const db3 = JSON.parse(JSON.stringify(db));
  const d2 = profileDbDeleteLogic(db3, { slugs: ["nonexistent", "a"] });
  assertEqual(d2.deleted, 1, "I.7: usunięto tylko istniejący (1 z 2)");

  const db4 = JSON.parse(JSON.stringify(db));
  const d3 = profileDbDeleteLogic(db4, { deleteAllFiltered: true, filter: { source: "linkedin_export" } });
  assertEqual(d3.deleted, 2, "I.8: deleteAllFiltered usuwa 2 z source=linkedin_export");
  assert(!db4.profiles["a"] && !db4.profiles["b"], "I.8: a+b zniknęły");
  assert(!!db4.profiles["c"], "I.8: c (connections_import) zostaje");

  const db5 = JSON.parse(JSON.stringify(db));
  const d4 = profileDbDeleteLogic(db5, { deleteAllFiltered: true, filter: { text: "Person a" } });
  assertEqual(d4.deleted, 1, "I.9: text filter 'Person a' matchuje 1");

  const db6 = JSON.parse(JSON.stringify(db));
  const d5 = profileDbDeleteLogic(db6, { deleteAllFiltered: true, filter: { isConnection: "no" } });
  assertEqual(d5.deleted, 1, "I.10: isConnection=no usuwa 1 (slug 'd')");

  const db7 = JSON.parse(JSON.stringify(db));
  const d6 = profileDbDeleteLogic(db7, { deleteAllFiltered: true, filter: {} });
  assertEqual(d6.deleted, 5, "I.11: brak filtra → usuwa wszystko");
  assertEqual(d6.total, 0, "I.11: baza pusta");

  const db8 = JSON.parse(JSON.stringify(db));
  const d7 = profileDbDeleteLogic(db8, {});
  assertEqual(d7.deleted, 0, "I.12: brak slugs i brak deleteAllFiltered → noop");
})();

console.log("");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
