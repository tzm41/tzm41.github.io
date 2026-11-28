/**
 * Shared Entity Recognition, Highlighting, Wikipedia Links & Rich Floating Tooltips
 * Used by both Daily Briefing (/briefing/) and Weekly Briefing (/weekly/).
 */

import { PLACE_ALIASES, PLACE_META, initCountryMapTooltip } from "./country-map.js";
import { BIAS_TONE_COLOR, buildHalfRingSvg, initSourceBiasPopover } from "./ui.js";
import { escapeHtml, escapeRegex, fetchJson } from "./utils.js";

export const EXPLICIT_BOLD_RE = /\*\*((?:(?!\*\*(?!\*)).)+?)\*\*(?!\*)/g;
export const FALLBACK_HIGHLIGHT_RE =
  /(?<![\w.$])([+-]?\$\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|trillion|M|B|K))?|[+-]?\d[\d,]*(?:\.\d+)?%|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b)(?!\w)|(['"][A-Z][^'"]{1,40}['"])/g;
export const EXPLICIT_ITALIC_RE = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;

const NON_PERSON_TITLE_WORD =
  "(?:Reinstatement|Leadership|Resignation|Nomination|Election|Administration|Succession|Investigation|Hearing|Policy|Orders?|Return|Ouster|Exit|Role|Office|Vote|Race|Campaign|Debate|Summit|Visit|Meeting|Statement|Scrutiny|Backlash|Reversal|Power|Term|Authority|Pardon|Veto|Cabinet|Approval|Polls?|Rules?|Ruling|Blocks?|Blocked|Strikes?|Struck|Signs?|Signed|Vetoes?|Vetoed|Faces?|Facing|Warns?|Warned|Urges?|Urged|Calls?|Called|Backs?|Backed|Rejects?|Rejected|Approves?|Approved|Dismisses?|Dismissed|Halts?|Halted|Upholds?|Upheld|Overturns?|Overturned|Allows?|Allowed|Bars?|Barred|Finds?|Found|Says?|Said|Tells?|Told|Slams?|Praises?|Meets?|Met|Visits?|Plans?|Seeks?|Pushes?|Moves?|Drops?|Opens?|Closes?|Ends?|Starts?|Launches?|Announces?|Unveils?|Proposes?|Defends?|Criticizes?|Accuses?|Targets?|Threatens?|Promises?|Vows?|Pledges?|Cites?|Names?|Picks?|Taps?|Fires?|Hires?|Quits?|Resigns?|Steps?|Takes?|Gives?|Gets?|Makes?|Sets?|Holds?|Wins?|Loses?|Leads?|Trails?|Violates?|Violated|Sues?|Sued|Indicts?|Indicted|Charges?|Charged|Decision|Verdict|Court|Panel|Bench|Bill|Act|Law|Plan|Deal|Talks|Move|Push|Bid|Case|Trial|Suit|Probe|Report|Review|Speech|Address|Remarks|Briefing|Press|News|Media|Team|Staff|Aides?|Allies|Critics|Supporters|Opponents|Rivals|Voters|Lawmakers|Senators|Democrats|Republicans|Officials|Leaders|Ministers|Justices|Judges|Federal|State|Local|National|Global|Foreign|Domestic|New|Top|Former|Acting|Interim|Chief|Senior|Junior|High|Supreme|Appeals|District|Circuit|Over|Under|With|Without|From|Into|Onto|Against|After|Before|During|Amid|Among|Between|Through|About|Around|Near|Behind|Beyond|Towards?|For|And|But|Or|Nor|Not|No|To|In|On|At|By|Of|As|Is|Are|Was|Were|Be|Been|Has|Have|Had|Will|Would|Could|Should|May|Might|Must|Can|That|This|Who|Whom|Whose|Which|What|When|Where|Why|How)\\b";

export const BASE_PERSON_NAMES = [];

