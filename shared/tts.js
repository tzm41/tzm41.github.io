/**
 * Reader-Friendly Text Normalization & Device-Native Web Speech TTS Engine
 * Zero-build ES module, Node-testable (all browser globals guarded).
 * Uses deterministic chunk-level hold/continue via cancel() + saved { queueIndex, chunkIndex }.
 */

import { escapeHtml, readJsonStorage, writeJsonStorage } from "./utils.js";

export const TTS_RATES = Object.freeze([0.9, 1.0, 1.25, 1.5]);

const RATE_STORAGE_KEY = "briefing-tts-rate";

const SPEAKER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
const PAUSE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>`;
const NEXT_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><rect x="17" y="4" width="2.5" height="16" rx="1"/></svg>`;
const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/* ---------- Language Detection & Text Normalization ---------- */

const CJK_RE = /[\u4e00-\u9fff]/g;

export function detectTextLang(text, explicitLang = "") {
  const exp = String(explicitLang || "").trim().toLowerCase();
  if (exp.startsWith("zh")) return "zh-CN";
  if (exp && exp !== "native") return "en-US";
  const matches = String(text ?? "").match(CJK_RE);
  return matches && matches.length >= 4 ? "zh-CN" : "en-US";
}

function decodeCommonEntities(str) {
  return str
    .replace(/&amp;/gi, "&")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&middot;/gi, "·")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/&hellip;/gi, "...");
}

