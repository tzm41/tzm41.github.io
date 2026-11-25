"""Global conflict tracker fetcher using GDELT 2.0 DOC API + Google News RSS fallback."""

from __future__ import annotations

import asyncio
from urllib.parse import quote_plus
from typing import Any

import feedparser
import httpx

from ..config import CONFLICT_THEATERS, HTTP_TIMEOUT_SECONDS, USER_AGENT
from .news import clean_text

GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"


async def _fetch_gdelt_intensity(client: httpx.AsyncClient, query: str) -> list[float]:
    """Fetch 14-day daily media volume series from GDELT 2.0 DOC API with 429 retry."""
    params = {
        "query": query,
        "mode": "timelinevolraw",
        "timespan": "14d",
        "format": "json",
    }
    for attempt in range(2):
        try:
            resp = await client.get(GDELT_DOC_URL, params=params)
            if resp.status_code == 429 and attempt == 0:
                await asyncio.sleep(6.0)
                continue
            resp.raise_for_status()
            data = resp.json()
            timeline = data.get("timeline", [])
            if not timeline:
                return []
            points = timeline[0].get("data", [])
            daily: dict[str, float] = {}
            for pt in points:
                day = str(pt.get("date", ""))[:8]
                val = float(pt.get("value", 0.0) or 0.0)
                if day:
                    daily[day] = daily.get(day, 0.0) + val
            return [round(daily[k], 1) for k in sorted(daily.keys())[-14:]]
        except Exception as exc:
            if attempt == 1:
                print(f"[conflicts] GDELT timeline failed for query: {exc}")
            else:
                await asyncio.sleep(3.0)
    return []


async def _fetch_theater_rss(client: httpx.AsyncClient, rss_query: str) -> list[dict[str, str]]:
    """Fetch recent grounded headlines for a theater via Google News RSS."""
    url = (
        f"https://news.google.com/rss/search?q={quote_plus(rss_query + ' when:2d')}"
        "&hl=en-US&gl=US&ceid=US:en"
    )
    try:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)
        events: list[dict[str, str]] = []
        for entry in parsed.entries[:6]:
            title = clean_text(entry.get("title", ""), max_len=190)
            link = (entry.get("link") or "").strip()
            source_obj = entry.get("source")
            source_name = (
                source_obj.get("title", "News") if isinstance(source_obj, dict) else "News"
            )
            if title and link:
                events.append({"headline": title, "source": source_name, "url": link})
        return events
    except Exception as exc:
        print(f"[conflicts] RSS failed for '{rss_query}': {exc}")
        return []


def _build_theater_record(
    cfg: dict[str, str],
    intensity_series: list[float],
    events: list[dict[str, str]],
) -> dict[str, Any]:
    latest_score = intensity_series[-1] if intensity_series else float(len(events) * 10)
    trend_7d = "flat"
    if len(intensity_series) >= 6:
        first_half = sum(intensity_series[: len(intensity_series) // 2]) / (
            len(intensity_series) // 2
        )
        second_half = sum(intensity_series[len(intensity_series) // 2 :]) / (
            len(intensity_series) - len(intensity_series) // 2
        )
        if first_half > 0:
            ratio = (second_half - first_half) / first_half
            if ratio > 0.15:
                trend_7d = "up"
            elif ratio < -0.15:
                trend_7d = "down"

    return {
        "id": cfg["id"],
        "name": cfg["name"],
        "region": cfg["region"],
        "intensity_score": round(latest_score, 1),
        "intensity_series_14d": intensity_series,
        "trend_7d": trend_7d,
        "timeline_events": events,
    }


async def _fetch_google_news_intensity_fallback(
    client: httpx.AsyncClient, rss_query: str
) -> list[float]:
    """Build a 14-day daily article volume series from Google News public RSS."""
    url = (
        f"https://news.google.com/rss/search?q={quote_plus(rss_query + ' when:14d')}"
        "&hl=en-US&gl=US&ceid=US:en"
    )
    try:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)
        daily_counts: dict[str, int] = {}
        for entry in parsed.entries:
            pub = entry.get("published_parsed") or entry.get("updated_parsed")
            if not pub:
                continue
            day_key = f"{pub.tm_year:04d}{pub.tm_mon:02d}{pub.tm_mday:02d}"
            daily_counts[day_key] = daily_counts.get(day_key, 0) + 1
        if not daily_counts:
            return []
        return [float(daily_counts[k]) for k in sorted(daily_counts.keys())[-14:]]
    except Exception as exc:
        print(f"[conflicts] Google News 14d intensity fallback failed for '{rss_query}': {exc}")
        return []


async def fetch_conflicts() -> tuple[list[dict[str, Any]], str]:
    """Fetch conflict intensity metrics (GDELT with Google News RSS fallback) and RSS headlines."""
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        # Fetch RSS headlines in parallel
        rss_task = asyncio.gather(
            *[_fetch_theater_rss(client, cfg["rss_query"]) for cfg in CONFLICT_THEATERS]
        )
        # Fetch GDELT sequentially with polite 5.5s spacing; fall back to Google News RSS on 429/empty
        gdelt_series_list: list[list[float]] = []
        for idx, cfg in enumerate(CONFLICT_THEATERS):
            if idx > 0:
                await asyncio.sleep(5.5)
            series = await _fetch_gdelt_intensity(client, cfg["gdelt_query"])
            if not series:
                print(f"[conflicts] Falling back to Google News RSS intensity for {cfg['id']}.")
                series = await _fetch_google_news_intensity_fallback(client, cfg["rss_query"])
            gdelt_series_list.append(series)

        rss_results = await rss_task

    theaters = [
        _build_theater_record(cfg, series, events)
        for cfg, series, events in zip(CONFLICT_THEATERS, gdelt_series_list, rss_results)
    ]

    populated = sum(
        1 for t in theaters if t["timeline_events"] or t["intensity_series_14d"]
    )
    if populated == 0:
        return theaters, "failed"
    health = "ok" if populated >= len(CONFLICT_THEATERS) - 1 else "partial"
    return theaters, health
