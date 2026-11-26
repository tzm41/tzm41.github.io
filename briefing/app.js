/**
 * Daily Briefing Dashboard — Client Application (Zero-Build ES Module)
 */

const DATA_BASE = "./data";

const state = {
  index: null,
  currentDate: null,
  viewingLatest: true,
  briefing: null,
  priorBriefing: null,
  tickerMap: new Map(),
  inlineTickerRe: null,
  newsCategory: "All",
  marketTimeframe: "1d",
  localRegionId: null,
  localLang: "native",
  localExpanded: false,
};

const els = {
  editionDate: document.getElementById("edition-date"),
  generatedMeta: document.getElementById("generated-meta"),
  dateSelect: document.getElementById("date-select"),
  btnPrevDay: document.getElementById("btn-prev-day"),
  btnNextDay: document.getElementById("btn-next-day"),
  btnExpandAll: document.getElementById("btn-expand-all"),
  themeToggle: document.getElementById("theme-toggle"),
  sourceHealth: document.getElementById("source-health"),
  statusBanner: document.getElementById("status-banner"),
  kpiWrapper: document.getElementById("kpi-wrapper"),
  btnToggleKpi: document.getElementById("btn-toggle-kpi"),
  kpiToggleSummary: document.getElementById("kpi-toggle-summary"),
  kpiStrip: document.getElementById("kpi-strip"),
  synthesisModeTag: document.getElementById("synthesis-mode-tag"),
  executiveList: document.getElementById("executive-list"),
  afternoonPanel: document.getElementById("afternoon-panel"),
  afternoonTimeTag: document.getElementById("afternoon-time-tag"),
  afternoonList: document.getElementById("afternoon-list"),
  newsFilters: document.getElementById("news-filters"),
  newsGrid: document.getElementById("news-grid"),
  marketRegime: document.getElementById("market-regime"),
  marketsLivePill: document.getElementById("markets-live-pill"),
  marketNarrative: document.getElementById("market-narrative"),
  fearGreedCard: document.getElementById("fear-greed-card"),
  watchlistGrid: document.getElementById("watchlist-grid"),
  big7Block: document.getElementById("big7-block"),
  big7Grid: document.getElementById("big7-grid"),
  big7Label: document.getElementById("big7-label"),
  sectorHeatmap: document.getElementById("sector-heatmap"),
  heatmapLabel: document.getElementById("heatmap-label"),
  btnTf1d: document.getElementById("btn-tf-1d"),
  btnTf5d: document.getElementById("btn-tf-5d"),
  btnTf30d: document.getElementById("btn-tf-30d"),
  conflictsOverview: document.getElementById("conflicts-overview"),
  conflictsGrid: document.getElementById("conflicts-grid"),
  politicsPulse: document.getElementById("politics-pulse"),
  polymarketList: document.getElementById("polymarket-list"),
  policyList: document.getElementById("policy-list"),
  topicsList: document.getElementById("topics-list"),
  positiveSection: document.getElementById("positive"),
  positiveNewsSlot: document.getElementById("positive-news-slot"),
  btnMovePositive: document.getElementById("btn-move-positive"),
  localSection: document.getElementById("local-news"),
  localLocationToggle: document.getElementById("local-location-toggle"),
  localLangToggle: document.getElementById("local-lang-toggle"),
  btnToggleLocal: document.getElementById("btn-toggle-local"),
  localNewsBody: document.getElementById("local-news-body"),
  localNewsGrid: document.getElementById("local-news-grid"),
};

/* ---------- Utilities ---------- */

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url) {
  if (!url) return "#";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : "#";
  } catch {
    return "#";
  }
}

function fmtPct(val) {
  const num = Number(val ?? 0);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(2)}%`;
}

function fmtPrice(price, symbol) {
  const num = Number(price ?? 0);
  if (symbol === "^TNX") return `${num.toFixed(2)}%`;
  if (num >= 1000) return num.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtUsdCompact(amount) {
  const num = Number(amount ?? 0);
  if (num >= 1e6) return `$${(num / 1e6).toFixed(1)}M vol`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(0)}K vol`;
  return `$${num.toFixed(0)} vol`;
}

function fmtReadableDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtLocalTimestamp(isoStr) {
  if (!isoStr) return "";
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return isoStr;
  return dt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

const EXPLICIT_BOLD_RE = /\*\*((?:(?!\*\*).)+)\*\*/g;
const FALLBACK_HIGHLIGHT_RE =
  /(?<![\w.$])([+-]?\$\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion|M|B|K))?|[+-]?\d[\d,]*(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b)(?!\w)|(['"][A-Z][^'"]{1,40}['"])/g;

