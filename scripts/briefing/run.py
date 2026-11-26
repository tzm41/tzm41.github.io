"""Main orchestrator for the Daily News & Trends Briefing pipeline."""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import (
    ARCHIVE_DIR,
    DATA_DIR,
    INDEX_HISTORY_DAYS,
    INDEX_PATH,
    LATEST_PATH,
    MARKETS_LIVE_PATH,
    MAX_ARCHIVE_DAYS,
)
from .fetchers.conflicts import fetch_conflicts
from .fetchers.markets import fetch_markets
from .fetchers.news import fetch_local_news, fetch_positive_news, fetch_top_news
from .fetchers.politics import fetch_politics
from .schema import (
    AfternoonBrief,
    AfternoonSynthesis,
    DailyBriefing,
    GeminiBriefingSynthesis,
    SourceHealth,
)
from .synthesize import _build_prompt, merge_synthesis, synthesize_briefing


def _write_briefing_files(briefing: DailyBriefing) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

    serialized = briefing.model_dump_json(indent=2) + "\n"
    archive_file = ARCHIVE_DIR / f"{briefing.date}.json"
    archive_file.write_text(serialized, encoding="utf-8")
    LATEST_PATH.write_text(serialized, encoding="utf-8")

    _prune_archive()
    rebuild_index()
    print(f"[run] Wrote {archive_file.relative_to(Path.cwd()) if archive_file.is_relative_to(Path.cwd()) else archive_file}")
    return archive_file


def _load_prior_briefing(current_date: str) -> dict[str, Any] | None:
    if not ARCHIVE_DIR.exists():
        return None
    candidates = sorted(
        (p for p in ARCHIVE_DIR.glob("*.json") if p.stem < current_date),
        reverse=True,
    )
    if not candidates:
        return None
    try:
        return json.loads(candidates[0].read_text(encoding="utf-8"))
    except Exception:
        return None


def _prune_archive() -> None:
    if not ARCHIVE_DIR.exists():
        return
    files = sorted(ARCHIVE_DIR.glob("*.json"), reverse=True)
    for stale in files[MAX_ARCHIVE_DAYS:]:
        try:
            stale.unlink()
        except OSError:
            pass


def _extract_kpi_row(briefing: dict[str, Any]) -> dict[str, Any]:
    watchlist = briefing.get("markets", {}).get("watchlist", [])
    by_sym = {q.get("symbol"): q for q in watchlist}
    theaters = briefing.get("conflicts", {}).get("theaters", [])
    top_theater = max(theaters, key=lambda t: t.get("intensity_score", 0.0)) if theaters else None

    return {
        "date": briefing.get("date"),
        "regime": briefing.get("markets", {}).get("regime_tag", "Mixed"),
        "sp500_price": by_sym.get("^GSPC", {}).get("price"),
        "sp500_pct": by_sym.get("^GSPC", {}).get("change_pct"),
        "vix": by_sym.get("^VIX", {}).get("price"),
        "us10y": by_sym.get("^TNX", {}).get("price"),
        "top_theater": top_theater.get("name") if top_theater else None,
        "conflict_index": round(sum(t.get("intensity_score", 0.0) for t in theaters), 1),
    }


def rebuild_index() -> dict[str, Any]:
    """Rebuild briefing/data/index.json from the archive directory."""
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    archive_files = sorted(ARCHIVE_DIR.glob("*.json"), reverse=True)
    dates = [p.stem for p in archive_files]

    history: list[dict[str, Any]] = []
    for path in reversed(archive_files[:INDEX_HISTORY_DAYS]):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            history.append(_extract_kpi_row(data))
        except Exception:
            continue

    index_payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latest_date": dates[0] if dates else None,
        "dates": dates,
        "kpi_history_30d": history,
    }
    INDEX_PATH.write_text(json.dumps(index_payload, indent=2) + "\n", encoding="utf-8")
    return index_payload


