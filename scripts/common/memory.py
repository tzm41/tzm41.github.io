"""Shared rolling content memory & deduplication engine for Daily and Weekly briefings.

Supports two retention modes:
- Day-window mode (`window_days`): keeps items from the last N calendar days (Daily Briefing).
- Edition-count mode (`window_editions`): keeps items from the last N distinct edition dates (Weekly Briefing).
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit, urlunsplit

_STOPWORDS = {
    "about", "after", "again", "against", "amid", "because", "before", "being",
    "between", "could", "first", "from", "have", "into", "more", "most", "over",
    "said", "says", "since", "some", "still", "than", "that", "their", "them",
    "then", "there", "these", "they", "this", "through", "today", "under",
    "very", "were", "what", "when", "where", "which", "while", "will", "with",
    "would", "year", "years",
}


def normalize_url(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        parts = urlsplit(raw)
        return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), "", ""))
    except Exception:
        return raw.lower()


def content_tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]{4,}|[\u4e00-\u9fff]{2,}", str(text or "").lower())
    return sorted({w for w in words if w not in _STOPWORDS})


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / len(a | b)


def parse_date(date_str: str) -> date | None:
    try:
        return date.fromisoformat(str(date_str)[:10])
    except ValueError:
        return None


def make_memory_entry(
    edition_date: str,
    section: str,
    headline: str,
    urls: list[str] | None = None,
    item_id: str = "",
) -> dict[str, Any] | None:
    hl = str(headline or "").strip()
    if not hl or not edition_date:
        return None
    norm_urls = [normalize_url(u) for u in (urls or []) if u]
    return {
        "date": str(edition_date)[:10],
        "section": section,
        "id": str(item_id or ""),
        "headline": hl,
        "urls": [u for u in norm_urls if u],
        "tokens": content_tokens(hl),
    }


def is_duplicate_of_memory(
    title: str,
    urls: list[str] | None,
    memory_items: list[dict[str, Any]],
) -> bool:
    """Return True if a candidate matches a URL or headline shown within the rolling memory."""
    if not memory_items:
        return False

    norm_urls = {normalize_url(u) for u in (urls or []) if u}
    norm_title = str(title or "").strip().lower()
    cand_tokens = set(content_tokens(title))

    for item in memory_items:
        mem_urls = set(item.get("urls") or [])
        if norm_urls and mem_urls and (norm_urls & mem_urls):
            return True
        mem_title = str(item.get("headline") or "").strip().lower()
        if norm_title and mem_title:
            if SequenceMatcher(None, norm_title, mem_title).ratio() >= 0.64:
                return True
        mem_tokens = set(item.get("tokens") or content_tokens(mem_title))
        if len(cand_tokens) >= 2 and jaccard(cand_tokens, mem_tokens) >= 0.45:
            return True
    return False


def filter_raw_candidates(
    candidates: list[dict[str, Any]],
    memory_items: list[dict[str, Any]],
    label: str = "news",
    min_keep: int = 4,
    window_label: str = "rolling window",
) -> list[dict[str, Any]]:
    """Drop raw candidates already featured in recent memory (preserving a small fallback floor)."""
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
        print(f"[memory] Filtered {len(dropped)}/{len(candidates)} repeat {label} candidates ({window_label})")

    if len(fresh) < min_keep and dropped:
        fresh.extend(dropped[: max(0, min_keep - len(fresh))])
    return fresh


def format_memory_headlines(
    memory_items: list[dict[str, Any]],
    limit: int = 35,
    include_section: bool = False,
) -> list[str]:
    """Compact list of '[YYYY-MM-DD] headline' strings for synthesis prompt deduplication."""
    seen: set[str] = set()
    lines: list[str] = []
    for it in memory_items:
        hl = str(it.get("headline") or "").strip()
        key = hl.lower()
        if not hl or key in seen:
            continue
        seen.add(key)
        prefix = f"[{it.get('date', '')}]"
        if include_section and it.get("section"):
            prefix += f" ({it['section']})"
        lines.append(f"{prefix} {hl}")
        if len(lines) >= limit:
            break
    return lines


class RollingMemoryStore:
    """Persistent rolling content memory backed by JSON with archive backfill."""

    def __init__(
        self,
        memory_path: Path,
        archive_dir: Path,
        extract_entries: Callable[[dict[str, Any]], list[dict[str, Any]]],
        *,
        window_days: int | None = None,
        window_editions: int | None = None,
    ) -> None:
        if window_days is None and window_editions is None:
            raise ValueError("Specify either window_days or window_editions.")
        self.memory_path = memory_path
        self.archive_dir = archive_dir
        self.extract_entries = extract_entries
        self.window_days = window_days
        self.window_editions = window_editions

    def _dedupe_and_sort(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        kept: list[dict[str, Any]] = []
        seen_keys: set[tuple[str, str, str]] = set()
        for it in items:
            if parse_date(it.get("date", "")) is None:
                continue
            key = (str(it.get("date")), str(it.get("section")), str(it.get("headline", "")).strip().lower())
            if key in seen_keys:
                continue
            seen_keys.add(key)
            kept.append(it)
        kept.sort(key=lambda x: (x.get("date", ""), x.get("section", ""), x.get("headline", "")), reverse=True)
        return kept

    def _select_window(
        self,
        items: list[dict[str, Any]],
        ref: date,
        *,
        include_same_date: bool,
        window_days: int | None = None,
        window_editions: int | None = None,
    ) -> list[dict[str, Any]]:
        eff_days = self.window_days if window_days is None else window_days
        eff_editions = self.window_editions if window_editions is None else window_editions

        eligible: list[dict[str, Any]] = []
        for it in self._dedupe_and_sort(items):
            d = parse_date(it.get("date", ""))
            if d is None:
                continue
            if not include_same_date and d >= ref:
                continue
            if include_same_date and d > ref:
                continue
            if eff_days is not None and d < (ref - timedelta(days=eff_days)):
                continue
            eligible.append(it)

        if eff_editions is not None:
            recent_dates = sorted({str(it["date"]) for it in eligible}, reverse=True)[:eff_editions]
            allowed = set(recent_dates)
            eligible = [it for it in eligible if str(it["date"]) in allowed]

        return eligible

    def _read_existing_or_backfill(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        if self.memory_path.exists():
            try:
                payload = json.loads(self.memory_path.read_text(encoding="utf-8"))
                if isinstance(payload.get("items"), list):
                    items.extend(payload["items"])
            except Exception:
                pass

        if not items and self.archive_dir.exists():
            archive_files = sorted(self.archive_dir.glob("*.json"), reverse=True)
            scan_limit = (self.window_editions + 2) if self.window_editions is not None else 14
            for path in archive_files[:scan_limit]:
                try:
                    items.extend(self.extract_entries(json.loads(path.read_text(encoding="utf-8"))))
                except Exception:
                    continue
        return items

    def load_recent(
        self,
        reference_date: str,
        *,
        include_same_date: bool = False,
        window_days: int | None = None,
        window_editions: int | None = None,
    ) -> list[dict[str, Any]]:
        ref = parse_date(reference_date) or datetime.now(timezone.utc).date()
        items = self._read_existing_or_backfill()
        return self._select_window(
            items,
            ref,
            include_same_date=include_same_date,
            window_days=window_days,
            window_editions=window_editions,
        )

    def record(
        self,
        edition_dict: dict[str, Any],
        *,
        window_days: int | None = None,
        window_editions: int | None = None,
    ) -> list[dict[str, Any]]:
        ref = parse_date(str(edition_dict.get("date") or "")) or datetime.now(timezone.utc).date()
        existing = self._read_existing_or_backfill()
        new_entries = self.extract_entries(edition_dict)
        merged = self._select_window(
            existing + new_entries,
            ref,
            include_same_date=True,
            window_days=window_days,
            window_editions=window_editions,
        )

        self.memory_path.parent.mkdir(parents=True, exist_ok=True)
        out: dict[str, Any] = {
            "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        eff_days = self.window_days if window_days is None else window_days
        eff_editions = self.window_editions if window_editions is None else window_editions
        if eff_days is not None:
            out["window_days"] = eff_days
        if eff_editions is not None:
            out["window_editions"] = eff_editions
        out["editions"] = sorted({str(it["date"]) for it in merged}, reverse=True)
        out["items"] = merged
        self.memory_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return merged