const PERSON_NAME_WORD = `(?!${NON_PERSON_TITLE_WORD})[A-ZÀ-Ý][a-zà-ÿ'-]+`;
const PERSON_TITLE_PREFIX_PATTERN = `(?:President|Prime Minister|Pope|Sen\\.-elect|Sen\\.|Rep\\.|Gov\\.|Dr\\.)\\s+${PERSON_NAME_WORD}(?:\\s+${PERSON_NAME_WORD}){0,2}|(?:Attorney General|Secretary|Chairman|Mayor|Governor|Justice|Judge|CEO)\\s+${PERSON_NAME_WORD}\\s+${PERSON_NAME_WORD}(?:\\s+${PERSON_NAME_WORD})?`;

export function compilePersonNameRegex(names) {
  const unique = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!unique.length) return new RegExp(`(${PERSON_TITLE_PREFIX_PATTERN})`, "g");
  const parts = unique.map((n) => {
    const esc = escapeRegex(n);
    return /^[\x00-\x7F\u00C0-\u024F]+$/.test(n) ? `\\b${esc}\\b` : esc;
  });
  return new RegExp(`(${PERSON_TITLE_PREFIX_PATTERN}|${parts.join("|")})`, "g");
}

export let DEFAULT_PERSON_NAME_RE = compilePersonNameRegex(BASE_PERSON_NAMES);

export const COMPANY_LOGOS = {};
export const LOCAL_COMPANY_LOGOS = {};
export const COMPANY_WIKI_OVERRIDES = {};
export const US_PARTY_TAGS = {};

export const PARTY_ICONS = {
  dem: `<svg class="inline-party-icon" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#1d6fe2"/><text x="8" y="11.6" text-anchor="middle" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="10.5" font-weight="800">D</text></svg>`,
  gop: `<svg class="inline-party-icon" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3" fill="#d93829"/><text x="8" y="11.6" text-anchor="middle" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="10.5" font-weight="800">R</text></svg>`,
};

/* ---------- Prefix Trie Matcher (O(text_length), dictionary-size independent) ---------- */

const ASCII_WORD_CHAR_RE = /[A-Za-z0-9_]/;

function isWordBoundaryOk(text, start, end, needLeftBoundary, needRightBoundary) {
  if (needLeftBoundary && start > 0 && ASCII_WORD_CHAR_RE.test(text[start - 1])) return false;
  if (needRightBoundary && end < text.length && ASCII_WORD_CHAR_RE.test(text[end])) return false;
  return true;
}

export function insertIntoPrefixTrie(root, keys) {
  if (!root || !keys) return root;
  for (const key of keys) {
    if (!key) continue;
    let node = root;
    for (let i = 0; i < key.length; i++) {
      const ch = key[i];
      if (!node[ch]) node[ch] = Object.create(null);
      node = node[ch];
    }
    const isAscii = /^[\x00-\x7F]+$/.test(key);
    node.$ = {
      key,
      len: key.length,
      leftBoundary: isAscii && ASCII_WORD_CHAR_RE.test(key[0]),
      rightBoundary: isAscii && ASCII_WORD_CHAR_RE.test(key[key.length - 1]),
    };
  }
  return root;
}

export function buildPrefixTrie(keys) {
  return insertIntoPrefixTrie(Object.create(null), keys);
}

function longestMatchAt(text, pos, trie) {
  if (!trie) return null;
  let node = trie;
  let best = null;
  for (let i = pos; i < text.length; i++) {
    const next = node[text[i]];
    if (!next) break;
    node = next;
    const hit = node.$;
    if (hit && isWordBoundaryOk(text, pos, i + 1, hit.leftBoundary, hit.rightBoundary)) {
      best = hit;
    }
  }
  return best;
}

/**
 * Scan `text` left-to-right picking the longest valid match across `baseTrie`
 * and optional `overlayTrie` (used for per-story Tier-1 LLM entities without recompiling).
 */
export function findLongestMatches(text, baseTrie, overlayTrie = null) {
  const matches = [];
  let i = 0;
  while (i < text.length) {
    const a = longestMatchAt(text, i, baseTrie);
    const b = overlayTrie ? longestMatchAt(text, i, overlayTrie) : null;
    const best = a && b ? (b.len >= a.len ? b : a) : a || b;
    if (best) {
      matches.push({ token: best.key, index: i, length: best.len });
      i += best.len;
    } else {
      i += 1;
    }
  }
  return matches;
}

