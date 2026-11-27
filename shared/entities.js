/**
 * Shared Entity Recognition, Highlighting, Wikipedia Links & Rich Floating Tooltips
 * Used by both Daily Briefing (/briefing/) and Weekly Briefing (/weekly/).
 */

import { PLACE_ALIASES, PLACE_META, initCountryMapTooltip } from "./country-map.js";
import { BIAS_TONE_COLOR, buildHalfRingSvg, initSourceBiasPopover } from "./ui.js";
import { escapeHtml, escapeRegex, fetchJson } from "./utils.js";

export const EXPLICIT_BOLD_RE = /\*\*((?:(?!\*\*).)+)\*\*/g;
export const FALLBACK_HIGHLIGHT_RE =
  /(?<![\w.$])([+-]?\$\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion|M|B|K))?|[+-]?\d[\d,]*(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b)(?!\w)|(['"][A-Z][^'"]{1,40}['"])/g;
export const EXPLICIT_ITALIC_RE = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;

const NON_PERSON_TITLE_WORD =
  "(?:Reinstatement|Leadership|Resignation|Nomination|Election|Administration|Succession|Investigation|Hearing|Policy|Orders?|Return|Ouster|Exit|Role|Office|Vote|Race|Campaign|Debate|Summit|Visit|Meeting|Statement|Scrutiny|Backlash|Reversal|Power|Term|Authority|Pardon|Veto|Cabinet|Approval|Polls?|Rules?|Ruling|Blocks?|Blocked|Strikes?|Struck|Signs?|Signed|Vetoes?|Vetoed|Faces?|Facing|Warns?|Warned|Urges?|Urged|Calls?|Called|Backs?|Backed|Rejects?|Rejected|Approves?|Approved|Dismisses?|Dismissed|Halts?|Halted|Upholds?|Upheld|Overturns?|Overturned|Allows?|Allowed|Bars?|Barred|Finds?|Found|Says?|Said|Tells?|Told|Slams?|Praises?|Meets?|Met|Visits?|Plans?|Seeks?|Pushes?|Moves?|Drops?|Opens?|Closes?|Ends?|Starts?|Launches?|Announces?|Unveils?|Proposes?|Defends?|Criticizes?|Accuses?|Targets?|Threatens?|Promises?|Vows?|Pledges?|Cites?|Names?|Picks?|Taps?|Fires?|Hires?|Quits?|Resigns?|Steps?|Takes?|Gives?|Gets?|Makes?|Sets?|Holds?|Wins?|Loses?|Leads?|Trails?|Violates?|Violated|Sues?|Sued|Indicts?|Indicted|Charges?|Charged|Decision|Verdict|Court|Panel|Bench|Bill|Act|Law|Plan|Deal|Talks|Move|Push|Bid|Case|Trial|Suit|Probe|Report|Review|Speech|Address|Remarks|Briefing|Press|News|Media|Team|Staff|Aides?|Allies|Critics|Supporters|Opponents|Rivals|Voters|Lawmakers|Senators|Democrats|Republicans|Officials|Leaders|Ministers|Justices|Judges|Federal|State|Local|National|Global|Foreign|Domestic|New|Top|Former|Acting|Interim|Chief|Senior|Junior|High|Supreme|Appeals|District|Circuit|Over|Under|With|Without|From|Into|Onto|Against|After|Before|During|Amid|Among|Between|Through|About|Around|Near|Behind|Beyond|Towards?|For|And|But|Or|Nor|Not|No|To|In|On|At|By|Of|As|Is|Are|Was|Were|Be|Been|Has|Have|Had|Will|Would|Could|Should|May|Might|Must|Can|That|This|Who|Whom|Whose|Which|What|When|Where|Why|How)\\b";

