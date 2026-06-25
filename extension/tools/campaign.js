/**
 * Campaign Manager — LinkedIn connections bulk messaging
 *
 * Uses the backend's campaign API to generate personalised messages
 * for all of the user's LinkedIn connections. Handles:
 *  - Scraping the connections list from LinkedIn's My Network page
 *  - Enriching with hook categories (job-role detection)
 *  - Calling the backend to generate messages
 *  - Daily throttle (15 msgs/day) to avoid LinkedIn flags
 *
 * This is a standalone module consumed by dashboard.js.
 */
export class CampaignManager {
  constructor(apiBaseUrl, apiKey) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  /**
   * Scrape all connections from the LinkedIn "My Network" page.
   * The user must be on: https://www.linkedin.com/mynetwork/invite-connect/connections/
   *
   * Returns an array of { contact_id, first_name, headline, profile_url }.
   */
  static async scrapeConnections(pageSize = 500) {
    // We use LinkedIn's Voyager API if available, otherwise fall back to DOM scraping
    const contacts = [];

    // Try Voyager API first (authenticated, same origin)
    try {
      const voyagerData = await CampaignManager._fetchVoyagerConnections(pageSize);
      if (voyagerData && voyagerData.length > 0) {
        return voyagerData;
      }
    } catch (e) {
      console.warn("[Campaign] Voyager fallback failed, trying DOM scrape:", e.message);
    }

    // DOM fallback – iterate visible connection cards
    const cards = document.querySelectorAll(
      ".mn-connection-card, li.mn-connection-card, .mn-connection-card__details"
    );
    if (cards.length === 0) {
      console.warn("[Campaign] No connection cards found in DOM");
      return [];
    }

    for (const card of cards) {
      const nameEl = card.querySelector(
        ".mn-connection-card__name, .mn-connection-card__link, a.mn-connection-card__name"
      );
      const headlineEl = card.querySelector(
        ".mn-connection-card__occupation, .mn-connection-card__headline"
      );
      const linkEl = card.querySelector("a.mn-connection-card__link, a[href*='/in/']");

      const fullName = nameEl ? nameEl.textContent.trim() : "";
      const firstName = fullName.split(" ")[0] || fullName;
      const headline = headlineEl ? headlineEl.textContent.trim() : "";
      const profileUrl = linkEl ? linkEl.href : "";

      if (!firstName) continue;

      contacts.push({
        contact_id: profileUrl.split("/in/")[1]?.replace(/\/$/, "") || `dom-${Date.now()}-${contacts.length}`,
        first_name: firstName,
        headline: headline,
        profile_url: profileUrl,
      });
    }

    return contacts;
  }

  /**
   * Try to fetch connections via LinkedIn's internal Voyager API.
   * This provides more complete data than DOM scraping.
   */
  static async _fetchVoyagerConnections(count = 500) {
    const url = `https://www.linkedin.com/voyager/api/graphql?variables=(start:0,count:${count})&queryId=voyagerIdentityDashConnections.1d1e9c3f3e1c2c3f8e1c2c3f8e1c2c3f`;
    const resp = await fetch(url, { credentials: "include" });
    if (!resp.ok) throw new Error(`Voyager HTTP ${resp.status}`);
    const json = await resp.json();

    const elements =
      json?.included ||
      json?.data?.identityDashConnectionsByMemberDistance?.elements ||
      [];

    return elements.map((el) => {
      const fullName =
        el.title ||
        el.name ||
        el.firstName + " " + el.lastName ||
        "";
      return {
        contact_id: el.entityUrn || el.publicIdentifier || `voyager-${Date.now()}`,
        first_name: fullName.split(" ")[0] || fullName,
        headline: el.occupation || el.headline || "",
        profile_url: el.navigationUrl || el.profileUrl || "",
      };
    });
  }

  /**
   * Generate a batch of campaign messages via the backend.
   * @param {Array} contacts - from scrapeConnections()
   * @param {string} productDescription - opis programu
   * @param {string} authorContext - kontekst autora
   * @returns {Promise<Object>} CampaignResponse from backend
   */
  async generateBatch(contacts, productDescription, authorContext) {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const payload = {
      batch_id: batchId,
      contacts: contacts,
      product_description: productDescription,
      author_context: authorContext,
    };

    const resp = await fetch(`${this.apiBaseUrl}/api/campaign/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }

    return resp.json();
  }

  /**
   * Check the daily throttle status from backend.
   * @returns {Promise<{daily_limit: number, sent_today: number, remaining_today: number}>}
   */
  async getThrottleStatus() {
    const resp = await fetch(`${this.apiBaseUrl}/api/campaign/throttle`, {
      headers: { "X-API-Key": this.apiKey },
    });
    if (!resp.ok) {
      throw new Error(`Throttle check failed: HTTP ${resp.status}`);
    }
    return resp.json();
  }

  /**
   * Split contacts into daily batches respecting the throttle limit.
   *
   * @param {Array} contacts - all contacts
   * @param {number} dailyLimit - max messages per day
   * @returns {Array<Array>} Array of daily batches
   */
  static splitIntoDailyBatches(contacts, dailyLimit = 15) {
    const batches = [];
    for (let i = 0; i < contacts.length; i += dailyLimit) {
      batches.push(contacts.slice(i, i + dailyLimit));
    }
    return batches;
  }
}

// Also expose a window-scoped variable for non-module contexts (dashboard, popup)
if (typeof window !== "undefined") {
  window.CampaignManager = CampaignManager;
}