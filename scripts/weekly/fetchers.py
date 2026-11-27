"""Async RSS fetchers and context loaders for the Weekly Briefing pipeline."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta
from typing import Any

import feedparser
import httpx

from ..briefing.fetchers.news import clean_text, deduplicate_articles
from .config import (
    ARCHIVE_DIR,
    CULTURE_FEEDS,
    DAILY_ARCHIVE_DIR,
    HISTORY_FEEDS,
    HTTP_TIMEOUT_SECONDS,
    LONGREAD_FEEDS,
    SCIENCE_FEEDS,
    USER_AGENT,
)


async def _fetch_feed(client: httpx.AsyncClient, feed_cfg: dict[str, str], limit: int = 10) -> list[dict[str, Any]]:
    try:
        resp = await client.get(feed_cfg["url"], follow_redirects=True)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)
        items: list[dict[str, Any]] = []
        for entry in parsed.entries[:limit]:
            title = clean_text(entry.get("title", ""), max_len=200)
            link = (entry.get("link") or "").strip()
            if not title or not link:
                continue
            summary = clean_text(entry.get("summary") or entry.get("description") or "", max_len=360)
            published = entry.get("published") or entry.get("updated") or ""
            items.append(
                {
                    "title": title,
                    "summary": summary,
                    "url": link,
                    "source": feed_cfg["name"],
                    "category": feed_cfg["category"],
                    "published": published,
                }
            )
        return items
    except Exception as exc:
        print(f"[weekly] Failed to fetch {feed_cfg['name']}: {exc}")
        return []


async def _fetch_bucket(
    client: httpx.AsyncClient,
    feeds: list[dict[str, str]],
    max_items: int = 24,
) -> tuple[list[dict[str, Any]], str]:
    results = await asyncio.gather(*[_fetch_feed(client, cfg) for cfg in feeds])
    succeeded = sum(1 for r in results if r)
    all_items = [item for batch in results for item in batch]
    deduped = deduplicate_articles(all_items, max_items=max_items)
    if not deduped:
        return [], "failed"
    health = "ok" if succeeded >= max(1, len(feeds) // 2) else "partial"
    return deduped, health


async def fetch_all_weekly_sources() -> dict[str, Any]:
    """Fetch Science, Culture & Arts, History & Archaeology, and Long Reads in parallel."""
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        (sci, sci_h), (cult, cult_h), (hist, hist_h), (lr, lr_h) = await asyncio.gather(
            _fetch_bucket(client, SCIENCE_FEEDS, max_items=24),
            _fetch_bucket(client, CULTURE_FEEDS, max_items=24),
            _fetch_bucket(client, HISTORY_FEEDS, max_items=22),
            _fetch_bucket(client, LONGREAD_FEEDS, max_items=20),
        )
    return {
        "science": sci,
        "culture": cult,
        "history": hist,
        "long_reads": lr,
        "source_health": {
            "science": sci_h,
            "culture": cult_h,
            "history": hist_h,
            "long_reads": lr_h,
        },
    }


def load_recent_daily_pulse(target_date: str, days: int = 7) -> list[dict[str, Any]]:
    """Read compact highlights from the last 7 Daily Briefing archives for the light Week in Brief recap."""
    if not DAILY_ARCHIVE_DIR.exists():
        return []
    try:
        end_dt = datetime.strptime(target_date, "%Y-%m-%d")
    except ValueError:
        return []
    start_str = (end_dt - timedelta(days=days - 1)).strftime("%Y-%m-%d")

    files = sorted(
        (p for p in DAILY_ARCHIVE_DIR.glob("*.json") if start_str <= p.stem <= target_date),
        reverse=True,
    )
    snippets: list[dict[str, Any]] = []
    for path in files[:days]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        bullets = []
        for b in (data.get("executive_brief") or [])[:3]:
            text = b.get("text") if isinstance(b, dict) else str(b)
            if text:
                bullets.append(text)
        top_titles = [s.get("headline", "") for s in (data.get("top_news") or [])[:4] if s.get("headline")]
        snippets.append(
            {
                "date": data.get("date", path.stem),
                "executive_highlights": bullets,
                "top_headlines": top_titles,
            }
        )
    return snippets


def load_recent_weekly_headlines(target_date: str, max_weeks: int = 4) -> list[str]:
    """Return previously published Weekly Briefing headlines so Sunday editions avoid repeating stories."""
    if not ARCHIVE_DIR.exists():
        return []
    files = sorted(
        (p for p in ARCHIVE_DIR.glob("*.json") if p.stem < target_date),
        reverse=True,
    )
    seen: list[str] = []
    for path in files[:max_weeks]:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for key in ("science", "culture", "history"):
            for item in (data.get(key) or {}).get("items", []):
                h = item.get("headline")
                if h:
                    seen.append(h)
        for lr in data.get("long_reads") or []:
            h = lr.get("headline")
            if h:
                seen.append(h)
    return seen
