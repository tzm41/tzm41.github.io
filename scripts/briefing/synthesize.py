"""Gemini 2.5 Flash synthesis engine with Pydantic validation and extractive fallback."""

from __future__ import annotations

import json
import os
import re
import time
from difflib import SequenceMatcher
from typing import Any

from .config import GEMINI_FALLBACK_MODELS, GEMINI_MODEL
from .schema import (
    ConflictTheater,
    ConflictsSection,
    DailyBriefing,
    FearGreedIndex,
    GeminiBriefingSynthesis,
    MarketQuote,
    MarketsSection,
    NewsStory,
    PolicyItem,
    PoliticalTopic,
    PoliticsSection,
    PredictionMarket,
    SectorTile,
    SourceHealth,
    SourceLink,
    TimelineEvent,
)


SYSTEM_INSTRUCTION = """You are a senior intelligence and financial briefing editor.
Your job is to synthesize raw daily news headlines, market data, global conflict signals, and US politics feeds into a concise, neutral, high-signal morning briefing.

Strict rules:
1. Ground every claim strictly in the provided input data. Never invent facts, prices, percentages, or URLs.
2. Only cite URLs that appear verbatim in the input data.
3. Keep summaries crisp, objective, and analytical (avoid sensationalism or partisan framing).
4. When prior-day context is provided, explicitly highlight what changed or escalated/cooled since yesterday.
5. Produce valid JSON matching the requested schema exactly."""


def _build_prompt(
    date_str: str,
    raw_news: list[dict[str, Any]],
    raw_markets: dict[str, Any],
    raw_conflicts: list[dict[str, Any]],
    raw_politics: dict[str, Any],
    prior_briefing: dict[str, Any] | None,
    raw_positive: list[dict[str, Any]] | None = None,
    raw_local: list[dict[str, Any]] | None = None,
) -> str:
    payload = {
        "briefing_date": date_str,
        "prior_day_context": (
            {
                "date": prior_briefing.get("date"),
                "executive_brief": prior_briefing.get("executive_brief", []),
                "conflict_statuses": {
                    t.get("id"): t.get("status")
                    for t in prior_briefing.get("conflicts", {}).get("theaters", [])
                },
            }
            if prior_briefing
            else None
        ),
        "news_candidates": raw_news[:30],
        "market_snapshot": {
            "watchlist": [
                {
                    "symbol": q["symbol"],
                    "name": q["name"],
                    "price": q["price"],
                    "change_pct": q["change_pct"],
                    "change_5d_pct": q["change_5d_pct"],
                }
                for q in raw_markets.get("watchlist", [])
            ],
            "big7": [
                {
                    "symbol": q["symbol"],
                    "name": q["name"],
                    "price": q["price"],
                    "change_pct": q["change_pct"],
                    "change_5d_pct": q["change_5d_pct"],
                }
                for q in raw_markets.get("big7", [])
            ],
            "fear_greed": raw_markets.get("fear_greed"),
            "sectors": raw_markets.get("sectors", []),
        },
        "conflict_theaters": [
            {
                "id": t["id"],
                "name": t["name"],
                "trend_7d": t["trend_7d"],
                "intensity_score": t["intensity_score"],
                "headlines": t["timeline_events"][:5],
            }
            for t in raw_conflicts
        ],
        "us_politics": {
            "prediction_markets": raw_politics.get("prediction_markets", [])[:6],
            "articles": raw_politics.get("articles", [])[:25],
        },
        "positive_news_candidates": (raw_positive or [])[:8],
        "local_news_candidates": raw_local or [],
    }
    return (
        "Synthesize today's Daily News & Trends Briefing from the following verified raw inputs.\n"
        "Return structured JSON only.\n\n"
        + json.dumps(payload, ensure_ascii=False)
    )


