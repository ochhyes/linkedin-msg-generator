/**
 * Dashboard Campaign Worker UI (#74 v2.2.0)
 *
 * Obsluguje sekcje "Kampania sekwencyjna" w dashboard.html.
 * Komunikuje sie z background.js przez chrome.runtime.sendMessage.
 * Zarzadza kampaniami: tworzenie, lista, dry-run, start/stop workera,
 * import kontaktow z profileDb, oznaczanie odpowiedzi.
 */
(() => {
  "use strict";

  // ── DOM refs ──────────────────────────────────────────────────────────
  const campaignsList = document.getElementById("cw-campaigns-list");
  const nameInput = document.getElementById("cw-name");
  const stepsListEl = document.getElementById("cw-steps-list");
  const btnAddStep = document.getElementById("cw-add-step");
  const btnImportDb = document.getElementById("cw-import-from-db");
  const contactsCountEl = document.getElementById("cw-contacts-count");
  const btnSave = document.getElementById("cw-save-campaign");
  const workerPanel = document.getElementById("cw-worker-panel");
  const workerBadge = document.getElementById("cw-worker-badge");
  const workerLine = document.getElementById("cw-worker-line");
  const btnDryRun = document.getElementById("cw-btn-dryrun");
  const btnStart = document.getElementById("cw-btn-start");
  const btnStop = document.getElementById("cw-btn-stop");
  const dryRunResult = document.getElementById("cw-dryrun-result");
  const errorMsg = document.getElementById("cw-error-msg");

  // ── State ──────────────────────────────────────────────────────────────
  let pendingContacts = []; // bufor kontaktow do nowej kampanii
  let pendingSteps = [];    // bufor krokow do nowej kampanii (stepNum, template, delayDays)
  let activeCampaignId = null; // aktualnie wybrana kampania
  let allCampaigns = [];
  let stepCounter = 0;

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
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function showError(text) {
    errorMsg.textContent = text;
    errorMsg.classList.remove("hidden");
    setTimeout(() => errorMsg.classList.add("hidden"), 6000);
  }

  function formatDate(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
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
      return `
        <div class="cw-campaign-card ${isSelected ? "cw-campaign-card--selected" : ""}" data-id="${escHtml(c.id)}">
          <div class="cw-campaign-card__header">
            <strong>${escHtml(c.name)}</strong>
            <span class="muted">${c.steps ? c.steps.length : 0} kroków · ${total} kontaktów · ${sent} wysłano · ${replied} odpowiedziało</span>
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
  }

  function renderContactsTable(campaign) {
    const contacts = campaign.contacts || [];
    if (!contacts.length) return '<p class="muted" style="margin-top:8px">Brak kontaktów w kampanii.</p>';
    const steps = campaign.steps || [];
    const stepHeaders = steps.map((s) => `<th>Krok ${s.stepNum}<br><span class="muted">${s.delayDays ? "+" + s.delayDays + "d" : "start"}</span></th>`).join("");
    const rows = contacts.map((c) => {
      const stepCells = steps.map((s) => {
        const st = (c.steps || {})[String(s.stepNum)] || {};
        let cls = "", label = "—";
        if (st.status === "sent") { cls = "cw-sent"; label = formatDate(st.sentAt); }
        else if (st.status === "failed") { cls = "cw-failed"; label = "Błąd"; }
        else if (st.status === "pending") { cls = ""; label = "oczekuje"; }
        return `<td class="${cls}">${label}</td>`;
      }).join("");
      const repliedCell = c.repliedAt
        ? `<td class="cw-replied">Tak (${formatDate(c.repliedAt)})</td>`
        : `<td><button class="btn btn--sm btn--ghost cw-btn-mark-replied" data-campaign="${escHtml(campaign.id)}" data-slug="${escHtml(c.slug)}">Oznacz</button></td>`;
      return `<tr><td>${escHtml(c.firstName || c.slug)}</td>${stepCells}${repliedCell}</tr>`;
    }).join("");
    return `
      <div class="cw-contacts-table-wrap">
        <table class="contacts-table cw-contacts-table">
          <thead><tr><th>Kontakt</th>${stepHeaders}<th>Odpowiedź</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  async function selectCampaign(id) {
    activeCampaignId = id;
    renderCampaignsList();
    await refreshWorkerPanel();
    workerPanel.classList.remove("hidden");
    dryRunResult.classList.add("hidden");
  }

  async function deleteCampaign(id) {
    const worker = (await msg("getCampaignWorkerState")).worker || {};
    if (worker.active && worker.activeCampaignId === id) {
      showError("Zatrzymaj kampanię przed usunięciem.");
      return;
    }
    if (!confirm("Usuąć kampanię? Tej operacji nie można cofnąć.")) return;
    await msg("deleteCampaign", { id });
    if (activeCampaignId === id) activeCampaignId = null;
    await loadCampaigns();
  }

  async function markReplied(campaignId, slug) {
    await msg("campaignMarkReplied", { campaignId, slug });
    await loadCampaigns();
  }

  // ── Worker panel ───────────────────────────────────────────────────────
  async function refreshWorkerPanel() {
    if (!activeCampaignId) {
      workerPanel.classList.add("hidden");
      return;
    }
    const resp = await msg("getCampaignWorkerState");
    const worker = resp.worker || {};
    workerPanel.classList.remove("hidden");

    if (worker.active && worker.activeCampaignId === activeCampaignId) {
      workerBadge.textContent = "Aktywna";
      workerBadge.className = "count-badge count-badge--active";
      workerLine.textContent = `Wysłano dziś: ${worker.sentToday || 0}. Następny tick: ${worker.nextTickAt ? formatDate(worker.nextTickAt) : "—"}`;
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

  // ── Dry-run ───────────────────────────────────────────────────────────
  async function runDryRun() {
    if (!activeCampaignId) return;
    btnDryRun.disabled = true;
    btnDryRun.textContent = "Generuję podgląd…";
    const resp = await msg("campaignDryRun", { campaignId: activeCampaignId });
    btnDryRun.disabled = false;
    btnDryRun.textContent = "Podgląd (dry-run)";
    if (!resp.success || !resp.preview) {
      showError(resp.error || "Błąd podglądu.");
      return;
    }
    if (!resp.preview.length) {
      dryRunResult.innerHTML = '<p class="muted">Brak kontaktów do podglądu.</p>';
    } else {
      dryRunResult.innerHTML = `<p><strong>Podgląd krok 1 dla ${resp.preview.length} kontaktów:</strong></p>` +
        resp.preview.map((p) => `
          <div class="cw-preview-card">
            <div class="cw-preview-card__name">${escHtml(p.firstName)} (${escHtml(p.slug)})</div>
            <div class="cw-preview-card__msg">${escHtml(p.message)}</div>
          </div>`).join("");
    }
    dryRunResult.classList.remove("hidden");
  }

  // ── Start/Stop ────────────────────────────────────────────────────────
  async function startWorker() {
    if (!activeCampaignId) return;
    btnStart.disabled = true;
    const resp = await msg("campaignWorkerStart", { campaignId: activeCampaignId });
    btnStart.disabled = false;
    if (!resp.success) {
      const errMap = {
        bulk_connect_active: "Najpierw zatrzymaj 'Dodaj automatycznie'.",
        campaign_not_found: "Nie znaleziono kampanii.",
        no_pending_steps: "Brak kroków do wysłania (wszystkie wysłane lub za wcześnie na follow-up).",
      };
      showError(errMap[resp.error] || resp.error || "Nie udało się uruchomić.");
      return;
    }
    await refreshWorkerPanel();
    // Auto-refresh co 30s dopoki aktywna
    scheduleRefresh();
  }

  async function stopWorker() {
    btnStop.disabled = true;
    await msg("campaignWorkerStop");
    btnStop.disabled = false;
    await refreshWorkerPanel();
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
  function addStepToUI(stepNum, template, delayDays) {
    stepCounter++;
    const div = document.createElement("div");
    div.className = "cw-step";
    div.dataset.stepNum = stepNum;
    div.innerHTML = `
      <div class="cw-step__header">
        <strong>Krok ${stepNum}</strong>
        ${stepNum > 1 ? `<label class="cw-step__delay">po <input type="number" class="cw-delay-input" value="${delayDays || 3}" min="1" max="30" style="width:50px"> dniach</label>` : "<span class='muted'>wysylany od razu</span>"}
        <button class="btn btn--sm btn--ghost cw-remove-step" data-step="${stepNum}">Usuń</button>
      </div>
      <textarea class="cw-template" rows="4" placeholder="Czesc [Imie], chcialem/am sie podzielic...">${escHtml(template || "")}</textarea>`;
    stepsListEl.appendChild(div);
    div.querySelector(".cw-remove-step").addEventListener("click", () => {
      div.remove();
      syncStepsFromUI();
    });
  }

  function syncStepsFromUI() {
    pendingSteps = [];
    stepsListEl.querySelectorAll(".cw-step").forEach((el, idx) => {
      const stepNum = idx + 1;
      const template = (el.querySelector(".cw-template") || {}).value || "";
      const delayInput = el.querySelector(".cw-delay-input");
      const delayDays = delayInput ? parseInt(delayInput.value, 10) || 0 : 0;
      pendingSteps.push({ stepNum, template, delayDays });
    });
    // Renumber headers
    stepsListEl.querySelectorAll(".cw-step").forEach((el, idx) => {
      const header = el.querySelector("strong");
      if (header) header.textContent = `Krok ${idx + 1}`;
      el.dataset.stepNum = idx + 1;
    });
    checkSaveEnabled();
  }

  function checkSaveEnabled() {
    const hasName = (nameInput.value || "").trim().length > 0;
    // Czytaj bezposrednio z DOM — pendingSteps moze byc niezsynchronizowane.
    const hasSteps = stepsListEl.querySelectorAll(".cw-template").length > 0 &&
      Array.from(stepsListEl.querySelectorAll(".cw-template")).some((el) => (el.value || "").trim().length > 0);
    const hasContacts = pendingContacts.length > 0;
    btnSave.disabled = !(hasName && hasSteps && hasContacts);
  }

  async function importFromDb() {
    btnImportDb.disabled = true;
    btnImportDb.textContent = "Laduje…";
    const dbResp = await msg("campaignScrapeConnections");
    btnImportDb.disabled = false;
    btnImportDb.textContent = "Zaladuj z bazy profili";
    if (!dbResp.success || !dbResp.contacts || !dbResp.contacts.length) {
      showError("Baza profili jest pusta. Zaimportuj kontakty w sekcji 'Baza profili' ponizej.");
      return;
    }
    pendingContacts = dbResp.contacts.map((c) => ({
      slug: c.contact_id,
      firstName: c.first_name || "Kontakt",
      status: "pending",
      steps: {},
      repliedAt: null,
    }));
    contactsCountEl.textContent = `${pendingContacts.length} kontaktow`;
    checkSaveEnabled();
  }

  async function saveCampaign() {
    syncStepsFromUI();
    const name = (nameInput.value || "").trim();
    if (!name || !pendingSteps.length || !pendingContacts.length) return;
    btnSave.disabled = true;
    const resp = await msg("createCampaign", {
      name,
      steps: pendingSteps,
      contacts: pendingContacts,
      config: { dailyCap: 20, delayMin: 45, delayMax: 120, workingHoursStart: 9, workingHoursEnd: 18 },
    });
    btnSave.disabled = false;
    if (!resp.success) {
      showError(resp.error || "Blad zapisu kampanii.");
      return;
    }
    // Reset form
    nameInput.value = "";
    stepsListEl.innerHTML = "";
    pendingContacts = [];
    pendingSteps = [];
    contactsCountEl.textContent = "0 kontaktow";
    document.getElementById("cw-new-campaign").removeAttribute("open");
    activeCampaignId = resp.campaign.id;
    await loadCampaigns();
  }

  // ── Event listeners ───────────────────────────────────────────────────
  btnAddStep.addEventListener("click", () => {
    syncStepsFromUI();
    const nextNum = pendingSteps.length + 1;
    addStepToUI(nextNum, "", nextNum > 1 ? 3 : 0);
    syncStepsFromUI();
  });

  btnImportDb.addEventListener("click", importFromDb);
  btnSave.addEventListener("click", saveCampaign);
  nameInput.addEventListener("input", checkSaveEnabled);
  btnDryRun.addEventListener("click", runDryRun);
  btnStart.addEventListener("click", startWorker);
  btnStop.addEventListener("click", stopWorker);

  // ── Init ──────────────────────────────────────────────────────────────
  loadCampaigns();

  // Refresh przy storage.onChanged (worker state update)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.campaignWorker || changes.campaigns) {
      loadCampaigns();
    }
  });
})();