const TICKER_ALIASES = [
  ["S&P 500", "^GSPC"],
  ["Nasdaq", "^IXIC"],
  ["Dow Jones", "^DJI"],
  ["Russell 2000", "^RUT"],
  ["VIX", "^VIX"],
  ["WTI crude", "CL=F"],
  ["Bitcoin", "BTC-USD"],
  ["Nvidia", "NVDA"],
  ["Apple", "AAPL"],
  ["Microsoft", "MSFT"],
  ["Alphabet", "GOOGL"],
  ["Amazon", "AMZN"],
  ["Meta", "META"],
  ["Tesla", "TSLA"],
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTickerMap(markets = {}) {
  const map = new Map();
  const bySym = new Map();
  for (const q of [...(markets.watchlist || []), ...(markets.big7 || [])]) {
    if (!q?.symbol) continue;
    const info = {
      symbol: q.symbol,
      name: q.name,
      price: q.price,
      change_pct: q.change_pct,
      currency: q.symbol.startsWith("^") ? "" : "$",
      hasPrice: true,
    };
    bySym.set(q.symbol, info);
    map.set(q.symbol.replace(/^\^/, ""), info);
  }
  for (const s of markets.sectors || []) {
    if (!s?.symbol) continue;
    const info = {
      symbol: s.symbol,
      name: s.name,
      price: null,
      change_pct: s.change_pct,
      currency: "",
      hasPrice: false,
    };
    bySym.set(s.symbol, info);
    map.set(s.symbol, info);
  }
  for (const [alias, sym] of TICKER_ALIASES) {
    const info = bySym.get(sym);
    if (info) map.set(alias, info);
  }
  for (const mq of markets.mentioned_quotes || []) {
    if (!mq?.symbol) continue;
    const info = {
      symbol: mq.symbol,
      name: mq.name,
      price: mq.price,
      change_pct: mq.change_pct,
      currency: mq.currency ?? "$",
      hasPrice: true,
    };
    map.set(mq.symbol.replace(/^\^/, ""), info);
    for (const alias of mq.aliases || []) {
      if (alias) map.set(alias, info);
    }
  }
  state.tickerMap = map;

  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  if (keys.length) {
    const parts = keys.map((k) => {
      const esc = escapeRegex(k);
      return /^[\x00-\x7F]+$/.test(k) ? `\\b${esc}\\b` : esc;
    });
    state.inlineTickerRe = new RegExp(`(${parts.join("|")})`, "g");
  } else {
    state.inlineTickerRe = null;
  }
}

function formatTickerTip(info) {
  const pct = fmtPct(info.change_pct);
  const cleanSym = info.symbol.replace(/^\^/, "");
  if (info.hasPrice) {
    const cur = info.currency || "";
    return `${cleanSym} · ${cur}${fmtPrice(info.price, info.symbol)} (1D: ${pct})`;
  }
  return `${cleanSym} · ${info.name} (1D: ${pct})`;
}

const EXPLICIT_ITALIC_RE = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;

const NON_PERSON_TITLE_WORD =
  "(?:Reinstatement|Leadership|Resignation|Nomination|Election|Administration|Succession|Investigation|Hearing|Policy|Orders?|Return|Ouster|Exit|Role|Office|Vote|Race|Campaign|Debate|Summit|Visit|Meeting|Statement|Scrutiny|Backlash|Reversal|Power|Term|Authority|Pardon|Veto|Cabinet|Race|Approval|Poll|Polls)\\b";

const PERSON_NAME_RE = new RegExp(
  `((?:President|Prime Minister|Attorney General|Secretary|Chairman|Sen\\.-elect|Sen\\.|Rep\\.|Gov\\.|Dr\\.)\\s+(?!${NON_PERSON_TITLE_WORD})[A-Z][a-zA-ZÀ-ÿ'-]+(?:\\s+(?!${NON_PERSON_TITLE_WORD})[A-Z][a-zA-ZÀ-ÿ'-]+){0,2}|CEO\\s+(?!${NON_PERSON_TITLE_WORD})[A-Z][a-zA-ZÀ-ÿ'-]+\\s+(?!${NON_PERSON_TITLE_WORD})[A-Z][a-zA-ZÀ-ÿ'-]+|\\b(?:Jensen Huang|Donald Trump Jr\\.|Donald Trump|Benjamin Netanyahu|Netanyahu|Trump|Joe Biden|Biden|Kamala Harris|JD Vance|Chuck Schumer|Mike Johnson|Jimmy Gomez|Jamie Raskin|Ilhan Omar|Kilmar [ÁA]brego Garc[íi]a|Abrego Garcia|Abdul El-Sayed|Scott Colom|Puma Shen|Lai Ching-te|Guo Jiakun|Xi Jinping|Chen Jining|Raphael Warnock|Zohran Mamdani|Nick Fuentes|David Lisnard)\\b|赖清德|沈伯洋|郭嘉昆|黄仁勋|特朗普|陈吉宁)`,
  "g"
);

const COMPANY_LOGOS = {
  Nvidia: "nvidia.com",
  NVIDIA: "nvidia.com",
  英伟达: "nvidia.com",
  Apple: "apple.com",
  苹果: "apple.com",
  Microsoft: "microsoft.com",
  微软: "microsoft.com",
  Alphabet: "google.com",
  Google: "google.com",
  谷歌: "google.com",
  Amazon: "amazon.com",
  亚马逊: "amazon.com",
  Meta: "meta.com",
  Tesla: "tesla.com",
  特斯拉: "tesla.com",
  Anthropic: "anthropic.com",
  OpenAI: "openai.com",
  DeepSeek: "deepseek.com",
  xAI: "x.ai",
  Perplexity: "perplexity.ai",
  Huawei: "huawei.com",
  华为: "huawei.com",
  TSMC: "tsmc.com",
  台积电: "tsmc.com",
  Samsung: "samsung.com",
  三星: "samsung.com",
  ByteDance: "bytedance.com",
  字节跳动: "bytedance.com",
  TikTok: "tiktok.com",
  Alibaba: "alibaba.com",
  阿里巴巴: "alibaba.com",
  Tencent: "tencent.com",
  腾讯: "tencent.com",
  Baidu: "baidu.com",
  百度: "baidu.com",
  Xiaomi: "mi.com",
  小米: "mi.com",
  BYD: "byd.com",
  比亚迪: "byd.com",
  CATL: "catl.com",
  宁德时代: "catl.com",
  Meituan: "meituan.com",
  美团: "meituan.com",
  "JD.com": "jd.com",
  京东: "jd.com",
  PDD: "pddholdings.com",
  拼多多: "pddholdings.com",
  Intel: "intel.com",
  AMD: "amd.com",
  Broadcom: "broadcom.com",
  Qualcomm: "qualcomm.com",
  ASML: "asml.com",
  Oracle: "oracle.com",
  Netflix: "netflix.com",
  SpaceX: "spacex.com",
  Boeing: "boeing.com",
  Toyota: "toyota.com",
  Sony: "sony.com",
  Nintendo: "nintendo.com",
  Disney: "disney.com",
  Walmart: "walmart.com",
  Costco: "costco.com",
  JPMorgan: "jpmorganchase.com",
  "Goldman Sachs": "goldmansachs.com",
  Palantir: "palantir.com",
  Salesforce: "salesforce.com",
  Adobe: "adobe.com",
  Uber: "uber.com",
  Stripe: "stripe.com",
  Spotify: "spotify.com",
  IBM: "ibm.com",
  Cisco: "cisco.com",
  SoftBank: "softbank.jp",
  Cloudflare: "cloudflare.com",
  CrowdStrike: "crowdstrike.com",
  Snowflake: "snowflake.com",
  Databricks: "databricks.com",
  Coinbase: "coinbase.com",
  Visa: "visa.com",
  Mastercard: "mastercard.com",
  Pfizer: "pfizer.com",
  "Eli Lilly": "lilly.com",
  "Novo Nordisk": "novonordisk.com",
  ExxonMobil: "exxonmobil.com",
  Chevron: "chevron.com",
  "Saudi Aramco": "aramco.com",
};

const COUNTRY_FLAGS = {
  "United States": "us",
  "U.S.": "us",
  US: "us",
  American: "us",
  Americans: "us",
  美国: "us",
  China: "cn",
  Chinese: "cn",
  中国大陆: "cn",
  中国: "cn",
  Taiwan: "tw",
  Taiwanese: "tw",
  台湾: "tw",
  "Hong Kong": "hk",
  香港: "hk",
  Japan: "jp",
  Japanese: "jp",
  日本: "jp",
  "South Korea": "kr",
  "South Korean": "kr",
  韩国: "kr",
  "North Korea": "kp",
  "North Korean": "kp",
  朝鲜: "kp",
  Russia: "ru",
  Russian: "ru",
  Russians: "ru",
  俄罗斯: "ru",
  Ukraine: "ua",
  Ukrainian: "ua",
  Ukrainians: "ua",
  乌克兰: "ua",
  Israel: "il",
  Israeli: "il",
  Israelis: "il",
  以色列: "il",
  Palestine: "ps",
  Palestinian: "ps",
  Palestinians: "ps",
  "Gaza City": "ps",
  Gaza: "ps",
  Iran: "ir",
  Iranian: "ir",
  Iranians: "ir",
  伊朗: "ir",
  "Saudi Arabia": "sa",
  Saudi: "sa",
  沙特: "sa",
  Yemen: "ye",
  Yemeni: "ye",
  Lebanon: "lb",
  Lebanese: "lb",
  Syria: "sy",
  Syrian: "sy",
  Iraq: "iq",
  Iraqi: "iq",
  Egypt: "eg",
  Egyptian: "eg",
  Libya: "ly",
  Libyan: "ly",
  Turkey: "tr",
  Turkish: "tr",
  UAE: "ae",
  Emirati: "ae",
  Qatar: "qa",
  Qatari: "qa",
  Jordan: "jo",
  Jordanian: "jo",
  "European Union": "eu",
  European: "eu",
  Europeans: "eu",
  EU: "eu",
  欧盟: "eu",
  "United Kingdom": "gb",
  UK: "gb",
  Britain: "gb",
  British: "gb",
  英国: "gb",
  France: "fr",
  French: "fr",
  法国: "fr",
  Germany: "de",
  German: "de",
  德国: "de",
  Italy: "it",
  Italian: "it",
  Spain: "es",
  Spanish: "es",
  Poland: "pl",
  Polish: "pl",
  Netherlands: "nl",
  Dutch: "nl",
  Switzerland: "ch",
  Swiss: "ch",
  Sweden: "se",
  Swedish: "se",
  Norway: "no",
  Norwegian: "no",
  Finland: "fi",
  Finnish: "fi",
  Greece: "gr",
  Greek: "gr",
  Ireland: "ie",
  Irish: "ie",
  Belgium: "be",
  Belgian: "be",
  Austria: "at",
  Austrian: "at",
  Portugal: "pt",
  Portuguese: "pt",
  Denmark: "dk",
  Danish: "dk",
  Canada: "ca",
  Canadian: "ca",
  加拿大: "ca",
  Mexico: "mx",
  Mexican: "mx",
  墨西哥: "mx",
  Brazil: "br",
  Brazilian: "br",
  Argentina: "ar",
  Argentine: "ar",
  Venezuela: "ve",
  Venezuelan: "ve",
  Colombia: "co",
  Colombian: "co",
  Cuba: "cu",
  Cuban: "cu",
  "El Salvador": "sv",
  Salvadoran: "sv",
  India: "in",
  Indian: "in",
  印度: "in",
  Pakistan: "pk",
  Pakistani: "pk",
  Australia: "au",
  Australian: "au",
  澳大利亚: "au",
  "New Zealand": "nz",
  Singapore: "sg",
  Singaporean: "sg",
  新加坡: "sg",
  Vietnam: "vn",
  Vietnamese: "vn",
  Philippines: "ph",
  Filipino: "ph",
  Indonesia: "id",
  Indonesian: "id",
  Thailand: "th",
  Thai: "th",
  Malaysia: "my",
  Malaysian: "my",
  Myanmar: "mm",
  "South Africa": "za",
  "South African": "za",
  Nigeria: "ng",
  Nigerian: "ng",
  Sudan: "sd",
  Sudanese: "sd",
  Ethiopia: "et",
  Ethiopian: "et",
  Kenya: "ke",
  Kenyan: "ke",
  "United Nations": "un",
  UN: "un",
  联合国: "un",
};

const US_PARTY_TAGS = {
  "Democratic Party": "dem",
  "Senate Democrats": "dem",
  "House Democrats": "dem",
  Democrats: "dem",
  Democrat: "dem",
  Democratic: "dem",
  DNC: "dem",
  "Republican Party": "gop",
  "Senate Republicans": "gop",
  "House Republicans": "gop",
  Republicans: "gop",
  Republican: "gop",
  GOP: "gop",
  RNC: "gop",
};

const PARTY_ICONS = {
  dem: `<svg class="inline-party-icon" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#1d6fe2"/><text x="8" y="11.6" text-anchor="middle" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="10.5" font-weight="800">D</text></svg>`,
  gop: `<svg class="inline-party-icon" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#d93829"/><text x="8" y="11.6" text-anchor="middle" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="10.5" font-weight="800">R</text></svg>`,
};

const ENTITY_DECORATOR_RE = (() => {
  const keys = [
    ...new Set([
      ...Object.keys(COMPANY_LOGOS),
      ...Object.keys(COUNTRY_FLAGS),
      ...Object.keys(US_PARTY_TAGS),
    ]),
  ].sort((a, b) => b.length - a.length);
  const parts = keys.map((k) => {
    const esc = escapeRegex(k);
    if (!/^[\x00-\x7F]+$/.test(k)) return esc;
    const prefix = /^\w/.test(k) ? "\\b" : "";
    const suffix = /\w$/.test(k) ? "\\b" : "";
    return `${prefix}${esc}${suffix}`;
  });
  return new RegExp(`(${parts.join("|")})`, "g");
})();

function renderCompanyLogoImg(domain) {
  const src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  return `<img class="inline-logo" src="${src}" width="14" height="14" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none'">`;
}

function renderCountryFlagImg(code) {
  const src = `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${encodeURIComponent(code)}.svg`;
  return `<img class="inline-flag-icon" src="${src}" width="16" height="12" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none'">`;
}

function decorateFlagsAndLogos(segment, seen = new Set()) {
  if (!segment) return "";
  ENTITY_DECORATOR_RE.lastIndex = 0;
  let out = "";
  let last = 0;
  for (const m of segment.matchAll(ENTITY_DECORATOR_RE)) {
    const token = m[0];
    const idx = m.index ?? 0;
    if (idx > last) out += escapeHtml(segment.slice(last, idx));
    const domain = COMPANY_LOGOS[token];
    const flagCode = COUNTRY_FLAGS[token];
    const party = US_PARTY_TAGS[token];
    if (domain) {
      const key = `logo:${domain}`;
      if (seen.has(key)) {
        out += escapeHtml(token);
      } else {
        seen.add(key);
        out += `${renderCompanyLogoImg(domain)}${escapeHtml(token)}`;
      }
    } else if (flagCode) {
      const key = `flag:${flagCode}`;
      let flagHtml = "";
      if (!seen.has(key)) {
        seen.add(key);
        flagHtml = renderCountryFlagImg(flagCode);
      }
      out += `<span class="country-mention">${flagHtml}${escapeHtml(token)}</span>`;
    } else if (party) {
      const key = `party:${party}`;
      let iconHtml = "";
      if (!seen.has(key)) {
        seen.add(key);
        iconHtml = PARTY_ICONS[party] || "";
      }
      out += `<span class="party-mention ${party}">${iconHtml}${escapeHtml(token)}</span>`;
    } else {
      out += escapeHtml(token);
    }
    last = idx + token.length;
  }
  if (last < segment.length) out += escapeHtml(segment.slice(last));
  return out;
}

function formatEntitiesInPlain(segment, seen = new Set()) {
  if (!segment) return "";
  EXPLICIT_ITALIC_RE.lastIndex = 0;
  if (EXPLICIT_ITALIC_RE.test(segment)) {
    EXPLICIT_ITALIC_RE.lastIndex = 0;
    let out = "";
    let last = 0;
    for (const m of segment.matchAll(EXPLICIT_ITALIC_RE)) {
      const idx = m.index ?? 0;
      if (idx > last) out += decorateFlagsAndLogos(segment.slice(last, idx), seen);
      out += `<em>${escapeHtml(m[1])}</em>`;
      last = idx + m[0].length;
    }
    if (last < segment.length) out += decorateFlagsAndLogos(segment.slice(last), seen);
    return out;
  }

  PERSON_NAME_RE.lastIndex = 0;
  let out = "";
  let last = 0;
  for (const m of segment.matchAll(PERSON_NAME_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out += decorateFlagsAndLogos(segment.slice(last, idx), seen);
    out += `<em>${escapeHtml(m[0])}</em>`;
    last = idx + m[0].length;
  }
  if (last < segment.length) out += decorateFlagsAndLogos(segment.slice(last), seen);
  return out;
}

function escapeWithTickers(segment, seen = new Set()) {
  if (!segment) return "";
  if (!state.tickerMap.size || !state.inlineTickerRe) {
    return formatEntitiesInPlain(segment, seen);
  }
  state.inlineTickerRe.lastIndex = 0;
  let out = "";
  let lastIdx = 0;
  for (const match of segment.matchAll(state.inlineTickerRe)) {
    const token = match[0];
    const info = state.tickerMap.get(token);
    if (!info) continue;
    const idx = match.index ?? 0;
    if (idx > lastIdx) out += formatEntitiesInPlain(segment.slice(lastIdx, idx), seen);
    const cls = deltaClass(info.change_pct);
    const tip = formatTickerTip(info);
    const domain = COMPANY_LOGOS[token] || COMPANY_LOGOS[info.name];
    let logoHtml = "";
    if (domain) {
      const key = `logo:${domain}`;
      if (!seen.has(key)) {
        seen.add(key);
        logoHtml = renderCompanyLogoImg(domain);
      }
    }
    out += `<span class="ticker-tag ${cls}" tabindex="0" data-ticker-sym="${escapeHtml(info.symbol)}" data-ticker-tip="${escapeHtml(tip)}" title="${escapeHtml(tip)}">${logoHtml}${escapeHtml(token)}</span>`;
    lastIdx = idx + token.length;
  }
  if (lastIdx < segment.length) out += formatEntitiesInPlain(segment.slice(lastIdx), seen);
  return out;
}

function highlightSummaryHtml(text) {
  const raw = String(text ?? "");
  if (!raw) return "";

  const seen = new Set();
  EXPLICIT_BOLD_RE.lastIndex = 0;
  const hasExplicit = EXPLICIT_BOLD_RE.test(raw);
  const re = hasExplicit ? EXPLICIT_BOLD_RE : FALLBACK_HIGHLIGHT_RE;
  re.lastIndex = 0;

  let out = "";
  let lastIdx = 0;
  for (const match of raw.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > lastIdx) {
      out += escapeWithTickers(raw.slice(lastIdx, idx), seen);
    }
    const inner = hasExplicit ? match[1] : match[0];
    out += `<strong>${escapeWithTickers(inner, seen)}</strong>`;
    lastIdx = idx + match[0].length;
  }
  if (lastIdx < raw.length) {
    out += escapeWithTickers(raw.slice(lastIdx), seen);
  }
  return out;
}

function deltaClass(val) {
  const num = Number(val ?? 0);
  if (num > 0.02) return "pos";
  if (num < -0.02) return "neg";
  return "flat";
}

function buildSparklineSvg(values, color, className = "sparkline", interactive = false) {
  if (!Array.isArray(values) || values.length < 2) {
    return `<svg class="${className}" viewBox="0 0 120 32" aria-hidden="true"><line x1="0" y1="16" x2="120" y2="16" stroke="currentColor" stroke-opacity="0.2" stroke-dasharray="3 3"/></svg>`;
  }
  const w = 120;
  const h = 32;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = pts.join(" ");
  const area = `0,${h} ${polyline} ${w},${h}`;

  if (!interactive) {
    return `
      <svg class="${className}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="${area}" fill="${color}" fill-opacity="0.12"></polygon>
        <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
    `;
  }

  return `
    <svg class="${className}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="${area}" fill="${color}" fill-opacity="0.12"></polygon>
      <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>
      <line class="spark-guide" x1="0" y1="0" x2="0" y2="${h}"></line>
      <circle class="spark-dot" cx="0" cy="0" r="2.8" fill="${color}"></circle>
    </svg>
  `;
}

function sectorTileStyle(pct) {
  const clamped = Math.max(-3.5, Math.min(3.5, Number(pct ?? 0)));
  const intensity = Math.abs(clamped) / 3.5;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";

  if (Math.abs(clamped) < 0.08) {
    return isDark
      ? "background:#222832; color:#d8dce4;"
      : "background:#eceae4; color:#2b303a;";
  }

  if (clamped > 0) {
    const alpha = (0.14 + intensity * 0.48).toFixed(2);
    const text = intensity > 0.55 ? "#ffffff" : isDark ? "#b8f2d8" : "#0e4d2f";
    return `background:rgba(21, 115, 71, ${alpha}); color:${text};`;
  } else {
    const alpha = (0.14 + intensity * 0.48).toFixed(2);
    const text = intensity > 0.55 ? "#ffffff" : isDark ? "#ffd2cc" : "#6e1c14";
    return `background:rgba(185, 56, 44, ${alpha}); color:${text};`;
  }
}

/* ---------- Theme ---------- */

const THEME_ORDER = ["system", "light", "dark"];

const THEME_ICONS = {
  system: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/></svg>`,
  light: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2.5 12h2M19.5 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>`,
  dark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
};

const THEME_LABELS = {
  system: "Theme: Auto (switch to Light)",
  light: "Theme: Light (switch to Dark)",
  dark: "Theme: Dark (switch to Auto)",
};

function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyThemePreference(pref) {
  const validPref = THEME_ORDER.includes(pref) ? pref : "system";
  const resolved = resolveTheme(validPref);
  document.documentElement.setAttribute("data-theme", resolved);

  if (els.themeToggle) {
    els.themeToggle.dataset.themePref = validPref;
    els.themeToggle.innerHTML = THEME_ICONS[validPref];
    const label = THEME_LABELS[validPref];
    els.themeToggle.setAttribute("aria-label", label);
    els.themeToggle.setAttribute("title", label);
  }

  if (state.briefing) renderSectorHeatmap(state.briefing.markets);
}

function initTheme() {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  const saved = localStorage.getItem("briefing-theme") || "system";
  applyThemePreference(saved);

  els.themeToggle?.addEventListener("click", () => {
    const cur = localStorage.getItem("briefing-theme") || "system";
    const idx = THEME_ORDER.indexOf(cur);
    const nextPref = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    localStorage.setItem("briefing-theme", nextPref);
    applyThemePreference(nextPref);
  });

  media?.addEventListener?.("change", () => {
    if ((localStorage.getItem("briefing-theme") || "system") === "system") {
      applyThemePreference("system");
    }
  });
}

/* ---------- Rendering ---------- */

function renderSourceHealth(health = {}) {
  const labels = [
    ["news", "News"],
    ["markets", "Markets"],
    ["conflicts", "Conflicts"],
    ["politics", "Politics"],
  ];
  els.sourceHealth.innerHTML = labels
    .map(([key, label]) => {
      const status = health[key] || "ok";
      return `<span class="health-item" title="${label}: ${status}"><span class="health-dot ${escapeHtml(status)}"></span>${label}</span>`;
    })
    .join("");
}

function renderKpiStrip(briefing) {
  const watchlist = briefing.markets?.watchlist || [];
  const bySym = Object.fromEntries(watchlist.map((q) => [q.symbol, q]));
  const sp = bySym["^GSPC"];
  const vix = bySym["^VIX"];
  const tnx = bySym["^TNX"];
  const theaters = briefing.conflicts?.theaters || [];
  const topTheater = theaters.length
    ? [...theaters].sort((a, b) => (b.intensity_score || 0) - (a.intensity_score || 0))[0]
    : null;

  const cards = [];
  if (sp) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">S&amp;P 500</div>
        <div class="kpi-value-row">
          <span class="kpi-value">${fmtPrice(sp.price, sp.symbol)}</span>
          <span class="delta-pill ${deltaClass(sp.change_pct)}">${fmtPct(sp.change_pct)}</span>
        </div>
        <div class="kpi-sub">5D: ${fmtPct(sp.change_5d_pct)}</div>
      </div>
    `);
  }
  if (vix) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">VIX Volatility</div>
        <div class="kpi-value-row">
          <span class="kpi-value">${fmtPrice(vix.price, vix.symbol)}</span>
          <span class="delta-pill ${deltaClass(-vix.change_pct)}">${fmtPct(vix.change_pct)}</span>
        </div>
        <div class="kpi-sub">Regime: ${escapeHtml(briefing.markets?.regime_tag || "Mixed")}</div>
      </div>
    `);
  }
  if (tnx) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">US 10Y Yield</div>
        <div class="kpi-value-row">
          <span class="kpi-value">${fmtPrice(tnx.price, tnx.symbol)}</span>
          <span class="delta-pill ${deltaClass(tnx.change_pct)}">${fmtPct(tnx.change_pct)}</span>
        </div>
        <div class="kpi-sub">Benchmark Treasury</div>
      </div>
    `);
  }
  if (topTheater) {
    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">Highest Conflict Activity</div>
        <div class="kpi-value-row">
          <span class="kpi-value" style="font-size:15px;">${escapeHtml(topTheater.region)}</span>
          <span class="status-badge ${escapeHtml(topTheater.status)}">${escapeHtml(topTheater.status)}</span>
        </div>
        <div class="kpi-sub">${escapeHtml(topTheater.name)}</div>
      </div>
    `);
  }
  els.kpiStrip.innerHTML = cards.join("");
  if (els.kpiToggleSummary) {
    els.kpiToggleSummary.textContent = sp
      ? `S&P 500 ${fmtPrice(sp.price, sp.symbol)} (${fmtPct(sp.change_pct)}) · ${cards.length} Signals`
      : "Market & Signal Snapshot";
  }
}

