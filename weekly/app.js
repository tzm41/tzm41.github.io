/**
 * Weekly Briefing — Client Application (Zero-Build ES Module)
 * Inherits UI, theme, entity, Wikipedia link, and tooltip engines from ../shared/
 */

import { initCountryMapTooltip } from "../briefing/country-map.js?v=13";
import {
  escapeHtml,
  safeUrl,
  fmtReadableDate,
  fmtLocalTimestamp,
  initTheme,
  initScrollSpy,
  createCollapsibleManager,
  renderSourceChip,
  initSourceBiasPopover,
  renderSentimentRing,
} from "../shared/ui.js?v=1";
import {
  buildPersonNameRegexFromTexts,
  createEntityFormatter,
  initFloatingTooltips,
} from "../shared/entities.js?v=1";

const DATA_BASE = "./data";
const SHARED_DATA_BASE = "../briefing/data";

const state = {
  index: null,
  currentDate: null,
  viewingLatest: true,
  edition: null,
  companyFacts: null,
  countryLeaders: null,
  personNameRe: null,
};

const els = {
  editionDate: document.getElementById("edition-date"),
  generatedMeta: document.getElementById("generated-meta"),
  dateSelect: document.getElementById("date-select"),
  btnPrevWeek: document.getElementById("btn-prev-week"),
  btnNextWeek: document.getElementById("btn-next-week"),
  btnExpandAll: document.getElementById("btn-expand-all"),
  btnRefresh: document.getElementById("btn-refresh"),
  themeToggle: document.getElementById("theme-toggle"),
  statusBanner: document.getElementById("status-banner"),
  themeTag: document.getElementById("theme-tag"),
  digestList: document.getElementById("weekly-digest-list"),
  featuredQuoteCard: document.getElementById("featured-quote-card"),
  scienceNarrative: document.getElementById("science-narrative"),
  scienceGrid: document.getElementById("science-grid"),
  cultureNarrative: document.getElementById("culture-narrative"),
  cultureGrid: document.getElementById("culture-grid"),
  historyNarrative: document.getElementById("history-narrative"),
  historyGrid: document.getElementById("history-grid"),
  milestonesBlock: document.getElementById("milestones-block"),
  milestonesNote: document.getElementById("milestones-note"),
  historyTimeline: document.getElementById("history-timeline"),
  longreadsGrid: document.getElementById("longreads-grid"),
  pulseList: document.getElementById("pulse-list"),
  sourceHealth: document.getElementById("source-health"),
};

const { formatEntitiesInPlain, highlightSummaryHtml } = createEntityFormatter({
  getPersonNameRe: () => state.personNameRe,
  getCompanyFacts: () => state.companyFacts,
  getCountryLeaders: () => state.countryLeaders,
  pillCompaniesInSummary: false,
});

const collapsibles = createCollapsibleManager(els.btnExpandAll);

/* ---------- Status & Helpers ---------- */

function showBanner(msg, type = "info") {
  if (!els.statusBanner) return;
  if (!msg) {
    els.statusBanner.classList.add("hidden");
    els.statusBanner.textContent = "";
    return;
  }
  els.statusBanner.textContent = msg;
  els.statusBanner.className = `status-banner ${type}`;
}

function collectEditionTexts(ed) {
  const texts = [];
  for (const b of ed.digest || []) {
    texts.push(typeof b === "string" ? b : b?.text || "");
  }
  if (ed.featured_quote) {
    texts.push(ed.featured_quote.quote || "", ed.featured_quote.author || "", ed.featured_quote.context || "");
  }
  for (const key of ["science", "culture", "history"]) {
    const sec = ed[key];
    if (!sec) continue;
    texts.push(sec.narrative || "");
    for (const item of sec.items || []) {
      texts.push(item.headline || "", item.summary || "", item.takeaway || "");
    }
  }
  for (const m of ed.this_week_in_history || []) {
    texts.push(m.title || "", m.summary || "");
  }
  for (const lr of ed.long_reads || []) {
    texts.push(lr.headline || "", lr.summary || "");
  }
  for (const p of ed.week_in_brief || []) {
    texts.push(typeof p === "string" ? p : p?.text || "");
  }
  return texts;
}

/* ---------- Renderers ---------- */

function renderHeader(ed) {
  const label = ed.week_label || fmtReadableDate(ed.date);
  els.editionDate.textContent = label;
  const themeSuffix = ed.theme_title ? ` · Theme: ${ed.theme_title}` : "";
  els.generatedMeta.textContent = `Published ${fmtLocalTimestamp(ed.generated_at)}${themeSuffix}`;
  els.themeTag.textContent = ed.theme_title || "Sunday Edition";
}

