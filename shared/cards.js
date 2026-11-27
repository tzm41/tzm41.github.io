/**
 * Unified Editorial Card & Brief Bullet Renderers
 * Shared by Daily Briefing (/briefing/), Weekly Briefing (/weekly/), and Bookmarks (/bookmarks/).
 */

import { escapeHtml, safeUrl, fmtCoords } from "./utils.js";
import { renderSourceChip, renderHashedTag, renderSentimentRing } from "./ui.js";
import { renderCountryFlagImg } from "./entities.js";

const GENERIC_LOCAL_TAGS = new Set([
  "",
  "world",
  "local",
  "news",
  "brief",
  "bay area",
  "china",
  "san francisco",
  "silicon valley",
]);

const LOCAL_TAG_RULES = [
  {
    tag: "Weather",
    re: /\b(?:weather|storm|flood(?:ing|s)?|king tides?|tides?|rain(?:fall)?|wildfire|fire weather|earthquake|quake|heat\s?wave|drought|tsunami|snow|wind advisory|climate)\b|暴雨|洪水|台风|地震|高温|寒潮|气象|预警|降雪|潮汐/i,
  },
  {
    tag: "Sports",
    re: /\b(?:sharks|ducks|warriors|49ers|giants|athletics|earthquakes|nfl|nba|nhl|mlb|mls|olympics?|championship|playoffs?|tournament|coach|stadium|skid|win streak|roster|quarterback|goalie|soccer|basketball|baseball|hockey|tennis|marathon)\b|联赛|夺冠|决赛|球队|体育|足球|篮球|网球|奥运|马拉松/i,
  },
  {
    tag: "Transit",
    re: /\b(?:bart|caltrain|muni|vta|transit|crosswalk|pedestrian|traffic|subway|metro|high-speed rail|rail(?:way|road)?|airport|flight|airline|highway|freeway|bridge|commut(?:e|er|ing)|bike lane|bus route)\b|交通|过街|地铁|高铁|公交|出行|航线|航班|机场|高速|桥梁|无障碍|行人/i,
  },
  {
    tag: "Housing",
    re: /\b(?:housing|rent(?:al|ers)?|home\s?prices?|real estate|mortgage|eviction|homeless(?:ness)?|zoning|affordab(?:le|ility)|apartment|condo|property market|landlord|developer)\b|房地产|楼市|房价|住房|租房|房贷|保障房|拆迁|物业/i,
  },
  {
    tag: "Public Safety",
    re: /\b(?:police|crime|shooting|homicide|arrest(?:ed)?|indict(?:ed|ment)|crash|fatal(?:ity)?|collision|firefighter|emergency|investigation|lawsuit|prosecut(?:or|ion)|court ruling|safety|scam|fraud)\b|警方|案件|事故|身亡|坠毁|起火|火灾|侦办|起诉|法院|安全|诈骗|执法/i,
  },
  {
    tag: "Trade",
    re: /\b(?:tariffs?|trade war|exports?|imports?|customs|duties|sanctions|supply chain|embargo|trade deal|trade talks)\b|关税|贸易|出口|进口|海关|制裁|供应链|外贸/i,
  },
  {
    tag: "Finance",
    re: /\b(?:banks?|banking|loans?|lending|relending|buyback|ipo|stocks?|equities|bonds?|pboc|people's bank|icbc|ccb|boc|yuan|renminbi|central bank|interest rates?|credit|fintech|venture capital|funding round)\b|银行|贷款|回购|增持|股市|央行|利率|融资|债券|金融|资本市场|上市/i,
  },
  {
    tag: "Tech",
    re: /\b(?:ai|artificial intelligence|startups?|semiconductor|chips?|3d printing|additive manufacturing|robotics?|autonomous|ev\b|electric vehicle|software|cloud|data center|biotech|quantum|drone|tech)\b|科技|人工智能|芯片|半导体|增材制造|3D打印|机器人|自动驾驶|新能源车|算力|大模型|初创/i,
  },
  {
    tag: "Health",
    re: /\b(?:hospital|health(?:care)?|clinic|vaccine|outbreak|virus|flu|medical|fda|drug approval|mental health|doctor|nurse|patient)\b|医院|医疗|健康|医保|疫苗|疫情|医药|临床/i,
  },
  {
    tag: "Education",
    re: /\b(?:school|university|college|stanford|berkeley|students?|teachers?|tuition|campus|district|graduation|curriculum)\b|学校|大学|高校|教育|学生|教师|高考|招生|校园/i,
  },
  {
    tag: "Culture",
    re: /\b(?:museum|concert|festival|exhibition|theater|theatre|film|cinema|restaurant|chef|michelin|art(?:s|ist)?|music|opera|heritage|tourism|travel)\b|文化|博物馆|展览|演出|电影|美食|餐饮|旅游|文旅|非遗|艺术/i,
  },
  {
    tag: "Community",
    re: /\b(?:community|thanksgiving|volunteer|charity|nonprofit|neighborhood|civic|tribute|residents?|local leaders?|shelter|food bank|park)\b|社区|公益|志愿|慈善|居民|感恩|民生|养老|助残/i,
  },
  {
    tag: "Policy",
    re: /\b(?:mayor|city council|governor|ballot|measure|ordinance|legislation|lawmakers?|regulator|regulation|ministry|tax|budget|summit|diplomacy|government)\b|政策|监管|法规|条例|政府|部委|市政|预算|税收|峰会|外交/i,
  },
];

/**
 * Resolve a specific topic tag for a Local News story (never repeating the region name
 * like "Bay Area" or "China", and refining generic "World"/"Economy" tags when a more
 * specific local topic is evident in the headline/summary).
 */
export function resolveLocalStoryTag(story, fallbackBadge = "") {
  const rawCat = String(story?.category || "").trim();
  const normCat = rawCat.toLowerCase();
  const text = `${story?.headline || ""} ${story?.summary || ""}`;

  if (rawCat && !GENERIC_LOCAL_TAGS.has(normCat)) {
    if (normCat === "economy") {
      if (LOCAL_TAG_RULES.find((r) => r.tag === "Trade").re.test(text)) return "Trade";
      if (LOCAL_TAG_RULES.find((r) => r.tag === "Finance").re.test(text)) return "Finance";
    }
    return rawCat;
  }

  for (const rule of LOCAL_TAG_RULES) {
    if (rule.re.test(text)) return rule.tag;
  }

  const fb = String(fallbackBadge || "").trim();
  if (fb && !GENERIC_LOCAL_TAGS.has(fb.toLowerCase())) return fb;
  return rawCat && normCat !== "world" ? rawCat : "Local";
}

/**
 * Render Morning/Afternoon Brief, Sunday Digest, or Week in Brief items.
 * Supports `bulletStyle: "regular"` (prose `text`) or `"bullets"` (LLM-generated `points[]`, one news item per line).
 */
export function renderBriefBullets(
  bullets = [],
  {
    highlightSummaryHtml,
    resolveCategory = () => "Brief",
    useFallbackSentiment = true,
    bulletStyle = "regular",
  } = {}
) {
  const isBulletMode = bulletStyle === "bullets";
  return bullets
    .map((item) => {
      const text = typeof item === "string" ? item : item?.text || "";
      const points =
        typeof item === "object" && Array.isArray(item?.points) && item.points.length
          ? item.points
          : [text];
      const category =
        typeof item === "object" && item?.category ? item.category : resolveCategory(text);
      const sentiment = typeof item === "object" ? item?.sentiment : null;
      const bodyHtml = isBulletMode
        ? `<ul class="exec-subbullets">${points
            .map((pt) => `<li>${highlightSummaryHtml(pt)}</li>`)
            .join("")}</ul>`
        : `<span class="exec-text">${highlightSummaryHtml(text)}</span>`;
      return `
        <li>
          <span class="exec-meta">
            ${renderHashedTag(category)}
            ${renderSentimentRing(sentiment, useFallbackSentiment ? text : "")}
          </span>
          ${bodyHtml}
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
  cardId = "",
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
  const idAttr = cardId ? ` data-card-id="${escapeHtml(cardId)}"` : "";
  return `<article class="${escapeHtml(className)}"${idAttr}>${inner}</article>`;
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
  const entityOpts = story.entities?.length ? { entities: story.entities } : {};
  const calloutHtml = story.why_it_matters
    ? `<div class="why-box"><strong>Why it matters:</strong> ${formatter.highlightSummaryHtml(story.why_it_matters, entityOpts)}</div>`
    : "";

  return renderCardShell({
    className: isPositive ? "positive-card" : `news-card${continued ? " is-collapsed" : ""}`,
    cardId: story.id || "",
    innerOnly,
    bookmarkHtml,
    headerHtml,
    badgeLabel: badgeLabel || story.category || (isPositive ? "Progress" : "News"),
    sentimentHtml,
    metaExtraHtml: `${editionBadge}${continuedBadge}`,
    metaRightHtml: rightSlot,
    headlineHtml: formatter.formatEntitiesInPlain(story.headline, new Set(), false, entityOpts),
    summaryHtml: `<p class="news-summary">${formatter.highlightSummaryHtml(story.summary, entityOpts)}</p>`,
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
  const entityOpts = item.entities?.length ? { entities: item.entities } : {};
  const isLongRead = section === "long_reads";
  const headlineUrl = safeUrl(item.sources?.[0]?.url);
  const headlineText = formatter.formatEntitiesInPlain(item.headline, new Set(), false, entityOpts);
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
      ? `<p class="weekly-takeaway"><span class="weekly-takeaway-label">Takeaway</span>${formatter.highlightSummaryHtml(item.takeaway, entityOpts)}</p>`
      : "";

  const resolvedBadge =
    badgeLabel || (isLongRead ? item.topic || "Essay" : item.category || "Learning");

  return renderCardShell({
    className: "news-card",
    cardId: item.id || "",
    innerOnly,
    bookmarkHtml,
    headerHtml,
    badgeLabel: resolvedBadge,
    sentimentHtml,
    metaRightHtml,
    headlineHtml,
    summaryHtml: `<p class="news-summary">${formatter.highlightSummaryHtml(item.summary, entityOpts)}</p>`,
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