export const BASE_PERSON_NAMES = [
  "Donald Trump Jr.", "Donald Trump", "Trump", "Joe Biden", "Biden", "Kamala Harris", "JD Vance",
  "Benjamin Netanyahu", "Netanyahu", "Vladimir Putin", "Putin", "Volodymyr Zelenskyy",
  "Volodymyr Zelensky", "Zelenskyy", "Zelensky", "Xi Jinping", "Lai Ching-te", "Emmanuel Macron",
  "Macron", "Keir Starmer", "Starmer", "Friedrich Merz", "Olaf Scholz", "Giorgia Meloni",
  "Mark Carney", "Justin Trudeau", "Narendra Modi", "Modi", "Shigeru Ishiba", "Sanae Takaichi",
  "Lee Jae-myung", "Yoon Suk Yeol", "Kim Jong Un", "Masoud Pezeshkian", "Ali Khamenei", "Khamenei",
  "Mohammed bin Salman", "Recep Tayyip Erdogan", "Erdogan", "Luiz Inácio Lula da Silva",
  "Javier Milei", "Claudia Sheinbaum", "Anthony Albanese", "Jerome Powell", "Scott Bessent",
  "Marco Rubio", "Pete Hegseth", "Pam Bondi", "Kash Patel", "Tulsi Gabbard", "Robert F. Kennedy Jr.",
  "RFK Jr.", "Howard Lutnick", "Karoline Leavitt", "Stephen Miller", "Chuck Schumer",
  "Mike Johnson", "Hakeem Jeffries", "John Thune", "Mitch McConnell", "Nancy Pelosi",
  "Alexandria Ocasio-Cortez", "Bernie Sanders", "Elizabeth Warren", "Gavin Newsom", "Ron DeSantis",
  "Josh Shapiro", "Gretchen Whitmer", "Greg Abbott", "J.B. Pritzker", "Raphael Warnock",
  "Zohran Mamdani", "Jimmy Gomez", "Jamie Raskin", "Ilhan Omar", "Barack Obama", "Obama",
  "Bill Clinton", "Hillary Clinton", "Pope Leo XIV", "Pope Francis", "King Charles III",
  "King Charles", "King Salman", "King Abdullah II", "King Felipe VI", "Queen Camilla",
  "Elon Musk", "Musk", "Jensen Huang", "Tim Cook", "John Ternus", "Satya Nadella", "Sundar Pichai",
  "Andy Jassy", "Jeff Bezos", "Bezos", "Mark Zuckerberg", "Zuckerberg", "Sam Altman", "Altman",
  "Dario Amodei", "Demis Hassabis", "Bill Gates", "Warren Buffett", "Greg Abel", "Jamie Dimon",
  "Lisa Su", "Liang Wenfeng", "Jack Ma", "Pony Ma", "Lei Jun", "Wang Chuanfu", "Ren Zhengfei",
  "Zhang Yiming", "Kilmar Ábrego García", "Kilmar Abrego Garcia", "Abrego Garcia",
  "Abdul El-Sayed", "Scott Colom", "Puma Shen", "Guo Jiakun", "Chen Jining", "Nick Fuentes",
  "David Lisnard", "赖清德", "沈伯洋", "郭嘉昆", "黄仁勋", "特朗普", "陈吉宁", "习近平",
  "普京", "泽连斯基", "马斯克", "奥特曼", "扎克伯格", "库克", "内塔尼亚胡", "拜登", "莫迪",
  "马克龙", "金正恩", "鲍威尔", "卢比奥", "万斯",
];

const PERSON_NAME_WORD = `(?!${NON_PERSON_TITLE_WORD})[A-ZÀ-Ý][a-zà-ÿ'-]+`;
const PERSON_TITLE_PREFIX_PATTERN = `(?:President|Prime Minister|Pope|Sen\\.-elect|Sen\\.|Rep\\.|Gov\\.|Dr\\.)\\s+${PERSON_NAME_WORD}(?:\\s+${PERSON_NAME_WORD}){0,2}|(?:Attorney General|Secretary|Chairman|Mayor|Governor|Justice|Judge|CEO)\\s+${PERSON_NAME_WORD}\\s+${PERSON_NAME_WORD}(?:\\s+${PERSON_NAME_WORD})?`;

export function compilePersonNameRegex(names) {
  const unique = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const parts = unique.map((n) => {
    const esc = escapeRegex(n);
    return /^[\x00-\x7F\u00C0-\u024F]+$/.test(n) ? `\\b${esc}\\b` : esc;
  });
  return new RegExp(`(${PERSON_TITLE_PREFIX_PATTERN}|${parts.join("|")})`, "g");
}

export const DEFAULT_PERSON_NAME_RE = compilePersonNameRegex(BASE_PERSON_NAMES);