function stripMarkupAndLinks(raw) {
  let s = String(raw ?? "");
  s = s.replace(/<[^>]*>/g, " ");
  s = decodeCommonEntities(s);
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/\bhttps?:\/\/[^\s)>,]+/gi, "");
  s = s.replace(/\*\*([\s\S]*?)\*\*/g, "$1");
  s = s.replace(/__([\s\S]*?)__/g, "$1");
  s = s.replace(/\*([^*\n]+)\*/g, "$1");
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1$2");
  s = s.replace(/`/g, "");
  s = s.replace(/[↗→←↑↓↔↘↙↖]/g, " ");
  return s;
}

const CURRENCY_UNIT_MAP = {
  T: "trillion",
  B: "billion",
  M: "million",
  K: "thousand",
};

export function normalizeForSpeech(rawText, lang = "en-US") {
  let s = stripMarkupAndLinks(rawText);
  const isZh = String(lang || "en-US").toLowerCase().startsWith("zh");

  if (isZh) {
    s = s.replace(/\s*[·•]\s*/g, "，");
    s = s.replace(/[（(]\s*\+(\d+(?:\.\d+)?)%\s*[)）]/g, "，上涨$1%，");
    s = s.replace(/[（(]\s*[-−–](\d+(?:\.\d+)?)%\s*[)）]/g, "，下跌$1%，");
    s = s.replace(/(^|[\s，,、；;：:（(])\+(\d+(?:\.\d+)?)%/g, "$1上涨$2%");
    s = s.replace(/(^|[\s，,、；;：:（(])[-−](\d+(?:\.\d+)?)%/g, "$1下跌$2%");
    s = s.replace(/\s*[—–]\s*|\s+--\s+/g, "，");
    s = s.replace(/，\s*([。！？，；：])/g, "$1");
    s = s.replace(/，{2,}/g, "，");
    s = s.replace(/^[\s，,]+/, "");
    s = s.replace(/，\s*$/, "");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  // English normalization
  s = s.replace(/\s*[·•]\s*/g, ", ");
  s = s.replace(/(?<![A-Za-z])U\.S\.(?![A-Za-z])/g, "US");
  s = s.replace(/(?<![A-Za-z])U\.K\.(?![A-Za-z])/g, "UK");
  s = s.replace(/(?<![A-Za-z])E\.U\.(?![A-Za-z])/g, "EU");
  s = s.replace(/(?<![A-Za-z])U\.N\.(?![A-Za-z])/g, "UN");
  s = s.replace(/\bS&P\b/g, "S and P");
  s = s.replace(/\s+&\s+/g, " and ");

  // Parenthetical percentage moves, including optional detail e.g. (+3.73% to $3,667.80)
  s = s.replace(/\(\s*\+(\d+(?:\.\d+)?)%([^)]*)\)/g, (_, num, tail) => {
    const extra = tail.trim() ? ` ${tail.trim()}` : "";
    return `, up ${num} percent${extra},`;
  });
  s = s.replace(/\(\s*[-−–](\d+(?:\.\d+)?)%([^)]*)\)/g, (_, num, tail) => {
    const extra = tail.trim() ? ` ${tail.trim()}` : "";
    return `, down ${num} percent${extra},`;
  });

  // Standalone signed & unsigned percentages
  s = s.replace(/(^|[\s(,:;])\+(\d+(?:\.\d+)?)%/g, "$1up $2 percent");
  s = s.replace(/(^|[\s(,:;])[-−](\d+(?:\.\d+)?)%/g, "$1down $2 percent");
  s = s.replace(/(\d+(?:\.\d+)?)%/g, "$1 percent");

  // Currency compact suffixes ($3.2T / $3.2B / $450M / $250K)
  s = s.replace(/\$(\d+(?:,\d{3})*(?:\.\d+)?)([TBMK])\b/g, (_, num, suffix) => {
    return `$${num} ${CURRENCY_UNIT_MAP[suffix] || suffix}`;
  });

  // Timeframes and points
  s = s.replace(/\b(1|5|7|14|30)D\b/g, "$1-day");
  s = s.replace(/\b24h\b/gi, "24-hour");
  s = s.replace(/(\d+(?:\.\d+)?)\s*pts\b/gi, "$1 points");

  // Em/en dashes -> pause comma
  s = s.replace(/\s*[—–]\s*|\s+--\s+/g, ", ");

  // Clean up spacing & punctuation artifacts
  s = s.replace(/\s+,/g, ",");
  s = s.replace(/,\s*([.,;:!?])/g, "$1");
  s = s.replace(/,\s*,+/g, ", ");
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/^\s*,\s*/, "");
  s = s.replace(/,\s*$/, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function cleanPlainTitle(raw) {
  return stripMarkupAndLinks(raw).replace(/\s+/g, " ").trim();
}

function ensureSentenceEnd(str, isZh) {
  const t = String(str || "").trim();
  if (!t) return "";
  if (/[.!?。！？…]["'”’»)\]]*$/.test(t)) return t;
  return `${t}${isZh ? "。" : "."}`;
}

export function buildReaderText(item, { kind = "auto", lang = "", bulletStyle = "regular" } = {}) {
  if (typeof item === "string") {
    const resolvedLang = detectTextLang(item, lang);
    const text = normalizeForSpeech(item, resolvedLang);
    return { text, lang: resolvedLang, title: cleanPlainTitle(item).slice(0, 72) };
  }
  if (!item || typeof item !== "object") {
    return { text: "", lang: detectTextLang("", lang), title: "" };
  }

  let effectiveKind = kind;
  if (effectiveKind === "auto") {
    if (item.fact !== undefined) effectiveKind = "geo";
    else if (item.headline !== undefined && item.why_it_matters !== undefined) effectiveKind = "story";
    else if (item.headline !== undefined && (item.takeaway !== undefined || item.reading_time !== undefined)) {
      effectiveKind = "weekly";
    } else if (item.headline !== undefined) effectiveKind = "story";
    else if (item.text !== undefined || Array.isArray(item.points)) effectiveKind = "bullet";
    else if (item.narrative !== undefined) effectiveKind = "narrative";
    else effectiveKind = "text";
  }

  const sample = [
    item.reader_text,
    item.headline,
    item.title,
    item.summary,
    item.fact,
    item.text,
    Array.isArray(item.points) ? item.points.join(" ") : "",
    item.narrative,
  ]
    .filter(Boolean)
    .join(" ");
  const resolvedLang = detectTextLang(sample, lang);
  const isZh = resolvedLang.startsWith("zh");

  let rawTitle = "";
  if (effectiveKind === "geo" || effectiveKind === "around_the_world") {
    rawTitle =
      item.place && item.title
        ? `${item.place} — ${item.title}`
        : item.title || item.place || "";
  } else if (effectiveKind === "bullet") {
    const lead =
      bulletStyle === "bullets" && Array.isArray(item.points) && item.points.length
        ? item.points[0]
        : item.text || "";
    rawTitle = item.title || lead;
  } else if (effectiveKind === "narrative") {
    rawTitle = item.title || item.narrative || "";
  } else {
    rawTitle = item.headline || item.title || item.text || "";
  }
  const title = cleanPlainTitle(rawTitle);

  // Use explicit author/LLM reader_text when provided
  if (typeof item.reader_text === "string" && item.reader_text.trim()) {
    const text = normalizeForSpeech(item.reader_text, resolvedLang);
    return { text, lang: resolvedLang, title: title || text.slice(0, 72) };
  }

  let parts = [];
  if (effectiveKind === "bullet") {
    if (bulletStyle === "bullets" && Array.isArray(item.points) && item.points.length) {
      parts = item.points;
    } else {
      parts = [item.text || (Array.isArray(item.points) ? item.points.join(". ") : "")];
    }
  } else if (effectiveKind === "geo" || effectiveKind === "around_the_world") {
    const loc = [item.place, item.region].filter(Boolean).join(", ");
    parts = [loc, item.title, item.fact];
  } else if (
    effectiveKind === "weekly" ||
    effectiveKind === "learning" ||
    effectiveKind === "long_read" ||
    effectiveKind === "long_reads"
  ) {
    parts = [item.headline, item.summary, item.takeaway];
  } else if (effectiveKind === "narrative") {
    parts = [item.narrative || item.text];
  } else {
    parts = [item.headline, item.summary, item.why_it_matters];
  }

  const normalizedParts = parts
    .map((p) => ensureSentenceEnd(normalizeForSpeech(p, resolvedLang), isZh))
    .filter(Boolean);

  const text = normalizedParts.join(isZh ? "" : " ").trim();
  return {
    text,
    lang: resolvedLang,
    title: title || text.slice(0, 72),
  };
}

/* ---------- Abbreviation-Safe Sentence Chunking ---------- */

const ABBREVIATIONS = new Set([
  "mr",
  "mrs",
  "ms",
  "dr",
  "sen",
  "rep",
  "gov",
  "pres",
  "prof",
  "st",
  "jr",
  "sr",
  "vs",
  "inc",
  "corp",
  "ltd",
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "co",
  "no",
  "gen",
  "col",
  "lt",
  "sgt",
  "rev",
  "dept",
  "est",
  "fig",
  "vol",
  "etc",
  "a.m",
  "p.m",
  "e.g",
  "i.e",
  "u.s",
  "u.k",
  "e.u",
  "u.n",
]);

const CLOSING_PUNCT = new Set(['"', "'", "”", "’", ")", "]", "）", "】", "」", "』"]);

function isAbbreviationBeforeDot(str, dotIdx) {
  let j = dotIdx - 1;
  while (j >= 0 && /[A-Za-z.]/.test(str[j])) {
    j -= 1;
  }
  const token = str.slice(j + 1, dotIdx).replace(/^\.+/, "");
  if (!token) return false;
  const lower = token.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return true;
  if (/^[a-z]$/.test(lower)) return true;
  if (/^(?:[a-z]\.)+[a-z]$/.test(lower)) return true;
  return false;
}

function splitIntoSentences(text) {
  const s = String(text || "").trim();
  if (!s) return [];
  const out = [];
  let start = 0;
  let i = 0;

  while (i < s.length) {
    const ch = s[i];
    if (ch === "。" || ch === "！" || ch === "？") {
      let end = i + 1;
      while (end < s.length && (s[end] === "。" || s[end] === "！" || s[end] === "？" || CLOSING_PUNCT.has(s[end]))) {
        end += 1;
      }
      const piece = s.slice(start, end).trim();
      if (piece) out.push(piece);
      i = end;
      while (i < s.length && /\s/.test(s[i])) i += 1;
      start = i;
      continue;
    }

    if (ch === "." || ch === "!" || ch === "?") {
      if (ch === ".") {
        const prev = i > 0 ? s[i - 1] : "";
        const next = i + 1 < s.length ? s[i + 1] : "";
        // Decimal number e.g. 3.73
        if (/\d/.test(prev) && /\d/.test(next)) {
          i += 1;
          continue;
        }
        // Part of ellipsis ...
        if (next === ".") {
          i += 1;
          continue;
        }
      }

      let end = i + 1;
      while (end < s.length && (s[end] === "!" || s[end] === "?" || CLOSING_PUNCT.has(s[end]))) {
        end += 1;
      }

      const atEnd = end >= s.length;
      const followedBySpace = !atEnd && /\s/.test(s[end]);
      const followedByCjk = !atEnd && /[\u4e00-\u9fff]/.test(s[end]);

      if (atEnd || followedBySpace || followedByCjk) {
        if (ch === "." && !atEnd && isAbbreviationBeforeDot(s, i)) {
          i += 1;
          continue;
        }
        const piece = s.slice(start, end).trim();
        if (piece) out.push(piece);
        i = end;
        while (i < s.length && /\s/.test(s[i])) i += 1;
        start = i;
        continue;
      }
    }

    i += 1;
  }

  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function hardSplitPiece(text, maxLen, isZh) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed ? [trimmed] : [];

  const result = [];
  if (!isZh && /\s/.test(trimmed)) {
    const words = trimmed.split(/\s+/);
    let cur = "";
    for (const w of words) {
      if (w.length > maxLen) {
        if (cur) {
          result.push(cur);
          cur = "";
        }
        for (let i = 0; i < w.length; i += maxLen) {
          result.push(w.slice(i, i + maxLen));
        }
        continue;
      }
      const cand = cur ? `${cur} ${w}` : w;
      if (cand.length <= maxLen) {
        cur = cand;
      } else {
        if (cur) result.push(cur);
        cur = w;
      }
    }
    if (cur) result.push(cur);
    return result;
  }

  for (let i = 0; i < trimmed.length; i += maxLen) {
    const slice = trimmed.slice(i, i + maxLen).trim();
    if (slice) result.push(slice);
  }
  return result;
}

function splitOverlongSentence(sentence, maxLen, isZh) {
  if (sentence.length <= maxLen) return [sentence];

  // Split on clause boundaries while retaining punctuation on left fragment
  const clauses = [];
  const clauseRe = /[^,;:，；：]+[,;:，；：]+|[^,;:，；：]+$/g;
  let m;
  while ((m = clauseRe.exec(sentence)) !== null) {
    const part = m[0].trim();
    if (part) clauses.push(part);
  }

  if (clauses.length <= 1) {
    return hardSplitPiece(sentence, maxLen, isZh);
  }

  const sep = isZh ? "" : " ";
  const packed = [];
  let cur = "";
  for (const cl of clauses) {
    if (cl.length > maxLen) {
      if (cur) {
        packed.push(cur);
        cur = "";
      }
      packed.push(...hardSplitPiece(cl, maxLen, isZh));
      continue;
    }
    const cand = cur ? `${cur}${sep}${cl}` : cl;
    if (cand.length <= maxLen) {
      cur = cand;
    } else {
      if (cur) packed.push(cur);
      cur = cl;
    }
  }
  if (cur) packed.push(cur);
  return packed;
}

export function chunkTextForSpeech(text, { minLen, maxLen, lang = "en-US" } = {}) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const isZh = String(lang || "en-US").toLowerCase().startsWith("zh");
  const effectiveMin = Number.isFinite(minLen) && minLen > 0 ? minLen : isZh ? 60 : 140;
  const effectiveMax = Number.isFinite(maxLen) && maxLen > 0 ? Math.max(maxLen, effectiveMin) : isZh ? 110 : 220;

  const sentences = splitIntoSentences(clean);
  const units = [];
  for (const sent of sentences) {
    if (sent.length <= effectiveMax) {
      units.push(sent);
    } else {
      units.push(...splitOverlongSentence(sent, effectiveMax, isZh));
    }
  }

  const sep = isZh ? "" : " ";
  const chunks = [];
  let cur = "";
  for (const unit of units) {
    if (!cur) {
      cur = unit;
      continue;
    }
    const cand = `${cur}${sep}${unit}`;
    if (cand.length <= effectiveMax) {
      cur = cand;
    } else {
      chunks.push(cur);
      cur = unit;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/* ---------- Voice Ranking ---------- */

const NOVELTY_VOICE_RE =
  /\b(?:zarvox|whisper|bells|bubbles|boing|albert|bad news|bahh|cellos|eddy|flo|good news|grandma|grandpa|jester|junior|kathy|organ|ralph|reed|rocko|sandy|shelley|superstar|trinoids|wobble|espeak|fred)\b/i;

const CANTONESE_VOICE_RE = /cantonese|sin-?ji|zh[-_]hk/i;

function scoreVoice(voice, targetLocale, isMobile) {
  const name = String(voice?.name || "");
  const nameLower = name.toLowerCase();
  const vLang = String(voice?.lang || "").toLowerCase().replace(/_/g, "-");
  let score = 0;

  if (NOVELTY_VOICE_RE.test(name)) score -= 120;
  if (/\bcompact\b/i.test(name)) score -= 12;

  if (/\bpremium\b/i.test(name)) score += 60;
  if (/\bsiri\b/i.test(name)) score += 55;
  if (/\b(?:natural|neural)\b/i.test(name)) score += 50;
  if (/\benhanced\b/i.test(name)) score += 45;
  if (/\bgoogle\b/i.test(name)) score += 32;

  if (/ting-?ting/i.test(name)) score += 40;
  if (/mei-?jia/i.test(name)) score += 35;
  if (/xiaoxiao|yunxi|yunjian/i.test(name)) score += 36;
  if (/\b(?:ava|zoe)\b/i.test(name)) score += 34;
  if (/\b(?:samantha|alex)\b/i.test(name)) score += 30;
  if (/\bdaniel\b/i.test(name)) score += 28;
  if (/\b(?:serena|allison|aria|jenny|karen|moira)\b/i.test(name)) score += 24;

  if (vLang === targetLocale) score += 25;
  if (isMobile && voice?.localService === true) score += 20;
  if (voice?.default === true) score += 5;
  if (nameLower.includes("online")) score += isMobile ? -8 : 8;

  return score;
}

export function rankVoices(voices, lang = "en-US", { isMobile = false } = {}) {
  const list = Array.isArray(voices) ? [...voices] : Array.from(voices || []);
  if (!list.length) return [];

  const target = String(lang || "en-US").toLowerCase().replace(/_/g, "-");
  const baseLang = target.split("-")[0];

  let matching = list.filter((v) => {
    const vl = String(v?.lang || "").toLowerCase().replace(/_/g, "-");
    return vl === baseLang || vl.startsWith(`${baseLang}-`);
  });

  if (!matching.length) return [];

  if (target === "zh-cn" || target === "zh-hans" || target === "zh-sg") {
    const mandarin = matching.filter((v) => {
      const vl = String(v?.lang || "").toLowerCase().replace(/_/g, "-");
      return vl !== "zh-hk" && !CANTONESE_VOICE_RE.test(String(v?.name || ""));
    });
    if (mandarin.length) matching = mandarin;
  }

  return matching
    .map((voice, idx) => ({ voice, idx, score: scoreVoice(voice, target, isMobile) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map((entry) => entry.voice);
}

/* ---------- Core TTS Playback Engine ---------- */

function detectMobileEnv() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent || "");
}

function loadSavedRate(storage) {
  const saved = readJsonStorage(RATE_STORAGE_KEY, storage);
  const num = Number(saved);
  if (TTS_RATES.includes(num)) return num;
  return 1.0;
}

export function createTtsEngine({ synth, UtteranceCtor, storage, isMobile } = {}) {
  const getSynth = () =>
    synth !== undefined
      ? synth
      : typeof window !== "undefined"
      ? window.speechSynthesis || null
      : null;

  const getUtteranceCtor = () =>
    UtteranceCtor !== undefined
      ? UtteranceCtor
      : typeof window !== "undefined"
      ? window.SpeechSynthesisUtterance || null
      : null;

  const storageObj =
    storage !== undefined
      ? storage
      : typeof window !== "undefined" && typeof window.localStorage !== "undefined"
      ? window.localStorage
      : null;

  const mobileFlag = typeof isMobile === "boolean" ? isMobile : detectMobileEnv();

  let status = "idle"; // "idle" | "playing" | "paused"
  let queue = [];
  let queueIndex = -1;
  let chunkIndex = 0;
  let sectionId = null;
  let rate = loadSavedRate(storageObj);
  let sessionId = 0;
  let currentUtterance = null;
  const listeners = new Set();

  const getState = () => {
    const item = queueIndex >= 0 && queueIndex < queue.length ? queue[queueIndex] : null;
    return {
      status,
      rate,
      sectionId,
      queueIndex,
      queueLength: queue.length,
      chunkIndex,
      chunkCount: item ? item.chunks.length : 0,
      currentId: item ? item.id : null,
      currentItem: item
        ? { id: item.id, title: item.title, lang: item.lang, sectionId: item.sectionId }
        : null,
    };
  };

  const emit = () => {
    const snap = getState();
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch {
        // Isolate subscriber errors
      }
    }
  };

  const resetToIdle = () => {
    currentUtterance = null;
    status = "idle";
    queue = [];
    queueIndex = -1;
    chunkIndex = 0;
    sectionId = null;
    emit();
  };

  const prepareItem = (rawItem, defaultSectionId) => {
    if (!rawItem) return null;
    let text = "";
    let lang = "";
    let title = "";

    if (
      typeof rawItem === "object" &&
      typeof rawItem.text === "string" &&
      rawItem.headline === undefined &&
      rawItem.summary === undefined &&
      rawItem.fact === undefined
    ) {
      lang = detectTextLang(rawItem.text, rawItem.lang || "");
      text = rawItem.text.trim();
      title = rawItem.title || text.slice(0, 72);
    } else {
      const built = buildReaderText(rawItem, { lang: rawItem?.lang || "" });
      text = built.text;
      lang = built.lang;
      title = rawItem?.title || built.title;
    }

    const chunks = chunkTextForSpeech(text, { lang });
    if (!chunks.length) return null;
    return {
      id: String(rawItem?.id ?? ""),
      title: String(title || "").trim() || chunks[0].slice(0, 72),
      text,
      lang,
      chunks,
      sectionId: rawItem?.sectionId ?? defaultSectionId ?? null,
    };
  };

  const speakCurrentChunk = (expectedSession) => {
    const item = queue[queueIndex];
    const chunkText = item?.chunks?.[chunkIndex];
    if (!item || !chunkText) {
      resetToIdle();
      return false;
    }

    const s = getSynth();
    const Utter = getUtteranceCtor();
    if (!s || typeof s.speak !== "function" || !Utter) {
      resetToIdle();
      return false;
    }

    const utt = new Utter(chunkText);
    utt.lang = item.lang || "en-US";
    utt.rate = rate;

    let voices = [];
    try {
      voices = s.getVoices?.() || [];
    } catch {
      voices = [];
    }
    const ranked = rankVoices(voices, utt.lang, { isMobile: mobileFlag });
    if (ranked.length) {
      utt.voice = ranked[0];
    }

    currentUtterance = utt;

    utt.onend = () => {
      if (sessionId !== expectedSession || status !== "playing") return;
      const curItem = queue[queueIndex];
      if (!curItem) {
        resetToIdle();
        return;
      }
      if (chunkIndex + 1 < curItem.chunks.length) {
        chunkIndex += 1;
        emit();
        speakCurrentChunk(expectedSession);
      } else if (queueIndex + 1 < queue.length) {
        queueIndex += 1;
        chunkIndex = 0;
        emit();
        speakCurrentChunk(expectedSession);
      } else {
        resetToIdle();
      }
    };

    utt.onerror = (ev) => {
      if (sessionId !== expectedSession) return;
      const code = String(ev?.error || "").toLowerCase();
      if (code === "interrupted" || code === "canceled") return;
      resetToIdle();
    };

    s.speak(utt);
    return true;
  };

  const cancelIfActive = (s) => {
    try {
      if (s && (s.speaking || s.pending)) {
        s.cancel?.();
      }
    } catch {
      // Ignore cancel errors
    }
  };

  const stop = () => {
    sessionId += 1;
    currentUtterance = null;
    try {
      getSynth()?.cancel?.();
    } catch {
      // Ignore cancel errors
    }
    status = "idle";
    queue = [];
    queueIndex = -1;
    chunkIndex = 0;
    sectionId = null;
    emit();
  };

  const playQueue = (items, { sectionId: nextSectionId = null, startIndex = 0 } = {}) => {
    const prepared = (Array.isArray(items) ? items : [items])
      .map((it) => prepareItem(it, nextSectionId))
      .filter(Boolean);

    if (!prepared.length) {
      stop();
      return false;
    }

    sessionId += 1;
    const expected = sessionId;
    currentUtterance = null;
    cancelIfActive(getSynth());

    queue = prepared;
    sectionId = nextSectionId;
    queueIndex = Math.max(0, Math.min(prepared.length - 1, Number(startIndex) || 0));
    chunkIndex = 0;
    status = "playing";
    emit();
    return speakCurrentChunk(expected);
  };

  const pause = () => {
    if (status !== "playing") return false;
    sessionId += 1;
    currentUtterance = null;
    status = "paused";
    try {
      getSynth()?.cancel?.();
    } catch {
      // Ignore cancel errors
    }
    emit();
    return true;
  };

  const resume = () => {
    if (status !== "paused") return false;
    if (queueIndex < 0 || queueIndex >= queue.length) {
      resetToIdle();
      return false;
    }
    sessionId += 1;
    const expected = sessionId;
    currentUtterance = null;
    cancelIfActive(getSynth());
    status = "playing";
    emit();
    return speakCurrentChunk(expected);
  };

  const togglePlayPause = () => {
    if (status === "playing") return pause();
    if (status === "paused") return resume();
    return false;
  };

  const toggleItem = (item) => {
    if (!item) return false;
    const targetId = String(item.id ?? "");
    const curId = queueIndex >= 0 && queueIndex < queue.length ? queue[queueIndex]?.id : null;
    if (targetId && curId === targetId) {
      if (status === "playing") return pause();
      if (status === "paused") return resume();
    }
    return playQueue([item], { sectionId: null, startIndex: 0 });
  };

  const toggleSection = (targetSectionId, items) => {
    if (targetSectionId && sectionId === targetSectionId) {
      if (status === "playing") return pause();
      if (status === "paused") return resume();
    }
    return playQueue(items, { sectionId: targetSectionId, startIndex: 0 });
  };

  const next = () => {
    if (status === "idle" || !queue.length) return false;
    if (queueIndex + 1 >= queue.length) {
      stop();
      return false;
    }
    sessionId += 1;
    const expected = sessionId;
    currentUtterance = null;
    try {
      getSynth()?.cancel?.();
    } catch {
      // Ignore cancel errors
    }
    queueIndex += 1;
    chunkIndex = 0;
    emit();
    if (status === "playing") {
      return speakCurrentChunk(expected);
    }
    return true;
  };

  const cycleRate = () => {
    const idx = TTS_RATES.indexOf(rate);
    const nextIdx = idx >= 0 ? (idx + 1) % TTS_RATES.length : 1;
    rate = TTS_RATES[nextIdx];
    writeJsonStorage(RATE_STORAGE_KEY, rate, storageObj);

    if (status === "playing") {
      sessionId += 1;
      const expected = sessionId;
      currentUtterance = null;
      try {
        getSynth()?.cancel?.();
      } catch {
        // Ignore cancel errors
      }
      emit();
      speakCurrentChunk(expected);
    } else {
      emit();
    }
    return rate;
  };

  const subscribe = (fn) => {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };

  return {
    playQueue,
    pause,
    resume,
    togglePlayPause,
    toggleItem,
    toggleSection,
    next,
    cycleRate,
    stop,
    subscribe,
    getState,
  };
}

export const tts = createTtsEngine();

/* ---------- Registry & DOM Helpers ---------- */

export function createTtsRegistry() {
  const itemsById = new Map();
  const sectionIds = new Map();

  return {
    clear() {
      itemsById.clear();
      sectionIds.clear();
    },
    clearSection(secId) {
      const ids = sectionIds.get(secId);
      if (ids) {
        for (const id of ids) itemsById.delete(id);
        sectionIds.delete(secId);
      }
    },
    register(secId, id, payload) {
      if (!id || !payload) return null;
      const key = String(id);
      const entry = {
        id: key,
        title: String(payload.title || "").trim(),
        text: String(payload.text || "").trim(),
        lang: payload.lang || "en-US",
        sectionId: secId || null,
      };
      if (!entry.text) return null;
      itemsById.set(key, entry);
      if (secId) {
        let list = sectionIds.get(secId);
        if (!list) {
          list = [];
          sectionIds.set(secId, list);
        }
        if (!list.includes(key)) list.push(key);
      }
      return entry;
    },
    get(id) {
      return itemsById.get(String(id || "")) || null;
    },
    getSectionQueue(secId) {
      const ids = sectionIds.get(secId) || [];
      return ids.map((id) => itemsById.get(id)).filter(Boolean);
    },
  };
}

export function renderTtsCardButton(id, { title = "", variant = "card" } = {}) {
  if (!id) return "";
  const safeId = escapeHtml(id);
  const cleanTitle = cleanPlainTitle(title) || "story";
  const safeTitle = escapeHtml(cleanTitle);

  if (variant === "inline") {
    return `<button type="button" class="tts-btn tts-inline-btn" data-tts-id="${safeId}" data-tts-title="${safeTitle}" aria-label="Listen to ${safeTitle}" aria-pressed="false" title="Listen"><span class="tts-icon" aria-hidden="true">${SPEAKER_SVG}</span></button>`;
  }

  return `<button type="button" class="tts-btn tts-card-btn" data-tts-id="${safeId}" data-tts-title="${safeTitle}" aria-label="Listen to ${safeTitle}" aria-pressed="false" title="Listen"><span class="tts-icon" aria-hidden="true">${SPEAKER_SVG}</span><span class="tts-btn-label">Listen</span></button>`;
}

export function bindTtsTriggers(root, { resolveItem, resolveSection, onBeforePlaySection } = {}) {
  if (!root || typeof root.addEventListener !== "function") return () => {};

  const handler = (e) => {
    const btn = e.target?.closest?.(".tts-btn[data-tts-id], .tts-btn[data-tts-section]");
    if (!btn || !root.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();

    const secId = btn.dataset.ttsSection;
    if (secId) {
      if (typeof onBeforePlaySection === "function") {
        onBeforePlaySection(secId, btn);
      }
      const items = typeof resolveSection === "function" ? resolveSection(secId, btn) : [];
      if (Array.isArray(items) && items.length) {
        tts.toggleSection(secId, items);
      } else if (tts.getState().sectionId === secId) {
        tts.stop();
      }
      return;
    }

    const id = btn.dataset.ttsId;
    if (id) {
      const item = typeof resolveItem === "function" ? resolveItem(id, btn) : null;
      if (item) {
        tts.toggleItem(item);
      }
    }
  };

  root.addEventListener("click", handler);
  return () => root.removeEventListener("click", handler);
}

/* ---------- Floating Mini-Player & UI Synchronization ---------- */

let ttsUiInitialized = false;
let playerEl = null;
let lastHighlightedId = null;

function escapeSelectorVal(val) {
  const s = String(val ?? "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/["\\]/g, "\\$&");
}

function fmtRate(r) {
  return `${Number(r || 1)}x`;
}

function updateTriggerButton(btn, isPlaying, isPaused, defaultLabel) {
  const active = isPlaying || isPaused;
  btn.classList.toggle("is-playing", isPlaying);
  btn.classList.toggle("is-paused", isPaused);
  btn.setAttribute("aria-pressed", String(active));

  const iconEl = btn.querySelector(".tts-icon");
  if (iconEl) {
    iconEl.innerHTML = isPlaying ? PAUSE_SVG : isPaused ? PLAY_SVG : SPEAKER_SVG;
  }

  const labelEl = btn.querySelector(".tts-btn-label");
  if (labelEl) {
    labelEl.textContent = isPlaying ? "Pause" : isPaused ? "Resume" : defaultLabel;
  }

  const titleHint = btn.dataset.ttsTitle || btn.dataset.ttsSection || "item";
  btn.setAttribute(
    "aria-label",
    isPlaying ? `Pause ${titleHint}` : isPaused ? `Resume ${titleHint}` : `Listen to ${titleHint}`
  );
}

function syncTtsDom(snap = tts.getState()) {
  if (typeof document === "undefined") return;
  const active = snap.status !== "idle";
  const isPlaying = snap.status === "playing";
  const isPaused = snap.status === "paused";

  document.body?.classList.toggle("has-tts-player", active);

  if (playerEl) {
    playerEl.classList.toggle("hidden", !active);
    playerEl.classList.toggle("is-playing", isPlaying);
    playerEl.classList.toggle("is-paused", isPaused);

    const titleEl = playerEl.querySelector(".tts-player-title");
    if (titleEl) titleEl.textContent = snap.currentItem?.title || "Reading…";

    const counterEl = playerEl.querySelector(".tts-player-counter");
    if (counterEl) {
      if (snap.queueLength > 1 && snap.queueIndex >= 0) {
        counterEl.textContent = `${snap.queueIndex + 1} / ${snap.queueLength}`;
        counterEl.classList.remove("hidden");
      } else {
        counterEl.textContent = "";
        counterEl.classList.add("hidden");
      }
    }

    const toggleBtn = playerEl.querySelector('[data-tts-action="toggle"]');
    if (toggleBtn) {
      toggleBtn.innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;
      toggleBtn.setAttribute("aria-label", isPlaying ? "Pause reading" : "Resume reading");
      toggleBtn.setAttribute("title", isPlaying ? "Pause" : "Resume");
    }

    const nextBtn = playerEl.querySelector('[data-tts-action="next"]');
    if (nextBtn) {
      const showNext = snap.queueLength > 1;
      nextBtn.classList.toggle("hidden", !showNext);
      nextBtn.disabled = !showNext || snap.queueIndex >= snap.queueLength - 1;
    }

    const rateBtn = playerEl.querySelector('[data-tts-action="rate"]');
    if (rateBtn) {
      rateBtn.textContent = fmtRate(snap.rate);
      rateBtn.setAttribute("aria-label", `Playback speed ${fmtRate(snap.rate)}`);
    }
  }

  // Sync item buttons
  document.querySelectorAll(".tts-btn[data-tts-id]").forEach((btn) => {
    const match = active && snap.currentId === btn.dataset.ttsId;
    updateTriggerButton(btn, match && isPlaying, match && isPaused, "Listen");
  });

  // Sync section buttons
  document.querySelectorAll(".tts-btn[data-tts-section]").forEach((btn) => {
    const match = active && snap.sectionId === btn.dataset.ttsSection;
    updateTriggerButton(btn, match && isPlaying, match && isPaused, "Listen");
  });

  // Sync .is-speaking highlight on cards and brief bullets
  document.querySelectorAll(".is-speaking").forEach((el) => el.classList.remove("is-speaking"));
  if (active && snap.currentId) {
    const esc = escapeSelectorVal(snap.currentId);
    let primaryTarget = null;

    document.querySelectorAll(`li[data-tts-id="${esc}"]`).forEach((li) => {
      li.classList.add("is-speaking");
      if (!primaryTarget) primaryTarget = li;
    });

    document.querySelectorAll(`.tts-btn[data-tts-id="${esc}"]`).forEach((btn) => {
      const host = btn.closest(".news-card, .positive-card, .geo-fact-popover, .geo-mobile-card, li");
      if (host) {
        host.classList.add("is-speaking");
        if (!primaryTarget) primaryTarget = host;
      }
    });

    if (
      primaryTarget &&
      isPlaying &&
      snap.currentId !== lastHighlightedId &&
      typeof window !== "undefined" &&
      typeof primaryTarget.getBoundingClientRect === "function"
    ) {
      const rect = primaryTarget.getBoundingClientRect();
      const outOfView = rect.top < 80 || rect.bottom > window.innerHeight - 96;
      if (outOfView && typeof primaryTarget.scrollIntoView === "function") {
        primaryTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    lastHighlightedId = snap.currentId;
  } else {
    lastHighlightedId = null;
  }
}

export function initTts() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (ttsUiInitialized) {
    syncTtsDom();
    return;
  }
  ttsUiInitialized = true;

  const synth = window.speechSynthesis;
  const hasApi = Boolean(
    synth &&
      typeof synth.speak === "function" &&
      typeof window.SpeechSynthesisUtterance === "function"
  );

  const detectVoices = () => {
    if (!hasApi) return false;
    let voices = [];
    try {
      voices = synth.getVoices?.() || [];
    } catch {
      voices = [];
    }
    if (voices.length > 0) {
      document.documentElement.classList.add("tts-supported");
      return true;
    }
    return false;
  };

  if (hasApi && !detectVoices()) {
    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", detectVoices);
    } else if ("onvoiceschanged" in synth) {
      const prev = synth.onvoiceschanged;
      synth.onvoiceschanged = (...args) => {
        detectVoices();
        if (typeof prev === "function") prev.apply(synth, args);
      };
    }
    window.setTimeout(detectVoices, 500);
    window.setTimeout(detectVoices, 1500);
  }

  window.addEventListener("pagehide", () => tts.stop());
  window.addEventListener("beforeunload", () => tts.stop());

  playerEl = document.createElement("div");
  playerEl.className = "tts-player hidden";
  playerEl.setAttribute("role", "region");
  playerEl.setAttribute("aria-label", "Audio reader controls");
  playerEl.innerHTML = `
    <span class="tts-eq" aria-hidden="true"><span></span><span></span><span></span></span>
    <div class="tts-player-info">
      <span class="tts-player-title"></span>
      <span class="tts-player-counter hidden"></span>
    </div>
    <div class="tts-player-controls">
      <button type="button" class="tts-player-btn" data-tts-action="toggle" aria-label="Pause reading" title="Pause">${PAUSE_SVG}</button>
      <button type="button" class="tts-player-btn hidden" data-tts-action="next" aria-label="Next item" title="Next">${NEXT_SVG}</button>
      <button type="button" class="tts-player-btn tts-rate-btn" data-tts-action="rate" aria-label="Playback speed 1x" title="Change speed">1x</button>
      <button type="button" class="tts-player-btn tts-stop-btn" data-tts-action="stop" aria-label="Stop reading" title="Stop">${CLOSE_SVG}</button>
    </div>
  `;
  document.body.appendChild(playerEl);

  playerEl.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-tts-action]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const action = btn.dataset.ttsAction;
    if (action === "toggle") tts.togglePlayPause();
    else if (action === "next") tts.next();
    else if (action === "rate") tts.cycleRate();
    else if (action === "stop") tts.stop();
  });

  tts.subscribe(syncTtsDom);
  syncTtsDom();
}

export function setTtsEnabled(enabled) {
  const on = Boolean(enabled);
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.classList.toggle("tts-enabled", on);
  }
  if (!on) {
    tts.stop();
  }
}