let BASE_ENTITY_TRIE = buildPrefixTrie(Object.keys(PLACE_ALIASES));

const MERGED_ENTITY_STORE = {
  schema_version: "3.0",
  updated_at: "",
  companies: {},
  indices: {},
  people: [],
  us_parties: {},
};

const loadedShards = new Set();
const inFlightShards = new Map();
let manifestCache = null;
let manifestPromise = null;
const PRIMARY_ALIAS_KEYS = new Set();
const KNOWN_PERSON_SET = new Set();
let registryVersion = 0;

export function getEntityRegistryVersion() {
  return registryVersion;
}

/**
 * Additively merge a sharded entity payload (`hot.json` or any cold shard) into
 * the live in-memory registries and incrementally insert new keys into `BASE_ENTITY_TRIE`.
 * Never wipes prior shards and preserves primary-over-ambiguous alias precedence
 * regardless of shard merge order.
 */
export function mergeEntityRegistry(shardJson) {
  if (!shardJson || typeof shardJson !== "object") return false;

  const newTrieKeys = [];
  let peopleAdded = false;
  let changed = false;

  if (shardJson.schema_version) {
    MERGED_ENTITY_STORE.schema_version = shardJson.schema_version;
  }
  if (
    shardJson.updated_at &&
    (!MERGED_ENTITY_STORE.updated_at || shardJson.updated_at > MERGED_ENTITY_STORE.updated_at)
  ) {
    MERGED_ENTITY_STORE.updated_at = shardJson.updated_at;
  }

  const companies = shardJson.companies;
  if (companies && typeof companies === "object") {
    for (const [domain, info] of Object.entries(companies)) {
      if (!info || typeof info !== "object") continue;
      MERGED_ENTITY_STORE.companies[domain] = info;
      changed = true;
      for (const alias of info.aliases || []) {
        if (!alias) continue;
        const hadKey = Object.prototype.hasOwnProperty.call(COMPANY_LOGOS, alias);
        COMPANY_LOGOS[alias] = domain;
        PRIMARY_ALIAS_KEYS.add(alias);
        if (!hadKey) newTrieKeys.push(alias);
      }
      for (const alias of info.ambiguous_aliases || []) {
        if (!alias) continue;
        if (
          !PRIMARY_ALIAS_KEYS.has(alias) &&
          !Object.prototype.hasOwnProperty.call(COMPANY_LOGOS, alias)
        ) {
          COMPANY_LOGOS[alias] = domain;
          newTrieKeys.push(alias);
        }
      }
      if (info.logo) {
        LOCAL_COMPANY_LOGOS[domain] = new URL(`./logos/${info.logo}`, import.meta.url).href;
      }
      if (info.wiki) {
        COMPANY_WIKI_OVERRIDES[domain] = info.wiki;
      }
    }
  }

  if (shardJson.indices && typeof shardJson.indices === "object") {
    Object.assign(MERGED_ENTITY_STORE.indices, shardJson.indices);
    changed = true;
  }

  if (shardJson.us_parties && typeof shardJson.us_parties === "object") {
    for (const [k, v] of Object.entries(shardJson.us_parties)) {
      if (!Object.prototype.hasOwnProperty.call(US_PARTY_TAGS, k)) {
        newTrieKeys.push(k);
      }
      US_PARTY_TAGS[k] = v;
      MERGED_ENTITY_STORE.us_parties[k] = v;
      changed = true;
    }
  }

  if (Array.isArray(shardJson.people)) {
    for (const person of shardJson.people) {
      if (person && !KNOWN_PERSON_SET.has(person)) {
        KNOWN_PERSON_SET.add(person);
        BASE_PERSON_NAMES.push(person);
        MERGED_ENTITY_STORE.people.push(person);
        peopleAdded = true;
        changed = true;
      }
    }
    if (peopleAdded) {
      DEFAULT_PERSON_NAME_RE = compilePersonNameRegex(BASE_PERSON_NAMES);
    }
  }

  if (newTrieKeys.length) {
    insertIntoPrefixTrie(BASE_ENTITY_TRIE, newTrieKeys);
  }

  if (changed) {
    registryVersion += 1;
  }

  return changed;
}

