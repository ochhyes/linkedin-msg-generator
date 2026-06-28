/**
 * Dashboard Campaign — scalony system kampanii (#75 v2.3.0)
 *
 * JEDEN system kampanii (zlanie "kampanii sekwencyjnej" #74 + "informuj kontakty"):
 *  - Kontakty: import z Connections.csv ALBO z bazy profili
 *  - Kroki: tresc z szablonu [Imie] ALBO generowana przez AI (brief: cel/produkt/autor)
 *  - Wysylka: automatyczna (worker w background.js) ALBO reczna (generuj + kopiuj/eksport)
 *  - Follow-upy: kolejne kroki po N dniach, stop przy odpowiedzi
 *
 * Komunikuje sie z background.js przez chrome.runtime.sendMessage.
 */
(() => {
  "use strict";

  // ── DOM refs ──────────────────────────────────────────────────────────
  const campaignsList = document.getElementById("cw-campaigns-list");
  const nameInput = document.getElementById("cw-name");
  const stepsListEl = document.getElementById("cw-steps-list");
  const btnAddStep = document.getElementById("cw-add-step");
  const btnImportDb = document.getElementById("cw-import-from-db");
  const csvInput = document.getElementById("cw-csv-input");
  const contactsCountEl = document.getElementById("cw-contacts-count");
  const btnSave = document.getElementById("cw-save-campaign");
  const briefEl = document.getElementById("cw-brief");
  const briefPresetsEl = document.getElementById("cw-brief-presets");
  const goalEl = document.getElementById("cw-goal");
  const productEl = document.getElementById("cw-product");
  const authorEl = document.getElementById("cw-author");
  const noteEl = document.getElementById("cw-note");
  const workerPanel = document.getElementById("cw-worker-panel");
  const workerBadge = document.getElementById("cw-worker-badge");
  const workerLine = document.getElementById("cw-worker-line");
  const btnDryRun = document.getElementById("cw-btn-dryrun");
  const btnGenerate = document.getElementById("cw-btn-generate");
  const genCountEl = document.getElementById("cw-gen-count");
  const genCountWrap = document.getElementById("cw-gen-count-wrap");
  const btnStart = document.getElementById("cw-btn-start");
  const btnStop = document.getElementById("cw-btn-stop");
  const dryRunResult = document.getElementById("cw-dryrun-result");
  const manualResult = document.getElementById("cw-manual-result");
  const errorMsg = document.getElementById("cw-error-msg");

  // ── State ──────────────────────────────────────────────────────────────
  let pendingContacts = []; // bufor kontaktow do nowej kampanii
  let pendingSteps = [];    // bufor krokow (stepNum, template, delayDays, mode)
  let activeCampaignId = null;
  let allCampaigns = [];

  // ── Helpers ──────────────────────────────────────────────────────────
  function msg(action, data) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, ...data }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { success: false, error: "no_response" });
        }
      });
    });
  }

  function escHtml(str) {
    if (str == null) return "";
    const d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
  }

  function showError(text) {
    errorMsg.textContent = text;
    errorMsg.classList.remove("hidden");
    setTimeout(() => errorMsg.classList.add("hidden"), 8000);
  }

  function formatDate(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function getSendMode() {
    const checked = document.querySelector('input[name="cw-sendmode"]:checked');
    return checked ? checked.value : "auto";
  }

  function getCampaignSendMode(campaign) {
    return ((campaign && campaign.config) || {}).sendMode === "manual" ? "manual" : "auto";
  }

  // ── Ladowanie kampanii ────────────────────────────────────────────────
  async function loadCampaigns() {
    const resp = await msg("getCampaigns");
    allCampaigns = (resp.campaigns || []);
    renderCampaignsList();
    await refreshWorkerPanel();
  }

  function renderCampaignsList() {
    if (!allCampaigns.length) {
      campaignsList.innerHTML = '<p class="empty-state">Brak kampanii. Utwórz pierwszą powyżej.</p>';
      workerPanel.classList.add("hidden");
      return;
    }
    campaignsList.innerHTML = allCampaigns.map((c) => {
      const total = (c.contacts || []).length;
      const sent = (c.contacts || []).filter((ct) => {
        const steps = ct.steps || {};
        return Object.values(steps).some((s) => s.status === "sent");
      }).length;
      const replied = (c.contacts || []).filter((ct) => ct.status === "replied").length;
      const isSelected = c.id === activeCampaignId;
      const mode = getCampaignSendMode(c) === "manual" ? "reczna" : "auto";
      const hasAi = (c.steps || []).some((s) => s.mode === "ai");
      return `
        <div class="cw-campaign-card ${isSelected ? "cw-campaign-card--selected" : ""}" data-id="${escHtml(c.id)}">
          <div class="cw-campaign-card__header">
            <strong>${escHtml(c.name)}</strong>
            <span class="muted">${c.steps ? c.steps.length : 0} kroków · ${total} kontaktów · ${sent} wysłano · ${replied} odpowiedziało · ${mode}${hasAi ? " · AI" : ""}</span>
          </div>
          <div class="cw-campaign-card__actions">
            <button class="btn btn--sm btn--ghost cw-btn-select" data-id="${escHtml(c.id)}">Wybierz</button>
            <button class="btn btn--sm btn--ghost cw-btn-delete" data-id="${escHtml(c.id)}">Usuń</button>
          </div>
          ${isSelected ? renderContactsTable(c) : ""}
        </div>`;
    }).join("");

    campaignsList.querySelectorAll(".cw-btn-select").forEach((btn) => {
      btn.addEventListener("click", () => selectCampaign(btn.dataset.id));
    });
    campaignsList.querySelectorAll(".cw-btn-delete").forEach((btn) => {
      btn.addEventListener("click", () => deleteCampaign(btn.dataset.id));
    });
    campaignsList.querySelectorAll(".cw-btn-mark-replied").forEach((btn) => {
      btn.addEventListener("click", () => markReplied(btn.dataset.campaign, btn.dataset.slug));
    });
    campaignsList.querySelectorAll(".cw-mark-written").forEach((btn) => {
      btn.addEventListener("click", () => markWritten(btn.dataset.campaign, btn.dataset.slug));
    });
    campaignsList.querySelectorAll(".cw-contacts-search").forEach((inp) => {
      inp.addEventListener("input", () => {
        const q = inp.value.toLowerCase().trim();
        const wrap = inp.closest(".cw-contacts-table-wrap");
        if (!wrap) return;
        const rows = wrap.querySelectorAll("tbody tr");
        let visible = 0;
        rows.forEach((tr) => {
          const match = !q || (tr.dataset.search || "").includes(q);
          tr.hidden = !match;
          if (match) visible++;
        });
        const countEl = inp.parentElement.querySelector(".cw-contacts-search-count");
        if (countEl) countEl.textContent = q ? `${visible} z ${rows.length}` : "";
      });
    });
  }

  function renderContactsTable(campaign) {
    const contacts = campaign.contacts || [];
    if (!contacts.length) return '<p class="muted" style="margin-top:8px">Brak kontaktów w kampanii.</p>';
    const steps = campaign.steps || [];
    const stepHeaders = steps.map((s) => `<th>Krok ${s.stepNum}<br><span class="muted">${s.delayDays ? "+" + s.delayDays + "d" : "start"}${s.mode === "ai" ? " · AI" : ""}</span></th>`).join("");
    const LIMIT = 500;
    const shown = contacts.slice(0, LIMIT);
    const rows = shown.map((c) => {
      const stepCells = steps.map((s) => {
        const st = (c.steps || {})[String(s.stepNum)] || {};
        let cls = "", label = "—";
        if (st.status === "sent") { cls = "cw-sent"; label = formatDate(st.sentAt); }
        else if (st.status === "failed") { cls = "cw-failed"; label = "Błąd"; }
        else if (st.status === "draft") { cls = ""; label = "szkic"; }
        else if (st.status === "pending") { cls = ""; label = "oczekuje"; }
        return `<td class="${cls}">${label}</td>`;
      }).join("");
      const repliedCell = c.repliedAt
        ? `<td class="cw-replied">Tak (${formatDate(c.repliedAt)})</td>`
        : `<td><button class="btn btn--sm btn--ghost cw-btn-mark-replied" data-campaign="${escHtml(campaign.id)}" data-slug="${escHtml(c.slug)}">Oznacz</button></td>`;
      const purl = c.profileUrl || profileUrlFor(c.slug);
      const hasPending = c.status !== "replied" && steps.some((s) => ((c.steps || {})[String(s.stepNum)] || {}).status !== "sent");
      const writtenBtn = hasPending
        ? ` <button class="btn btn--sm btn--ghost cw-mark-written" data-campaign="${escHtml(campaign.id)}" data-slug="${escHtml(c.slug)}" title="Napisałem ręcznie — pomiń w generacji">napisane ✓</button>`
        : "";
      const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ");
      const headline = c.headline || c.position || "";
      const searchVal = `${fullName} ${headline} ${c.company || ""}`.toLowerCase();
      const nameCell = `<td class="col-name"><a href="${escHtml(purl)}" target="_blank" rel="noopener">${escHtml(fullName || c.slug)}</a>${headline ? `<span class="cw-contact-headline">${escHtml(headline)}</span>` : ""}${writtenBtn}</td>`;
      return `<tr data-search="${escHtml(searchVal)}">${nameCell}${stepCells}${repliedCell}</tr>`;
    }).join("");
    const more = contacts.length > shown.length ? `<p class="muted cw-contacts-more" style="margin-top:6px">…i ${contacts.length - shown.length} więcej (tabela pokazuje pierwsze ${LIMIT}).</p>` : "";
    return `
      <div class="cw-contacts-table-wrap">
        <div class="cw-contacts-search-wrap">
          <input type="search" class="cw-contacts-search" placeholder="Szukaj po nazwisku, stanowisku, firmie…" data-campaign="${escHtml(campaign.id)}" />
          <span class="cw-contacts-search-count muted"></span>
        </div>
        <table class="contacts-table cw-contacts-table">
          <thead><tr><th>Kontakt</th>${stepHeaders}<th>Odpowiedź</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>${more}`;
  }

  async function selectCampaign(id) {
    activeCampaignId = id;
    renderCampaignsList();
    await refreshWorkerPanel();
    workerPanel.classList.remove("hidden");
    dryRunResult.classList.add("hidden");
    manualResult.classList.add("hidden");
  }

  async function deleteCampaign(id) {
    const worker = (await msg("getCampaignWorkerState")).worker || {};
    if (worker.active && worker.activeCampaignId === id) {
      showError("Zatrzymaj kampanię przed usunięciem.");
      return;
    }
    if (!confirm("Usunąć kampanię? Tej operacji nie można cofnąć.")) return;
    await msg("deleteCampaign", { id });
    if (activeCampaignId === id) activeCampaignId = null;
    await loadCampaigns();
  }

  async function markReplied(campaignId, slug) {
    await msg("campaignMarkReplied", { campaignId, slug });
    await loadCampaigns();
  }

  // Oznacz kontakt jako napisany recznie -> wypada z generacji/wysylki (krok = sent).
  async function markWritten(campaignId, slug) {
    const resp = await msg("campaignMarkWritten", { campaignId, slug });
    if (!resp.success && resp.error !== "no_due_step") {
      showError(humanizeError(resp.error) || "Nie udało się oznaczyć.");
    }
    await loadCampaigns();
  }

  // ── Worker panel ───────────────────────────────────────────────────────
  async function refreshWorkerPanel() {
    if (!activeCampaignId) {
      workerPanel.classList.add("hidden");
      return;
    }
    const campaign = allCampaigns.find((c) => c.id === activeCampaignId);
    const sendMode = getCampaignSendMode(campaign);
    const resp = await msg("getCampaignWorkerState");
    const worker = resp.worker || {};
    workerPanel.classList.remove("hidden");
    // "Generuj wiadomości" + licznik dostepne w KAZDYM trybie (przeglad + reczna wysylka).
    btnGenerate.classList.remove("hidden");
    if (genCountWrap) genCountWrap.classList.remove("hidden");

    // Tryb reczny: ukryj Start/Stop.
    if (sendMode === "manual") {
      btnStart.classList.add("hidden");
      btnStop.classList.add("hidden");
      workerBadge.textContent = "Ręczna";
      workerBadge.className = "count-badge";
      workerLine.textContent = "Generuj wiadomości, skopiuj i wyślij ręcznie, potem oznacz jako wysłane.";
      errorMsg.classList.add("hidden");
      return;
    }

    // Tryb auto (Generuj zostaje widoczny — mozesz przegladac i wysylac recznie takze tu).
    if (worker.active && worker.activeCampaignId === activeCampaignId) {
      workerBadge.textContent = "Aktywna";
      workerBadge.className = "count-badge count-badge--active";
      workerLine.textContent = `Wysłano dziś: ${worker.sentToday || 0}. Następny: ${worker.nextTickAt ? formatDate(worker.nextTickAt) : "—"}`;
      btnStart.classList.add("hidden");
      btnStop.classList.remove("hidden");
      errorMsg.classList.add("hidden");
    } else {
      workerBadge.textContent = "Zatrzymana";
      workerBadge.className = "count-badge";
      workerLine.textContent = worker.activeCampaignId !== activeCampaignId && worker.active
        ? "Inna kampania jest aktywna."
        : `Wysłano dziś: ${worker.sentToday || 0}`;
      btnStart.classList.remove("hidden");
      btnStop.classList.add("hidden");
      if (worker.errorMsg) {
        errorMsg.textContent = worker.errorMsg;
        errorMsg.classList.remove("hidden");
      } else {
        errorMsg.classList.add("hidden");
      }
    }
  }

  // ── Dry-run (podglad) ──────────────────────────────────────────────────
  async function runDryRun() {
    if (!activeCampaignId) return;
    btnDryRun.disabled = true;
    btnDryRun.textContent = "Generuję podgląd…";
    const resp = await msg("campaignDryRun", { campaignId: activeCampaignId });
    btnDryRun.disabled = false;
    btnDryRun.textContent = "Podgląd (dry-run)";
    if (!resp.success || !resp.preview) {
      showError(humanizeError(resp.error) || "Błąd podglądu.");
      return;
    }
    if (!resp.preview.length) {
      dryRunResult.innerHTML = '<p class="muted">Brak kontaktów do podglądu.</p>';
    } else {
      dryRunResult.innerHTML = `<p><strong>Podgląd dla ${resp.preview.length} kontaktów</strong> <span class="muted">— regeneruj / edytuj / wyślij. Zapisana wersja zostanie użyta przy wysyłce.</span></p>` +
        resp.preview.map((p) => `
          <div class="cw-preview-card" data-slug="${escHtml(p.slug)}" data-step="${p.stepNum || 1}">
            <div class="cw-preview-card__name"><a href="${escHtml(profileUrlFor(p.slug))}" target="_blank" rel="noopener">${escHtml(p.firstName)} (${escHtml(p.slug)})</a></div>
            <textarea class="cw-preview-card__msg cw-manual-msg" rows="4">${escHtml(p.message)}</textarea>
            <div class="campaign-message-card__actions">
              <button class="btn btn--sm btn--accent cw-send">Wyślij</button>
              <button class="btn btn--sm btn--ghost cw-regen">Regeneruj</button>
            </div>
          </div>`).join("");
      wireRegen(dryRunResult);
      wireSend(dryRunResult);
    }
    dryRunResult.classList.remove("hidden");
  }

  // ── Tryb auto: Start/Stop ──────────────────────────────────────────────
  async function startWorker() {
    if (!activeCampaignId) return;
    btnStart.disabled = true;
    const resp = await msg("campaignWorkerStart", { campaignId: activeCampaignId });
    btnStart.disabled = false;
    if (!resp.success) {
      const errMap = {
        bulk_connect_active: "Najpierw zatrzymaj 'Dodaj automatycznie'.",
        campaign_not_found: "Nie znaleziono kampanii.",
        manual_mode: "Ta kampania jest w trybie ręcznym — użyj 'Generuj wiadomości'.",
        no_pending_steps: "Brak kroków do wysłania (wszystkie wysłane lub za wcześnie na follow-up).",
      };
      showError(errMap[resp.error] || humanizeError(resp.error) || "Nie udało się uruchomić.");
      return;
    }
    await refreshWorkerPanel();
    scheduleRefresh();
  }

  async function stopWorker() {
    btnStop.disabled = true;
    await msg("campaignWorkerStop");
    btnStop.disabled = false;
    await refreshWorkerPanel();
  }

  // ── Tryb reczny: generuj wiadomosci ────────────────────────────────────
  async function generateManual() {
    if (!activeCampaignId) return;
    const count = Math.max(1, Math.min(parseInt(genCountEl && genCountEl.value, 10) || 5, 25));
    btnGenerate.disabled = true;
    btnGenerate.textContent = "Generuję…";
    const resp = await msg("campaignGenerateBatch", { campaignId: activeCampaignId, count });
    btnGenerate.disabled = false;
    btnGenerate.textContent = "Generuj wiadomości";
    if (!resp.success) {
      showError(humanizeError(resp.error) || "Nie udało się wygenerować.");
      return;
    }
    if (!resp.generated || !resp.generated.length) {
      manualResult.innerHTML = '<p class="muted">Brak kontaktów gotowych do wysłania (wszystkie wysłane lub za wcześnie na follow-up).</p>';
      manualResult.classList.remove("hidden");
      await loadCampaigns();
      return;
    }
    renderManualResults(resp.generated);
    await loadCampaigns();
  }

  // Podpina "Regeneruj" do kart w kontenerze (dry-run i tryb reczny wspoldziela).
  // Karta = najblizszy [data-slug], ma <textarea> + data-step.
  function wireRegen(container) {
    container.querySelectorAll(".cw-regen").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-slug]");
        const ta = card && card.querySelector("textarea");
        if (!ta) return;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = "Generuję…";
        const resp = await msg("campaignRegenerateOne", {
          campaignId: activeCampaignId,
          slug: card.dataset.slug,
          stepNum: parseInt(card.dataset.step, 10),
        });
        btn.disabled = false;
        btn.textContent = orig;
        if (resp.success && resp.message) {
          ta.value = resp.message;
        } else {
          showError(humanizeError(resp.error) || "Nie udało się zregenerować.");
        }
      });
    });
  }

  function profileUrlFor(slug) {
    return "https://www.linkedin.com/in/" + encodeURIComponent(slug || "") + "/";
  }

  // Podpina "Wyślij" — wysyłka jednej wiadomości przez LinkedIn DOM (jak worker, na klik).
  function wireSend(container) {
    container.querySelectorAll(".cw-send").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest("[data-slug]");
        const ta = card && card.querySelector("textarea");
        if (!ta) return;
        if (!ta.value.trim()) { showError("Pusta wiadomość — nie wysyłam."); return; }
        if (!confirm("Wysłać tę wiadomość przez LinkedIn?")) return;
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = "Wysyłam…";
        const resp = await msg("campaignSendOne", {
          campaignId: activeCampaignId,
          slug: card.dataset.slug,
          stepNum: parseInt(card.dataset.step, 10),
          text: ta.value,
        });
        if (resp.success) {
          btn.textContent = "Wysłane ✓";
          card.style.opacity = "0.55";
          ta.readOnly = true;
          await loadCampaigns();
        } else {
          btn.disabled = false;
          btn.textContent = orig;
          const map = {
            bulk_connect_active: "Najpierw zatrzymaj 'Dodaj automatycznie'.",
            worker_active: "Zatrzymaj auto-wysyłkę tej kampanii (Stop), zanim wyślesz ręcznie.",
          };
          showError(map[resp.error] || humanizeError(resp.error) || "Nie udało się wysłać.");
        }
      });
    });
  }

  function renderManualResults(items) {
    const rows = items.map((m, i) => `
      <div class="campaign-message-card" data-slug="${escHtml(m.slug)}" data-step="${m.stepNum}" data-index="${i}">
        <div class="campaign-message-card__header">
          <span><a href="${escHtml(profileUrlFor(m.slug))}" target="_blank" rel="noopener"><strong>${escHtml(m.firstName || m.slug)}</strong></a> <span class="muted">· krok ${m.stepNum}</span></span>
        </div>
        <div class="campaign-message-card__body"><textarea class="cw-manual-msg" rows="4">${escHtml(m.message)}</textarea></div>
        <div class="campaign-message-card__actions">
          <button class="btn btn--sm btn--accent cw-send">Wyślij</button>
          <button class="btn btn--sm btn--ghost cw-regen">Regeneruj</button>
          <button class="btn btn--sm btn--ghost cw-manual-copy">Kopiuj</button>
          <a class="btn btn--sm btn--ghost cw-manual-open" href="https://www.linkedin.com/messaging/thread/new/?recipients=${encodeURIComponent(m.slug)}" target="_blank" rel="noopener">Otwórz czat</a>
          <button class="btn btn--sm btn--ghost cw-manual-sent">Oznacz wysłane</button>
        </div>
      </div>`).join("");
    manualResult.innerHTML = `
      <div class="campaign-results__toolbar">
        <strong>Wygenerowano ${items.length}</strong>
        <button id="cw-manual-copy-all" class="btn btn--sm btn--ghost">Kopiuj wszystkie</button>
        <button id="cw-manual-export" class="btn btn--sm btn--ghost">Eksportuj CSV</button>
      </div>
      <div class="campaign-messages">${rows}</div>`;
    manualResult.classList.remove("hidden");

    manualResult.querySelectorAll(".cw-manual-copy").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ta = btn.closest(".campaign-message-card").querySelector(".cw-manual-msg");
        copyText(ta.value, btn);
      });
    });
    manualResult.querySelectorAll(".cw-manual-sent").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".campaign-message-card");
        btn.disabled = true;
        await msg("campaignMarkStepSent", { campaignId: activeCampaignId, slug: card.dataset.slug, stepNum: parseInt(card.dataset.step, 10) });
        card.style.opacity = "0.5";
        btn.textContent = "Wysłane ✓";
        await loadCampaigns();
      });
    });
    const copyAll = document.getElementById("cw-manual-copy-all");
    if (copyAll) copyAll.addEventListener("click", () => {
      const all = items.map((m) => `${m.firstName} (${m.slug}):\n${m.message}`).join("\n\n———\n\n");
      copyText(all, copyAll);
    });
    const exportBtn = document.getElementById("cw-manual-export");
    if (exportBtn) exportBtn.addEventListener("click", () => exportManualCsv(items));
    wireRegen(manualResult);
    wireSend(manualResult);
  }

  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = "Skopiowano ✓";
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }
    }).catch(() => showError("Nie udało się skopiować do schowka."));
  }

  function exportManualCsv(items) {
    const esc = (s) => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
    const head = ["first_name", "slug", "step", "message"].join(",");
    const body = items.map((m) => [esc(m.firstName), esc(m.slug), m.stepNum, esc(m.message)].join(",")).join("\r\n");
    const blob = new Blob([head + "\r\n" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kampania-wiadomosci.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function humanizeError(err) {
    if (!err) return "";
    const map = {
      no_api_key: "Brak hasła dostępu. Wpisz je w ustawieniach rozszerzenia (popup → ⚙).",
      not_found: "Nie znaleziono kampanii.",
    };
    if (map[err]) return map[err];
    if (/min_length|at least 10/i.test(err)) return "Opis programu i kontekst autora muszą mieć min. 10 znaków (wymagane dla trybu AI).";
    return String(err);
  }

  let refreshTimer = null;
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      await loadCampaigns();
      const worker = (await msg("getCampaignWorkerState")).worker || {};
      if (worker.active && worker.activeCampaignId === activeCampaignId) {
        scheduleRefresh();
      }
    }, 30000);
  }

  // ── Tworzenie nowej kampanii ──────────────────────────────────────────
  function addStepToUI(stepNum, template, delayDays, mode) {
    const div = document.createElement("div");
    div.className = "cw-step";
    div.dataset.stepNum = stepNum;
    const isAi = mode === "ai";
    div.innerHTML = `
      <div class="cw-step__header">
        <strong>Krok ${stepNum}</strong>
        ${stepNum > 1 ? `<label class="cw-step__delay">po <input type="number" class="cw-delay-input" value="${delayDays || 3}" min="1" max="30" style="width:50px"> dniach</label>` : "<span class='muted'>wysyłany od razu</span>"}
        <span class="cw-step__mode">
          <label><input type="radio" name="cw-mode-${stepNum}" value="template" ${isAi ? "" : "checked"}> szablon</label>
          <label><input type="radio" name="cw-mode-${stepNum}" value="ai" ${isAi ? "checked" : ""}> AI</label>
        </span>
        <button class="btn btn--sm btn--ghost cw-remove-step" data-step="${stepNum}">Usuń</button>
      </div>
      <textarea class="cw-template ${isAi ? "hidden" : ""}" rows="3" placeholder="Cześć [Imię], chciałem/am się podzielić...">${escHtml(template || "")}</textarea>
      <p class="cw-step__tokens muted ${isAi ? "hidden" : ""}">Podstawienia z Connections.csv: <code>[Imię]</code> <code>[Nazwisko]</code> <code>[Firma]</code> <code>[Stanowisko]</code> — puste, jeśli brak danych dla kontaktu.</p>
      <p class="cw-step__ai-hint muted ${isAi ? "" : "hidden"}">Treść wygeneruje AI z briefu powyżej (Cel + Opis + Kontekst), osobno dla każdego kontaktu.</p>`;
    stepsListEl.appendChild(div);
    div.querySelector(".cw-remove-step").addEventListener("click", () => {
      div.remove();
      syncStepsFromUI();
      updateBriefVisibility();
    });
    div.querySelectorAll(`input[name="cw-mode-${stepNum}"]`).forEach((radio) => {
      radio.addEventListener("change", () => {
        const ai = div.querySelector(`input[name="cw-mode-${stepNum}"][value="ai"]`).checked;
        div.querySelector(".cw-template").classList.toggle("hidden", ai);
        div.querySelector(".cw-step__ai-hint").classList.toggle("hidden", !ai);
        const tk = div.querySelector(".cw-step__tokens");
        if (tk) tk.classList.toggle("hidden", ai);
        updateBriefVisibility();
        checkSaveEnabled();
      });
    });
  }

  function readStepsFromUI() {
    const steps = [];
    stepsListEl.querySelectorAll(".cw-step").forEach((el, idx) => {
      const stepNum = idx + 1;
      const template = (el.querySelector(".cw-template") || {}).value || "";
      const delayInput = el.querySelector(".cw-delay-input");
      const delayDays = delayInput ? parseInt(delayInput.value, 10) || 0 : 0;
      const aiRadio = el.querySelector(`.cw-step__mode input[value="ai"]`);
      const mode = aiRadio && aiRadio.checked ? "ai" : "template";
      steps.push({ stepNum, template, delayDays, mode });
    });
    return steps;
  }

  function syncStepsFromUI() {
    pendingSteps = readStepsFromUI();
    // Renumeruj naglowki + name atrybuty radio (po usunieciu kroku).
    stepsListEl.querySelectorAll(".cw-step").forEach((el, idx) => {
      const n = idx + 1;
      const header = el.querySelector("strong");
      if (header) header.textContent = `Krok ${n}`;
      el.dataset.stepNum = n;
    });
    checkSaveEnabled();
  }

  function anyAiStep() {
    return Array.from(stepsListEl.querySelectorAll(`.cw-step__mode input[value="ai"]`)).some((r) => r.checked);
  }

  function updateBriefVisibility() {
    briefEl.classList.toggle("hidden", !anyAiStep());
  }

  // Gotowe briefy — klik wypelnia cel/opis/kontekst/notke. Dopisz wlasne tutaj.
  const CAMPAIGN_PRESETS = [
    {
      label: "Profilówka",
      goal: "info",
      product: "profilowka.pl — autorski, polski portal, który z kilku selfie tworzy profesjonalne zdjęcie profilowe, bez fotografa i sesji, w kilkanaście minut. Już dostępny: https://profilowka.pl",
      author: "Jestem autorem profilowka.pl. Moje obecne zdjęcie profilowe na LinkedIn jest właśnie z takiej sesji — to działa. Dzielę się tym z osobami, dla których zawodowy wizerunek ma znaczenie.",
      note: "moje zdjęcie profilowe na LinkedIn jest właśnie z profilowka.pl",
    },
    {
      label: "Rekrutacja OVB",
      goal: "recruitment",
      product: "Współpraca w OVB Allfinanz — niezależne doradztwo finansowe jako własny biznes: elastyczny czas, pełne szkolenia i ścieżka rozwoju, dochód oparty na efektach, wsparcie zespołu od pierwszego dnia.",
      author: "Buduję zespół w OVB. Szukam osób, które chcą rozwijać się w doradztwie finansowym — niekoniecznie z branży; liczy się kontakt z ludźmi, ambicja i otwartość na naukę.",
      note: "",
    },
  ];

  function applyPreset(p) {
    if (!p) return;
    if (goalEl) goalEl.value = p.goal || "info";
    if (productEl) productEl.value = p.product || "";
    if (authorEl) authorEl.value = p.author || "";
    if (noteEl) noteEl.value = p.note || "";
    checkSaveEnabled();
  }

  function renderBriefPresets() {
    if (!briefPresetsEl) return;
    briefPresetsEl.innerHTML = CAMPAIGN_PRESETS
      .map((p, i) => `<button type="button" class="btn btn--sm btn--ghost cw-preset" data-i="${i}">${escHtml(p.label)}</button>`)
      .join("");
    briefPresetsEl.querySelectorAll(".cw-preset").forEach((btn) => {
      btn.addEventListener("click", () => applyPreset(CAMPAIGN_PRESETS[parseInt(btn.dataset.i, 10)]));
    });
  }

  function briefValid() {
    if (!anyAiStep()) return true; // brief niewymagany gdy zero krokow AI
    return (productEl.value || "").trim().length >= 10 && (authorEl.value || "").trim().length >= 10;
  }

  function checkSaveEnabled() {
    const hasName = (nameInput.value || "").trim().length > 0;
    const stepEls = Array.from(stepsListEl.querySelectorAll(".cw-step"));
    // Kazdy krok: szablon wymaga niepustej tresci; AI wymaga waznego briefu.
    const stepsOk = stepEls.length > 0 && stepEls.every((el) => {
      const ai = el.querySelector(`.cw-step__mode input[value="ai"]`);
      if (ai && ai.checked) return true;
      const ta = el.querySelector(".cw-template");
      return ta && (ta.value || "").trim().length > 0;
    });
    const hasContacts = pendingContacts.length > 0;
    btnSave.disabled = !(hasName && stepsOk && hasContacts && briefValid());
  }

  // ── Import kontaktow: baza profili ─────────────────────────────────────
  async function importFromDb() {
    btnImportDb.disabled = true;
    btnImportDb.textContent = "Ładuję…";
    const dbResp = await msg("campaignScrapeConnections");
    btnImportDb.disabled = false;
    btnImportDb.textContent = "Załaduj z bazy profili";
    if (!dbResp.success || !dbResp.contacts || !dbResp.contacts.length) {
      showError("Baza profili jest pusta. Zaimportuj kontakty w sekcji 'Baza profili' poniżej albo wgraj Connections.csv.");
      return;
    }
    setPendingContacts(dbResp.contacts.map((c) => ({
      slug: c.contact_id,
      firstName: c.first_name || "Kontakt",
      lastName: c.last_name || "",
      headline: c.headline || "",
      company: c.company || "",
      position: c.headline || "",
      location: c.location || "",
      profileUrl: c.profile_url || "",
      status: "pending",
      steps: {},
      repliedAt: null,
    })));
  }

  // ── Import kontaktow: Connections.csv ──────────────────────────────────
  function parseCsvLine(line) {
    const result = [];
    let current = "", inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
      else current += ch;
    }
    result.push(current);
    return result;
  }

  function parseConnectionsCsv(text) {
    const lines = text.split(/\r?\n/);
    const contacts = [];
    const seen = new Set(); // dedup po slug — nie wysylaj dwa razy do tej samej osoby
    let headerFound = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (!headerFound) {
        if (line.toLowerCase().startsWith("first name")) headerFound = true;
        continue;
      }
      const fields = parseCsvLine(line);
      if (fields.length < 3) continue;
      const firstName = (fields[0] || "").trim();
      const lastName = (fields[1] || "").trim();
      const url = (fields[2] || "").trim();
      const company = (fields[4] || "").trim();
      const position = (fields[5] || "").trim();
      if (!firstName || !url) continue;
      const slugMatch = url.match(/\/in\/([^/?#]+)/);
      const slug = slugMatch ? slugMatch[1].toLowerCase() : url.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
      if (seen.has(slug)) continue;
      seen.add(slug);
      const headline = [position, company].filter(Boolean).join(" — ") || position || company || "";
      contacts.push({
        slug,
        firstName,
        lastName,
        headline,
        company,
        position,
        location: "",
        profileUrl: url,
        status: "pending",
        steps: {},
        repliedAt: null,
      });
    }
    return contacts;
  }

  function handleCsvFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseConnectionsCsv(reader.result);
        if (!parsed.length) {
          showError("Nie znaleziono kontaktów. Czy to na pewno Connections.csv (nagłówek 'First Name,Last Name,URL,...')?");
          return;
        }
        setPendingContacts(parsed);
      } catch (err) {
        showError("Błąd parsowania CSV: " + err.message);
      }
    };
    reader.onerror = () => showError("Błąd odczytu pliku CSV.");
    reader.readAsText(file, "UTF-8");
  }

  function setPendingContacts(list) {
    pendingContacts = list;
    contactsCountEl.textContent = `${pendingContacts.length} kontaktów`;
    checkSaveEnabled();
  }

  // ── Zapis kampanii ─────────────────────────────────────────────────────
  async function saveCampaign() {
    syncStepsFromUI();
    const name = (nameInput.value || "").trim();
    if (!name || !pendingSteps.length || !pendingContacts.length) return;
    if (!briefValid()) {
      showError("Tryb AI wymaga briefu: opis programu i kontekst autora (min. 10 znaków każdy).");
      return;
    }
    const sendMode = getSendMode();
    const hasAi = pendingSteps.some((s) => s.mode === "ai");
    const brief = hasAi ? {
      campaignGoal: goalEl.value || "info",
      productDescription: (productEl.value || "").trim(),
      authorContext: (authorEl.value || "").trim(),
      authorNote: (noteEl.value || "").trim(),
    } : null;

    btnSave.disabled = true;
    const resp = await msg("createCampaign", {
      name,
      brief,
      steps: pendingSteps,
      contacts: pendingContacts,
      config: { dailyCap: 25, delayMin: 45, delayMax: 120, workingHoursStart: 9, workingHoursEnd: 18, sendMode },
    });
    btnSave.disabled = false;
    if (!resp.success) {
      showError(humanizeError(resp.error) || "Błąd zapisu kampanii.");
      return;
    }
    // Reset formularza.
    nameInput.value = "";
    stepsListEl.innerHTML = "";
    if (productEl) productEl.value = "";
    if (authorEl) authorEl.value = "";
    if (noteEl) noteEl.value = "";
    pendingContacts = [];
    pendingSteps = [];
    contactsCountEl.textContent = "0 kontaktów";
    updateBriefVisibility();
    const det = document.getElementById("cw-new-campaign");
    if (det) det.removeAttribute("open");
    activeCampaignId = resp.campaign.id;
    await loadCampaigns();
  }

  // ── Event listeners ───────────────────────────────────────────────────
  btnAddStep.addEventListener("click", () => {
    syncStepsFromUI();
    const nextNum = pendingSteps.length + 1;
    addStepToUI(nextNum, "", nextNum > 1 ? 3 : 0, "template");
    syncStepsFromUI();
    updateBriefVisibility();
  });

  btnImportDb.addEventListener("click", importFromDb);
  if (csvInput) csvInput.addEventListener("change", (e) => handleCsvFile(e.target.files && e.target.files[0]));
  btnSave.addEventListener("click", saveCampaign);
  nameInput.addEventListener("input", checkSaveEnabled);
  [productEl, authorEl].forEach((el) => { if (el) el.addEventListener("input", checkSaveEnabled); });
  document.querySelectorAll('input[name="cw-sendmode"]').forEach((r) => r.addEventListener("change", () => {}));
  btnDryRun.addEventListener("click", runDryRun);
  btnGenerate.addEventListener("click", generateManual);
  btnStart.addEventListener("click", startWorker);
  btnStop.addEventListener("click", stopWorker);

  // ── Init ──────────────────────────────────────────────────────────────
  // Domyslnie 1 krok (szablon) zeby formularz nie byl pusty.
  renderBriefPresets();
  addStepToUI(1, "", 0, "template");
  syncStepsFromUI();
  updateBriefVisibility();
  loadCampaigns();

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.campaignWorker || changes.campaigns) {
      loadCampaigns();
    }
  });
})();
