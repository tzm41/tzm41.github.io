"""Rolling 3-day news memory & deduplication across morning and afternoon briefings."""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from .config import ARCHIVE_DIR, DATA_DIR, NEWS_MEMORY_DAYS, NEWS_MEMORY_PATH

_STOPWORDS = {
    "about", "after", "again", "against", "amid", "because", "before", "being",
    "between", "could", "first", "from", "have", "into", "more", "most", "over",
    "said", "says", "since", "some", "still", "than", "that", "their", "them",
    "then", "there", "these", "they", "this", "through", "today", "under",
    "very", "were", "what", "when", "where", "which", "while", "will", "with",
    "would", "year", "years",
}


def _normalize_url(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), "", ""))
    except Exception:
        return raw.lower()


def _content_tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]{4,}|[\u4e00-\u9fff]{2,}", str(text or "").lower())
    return sorted({w for w in words if w not in _STOPWORDS})


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / len(a | b)


def _parse_date(date_str: str) -> date | None:
    try:
        return date.fromisoformat(str(date_str)[:10])
    except ValueError:
        return None


def _extract_entries_from_briefing(data: dict[str, Any]) -> list[dict[str, Any]]:
    b_date = str(data.get("date") or "")[:10]
    if not b_date:
        return []
    entries: list[dict[str, Any]] = []

    def add_story(story: dict[str, Any], section: str) -> None:
        headline = str(story.get("headline") or "").strip()
        if not headline:
            return
        urls = [
            _normalize_url(s.get("url", ""))
            for s in (story.get("sources") or [])
            if isinstance(s, dict) and s.get("url")
        ]
        entries.append(
            {
                "date": b_date,
                "section": section,
                "id": str(story.get("id") or ""),
                "headline": headline,
                "urls": [u for u in urls if u],
                "tokens": _content_tokens(headline),
            }
        )

    for s in data.get("top_news") or []:
        if isinstance(s, dict):
            add_story(s, "top_news")

    pos = data.get("positive_news")
    if isinstance(pos, list):
        for s in pos:
            if isinstance(s, dict):
                add_story(s, "positive_news")
    elif isinstance(pos, dict):
        add_story(pos, "positive_news")

    for reg in data.get("local_news") or []:
        if not isinstance(reg, dict):
            continue
        reg_id = reg.get("id") or "local"
        for s in (reg.get("stories") or []) + (reg.get("stories_en") or []):
            if isinstance(s, dict):
                add_story(s, f"local:{reg_id}")

    return entries


def _prune_items(items: list[dict[str, Any]], ref_date: date, window_days: int = NEWS_MEMORY_DAYS) -> list[dict[str, Any]]:
    cutoff = ref_date - timedelta(days=window_days)
    kept: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str, str]] = set()
    for it in items:
        d = _parse_date(it.get("date", ""))
        if d is None or d < cutoff:
            continue
        key = (str(it.get("date")), str(it.get("section")), str(it.get("headline", "")).strip().lower())
        if key in seen_keys:
            continue
        seen_keys.add(key)
        kept.append(it)
    kept.sort(key=lambda x: (x.get("date", ""), x.get("section", ""), x.get("headline", "")), reverse=True)
    return kept


def load_recent_memory(
    reference_date: str,
    window_days: int = NEWS_MEMORY_DAYS,
    include_same_day: bool = False,
) -> list[dict[str, Any]]:
    """Load shown news items from the rolling N-day window (backfilling from archive if needed)."""
    ref = _parse_date(reference_date) or datetime.now(timezone.utc).date()
    items: list[dict[str, Any]] = []

    if NEWS_MEMORY_PATH.exists():
        try:
            payload = json.loads(NEWS_MEMORY_PATH.read_text(encoding="utf-8"))
            if isinstance(payload.get("items"), list):
                items.extend(payload["items"])
        except Exception:
            pass

    if not items and ARCHIVE_DIR.exists():
        cutoff = ref - timedelta(days=window_days)
        for path in sorted(ARCHIVE_DIR.glob("*.json"), reverse=True):
            d = _parse_date(path.stem)
            if d is None or d < cutoff:
                continue
            try:
                items.extend(_extract_entries_from_briefing(json.loads(path.read_text(encoding="utf-8"))))
            except Exception:
                continue

    cutoff = ref - timedelta(days=window_days)
    filtered: list[dict[str, Any]] = []
    for it in items:
        d = _parse_date(it.get("date", ""))
        if d is None or d < cutoff:
            continue
        if not include_same_day and d >= ref:
            continue
        if include_same_day and d > ref:
            continue
        filtered.append(it)
    return filtered


