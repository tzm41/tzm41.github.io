"""Multi-RSS top news aggregator with lightweight title deduplication."""

from __future__ import annotations

import asyncio
import html
import re
from difflib import SequenceMatcher
from typing import Any

import feedparser
import httpx
from bs4 import BeautifulSoup

from ..config import HTTP_TIMEOUT_SECONDS, NEWS_FEEDS, USER_AGENT


def clean_text(raw: str | None, max_len: int = 320) -> str:
    if not raw:
        return ""
    text = BeautifulSoup(html.unescape(raw), "html.parser").get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_len:
        text = text[: max_len - 1].rsplit(" ", 1)[0] + "…"
    return text


def normalize_title(title: str) -> str:
    cleaned = re.sub(r"\s*[-|–—]\s*[^-|–—]{2,40}$", "", title.strip())
    return re.sub(r"[^a-z0-9\s]", "", cleaned.lower()).strip()


async def _fetch_feed(client: httpx.AsyncClient, feed_cfg: dict[str, str]) -> list[dict[str, Any]]:
    try:
        resp = await client.get(feed_cfg["url"], follow_redirects=True)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.text)
        items: list[dict[str, Any]] = []
        for entry in parsed.entries[:12]:
            title = clean_text(entry.get("title", ""), max_len=200)
            link = (entry.get("link") or "").strip()
            if not title or not link:
                continue
            summary = clean_text(entry.get("summary") or entry.get("description") or "", max_len=320)
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
        print(f"[news] Failed to fetch {feed_cfg['name']}: {exc}")
        return []


def deduplicate_articles(articles: list[dict[str, Any]], max_items: int = 45) -> list[dict[str, Any]]:
    """Cluster near-duplicate headlines while preserving multi-source counts."""
    clusters: list[dict[str, Any]] = []
    for art in articles:
        norm = normalize_title(art["title"])
        if not norm:
            continue
        matched = False
        for cluster in clusters:
            ratio = SequenceMatcher(None, norm, cluster["_norm"]).ratio()
            if ratio >= 0.72:
                if art["source"] not in {s["name"] for s in cluster["sources"]}:
                    cluster["sources"].append({"name": art["source"], "url": art["url"]})
                    cluster["cluster_size"] += 1
                if len(art["summary"]) > len(cluster["summary"]):
                    cluster["summary"] = art["summary"]
                matched = True
                break
        if not matched:
            clusters.append(
                {
                    "_norm": norm,
                    "title": art["title"],
                    "summary": art["summary"],
                    "category": art["category"],
                    "published": art["published"],
                    "cluster_size": 1,
                    "sources": [{"name": art["source"], "url": art["url"]}],
                }
            )

    # Sort by multi-source corroboration first, then original feed order
    clusters.sort(key=lambda c: c["cluster_size"], reverse=True)
    for c in clusters:
        c.pop("_norm", None)
    return clusters[:max_items]


GOOGLE_NEWS_FALLBACK_FEEDS: list[dict[str, str]] = [
    {"name": "Google News Top", "category": "World", "url": "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"},
    {"name": "Google News World", "category": "World", "url": "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en"},
    {"name": "Google News Tech", "category": "Tech", "url": "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en"},
]


async def fetch_top_news() -> tuple[list[dict[str, Any]], str]:
    """Fetch and deduplicate top news from configured RSS feeds with Google News fallback."""
    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_SECONDS,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        results = await asyncio.gather(*[_fetch_feed(client, cfg) for cfg in NEWS_FEEDS])
        succeeded = sum(1 for r in results if r)
        all_articles = [item for batch in results for item in batch]

        if succeeded < len(NEWS_FEEDS) // 2:
            print("[news] Primary feeds degraded — supplementing with Google News public RSS.")
            fb_results = await asyncio.gather(
                *[_fetch_feed(client, cfg) for cfg in GOOGLE_NEWS_FALLBACK_FEEDS]
            )
            all_articles.extend(item for batch in fb_results for item in batch)
            succeeded += sum(1 for r in fb_results if r)

    deduped = deduplicate_articles(all_articles)

    if not deduped:
        return [], "failed"
    health = "ok" if succeeded >= len(NEWS_FEEDS) // 2 else "partial"
    return deduped, health