function renderDigest(ed) {
  const bullets = ed.digest || [];
  if (!bullets.length) {
    els.digestList.innerHTML = `<li class="empty-note">No weekly digest bullets available for this edition.</li>`;
    return;
  }
  els.digestList.innerHTML = bullets
    .map((item) => {
      const text = typeof item === "string" ? item : item?.text || "";
      const category = typeof item === "object" ? item?.category : "";
      const sentiment = typeof item === "object" ? item?.sentiment : null;
      const ringHtml = renderSentimentRing(sentiment, text);
      const catHtml = category ? `<span class="category-tag">${escapeHtml(category)}</span>` : "";
      return `
        <li class="executive-item">
          <div class="executive-item-main">
            ${ringHtml}
            <span class="executive-text">${highlightSummaryHtml(text)}</span>
          </div>
          ${catHtml ? `<div class="executive-item-meta">${catHtml}</div>` : ""}
        </li>
      `;
    })
    .join("");
}

function renderFeaturedQuote(ed) {
  const q = ed.featured_quote;
  if (!q || !q.quote) {
    els.featuredQuoteCard.classList.add("hidden");
    els.featuredQuoteCard.innerHTML = "";
    return;
  }
  els.featuredQuoteCard.classList.remove("hidden");
  const contextHtml = q.context
    ? `<span class="quote-card-context">&mdash; ${formatEntitiesInPlain(q.context)}</span>`
    : "";
  els.featuredQuoteCard.innerHTML = `
    <span class="quote-card-kicker">Idea &amp; Quote of the Week</span>
    <blockquote>&ldquo;${formatEntitiesInPlain(q.quote)}&rdquo;</blockquote>
    <div class="quote-card-meta">
      <span class="quote-card-author">${formatEntitiesInPlain(q.author || "")}</span>
      ${contextHtml}
    </div>
  `;
}

function renderLearningCard(item) {
  const headlineUrl = safeUrl(item.sources?.[0]?.url);
  const headlineHtml = headlineUrl
    ? `<a href="${headlineUrl}" target="_blank" rel="noopener noreferrer">${formatEntitiesInPlain(item.headline)}</a>`
    : formatEntitiesInPlain(item.headline);

  const sourcesHtml = (item.sources || []).slice(0, 3).map(renderSourceChip).join("");
  const ringHtml = renderSentimentRing(item.sentiment, `${item.headline || ""} ${item.summary || ""}`);
  const disciplineHtml = item.discipline
    ? `<span class="discipline-tag">${escapeHtml(item.discipline)}</span>`
    : "";
  const takeawayHtml = item.takeaway
    ? `<p class="weekly-takeaway"><span class="weekly-takeaway-label">Takeaway</span>${highlightSummaryHtml(item.takeaway)}</p>`
    : "";

  return `
    <article class="news-card">
      <div class="news-card-top">
        <span class="category-tag">${escapeHtml(item.category || "Learning")}</span>
        <div class="weekly-card-top-right">
          ${disciplineHtml}
          ${ringHtml}
        </div>
      </div>
      <h3 class="news-headline">${headlineHtml}</h3>
      <p class="news-summary">${highlightSummaryHtml(item.summary)}</p>
      ${takeawayHtml}
      <div class="source-list">${sourcesHtml}</div>
    </article>
  `;
}

function renderLearningSection(secData, narrativeEl, gridEl, emptyMsg) {
  const narrative = secData?.narrative || "";
  const items = secData?.items || [];
  narrativeEl.innerHTML = narrative ? highlightSummaryHtml(narrative) : "";
  if (!items.length) {
    gridEl.innerHTML = `<p class="empty-note">${escapeHtml(emptyMsg)}</p>`;
    return;
  }
  gridEl.innerHTML = items.map(renderLearningCard).join("");
}

function renderHistoryMilestones(ed) {
  const milestones = ed.this_week_in_history || [];
  if (!milestones.length) {
    els.milestonesBlock.classList.add("hidden");
    els.historyTimeline.innerHTML = "";
    return;
  }
  els.milestonesBlock.classList.remove("hidden");
  if (ed.week_label) {
    els.milestonesNote.textContent = `Anniversaries for ${ed.week_label}`;
  }
  els.historyTimeline.innerHTML = milestones
    .map(
      (m) => `
      <article class="history-milestone">
        <div class="milestone-year-col">
          <span class="milestone-year">${escapeHtml(String(m.year ?? ""))}</span>
          ${m.date_label ? `<span class="milestone-date">${escapeHtml(m.date_label)}</span>` : ""}
        </div>
        <div class="milestone-body">
          <h4 class="milestone-title">${formatEntitiesInPlain(m.title)}</h4>
          <p class="milestone-summary">${highlightSummaryHtml(m.summary)}</p>
        </div>
      </article>
    `
    )
    .join("");
}

