/**
 * Unified Editorial Card & Brief Bullet Renderers
 * Shared by Daily Briefing (/briefing/), Weekly Briefing (/weekly/), and Bookmarks (/bookmarks/).
 */

import { escapeHtml, safeUrl, fmtCoords } from "./utils.js";
import { renderSourceChip, renderHashedTag, renderSentimentRing } from "./ui.js";
import { renderCountryFlagImg } from "./entities.js";

/**
 * Render Morning/Afternoon Brief, Sunday Digest, or Week in Brief bullet list items.
 */
export function renderBriefBullets(
  bullets = [],
  { highlightSummaryHtml, resolveCategory = () => "Brief", useFallbackSentiment = true } = {}
) {
  return bullets
    .map((item) => {
      const text = typeof item === "string" ? item : item?.text || "";
      const category =
        typeof item === "object" && item?.category ? item.category : resolveCategory(text);
      const sentiment = typeof item === "object" ? item?.sentiment : null;
      return `
        <li>
          <span class="exec-meta">
            ${renderSentimentRing(sentiment, useFallbackSentiment ? text : "")}
            ${renderHashedTag(category)}
          </span>
          <span class="exec-text">${highlightSummaryHtml(text)}</span>
        </li>
      `;
    })
    .join("");
}

/**
 * Core slot-based editorial card renderer.
 * When `innerOnly: true`, returns only the inner HTML so callers like /bookmarks/
 * can update memoized <article> DOM nodes in place.
 */
export function renderCardShell({
  className = "news-card",
  innerOnly = false,
  bookmarkHtml = "",
  headerHtml = "",
  badgeLabel = "",
  sentimentHtml = "",
  metaExtraHtml = "",
  metaRightHtml = "",
  subheaderHtml = "",
  headlineHtml = "",
  summaryHtml = "",
  calloutHtml = "",
  sourcesHtml = "",
  footerHtml = "",
} = {}) {
  const badgeHtml = badgeLabel ? renderHashedTag(badgeLabel) : "";
  const hasMeta = Boolean(badgeHtml || sentimentHtml || metaExtraHtml || metaRightHtml);
  const metaHtml = hasMeta
    ? `
      <div class="news-meta">
        <div class="news-card-badges">
          ${badgeHtml}
          ${sentimentHtml}
          ${metaExtraHtml}
        </div>
        ${metaRightHtml}
      </div>
    `
    : "";

  const inner = `
    ${bookmarkHtml}
    ${headerHtml}
    ${metaHtml}
    ${subheaderHtml}
    <h3>${headlineHtml}</h3>
    ${summaryHtml}
    ${calloutHtml}
    ${sourcesHtml ? `<div class="source-links">${sourcesHtml}</div>` : ""}
    ${footerHtml}
  `;

  if (innerOnly) return inner;
  return `<article class="${escapeHtml(className)}">${inner}</article>`;
}

/**
 * Render a Daily Briefing story card (top_news, local_news, positive_news).
 */
export function renderDailyStoryCard(
  story,
  {
    section = "top_news",
    badgeLabel = "",
    formatter,
    bookmarkHtml = "",
    continued = false,
    showEditionTag = false,
    headerHtml = "",
    metaRightHtml = "",
    footerHtml = "",
    innerOnly = false,
  } = {}
) {
  const isPositive = section === "positive_news";
  const defaultSent = isPositive ? "very_positive" : "neutral";
  const fallbackText = isPositive ? "" : `${story.headline || ""} ${story.summary || ""}`;
  const sentimentHtml = renderSentimentRing(story.sentiment, fallbackText, defaultSent);

  const editionBadge = showEditionTag
    ? story.is_afternoon
      ? `<span class="afternoon-pill" title="Added in Afternoon Update">Afternoon</span>`
      : `<span class="morning-pill" title="Published in Morning Briefing">Morning</span>`
    : "";
  const continuedBadge = continued
    ? `<span class="continued-pill" title="Substantially similar to a story from yesterday">From yesterday</span>`
    : "";
  const toggleBtn = continued
    ? `<button type="button" class="card-toggle-btn" aria-expanded="false">Expand &#9662;</button>`
    : "";

  const rightSlot =
    metaRightHtml || (toggleBtn ? `<div class="news-meta-actions">${toggleBtn}</div>` : "");
  const sourcesHtml = (story.sources || []).map(renderSourceChip).join("");
  const calloutHtml = story.why_it_matters
    ? `<div class="why-box"><strong>Why it matters:</strong> ${formatter.highlightSummaryHtml(story.why_it_matters)}</div>`
    : "";

  return renderCardShell({
    className: isPositive ? "positive-card" : `news-card${continued ? " is-collapsed" : ""}`,
    innerOnly,
    bookmarkHtml,
    headerHtml,
    badgeLabel: badgeLabel || story.category || (isPositive ? "Progress" : "News"),
    sentimentHtml,
    metaExtraHtml: `${editionBadge}${continuedBadge}`,
    metaRightHtml: rightSlot,
    headlineHtml: formatter.formatEntitiesInPlain(story.headline),
    summaryHtml: `<p class="news-summary">${formatter.highlightSummaryHtml(story.summary)}</p>`,
    calloutHtml,
    sourcesHtml,
    footerHtml,
  });
}

