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
 *
 * NOTE: scrapeConnections() delegates to background.js via chrome.runtime.sendMessage
 * so it can reuse the battle-tested extractConnectionsList() from content.js (SDUI + Ember).
 * The old in-file DOM scraper and the fake Voyager queryId have been removed.
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
   * Delegates to background.js → content.js extractConnectionsList() which handles
   * both the classic Ember layout and the SDUI variant (data-rehydrated="true").
   *
   * Returns an array of { contact_id, first_name, headline, profile_url, location, company }.
   */
  static async scrapeConnections() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: "campaignScrapeConnections" },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response && response.contacts ? response.contacts : []);
        }
      );
    });
  }

  /**
   * Generate a batch of campaign messages via the backend.
   * @param {Array} contacts - from scrapeConnections()
   * @param {string} productDescription - opis programu / portalu
   * @param {string} authorContext - kontekst autora
   * @param {string} campaignGoal - "info" | "recruitment" | "sales"
   * @param {string|null} authorNote - opcjonalna notka osobista (np. "moje zdjecie na LI jest z akcji")
   * @returns {Promise<Object>} CampaignResponse from backend
   */
  async generateBatch(contacts, productDescription, authorContext, campaignGoal = "info", authorNote = null) {
    const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const payload = {
      batch_id: batchId,
      contacts: contacts,
      product_description: productDescription,
      author_context: authorContext,
      campaign_goal: campaignGoal,
    };
    if (authorNote && authorNote.trim()) {
      payload.author_note = authorNote.trim();
    }

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