async def run_pipeline(
    date_str: str | None = None,
    dry_run: bool = False,
    fetch_only_path: str | None = None,
) -> DailyBriefing | None:
    now_utc = datetime.now(timezone.utc)
    target_date = date_str or now_utc.strftime("%Y-%m-%d")
    generated_at = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"[run] Starting Daily Briefing pipeline for {target_date}...")
    prior = _load_prior_briefing(target_date)
    same_day_path = ARCHIVE_DIR / f"{target_date}.json"
    same_day: dict[str, Any] | None = None
    if same_day_path.exists():
        try:
            same_day = json.loads(same_day_path.read_text(encoding="utf-8"))
        except Exception:
            same_day = None

    prior_markets = (same_day or prior or {}).get("markets")
    prior_conflicts = prior.get("conflicts") if prior else None
    same_day_conflicts = same_day.get("conflicts") if same_day else None

    (raw_news, news_h), (raw_markets, mkt_h), (raw_conflicts, conf_h), (raw_politics, pol_h), raw_positive, raw_local = (
        await asyncio.gather(
            fetch_top_news(),
            fetch_markets(prior_markets=prior_markets),
            fetch_conflicts(
                prior_conflicts=prior_conflicts,
                same_day_conflicts=same_day_conflicts,
            ),
            fetch_politics(),
            fetch_positive_news(),
            fetch_local_news(),
        )
    )

    health = SourceHealth(
        news=news_h,  # type: ignore[arg-type]
        markets=mkt_h,  # type: ignore[arg-type]
        conflicts=conf_h,  # type: ignore[arg-type]
        politics=pol_h,  # type: ignore[arg-type]
    )
    print(
        f"[run] Fetch complete — news={len(raw_news)} ({health.news}), "
        f"markets={len(raw_markets.get('watchlist', []))}/{len(raw_markets.get('sectors', []))} ({health.markets}), "
        f"conflicts={len(raw_conflicts)} ({health.conflicts}), "
        f"politics={len(raw_politics.get('prediction_markets', []))} mkts / {len(raw_politics.get('articles', []))} arts ({health.politics})"
    )

    if fetch_only_path:
        out_path = Path(fetch_only_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        bundle = {
            "date": target_date,
            "generated_at": generated_at,
            "source_health": health.model_dump(),
            "raw_news": raw_news,
            "raw_markets": raw_markets,
            "raw_conflicts": raw_conflicts,
            "raw_politics": raw_politics,
            "raw_positive": raw_positive,
            "raw_local": raw_local,
            "prompt": _build_prompt(
                target_date, raw_news, raw_markets, raw_conflicts, raw_politics, prior, raw_positive, raw_local
            ),
            "synthesis_schema": GeminiBriefingSynthesis.model_json_schema(),
        }
        out_path.write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")
        print(f"[run] Wrote raw fetch bundle to {out_path}")
        return None

    briefing = synthesize_briefing(
        date_str=target_date,
        generated_at=generated_at,
        health=health,
        raw_news=raw_news,
        raw_markets=raw_markets,
        raw_conflicts=raw_conflicts,
        raw_politics=raw_politics,
        prior_briefing=prior,
        raw_positive=raw_positive,
        raw_local=raw_local,
    )

    if dry_run:
        print("[run] Dry run enabled — skipping disk writes.")
        return briefing

    _write_briefing_files(briefing)
    return briefing


def apply_external_synthesis(raw_bundle_path: str, synthesis_json_path: str) -> DailyBriefing:
    """Validate an externally generated GeminiBriefingSynthesis JSON and publish briefing files."""
    bundle = json.loads(Path(raw_bundle_path).read_text(encoding="utf-8"))
    raw_text = Path(synthesis_json_path).read_text(encoding="utf-8").strip()
    # Strip optional markdown code fences if produced by a CLI or agent
    if raw_text.startswith("```"):
        lines = raw_text.splitlines()
        raw_text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:]).strip()

    ai = GeminiBriefingSynthesis.model_validate_json(raw_text)
    prior = _load_prior_briefing(bundle["date"])
    briefing = merge_synthesis(
        ai=ai,
        date_str=bundle["date"],
        generated_at=bundle["generated_at"],
        health=SourceHealth(**bundle["source_health"]),
        raw_markets=bundle["raw_markets"],
        raw_conflicts=bundle["raw_conflicts"],
        raw_politics=bundle["raw_politics"],
        prior_briefing=prior,
    )
    _write_briefing_files(briefing)
    return briefing


async def run_markets_only() -> dict[str, Any]:
    """Fetch only live market data (watchlist, Big 7, sectors, Fear & Greed) and write markets_live.json."""
    prior_markets: dict[str, Any] | None = None
    for path in (MARKETS_LIVE_PATH, LATEST_PATH):
        if path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                prior_markets = loaded.get("markets") if "markets" in loaded else loaded
                break
            except Exception:
                continue

    raw_markets, health = await fetch_markets(prior_markets=prior_markets)
    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "health": health,
        "watchlist": raw_markets.get("watchlist", []),
        "big7": raw_markets.get("big7", []),
        "fear_greed": raw_markets.get("fear_greed"),
        "sectors": raw_markets.get("sectors", []),
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MARKETS_LIVE_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(
        f"[run] Wrote {MARKETS_LIVE_PATH.relative_to(Path.cwd()) if MARKETS_LIVE_PATH.is_relative_to(Path.cwd()) else MARKETS_LIVE_PATH} "
        f"(health={health}, watchlist={len(payload['watchlist'])}, big7={len(payload['big7'])}, sectors={len(payload['sectors'])})"
    )
    return payload


