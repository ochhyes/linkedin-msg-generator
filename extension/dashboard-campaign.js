/**
 * Dashboard Campaign UI — obsługa sekcji "Kampania" w dashboard.html
 *
 * Wires:
 *  - Scrape kontaktów z Moja Sieć (przez content.js w otwartej karcie)
 *  - Generowanie wiadomości przez backend API
 *  - Throttle dzienny (15/dzień)
 *  - Kopiowanie / eksport wyników
 */
(() => {
  "use strict";

  // ── DOM refs ──
  const productEl = document.getElementById("campaign-product");
  const authorEl = document.getElementById("campaign-author");
  const csvInput = document.getElementById("campaign-csv-input");
  const csvStatus = document.getElementById("campaign-csv-status");
  const btnScrape = document.getElementById("btn-campaign-scrape");
  const btnGenerate = document.getElementById("btn-campaign-generate");
  const throttleEl = document.getElementById("campaign-throttle");
  const throttleValue = throttleEl.querySelector(".campaign-throttle__value");
  const statusEl = document.getElementById("campaign-status");
  const resultsEl = document.getElementById("campaign-results");
  const messagesEl = document.getElementById("campaign-messages");
  const btnCopyAll = document.getElementById("btn-campaign-copy-all");
  const btnExportCsv = document.getElementById("btn-campaign-export-csv");

  let contactsCache = [];
  let messagesCache = [];
  let isGenerating = false;

  // ── Backend config (from localStorage, set by options.js) ──
  function getConfig() {
    return {
      apiBaseUrl: localStorage.getItem("lmg_api_base_url") || "http://localhost:8000",
      apiKey: localStorage.getItem("lmg_api_key") || "",
    };
  }

  function showStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.className = "campaign-status" + (isError ? " campaign-status--err" : " campaign-status--ok");
    statusEl.classList.remove("hidden");
  }

  function hideStatus() {
    statusEl.classList.add("hidden");
  }

  // ── CSV import: wgrywasz plik Connections.csv (eksport LinkedIn) ──
  // Daje 100% kontaktów (LinkedIn przez API pokazuje max ~1000).
  // Kolumny: First Name, Last Name, URL, Email Address, Company, Position, Connected On

  function parseConnectionsCsv(text) {
    const lines = text.split(/\r?\n/);
    const contacts = [];
    let headerFound = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Szukamy linii nagłówkowej: "First Name,Last Name,URL,..."
      if (!headerFound) {
        if (line.toLowerCase().startsWith("first name")) {
          headerFound = true;
        }
        continue;
      }

      // Parsujemy CSV — pola mogą zawierać przecinki w cudzysłowach
      const fields = parseCsvLine(line);
      if (fields.length < 3) continue;

      const firstName = (fields[0] || "").trim();
      const lastName = (fields[1] || "").trim();
      const url = (fields[2] || "").trim();
      const company = (fields[4] || "").trim();
      const position = (fields[5] || "").trim();

      if (!firstName || !url) continue;

      // Wyciągamy slug z URL: /in/<slug>
      const slugMatch = url.match(/\/in\/([^/?#]+)/);
      const slug = slugMatch ? slugMatch[1].toLowerCase() : url.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();

      // Headline = Company + Position jako hook dla AI
      const headline = [company, position].filter(Boolean).join(" — ") || position || company || "";

      contacts.push({
        contact_id: slug,
        first_name: firstName,
        headline: headline,
        profile_url: url,
      });
    }

    return contacts;
  }

  /** Parsuje jedną linię CSV z obsługą pól w cudzysłowach */
  function parseCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function handleCsvFile(file) {
    if (!file) return;
    csvStatus.textContent = "Wczytuję…";
    csvStatus.className = "campaign-csv-status";

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseConnectionsCsv(reader.result);
        if (parsed.length === 0) {
          csvStatus.textContent = "✗ Nie znaleziono kontaktów w pliku";
          csvStatus.className = "campaign-csv-status campaign-csv-status--err";
          return;
        }
        contactsCache = parsed;
        csvStatus.textContent = `✓ ${parsed.length} kontaktów`;
        csvStatus.className = "campaign-csv-status campaign-csv-status--ok";
        showStatus(`Wgrano ${parsed.length} kontaktów z pliku Connections.csv ✓`);
        btnGenerate.disabled = false;
        updateThrottle();
      } catch (err) {
        csvStatus.textContent = "✗ Błąd parsowania pliku";
        csvStatus.className = "campaign-csv-status campaign-csv-status--err";
        showStatus("Błąd parsowania CSV: " + err.message, true);
      }
    };
    reader.onerror = () => {
      csvStatus.textContent = "✗ Błąd odczytu pliku";
      csvStatus.className = "campaign-csv-status campaign-csv-status--err";
    };
    reader.readAsText(file, "UTF-8");
  }

  async function updateThrottle() {
    const { apiBaseUrl, apiKey } = getConfig();
    if (!apiKey) {
      throttleValue.textContent = "— / 15";
      return;
    }
    try {
      const resp = await fetch(`${apiBaseUrl}/api/campaign/throttle`, {
        headers: { "X-API-Key": apiKey },
      });
      if (!resp.ok) throw new Error();
      const data = await resp.json();
      throttleValue.textContent = `${data.sent_today || 0} / ${data.daily_limit || 15}`;
      // Enable generate if there are contacts and remaining quota
      if (contactsCache.length > 0 && data.remaining_today > 0 && !isGenerating) {
        btnGenerate.disabled = false;
      }
    } catch {
      throttleValue.textContent = "— / 15 (brak połączenia)";
    }
  }

  // ── Scrape: otwiera /mynetwork/invite-connect/connections/ w nowej karcie, injectuje content.js ──
  async function scrapeConnections() {
    btnScrape.disabled = true;
    btnScrape.textContent = "Pobieram kontakty…";
    showStatus("Otwieram stronę Moja Sieć LinkedIn…");

    try {
      // Otwórz kartę z listą kontaktów
      const tab = await new Promise((resolve) => {
        chrome.tabs.create(
          { url: "https://www.linkedin.com/mynetwork/invite-connect/connections/", active: false },
          resolve
        );
      });

      // Poczekaj aż strona się załaduje (complete = DOM gotowy, content script już załadowany przez manifest)
      await new Promise((resolve) => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        // Safety timeout: jeśli complete nie przyjdzie w 30s, i tak próbujemy
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 30000);
      });

      // Dodatkowy krótki delay na LinkedIn hydration (SPA render po DOM complete)
      await new Promise((r) => setTimeout(r, 3000));

      // Wyślij polecenie scrapowania do content script
      // Content.js obsługuje scrapeAllConnectionsForCampaign = scrolluje całą listę (do ~1000 kontaktów),
      // używa battle-tested extractConnectionsList() który działa na SDUI i Ember
      const result = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(
          tab.id,
          { action: "scrapeAllConnectionsForCampaign", pageSize: 1000 },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response);
          }
        );
      });

      if (result && result.success && result.contacts.length > 0) {
        contactsCache = result.contacts;
        showStatus(`Pobrano ${contactsCache.length} kontaktów ✓`);
        btnGenerate.disabled = false;
        // Zamknij kartę (już niepotrzebna)
        try { chrome.tabs.remove(tab.id); } catch {}
      } else {
        throw new Error(result?.error || "Nie znaleziono kontaktów. Upewnij się, że jesteś zalogowany do LinkedIn.");
      }
    } catch (err) {
      showStatus("Błąd: " + err.message, true);
      contactsCache = [];
      btnGenerate.disabled = true;
    }

    btnScrape.disabled = false;
    btnScrape.textContent = "Pobierz kontakty z Moja Sieć";
    updateThrottle();
  }

  // ── Generate: wysyła kontakty + opisy do backendu, odbiera wiadomości ──
  async function generateMessages() {
    const { apiBaseUrl, apiKey } = getConfig();
    const productDesc = productEl.value.trim();
    const authorDesc = authorEl.value.trim();

    if (!apiKey) {
      showStatus("Brak klucza API. Skonfiguruj w opcjach rozszerzenia.", true);
      return;
    }
    if (!productDesc || !authorDesc) {
      showStatus("Wprowadź opis programu i kontekst autora.", true);
      return;
    }
    if (contactsCache.length === 0) {
      showStatus("Najpierw pobierz kontakty z Moja Sieć.", true);
      return;
    }

    isGenerating = true;
    btnGenerate.disabled = true;
    btnGenerate.textContent = "Generuję…";

    try {
      // Sprawdź throttle
      const throttleResp = await fetch(`${apiBaseUrl}/api/campaign/throttle`, {
        headers: { "X-API-Key": apiKey },
      });
      if (!throttleResp.ok) throw new Error("Nie można sprawdzić limitu dziennego.");
      const throttle = await throttleResp.json();

      if (throttle.remaining_today <= 0) {
        throw new Error(`Dzisiejszy limit wyczerpany (${throttle.sent_today}/${throttle.daily_limit}). Spróbuj jutro.`);
      }

      // Ogranicz do pozostałych dzisiaj
      const batchSize = Math.min(contactsCache.length, throttle.remaining_today);
      const batch = contactsCache.slice(0, batchSize);

      showStatus(`Generuję wiadomości dla ${batch.length} kontaktów…`);

      const resp = await fetch(`${apiBaseUrl}/api/campaign/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({
          batch_id: "batch-" + Date.now(),
          contacts: batch,
          product_description: productDesc,
          author_context: authorDesc,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({ detail: "Błąd serwera" }));
        throw new Error(errBody.detail || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      messagesCache = data.messages || [];

      // Render results
      renderMessages(messagesCache);
      showStatus(`Wygenerowano ${messagesCache.length} wiadomości ✓`);

    } catch (err) {
      showStatus("Błąd: " + err.message, true);
    }

    isGenerating = false;
    btnGenerate.disabled = false;
    btnGenerate.textContent = "Generuj wiadomości";
    updateThrottle();
  }

  // ── Render ──
  function renderMessages(msgs) {
    if (!msgs || msgs.length === 0) {
      resultsEl.classList.add("hidden");
      return;
    }

    resultsEl.classList.remove("hidden");
    messagesEl.innerHTML = msgs
      .map(
        (m, i) => `
        <div class="campaign-message-card" data-index="${i}">
          <div class="campaign-message-card__header">
            <span>📧 <strong>${escapeHtml(m.first_name || "Kontakt")}</strong> &mdash; ${escapeHtml(m.profile_url || "")}</span>
            <span class="campaign-message-card__hook">${escapeHtml(m.hook_category || "")}</span>
          </div>
          <div class="campaign-message-card__body">${escapeHtml(m.message || "")}</div>
          <div class="campaign-message-card__actions">
            <button class="btn btn--sm btn--ghost campaign-copy-one" data-index="${i}">📋 Kopiuj</button>
          </div>
        </div>`
      )
      .join("");

    // Wire individual copy buttons
    messagesEl.querySelectorAll(".campaign-copy-one").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        if (messagesCache[idx]) {
          navigator.clipboard.writeText(messagesCache[idx].message || "").then(() => {
            btn.textContent = "✓ Skopiowano";
            setTimeout(() => (btn.textContent = "📋 Kopiuj"), 2000);
          }).catch(() => {
            btn.textContent = "✗ Błąd";
          });
        }
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function copyAllMessages() {
    if (messagesCache.length === 0) return;
    const text = messagesCache.map((m) => m.message || "").join("\n\n---\n\n");
    navigator.clipboard.writeText(text).then(() => {
      btnCopyAll.textContent = "✓ Skopiowano wszystkie";
      setTimeout(() => (btnCopyAll.textContent = "Kopiuj wszystkie"), 2000);
    }).catch(() => {
      showStatus("Nie udało się skopiować do schowka.", true);
    });
  }

  function exportCsv() {
    if (messagesCache.length === 0) return;
    // Build CSV with BOM for Excel
    let csv = "\uFEFFfirst_name;hook_category;profile_url;message\n";
    for (const m of messagesCache) {
      const row = [
        (m.first_name || "").replace(/"/g, '""'),
        (m.hook_category || "").replace(/"/g, '""'),
        (m.profile_url || "").replace(/"/g, '""'),
        (m.message || "").replace(/"/g, '""'),
      ];
      csv += '"' + row.join('";"') + '"\n';
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kampania-wiadomosci-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Event listeners ──
  btnScrape.addEventListener("click", scrapeConnections);
  btnGenerate.addEventListener("click", generateMessages);
  btnCopyAll.addEventListener("click", copyAllMessages);
  btnExportCsv.addEventListener("click", exportCsv);

  // Enable generate when fields change
  const checkEnable = () => {
    const productOk = productEl.value.trim().length > 20;
    const authorOk = authorEl.value.trim().length > 10;
    btnGenerate.disabled = !(productOk && authorOk && contactsCache.length > 0);
  };
  productEl.addEventListener("input", checkEnable);
  authorEl.addEventListener("input", checkEnable);

  // CSV file input handler
  if (csvInput) {
    csvInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleCsvFile(file);
    });
  }

  // Initial throttle check
  updateThrottle();
})();