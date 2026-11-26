"""US politics fetcher: Polymarket Gamma prediction markets + political/legislative RSS."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import feedparser
import httpx

from ..config import (
    HTTP_TIMEOUT_SECONDS,
    KALSHI_EVENTS_URL,
    POLITICS_FEEDS,
    POLYMARKET_GAMMA_URL,
    USER_AGENT,
)
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
                    "source": "Polymarket",
                }
            )
            if len(results) >= 6:
                break
        return results
    except Exception as exc:
        print(f"[politics] Polymarket fetch failed: {exc}")
        return []


def _parse_kalshi_float(val: Any) -> float | None:
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


async def _fetch_kalshi(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Fetch active US politics prediction markets from Kalshi's public elections API."""
    params = {
        "status": "open",
        "with_nested_markets": "true",
        "limit": 100,
    }
    try:
        resp = await client.get(KALSHI_EVENTS_URL, params=params)
        resp.raise_for_status()
        payload = resp.json()
        events = payload.get("events") if isinstance(payload, dict) else []
        if not isinstance(events, list):
            return []

        candidates: list[dict[str, Any]] = []
        for event in events:
            cat = str(event.get("category") or "").lower()
            title = (event.get("title") or "").strip()
            if not title:
                continue
            lower_title = title.lower()
            if cat != "politics" and not any(kw in lower_title for kw in US_POLITICS_KEYWORDS):
                continue
            if not any(kw in lower_title for kw in US_POLITICS_KEYWORDS):
                continue

            markets = event.get("markets") or []
            best_market = None
            best_vol = -1.0
            for m in markets:
                prob = _parse_kalshi_float(m.get("last_price_dollars"))
                if prob is None:
                    bid = _parse_kalshi_float(m.get("yes_bid_dollars"))
                    ask = _parse_kalshi_float(m.get("yes_ask_dollars"))
                    if bid is not None and ask is not None:
                        prob = (bid + ask) / 2.0
                if prob is None or prob <= 0.01 or prob >= 0.99:
                    continue
                vol = _parse_kalshi_float(m.get("volume_24h_fp")) or _parse_kalshi_float(m.get("volume_fp")) or 0.0
                if vol > best_vol:
                    best_vol = vol
                    best_market = (m, round(prob, 4))

            if not best_market:
                continue

            m_obj, prob = best_market
            question = (m_obj.get("title") or title).strip()
            prev_prob = _parse_kalshi_float(m_obj.get("previous_price_dollars"))
            delta_24h = round(prob - prev_prob, 4) if prev_prob is not None else 0.0
            total_vol = _parse_kalshi_float(m_obj.get("volume_fp")) or best_vol
            series = (event.get("series_ticker") or event.get("event_ticker") or "").strip().lower()
            url = f"https://kalshi.com/markets/{series}" if series else "https://kalshi.com/markets"

            candidates.append(
                {
                    "question": question,
                    "yes_prob": prob,
                    "delta_24h": delta_24h,
                    "volume_usd": round(total_vol, 2),
                    "url": url,
                    "source": "Kalshi",
                }
            )

        candidates.sort(key=lambda x: x["volume_usd"], reverse=True)
        return candidates[:6]
    except Exception as exc:
        print(f"[politics] Kalshi fetch failed: {exc}")
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


GOOGLE_POLITICS_FALLBACK_FEEDS: list[dict[str, str]] = [
    {
        "name": "Google News Congress & White House",
        "url": "https://news.google.com/rss/search?q=%28Congress+OR+%22White+House%22+OR+%22Supreme+Court%22%29+when:2d&hl=en-US&gl=US&ceid=US:en",
    },
    {
        "name": "Google News US Polls & Odds",
        "url": "https://news.google.com/rss/search?q=%28%22US+politics%22+OR+poll+OR+tariffs+OR+legislation%29+when:2d&hl=en-US&gl=US&ceid=US:en",
    },
]


async def fetch_politics() -> tuple[dict[str, Any], str]:
    """Fetch US politics prediction markets (Polymarket + Kalshi) and political headlines."""
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        poly_task = _fetch_polymarket(client)
        kalshi_task = _fetch_kalshi(client)
        feed_tasks = [_fetch_politics_feed(client, cfg) for cfg in POLITICS_FEEDS]
        poly_markets, kalshi_markets, *feed_results = await asyncio.gather(
            poly_task, kalshi_task, *feed_tasks
        )

        # Merge Polymarket (primary) with Kalshi (supplement/fallback, up to 6 total)
        combined_markets: list[dict[str, Any]] = []
        seen_questions: set[str] = set()
        poly_limit = 4 if kalshi_markets else 6
        for m in poly_markets[:poly_limit]:
            norm = m["question"].strip().lower()
            if norm not in seen_questions:
                seen_questions.add(norm)
                combined_markets.append(m)
        for m in kalshi_markets:
            if len(combined_markets) >= 6:
                break
            norm = m["question"].strip().lower()
            if norm not in seen_questions:
                seen_questions.add(norm)
                combined_markets.append(m)
        # Backfill remaining slots from Polymarket if Kalshi had fewer than needed
        for m in poly_markets[poly_limit:]:
            if len(combined_markets) >= 6:
                break
            norm = m["question"].strip().lower()
            if norm not in seen_questions:
                seen_questions.add(norm)
                combined_markets.append(m)

        articles = [item for batch in feed_results for item in batch]
        feeds_ok = sum(1 for r in feed_results if r)

        if not combined_markets or feeds_ok < 2:
            print("[politics] Supplementing with Google News public politics RSS.")
            fb_results = await asyncio.gather(
                *[_fetch_politics_feed(client, cfg) for cfg in GOOGLE_POLITICS_FALLBACK_FEEDS]
            )
            articles.extend(item for batch in fb_results for item in batch)
            feeds_ok += sum(1 for r in fb_results if r)

    articles = articles[:35]
    if not combined_markets and not articles:
        return {"prediction_markets": [], "articles": []}, "failed"

    health = "ok" if (feeds_ok >= 2 and (combined_markets or feeds_ok >= 3)) else "partial"
    return {"prediction_markets": combined_markets, "articles": articles}, health