def _call_gemini(prompt: str, api_key: str) -> GeminiBriefingSynthesis | None:
    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:
        print(f"[synthesize] google-genai not installed: {exc}")
        return None

    client = genai.Client(api_key=api_key)
    env_model = os.environ.get("GEMINI_MODEL", "").strip()
    candidates = [env_model] if env_model else []
    for m in [GEMINI_MODEL, *GEMINI_FALLBACK_MODELS]:
        if m and m not in candidates:
            candidates.append(m)

    for model_name in candidates:
        for attempt in range(1, 3):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_INSTRUCTION,
                        response_mime_type="application/json",
                        response_schema=GeminiBriefingSynthesis,
                        temperature=0.25,
                    ),
                )
                if response.parsed is not None and isinstance(response.parsed, GeminiBriefingSynthesis):
                    print(f"[synthesize] Synthesized successfully with {model_name}.")
                    return response.parsed
                if response.text:
                    print(f"[synthesize] Synthesized successfully with {model_name}.")
                    return GeminiBriefingSynthesis.model_validate_json(response.text)
            except Exception as exc:
                err_str = str(exc)
                print(f"[synthesize] {model_name} attempt {attempt}/2 failed: {err_str}")
                if "404" in err_str or "NOT_FOUND" in err_str:
                    break  # Skip unavailable model immediately
                if attempt < 2:
                    sleep_s = 12 if "503" in err_str or "UNAVAILABLE" in err_str else 4
                    time.sleep(sleep_s)
    return None


def _build_extractive_fallback(
    date_str: str,
    generated_at: str,
    health: SourceHealth,
    raw_news: list[dict[str, Any]],
    raw_markets: dict[str, Any],
    raw_conflicts: list[dict[str, Any]],
    raw_politics: dict[str, Any],
) -> DailyBriefing:
    """Deterministic fallback when GEMINI_API_KEY is missing or the API fails."""
    stories: list[NewsStory] = []
    for idx, item in enumerate(raw_news[:8], start=1):
        cat = item.get("category", "World")
        if cat not in ("World", "Economy", "Tech", "Policy", "Science"):
            cat = "World"
        stories.append(
            NewsStory(
                id=f"story-{idx}",
                category=cat,
                headline=item["title"],
                summary=item.get("summary") or "Summary unavailable; see linked source reporting.",
                why_it_matters="Auto-aggregated headline (extractive mode — configure GEMINI_API_KEY for full synthesis).",
                sources=[SourceLink(**s) for s in item.get("sources", [])[:3]],
            )
        )

    watchlist = [MarketQuote(**q) for q in raw_markets.get("watchlist", [])]
    sectors = [SectorTile(**s) for s in raw_markets.get("sectors", [])]

    sp500 = next((q for q in watchlist if q.symbol == "^GSPC"), None)
    vix = next((q for q in watchlist if q.symbol == "^VIX"), None)
    if sp500 and sp500.change_pct >= 0.4:
        regime = "Risk-On"
    elif sp500 and sp500.change_pct <= -0.4:
        regime = "Risk-Off"
    elif vix and vix.change_pct >= 8.0:
        regime = "Volatility Spike"
    else:
        regime = "Mixed"

    market_narrative = (
        f"S&P 500 moved {sp500.change_pct:+.2f}% to {sp500.price:,.2f}."
        if sp500
        else "Market quotes were unavailable in this run."
    )

    theaters: list[ConflictTheater] = []
    for t in raw_conflicts:
        events = [TimelineEvent(**e) for e in t.get("timeline_events", [])[:4]]
        status = "escalating" if t.get("trend_7d") == "up" else "elevated"
        summary = (
            events[0].headline
            if events
            else "No major breaking updates captured in the last 24 hours."
        )
        theaters.append(
            ConflictTheater(
                id=t["id"],
                name=t["name"],
                region=t["region"],
                status=status,
                trend_7d=t.get("trend_7d", "flat"),
                intensity_score=t.get("intensity_score", 0.0),
                intensity_series_14d=t.get("intensity_series_14d", []),
                intensity_dates_14d=t.get("intensity_dates_14d", []),
                summary=summary,
                timeline_events=events,
            )
        )

    pred_markets = [
        PredictionMarket(**m) for m in raw_politics.get("prediction_markets", [])[:6]
    ]
    pol_articles = raw_politics.get("articles", [])[:4]
    policy_items = [
        PolicyItem(
            title=a["title"],
            chamber_or_branch="Federal",
            summary=a.get("summary") or a["title"],
            url=a.get("url", ""),
        )
        for a in pol_articles
    ]

    exec_bullets = [s.headline for s in stories[:3]] or [
        f"Daily briefing generated on {date_str} in extractive fallback mode."
    ]

    return DailyBriefing(
        date=date_str,
        generated_at=generated_at,
        synthesis_mode="extractive_fallback",
        source_health=health,
        executive_brief=exec_bullets,
        top_news=stories,
        markets=MarketsSection(
            narrative=market_narrative,
            regime_tag=regime,
            watchlist=watchlist,
            big7=[MarketQuote(**q) for q in raw_markets.get("big7", [])],
            fear_greed=FearGreedIndex(**raw_markets["fear_greed"]) if raw_markets.get("fear_greed") else None,
            sectors=sectors,
        ),
        conflicts=ConflictsSection(
            overview="Automated conflict tracker metrics updated from GDELT and global news feeds.",
            theaters=theaters,
        ),
        us_politics=PoliticsSection(
            pulse_summary="Latest US political headlines and prediction market probabilities.",
            prediction_markets=pred_markets,
            legislative_and_executive=policy_items,
            trending_topics=[
                PoliticalTopic(
                    topic="Washington Headlines",
                    momentum="steady",
                    framing_note="Enable GEMINI_API_KEY in GitHub Secrets for AI framing analysis.",
                )
            ],
        ),
    )