/**
 * Render a Weekly Briefing story card (science, culture, history, long_reads).
 */
export function renderWeeklyStoryCard(
  item,
  {
    section = "science",
    badgeLabel = "",
    formatter,
    bookmarkHtml = "",
    showSubtypeTag = true,
    headerHtml = "",
    footerHtml = "",
    innerOnly = false,
  } = {}
) {
  const isLongRead = section === "long_reads";
  const headlineUrl = safeUrl(item.sources?.[0]?.url);
  const headlineText = formatter.formatEntitiesInPlain(item.headline);
  const headlineHtml =
    headlineUrl !== "#"
      ? `<a href="${headlineUrl}" target="_blank" rel="noopener noreferrer">${headlineText}</a>`
      : headlineText;
  const sourcesHtml = (item.sources || []).slice(0, 3).map(renderSourceChip).join("");
  const sentimentHtml = isLongRead
    ? ""
    : renderSentimentRing(item.sentiment, `${item.headline || ""} ${item.summary || ""}`);

  let metaRightHtml = "";
  if (showSubtypeTag) {
    if (isLongRead && item.reading_time) {
      metaRightHtml = `<div class="weekly-card-top-right"><span class="reading-time-tag">${escapeHtml(item.reading_time)}</span></div>`;
    } else if (!isLongRead && item.discipline) {
      metaRightHtml = `<div class="weekly-card-top-right"><span class="discipline-tag">${escapeHtml(item.discipline)}</span></div>`;
    }
  }

  const calloutHtml =
    !isLongRead && item.takeaway
      ? `<p class="weekly-takeaway"><span class="weekly-takeaway-label">Takeaway</span>${formatter.highlightSummaryHtml(item.takeaway)}</p>`
      : "";

  const resolvedBadge =
    badgeLabel || (isLongRead ? item.topic || "Essay" : item.category || "Learning");

  return renderCardShell({
    className: "news-card",
    innerOnly,
    bookmarkHtml,
    headerHtml,
    badgeLabel: resolvedBadge,
    sentimentHtml,
    metaRightHtml,
    headlineHtml,
    summaryHtml: `<p class="news-summary">${formatter.highlightSummaryHtml(item.summary)}</p>`,
    calloutHtml,
    sourcesHtml,
    footerHtml,
  });
}

/**
 * Render Around the World (Geology / Cuisine) discovery card.
 * Supports both Weekly map popover/mobile (`variant: "popover"`) and Bookmarks card (`variant: "card"`).
 */
export function renderAroundTheWorldCard(
  item,
  {
    variant = "card",
    formatter,
    bookmarkHtml = "",
    showClose = true,
    headerHtml = "",
    footerHtml = "",
    innerOnly = true,
  } = {}
) {
  const kind = item.kind === "cuisine" ? "cuisine" : "geology";
  const kindLabel = kind === "cuisine" ? "Cuisine" : "Geology";
  const flagHtml = item.country_code ? renderCountryFlagImg(item.country_code.toLowerCase()) : "";
  const coords = fmtCoords(Number(item.lat ?? 0), Number(item.lon ?? 0));
  const wikiTitle = item.wiki_title || item.place || "";
  const wikiUrl = wikiTitle
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(String(wikiTitle).replace(/ /g, "_"))}`
    : "";

  const locRowHtml = `
    <div class="geo-fact-loc-row">
      ${flagHtml}
      <span class="geo-fact-place">${escapeHtml(item.place)}</span>
      ${item.region ? `<span>&middot; ${escapeHtml(item.region)}</span>` : ""}
      <span class="geo-fact-coords">(${escapeHtml(coords)})</span>
    </div>
  `;

  if (variant === "popover") {
    return `
      ${bookmarkHtml}
      <div class="geo-fact-head">
        ${locRowHtml}
        ${showClose ? `<div class="geo-fact-head-actions"><button type="button" class="geo-fact-close" aria-label="Close card">&times;</button></div>` : ""}
      </div>
      <h4 class="geo-fact-title">${formatter.formatEntitiesInPlain(item.title)}</h4>
      <p class="geo-fact-body">${formatter.highlightSummaryHtml(item.fact)}</p>
      <div class="geo-fact-foot">
        <div class="geo-fact-tags">
          <span class="geo-kind-badge is-${kind}">${kindLabel}</span>
          ${renderHashedTag(item.feature_type || kindLabel)}
        </div>
        ${wikiUrl ? `<a class="geo-fact-wiki" href="${escapeHtml(wikiUrl)}" target="_blank" rel="noopener noreferrer">Wikipedia &nearr;</a>` : ""}
      </div>
    `;
  }

  return renderCardShell({
    className: `news-card bm-geo-card is-${kind}`,
    innerOnly,
    bookmarkHtml,
    headerHtml,
    badgeLabel: kindLabel,
    subheaderHtml: locRowHtml,
    headlineHtml: formatter.formatEntitiesInPlain(item.title),
    summaryHtml: `<p class="news-summary">${formatter.highlightSummaryHtml(item.fact)}</p>`,
    sourcesHtml: wikiUrl
      ? `<a class="geo-fact-wiki" href="${escapeHtml(wikiUrl)}" target="_blank" rel="noopener noreferrer">Wikipedia &nearr;</a>`
      : "",
    footerHtml,
  });
}
