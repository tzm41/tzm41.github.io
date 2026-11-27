"""Rolling 3-edition memory & deduplication for the Weekly Briefing."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from ..common.memory import (
    RollingMemoryStore,
    filter_raw_candidates as _filter_raw_candidates,
    format_memory_headlines,
    is_duplicate_of_memory,
    make_memory_entry,
)
from .config import ARCHIVE_DIR, WEEKLY_MEMORY_EDITIONS, WEEKLY_MEMORY_PATH


def _extract_entries_from_weekly(data: dict[str, Any]) -> list[dict[str, Any]]:
    ed_date = str(data.get("date") or "")[:10]
    if not ed_date:
        return []
    entries: list[dict[str, Any]] = []

    def add_item(section: str, headline: str, urls: list[str] | None = None, item_id: str = "") -> None:
        entry = make_memory_entry(ed_date, section, headline, urls=urls, item_id=item_id)
        if entry:
            entries.append(entry)

    for sec_key in ("science", "culture", "history"):
        sec = data.get(sec_key)
        if not isinstance(sec, dict):
            continue
        for item in sec.get("items") or []:
            if not isinstance(item, dict):
                continue
            urls = [
                str(s.get("url", ""))
                for s in (item.get("sources") or [])
                if isinstance(s, dict) and s.get("url")
            ]
            add_item(sec_key, str(item.get("headline") or ""), urls=urls, item_id=str(item.get("id") or ""))

    for lr in data.get("long_reads") or []:
        if not isinstance(lr, dict):
            continue
        urls = [
            str(s.get("url", ""))
            for s in (lr.get("sources") or [])
            if isinstance(s, dict) and s.get("url")
        ]
        add_item("long_reads", str(lr.get("headline") or ""), urls=urls, item_id=str(lr.get("id") or ""))

    for geo in data.get("around_the_world") or []:
        if not isinstance(geo, dict):
            continue
        kind = "cuisine" if geo.get("kind") == "cuisine" else "geology"
        place = str(geo.get("place") or "").strip()
        title = str(geo.get("title") or "").strip()
        label = f"{place} — {title}" if place and title else (place or title)
        wiki_title = str(geo.get("wiki_title") or place).strip()
        urls = [f"https://en.wikipedia.org/wiki/{quote(wiki_title.replace(' ', '_'))}"] if wiki_title else []
        add_item(f"around_world:{kind}", label, urls=urls, item_id=str(geo.get("id") or ""))

    fq = data.get("featured_quote")
    if isinstance(fq, dict) and fq.get("quote"):
        author = str(fq.get("author") or "").strip()
        quote_text = str(fq.get("quote") or "").strip()
        add_item("featured_quote", f"{author}: {quote_text}" if author else quote_text)

    return entries


_STORE = RollingMemoryStore(
    memory_path=WEEKLY_MEMORY_PATH,
    archive_dir=ARCHIVE_DIR,
    extract_entries=_extract_entries_from_weekly,
    window_editions=WEEKLY_MEMORY_EDITIONS,
)


def load_recent_weekly_memory(
    reference_date: str,
    window_editions: int = WEEKLY_MEMORY_EDITIONS,
    include_same_date: bool = False,
) -> list[dict[str, Any]]:
    """Load items featured in the last N weekly editions (backfilling from archive if needed)."""
    return _STORE.load_recent(
        reference_date,
        include_same_date=include_same_date,
        window_editions=window_editions,
    )


def record_shown_weekly(
    briefing_dict: dict[str, Any],
    window_editions: int = WEEKLY_MEMORY_EDITIONS,
) -> list[dict[str, Any]]:
    """Persist all featured items from a Weekly Briefing into rolling 3-edition weekly_memory.json."""
    return _STORE.record(briefing_dict, window_editions=window_editions)


def filter_raw_candidates(
    candidates: list[dict[str, Any]],
    memory_items: list[dict[str, Any]],
    label: str = "weekly",
    min_keep: int = 5,
) -> list[dict[str, Any]]:
    """Drop raw RSS candidates already featured in the last 3 weekly editions."""
    return _filter_raw_candidates(
        candidates,
        memory_items,
        label=label,
        min_keep=min_keep,
        window_label=f"last {WEEKLY_MEMORY_EDITIONS} editions",
    )


__all__ = [
    "filter_raw_candidates",
    "format_memory_headlines",
    "is_duplicate_of_memory",
    "load_recent_weekly_memory",
    "record_shown_weekly",
]