_WORD_RE = re.compile(r"[a-z0-9]{4,}")
_STOPWORDS = frozenset({
    "about", "after", "again", "against", "amid", "because", "before", "being",
    "between", "could", "first", "from", "have", "into", "more", "most", "over",
    "said", "says", "since", "some", "still", "than", "that", "their", "them",
    "then", "there", "these", "they", "this", "through", "today", "under",
    "very", "were", "what", "when", "where", "which", "while", "will", "with",
    "would", "year", "years",
})


def _content_tokens(text: str) -> set[str]:
    return {w for w in _WORD_RE.findall((text or "").lower()) if w not in _STOPWORDS}


def _is_similar_story(story: NewsStory, prior_items: list[dict[str, Any]]) -> bool:
    """Return True if story is substantially similar to any story from the prior day."""
    h_cur = (story.headline or "").lower().strip()
    t_head_cur = _content_tokens(story.headline)
    t_full_cur = _content_tokens(f"{story.headline} {story.summary}")
    if not t_head_cur:
        return False

    for prev in prior_items:
        h_prev = (prev.get("headline") or "").lower().strip()
        if h_cur and h_prev:
            m = SequenceMatcher(None, h_cur, h_prev)
            if m.quick_ratio() >= 0.58 and m.ratio() >= 0.58:
                return True
        t_head_prev = _content_tokens(prev.get("headline", ""))
        if t_head_prev:
            union_h = len(t_head_cur | t_head_prev)
            if union_h and len(t_head_cur & t_head_prev) / union_h >= 0.42:
                return True
        t_full_prev = _content_tokens(f"{prev.get('headline', '')} {prev.get('summary', '')}")
        if t_full_prev:
            union_f = len(t_full_cur | t_full_prev)
            if union_f and len(t_full_cur & t_full_prev) / union_f >= 0.35:
                return True
    return False


def _flag_continued_stories(
    stories: list[NewsStory],
    prior_stories: list[dict[str, Any]],
) -> list[NewsStory]:
    if not prior_stories:
        return stories
    return [
        s.model_copy(update={"continued_from_prior": True})
        if not s.continued_from_prior and _is_similar_story(s, prior_stories)
        else s
        for s in stories
    ]


