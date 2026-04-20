/**
 * Background Service Worker
 * 
 * Handles API communication and stores settings.
 * Popup sends requests here; this worker calls the backend.
 */

const DEFAULT_SETTINGS = {
  apiUrl: "http://localhost:8321",
  apiKey: "dev-test-key-123",
  defaultGoal: "networking",
  defaultLanguage: "pl",
  defaultMaxChars: 1000,
  senderContext: "",
};

// ── Settings ─────────────────────────────────────────────────────────

async function getSettings() {
  const data = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

// ── API Call ──────────────────────────────────────────────────────────

async function generateMessage(profile, options = {}) {
  const settings = await getSettings();

  const apiUrl = `${settings.apiUrl.replace(/\/$/, "")}/api/generate-message`;

  const body = {
    profile: profile,
    goal: options.goal || settings.defaultGoal,
    tone: options.tone || null,
    language: options.language || settings.defaultLanguage,
    max_chars: options.maxChars || settings.defaultMaxChars,
    sender_context: settings.senderContext || null,
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": settings.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
    throw new Error(err.detail || `Błąd serwera: ${response.status}`);
  }

  return await response.json();
}

// ── Message Router ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    try {
      switch (message.action) {
        case "generateMessage":
          return await generateMessage(message.profile, message.options);

        case "getSettings":
          return await getSettings();

        case "saveSettings":
          await saveSettings(message.settings);
          return { success: true };

        default:
          throw new Error(`Nieznana akcja: ${message.action}`);
      }
    } catch (err) {
      return { error: err.message };
    }
  };

  handler().then(sendResponse);
  return true; // Keep message channel open for async
});

// ── Install / Update ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await saveSettings(DEFAULT_SETTINGS);
    console.log("[LinkedIn MSG] Extension installed, defaults saved.");
  }
});