def record_shown_news(briefing_dict: dict[str, Any], window_days: int = NEWS_MEMORY_DAYS) -> list[dict[str, Any]]:
    """Persist all stories shown in a published briefing into rolling 3-day news_memory.json."""
    ref = _parse_date(str(briefing_dict.get("date") or "")) or datetime.now(timezone.utc).date()
    existing: list[dict[str, Any]] = []
    if NEWS_MEMORY_PATH.exists():
        try:
            payload = json.loads(NEWS_MEMORY_PATH.read_text(encoding="utf-8"))
            if isinstance(payload.get("items"), list):
                existing = payload["items"]
        except Exception:
            existing = []

    new_entries = _extract_entries_from_briefing(briefing_dict)
    merged = _prune_items(existing + new_entries, ref, window_days=window_days)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_days": window_days,
        "items": merged,
    }
    NEWS_MEMORY_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return merged


def is_duplicate_of_memory(
    title: str,
    urls: list[str] | None,
    memory_items: list[dict[str, Any]],
) -> bool:
    """Return True if a candidate story matches a URL or headline shown within the rolling window."""
    if not memory_items:
        return False

    norm_urls = {_normalize_url(u) for u in (urls or []) if u}
    norm_title = str(title or "").strip().lower()
    cand_tokens = set(_content_tokens(title))

    for item in memory_items:
        mem_urls = set(item.get("urls") or [])
        if norm_urls and mem_urls and (norm_urls & mem_urls):
            return True
        mem_title = str(item.get("headline") or "").strip().lower()
        if norm_title and mem_title:
            if SequenceMatcher(None, norm_title, mem_title).ratio() >= 0.64:
                return True
        mem_tokens = set(item.get("tokens") or _content_tokens(mem_title))
        if len(cand_tokens) >= 2 and _jaccard(cand_tokens, mem_tokens) >= 0.45:
            return True
    return False


def filter_raw_candidates(
    candidates: list[dict[str, Any]],
    memory_items: list[dict[str, Any]],
    label: str = "news",
    min_keep: int = 4,
) -> list[dict[str, Any]]:
    """Drop raw candidates already shown in the past 3 days (keeping a small fallback floor)."""
    if not candidates or not memory_items:
        return candidates

    fresh: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []
    for c in candidates:
        title = str(c.get("title") or c.get("headline") or "")
        urls: list[str] = []
        if c.get("url"):
            urls.append(str(c["url"]))
        for s in c.get("sources") or []:
            if isinstance(s, dict) and s.get("url"):
                urls.append(str(s["url"]))
        if is_duplicate_of_memory(title, urls, memory_items):
            dropped.append(c)
        else:
            fresh.append(c)

    if dropped:
        print(f"[memory] Filtered {len(dropped)}/{len(candidates)} repeat {label} candidates (3-day window)")

    if len(fresh) < min_keep and dropped:
        fresh.extend(dropped[: max(0, min_keep - len(fresh))])
    return fresh


def format_memory_headlines(memory_items: list[dict[str, Any]], limit: int = 35) -> list[str]:
    """Compact list of '[YYYY-MM-DD] headline' strings for LLM prompt deduplication."""
    seen: set[str] = set()
    lines: list[str] = []
    for it in memory_items:
        hl = str(it.get("headline") or "").strip()
        key = hl.lower()
        if not hl or key in seen:
            continue
        seen.add(key)
        lines.append(f"[{it.get('date', '')}] {hl}")
        if len(lines) >= limit:
            break
    return lines