function fmtLocalTimeOnly(isoStr) {
  if (!isoStr) return "";
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return isoStr;
  return dt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function renderBriefBullets(bullets = []) {
  return bullets
    .map((item) => {
      const text = typeof item === "string" ? item : item?.text || "";
      const category =
        typeof item === "object" && item?.category
          ? item.category
          : inferCategoryFromText(text);
      const sentiment =
        typeof item === "object" && item?.sentiment && SENTIMENT_LABELS[item.sentiment]
          ? item.sentiment
          : inferSentimentFromText(text);
      return `
        <li>
          <span class="exec-meta">
            ${renderSentimentRing(sentiment)}
            <span class="cat-pill">${escapeHtml(category)}</span>
          </span>
          <span class="exec-text">${highlightSummaryHtml(text)}</span>
        </li>
      `;
    })
    .join("");
}

function renderExecutiveBrief(briefing) {
  els.synthesisModeTag.textContent = fmtLocalTimeOnly(briefing.generated_at);
  els.synthesisModeTag.title = `Generated ${fmtLocalTimestamp(briefing.generated_at)}`;

  const bullets = briefing.executive_brief || [];
  if (!bullets.length) {
    els.executiveList.innerHTML = `<li>No executive summary items available for this edition.</li>`;
  } else {
    els.executiveList.innerHTML = renderBriefBullets(bullets);
  }

  const afternoon = briefing.afternoon_brief;
  if (els.afternoonPanel && els.afternoonList) {
    if (afternoon && Array.isArray(afternoon.bullets) && afternoon.bullets.length) {
      els.afternoonPanel.classList.remove("hidden");
      if (els.afternoonTimeTag) {
        els.afternoonTimeTag.textContent = fmtLocalTimeOnly(afternoon.generated_at);
        els.afternoonTimeTag.title = `Generated ${fmtLocalTimestamp(afternoon.generated_at)}`;
      }
      els.afternoonList.innerHTML = renderBriefBullets(afternoon.bullets);
    } else {
      els.afternoonPanel.classList.add("hidden");
      els.afternoonList.innerHTML = "";
    }
  }
}

const SIMILAR_STOPWORDS = new Set([
  "about", "after", "again", "against", "amid", "because", "before", "being",
  "between", "could", "first", "from", "have", "into", "more", "most", "over",
  "said", "says", "since", "some", "still", "than", "that", "their", "them",
  "then", "there", "these", "they", "this", "through", "today", "under",
  "very", "were", "what", "when", "where", "which", "while", "will", "with",
  "would", "year", "years",
]);

function contentTokens(text) {
  const words = String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const set = new Set();
  for (const w of words) {
    if (!SIMILAR_STOPWORDS.has(w)) set.add(w);
  }
  return set;
}

function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter += 1;
  }
  return inter / (setA.size + setB.size - inter);
}