export const COMPANY_LOGOS = {
  Nvidia: "nvidia.com", NVIDIA: "nvidia.com", 英伟达: "nvidia.com",
  Apple: "apple.com", 苹果: "apple.com",
  Microsoft: "microsoft.com", 微软: "microsoft.com",
  Alphabet: "google.com", Google: "google.com", 谷歌: "google.com",
  Amazon: "amazon.com", 亚马逊: "amazon.com",
  Meta: "meta.com",
  Tesla: "tesla.com", 特斯拉: "tesla.com",
  Anthropic: "anthropic.com", OpenAI: "openai.com",
  "Google DeepMind": "deepmind.google", DeepMind: "deepmind.google",
  DeepSeek: "deepseek.com", xAI: "x.ai",
  "Mistral AI": "mistral.ai", Mistral: "mistral.ai",
  "Perplexity AI": "perplexity.ai", Perplexity: "perplexity.ai",
  Cohere: "cohere.com", "Hugging Face": "huggingface.co", "Meta AI": "ai.meta.com",
  "Safe Superintelligence": "ssi.inc", "Thinking Machines Lab": "thinkingmachines.ai",
  "Thinking Machines": "thinkingmachines.ai", "Scale AI": "scale.com",
  "Moonshot AI": "moonshot.cn", "Zhipu AI": "zhipuai.cn", 智谱AI: "zhipuai.cn", 智谱: "zhipuai.cn",
  MiniMax: "minimax.io", Midjourney: "midjourney.com", Runway: "runwayml.com",
  ElevenLabs: "elevenlabs.io", Cursor: "cursor.com", "Character.AI": "character.ai",
  Huawei: "huawei.com", 华为: "huawei.com", TSMC: "tsmc.com", 台积电: "tsmc.com",
  Samsung: "samsung.com", 三星: "samsung.com", ByteDance: "bytedance.com", 字节跳动: "bytedance.com",
  TikTok: "tiktok.com", Alibaba: "alibaba.com", 阿里巴巴: "alibaba.com",
  Tencent: "tencent.com", 腾讯: "tencent.com", Baidu: "baidu.com", 百度: "baidu.com",
  Xiaomi: "mi.com", 小米: "mi.com", BYD: "byd.com", 比亚迪: "byd.com",
  CATL: "catl.com", 宁德时代: "catl.com", Meituan: "meituan.com", 美团: "meituan.com",
  "JD.com": "jd.com", 京东: "jd.com", PDD: "pddholdings.com", 拼多多: "pddholdings.com",
  Intel: "intel.com", AMD: "amd.com", Broadcom: "broadcom.com", Qualcomm: "qualcomm.com",
  ASML: "asml.com", Oracle: "oracle.com", Netflix: "netflix.com", SpaceX: "spacex.com",
  Boeing: "boeing.com", Toyota: "toyota.com", Sony: "sony.com", Nintendo: "nintendo.com",
  Disney: "disney.com", Walmart: "walmart.com", Costco: "costco.com",
  JPMorgan: "jpmorganchase.com", "Goldman Sachs": "goldmansachs.com", Palantir: "palantir.com",
  Salesforce: "salesforce.com", Adobe: "adobe.com", Uber: "uber.com", Stripe: "stripe.com",
  Spotify: "spotify.com", IBM: "ibm.com", Cisco: "cisco.com", SoftBank: "softbank.jp",
  Cloudflare: "cloudflare.com", CrowdStrike: "crowdstrike.com", Snowflake: "snowflake.com",
  Databricks: "databricks.com", Coinbase: "coinbase.com", Visa: "visa.com",
  Mastercard: "mastercard.com", Pfizer: "pfizer.com", "Eli Lilly": "lilly.com",
  "Novo Nordisk": "novonordisk.com", ExxonMobil: "exxonmobil.com", Chevron: "chevron.com",
  "Saudi Aramco": "aramco.com",
  "Agricultural Bank of China": "abchina.com", 中国农业银行: "abchina.com", 农行: "abchina.com",
  // Major News Networks & Media
  BBC: "bbc.com", CNN: "cnn.com", Reuters: "reuters.com", Bloomberg: "bloomberg.com",
  CNBC: "cnbc.com", "Fox News": "foxnews.com", "NBC News": "nbcnews.com", NBC: "nbcnews.com",
  "CBS News": "cbsnews.com", CBS: "cbsnews.com", "ABC News": "abcnews.go.com", ABC: "abcnews.go.com",
  MSNBC: "msnbc.com", NPR: "npr.org", "New York Times": "nytimes.com", NYT: "nytimes.com",
  "Washington Post": "washingtonpost.com", "Wall Street Journal": "wsj.com", WSJ: "wsj.com",
  "Financial Times": "ft.com", "The Guardian": "theguardian.com", "Associated Press": "apnews.com",
  "Al Jazeera": "aljazeera.com", Politico: "politico.com", "The Economist": "economist.com",
  "The Atlantic": "theatlantic.com", Axios: "axios.com", "News Corp": "newscorp.com",
  Comcast: "comcastcorporation.com", "Warner Bros. Discovery": "wbd.com", Paramount: "paramount.com",
  // Major Airlines & Aviation
  Airbus: "airbus.com", "Delta Air Lines": "delta.com", "United Airlines": "united.com",
  "American Airlines": "aa.com", "Southwest Airlines": "southwest.com",
  "Alaska Airlines": "alaskaair.com", JetBlue: "jetblue.com", FedEx: "fedex.com", UPS: "ups.com",
  Lufthansa: "lufthansa.com", "British Airways": "britishairways.com", "Air France": "airfrance.com",
  Emirates: "emirates.com", "Qatar Airways": "qatarairways.com",
  "Singapore Airlines": "singaporeair.com", "Cathay Pacific": "cathaypacific.com",
  "Japan Airlines": "jal.co.jp", "Korean Air": "koreanair.com",
  "Air China": "airchina.com.cn", 中国国航: "airchina.com.cn",
  "China Eastern": "ceair.com", 东方航空: "ceair.com",
  "China Southern": "csair.com", 南方航空: "csair.com",
  Qantas: "qantas.com", Ryanair: "ryanair.com", "Air Canada": "aircanada.com",
  // Major Space Agencies
  NASA: "nasa.gov", ESA: "esa.int", "European Space Agency": "esa.int",
  CNSA: "cnsa.gov.cn", "China National Space Administration": "cnsa.gov.cn", 国家航天局: "cnsa.gov.cn",
  Roscosmos: "roscosmos.ru", 俄罗斯航天局: "roscosmos.ru", JAXA: "jaxa.jp",
  ISRO: "isro.gov.in", "Indian Space Research Organisation": "isro.gov.in",
  "Canadian Space Agency": "asc-csa.gc.ca", CNES: "cnes.fr", DLR: "dlr.de",
  "Italian Space Agency": "asi.it", KASA: "kasa.go.kr",
  "Korea AeroSpace Administration": "kasa.go.kr", "UAE Space Agency": "space.gov.ae",
  "Australian Space Agency": "space.gov.au",
};