def merge_synthesis(
    ai: GeminiBriefingSynthesis,
    date_str: str,
    generated_at: str,
    health: SourceHealth,
    raw_markets: dict[str, Any],
    raw_conflicts: list[dict[str, Any]],
    raw_politics: dict[str, Any],
    prior_briefing: dict[str, Any] | None = None,
) -> DailyBriefing:
    """Merge validated AI synthesis with deterministic numeric market, conflict, and politics data."""
    ai_theater_map = {t.id: t for t in ai.conflict_theaters}
    merged_theaters: list[ConflictTheater] = []
    for raw_t in raw_conflicts:
        ai_t = ai_theater_map.get(raw_t["id"])
        merged_theaters.append(
            ConflictTheater(
                id=raw_t["id"],
                name=raw_t["name"],
                region=raw_t["region"],
                status=ai_t.status if ai_t else "elevated",
                trend_7d=ai_t.trend_7d if ai_t else raw_t.get("trend_7d", "flat"),
                intensity_score=raw_t.get("intensity_score", 0.0),
                intensity_series_14d=raw_t.get("intensity_series_14d", []),
                intensity_dates_14d=raw_t.get("intensity_dates_14d", []),
                summary=(
                    ai_t.summary
                    if ai_t
                    else "Monitoring ongoing developments across the region."
                ),
                timeline_events=[
                    TimelineEvent(**e) for e in raw_t.get("timeline_events", [])[:4]
                ],
            )
        )

    prior_top = (prior_briefing or {}).get("top_news", [])
    prior_local_by_id = {
        r.get("id"): r.get("stories", [])
        for r in (prior_briefing or {}).get("local_news", [])
        if r.get("id")
    }
    flagged_top = _flag_continued_stories(ai.top_news, prior_top)
    flagged_local = [
        region.model_copy(
            update={"stories": _flag_continued_stories(region.stories, prior_local_by_id.get(region.id, []))}
        )
        for region in ai.local_news
    ]

    return DailyBriefing(
        date=date_str,
        generated_at=generated_at,
        synthesis_mode="gemini",
        source_health=health,
        executive_brief=ai.executive_brief,
        top_news=flagged_top,
        markets=MarketsSection(
            narrative=ai.market_narrative,
            regime_tag=ai.market_regime,
            watchlist=[MarketQuote(**q) for q in raw_markets.get("watchlist", [])],
            big7=[MarketQuote(**q) for q in raw_markets.get("big7", [])],
            fear_greed=FearGreedIndex(**raw_markets["fear_greed"]) if raw_markets.get("fear_greed") else None,
            sectors=[SectorTile(**s) for s in raw_markets.get("sectors", [])],
        ),
        conflicts=ConflictsSection(
            overview=ai.conflicts_overview,
            theaters=merged_theaters,
        ),
        us_politics=PoliticsSection(
            pulse_summary=ai.politics_pulse_summary,
            prediction_markets=[
                PredictionMarket(**m)
                for m in raw_politics.get("prediction_markets", [])[:6]
            ],
            legislative_and_executive=ai.legislative_and_executive,
            trending_topics=ai.trending_topics,
        ),
        positive_news=ai.positive_news,
        local_news=flagged_local,
    )


def synthesize_briefing(
    date_str: str,
    generated_at: str,
    health: SourceHealth,
    raw_news: list[dict[str, Any]],
    raw_markets: dict[str, Any],
    raw_conflicts: list[dict[str, Any]],
    raw_politics: dict[str, Any],
    prior_briefing: dict[str, Any] | None = None,
    raw_positive: list[dict[str, Any]] | None = None,
    raw_local: list[dict[str, Any]] | None = None,
) -> DailyBriefing:
    """Synthesize a validated DailyBriefing using Gemini or extractive fallback."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        print("[synthesize] GEMINI_API_KEY not set — using extractive fallback.")
        return _build_extractive_fallback(
            date_str, generated_at, health, raw_news, raw_markets, raw_conflicts, raw_politics
        )

    prompt = _build_prompt(
        date_str, raw_news, raw_markets, raw_conflicts, raw_politics, prior_briefing, raw_positive, raw_local
    )
    ai = _call_gemini(prompt, api_key)
    if ai is None:
        print("[synthesize] Falling back to extractive briefing.")
        return _build_extractive_fallback(
            date_str, generated_at, health, raw_news, raw_markets, raw_conflicts, raw_politics
        )

    return merge_synthesis(
        ai=ai,
        date_str=date_str,
        generated_at=generated_at,
        health=health,
        raw_markets=raw_markets,
        raw_conflicts=raw_conflicts,
        raw_politics=raw_politics,
        prior_briefing=prior_briefing,
    )