function isContinuedFromPrior(story, priorStories = []) {
  if (story.continued_from_prior) return true;
  if (!Array.isArray(priorStories) || !priorStories.length) return false;
  const hCur = contentTokens(story.headline);
  const fCur = contentTokens(`${story.headline || ""} ${story.summary || ""}`);
  for (const prev of priorStories) {
    if (jaccard(hCur, contentTokens(prev.headline)) >= 0.42) return true;
    if (jaccard(fCur, contentTokens(`${prev.headline || ""} ${prev.summary || ""}`)) >= 0.35) {
      return true;
    }
  }
  return false;
}

function buildHalfRingSvg(pos, dotColor) {
  // pos in [0, 1]: 0 = far left, 0.5 = top center, 1 = far right
  const t = Math.max(0.05, Math.min(0.95, Number(pos ?? 0.5)));
  const angle = Math.PI * (1 - t);
  const cx = 12 + 9 * Math.cos(angle);
  const cy = 12 - 9 * Math.sin(angle);
  return `
    <svg class="half-ring-svg" viewBox="0 0 24 15" aria-hidden="true">
      <path class="half-ring-track" d="M 3 12 A 9 9 0 0 1 21 12"></path>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.8" fill="${dotColor}" stroke="var(--surface)" stroke-width="1.1"></circle>
    </svg>
  `;
}

const SOURCE_BIAS_RULES = [
  [/reuters|ap news|associated press/i, "Center · Wire", "center", 0.5],
  [/bloomberg|cnbc|financial times|ft中文网|wall street journal|wsj|marketplace/i, "Center · Business", "center", 0.5],
  [/bbc/i, "Center-Left · Public", "left", 0.36],
  [/the hill|politico|courthouse news|stars and stripes/i, "Center", "center", 0.5],
  [/deutsche welle|rfi|al jazeera/i, "Center-Left · Int'l public", "left", 0.36],
  [/npr/i, "Lean Left · Public", "left", 0.24],
  [/new york times|纽约时报|washington post|sacramento bee|ktvu|abc news/i, "Lean Left", "left", 0.24],
  [/guardian/i, "Left-Center", "left", 0.28],
  [/fox news|new york post/i, "Lean Right", "right", 0.78],
  [/arstechnica|ars technica|the verge|good news network|solidot/i, "Center · Tech / Specialty", "center", 0.5],
  [/中新网|新华社|人民日报|外交部|cgtn|global times/i, "State-affiliated (CN)", "state", 0.5],
  [/澎湃|thepaper/i, "State-owned (CN) · Urban", "state", 0.5],
  [/财新|caixin|第一财经|yicai|界面|jiemian/i, "Business / Market (CN)", "center", 0.5],
  [/google news/i, "Aggregator", "neutral", 0.5],
];

const BIAS_TONE_COLOR = {
  center: "var(--bias-center)",
  left: "var(--bias-left)",
  right: "var(--bias-right)",
  state: "var(--bias-state)",
  neutral: "var(--ink-muted)",
};

function lookupSourceBias(name) {
  const s = String(name || "").trim();
  if (!s) return null;
  for (const [re, label, tone, pos] of SOURCE_BIAS_RULES) {
    if (re.test(s)) return { text: label, tone, pos };
  }
  return null;
}

function renderSourceChip(src) {
  const bias = lookupSourceBias(src.name);
  const biasAttr = bias
    ? ` data-bias="${escapeHtml(bias.text)}" data-bias-tone="${escapeHtml(bias.tone)}" data-bias-pos="${bias.pos}"`
    : "";
  return `<a class="source-chip"${biasAttr} href="${safeUrl(src.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.name)} &nearr;</a>`;
}

const SENTIMENT_META = {
  very_negative: { label: "Very Negative", pos: 0.06, color: "var(--sent-very-neg)" },
  negative: { label: "Negative", pos: 0.2, color: "var(--sent-neg)" },
  slightly_negative: { label: "Slightly Negative", pos: 0.35, color: "var(--sent-slight-neg)" },
  neutral: { label: "Neutral", pos: 0.5, color: "var(--sent-neutral)" },
  slightly_positive: { label: "Slightly Positive", pos: 0.65, color: "var(--sent-slight-pos)" },
  positive: { label: "Positive", pos: 0.8, color: "var(--sent-pos)" },
  very_positive: { label: "Very Positive", pos: 0.94, color: "var(--sent-very-pos)" },
};

const SENTIMENT_LABELS = Object.fromEntries(
  Object.entries(SENTIMENT_META).map(([k, v]) => [k, v.label])
);

const NEGATIVE_SENTIMENT_RE =
  /\b(guilty|convict\w*|outage|code red|sell-?off|slump|plunge|slide[sd]?|drop(?:s|ped)?|fall(?:s|ing)?|fell|dead|death\w*|kill\w*|strike\w*|attack\w*|cyberattack\w*|hack\w*|war|blockade|paralys\w*|flood\w*|lawsuit|challenge|fakes?|smear|disinformation|scandal|resign\w*|tariff\w*|friction|scrutiny|probe|investigat\w*|deport\w*|crash|crisis|decline|violat\w*|sanction\w*)\b|加征关税|关税|攻击|抹黑|判死刑|窃取|摩擦|虚假信息|危机|冲突/gi;

const POSITIVE_SENTIMENT_RE =
  /\b(breakthrough|rally|rallies|surge[sd]?|gain\w*|advance[sd]?|recover\w*|success|milestone|celebrat\w*|award\w*|approv\w*|cure[sd]?|boost\w*|growth|record high|peace|ceasefire|accord|treaty|draw(?:s|ing)? crowds|reopen\w*|reduced the risk|durable)\b|获批|突破|增长|里程碑|和平|停火|复苏|创新高/gi;

function inferSentimentFromText(text) {
  const neg = (text.match(NEGATIVE_SENTIMENT_RE) || []).length;
  const pos = (text.match(POSITIVE_SENTIMENT_RE) || []).length;
  const score = pos - neg;
  if (score <= -4) return "very_negative";
  if (score <= -2) return "negative";
  if (score === -1) return "slightly_negative";
  if (score === 1) return "slightly_positive";
  if (score >= 4) return "very_positive";
  if (score >= 2) return "positive";
  return "neutral";
}

function resolveStorySentiment(story) {
  if (story?.sentiment && SENTIMENT_LABELS[story.sentiment] && story.sentiment !== "neutral") {
    return story.sentiment;
  }
  return inferSentimentFromText(`${story?.headline || ""} ${story?.summary || ""}`);
}

function inferCategoryFromText(text) {
  const s = String(text || "");
  if (/\b(nasdaq|s&p|dow|russell|market|stock|tariff|inflation|yield|bitcoin|oil|fed)\b/i.test(s)) return "Economy";
  if (/\b(nvidia|huawei|microsoft|apple|ai\b|chip|tech|cloud|cyber)\b/i.test(s)) return "Tech";
  if (/\b(congress|senate|house|lawmaker|white house|trump|rep\.|doj|court|deport)\b/i.test(s)) return "Policy";
  if (/\b(science|trial|bacteria|virus|climate|space|health)\b/i.test(s)) return "Science";
  return "World";
}

function renderSentimentRing(sentiment) {
  const key = SENTIMENT_META[sentiment] ? sentiment : "neutral";
  const { label, pos, color } = SENTIMENT_META[key];
  return `<span class="sentiment-gauge" tabindex="0" role="img" aria-label="Sentiment: ${escapeHtml(label)}" data-sentiment="${escapeHtml(key)}" data-tooltip="${escapeHtml(label)}" title="${escapeHtml(label)}">${buildHalfRingSvg(pos, color)}</span>`;
}