/**
 * Full-reset hydration for backwards compatibility (e.g., tests or monolithic payloads).
 * Clears all registries and shard caches, then merges `entitiesJson`.
 */
export function hydrateEntityRegistry(entitiesJson) {
  if (!entitiesJson || typeof entitiesJson !== "object") return;

  for (const k of Object.keys(COMPANY_LOGOS)) delete COMPANY_LOGOS[k];
  for (const k of Object.keys(LOCAL_COMPANY_LOGOS)) delete LOCAL_COMPANY_LOGOS[k];
  for (const k of Object.keys(COMPANY_WIKI_OVERRIDES)) delete COMPANY_WIKI_OVERRIDES[k];
  for (const k of Object.keys(US_PARTY_TAGS)) delete US_PARTY_TAGS[k];
  for (const k of Object.keys(MERGED_ENTITY_STORE.companies)) delete MERGED_ENTITY_STORE.companies[k];
  for (const k of Object.keys(MERGED_ENTITY_STORE.indices)) delete MERGED_ENTITY_STORE.indices[k];
  for (const k of Object.keys(MERGED_ENTITY_STORE.us_parties)) delete MERGED_ENTITY_STORE.us_parties[k];
  MERGED_ENTITY_STORE.people.length = 0;
  MERGED_ENTITY_STORE.updated_at = "";
  MERGED_ENTITY_STORE.schema_version = entitiesJson.schema_version || "3.0";

  PRIMARY_ALIAS_KEYS.clear();
  KNOWN_PERSON_SET.clear();
  BASE_PERSON_NAMES.length = 0;
  loadedShards.clear();
  inFlightShards.clear();
  manifestCache = null;
  manifestPromise = null;

  DEFAULT_PERSON_NAME_RE = compilePersonNameRegex(BASE_PERSON_NAMES);
  BASE_ENTITY_TRIE = buildPrefixTrie(Object.keys(PLACE_ALIASES));
  registryVersion += 1;

  mergeEntityRegistry(entitiesJson);
}

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
  const src =
    LOCAL_COMPANY_LOGOS[domain] ||
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
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

/* ---------- Minimal Tier-2 Safety-Net Guards (Tier-1 LLM entities[] is primary) ---------- */

const BANKING_CTX_RE =
  /\b(?:ICBC|CCB|BOC|PBOC|PBoC|PSBC|BoCom|CMB|People's Bank|Big Four|Agricultural Bank|Bank of China|Construction Bank|Merchants Bank|state-owned banks?|commercial banks?|major banks?|lending|loans?|yuan|renminbi|relending|banks?|banking)\b|农行|农业银行|工行|建行|中行|招行|交行|四大行|四大商业银行|银行|贷款|央行/i;
const CANADA_BANK_CTX_RE = /\b(?:Canada|Canadian|Ottawa|Macklem|loonie|CAD)\b/i;
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

/**
 * Minimal Tier-2 safety net for legacy/untagged archives and high-collision short acronyms.
 * All other semantic disambiguation is delegated to Tier-1 LLM-assigned `entities[]`.
 */
const HEURISTIC_DISAMBIGUATORS = {
  ABC: ({ ctx }) => {
    if (BANKING_CTX_RE.test(ctx)) return { type: "company", domain: "abchina.com" };
    if (NON_MEDIA_ABC_RE.test(ctx)) return { type: "none" };
    return { type: "company", domain: "abcnews.go.com" };
  },
  BOC: ({ ctx }) =>
    !CANADA_BANK_CTX_RE.test(ctx) && BANKING_CTX_RE.test(ctx)
      ? { type: "company", domain: "boc.cn" }
      : { type: "none" },
  CCB: ({ ctx }) => (BANKING_CTX_RE.test(ctx) ? { type: "company", domain: "ccb.com" } : { type: "none" }),
  CMB: ({ ctx }) => (BANKING_CTX_RE.test(ctx) ? { type: "company", domain: "cmbchina.com" } : { type: "none" }),
  American: ({ before }) => (NATIVE_BEFORE_RE.test(before) ? { type: "none" } : null),
  Americans: ({ before }) => (NATIVE_BEFORE_RE.test(before) ? { type: "none" } : null),
  Indian: ({ ctx }) => (INDIGENOUS_INDIAN_CTX_RE.test(ctx) ? { type: "none" } : null),
  Indians: ({ ctx }) => (INDIGENOUS_INDIAN_CTX_RE.test(ctx) ? { type: "none" } : null),
  European: ({ after }) => (EU_INSTITUTION_AFTER_RE.test(after) ? { type: "place", placeId: "eu" } : null),
};

/**
 * Normalize an array of LLM-assigned EntityIdentity objects into a lookup Map keyed by mention.
 */
export function buildEntityIdentityMap(...entityLists) {
  const map = new Map();
  for (const list of entityLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const mention = String(item?.mention || "").trim();
      const type = String(item?.type || "").trim().toLowerCase();
      if (!mention || !type) continue;
      map.set(mention, {
        mention,
        type,
        canonical_name: String(item.canonical_name || "").trim(),
        domain: String(item.domain || "").trim().toLowerCase(),
        country_code: String(item.country_code || "").trim().toLowerCase(),
        wiki_title: String(item.wiki_title || "").trim(),
      });
    }
  }
  return map;
}

