"""Rolling 3-day news memory & deduplication across morning and afternoon briefings."""

from __future__ import annotations

from typing import Any

from ..common.memory import (
    RollingMemoryStore,
    filter_raw_candidates as _filter_raw_candidates,
    format_memory_headlines,
    is_duplicate_of_memory,
    make_memory_entry,
)
from .config import ARCHIVE_DIR, NEWS_MEMORY_DAYS, NEWS_MEMORY_PATH


def _extract_entries_from_briefing(data: dict[str, Any]) -> list[dict[str, Any]]:
    b_date = str(data.get("date") or "")[:10]
    if not b_date:
        return []
    entries: list[dict[str, Any]] = []

    def add_story(story: dict[str, Any], section: str) -> None:
        urls = [
            str(s.get("url", ""))
            for s in (story.get("sources") or [])
            if isinstance(s, dict) and s.get("url")
        ]
        entry = make_memory_entry(
            b_date,
            section,
            str(story.get("headline") or ""),
            urls=urls,
            item_id=str(story.get("id") or ""),
        )
        if entry:
            entries.append(entry)

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


_STORE = RollingMemoryStore(
    memory_path=NEWS_MEMORY_PATH,
    archive_dir=ARCHIVE_DIR,
    extract_entries=_extract_entries_from_briefing,
    window_days=NEWS_MEMORY_DAYS,
)


def load_recent_memory(
    reference_date: str,
    window_days: int = NEWS_MEMORY_DAYS,
    include_same_day: bool = False,
) -> list[dict[str, Any]]:
    """Load shown news items from the rolling N-day window (backfilling from archive if needed)."""
    return _STORE.load_recent(
        reference_date,
        include_same_date=include_same_day,
        window_days=window_days,
    )


def record_shown_news(briefing_dict: dict[str, Any], window_days: int = NEWS_MEMORY_DAYS) -> list[dict[str, Any]]:
    """Persist all stories shown in a published briefing into rolling 3-day news_memory.json."""
    return _STORE.record(briefing_dict, window_days=window_days)


def filter_raw_candidates(
    candidates: list[dict[str, Any]],
    memory_items: list[dict[str, Any]],
    label: str = "news",
    min_keep: int = 4,
) -> list[dict[str, Any]]:
    """Drop raw candidates already shown in the past 3 days (keeping a small fallback floor)."""
    return _filter_raw_candidates(
        candidates,
        memory_items,
        label=label,
        min_keep=min_keep,
        window_label=f"{NEWS_MEMORY_DAYS}-day window",
    )


__all__ = [
    "filter_raw_candidates",
    "format_memory_headlines",
    "is_duplicate_of_memory",
    "load_recent_memory",
    "record_shown_news",
]
