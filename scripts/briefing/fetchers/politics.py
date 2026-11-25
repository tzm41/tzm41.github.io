"""US politics fetcher: Polymarket Gamma prediction markets + political/legislative RSS."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import feedparser
import httpx

from ..config import HTTP_TIMEOUT_SECONDS, POLITICS_FEEDS, POLYMARKET_GAMMA_URL, USER_AGENT
from .news import clean_text

US_POLITICS_KEYWORDS = (
    "trump",
    "biden",
    "congress",
    "senate",
    "house",
    "president",
    "us ",
    "u.s.",
    "fed ",
    "federal reserve",
    "tariff",
    "supreme court",
    "election",
    "democrat",
    "republican",
    "gop",
    "white house",
    "shutdown",
    "cabinet",
    "midterm",
    "governor",
)


def _parse_yes_probability(market: dict[str, Any]) -> float | None:
    prices = market.get("outcomePrices")
    if isinstance(prices, str):
        try:
            prices = json.loads(prices)
        except json.JSONDecodeError:
            return None
    if isinstance(prices, list) and prices:
        try:
            val = float(prices[0])
            if 0.0 <= val <= 1.0:
                return round(val, 4)
        except (TypeError, ValueError):
            return None
    return None


async def _fetch_polymarket(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Fetch top active US politics prediction markets from Polymarket Gamma API."""
    params = {
        "active": "true",
        "closed": "false",
        "order": "volume24hr",
        "ascending": "false",
        "limit": 40,
        "tag_slug": "politics",
    }
    try:
        resp = await client.get(POLYMARKET_GAMMA_URL, params=params)
        resp.raise_for_status()
        events = resp.json()
        if not isinstance(events, list):
            return []

        results: list[dict[str, Any]] = []
        for event in events:
            title = (event.get("title") or "").strip()
            slug = (event.get("slug") or "").strip()
            if not title:
                continue
            lower_title = title.lower()
            if not any(kw in lower_title for kw in US_POLITICS_KEYWORDS):
                continue

            markets = event.get("markets") or []
            best_market = None
            best_vol = -1.0
            for m in markets:
                if m.get("closed"):
                    continue
                prob = _parse_yes_probability(m)
                if prob is None or prob <= 0.01 or prob >= 0.99:
                    continue
                vol = float(m.get("volumeNum") or m.get("volume") or 0.0)
                if vol > best_vol:
                    best_vol = vol
                    best_market = (m, prob)

            if not best_market:
                continue

            m_obj, prob = best_market
            question = (m_obj.get("question") or title).strip()
            delta_24h = 0.0
            try:
                delta_24h = round(float(m_obj.get("oneDayPriceChange") or 0.0), 4)
            except (TypeError, ValueError):
                delta_24h = 0.0

            results.append(
                {
                    "question": question,
                    "yes_prob": prob,
                    "delta_24h": delta_24h,
                    "volume_usd": round(float(event.get("volume") or best_vol or 0.0), 2),
                    "url": f"https://polymarket.com/event/{slug}" if slug else "https://polymarket.com",
                }
            )
            if len(results) >= 6:
                break
        return results
    except Exception as exc:
        print(f"[politics] Polymarket fetch failed: {exc}")
        return []


async def _fetch_politics_feed(client: httpx.AsyncClient, cfg: dict[str, str]) -> list[dict[str, str]]:
    try:
        resp = await client.get(cfg["url"], follow_redirects=True)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)
        items: list[dict[str, str]] = []
        for entry in parsed.entries[:10]:
            title = clean_text(entry.get("title", ""), max_len=200)
            link = (entry.get("link") or "").strip()
            summary = clean_text(entry.get("summary") or entry.get("description") or "", max_len=280)
            if title and link:
                items.append(
                    {
                        "title": title,
                        "summary": summary,
                        "source": cfg["name"],
                        "url": link,
                    }
                )
        return items
    except Exception as exc:
        print(f"[politics] Failed to fetch {cfg['name']}: {exc}")
        return []


async def fetch_politics() -> tuple[dict[str, Any], str]:
    """Fetch US politics prediction markets and legislative/political headlines."""
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        poly_task = _fetch_polymarket(client)
        feed_tasks = [_fetch_politics_feed(client, cfg) for cfg in POLITICS_FEEDS]
        poly_markets, *feed_results = await asyncio.gather(poly_task, *feed_tasks)

    articles = [item for batch in feed_results for item in batch][:35]
    feeds_ok = sum(1 for r in feed_results if r)

    if not poly_markets and not articles:
        return {"prediction_markets": [], "articles": []}, "failed"

    health = "ok" if (feeds_ok >= 2 and (poly_markets or feeds_ok >= 3)) else "partial"
    return {"prediction_markets": poly_markets, "articles": articles}, health
