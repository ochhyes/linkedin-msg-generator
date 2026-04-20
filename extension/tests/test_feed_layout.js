/**
 * Offline regression for the feed-layout extractor.
 *
 * Requires a real DOM dump at extension/dom_sample.txt (captured with the
 * diagnostic snippet — JSON with a `contextAroundName` field holding the
 * scraped <main> outerHTML). The dump is git-ignored because it contains
 * LinkedIn users' personal data; if absent, this test is skipped.
 */

const fs = require("fs");
const path = require("path");

const dumpPath = path.join(__dirname, "..", "dom_sample.txt");
if (!fs.existsSync(dumpPath)) {
  console.log("SKIP — dom_sample.txt not present (local-only fixture)");
  process.exit(0);
}

const { JSDOM } = require("jsdom");
const dump = JSON.parse(fs.readFileSync(dumpPath, "utf8"));

// contextAroundName is the main HTML spliced around the name marker.
// Strip the marker and reconstruct usable HTML.
const mainHtml = dump.contextAroundName.replace("[[[NAME HERE]]]", "");
const url = dump.url;

const dom = new JSDOM(
  `<!DOCTYPE html><html><body>${mainHtml}</body></html>`,
  { url }
);
global.document = dom.window.document;
global.window = dom.window;

// Copy the extraction logic inline (content.js wraps itself in an IIFE
// that registers chrome listeners — can't be required directly in node).

function extractSlugFromUrl() {
  const m = window.location.pathname.match(/\/in\/([^/?#]+)/);
  return m ? m[1] : null;
}

function extractProfileUrl() {
  return window.location.href.split("?")[0].replace(/\/$/, "");
}

function extractFromFeedLayout() {
  const slug = extractSlugFromUrl();
  if (!slug) return null;

  let decodedSlug;
  try { decodedSlug = decodeURIComponent(slug).toLowerCase(); }
  catch { decodedSlug = slug.toLowerCase(); }
  const slugParts = decodedSlug.split(/[-_]/).filter((p) => !/\d/.test(p) && p.length >= 2);
  if (slugParts.length === 0) return null;

  const main = document.querySelector("main");
  if (!main) return null;

  let authorAnchor = null;
  for (const el of main.querySelectorAll("[aria-label]")) {
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    if (!slugParts.every((p) => label.includes(p))) continue;
    const anchor = el.closest("a[href*='/in/']");
    if (anchor && anchor.querySelectorAll("p").length >= 2) {
      authorAnchor = anchor;
      break;
    }
  }

  if (!authorAnchor) {
    for (const a of main.querySelectorAll("a[href*='/in/']")) {
      const rawHref = a.getAttribute("href") || "";
      let href;
      try { href = decodeURIComponent(rawHref).toLowerCase(); }
      catch { href = rawHref.toLowerCase(); }
      if (!slugParts.every((p) => href.includes(p))) continue;
      if (a.querySelectorAll("p").length < 2) continue;
      const firstP = (a.querySelector("p")?.textContent || "").trim();
      if (firstP.length > 0 && firstP.length < 80 && /^\S+\s+\S+/.test(firstP)) {
        authorAnchor = a;
        break;
      }
    }
  }

  if (!authorAnchor) return null;

  const paragraphs = Array.from(authorAnchor.querySelectorAll("p"))
    .map((p) => p.textContent.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return null;

  const name = paragraphs[0];
  const nameLower = name.toLowerCase();
  if (!slugParts.some((p) => nameLower.includes(p))) return null;

  const headline = paragraphs.slice(1).find((t) =>
    t.length > 10
    && !/^[•·]\s*\d+$/.test(t)
    && !/^\d+(st|nd|rd|\.)?$/i.test(t)
    && !/\bEdytowano\b/i.test(t)
    && !/^\d+\s*(dni|dzień|godz|tyg|mies|rok|lat|min|sek)\b/i.test(t)
  ) || "";
  if (!headline) return null;

  const posts = [];
  const seen = new Set();
  const textEls = main.querySelectorAll('[data-testid="expandable-text-box"]');
  const FOLLOWING = 0x04;
  for (const textEl of textEls) {
    let p = textEl.parentElement;
    let depth = 0;
    let nearestAuthorHref = null;
    while (p && depth < 20 && !nearestAuthorHref) {
      const authors = Array.from(p.querySelectorAll("a[href*='/in/']")).reverse();
      for (const a of authors) {
        if (a.compareDocumentPosition(textEl) & FOLLOWING) {
          nearestAuthorHref = a.getAttribute("href") || "";
          break;
        }
      }
      p = p.parentElement;
      depth++;
    }
    if (!nearestAuthorHref) continue;
    let fh;
    try { fh = decodeURIComponent(nearestAuthorHref).toLowerCase(); }
    catch { fh = nearestAuthorHref.toLowerCase(); }
    if (!slugParts.every((sp) => fh.includes(sp))) continue;

    const text = textEl.textContent.trim().replace(/\s+/g, " ").slice(0, 500);
    if (text && !seen.has(text) && text.length > 40) {
      seen.add(text);
      posts.push(text);
    }
    if (posts.length >= 3) break;
  }

  return { name, headline, recent_activity: posts, profile_url: extractProfileUrl() };
}

const result = extractFromFeedLayout();
console.log("Result:", JSON.stringify(result, null, 2));

if (!result) {
  console.error("FAIL: no result");
  process.exit(1);
}
if (!/Anna\s+Wo/i.test(result.name)) {
  console.error(`FAIL: expected Anna Wołosz, got: ${result.name}`);
  process.exit(1);
}
if (!result.headline || result.headline.length < 20) {
  console.error(`FAIL: headline too short: ${result.headline}`);
  process.exit(1);
}
console.log("\nPASS — feed extractor works on real LinkedIn 2025 variant");