function renderPersonSpan(raw, wikiTitleOverride = "") {
  const title =
    String(wikiTitleOverride || "").trim() ||
    String(raw || "").trim().replace(PERSON_PREFIX_STRIP_RE, "").trim();
  const attr = title ? ` class="person-mention" tabindex="0" data-wiki-title="${escapeHtml(title)}"` : "";
  return `<em${attr}>${escapeHtml(raw)}</em>`;
}

export function createEntityFormatter({
  getPersonRe = () => DEFAULT_PERSON_NAME_RE,
  getTickerMap = () => null,
  getInlineTickerRe = () => null,
  getEntities = () => null,
  formatTickerTip = () => "",
  deltaClass = () => "flat",
  pillCompaniesInSummary = true,
} = {}) {
  const resolveEntityContext = (opts) => {
    const globalList = typeof getEntities === "function" ? getEntities() : null;
    const localList = opts?.entities || null;
    if ((!globalList || !globalList.length) && (!localList || !localList.length)) {
      return { entityMap: null, overlayTrie: null };
    }
    const entityMap = buildEntityIdentityMap(globalList, localList);
    const extraKeys = [...entityMap.keys()].filter(
      (k) => !COMPANY_LOGOS[k] && !PLACE_ALIASES[k] && !US_PARTY_TAGS[k]
    );
    return {
      entityMap,
      overlayTrie: extraKeys.length ? buildPrefixTrie(extraKeys) : null,
    };
  };

  const decorateFlagsAndLogos = (segment, seen = new Set(), pillCompanies = false, opts = {}) => {
    if (!segment) return "";
    const ctxObj = opts._prepared ? opts : resolveEntityContext(opts);
    const entityMap = ctxObj.entityMap ?? null;
    const overlayTrie = ctxObj.overlayTrie ?? null;
    const fullText = opts._fullText || segment;

    const matches = findLongestMatches(segment, BASE_ENTITY_TRIE, overlayTrie);
    if (!matches.length) return escapeHtml(segment);

    let out = "";
    let last = 0;
    for (const m of matches) {
      const token = m.token;
      const idx = m.index;
      if (idx > last) out += escapeHtml(segment.slice(last, idx));

      let domain;
      let placeId;
      let party;
      let personWiki;
      let companyWiki;

      // Tier 1: Explicit LLM-assigned semantic identity takes highest precedence
      const explicit = entityMap?.get(token) || null;
      if (explicit) {
        if (explicit.type === "company") {
          domain = explicit.domain || COMPANY_LOGOS[explicit.canonical_name] || COMPANY_LOGOS[token];
          companyWiki = explicit.wiki_title || "";
        } else if (explicit.type === "person") {
          personWiki = explicit.wiki_title || explicit.canonical_name || token;
        } else if (explicit.type === "place") {
          placeId = explicit.country_code || PLACE_ALIASES[explicit.canonical_name] || PLACE_ALIASES[token];
        }
        // explicit.type === "none" intentionally leaves all fields undefined
      } else {
        // Tier 2: Full-text-aware heuristic disambiguator + static registries
        const rule = HEURISTIC_DISAMBIGUATORS[token];
        let resolved = null;
        if (rule) {
          const before = segment.slice(Math.max(0, idx - 24), idx);
          const after = segment.slice(idx + token.length, Math.min(segment.length, idx + token.length + 40));
          resolved = rule({ ctx: fullText, segment, before, after });
        }
        if (resolved) {
          if (resolved.type === "company") {
            domain = resolved.domain;
            companyWiki = resolved.wikiTitle || "";
          } else if (resolved.type === "place") {
            placeId = resolved.placeId;
          }
          // resolved.type === "none" intentionally leaves all fields undefined
        } else {
          domain = COMPANY_LOGOS[token];
          placeId = PLACE_ALIASES[token];
          party = US_PARTY_TAGS[token];
        }
      }

      if (personWiki) {
        out += renderPersonSpan(token, personWiki);
      } else if (domain) {
        const key = `logo:${domain}`;
        let logoHtml = "";
        if (!seen.has(key)) {
          seen.add(key);
          logoHtml = renderCompanyLogoImg(domain);
        }
        const wikiAttr = companyWiki ? ` data-wiki-title="${escapeHtml(companyWiki)}"` : "";
        out += pillCompanies
          ? `<span class="ticker-tag is-private" tabindex="0" data-company-domain="${escapeHtml(domain)}"${wikiAttr}>${glueIconWithText(logoHtml, token)}</span>`
          : `<span class="company-mention" tabindex="0" data-company-domain="${escapeHtml(domain)}"${wikiAttr}>${glueIconWithText(logoHtml, token)}</span>`;
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

  const formatEntitiesInPlain = (segment, seen = new Set(), pillCompanies = false, opts = {}) => {
    if (!segment) return "";
    const runOpts = opts._prepared
      ? opts
      : { _prepared: true, _fullText: opts._fullText || segment, ...resolveEntityContext(opts) };
    const entityMap = runOpts.entityMap;

    EXPLICIT_ITALIC_RE.lastIndex = 0;
    if (EXPLICIT_ITALIC_RE.test(segment)) {
      EXPLICIT_ITALIC_RE.lastIndex = 0;
      let out = "";
      let last = 0;
      for (const m of segment.matchAll(EXPLICIT_ITALIC_RE)) {
        const idx = m.index ?? 0;
        if (idx > last) out += decorateFlagsAndLogos(segment.slice(last, idx), seen, pillCompanies, runOpts);
        const explicit = entityMap?.get(m[1]);
        out += renderPersonSpan(m[1], explicit?.type === "person" ? explicit.wiki_title || explicit.canonical_name : "");
        last = idx + m[0].length;
      }
      if (last < segment.length) out += decorateFlagsAndLogos(segment.slice(last), seen, pillCompanies, runOpts);
      return out;
    }

    const personRe = getPersonRe() || DEFAULT_PERSON_NAME_RE;
    personRe.lastIndex = 0;
    let out = "";
    let last = 0;
    for (const m of segment.matchAll(personRe)) {
      const idx = m.index ?? 0;
      const explicit = entityMap?.get(m[0]);
      if (explicit && explicit.type !== "person") continue;
      if (idx > last) out += decorateFlagsAndLogos(segment.slice(last, idx), seen, pillCompanies, runOpts);
      out += renderPersonSpan(m[0], explicit?.wiki_title || explicit?.canonical_name || "");
      last = idx + m[0].length;
    }
    if (last < segment.length) out += decorateFlagsAndLogos(segment.slice(last), seen, pillCompanies, runOpts);
    return out;
  };

  const escapeWithTickers = (segment, seen = new Set(), opts = {}) => {
    if (!segment) return "";
    const tickerMap = getTickerMap();
    const tickerRe = getInlineTickerRe();
    if (!tickerMap?.size || !tickerRe) {
      return formatEntitiesInPlain(segment, seen, pillCompaniesInSummary, opts);
    }
    const entityMap = opts.entityMap;
    tickerRe.lastIndex = 0;
    let out = "";
    let lastIdx = 0;
    for (const match of segment.matchAll(tickerRe)) {
      const token = match[0];
      const info = tickerMap.get(token);
      if (!info) continue;
      const idx = match.index ?? 0;
      const explicit = entityMap?.get(token);
      if (explicit && explicit.type !== "company") continue;
      if (token === "Dow") {
        const after = segment.slice(idx + token.length, Math.min(segment.length, idx + token.length + 24));
        if (NON_INDEX_DOW_AFTER_RE.test(after)) continue;
      }
      if (idx > lastIdx) out += formatEntitiesInPlain(segment.slice(lastIdx, idx), seen, pillCompaniesInSummary, opts);
      const cls = deltaClass(info.change_pct);
      const tip = formatTickerTip(info);
      const domain = explicit?.domain || COMPANY_LOGOS[token] || COMPANY_LOGOS[info.name];
      let logoHtml = "";
      if (domain) {
        const key = `logo:${domain}`;
        if (!seen.has(key)) {
          seen.add(key);
          logoHtml = renderCompanyLogoImg(domain);
        }
      }
      const domainAttr = domain ? ` data-company-domain="${escapeHtml(domain)}"` : "";
      const wikiAttr = explicit?.wiki_title ? ` data-wiki-title="${escapeHtml(explicit.wiki_title)}"` : "";
      out += `<span class="ticker-tag ${cls}" tabindex="0" data-ticker-sym="${escapeHtml(info.symbol)}" data-ticker-tip="${escapeHtml(tip)}"${domainAttr}${wikiAttr} title="${escapeHtml(tip)}">${logoHtml}${escapeHtml(token)}</span>`;
      lastIdx = idx + token.length;
    }
    if (lastIdx < segment.length) out += formatEntitiesInPlain(segment.slice(lastIdx), seen, pillCompaniesInSummary, opts);
    return out;
  };

  const highlightSummaryHtml = (text, opts = {}) => {
    const raw = String(text ?? "");
    if (!raw) return "";

    const seen = new Set();
    const runOpts = {
      _prepared: true,
      _fullText: raw.replace(/\*\*/g, ""),
      ...resolveEntityContext(opts),
    };
    EXPLICIT_BOLD_RE.lastIndex = 0;
    const hasExplicit = EXPLICIT_BOLD_RE.test(raw);
    const re = hasExplicit ? EXPLICIT_BOLD_RE : FALLBACK_HIGHLIGHT_RE;
    re.lastIndex = 0;

    let out = "";
    let lastIdx = 0;
    for (const match of raw.matchAll(re)) {
      const idx = match.index ?? 0;
      if (idx > lastIdx) out += escapeWithTickers(raw.slice(lastIdx, idx), seen, runOpts);
      const inner = hasExplicit ? match[1] : match[0];
      out += `<strong>${escapeWithTickers(inner, seen, runOpts)}</strong>`;
      lastIdx = idx + match[0].length;
    }
    if (lastIdx < raw.length) out += escapeWithTickers(raw.slice(lastIdx), seen, runOpts);
    return out;
  };

  return { decorateFlagsAndLogos, formatEntitiesInPlain, highlightSummaryHtml };
}

export function buildEntityWikiUrl(el, getCompanyFacts = () => null) {
  if (!el) return "";
  const explicitTitle = el.dataset.wikiTitle;
  if (explicitTitle) {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(explicitTitle.replace(/ /g, "_"))}`;
  }
  const domain = el.dataset.companyDomain;
  if (domain) {
    if (COMPANY_WIKI_OVERRIDES[domain]) {
      return `https://en.wikipedia.org/wiki/${COMPANY_WIKI_OVERRIDES[domain]}`;
    }
    const fact = getCompanyFacts()?.companies?.[domain];
    const clean = (fact?.name || el.textContent || "").replace(/\s*\([^)]*\)\s*/g, "").trim();
    return clean ? `https://en.wikipedia.org/wiki/${encodeURIComponent(clean.replace(/ /g, "_"))}` : "";
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

    if (domain && !fact) {
      activeEl = el;
      ensureShardForDomain(domain).then((loadedFact) => {
        if (loadedFact && activeEl === el && el.isConnected) {
          show(el, includeWikiLink);
        }
      });
    }

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

const ENTITIES_DIR_URL = new URL("./data/entities/", import.meta.url).href;
const ENTITIES_MANIFEST_URL = new URL("./data/entities/manifest.json", import.meta.url).href;

function getEntityShardUrl(shardId) {
  return new URL(`${encodeURIComponent(shardId)}.json`, ENTITIES_DIR_URL).href;
}

async function loadEntityManifest({ cache = "no-store" } = {}) {
  if (manifestCache) return manifestCache;
  if (manifestPromise) return manifestPromise;
  manifestPromise = fetchJson(ENTITIES_MANIFEST_URL, { cache })
    .then((json) => {
      if (json && typeof json === "object") {
        manifestCache = json;
        return json;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      manifestPromise = null;
    });
  return manifestPromise;
}

/**
 * Ensure all requested entity shards are loaded and merged into the live store.
 * Deduplicates already-loaded shards and concurrent in-flight fetches, and fails
 * gracefully without poisoning `loadedShards`.
 */
export async function ensureEntityShards(shardIds = [], { cache = "no-store" } = {}) {
  const list = Array.isArray(shardIds) ? shardIds : [shardIds];
  const uniqueIds = [
    ...new Set(list.map((s) => String(s || "").trim()).filter(Boolean)),
  ];

  const tasks = [];
  for (const shardId of uniqueIds) {
    if (loadedShards.has(shardId)) continue;
    let promise = inFlightShards.get(shardId);
    if (!promise) {
      promise = fetchJson(getEntityShardUrl(shardId), { cache })
        .then((json) => {
          if (json && typeof json === "object") {
            mergeEntityRegistry(json);
            loadedShards.add(shardId);
            return true;
          }
          return false;
        })
        .catch(() => false)
        .finally(() => {
          inFlightShards.delete(shardId);
        });
      inFlightShards.set(shardId, promise);
    }
    tasks.push(promise);
  }

  if (tasks.length) {
    await Promise.all(tasks);
  }
  return MERGED_ENTITY_STORE;
}

/**
 * Lazily resolve a cold-shard company domain via `manifest.json` (fetched at most once)
 * and load its containing shard on demand.
 */
export async function ensureShardForDomain(domain, { cache = "no-store" } = {}) {
  const key = String(domain || "").trim().toLowerCase();
  if (!key) return null;
  if (MERGED_ENTITY_STORE.companies[key]) {
    return MERGED_ENTITY_STORE.companies[key];
  }
  const manifest = await loadEntityManifest({ cache });
  const shardId = manifest?.domain_shard?.[key];
  if (!shardId) return null;
  await ensureEntityShards([shardId], { cache });
  return MERGED_ENTITY_STORE.companies[key] || null;
}

/**
 * Zero-waterfall bootstrap loader: fetches `entities/hot.json` and `country_leaders.json`
 * directly in parallel (never `manifest.json`).
 */
export async function loadSharedEntityData(briefingDataBase, { cache = "no-store" } = {}) {
  const [, leadersRes] = await Promise.allSettled([
    ensureEntityShards(["hot"], { cache }),
    fetchJson(`${briefingDataBase}/country_leaders.json`, { cache }),
  ]);
  return {
    companyFacts: MERGED_ENTITY_STORE,
    countryLeaders: leadersRes.status === "fulfilled" ? leadersRes.value : null,
  };
}

export function createCachedPersonFormatter(getCompanyFacts) {
  let cachedFactsRef = undefined;
  let cachedVersion = -1;
  let basePersonRe = DEFAULT_PERSON_NAME_RE;

  function getBaseRegex() {
    const facts = typeof getCompanyFacts === "function" ? getCompanyFacts() : null;
    const version = getEntityRegistryVersion();
    if (facts !== cachedFactsRef || version !== cachedVersion) {
      cachedFactsRef = facts;
      cachedVersion = version;
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
