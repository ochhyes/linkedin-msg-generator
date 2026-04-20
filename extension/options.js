/**
 * Options page controller.
 *
 * Flow:
 *  1. Load user settings from chrome.storage.sync (fallback: local).
 *  2. Fetch defaults from backend /api/settings/defaults (via background).
 *     Defaults are shown as placeholders; values stay empty until user edits.
 *  3. Save on button click. Empty fields = backend uses defaults.
 */
(() => {
  "use strict";

  const GOALS = ["recruitment", "networking", "sales", "followup"];
  const GOAL_LABELS = {
    recruitment: "Rekrutacji",
    networking: "Networkingu",
    sales: "Sprzedaży",
    followup: "Follow-upu",
  };
  const MAX_GOOD_EXAMPLES = 5;

  // ── State ──────────────────────────────────────────────────────────
  let defaults = null;           // fetched from backend
  let userSettings = emptySettings();
  let activeGoal = "recruitment";

  function emptySettings() {
    return {
      senderStyleSample: "",
      customExamples: {},          // { goal: { examplesGood: [...], exampleBad: {...} } }
      customAntipatterns: [],
      customSystemPrompt: "",
    };
  }

  // ── DOM refs ───────────────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const el = {
    styleSample: $("#sender-style-sample"),
    styleCounter: $("#style-counter"),
    styleWarn: $("#style-warn"),
    tabs: document.querySelectorAll(".tab"),
    panel: $("#examples-panel"),
    btnResetGoal: $("#btn-reset-goal"),
    defaultAntipatterns: $("#default-antipatterns"),
    customAntipatterns: $("#custom-antipatterns"),
    btnAddAntipattern: $("#btn-add-antipattern"),
    sysPrompt: $("#custom-system-prompt"),
    sysPromptCounter: $("#sysprompt-counter"),
    btnShowDefaultSysprompt: $("#btn-show-default-sysprompt"),
    defaultSyspromptPreview: $("#default-sysprompt-preview"),
    btnSave: $("#btn-save"),
    btnResetAll: $("#btn-reset-all"),
    toast: $("#toast"),
  };

  // ── Storage helpers (sync with fallback to local) ──────────────────
  async function storageGet(key) {
    try {
      const s = await chrome.storage.sync.get(key);
      if (s && s[key] !== undefined) return s[key];
    } catch (e) { /* sync unavailable */ }
    try {
      const l = await chrome.storage.local.get(key);
      return l[key];
    } catch (e) {
      return undefined;
    }
  }

  async function storageSet(key, value) {
    try {
      await chrome.storage.sync.set({ [key]: value });
      return true;
    } catch (e) {
      try {
        await chrome.storage.local.set({ [key]: value });
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  // ── Backend via background worker ──────────────────────────────────
  function sendToBackground(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  async function fetchDefaults() {
    try {
      return await sendToBackground({ action: "getSettingsDefaults" });
    } catch (e) {
      console.warn("[Options] Nie udało się pobrać domyślnych:", e.message);
      return null;
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────

  function renderExamplesPanel() {
    const goal = activeGoal;
    const defaultGoal = defaults?.goal_prompts?.[goal] || { examples_good: [], example_bad: null };
    const custom = userSettings.customExamples[goal] || {};

    // If user has customExamples for this goal, show those; otherwise render empty
    // slots with defaults as placeholders.
    const good = custom.examplesGood && custom.examplesGood.length
      ? custom.examplesGood
      : [];
    const bad = custom.exampleBad || null;

    let html = `
      <div class="examples-good-section">
        <h3>Przykłady DOBRE dla ${GOAL_LABELS[goal]}</h3>
    `;

    const goodToRender = good.length > 0
      ? good
      : defaultGoal.examples_good.map(() => ({ profile: "", message: "" }));

    goodToRender.forEach((ex, i) => {
      const defaultEx = defaultGoal.examples_good[i] || { profile: "", message: "" };
      html += renderExampleItem({
        type: "good",
        index: i,
        profile: ex.profile,
        message: ex.message,
        placeholderProfile: defaultEx.profile,
        placeholderMessage: defaultEx.message,
      });
    });

    html += `
        <button class="btn btn-ghost" id="btn-add-good" ${goodToRender.length >= MAX_GOOD_EXAMPLES ? 'disabled' : ''}>+ Dodaj dobry przykład</button>
      </div>

      <div class="example-bad-section" style="margin-top:20px;">
        <h3>Przykład ZŁY dla ${GOAL_LABELS[goal]}</h3>
    `;

    const badMsg = bad?.message || "";
    const badWhy = bad?.why || "";
    const defaultBadMsg = defaultGoal.example_bad?.message || "";
    const defaultBadWhy = defaultGoal.example_bad?.why || "";

    html += renderExampleItem({
      type: "bad",
      index: 0,
      profile: null,
      message: badMsg,
      why: badWhy,
      placeholderMessage: defaultBadMsg,
      placeholderWhy: defaultBadWhy,
    });
    html += `</div>`;

    el.panel.innerHTML = html;

    // Wire up event listeners for newly rendered elements
    el.panel.querySelectorAll("[data-field]").forEach((input) => {
      input.addEventListener("input", onExampleEdit);
    });
    el.panel.querySelectorAll(".remove[data-type='good']").forEach((btn) => {
      btn.addEventListener("click", () => removeGoodExample(parseInt(btn.dataset.index, 10)));
    });
    const btnAddGood = $("#btn-add-good");
    if (btnAddGood) btnAddGood.addEventListener("click", addGoodExample);
  }

  function renderExampleItem({ type, index, profile, message, why, placeholderProfile, placeholderMessage, placeholderWhy }) {
    const titleClass = type === "bad" ? "title bad" : "title";
    const titleText = type === "bad" ? `Zły przykład` : `Dobry przykład #${index + 1}`;
    const removeBtn = type === "good"
      ? `<button class="remove" data-type="good" data-index="${index}" title="Usuń">Usuń</button>`
      : '';

    let body = "";
    if (type === "good") {
      body = `
        <label>Profil odbiorcy (krótki opis)</label>
        <textarea rows="2" maxlength="500" data-field="profile" data-type="good" data-index="${index}"
                  placeholder="${escapeHtml(placeholderProfile || "")}">${escapeHtml(profile || "")}</textarea>
        <label>Wiadomość</label>
        <textarea rows="4" maxlength="500" data-field="message" data-type="good" data-index="${index}"
                  placeholder="${escapeHtml(placeholderMessage || "")}">${escapeHtml(message || "")}</textarea>
      `;
    } else {
      body = `
        <label>Wiadomość (zła)</label>
        <textarea rows="4" maxlength="500" data-field="message" data-type="bad" data-index="0"
                  placeholder="${escapeHtml(placeholderMessage || "")}">${escapeHtml(message || "")}</textarea>
        <label>Dlaczego jest zła</label>
        <textarea rows="2" maxlength="500" data-field="why" data-type="bad" data-index="0"
                  placeholder="${escapeHtml(placeholderWhy || "")}">${escapeHtml(why || "")}</textarea>
      `;
    }

    return `
      <div class="example-item">
        <header>
          <span class="${titleClass}">${titleText}</span>
          ${removeBtn}
        </header>
        ${body}
      </div>
    `;
  }

  function renderDefaultAntipatterns() {
    const list = defaults?.default_antipatterns || [];
    el.defaultAntipatterns.innerHTML = list.length
      ? list.map((p) => `<li>${escapeHtml(p)}</li>`).join("")
      : `<li class="muted">Brak (backend niedostępny)</li>`;
  }

  function renderCustomAntipatterns() {
    el.customAntipatterns.innerHTML = userSettings.customAntipatterns
      .map((p, i) => `
        <li>
          <input type="text" value="${escapeHtml(p)}" maxlength="300" data-idx="${i}">
          <button data-idx="${i}" title="Usuń">×</button>
        </li>
      `).join("");

    el.customAntipatterns.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        userSettings.customAntipatterns[idx] = e.target.value;
      });
    });
    el.customAntipatterns.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        userSettings.customAntipatterns.splice(idx, 1);
        renderCustomAntipatterns();
      });
    });
  }

  // ── Event handlers ─────────────────────────────────────────────────

  function onExampleEdit(e) {
    const { field, type, index } = e.target.dataset;
    const i = parseInt(index, 10);
    const goal = activeGoal;

    if (!userSettings.customExamples[goal]) {
      userSettings.customExamples[goal] = { examplesGood: [], exampleBad: null };
    }
    const entry = userSettings.customExamples[goal];

    if (type === "good") {
      // Ensure array has the slot
      while (entry.examplesGood.length <= i) {
        entry.examplesGood.push({ profile: "", message: "" });
      }
      entry.examplesGood[i][field] = e.target.value;
    } else {
      if (!entry.exampleBad) entry.exampleBad = { message: "", why: "" };
      entry.exampleBad[field] = e.target.value;
    }
  }

  function addGoodExample() {
    const goal = activeGoal;
    if (!userSettings.customExamples[goal]) {
      userSettings.customExamples[goal] = { examplesGood: [], exampleBad: null };
    }
    const entry = userSettings.customExamples[goal];

    // If no custom yet, first seed with existing defaults so user sees them editable
    if (entry.examplesGood.length === 0) {
      const defaultGood = defaults?.goal_prompts?.[goal]?.examples_good || [];
      entry.examplesGood = defaultGood.map((e) => ({ profile: e.profile, message: e.message }));
    }

    if (entry.examplesGood.length >= MAX_GOOD_EXAMPLES) return;
    entry.examplesGood.push({ profile: "", message: "" });
    renderExamplesPanel();
  }

  function removeGoodExample(index) {
    const goal = activeGoal;
    const entry = userSettings.customExamples[goal];
    if (!entry || !entry.examplesGood) return;
    if (entry.examplesGood.length <= 1) {
      toast("Musi zostać co najmniej 1 dobry przykład. Użyj 'Przywróć domyślne dla tego celu' aby zacząć od nowa.", "error");
      return;
    }
    entry.examplesGood.splice(index, 1);
    renderExamplesPanel();
  }

  function resetActiveGoal() {
    if (!confirm(`Przywrócić domyślne przykłady dla celu: ${GOAL_LABELS[activeGoal]}?`)) return;
    delete userSettings.customExamples[activeGoal];
    renderExamplesPanel();
    toast(`Przywrócono domyślne dla: ${GOAL_LABELS[activeGoal]}`);
  }

  function resetAll() {
    if (!confirm("Na pewno chcesz zresetować CAŁĄ personalizację do domyślnej? Tego nie da się cofnąć.")) return;
    userSettings = emptySettings();
    applyToUI();
    toast("Wszystko zresetowane. Kliknij 'Zapisz' aby zatwierdzić.");
  }

  async function save() {
    // Validation
    if (el.styleSample.value.length > 1000) {
      toast("Próbka stylu przekracza 1000 znaków.", "error");
      return;
    }
    if (el.sysPrompt.value.length > 2000) {
      toast("System prompt przekracza 2000 znaków.", "error");
      return;
    }

    // Collect current UI state
    userSettings.senderStyleSample = el.styleSample.value.trim();
    userSettings.customSystemPrompt = el.sysPrompt.value.trim();
    userSettings.customAntipatterns = userSettings.customAntipatterns
      .map((p) => (p || "").trim())
      .filter(Boolean);

    // Strip empty custom examples (rows where both profile and message are empty)
    for (const goal of GOALS) {
      const entry = userSettings.customExamples[goal];
      if (!entry) continue;
      if (entry.examplesGood) {
        entry.examplesGood = entry.examplesGood.filter(
          (e) => (e.profile || "").trim() || (e.message || "").trim()
        );
        if (entry.examplesGood.length === 0) delete entry.examplesGood;
      }
      if (entry.exampleBad) {
        const { message, why } = entry.exampleBad;
        if (!(message || "").trim() && !(why || "").trim()) {
          delete entry.exampleBad;
        }
      }
      if (!entry.examplesGood && !entry.exampleBad) {
        delete userSettings.customExamples[goal];
      }
    }

    const ok = await storageSet("userSettings", userSettings);
    if (ok) {
      toast("Zapisano. Kolejna wygenerowana wiadomość użyje nowych ustawień.");
    } else {
      toast("Nie udało się zapisać ustawień.", "error");
    }
  }

  function applyToUI() {
    el.styleSample.value = userSettings.senderStyleSample || "";
    el.sysPrompt.value = userSettings.customSystemPrompt || "";
    updateCounter(el.styleSample, el.styleCounter, 1000, el.styleWarn);
    updateCounter(el.sysPrompt, el.sysPromptCounter, 2000);
    renderCustomAntipatterns();
    renderExamplesPanel();
  }

  function updateCounter(textarea, counterEl, limit, warnEl) {
    const n = textarea.value.length;
    counterEl.textContent = `${n} / ${limit} znaków`;
    if (warnEl) {
      if (n > limit) warnEl.classList.remove("hidden");
      else warnEl.classList.add("hidden");
    }
  }

  function toast(msg, type = "success") {
    el.toast.textContent = msg;
    el.toast.className = `toast ${type === "error" ? "error" : ""}`;
    el.toast.classList.remove("hidden");
    setTimeout(() => el.toast.classList.add("hidden"), 3000);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Init ───────────────────────────────────────────────────────────
  (async () => {
    // Parallel: load user settings & fetch defaults
    const [loaded, fetched] = await Promise.all([
      storageGet("userSettings"),
      fetchDefaults(),
    ]);

    if (loaded) userSettings = { ...emptySettings(), ...loaded };
    defaults = fetched;

    renderDefaultAntipatterns();
    applyToUI();

    // Wire up tabs
    el.tabs.forEach((t) => {
      t.addEventListener("click", () => {
        el.tabs.forEach((x) => x.classList.remove("active"));
        t.classList.add("active");
        activeGoal = t.dataset.goal;
        renderExamplesPanel();
      });
    });

    // Counters
    el.styleSample.addEventListener("input", () =>
      updateCounter(el.styleSample, el.styleCounter, 1000, el.styleWarn)
    );
    el.sysPrompt.addEventListener("input", () =>
      updateCounter(el.sysPrompt, el.sysPromptCounter, 2000)
    );

    // Collapsibles
    document.querySelectorAll(".collapsible-head").forEach((head) => {
      head.addEventListener("click", () => {
        const target = document.getElementById(head.dataset.target);
        if (!target) return;
        const isOpen = !target.classList.contains("hidden");
        if (isOpen) {
          target.classList.add("hidden");
          head.classList.remove("open");
        } else {
          target.classList.remove("hidden");
          head.classList.add("open");
        }
      });
    });

    // Buttons
    el.btnResetGoal.addEventListener("click", resetActiveGoal);
    el.btnAddAntipattern.addEventListener("click", () => {
      userSettings.customAntipatterns.push("");
      renderCustomAntipatterns();
    });
    el.btnSave.addEventListener("click", save);
    el.btnResetAll.addEventListener("click", resetAll);
    el.btnShowDefaultSysprompt.addEventListener("click", () => {
      if (!defaults) { toast("Brak połączenia z backendem.", "error"); return; }
      el.defaultSyspromptPreview.textContent = defaults.default_system_prompt || "";
      el.defaultSyspromptPreview.classList.toggle("hidden");
    });
  })();
})();