function renderNewsCard(story, badgeLabel, continued, showEditionTag = false) {
  const sourcesHtml = (story.sources || []).map(renderSourceChip).join("");
  const sentiment = resolveStorySentiment(story);

  const toggleBtn = continued
    ? `<button type="button" class="card-toggle-btn" aria-expanded="false">Expand &#9662;</button>`
    : "";
  const editionBadge = showEditionTag
    ? story.is_afternoon
      ? `<span class="afternoon-pill" title="Added in Afternoon Update">Afternoon</span>`
      : `<span class="morning-pill" title="Published in Morning Briefing">Morning</span>`
    : "";
  const continuedBadge = continued
    ? `<span class="continued-pill" title="Substantially similar to a story from yesterday">From yesterday</span>`
    : "";

  return `
    <article class="news-card${continued ? " is-collapsed" : ""}">
      <div class="news-meta">
        <div class="news-card-badges">
          <span class="cat-pill">${escapeHtml(badgeLabel)}</span>
          ${renderSentimentRing(sentiment)}
          ${editionBadge}
          ${continuedBadge}
        </div>
        ${toggleBtn}
      </div>
      <h3>${formatEntitiesInPlain(story.headline)}</h3>
      <p class="news-summary">${highlightSummaryHtml(story.summary)}</p>
      <div class="why-box"><strong>Why it matters:</strong> ${highlightSummaryHtml(story.why_it_matters)}</div>
      <div class="source-links">${sourcesHtml}</div>
    </article>
  `;
}

function renderNews(stories = []) {
  const filtered =
    state.newsCategory === "All"
      ? stories
      : stories.filter((s) => s.category === state.newsCategory);

  if (!filtered.length) {
    els.newsGrid.innerHTML = `<div class="empty-state">No stories in the "${escapeHtml(state.newsCategory)}" category for this edition.</div>`;
    return;
  }

  const priorTop = state.priorBriefing?.top_news || [];
  els.newsGrid.innerHTML = filtered
    .map((story) =>
      renderNewsCard(story, story.category, isContinuedFromPrior(story, priorTop), true)
    )
    .join("");
}

function getTimeframeValue(item, tf) {
  if (tf === "30d") return item.change_30d_pct ?? item.change_5d_pct ?? item.change_pct;
  if (tf === "5d") return item.change_5d_pct ?? item.change_pct;
  return item.change_pct;
}

function getSparklineData(q, tf) {
  if (tf === "1d") {
    if (Array.isArray(q.sparkline_1d) && q.sparkline_1d.length >= 2) {
      return { values: q.sparkline_1d, times: q.sparkline_1d_times || [] };
    }
    return { values: Array.isArray(q.sparkline_30d) ? q.sparkline_30d : [], times: q.sparkline_30d_times || [] };
  }
  if (tf === "5d") {
    if (Array.isArray(q.sparkline_5d) && q.sparkline_5d.length >= 2) {
      return { values: q.sparkline_5d, times: q.sparkline_5d_times || [] };
    }
    return {
      values: Array.isArray(q.sparkline_30d) ? q.sparkline_30d.slice(-6) : [],
      times: Array.isArray(q.sparkline_30d_times) ? q.sparkline_30d_times.slice(-6) : [],
    };
  }
  return {
    values: Array.isArray(q.sparkline_30d) ? q.sparkline_30d : [],
    times: q.sparkline_30d_times || [],
  };
}

