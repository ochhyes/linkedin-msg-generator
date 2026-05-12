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
const SOURCE_RANK = { search: 1, bulk: 2, manual: 3, connections_import: 4, profile_scrape: 5 };

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

console.log("");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
