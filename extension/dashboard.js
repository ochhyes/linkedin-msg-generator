(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const dueList = $("#due-list");
  const scheduledList = $("#scheduled-list");
  const historyList = $("#history-list");
  const dueCount = $("#due-count");
  const scheduledCount = $("#scheduled-count");
  const historyCount = $("#history-count");
  const dueEmpty = $("#due-empty");
  const scheduledEmpty = $("#scheduled-empty");
  const historyEmpty = $("#history-empty");
  const btnRefresh = $("#btn-refresh");

  // #38 v1.11.0 — stats + contacts table refs.
  const statsSection = $("#stats-section");
  const statsFunnel = $("#stats-funnel");
  const btnRefreshStats = $("#btn-refresh-stats");
  const contactsSection = $("#contacts-list-section");
  const contactsTbody = $("#contacts-tbody");
  const contactsCount = $("#contacts-count");
  const contactsEmpty = $("#contacts-empty");

  // Per-textarea debounce dla auto-save draftów (klucz: slug#N).
  const _draftDebounce = new Map();

  // ── Data load ──────────────────────────────────────────────────────

  async function loadAll() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: "followupListAll" });
      if (!resp?.success) {
        console.warn("[dashboard] followupListAll failed:", resp);
        return;
      }
      renderDue(resp.due || []);
      renderScheduled(resp.scheduled || []);
      renderHistory(resp.history || []);
    } catch (err) {
      console.warn("[dashboard] loadAll failed:", err);
    }
  }

  // ── Due section ────────────────────────────────────────────────────

  function renderDue(items) {
    dueCount.textContent = items.length;
    dueList.querySelectorAll(".row").forEach((el) => el.remove());
    if (items.length === 0) {
      dueEmpty.classList.remove("hidden");
      return;
    }
    dueEmpty.classList.add("hidden");
    for (const item of items) dueList.appendChild(buildDueRow(item));
  }

  function buildDueRow(item) {
    const num = item.dueFollowup === 2 ? 2 : 1;
    const days = num === 2 ? 7 : 3;
    const li = document.createElement("div");
    li.className = "row";
    li.dataset.slug = item.slug;
    li.dataset.followupNum = String(num);

    const head = document.createElement("div");
    head.className = "row__head";
    const nameEl = document.createElement("strong");
    nameEl.className = "row__name";
    const nameLink = document.createElement("a");
    nameLink.href = `https://www.linkedin.com/in/${encodeURIComponent(item.slug)}/`;
    nameLink.target = "_blank";
    nameLink.rel = "noopener noreferrer";
    nameLink.textContent = item.name || item.slug;
    nameEl.appendChild(nameLink);
    head.appendChild(nameEl);

    const tag = document.createElement("span");
    tag.className = `row__tag row__tag--fu${num}`;
    tag.textContent = `Follow-up #${num} (${days}d po wysłaniu)`;
    head.appendChild(tag);
    li.appendChild(head);

    if (item.headline) {
      const hl = document.createElement("p");
      hl.className = "row__headline";
      hl.textContent = item.headline;
      li.appendChild(hl);
    }

    const meta = document.createElement("p");
    meta.className = "row__meta";
    meta.textContent = `Wiadomość wysłana ${item.daysSinceSent} dni temu (${formatDate(item.messageSentAt)})`;
    li.appendChild(meta);

    const draft = document.createElement("textarea");
    draft.className = "row__draft";
    draft.placeholder = "Klik 'Generuj' żeby AI stworzyło draft, albo wpisz własny.";
    draft.value = item.draft || "";
    draft.addEventListener("blur", () => {
      const key = `${item.slug}#${num}`;
      const prev = _draftDebounce.get(key);
      if (prev) clearTimeout(prev);
      const t = setTimeout(async () => {
        try {
          await chrome.runtime.sendMessage({
            action: "followupUpdateDraft",
            slug: item.slug,
            followupNum: num,
            text: draft.value,
          });
        } catch (err) { console.warn("[dashboard] save draft:", err); }
      }, 500);
      _draftDebounce.set(key, t);
    });
    li.appendChild(draft);

    const actions = document.createElement("div");
    actions.className = "row__actions";

    const btnGen = btn("Generuj follow-up", "btn--primary");
    btnGen.addEventListener("click", async () => {
      btnGen.disabled = true;
      const orig = btnGen.textContent;
      btnGen.textContent = "Generuję…";
      try {
        const resp = await chrome.runtime.sendMessage({
          action: "followupGenerate",
          slug: item.slug,
          followupNum: num,
        });
        if (resp?.success) {
          draft.value = resp.draft || draft.value;
        } else {
          alert("Błąd generowania: " + (resp?.error || "unknown"));
        }
      } catch (err) {
        alert("Błąd: " + ((err && err.message) || err));
      } finally {
        btnGen.disabled = false;
        btnGen.textContent = orig;
      }
    });
    actions.appendChild(btnGen);

    const btnCopy = btn("Skopiuj i otwórz", "btn--outline");
    btnCopy.addEventListener("click", async () => {
      try {
        const resp = await chrome.runtime.sendMessage({
          action: "followupCopyAndOpen",
          slug: item.slug,
          followupNum: num,
        });
        if (!resp?.success) {
          if (resp?.error === "empty_draft") alert("Najpierw wygeneruj draft");
          else alert("Błąd: " + (resp?.error || "unknown"));
          return;
        }
        if (resp.draft) {
          try { await navigator.clipboard.writeText(resp.draft); } catch (_) {}
        }
      } catch (err) { alert("Błąd: " + err); }
    });
    actions.appendChild(btnCopy);

    const btnSent = btn("Wysłałem", "btn--outline");
    btnSent.addEventListener("click", async () => {
      if (!confirm(`Wysłałeś follow-up #${num} do ${item.name || item.slug}?`)) return;
      try {
        await chrome.runtime.sendMessage({
          action: "followupMarkSent",
          slug: item.slug,
          followupNum: num,
        });
        loadAll();
      } catch (err) { console.warn(err); }
    });
    actions.appendChild(btnSent);

    const btnSkip = btn("Pomiń", "btn--danger");
    btnSkip.addEventListener("click", async () => {
      if (!confirm(`Pomiń follow-upy dla ${item.name || item.slug}? (też #2 jeśli jeszcze nie wysłany)`)) return;
      try {
        await chrome.runtime.sendMessage({ action: "followupSkip", slug: item.slug });
        loadAll();
      } catch (err) { console.warn(err); }
    });
    actions.appendChild(btnSkip);

    li.appendChild(actions);
    return li;
  }

  // ── Scheduled section ──────────────────────────────────────────────

  function renderScheduled(items) {
    scheduledCount.textContent = items.length;
    scheduledList.querySelectorAll(".row").forEach((el) => el.remove());
    if (items.length === 0) {
      scheduledEmpty.classList.remove("hidden");
      return;
    }
    scheduledEmpty.classList.add("hidden");
    for (const item of items) scheduledList.appendChild(buildScheduledRow(item));
  }

  function buildScheduledRow(item) {
    const num = item.dueFollowup === 2 ? 2 : 1;
    const li = document.createElement("div");
    li.className = "row";

    const head = document.createElement("div");
    head.className = "row__head";
    const nameEl = document.createElement("strong");
    nameEl.className = "row__name";
    const nameLink = document.createElement("a");
    nameLink.href = `https://www.linkedin.com/in/${encodeURIComponent(item.slug)}/`;
    nameLink.target = "_blank";
    nameLink.rel = "noopener noreferrer";
    nameLink.textContent = item.name || item.slug;
    nameEl.appendChild(nameLink);
    head.appendChild(nameEl);

    const tag = document.createElement("span");
    tag.className = "row__tag row__tag--scheduled";
    const dayLabel = item.daysUntil === 1 ? "1 dzień" : `${item.daysUntil} dni`;
    tag.textContent = `Follow-up #${num} za ${dayLabel} (${formatDate(item.remindAt)})`;
    head.appendChild(tag);
    li.appendChild(head);

    if (item.headline) {
      const hl = document.createElement("p");
      hl.className = "row__headline";
      hl.textContent = item.headline;
      li.appendChild(hl);
    }

    const meta = document.createElement("p");
    meta.className = "row__meta";
    meta.textContent = `Pierwsza wiadomość: ${formatDate(item.messageSentAt)}`;
    li.appendChild(meta);

    return li;
  }

  // ── History section ────────────────────────────────────────────────

  function renderHistory(items) {
    historyCount.textContent = items.length;
    historyList.querySelectorAll(".row").forEach((el) => el.remove());
    if (items.length === 0) {
      historyEmpty.classList.remove("hidden");
      return;
    }
    historyEmpty.classList.add("hidden");
    for (const item of items) historyList.appendChild(buildHistoryRow(item));
  }

  function buildHistoryRow(item) {
    const li = document.createElement("div");
    li.className = "row";

    const head = document.createElement("div");
    head.className = "row__head";
    const nameEl = document.createElement("strong");
    nameEl.className = "row__name";
    const nameLink = document.createElement("a");
    nameLink.href = `https://www.linkedin.com/in/${encodeURIComponent(item.slug)}/`;
    nameLink.target = "_blank";
    nameLink.rel = "noopener noreferrer";
    nameLink.textContent = item.name || item.slug;
    nameEl.appendChild(nameLink);
    head.appendChild(nameEl);

    const tag = document.createElement("span");
    if (item.kind === "skipped") {
      tag.className = "row__tag row__tag--skipped";
      tag.textContent = "Pominięty";
    } else {
      tag.className = "row__tag row__tag--sent";
      tag.textContent = `Follow-up #${item.followupNum || "?"} wysłany ${formatDate(item.sentAt)}`;
    }
    head.appendChild(tag);
    li.appendChild(head);

    if (item.headline) {
      const hl = document.createElement("p");
      hl.className = "row__headline";
      hl.textContent = item.headline;
      li.appendChild(hl);
    }

    if (item.draft) {
      const draft = document.createElement("textarea");
      draft.className = "row__draft";
      draft.readOnly = true;
      draft.value = item.draft;
      li.appendChild(draft);
    }

    return li;
  }

  // ── Stats funnel (#38 v1.11.0) ─────────────────────────────────────

  async function loadStats() {
    if (!statsFunnel) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: "bulkGetStats" });
      if (!resp || !resp.success || !resp.totals || !resp.rates) {
        // Handler not deployed yet (subagent A) — hide cleanly.
        if (statsSection) statsSection.classList.add("hidden");
        return;
      }
      if (statsSection) statsSection.classList.remove("hidden");
      renderStatsFunnel(resp.totals, resp.rates);
    } catch (err) {
      console.warn("[dashboard] loadStats fail:", err);
      if (statsSection) statsSection.classList.add("hidden");
    }
  }

  function renderStatsFunnel(totals, rates) {
    if (!statsFunnel) return;
    if ((totals.invitesSent || 0) === 0 && (totals.messagesSent || 0) === 0) {
      statsFunnel.innerHTML = "";
      const p = document.createElement("p");
      p.className = "stats-empty";
      p.textContent = "Zacznij od bulk Connect lub manual outreach żeby zobaczyć statystyki.";
      statsFunnel.appendChild(p);
      return;
    }

    const rows = [
      { icon: "📨", label: "Invites wysłane", value: totals.invitesSent || 0, arrow: `Accept rate: ${fmtRate(rates.acceptRate)}%` },
      { icon: "✅", label: "Zaakceptowane", value: totals.accepted || 0, arrow: `Wiadomość 1 wysłana: ${totals.messagesSent || 0}` },
      { icon: "📩", label: "Wiadomość 1 wysłana", value: totals.messagesSent || 0, arrow: `Reply rate stage 1: ${fmtRate(rates.messageReplyRate)}%` },
      { icon: "↪", label: "Odpowiedź na wiadomość 1", value: totals.messageReplies || 0, arrow: `FU#1 wysłany: ${totals.followup1Sent || 0}` },
      { icon: "🔔", label: "Follow-up #1 wysłany", value: totals.followup1Sent || 0, arrow: `Reply rate stage 2: ${fmtRate(rates.followup1ReplyRate)}%` },
      { icon: "↪", label: "Odpowiedź na FU#1", value: totals.followup1Replies || 0, arrow: `FU#2 wysłany: ${totals.followup2Sent || 0}` },
      { icon: "🔔", label: "Follow-up #2 wysłany", value: totals.followup2Sent || 0, arrow: `Reply rate stage 3: ${fmtRate(rates.followup2ReplyRate)}%` },
      { icon: "↪", label: "Odpowiedź na FU#2", value: totals.followup2Replies || 0, arrow: null },
    ];

    statsFunnel.innerHTML = "";
    for (const row of rows) {
      const div = document.createElement("div");
      div.className = "stats-row";
      const iconSpan = document.createElement("span");
      iconSpan.className = "stats-row__icon";
      iconSpan.textContent = row.icon;
      const labelSpan = document.createElement("span");
      labelSpan.className = "stats-row__label";
      labelSpan.textContent = row.label;
      const valueSpan = document.createElement("span");
      valueSpan.className = "stats-row__value";
      valueSpan.textContent = String(row.value);
      div.appendChild(iconSpan);
      div.appendChild(labelSpan);
      div.appendChild(valueSpan);
      statsFunnel.appendChild(div);
      if (row.arrow) {
        const arr = document.createElement("div");
        arr.className = "stats-arrow";
        arr.textContent = `↓ ${row.arrow}`;
        statsFunnel.appendChild(arr);
      }
    }

    // Total row.
    const total = document.createElement("div");
    total.className = "stats-row stats-row--total";
    const totIcon = document.createElement("span");
    totIcon.className = "stats-row__icon";
    totIcon.textContent = "🎯";
    const totLabel = document.createElement("span");
    totLabel.className = "stats-row__label";
    totLabel.textContent = "TOTAL: Reply rate (any stage)";
    const totValue = document.createElement("span");
    totValue.className = "stats-row__value";
    const anyReply = totals.anyReply || 0;
    const messagesSent = totals.messagesSent || 0;
    totValue.textContent = `${fmtRate(rates.overallReplyRate)}% (${anyReply}/${messagesSent})`;
    total.appendChild(totIcon);
    total.appendChild(totLabel);
    total.appendChild(totValue);
    statsFunnel.appendChild(total);
  }

  function fmtRate(r) {
    const n = Number(r);
    if (!Number.isFinite(n)) return "0";
    // Handler returns rates as percentage (e.g. 33.5). Display 1 decimal.
    return n.toFixed(1).replace(/\.0$/, "");
  }

  // ── Contacts table (#38 v1.11.0) ───────────────────────────────────

  async function loadContactsList() {
    if (!contactsTbody) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: "getBulkState" });
      // getBulkState returns the state object directly: { queue, config, stats, ... }
      // (not wrapped in {success, state}). Defensive: fallback if shape differs.
      let queue = null;
      if (resp && Array.isArray(resp.queue)) queue = resp.queue;
      else if (resp && resp.state && Array.isArray(resp.state.queue)) queue = resp.state.queue;
      if (!queue) {
        contactsTbody.innerHTML = "";
        if (contactsEmpty) contactsEmpty.classList.remove("hidden");
        if (contactsCount) contactsCount.textContent = "0";
        return;
      }
      renderContactsTable(queue);
    } catch (err) {
      console.warn("[dashboard] loadContactsList fail:", err);
    }
  }

  function renderContactsTable(queue) {
    if (!contactsTbody) return;
    contactsTbody.innerHTML = "";

    const sorted = [...queue].sort((a, b) => {
      const aReply = Math.max(a.messageReplyAt || 0, a.followup1ReplyAt || 0, a.followup2ReplyAt || 0);
      const bReply = Math.max(b.messageReplyAt || 0, b.followup1ReplyAt || 0, b.followup2ReplyAt || 0);
      if (aReply !== bReply) return bReply - aReply;
      return (b.messageSentAt || 0) - (a.messageSentAt || 0);
    });

    if (contactsCount) contactsCount.textContent = String(sorted.length);

    if (sorted.length === 0) {
      if (contactsEmpty) contactsEmpty.classList.remove("hidden");
      return;
    }
    if (contactsEmpty) contactsEmpty.classList.add("hidden");

    for (const item of sorted) {
      contactsTbody.appendChild(buildContactRow(item));
    }
  }

  function buildContactRow(item) {
    const tr = document.createElement("tr");
    tr.dataset.slug = item.slug;

    // Status cell — color-coded
    let statusClass = "cell-status-pending";
    let statusText = item.status || "pending";
    if (item.messageReplyAt || item.followup1ReplyAt || item.followup2ReplyAt) {
      statusClass = "cell-status-replied";
      statusText = "replied";
    } else if (item.acceptedAt) {
      statusClass = "cell-status-accepted";
      statusText = "accepted";
    } else if (item.status === "sent" || item.status === "manual_sent") {
      statusClass = "cell-status-sent";
    }

    const inviteSent = (item.status === "sent" || item.status === "manual_sent")
      ? (item.timestamp || item.messageSentAt || null)
      : null;

    // Name cell — link to profile
    const nameTd = document.createElement("td");
    const nameLink = document.createElement("a");
    nameLink.href = `https://www.linkedin.com/in/${encodeURIComponent(item.slug)}/`;
    nameLink.target = "_blank";
    nameLink.rel = "noopener noreferrer";
    nameLink.textContent = item.name || item.slug;
    nameTd.appendChild(nameLink);
    tr.appendChild(nameTd);

    // Status cell
    const statusTd = document.createElement("td");
    statusTd.className = statusClass;
    statusTd.textContent = statusText;
    tr.appendChild(statusTd);

    tr.appendChild(buildMarkCell(inviteSent, "Invite wysłane"));
    tr.appendChild(buildMarkCell(item.acceptedAt, "Zaakceptowane"));
    tr.appendChild(buildMarkCell(item.messageSentAt, "Wiadomość wysłana"));
    tr.appendChild(buildMarkCell(item.messageReplyAt, "Odpowiedział na msg"));
    tr.appendChild(buildMarkCell(item.followup1SentAt, "FU#1 wysłany"));
    tr.appendChild(buildMarkCell(item.followup1ReplyAt, "Odpowiedział na FU#1"));
    tr.appendChild(buildMarkCell(item.followup2SentAt, "FU#2 wysłany"));
    tr.appendChild(buildMarkCell(item.followup2ReplyAt, "Odpowiedział na FU#2"));

    // Actions cell
    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";

    if (item.messageSentAt && !item.messageReplyAt) {
      actionsTd.appendChild(makeReplyBtn("↪Msg", "Oznacz że odpowiedział na wiadomość 1", "btn-mark-reply",
        () => markReply(item.slug, "message")));
    }
    if (item.followup1SentAt && !item.followup1ReplyAt) {
      actionsTd.appendChild(makeReplyBtn("↪FU1", "Oznacz że odpowiedział na FU#1", "btn-mark-reply",
        () => markReply(item.slug, "followup1")));
    }
    if (item.followup2SentAt && !item.followup2ReplyAt) {
      actionsTd.appendChild(makeReplyBtn("↪FU2", "Oznacz że odpowiedział na FU#2", "btn-mark-reply",
        () => markReply(item.slug, "followup2")));
    }
    if (item.messageReplyAt) {
      actionsTd.appendChild(makeReplyBtn("✕Msg", "Cofnij oznaczenie odpowiedzi na msg", "btn-unmark-reply",
        () => unmarkReply(item.slug, "message")));
    }
    if (item.followup1ReplyAt) {
      actionsTd.appendChild(makeReplyBtn("✕FU1", "Cofnij oznaczenie odpowiedzi na FU#1", "btn-unmark-reply",
        () => unmarkReply(item.slug, "followup1")));
    }
    if (item.followup2ReplyAt) {
      actionsTd.appendChild(makeReplyBtn("✕FU2", "Cofnij oznaczenie odpowiedzi na FU#2", "btn-unmark-reply",
        () => unmarkReply(item.slug, "followup2")));
    }
    tr.appendChild(actionsTd);

    return tr;
  }

  function buildMarkCell(date, title) {
    const td = document.createElement("td");
    if (!date) {
      td.className = "cell-no";
      td.textContent = "—";
      return td;
    }
    td.className = "cell-yes";
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    td.textContent = `✓ ${dd}.${mm}`;
    const iso = d.toISOString().slice(0, 16).replace("T", " ");
    td.title = `${title}: ${iso}`;
    return td;
  }

  function makeReplyBtn(text, title, cls, onClick) {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  async function markReply(slug, stage) {
    let action;
    if (stage === "message") action = "bulkMarkMessageReply";
    else if (stage === "followup1") action = "bulkMarkFollowup1Reply";
    else if (stage === "followup2") action = "bulkMarkFollowup2Reply";
    else return;

    try {
      const resp = await chrome.runtime.sendMessage({ action, slug });
      if (resp && resp.success === false) {
        console.warn("[dashboard] markReply rejected:", resp);
      }
    } catch (err) {
      console.warn("[dashboard] markReply fail:", err);
    }
    refreshAll();
  }

  async function unmarkReply(slug, stage) {
    try {
      const resp = await chrome.runtime.sendMessage({ action: "bulkUnmarkReply", slug, stage });
      if (resp && resp.success === false) {
        console.warn("[dashboard] unmarkReply rejected:", resp);
      }
    } catch (err) {
      console.warn("[dashboard] unmarkReply fail:", err);
    }
    refreshAll();
  }

  // ── Profile DB (#45 v1.14.0) ───────────────────────────────────────

  const profileDbSection = $("#profiledb-section");
  const profileDbTbody = $("#profiledb-tbody");
  const profileDbCount = $("#profiledb-count");
  const profileDbEmpty = $("#profiledb-empty");
  const profileDbSearch = $("#profiledb-search");
  const profileDbSourceFilter = $("#profiledb-source-filter");
  const profileDbConnFilter = $("#profiledb-conn-filter");
  const backupBannerText = $("#backup-banner-text");
  const backupBanner = $("#backup-banner");
  const profileDbStatus = $("#profiledb-status");

  const SOURCE_LABELS = {
    search: "Wyszukiwanie",
    profile_scrape: "Scrape profilu",
    connections_import: "Import kontaktów",
    manual: "Manual",
    bulk: "Bulk",
  };

  let _profileDbSearchDebounce = null;

  function profileDbFilter() {
    return {
      text: (profileDbSearch && profileDbSearch.value) || "",
      source: (profileDbSourceFilter && profileDbSourceFilter.value) || "",
      isConnection: (profileDbConnFilter && profileDbConnFilter.value) || "",
    };
  }

  async function loadProfileDb() {
    if (!profileDbTbody) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: "profileDbList", filter: profileDbFilter() });
      if (!resp || !resp.success) {
        if (profileDbSection) profileDbSection.classList.add("hidden");
        return;
      }
      if (profileDbSection) profileDbSection.classList.remove("hidden");
      renderProfileDb(resp.list || [], resp.counts || {});
    } catch (err) {
      console.warn("[dashboard] loadProfileDb fail:", err);
    }
  }

  function renderProfileDb(list, counts) {
    profileDbTbody.innerHTML = "";
    if (profileDbCount) {
      profileDbCount.textContent = String(counts.total || 0);
      profileDbCount.title = `${counts.total || 0} profili — ${counts.connections || 0} kontaktów, ${counts.inQueue || 0} w kolejce`;
    }
    if (!list.length) {
      if (profileDbEmpty) profileDbEmpty.classList.remove("hidden");
      return;
    }
    if (profileDbEmpty) profileDbEmpty.classList.add("hidden");
    for (const r of list) profileDbTbody.appendChild(buildProfileDbRow(r));
  }

  function buildProfileDbRow(r) {
    const tr = document.createElement("tr");
    tr.dataset.slug = r.slug;

    const nameTd = document.createElement("td");
    const a = document.createElement("a");
    a.href = r.profileUrl || `https://www.linkedin.com/in/${encodeURIComponent(r.slug)}/`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = r.name || r.slug;
    nameTd.appendChild(a);
    tr.appendChild(nameTd);

    const hlTd = document.createElement("td");
    hlTd.textContent = r.headline || "";
    hlTd.title = r.headline || "";
    tr.appendChild(hlTd);

    const degTd = document.createElement("td");
    degTd.textContent = r.degree || "—";
    tr.appendChild(degTd);

    const srcTd = document.createElement("td");
    srcTd.textContent = SOURCE_LABELS[r.source] || r.source || "—";
    tr.appendChild(srcTd);

    tr.appendChild(boolCell(r.isConnection));
    tr.appendChild(boolCell(r.inQueue));
    tr.appendChild(boolCell(r.hasFullScrape));

    const seenTd = document.createElement("td");
    seenTd.textContent = formatDate(r.lastSeenAt);
    tr.appendChild(seenTd);
    return tr;
  }

  function boolCell(v) {
    const td = document.createElement("td");
    td.className = v ? "cell-yes" : "cell-no";
    td.textContent = v ? "✓" : "—";
    return td;
  }

  async function loadBackupStatus() {
    if (!backupBannerText) return;
    try {
      const resp = await chrome.runtime.sendMessage({ action: "getBackupStatus" });
      if (!resp || !resp.success) { backupBannerText.textContent = "Status backupu niedostępny."; return; }
      const last = resp.lastBackupAt;
      const interval = resp.intervalDays;
      let danger = false;
      if (!last) {
        backupBannerText.textContent = "⚠ Backup nigdy nie był jeszcze zrobiony — kliknij „Pobierz backup teraz” poniżej.";
        danger = true;
      } else {
        const days = Math.floor((Date.now() - last) / 86400000);
        const ago = days <= 0 ? "dzisiaj" : (days === 1 ? "wczoraj" : `${days} dni temu`);
        backupBannerText.textContent = `Ostatni backup: ${ago} (${formatDate(last)}). Auto-backup co ${interval > 0 ? interval + " dni" : "— wyłączony w ustawieniach"}.`;
        danger = days > 7 || interval <= 0;
      }
      if (backupBanner) backupBanner.classList.toggle("backup-banner--danger", danger);
    } catch (err) {
      backupBannerText.textContent = "Status backupu niedostępny.";
    }
  }

  function setProfileDbStatus(msg, isError) {
    if (!profileDbStatus) return;
    profileDbStatus.textContent = msg || "";
    profileDbStatus.classList.toggle("profiledb-status--error", !!isError);
  }

  function triggerDownload(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_) {} }, 1500);
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function wireProfileDbControls() {
    const btnExportCsv = $("#btn-export-csv");
    const btnExportJson = $("#btn-export-json");
    const btnBackupNow = $("#btn-backup-now");
    const btnImportConnections = $("#btn-import-connections");
    const importFile = $("#import-file");
    const importRestoreQueue = $("#import-restore-queue");
    const btnRefreshProfileDb = $("#btn-refresh-profiledb");

    if (btnExportCsv) btnExportCsv.addEventListener("click", async () => {
      setProfileDbStatus("Buduję CSV…");
      try {
        const resp = await chrome.runtime.sendMessage({ action: "profileDbExportCsv" });
        if (resp && resp.success) {
          triggerDownload(`linkedin-profiles-${todayStr()}.csv`, "text/csv;charset=utf-8", resp.csv || "");
          setProfileDbStatus("CSV pobrany.");
        } else setProfileDbStatus("Błąd eksportu CSV.", true);
      } catch (e) { setProfileDbStatus("Błąd: " + ((e && e.message) || e), true); }
    });

    if (btnExportJson) btnExportJson.addEventListener("click", async () => {
      setProfileDbStatus("Buduję backup JSON…");
      try {
        const resp = await chrome.runtime.sendMessage({ action: "profileDbExportJson" });
        if (resp && resp.success) {
          triggerDownload(`linkedin-msg-backup-${todayStr()}.json`, "application/json", resp.json || "{}");
          setProfileDbStatus("Pełny backup JSON pobrany.");
        } else setProfileDbStatus("Błąd eksportu JSON.", true);
      } catch (e) { setProfileDbStatus("Błąd: " + ((e && e.message) || e), true); }
    });

    if (btnBackupNow) btnBackupNow.addEventListener("click", async () => {
      btnBackupNow.disabled = true;
      setProfileDbStatus("Zapisuję backup…");
      try {
        const resp = await chrome.runtime.sendMessage({ action: "backupNow" });
        if (resp && resp.success) {
          setProfileDbStatus(`Backup zapisany: Pobrane/${resp.filename}${resp.lite ? " (lite — bez pełnych scrape'ów, plik był za duży)" : ""}.`);
          loadBackupStatus();
        } else setProfileDbStatus("Backup nieudany: " + (resp && (resp.error || resp.skipped) || "unknown"), true);
      } catch (e) { setProfileDbStatus("Błąd: " + ((e && e.message) || e), true); }
      finally { btnBackupNow.disabled = false; }
    });

    if (btnImportConnections) btnImportConnections.addEventListener("click", async () => {
      if (!confirm("Otworzy się karta z Twoimi kontaktami LinkedIn — rozszerzenie przewinie ją do końca i zapisze wszystkie kontakty do bazy. Może to potrwać kilka minut przy dużej liczbie kontaktów. Nie zamykaj tej karty w trakcie. Kontynuować?")) return;
      btnImportConnections.disabled = true;
      const orig = btnImportConnections.textContent;
      btnImportConnections.textContent = "Importuję kontakty… (kilka minut)";
      setProfileDbStatus("Importuję kontakty z LinkedIn — nie zamykaj otwartej karty…");
      try {
        const resp = await chrome.runtime.sendMessage({ action: "importConnections", maxPages: 80 });
        if (resp && resp.success) {
          setProfileDbStatus(`Zaimportowano ${resp.scraped || 0} kontaktów (${resp.added || 0} nowych, ${resp.updated || 0} zaktualizowanych${resp.hitCap ? ", osiągnięto limit stron — uruchom ponownie po doscrollowaniu" : ""}).`);
          loadProfileDb();
        } else {
          setProfileDbStatus("Import kontaktów nieudany: " + (resp && resp.error || "unknown") + ". Spróbuj otworzyć stronę kontaktów ręcznie i powtórzyć.", true);
        }
      } catch (e) { setProfileDbStatus("Błąd: " + ((e && e.message) || e), true); }
      finally { btnImportConnections.disabled = false; btnImportConnections.textContent = orig; }
    });

    if (importFile) importFile.addEventListener("change", async () => {
      const file = importFile.files && importFile.files[0];
      if (!file) return;
      const restoreQueue = !!(importRestoreQueue && importRestoreQueue.checked);
      setProfileDbStatus(`Wczytuję ${file.name}…`);
      try {
        const text = await file.text();
        const isCsv = /\.csv$/i.test(file.name);
        const msg = isCsv
          ? { action: "profileDbImport", csv: text }
          : { action: "profileDbImport", json: text, restoreQueue };
        const resp = await chrome.runtime.sendMessage(msg);
        if (resp && resp.success) {
          setProfileDbStatus(`Import OK: ${resp.added || 0} nowych, ${resp.updated || 0} zaktualizowanych${resp.queueRestored ? `, ${resp.queueRestored} pozycji dorzucone do kolejki` : ""}.`);
          refreshAll();
        } else {
          setProfileDbStatus("Import nieudany: " + (resp && resp.error || "unknown") + ".", true);
        }
      } catch (e) { setProfileDbStatus("Błąd odczytu pliku: " + ((e && e.message) || e), true); }
      finally { importFile.value = ""; }
    });

    if (btnRefreshProfileDb) btnRefreshProfileDb.addEventListener("click", (e) => { e.stopPropagation(); loadProfileDb(); loadBackupStatus(); });

    const onFilterChange = () => {
      if (_profileDbSearchDebounce) clearTimeout(_profileDbSearchDebounce);
      _profileDbSearchDebounce = setTimeout(loadProfileDb, 250);
    };
    if (profileDbSearch) profileDbSearch.addEventListener("input", onFilterChange);
    if (profileDbSourceFilter) profileDbSourceFilter.addEventListener("change", loadProfileDb);
    if (profileDbConnFilter) profileDbConnFilter.addEventListener("change", loadProfileDb);
  }

  function refreshAll() {
    loadAll();
    loadStats();
    loadContactsList();
    loadProfileDb();
    loadBackupStatus();
  }

  // ── Helpers ────────────────────────────────────────────────────────

  function btn(text, ...extraClasses) {
    const b = document.createElement("button");
    b.className = ["btn", "btn--small", ...extraClasses].join(" ");
    b.textContent = text;
    return b;
  }

  function formatDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
  }

  // ── Init ───────────────────────────────────────────────────────────

  btnRefresh.addEventListener("click", () => {
    loadAll();
    loadStats();
    loadContactsList();
  });

  if (btnRefreshStats) {
    btnRefreshStats.addEventListener("click", (e) => {
      e.stopPropagation();
      loadStats();
    });
  }

  // Auto-refresh gdy storage zmienia się (np. user kliknął "Wysłałem"
  // w popup'ie i wraca do dashboardu).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.bulkConnect) {
      loadAll();
      loadStats();
      loadContactsList();
      loadProfileDb();
    }
    if (changes.profileDb) {
      loadProfileDb();
      loadBackupStatus();
    }
  });

  wireProfileDbControls();
  loadAll();
  loadStats();
  loadContactsList();
  loadProfileDb();
  loadBackupStatus();
})();