function fmtSparkTime(raw, kind) {
  if (!raw) return "";
  if (raw.length === 10 && raw[4] === "-") {
    const [y, m, d] = raw.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  if (kind === "1d") {
    return dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (kind === "5d") {
    return dt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  }
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderQuoteGrid(container, quotes, tf, emptyMsg) {
  if (!quotes.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMsg)}</div>`;
    return;
  }
  container.innerHTML = quotes
    .map((q) => {
      const pct = getTimeframeValue(q, tf);
      const cls = deltaClass(pct);
      const stroke =
        cls === "pos"
          ? "var(--pos)"
          : cls === "neg"
          ? "var(--neg)"
          : "var(--ink-muted)";
      const { values: series, times } = getSparklineData(q, tf);
      const logoDomain = COMPANY_LOGOS[q.name];
      const logoHtml = logoDomain ? renderCompanyLogoImg(logoDomain) : "";
      return `
        <div class="quote-card">
          <div class="quote-top">
            <span class="quote-name">${logoHtml}${escapeHtml(q.name)}</span>
            <span class="quote-sym">${escapeHtml(q.symbol)}</span>
          </div>
          <div class="quote-mid">
            <span class="quote-price">${fmtPrice(q.price, q.symbol)}</span>
            <span class="delta-pill ${cls}">${fmtPct(pct)}</span>
          </div>
          <div class="sparkline-wrap" data-kind="${escapeHtml(tf)}" data-symbol="${escapeHtml(q.symbol)}" data-values="${escapeHtml(JSON.stringify(series))}" data-times="${escapeHtml(JSON.stringify(times))}">
            <div class="spark-tooltip hidden"></div>
            ${buildSparklineSvg(series, stroke, "sparkline", true)}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderFearGreed(fg) {
  if (!els.fearGreedCard) return;
  if (!fg || fg.score == null) {
    els.fearGreedCard.classList.add("hidden");
    els.fearGreedCard.innerHTML = "";
    return;
  }
  const score = Math.max(0, Math.min(100, Number(fg.score)));
  const rating = String(fg.rating || "Neutral");
  const slug = rating.toLowerCase().replace(/\s+/g, "-");
  const hist = [
    ["Prev Close", fg.previous_close],
    ["1W Ago", fg.previous_1_week],
    ["1M Ago", fg.previous_1_month],
    ["1Y Ago", fg.previous_1_year],
  ]
    .filter(([, val]) => val != null)
    .map(([label, val]) => `<span>${label}: <strong>${Number(val).toFixed(1)}</strong></span>`)
    .join("");

  els.fearGreedCard.classList.remove("hidden");
  els.fearGreedCard.innerHTML = `
    <div class="fg-top">
      <div class="fg-title-group">
        <span class="fg-label">Market Fear &amp; Greed Index</span>
        <span class="fg-score">${score.toFixed(1)}</span>
        <span class="fg-scale">/ 100</span>
        <span class="fg-rating ${escapeHtml(slug)}">${escapeHtml(rating)}</span>
      </div>
      ${hist ? `<div class="fg-history">${hist}</div>` : ""}
    </div>
    <div class="fg-bar-wrap" aria-label="Fear and Greed score ${score.toFixed(1)} out of 100">
      <div class="fg-marker" style="left:${score.toFixed(1)}%"></div>
    </div>
    <div class="fg-zones">
      <span>Extreme Fear</span>
      <span>Fear</span>
      <span>Neutral</span>
      <span>Greed</span>
      <span>Extreme Greed</span>
    </div>
  `;
}

function renderSectorHeatmap(markets = {}) {
  const tf = state.marketTimeframe;
  const tfLabels = {
    "1d": "Daily ETF performance (SPDR Select Sectors)",
    "5d": "5-day rolling ETF performance (SPDR Select Sectors)",
    "30d": "30-day rolling ETF performance (SPDR Select Sectors)",
  };
  els.heatmapLabel.textContent = tfLabels[tf] || tfLabels["1d"];

  const sectors = [...(markets.sectors || [])].sort(
    (a, b) => getTimeframeValue(b, tf) - getTimeframeValue(a, tf)
  );

  if (!sectors.length) {
    els.sectorHeatmap.innerHTML = `<div class="empty-state">Sector heatmap unavailable for this date.</div>`;
  } else {
    els.sectorHeatmap.innerHTML = sectors
      .map((s) => {
        const pct = getTimeframeValue(s, tf);
        return `
          <div class="sector-tile" style="${sectorTileStyle(pct)}">
            <span class="sector-sym">${escapeHtml(s.symbol)}</span>
            <span class="sector-name">${escapeHtml(s.name)}</span>
            <span class="sector-val">${fmtPct(pct)}</span>
          </div>
        `;
      })
      .join("");
  }
}

function renderMarkets(markets = {}) {
  const regime = markets.regime_tag || "Mixed";
  const regimeSlug = regime.toLowerCase().replace(/\s+/g, "-");
  els.marketRegime.textContent = regime;
  els.marketRegime.className = `regime-badge ${regimeSlug}`;
  els.marketNarrative.innerHTML = highlightSummaryHtml(markets.narrative || "");

  const tf = state.marketTimeframe;
  renderFearGreed(markets.fear_greed);

  renderQuoteGrid(
    els.watchlistGrid,
    markets.watchlist || [],
    tf,
    "Market watchlist data unavailable for this date."
  );

  const big7 = markets.big7 || [];
  if (els.big7Block && els.big7Grid) {
    if (!big7.length) {
      els.big7Block.classList.add("hidden");
      els.big7Grid.innerHTML = "";
    } else {
      els.big7Block.classList.remove("hidden");
      if (els.big7Label) {
        const big7Sub = {
          "1d": "Mega-cap tech leaders (1D change · 30m chart)",
          "5d": "Mega-cap tech leaders (5D change · 1h chart)",
          "30d": "Mega-cap tech leaders (30D change · daily chart)",
        };
        els.big7Label.textContent = big7Sub[tf] || big7Sub["1d"];
      }
      renderQuoteGrid(els.big7Grid, big7, tf, "");
    }
  }

  renderSectorHeatmap(markets);
}

function renderConflicts(conflicts = {}) {
  els.conflictsOverview.innerHTML = highlightSummaryHtml(conflicts.overview || "");
  const theaters = conflicts.theaters || [];
  if (!theaters.length) {
    els.conflictsGrid.innerHTML = `<div class="empty-state">No conflict tracker data available for this edition.</div>`;
    return;
  }

  const trendArrow = { up: "↑ Rising", flat: "→ Steady", down: "↓ Cooling" };

  els.conflictsGrid.innerHTML = theaters
    .map((t) => {
      const sparkColor =
        t.status === "escalating"
          ? "var(--neg)"
          : t.status === "elevated"
          ? "var(--warn)"
          : "var(--ink-muted)";

      const eventsHtml = (t.timeline_events || [])
        .map(
          (ev) => `
            <li>
              <a href="${safeUrl(ev.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.headline)}</a>
              <span class="timeline-src">${escapeHtml(ev.source)}</span>
            </li>
          `
        )
        .join("");

      return `
        <article class="conflict-card">
          <div class="conflict-head">
            <div>
              <span class="conflict-region">${escapeHtml(t.region)}</span>
              <h3>${escapeHtml(t.name)}</h3>
            </div>
            <span class="status-badge ${escapeHtml(t.status)}">${escapeHtml(t.status)}</span>
          </div>

          <div class="intensity-row">
            <div class="intensity-meta">
              14D GDELT Intensity: <strong>${Number(t.intensity_score || 0).toFixed(0)}</strong>
              &middot; 7D: <strong>${trendArrow[t.trend_7d] || "→ Steady"}</strong>
            </div>
            <div class="sparkline-wrap intensity-spark-wrap" data-kind="gdelt" data-values="${escapeHtml(JSON.stringify(t.intensity_series_14d || []))}" data-times="${escapeHtml(JSON.stringify(t.intensity_dates_14d || []))}">
              <div class="spark-tooltip hidden"></div>
              ${buildSparklineSvg(t.intensity_series_14d, sparkColor, "intensity-spark", true)}
            </div>
          </div>

          <p class="conflict-summary">${highlightSummaryHtml(t.summary)}</p>

          ${eventsHtml ? `<ul class="timeline-list">${eventsHtml}</ul>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderPolitics(politics = {}) {
  els.politicsPulse.innerHTML = highlightSummaryHtml(politics.pulse_summary || "");

  const markets = politics.prediction_markets || [];
  if (!markets.length) {
    els.polymarketList.innerHTML = `<div class="empty-state">No prediction market quotes captured for this edition.</div>`;
  } else {
    els.polymarketList.innerHTML = markets
      .map((m) => {
        const pct = Math.round((m.yes_prob || 0) * 100);
        const deltaPts = (m.delta_24h || 0) * 100;
        const dCls = deltaClass(deltaPts);
        const sourceLabel =
          m.source ||
          (String(m.url || "").includes("kalshi.com") ? "Kalshi" : "Polymarket");
        return `
          <a class="poly-card" href="${safeUrl(m.url)}" target="_blank" rel="noopener noreferrer">
            <div class="poly-top">
              <span class="poly-q">${formatEntitiesInPlain(m.question)}</span>
              <div class="poly-odds">
                <div class="poly-pct">${pct}%</div>
              </div>
            </div>
            <div class="poly-bar-track">
              <div class="poly-bar-fill" style="width:${pct}%"></div>
            </div>
            <div class="poly-foot">
              <span>${escapeHtml(sourceLabel)} &middot; ${fmtUsdCompact(m.volume_usd)}</span>
              <span class="delta-pill ${dCls}">24h: ${deltaPts >= 0 ? "+" : ""}${deltaPts.toFixed(1)} pts</span>
            </div>
          </a>
        `;
      })
      .join("");
  }

  const policies = politics.legislative_and_executive || [];
  if (!policies.length) {
    els.policyList.innerHTML = `<div class="empty-state">No legislative or executive updates listed.</div>`;
  } else {
    els.policyList.innerHTML = policies
      .map(
        (p) => `
          <article class="policy-card">
            <div class="policy-head">
              <span class="branch-tag">${escapeHtml(p.chamber_or_branch)}</span>
              <a class="policy-title" href="${safeUrl(p.url)}" target="_blank" rel="noopener noreferrer">${formatEntitiesInPlain(p.title)}</a>
            </div>
            <p class="policy-summary">${highlightSummaryHtml(p.summary)}</p>
          </article>
        `
      )
      .join("");
  }

  const topics = politics.trending_topics || [];
  if (!topics.length) {
    els.topicsList.innerHTML = `<div class="empty-state">No trending topic notes available.</div>`;
  } else {
    els.topicsList.innerHTML = topics
      .map(
        (t) => `
          <article class="topic-card">
            <div class="topic-top">
              <span class="topic-name">${formatEntitiesInPlain(t.topic)}</span>
              <span class="momentum-pill ${escapeHtml(t.momentum)}">${escapeHtml(t.momentum)}</span>
            </div>
            <p class="topic-note">${highlightSummaryHtml(t.framing_note)}</p>
          </article>
        `
      )
      .join("");
  }
}

function renderPositiveNews(story) {
  if (!els.positiveSection || !els.positiveNewsSlot) return;
  if (!story || !story.headline) {
    els.positiveSection.classList.add("hidden");
    els.positiveNewsSlot.innerHTML = "";
    return;
  }
  const sourcesHtml = (story.sources || []).map(renderSourceChip).join("");

  els.positiveSection.classList.remove("hidden");
  const posSentiment =
    story.sentiment && SENTIMENT_LABELS[story.sentiment] && story.sentiment !== "neutral"
      ? story.sentiment
      : "very_positive";
  els.positiveNewsSlot.innerHTML = `
    <article class="positive-card">
      <div class="news-meta">
        <div class="news-card-badges">
          <span class="cat-pill">${escapeHtml(story.category || "Progress")}</span>
          ${renderSentimentRing(posSentiment)}
        </div>
      </div>
      <h3>${formatEntitiesInPlain(story.headline)}</h3>
      <p class="news-summary">${highlightSummaryHtml(story.summary)}</p>
      <div class="why-box"><strong>Why it matters:</strong> ${highlightSummaryHtml(story.why_it_matters)}</div>
      <div class="source-links">${sourcesHtml}</div>
    </article>
  `;
}

let syncExpandAllButton = () => {};

function setLocalExpanded(expanded) {
  state.localExpanded = Boolean(expanded);
  if (els.localNewsBody) {
    els.localNewsBody.classList.toggle("hidden", !state.localExpanded);
  }
  if (els.btnToggleLocal) {
    els.btnToggleLocal.setAttribute("aria-expanded", String(state.localExpanded));
    const lbl = els.btnToggleLocal.querySelector(".collapse-label");
    if (lbl) lbl.textContent = state.localExpanded ? "Collapse" : "Expand";
  }
  syncExpandAllButton();
}

function renderLocalNews(regions = []) {
  if (!els.localSection || !els.localLocationToggle || !els.localNewsGrid) return;
  if (!Array.isArray(regions) || !regions.length) {
    els.localSection.classList.add("hidden");
    els.localLocationToggle.innerHTML = "";
    els.localNewsGrid.innerHTML = "";
    return;
  }

  els.localSection.classList.remove("hidden");
  if (!state.localRegionId || !regions.some((r) => r.id === state.localRegionId)) {
    state.localRegionId = regions[0].id;
  }

  els.localLocationToggle.innerHTML = regions
    .map((r) => {
      const active = r.id === state.localRegionId;
      return `<button type="button" class="seg-btn${active ? " active" : ""}" data-region-id="${escapeHtml(r.id)}" aria-pressed="${active}">${escapeHtml(r.name)}</button>`;
    })
    .join("");

  const activeRegion = regions.find((r) => r.id === state.localRegionId) || regions[0];
  const hasTranslation = Array.isArray(activeRegion.stories_en) && activeRegion.stories_en.length > 0;
  if (els.localLangToggle) {
    els.localLangToggle.classList.toggle("hidden", !hasTranslation);
    els.localLangToggle.querySelectorAll(".seg-btn").forEach((btn) => {
      const active = btn.dataset.lang === state.localLang;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  const useEn = hasTranslation && state.localLang === "en";
  const stories = useEn ? activeRegion.stories_en : activeRegion.stories || [];
  const priorRegion = (state.priorBriefing?.local_news || []).find((r) => r.id === activeRegion.id);
  const priorLocal = useEn ? priorRegion?.stories_en || [] : priorRegion?.stories || [];
  if (!stories.length) {
    els.localNewsGrid.innerHTML = `<div class="empty-state">No local news stories available for ${escapeHtml(activeRegion.name)} in this edition.</div>`;
  } else {
    els.localNewsGrid.innerHTML = stories
      .map((story) =>
        renderNewsCard(story, activeRegion.name, isContinuedFromPrior(story, priorLocal))
      )
      .join("");
  }

  setLocalExpanded(state.localExpanded);
}

function renderAll(briefing) {
  state.briefing = briefing;
  buildTickerMap(briefing.markets);
  els.editionDate.textContent = fmtReadableDate(briefing.date);
  els.generatedMeta.textContent = `Updated ${fmtLocalTimestamp(briefing.generated_at)}`;
  renderSourceHealth(briefing.source_health);
  renderKpiStrip(briefing);
  renderExecutiveBrief(briefing);
  renderNews(briefing.top_news);
  renderMarkets(briefing.markets);
  renderConflicts(briefing.conflicts);
  renderPolitics(briefing.us_politics);
  renderPositiveNews(briefing.positive_news);
  renderLocalNews(briefing.local_news);
}

/* ---------- Archive Navigation & Data Loading ---------- */

function updateArchiveButtons() {
  const dates = state.index?.dates || [];
  const idx = dates.indexOf(state.currentDate);
  // dates are sorted newest-first: index 0 is newest, index length-1 is oldest
  els.btnNextDay.disabled = idx <= 0;
  els.btnPrevDay.disabled = idx === -1 || idx >= dates.length - 1;
}

async function refreshLiveMarkets() {
  if (!state.viewingLatest || !state.briefing) {
    els.marketsLivePill?.classList.add("hidden");
    return;
  }
  try {
    const resp = await fetch(`${DATA_BASE}/markets_live.json`, { cache: "no-store" });
    if (!resp.ok) return;
    const live = await resp.json();
    if (!live || !Array.isArray(live.watchlist) || !live.watchlist.length) return;

    state.briefing.markets = {
      ...state.briefing.markets,
      watchlist: live.watchlist,
      big7: Array.isArray(live.big7) && live.big7.length ? live.big7 : state.briefing.markets.big7,
      sectors: Array.isArray(live.sectors) && live.sectors.length ? live.sectors : state.briefing.markets.sectors,
      fear_greed: live.fear_greed || state.briefing.markets.fear_greed,
    };

    buildTickerMap(state.briefing.markets);
    document.querySelectorAll(".ticker-tag[data-ticker-sym]").forEach((el) => {
      const sym = el.dataset.tickerSym;
      const info =
        state.tickerMap.get(sym) ||
        state.tickerMap.get(sym?.replace(/^\^/, ""));
      if (!info) return;
      const cls = deltaClass(info.change_pct);
      const tip = formatTickerTip(info);
      el.classList.remove("pos", "neg", "flat");
      el.classList.add(cls);
      el.dataset.tickerTip = tip;
      el.title = tip;
    });

    renderKpiStrip(state.briefing);
    renderMarkets(state.briefing.markets);

    if (els.marketsLivePill && live.updated_at) {
      const dt = new Date(live.updated_at);
      const timeStr = Number.isNaN(dt.getTime())
        ? live.updated_at
        : dt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
      els.marketsLivePill.innerHTML = `<span class="live-dot" aria-hidden="true"></span>${escapeHtml(timeStr)}`;
      els.marketsLivePill.title = `Markets refreshed ${fmtLocalTimestamp(live.updated_at)}`;
      els.marketsLivePill.classList.remove("hidden");
    }
  } catch {
    // Keep daily snapshot if markets_live.json is unavailable
  }
}

async function loadBriefingForDate(dateStr) {
  els.statusBanner.classList.add("hidden");
  const isLatest = !dateStr || dateStr === "latest";
  state.viewingLatest = isLatest;
  if (!isLatest) els.marketsLivePill?.classList.add("hidden");
  const url = isLatest
    ? `${DATA_BASE}/latest.json`
    : `${DATA_BASE}/archive/${encodeURIComponent(dateStr)}.json`;

  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    state.currentDate = data.date;
    const selectVal = isLatest ? "latest" : data.date;
    if (els.dateSelect.value !== selectVal) {
      els.dateSelect.value = selectVal;
    }
    const qs = new URLSearchParams(window.location.search);
    qs.set("date", isLatest ? "latest" : data.date);
    window.history.replaceState(null, "", `?${qs.toString()}`);

    updateArchiveButtons();
    state.priorBriefing = null;
    const dates = state.index?.dates || [];
    const curIdx = dates.indexOf(data.date);
    if (curIdx !== -1 && curIdx + 1 < dates.length) {
      try {
        const prevResp = await fetch(
          `${DATA_BASE}/archive/${encodeURIComponent(dates[curIdx + 1])}.json`,
          { cache: "no-store" }
        );
        if (prevResp.ok) {
          state.priorBriefing = await prevResp.json();
        }
      } catch {
        state.priorBriefing = null;
      }
    }
    renderAll(data);
    if (isLatest) {
      await refreshLiveMarkets();
    }
  } catch (err) {
    els.statusBanner.textContent = `Could not load briefing data (${err.message}). Run the daily pipeline or check briefing/data/.`;
    els.statusBanner.classList.remove("hidden");
  }
}

function initScrollSpy() {
  const nav = document.querySelector(".section-nav");
  const navInner = document.querySelector(".section-nav-inner");
  const syncNavHeight = () => {
    if (nav) {
      document.documentElement.style.setProperty("--nav-height", `${Math.round(nav.getBoundingClientRect().height)}px`);
    }
  };
  syncNavHeight();
  window.addEventListener("resize", syncNavHeight, { passive: true });

  const links = [...document.querySelectorAll(".nav-links a[href^='#']")];
  const pairs = links
    .map((link) => {
      const id = link.getAttribute("href").slice(1);
      const section = document.getElementById(id);
      return section ? { link, section } : null;
    })
    .filter(Boolean);

  if (!pairs.length) return;

  let lastActiveLink = null;

  const updateActive = () => {
    const visiblePairs = pairs
      .filter(({ section }) => !section.classList.contains("hidden"))
      .sort((a, b) => a.section.getBoundingClientRect().top - b.section.getBoundingClientRect().top);
    if (!visiblePairs.length) return;

    const navH = nav ? nav.getBoundingClientRect().height : 44;
    const atBottom =
      window.scrollY > 40 &&
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 40;

    let activePair = visiblePairs[0];
    if (atBottom) {
      activePair = visiblePairs[visiblePairs.length - 1];
    } else if (window.scrollY > 40) {
      const threshold = navH + 36;
      for (const pair of visiblePairs) {
        if (pair.section.getBoundingClientRect().top <= threshold) {
          activePair = pair;
        }
      }
    }

    for (const { link } of pairs) {
      const isActive = link === activePair.link;
      link.classList.toggle("active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    }

    if (activePair.link !== lastActiveLink) {
      lastActiveLink = activePair.link;
      if (navInner && navInner.scrollWidth > navInner.clientWidth) {
        const linkRect = activePair.link.getBoundingClientRect();
        const navRect = navInner.getBoundingClientRect();
        const targetLeft =
          navInner.scrollLeft + (linkRect.left - navRect.left) - (navRect.width - linkRect.width) / 2;
        navInner.scrollTo({ left: Math.max(0, targetLeft), behavior: "smooth" });
      }
    }
  };

  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        updateActive();
        ticking = false;
      });
    },
    { passive: true }
  );

  updateActive();
}

function initSparklineHover() {
  const root = document.getElementById("app-root");
  if (!root) return;

  const clearHover = (wrap) => {
    if (!wrap) return;
    wrap.classList.remove("hovering");
    const tip = wrap.querySelector(".spark-tooltip");
    if (tip) tip.classList.add("hidden");
  };

  let activeWrap = null;
  const seriesCache = new WeakMap();

  const getCachedSeries = (wrap) => {
    let entry = seriesCache.get(wrap);
    if (!entry) {
      try {
        const values = JSON.parse(wrap.dataset.values || "[]");
        if (!Array.isArray(values) || values.length < 2) return null;
        let times = [];
        try {
          const parsed = JSON.parse(wrap.dataset.times || "[]");
          if (Array.isArray(parsed)) times = parsed;
        } catch {
          times = [];
        }
        const min = Math.min(...values);
        const max = Math.max(...values);
        entry = {
          values,
          times,
          min,
          span: max - min || 1,
          guide: wrap.querySelector(".spark-guide"),
          dot: wrap.querySelector(".spark-dot"),
          tip: wrap.querySelector(".spark-tooltip"),
        };
        seriesCache.set(wrap, entry);
      } catch {
        return null;
      }
    }
    return entry;
  };

  const showAt = (wrap, clientX) => {
    if (activeWrap && activeWrap !== wrap) {
      clearHover(activeWrap);
    }
    activeWrap = wrap;

    const entry = getCachedSeries(wrap);
    if (!entry) return;

    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;

    const { values, times, min, span, guide, dot, tip } = entry;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * (values.length - 1));
    const val = values[idx];

    const w = 120;
    const h = 32;
    const pad = 3;
    const ptX = (idx / (values.length - 1)) * w;
    const ptY = h - pad - ((val - min) / span) * (h - pad * 2);

    if (guide) {
      guide.setAttribute("x1", ptX.toFixed(1));
      guide.setAttribute("x2", ptX.toFixed(1));
    }
    if (dot) {
      dot.setAttribute("cx", ptX.toFixed(1));
      dot.setAttribute("cy", ptY.toFixed(1));
    }
    if (tip) {
      const kind = wrap.dataset.kind || "";
      const valText =
        kind === "gdelt"
          ? `${Number(val).toFixed(0)}`
          : fmtPrice(val, wrap.dataset.symbol);
      const timeText = times[idx] ? fmtSparkTime(times[idx], kind) : "";
      tip.innerHTML = timeText
        ? `<span class="spark-tip-time">${escapeHtml(timeText)}</span> ${escapeHtml(valText)}`
        : escapeHtml(valText);
      const pctLeft = Math.max(18, Math.min(82, (ptX / w) * 100));
      tip.style.left = `${pctLeft.toFixed(1)}%`;
      tip.classList.remove("hidden");
    }
    wrap.classList.add("hovering");
  };

  root.addEventListener("pointerdown", (e) => {
    const wrap = e.target.closest(".sparkline-wrap");
    if (!wrap) {
      if (activeWrap) {
        clearHover(activeWrap);
        activeWrap = null;
      }
      return;
    }
    showAt(wrap, e.clientX);
  });

  root.addEventListener("pointermove", (e) => {
    const wrap = e.target.closest(".sparkline-wrap");
    if (!wrap) {
      if (activeWrap && e.pointerType !== "touch") {
        clearHover(activeWrap);
        activeWrap = null;
      }
      return;
    }
    showAt(wrap, e.clientX);
  });

  root.addEventListener("pointerleave", (e) => {
    if (activeWrap && e.pointerType !== "touch") {
      clearHover(activeWrap);
      activeWrap = null;
    }
  });
}

function initSourceBiasPopover() {
  const pop = document.createElement("div");
  pop.className = "source-popover hidden";
  pop.setAttribute("role", "dialog");
  document.body.appendChild(pop);

  let lastPointerType = "mouse";
  let activeChip = null;

  const hide = () => {
    pop.classList.add("hidden");
    pop.classList.remove("is-hover");
    activeChip = null;
  };

  const showForChip = (chip, includeOpenLink) => {
    activeChip = chip;
    const bias = chip.dataset.bias || "";
    const tone = chip.dataset.biasTone || "neutral";
    const pos = Number(chip.dataset.biasPos ?? 0.5);
    const color = BIAS_TONE_COLOR[tone] || BIAS_TONE_COLOR.neutral;
    const href = chip.getAttribute("href") || "#";
    const gauge = buildHalfRingSvg(pos, color);
    const openLink = includeOpenLink
      ? `<a class="source-popover-link" href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer">Open &nearr;</a>`
      : "";
    pop.classList.toggle("is-hover", !includeOpenLink);
    pop.innerHTML = `<span class="source-popover-bias" data-bias-tone="${escapeHtml(tone)}">${gauge}<span>${escapeHtml(bias)}</span></span>${openLink}`;
    pop.classList.remove("hidden");

    const rect = chip.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const left = Math.max(
      12,
      Math.min(window.innerWidth - popRect.width - 12, rect.left + rect.width / 2 - popRect.width / 2)
    );
    const top = Math.max(12, rect.top - popRect.height - 8);
    pop.style.left = `${left.toFixed(1)}px`;
    pop.style.top = `${top.toFixed(1)}px`;
  };

  // Desktop mouse hover
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const chip = e.target.closest(".source-chip[data-bias]");
    if (!chip) return;
    showForChip(chip, false);
  });

  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    const chip = e.target.closest(".source-chip[data-bias]");
    if (chip && chip === activeChip && pop.classList.contains("is-hover")) {
      hide();
    }
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      lastPointerType = e.pointerType || "mouse";
      if (!pop.classList.contains("hidden") && !pop.contains(e.target) && !e.target.closest(".source-chip")) {
        hide();
      }
    },
    { passive: true }
  );

  // Touch tap
  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".source-chip[data-bias]");
    if (!chip) return;
    const isTouch =
      lastPointerType === "touch" ||
      !window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
    if (!isTouch) return;

    e.preventDefault();
    if (activeChip === chip && !pop.classList.contains("hidden") && !pop.classList.contains("is-hover")) {
      hide();
      return;
    }
    showForChip(chip, true);
  });

  window.addEventListener("scroll", hide, { passive: true });
}