export const US_PARTY_TAGS = {
  "Democratic Party": "dem", "Senate Democrats": "dem", "House Democrats": "dem",
  Democrats: "dem", Democrat: "dem", Democratic: "dem", DNC: "dem",
  "Republican Party": "gop", "Senate Republicans": "gop", "House Republicans": "gop",
  Republicans: "gop", Republican: "gop", GOP: "gop", RNC: "gop",
};

export const PARTY_ICONS = {
  dem: `<svg class="inline-party-icon" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#1d6fe2"/><text x="8" y="11.6" text-anchor="middle" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="10.5" font-weight="800">D</text></svg>`,
  gop: `<svg class="inline-party-icon" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#d93829"/><text x="8" y="11.6" text-anchor="middle" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="10.5" font-weight="800">R</text></svg>`,
};

const ENTITY_DECORATOR_RE = (() => {
  const keys = [
    ...new Set([
      ...Object.keys(COMPANY_LOGOS),
      ...Object.keys(PLACE_ALIASES),
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

export function isLikelyPersonName(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length < 2 || s.length > 48) return false;
  if (COMPANY_LOGOS[s] || PLACE_ALIASES[s] || US_PARTY_TAGS[s]) return false;
  if (/^[\u4e00-\u9fff·]{2,6}$/.test(s)) return true;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  const particles = new Set([
    "de", "da", "del", "di", "van", "von", "bin", "al", "el", "la", "le", "Jr.", "Sr.", "II", "III", "IV",
  ]);
  return words.every((w) => particles.has(w) || /^[A-ZÀ-Ý][a-zA-ZÀ-ÿ'.-]+$/.test(w));
}

export function buildPersonNameRegexFromTexts(texts = [], companyFacts = null) {
  const names = new Set(BASE_PERSON_NAMES);
  for (const info of Object.values(companyFacts?.companies || {})) {
    const rawLeader = String(info?.leader || "").replace(/\s*\([^)]*\)\s*/g, "").trim();
    for (const part of rawLeader.split(/\s*(?:&|,|\/)\s*/)) {
      const cleaned = part.trim();
      if (isLikelyPersonName(cleaned)) names.add(cleaned);
    }
  }
  for (const txt of texts) {
    if (typeof txt !== "string" || !txt.includes("*")) continue;
    EXPLICIT_ITALIC_RE.lastIndex = 0;
    for (const m of txt.matchAll(EXPLICIT_ITALIC_RE)) {
      const candidate = (m[1] || "").trim();
      if (isLikelyPersonName(candidate)) names.add(candidate);
    }
  }
  return compilePersonNameRegex([...names]);
}

export function renderCompanyLogoImg(domain) {
  const src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
  return `<img class="inline-logo" src="${src}" width="14" height="14" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

export function renderCountryFlagImg(code) {
  const src = `https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/${encodeURIComponent(code)}.svg`;
  return `<img class="inline-flag-icon" src="${src}" width="16" height="12" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
}

export function glueIconWithText(iconHtml, text) {
  const s = String(text ?? "");
  if (!iconHtml) return escapeHtml(s);
  const sp = s.indexOf(" ");
  if (sp === -1) {
    return `<span class="icon-glue">${iconHtml}${escapeHtml(s)}</span>`;
  }
  return `<span class="icon-glue">${iconHtml}${escapeHtml(s.slice(0, sp))}</span>${escapeHtml(s.slice(sp))}`;
}

const BANKING_ABC_RE =
  /\b(?:ICBC|CCB|BOC|PBOC|People's Bank|Big Four|Agricultural Bank|state-owned banks?|commercial banks?|major banks?|lending|loans?|yuan|renminbi|relending|banks?|banking)\b|农行|农业银行|四大行|四大商业银行/i;
const NON_MEDIA_ABC_RE =
  /\b(?:Alcoholic Beverage|Australian Broadcasting|Activity-Based|ABC(?:'s)?\s+of\b|ABC\s+(?:islands|weapons|stores?|liquor|board|commission|license|permit|permittee))\b/i;
const NATIVE_BEFORE_RE = /\bNative\s+$/i;
const INDIGENOUS_INDIAN_CTX_RE =
  /\b(?:American|Native|Plains|Pueblo|Navajo|Cherokee|Sioux|Apache|Mohawk|Iroquois|Algonquin|Seminole|Lakota|Shawnee|Cheyenne|Comanche|Wampanoag)\s+Indians?\b|\bIndians?\s+(?:Tribes?|Tribal|Nations?|Reservations?|Territory|Affairs|Health Service|Country|Heritage|Boarding Schools?|Child Welfare|Gaming|Lands?)\b|\b(?:Indigenous|Native Americans?|First Nations|Bureau of Indian Affairs|Pilgrims|Thanksgiving)\b/i;
const EU_INSTITUTION_AFTER_RE =
  /^\s+(?:Commission|Parliament|Council|Central Bank|Court of Justice|Medicines Agency|External Action|Investment Bank|Stability Mechanism|Banking Authority|Securities|Single Market|Green Deal|Defen[cs]e Fund|Competitiveness)\b/i;
const PERSON_PREFIX_STRIP_RE =
  /^(?:President|Prime Minister|Attorney General|Secretary|Chairman|Mayor|Governor|Pope|King|Queen|Justice|Judge|CEO|Sen\.-elect|Sen\.|Rep\.|Gov\.|Dr\.)\s+/i;
const NON_INDEX_DOW_AFTER_RE = /^\s+(?:Chemical|Inc\.?|Corning|DuPont|AgroSciences)\b/i;

function renderPersonSpan(raw) {
  const title = String(raw || "").trim().replace(PERSON_PREFIX_STRIP_RE, "").trim();
  const attr = title ? ` class="person-mention" tabindex="0" data-wiki-title="${escapeHtml(title)}"` : "";
  return `<em${attr}>${escapeHtml(raw)}</em>`;
}

export function createEntityFormatter({
  getPersonRe = () => DEFAULT_PERSON_NAME_RE,
  getTickerMap = () => null,
  getInlineTickerRe = () => null,
  formatTickerTip = () => "",
  deltaClass = () => "flat",
  pillCompaniesInSummary = true,
} = {}) {
  const decorateFlagsAndLogos = (segment, seen = new Set(), pillCompanies = false) => {
    if (!segment) return "";
    ENTITY_DECORATOR_RE.lastIndex = 0;
    let out = "";
    let last = 0;
    for (const m of segment.matchAll(ENTITY_DECORATOR_RE)) {
      const token = m[0];
      const idx = m.index ?? 0;
      if (idx > last) out += escapeHtml(segment.slice(last, idx));
      let domain = COMPANY_LOGOS[token];
      if (token === "ABC") {
        const ctx = segment.slice(Math.max(0, idx - 100), Math.min(segment.length, idx + 100));
        if (BANKING_ABC_RE.test(ctx)) {
          domain = "abchina.com";
        } else if (NON_MEDIA_ABC_RE.test(ctx)) {
          domain = undefined;
        }
      }
      let placeId = PLACE_ALIASES[token];
      if (placeId === "us" && (token === "American" || token === "Americans")) {
        const before = segment.slice(Math.max(0, idx - 12), idx);
        if (NATIVE_BEFORE_RE.test(before)) placeId = undefined;
      } else if (placeId === "in" && (token === "Indian" || token === "Indians")) {
        const ctx = segment.slice(Math.max(0, idx - 60), Math.min(segment.length, idx + 60));
        if (INDIGENOUS_INDIAN_CTX_RE.test(ctx)) placeId = undefined;
      } else if (placeId === "continent-europe" && token === "European") {
        const after = segment.slice(idx + token.length, Math.min(segment.length, idx + token.length + 35));
        if (EU_INSTITUTION_AFTER_RE.test(after)) placeId = "eu";
      }
      const party = US_PARTY_TAGS[token];
      if (domain) {
        const key = `logo:${domain}`;
        let logoHtml = "";
        if (!seen.has(key)) {
          seen.add(key);
          logoHtml = renderCompanyLogoImg(domain);
        }
        out += pillCompanies
          ? `<span class="ticker-tag is-private" tabindex="0" data-company-domain="${escapeHtml(domain)}">${glueIconWithText(logoHtml, token)}</span>`
          : `<span class="company-mention" tabindex="0" data-company-domain="${escapeHtml(domain)}">${glueIconWithText(logoHtml, token)}</span>`;
      } else if (placeId) {
        const place = PLACE_META[placeId];
        let flagHtml = "";
        if (place?.showInlineFlag) {
          const key = `flag:${place.flagCode}`;
          if (!seen.has(key)) {
            seen.add(key);
            flagHtml = renderCountryFlagImg(place.flagCode);
          }
        }
        out += `<span class="country-mention" tabindex="0" data-country-code="${escapeHtml(placeId)}">${glueIconWithText(flagHtml, token)}</span>`;
      } else if (party) {
        const key = `party:${party}`;
        let iconHtml = "";
        if (!seen.has(key)) {
          seen.add(key);
          iconHtml = PARTY_ICONS[party] || "";
        }
        const partyWiki =
          party === "dem" ? "Democratic Party (United States)" : "Republican Party (United States)";
        out += `<span class="party-mention ${party}" tabindex="0" data-wiki-title="${escapeHtml(partyWiki)}">${glueIconWithText(iconHtml, token)}</span>`;
      } else {
        out += escapeHtml(token);
      }
      last = idx + token.length;
    }
    if (last < segment.length) out += escapeHtml(segment.slice(last));
    return out;
  };

  const formatEntitiesInPlain = (segment, seen = new Set(), pillCompanies = false) => {
    if (!segment) return "";
    EXPLICIT_ITALIC_RE.lastIndex = 0;
    if (EXPLICIT_ITALIC_RE.test(segment)) {
      EXPLICIT_ITALIC_RE.lastIndex = 0;
      let out = "";
      let last = 0;
      for (const m of segment.matchAll(EXPLICIT_ITALIC_RE)) {
        const idx = m.index ?? 0;
        if (idx > last) out += decorateFlagsAndLogos(segment.slice(last, idx), seen, pillCompanies);
        out += renderPersonSpan(m[1]);
        last = idx + m[0].length;
      }
      if (last < segment.length) out += decorateFlagsAndLogos(segment.slice(last), seen, pillCompanies);
      return out;
    }

    const personRe = getPersonRe() || DEFAULT_PERSON_NAME_RE;
    personRe.lastIndex = 0;
    let out = "";
    let last = 0;
    for (const m of segment.matchAll(personRe)) {
      const idx = m.index ?? 0;
      if (idx > last) out += decorateFlagsAndLogos(segment.slice(last, idx), seen, pillCompanies);
      out += renderPersonSpan(m[0]);
      last = idx + m[0].length;
    }
    if (last < segment.length) out += decorateFlagsAndLogos(segment.slice(last), seen, pillCompanies);
    return out;
  };

  const escapeWithTickers = (segment, seen = new Set()) => {
    if (!segment) return "";
    const tickerMap = getTickerMap();
    const tickerRe = getInlineTickerRe();
    if (!tickerMap?.size || !tickerRe) {
      return formatEntitiesInPlain(segment, seen, pillCompaniesInSummary);
    }
    tickerRe.lastIndex = 0;
    let out = "";
    let lastIdx = 0;
    for (const match of segment.matchAll(tickerRe)) {
      const token = match[0];
      const info = tickerMap.get(token);
      if (!info) continue;
      const idx = match.index ?? 0;
      if (token === "Dow") {
        const after = segment.slice(idx + token.length, Math.min(segment.length, idx + token.length + 24));
        if (NON_INDEX_DOW_AFTER_RE.test(after)) continue;
      }
      if (idx > lastIdx) out += formatEntitiesInPlain(segment.slice(lastIdx, idx), seen, pillCompaniesInSummary);
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
      const domainAttr = domain ? ` data-company-domain="${escapeHtml(domain)}"` : "";
      out += `<span class="ticker-tag ${cls}" tabindex="0" data-ticker-sym="${escapeHtml(info.symbol)}" data-ticker-tip="${escapeHtml(tip)}"${domainAttr} title="${escapeHtml(tip)}">${logoHtml}${escapeHtml(token)}</span>`;
      lastIdx = idx + token.length;
    }
    if (lastIdx < segment.length) out += formatEntitiesInPlain(segment.slice(lastIdx), seen, pillCompaniesInSummary);
    return out;
  };

  const highlightSummaryHtml = (text) => {
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
      if (idx > lastIdx) out += escapeWithTickers(raw.slice(lastIdx, idx), seen);
      const inner = hasExplicit ? match[1] : match[0];
      out += `<strong>${escapeWithTickers(inner, seen)}</strong>`;
      lastIdx = idx + match[0].length;
    }
    if (lastIdx < raw.length) out += escapeWithTickers(raw.slice(lastIdx), seen);
    return out;
  };

  return { decorateFlagsAndLogos, formatEntitiesInPlain, highlightSummaryHtml };
}

export const COMPANY_WIKI_OVERRIDES = {
  "apple.com": "Apple_Inc.",
  "amazon.com": "Amazon_(company)",
  "meta.com": "Meta_Platforms",
  "google.com": "Alphabet_Inc.",
  "delta.com": "Delta_Air_Lines",
  "paramount.com": "Paramount_Skydance",
  "cursor.com": "Cursor_(code_editor)",
  "runwayml.com": "Runway_(company)",
  "x.ai": "XAI_(company)",
  "ups.com": "United_Parcel_Service",
  "abcnews.go.com": "ABC_News",
  "abchina.com": "Agricultural_Bank_of_China",
  "reuters.com": "Reuters",
  "foxnews.com": "Fox_News",
  "britishairways.com": "British_Airways",
  "esa.int": "European_Space_Agency",
  "cnsa.gov.cn": "China_National_Space_Administration",
  "dlr.de": "German_Aerospace_Center",
  "asi.it": "Italian_Space_Agency",
  "kasa.go.kr": "Korea_AeroSpace_Administration",
};

export function buildEntityWikiUrl(el, getCompanyFacts = () => null) {
  if (!el) return "";
  const domain = el.dataset.companyDomain;
  if (domain) {
    if (COMPANY_WIKI_OVERRIDES[domain]) {
      return `https://en.wikipedia.org/wiki/${COMPANY_WIKI_OVERRIDES[domain]}`;
    }
    const fact = getCompanyFacts()?.companies?.[domain];
    const clean = (fact?.name || el.textContent || "").replace(/\s*\([^)]*\)\s*/g, "").trim();
    return clean ? `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/ /g, "_"))}` : "";
  }
  const title = el.dataset.wikiTitle;
  if (title) {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  }
  return "";
}

let inlineImgErrorBound = false;

export function initFloatingTooltips(getCompanyFacts = () => null) {
  if (!inlineImgErrorBound && typeof document !== "undefined") {
    inlineImgErrorBound = true;
    document.addEventListener(
      "error",
      (e) => {
        if (e.target?.matches?.(".inline-logo, .inline-flag-icon")) {
          e.target.style.display = "none";
        }
      },
      true
    );
  }
  const tip = document.createElement("div");
  tip.className = "floating-tip hidden";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);

  const SEL =
    ".ticker-tag[data-ticker-tip], .ticker-tag[data-company-domain], .company-mention[data-company-domain], .quote-name[data-company-domain], .person-mention[data-wiki-title], .party-mention[data-wiki-title], .quote-prev-badge[data-tooltip], .sentiment-gauge[data-tooltip]";
  let activeEl = null;

  const hide = () => {
    tip.classList.add("hidden");
    tip.classList.remove("is-company", "is-touch");
    activeEl = null;
  };

  const show = (el, includeWikiLink = false) => {
    const isTicker = el.classList.contains("ticker-tag");
    const domain = el.dataset.companyDomain;
    const fact = domain ? getCompanyFacts()?.companies?.[domain] : null;
    const tickerTip = el.dataset.tickerTip || "";
    const wikiUrl = buildEntityWikiUrl(el, getCompanyFacts);
    const wikiLinkHtml =
      includeWikiLink && wikiUrl
        ? `<div class="tip-wiki-row"><a class="tip-wiki-link" href="${wikiUrl}" target="_blank" rel="noopener noreferrer">Wikipedia &nearr;</a></div>`
        : "";

    if (fact && domain) {
      activeEl = el;
      const flagHtml = fact.country_code ? renderCountryFlagImg(fact.country_code) : "";
      const quoteRow = tickerTip ? `<div class="ctip-quote">${escapeHtml(tickerTip)}</div>` : "";
      const rows = [
        `<span class="ctip-k">Country</span><span class="ctip-v">${flagHtml}${escapeHtml(fact.country)}</span>`,
      ];
      if (fact.valuation && fact.valuation.includes("$")) {
        rows.push(`<span class="ctip-k">Valuation</span><span class="ctip-v">${escapeHtml(fact.valuation)}</span>`);
      } else if (fact.valuation) {
        rows.push(`<span class="ctip-k">Status</span><span class="ctip-v">${escapeHtml(fact.valuation)}</span>`);
      }
      if (fact.budget) {
        rows.push(`<span class="ctip-k">Budget</span><span class="ctip-v">${escapeHtml(fact.budget)}</span>`);
      }
      if (fact.bias) {
        const tone = fact.bias.tone || "neutral";
        const color = BIAS_TONE_COLOR[tone] || BIAS_TONE_COLOR.neutral;
        const gauge = buildHalfRingSvg(fact.bias.pos ?? 0.5, color);
        rows.push(
          `<span class="ctip-k">Bias</span><span class="ctip-v ctip-bias">${gauge}<span>${escapeHtml(fact.bias.text)}</span></span>`
        );
      }
      if (fact.leader) {
        rows.push(`<span class="ctip-k">Leader</span><span class="ctip-v">${escapeHtml(fact.leader)}</span>`);
      }
      tip.innerHTML = `
        <div class="ctip-head">${renderCompanyLogoImg(domain)}<span>${escapeHtml(fact.name)}</span></div>
        ${quoteRow}
        <div class="ctip-grid">
          ${rows.join("\n          ")}
        </div>
        ${wikiLinkHtml}
      `;
      tip.classList.remove("is-subtle");
      tip.classList.add("is-company");
      tip.classList.toggle("is-touch", Boolean(includeWikiLink && wikiUrl));
      tip.classList.remove("hidden");
    } else if (el.dataset.wikiTitle && wikiUrl) {
      activeEl = el;
      const label = el.dataset.wikiTitle;
      tip.innerHTML = includeWikiLink
        ? `<span>${escapeHtml(label)}</span> <a class="tip-wiki-link inline" href="${wikiUrl}" target="_blank" rel="noopener noreferrer">Wikipedia &nearr;</a>`
        : `${escapeHtml(label)} · Click for Wikipedia &nearr;`;
      tip.classList.remove("is-company");
      tip.classList.add("is-subtle");
      tip.classList.toggle("is-touch", Boolean(includeWikiLink));
      tip.classList.remove("hidden");
    } else {
      const text = isTicker ? tickerTip : el.dataset.tooltip;
      if (!text) return;
      activeEl = el;
      tip.textContent = text;
      tip.classList.remove("is-company", "is-touch");
      tip.classList.toggle("is-subtle", !isTicker);
      tip.classList.remove("hidden");
    }

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

  const canHover = () => window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;
  let lastPointerType = "mouse";

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch" || !canHover()) return;
    const el = e.target.closest(SEL);
    if (el) show(el, false);
  });

  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch" || !canHover()) return;
    const el = e.target.closest(SEL);
    if (el && el === activeEl) hide();
  });

  document.addEventListener("focusin", (e) => {
    if (lastPointerType === "touch" || !canHover()) return;
    const el = e.target.closest?.(SEL);
    if (el) show(el, false);
  });

  document.addEventListener("focusout", (e) => {
    const el = e.target.closest?.(SEL);
    if (el && el === activeEl) hide();
  });

  document.addEventListener(
    "pointerdown",
    (e) => {
      lastPointerType = e.pointerType || "mouse";
      if (!tip.contains(e.target) && !e.target.closest(SEL) && activeEl) {
        hide();
      }
    },
    { passive: true }
  );

  document.addEventListener("click", (e) => {
    if (tip.contains(e.target)) return;
    const el = e.target.closest(SEL);
    if (!el) {
      if (activeEl) hide();
      return;
    }
    const isTouch = lastPointerType === "touch" || !canHover();
    if (!isTouch) {
      const wikiUrl = buildEntityWikiUrl(el, getCompanyFacts);
      if (wikiUrl) {
        e.preventDefault();
        e.stopPropagation();
        window.open(wikiUrl, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (el.closest("a") || el.dataset.companyDomain || el.dataset.wikiTitle) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (activeEl === el && !tip.classList.contains("hidden")) {
      hide();
    } else {
      show(el, true);
    }
  });

  window.addEventListener("scroll", hide, { passive: true });
}

export function initEntityOverlays({ getCompanyFacts, getCountryLeaders }) {
  initSourceBiasPopover();
  initFloatingTooltips(getCompanyFacts);
  initCountryMapTooltip(escapeHtml, renderCountryFlagImg, (code) => {
    const leaders = typeof getCountryLeaders === "function" ? getCountryLeaders() : null;
    return leaders?.leaders?.[code] || null;
  });
}

export async function loadSharedEntityData(briefingDataBase, { cache = "no-store" } = {}) {
  const [factsRes, leadersRes] = await Promise.allSettled([
    fetchJson(`${briefingDataBase}/company_facts.json`, { cache }),
    fetchJson(`${briefingDataBase}/country_leaders.json`, { cache }),
  ]);
  return {
    companyFacts: factsRes.status === "fulfilled" ? factsRes.value : null,
    countryLeaders: leadersRes.status === "fulfilled" ? leadersRes.value : null,
  };
}

export function createCachedPersonFormatter(getCompanyFacts) {
  let cachedFactsRef = undefined;
  let basePersonRe = DEFAULT_PERSON_NAME_RE;

  function getBaseRegex() {
    const facts = typeof getCompanyFacts === "function" ? getCompanyFacts() : null;
    if (facts !== cachedFactsRef) {
      cachedFactsRef = facts;
      basePersonRe = facts ? buildPersonNameRegexFromTexts([], facts) : DEFAULT_PERSON_NAME_RE;
    }
    return basePersonRe;
  }

  return function getFormatterForTexts(texts, pillCompaniesInSummary = false) {
    const hasItalics = texts.some((t) => typeof t === "string" && t.includes("*"));
    const facts = typeof getCompanyFacts === "function" ? getCompanyFacts() : null;
    const personRe = hasItalics ? buildPersonNameRegexFromTexts(texts, facts) : getBaseRegex();
    return createEntityFormatter({
      getPersonRe: () => personRe,
      pillCompaniesInSummary,
    });
  };
}