function renderLongReads(ed) {
  const items = ed.long_reads || [];
  if (!items.length) {
    els.longreadsGrid.innerHTML = `<p class="empty-note">No long reads curated for this edition.</p>`;
    return;
  }
  els.longreadsGrid.innerHTML = items
    .map((lr) => {
      const headlineUrl = safeUrl(lr.sources?.[0]?.url);
      const headlineHtml = headlineUrl
        ? `<a href="${headlineUrl}" target="_blank" rel="noopener noreferrer">${formatEntitiesInPlain(lr.headline)}</a>`
        : formatEntitiesInPlain(lr.headline);
      const sourcesHtml = (lr.sources || []).slice(0, 3).map(renderSourceChip).join("");
      const timeHtml = lr.reading_time
        ? `<span class="reading-time-tag">${escapeHtml(lr.reading_time)}</span>`
        : "";
      return `
        <article class="news-card">
          <div class="news-card-top">
            <span class="category-tag">${escapeHtml(lr.topic || "Essay")}</span>
            ${timeHtml}
          </div>
          <h3 class="news-headline">${headlineHtml}</h3>
          <p class="news-summary">${highlightSummaryHtml(lr.summary)}</p>
          <div class="source-list">${sourcesHtml}</div>
        </article>
      `;
    })
    .join("");
}

function renderWeekInBrief(ed) {
  const items = ed.week_in_brief || [];
  if (!items.length) {
    els.pulseList.innerHTML = `<li class="empty-note">No macro recap available for this week.</li>`;
    return;
  }
  els.pulseList.innerHTML = items
    .map((item) => {
      const text = typeof item === "string" ? item : item?.text || "";
      const category = typeof item === "object" ? item?.category : "";
      const sentiment = typeof item === "object" ? item?.sentiment : null;
      const ringHtml = renderSentimentRing(sentiment, text);
      const catHtml = category ? `<span class="category-tag">${escapeHtml(category)}</span>` : "";
      return `
        <li class="executive-item">
          <div class="executive-item-main">
            ${ringHtml}
            <span class="executive-text">${highlightSummaryHtml(text)}</span>
          </div>
          ${catHtml ? `<div class="executive-item-meta">${catHtml}</div>` : ""}
        </li>
      `;
    })
    .join("");
}

function renderSourceHealth(health = {}) {
  const entries = [
    ["Science", health.science],
    ["Culture & Arts", health.culture],
    ["History", health.history],
    ["Long Reads", health.long_reads],
  ];
  els.sourceHealth.innerHTML = entries
    .map(([label, status]) => {
      const cls = status === "ok" ? "ok" : status === "partial" ? "partial" : "failed";
      return `<span class="health-pill ${cls}" title="${label}: ${status || "unknown"}"><span class="dot"></span>${label}</span>`;
    })
    .join("");
}

function renderEdition(ed) {
  state.edition = ed;
  state.currentDate = ed.date;
  state.personNameRe = buildPersonNameRegexFromTexts(collectEditionTexts(ed), state.companyFacts);

  renderHeader(ed);
  renderDigest(ed);
  renderFeaturedQuote(ed);
  renderLearningSection(ed.science, els.scienceNarrative, els.scienceGrid, "No science learnings available.");
  renderLearningSection(ed.culture, els.cultureNarrative, els.cultureGrid, "No culture & arts stories available.");
  renderLearningSection(ed.history, els.historyNarrative, els.historyGrid, "No history stories available.");
  renderHistoryMilestones(ed);
  renderLongReads(ed);
  renderWeekInBrief(ed);
  renderSourceHealth(ed.source_health);

  updateArchiveControls();
  showBanner("");
}

/* ---------- Archive Navigation & Data Loading ---------- */