function applyPositivePlacement(pos) {
  const placement = pos === "top" ? "top" : "bottom";
  const positiveSec = els.positiveSection;
  const execSec = document.getElementById("executive");
  const appRoot = document.getElementById("app-root");
  if (positiveSec && execSec && appRoot) {
    if (placement === "top") {
      execSec.insertAdjacentElement("afterend", positiveSec);
    } else {
      appRoot.appendChild(positiveSec);
    }
  }

  const navLinks = document.querySelector(".nav-links");
  const posLink = navLinks?.querySelector('a[href="#positive"]');
  const execLink = navLinks?.querySelector('a[href="#executive"]');
  if (posLink && execLink && navLinks) {
    if (placement === "top") {
      execLink.insertAdjacentElement("afterend", posLink);
    } else {
      navLinks.appendChild(posLink);
    }
  }

  if (els.btnMovePositive) {
    els.btnMovePositive.innerHTML =
      placement === "top" ? "Move to bottom &darr;" : "Move below Brief &uarr;";
  }
}

function initFloatingTooltips() {
  const tip = document.createElement("div");
  tip.className = "floating-tip hidden";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  const SEL = ".ticker-tag[data-ticker-tip], .sentiment-gauge[data-tooltip]";
  let activeEl = null;

  const hide = () => {
    tip.classList.add("hidden");
    activeEl = null;
  };

  const show = (el) => {
    const isTicker = el.classList.contains("ticker-tag");
    const text = isTicker ? el.dataset.tickerTip : el.dataset.tooltip;
    if (!text) return;
    activeEl = el;
    tip.textContent = text;
    tip.classList.toggle("is-subtle", !isTicker);
    tip.classList.remove("hidden");

    const rect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const pad = 12;
    const left = Math.max(
      pad,
      Math.min(window.innerWidth - tipRect.width - pad, rect.left + rect.width / 2 - tipRect.width / 2)
    );
    let top = rect.top - tipRect.height - 8;
    if (top < pad) {
      top = Math.min(window.innerHeight - tipRect.height - pad, rect.bottom + 8);
    }
    tip.style.left = `${left.toFixed(1)}px`;
    tip.style.top = `${top.toFixed(1)}px`;
  };

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest(SEL);
    if (el) show(el);
  });

  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    const el = e.target.closest(SEL);
    if (el && el === activeEl) hide();
  });

  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.(SEL);
    if (el) show(el);
  });

  document.addEventListener("focusout", (e) => {
    const el = e.target.closest?.(SEL);
    if (el && el === activeEl) hide();
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target.closest(SEL);
      if (!el) {
        if (activeEl) hide();
        return;
      }
      if (e.pointerType === "touch") {
        if (activeEl === el && !tip.classList.contains("hidden")) {
          hide();
        } else {
          show(el);
        }
      }
    },
    { passive: true }
  );

  window.addEventListener("scroll", hide, { passive: true });
}