async def fetch_afternoon_bundle(out_path_str: str) -> None:
    """Fetch fresh afternoon news & market close data alongside today's morning executive brief."""
    morning = json.loads(LATEST_PATH.read_text(encoding="utf-8")) if LATEST_PATH.exists() else {}
    prior_markets = morning.get("markets")
    (raw_news, _), (raw_markets, _), (raw_politics, _) = await asyncio.gather(
        fetch_top_news(),
        fetch_markets(prior_markets=prior_markets),
        fetch_politics(),
    )
    bundle = {
        "date": morning.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "morning_executive_brief": morning.get("executive_brief", []),
        "morning_top_news": [
            {"id": s.get("id"), "headline": s.get("headline")}
            for s in morning.get("top_news", [])
        ],
        "raw_news": raw_news[:25],
        "market_snapshot": {
            "watchlist": [
                {k: q[k] for k in ("symbol", "name", "price", "change_pct", "change_5d_pct") if k in q}
                for q in raw_markets.get("watchlist", [])
            ],
            "big7": [
                {k: q[k] for k in ("symbol", "name", "price", "change_pct", "change_5d_pct") if k in q}
                for q in raw_markets.get("big7", [])
            ],
            "fear_greed": raw_markets.get("fear_greed"),
            "sectors": raw_markets.get("sectors", []),
        },
        "raw_politics_articles": raw_politics.get("articles", [])[:15],
        "synthesis_schema": AfternoonSynthesis.model_json_schema(),
    }
    out_path = Path(out_path_str)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[run] Wrote afternoon fetch bundle to {out_path}")


def apply_afternoon_synthesis(synthesis_json_path: str) -> DailyBriefing:
    """Validate AfternoonSynthesis JSON and attach afternoon_brief to today's latest briefing."""
    raw_text = Path(synthesis_json_path).read_text(encoding="utf-8").strip()
    if raw_text.startswith("```"):
        lines = raw_text.splitlines()
        raw_text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:]).strip()

    ai = AfternoonSynthesis.model_validate_json(raw_text)
    data = json.loads(LATEST_PATH.read_text(encoding="utf-8"))
    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data["afternoon_brief"] = AfternoonBrief(generated_at=now_utc, bullets=ai.bullets).model_dump()

    if ai.new_top_news:
        existing_morning = [
            s for s in data.get("top_news", []) if not s.get("is_afternoon")
        ]
        seen_ids = {s.get("id") for s in existing_morning if s.get("id")}
        seen_headlines = {
            str(s.get("headline", "")).strip().lower() for s in existing_morning
        }
        added: list[dict[str, Any]] = []
        for story in ai.new_top_news:
            hl = story.headline.strip().lower()
            if story.id in seen_ids or hl in seen_headlines:
                continue
            seen_ids.add(story.id)
            seen_headlines.add(hl)
            dumped = story.model_dump()
            dumped["is_afternoon"] = True
            added.append(dumped)
        if added:
            data["top_news"] = added + existing_morning

    briefing = DailyBriefing.model_validate(data)
    _write_briefing_files(briefing)
    return briefing


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the daily news & trends briefing.")
    parser.add_argument("--date", help="Override briefing date (YYYY-MM-DD)", default=None)
    parser.add_argument("--dry-run", action="store_true", help="Fetch and synthesize without writing files")
    parser.add_argument(
        "--markets-only",
        action="store_true",
        help="Fetch only stock market data and write briefing/data/markets_live.json",
    )
    parser.add_argument(
        "--afternoon-fetch",
        metavar="RAW_JSON",
        help="Fetch afternoon news & market close data for Afternoon Synthesis",
    )
    parser.add_argument(
        "--apply-afternoon",
        metavar="SYNTHESIS_JSON",
        help="Validate AfternoonSynthesis JSON and update afternoon_brief in latest.json",
    )
    parser.add_argument(
        "--fetch-only",
        metavar="RAW_JSON",
        help="Fetch all sources and write raw bundle + prompt to RAW_JSON without calling Gemini API",
    )
    parser.add_argument(
        "--apply-synthesis",
        nargs=2,
        metavar=("RAW_JSON", "SYNTHESIS_JSON"),
        help="Validate SYNTHESIS_JSON against schema, merge with RAW_JSON, and write briefing/data/",
    )
    args = parser.parse_args()

    if args.markets_only:
        asyncio.run(run_markets_only())
        return

    if args.afternoon_fetch:
        asyncio.run(fetch_afternoon_bundle(args.afternoon_fetch))
        return

    if args.apply_afternoon:
        apply_afternoon_synthesis(args.apply_afternoon)
        return

    if args.apply_synthesis:
        apply_external_synthesis(args.apply_synthesis[0], args.apply_synthesis[1])
        return

    asyncio.run(
        run_pipeline(
            date_str=args.date,
            dry_run=args.dry_run,
            fetch_only_path=args.fetch_only,
        )
    )


if __name__ == "__main__":
    main()