async function fetchJson(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

function populateDateSelect(index) {
  const dates = index?.dates || [];
  const editionsByDate = new Map((index?.editions || []).map((e) => [e.date, e]));
  els.dateSelect.innerHTML = "";

  const latestOpt = document.createElement("option");
  latestOpt.value = "latest";
  latestOpt.textContent = dates.length ? `Latest (${dates[0]})` : "Latest";
  els.dateSelect.appendChild(latestOpt);

  for (const d of dates) {
    const opt = document.createElement("option");
    opt.value = d;
    const meta = editionsByDate.get(d);
    opt.textContent = meta?.week_label ? `${d} · ${meta.week_label}` : d;
    els.dateSelect.appendChild(opt);
  }
}

function updateArchiveControls() {
  const dates = state.index?.dates || [];
  const idx = dates.indexOf(state.currentDate);
  els.dateSelect.value = state.viewingLatest ? "latest" : state.currentDate || "latest";
  els.btnPrevWeek.disabled = idx === -1 || idx >= dates.length - 1;
  els.btnNextWeek.disabled = idx <= 0;
}

async function loadEdition(dateOrLatest = "latest", pushUrl = true) {
  try {
    const isLatest = !dateOrLatest || dateOrLatest === "latest";
    state.viewingLatest = isLatest;
    const url = isLatest
      ? `${DATA_BASE}/latest.json?t=${Date.now()}`
      : `${DATA_BASE}/archive/${encodeURIComponent(dateOrLatest)}.json`;

    const ed = await fetchJson(url);
    renderEdition(ed);

    if (pushUrl) {
      const target = new URL(window.location.href);
      target.searchParams.set("date", isLatest ? "latest" : ed.date);
      window.history.replaceState({}, "", target);
    }
  } catch (err) {
    console.error(err);
    showBanner(
      "Could not load the Weekly Briefing edition yet. Please refresh in a moment.",
      "error"
    );
  }
}

async function bootstrap() {
  initTheme(els.themeToggle);
  initScrollSpy();
  initSourceBiasPopover();
  initFloatingTooltips(() => state.companyFacts);
  initCountryMapTooltip(() => state.countryLeaders);

  // Wire collapsible sections (Science, Culture, History open by default; Long Reads & Week in Brief collapsed)
  const scienceCtrl = collapsibles.wireCollapsible("btn-toggle-science", "science-body", "#science");
  const cultureCtrl = collapsibles.wireCollapsible("btn-toggle-culture", "culture-body", "#culture");
  const historyCtrl = collapsibles.wireCollapsible("btn-toggle-history", "history-body", "#history");
  collapsibles.wireCollapsible("btn-toggle-longreads", "longreads-body", "#longreads");
  collapsibles.wireCollapsible("btn-toggle-pulse", "pulse-body", "#pulse");
  scienceCtrl?.setOpen(true);
  cultureCtrl?.setOpen(true);
  historyCtrl?.setOpen(true);
  collapsibles.wireExpandAll();
  collapsibles.syncExpandAllButton();

  els.dateSelect.addEventListener("change", () => {
    loadEdition(els.dateSelect.value);
  });

  els.btnPrevWeek.addEventListener("click", () => {
    const dates = state.index?.dates || [];
    const idx = dates.indexOf(state.currentDate);
    if (idx >= 0 && idx < dates.length - 1) loadEdition(dates[idx + 1]);
  });

  els.btnNextWeek.addEventListener("click", () => {
    const dates = state.index?.dates || [];
    const idx = dates.indexOf(state.currentDate);
    if (idx > 0) loadEdition(idx === 1 ? "latest" : dates[idx - 1]);
  });

  els.btnRefresh?.addEventListener("click", async () => {
    if (els.btnRefresh.disabled) return;
    els.btnRefresh.disabled = true;
    els.btnRefresh.classList.add("spinning");
    try {
      const idxData = await fetchJson(`${DATA_BASE}/index.json?t=${Date.now()}`);
      state.index = idxData;
      populateDateSelect(idxData);
      await loadEdition(state.viewingLatest ? "latest" : state.currentDate, false);
    } catch {
      await loadEdition(state.viewingLatest ? "latest" : state.currentDate, false);
    } finally {
      els.btnRefresh.disabled = false;
      els.btnRefresh.classList.remove("spinning");
    }
  });

  // Load shared company facts + country leaders + weekly index in parallel
  const [factsRes, leadersRes, idxRes] = await Promise.allSettled([
    fetchJson(`${SHARED_DATA_BASE}/company_facts.json`),
    fetchJson(`${SHARED_DATA_BASE}/country_leaders.json`),
    fetchJson(`${DATA_BASE}/index.json?t=${Date.now()}`),
  ]);

  if (factsRes.status === "fulfilled") state.companyFacts = factsRes.value;
  if (leadersRes.status === "fulfilled") state.countryLeaders = leadersRes.value;
  if (idxRes.status === "fulfilled") {
    state.index = idxRes.value;
    populateDateSelect(idxRes.value);
  }

  const params = new URLSearchParams(window.location.search);
  const requestedDate = params.get("date") || "latest";
  await loadEdition(requestedDate, false);
}

bootstrap();