async function bootstrap() {
  initTheme();
  applyPositivePlacement(localStorage.getItem("briefing-positive-pos") || "bottom");
  initScrollSpy();
  initSparklineHover();
  initSourceBiasPopover();
  initFloatingTooltips();

  // Mobile KPI strip collapse toggle (collapsed by default on narrow screens)
  const setKpiOpen = (open) => {
    if (!els.kpiWrapper || !els.btnToggleKpi) return;
    els.kpiWrapper.classList.toggle("is-expanded", open);
    els.btnToggleKpi.setAttribute("aria-expanded", String(open));
    const lbl = els.btnToggleKpi.querySelector(".collapse-label");
    if (lbl) lbl.textContent = open ? "Collapse" : "Expand";
  };
  els.btnToggleKpi?.addEventListener("click", () => {
    const next = !els.kpiWrapper?.classList.contains("is-expanded");
    setKpiOpen(next);
  });

  // Collapsible sections (collapsed by default on load): Markets, Global Conflicts, US Politics
  const collapsibleControllers = [];
  const wireCollapsible = (btnId, bodyId, navHash) => {
    const btn = document.getElementById(btnId);
    const body = document.getElementById(bodyId);
    if (!btn || !body) return;
    const setOpen = (open) => {
      body.classList.toggle("hidden", !open);
      btn.setAttribute("aria-expanded", String(open));
      const lbl = btn.querySelector(".collapse-label");
      if (lbl) lbl.textContent = open ? "Collapse" : "Expand";
      syncExpandAllButton();
    };
    const isOpen = () => !body.classList.contains("hidden");
    collapsibleControllers.push({ setOpen, isOpen });
    btn.addEventListener("click", () => {
      setOpen(body.classList.contains("hidden"));
    });
    if (navHash) {
      document.querySelector(`.nav-links a[href="${navHash}"]`)?.addEventListener("click", () => {
        if (body.classList.contains("hidden")) setOpen(true);
      });
    }
    return setOpen;
  };
  const setMarketsOpen = wireCollapsible("btn-toggle-markets", "markets-body", "#markets");
  wireCollapsible("btn-toggle-conflicts", "conflicts-body", "#conflicts");
  wireCollapsible("btn-toggle-politics", "politics-body", "#politics");

  const areAllSectionsExpanded = () => {
    const coreOpen = collapsibleControllers.every((c) => c.isOpen());
    const localVisible = els.localSection && !els.localSection.classList.contains("hidden");
    return coreOpen && (!localVisible || state.localExpanded);
  };

  syncExpandAllButton = () => {
    if (!els.btnExpandAll) return;
    const allOpen = areAllSectionsExpanded();
    els.btnExpandAll.setAttribute("aria-expanded", String(allOpen));
    const lbl = els.btnExpandAll.querySelector(".collapse-label");
    if (lbl) lbl.textContent = allOpen ? "Collapse All" : "Expand All";
  };

  els.btnExpandAll?.addEventListener("click", () => {
    const open = !areAllSectionsExpanded();
    setKpiOpen(open);
    collapsibleControllers.forEach((c) => c.setOpen(open));
    if (els.localSection && !els.localSection.classList.contains("hidden")) {
      setLocalExpanded(open);
    }
    syncExpandAllButton();
  });
  syncExpandAllButton();

  // Positive News placement toggle (above Top News vs bottom)
  els.btnMovePositive?.addEventListener("click", () => {
    const cur = localStorage.getItem("briefing-positive-pos") || "bottom";
    const next = cur === "top" ? "bottom" : "top";
    localStorage.setItem("briefing-positive-pos", next);
    applyPositivePlacement(next);
    els.positiveSection?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Delegated expand/collapse for continued-from-yesterday news cards
  document.getElementById("app-root")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".card-toggle-btn");
    if (!btn) return;
    const card = btn.closest(".news-card");
    if (!card) return;
    const collapsed = card.classList.toggle("is-collapsed");
    btn.setAttribute("aria-expanded", String(!collapsed));
    btn.innerHTML = collapsed ? "Expand &#9662;" : "Collapse &#9652;";
  });

  // News category filters (click active filter again to reset to All)
  els.newsFilters.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    const clicked = btn.dataset.category;
    state.newsCategory = state.newsCategory === clicked ? "All" : clicked;
    els.newsFilters.querySelectorAll(".filter-btn").forEach((b) => {
      const active = b.dataset.category === state.newsCategory;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });
    if (state.briefing) renderNews(state.briefing.top_news);
  });

  // Market timeframe toggle (1D / 5D / 30D)
  const tfBtns = [els.btnTf1d, els.btnTf5d, els.btnTf30d].filter(Boolean);
  tfBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      state.marketTimeframe = btn.dataset.tf;
      tfBtns.forEach((b) => b.classList.toggle("active", b === btn));
      setMarketsOpen?.(true);
      if (state.briefing) renderMarkets(state.briefing.markets);
    });
  });

  // Local news expand/collapse & location toggle
  els.btnToggleLocal?.addEventListener("click", () => {
    setLocalExpanded(!state.localExpanded);
  });

  els.localLocationToggle?.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.localRegionId = btn.dataset.regionId;
    if (!state.localExpanded) setLocalExpanded(true);
    if (state.briefing) renderLocalNews(state.briefing.local_news);
  });

  els.localLangToggle?.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    state.localLang = btn.dataset.lang || "native";
    if (!state.localExpanded) setLocalExpanded(true);
    if (state.briefing) renderLocalNews(state.briefing.local_news);
  });

  // Archive navigation controls
  els.dateSelect.addEventListener("change", () => {
    if (els.dateSelect.value) loadBriefingForDate(els.dateSelect.value);
  });

  els.btnPrevDay.addEventListener("click", () => {
    const dates = state.index?.dates || [];
    const idx = dates.indexOf(state.currentDate);
    if (idx !== -1 && idx + 1 < dates.length) {
      loadBriefingForDate(dates[idx + 1]);
    }
  });

  els.btnNextDay.addEventListener("click", () => {
    const dates = state.index?.dates || [];
    const idx = dates.indexOf(state.currentDate);
    if (idx > 0) {
      loadBriefingForDate(idx - 1 === 0 ? "latest" : dates[idx - 1]);
    }
  });

  // Fetch archive manifest
  try {
    const idxResp = await fetch(`${DATA_BASE}/index.json`, { cache: "no-store" });
    if (idxResp.ok) {
      state.index = await idxResp.json();
      const dates = state.index.dates || [];
      if (dates.length) {
        els.dateSelect.innerHTML =
          `<option value="latest">Latest</option>` +
          dates.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
      }
    }
  } catch {
    // Fall back cleanly to latest.json
  }

  const requested = new URLSearchParams(window.location.search).get("date");
  const initialDate =
    requested && requested !== "latest" && state.index?.dates?.includes(requested)
      ? requested
      : "latest";

  await loadBriefingForDate(initialDate);

  // Periodically poll markets_live.json every 5 min while tab is visible on Latest
  window.setInterval(() => {
    if (!document.hidden && state.viewingLatest) {
      refreshLiveMarkets();
    }
  }, 5 * 60 * 1000);
}

bootstrap();
