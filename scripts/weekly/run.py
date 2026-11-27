"""Main orchestrator for the Weekly Briefing pipeline."""

from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .config import ARCHIVE_DIR, DATA_DIR, INDEX_PATH, LATEST_PATH, MAX_ARCHIVE_WEEKS
from .fetchers import (
    fetch_all_weekly_sources,
    load_recent_daily_pulse,
    load_recent_weekly_headlines,
)
from .schema import WeeklyBriefing, WeeklySourceHealth, WeeklySynthesis


def _format_week_label(target_date: str) -> str:
    """Format a human-readable 7-day range like 'Nov 20 – Nov 26, 2026'."""
    end_dt = datetime.strptime(target_date, "%Y-%m-%d")
    start_dt = end_dt - timedelta(days=6)
    if start_dt.year != end_dt.year:
        return f"{start_dt.strftime('%b %-d, %Y')} – {end_dt.strftime('%b %-d, %Y')}"
    if start_dt.month == end_dt.month:
        return f"{start_dt.strftime('%b %-d')} – {end_dt.strftime('%-d, %Y')}"
    return f"{start_dt.strftime('%b %-d')} – {end_dt.strftime('%b %-d, %Y')}"


def _prune_archive() -> None:
    if not ARCHIVE_DIR.exists():
        return
    files = sorted(ARCHIVE_DIR.glob("*.json"), reverse=True)
    for stale in files[MAX_ARCHIVE_WEEKS:]:
        try:
            stale.unlink()
        except OSError:
            pass


def rebuild_index() -> dict[str, Any]:
    """Rebuild weekly/data/index.json from the archive directory."""
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    archive_files = sorted(ARCHIVE_DIR.glob("*.json"), reverse=True)
    dates = [p.stem for p in archive_files]

    editions: list[dict[str, Any]] = []
    for path in archive_files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            editions.append(
                {
                    "date": data.get("date", path.stem),
                    "week_label": data.get("week_label", _format_week_label(path.stem)),
                    "theme_title": data.get("theme_title", ""),
                }
            )
        except Exception:
            continue

    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "latest_date": dates[0] if dates else None,
        "dates": dates,
        "editions": editions,
    }
    INDEX_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return payload


def _write_weekly_files(briefing: WeeklyBriefing) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)

    serialized = briefing.model_dump_json(indent=2) + "\n"
    archive_file = ARCHIVE_DIR / f"{briefing.date}.json"
    archive_file.write_text(serialized, encoding="utf-8")
    LATEST_PATH.write_text(serialized, encoding="utf-8")

    _prune_archive()
    rebuild_index()
    rel = archive_file.relative_to(Path.cwd()) if archive_file.is_relative_to(Path.cwd()) else archive_file
    print(f"[weekly] Wrote {rel}")
    return archive_file


def _build_synthesis_instructions(target_date: str, week_label: str) -> str:
    return (
        f"You are editing the Sunday Weekly Briefing for {week_label} (edition date {target_date}). "
        "Unlike the Daily Briefing, this publication prioritizes enduring intellectual curiosity: "
        "scientific breakthroughs, mathematical & natural discoveries, visual arts, architecture, literature, "
        "music, cultural essays, archaeology, and deep historical context. Keep stocks, geopolitics, and "
        "partisan politics minimal and confined strictly to the compact optional 'week_in_brief' section (3-4 bullets).\n\n"
        "Editorial rules:\n"
        "1. Ground EVERY item in science, culture, history, and long_reads strictly in the fetched articles in this bundle. "
        "Copy source URLs verbatim—never fabricate URLs or sources.\n"
        "2. Avoid repeating any headline listed in recently_shown_weekly_headlines.\n"
        "3. Use **double asterisks** around the single most illuminating takeaway/finding in each bullet or summary, "
        "and *single asterisks* around human names (scientists, artists, historians, authors, leaders) so the UI renders them cleanly.\n"
        "4. Populate 'this_week_in_history' with 4 genuine, well-verified historical, scientific, or artistic anniversaries "
        f"that occurred during the calendar dates covered by {week_label}.\n"
        "5. Populate 'around_the_world' with 6 surprising, verified geological fun facts distributed across different continents "
        "(North America, South America, Europe, Africa, Asia, Oceania) with accurate decimal lat/lon coordinates, ISO 2-letter "
        "country_code, wiki_title, and no places listed in recently_shown_weekly_headlines.\n"
        "6. Populate 'featured_quote' with a real, accurately attributed quote from a scientist, artist, historian, or writer "
        "that resonates with this week's theme_title.\n"
        "7. Output raw JSON conforming strictly to synthesis_schema."
    )


async def fetch_only(out_path_str: str, date_str: str | None = None) -> None:
    now_utc = datetime.now(timezone.utc)
    target_date = date_str or now_utc.strftime("%Y-%m-%d")
    generated_at = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    week_label = _format_week_label(target_date)

    print(f"[weekly] Fetching Weekly Briefing sources for {target_date} ({week_label})...")
    fetched = await fetch_all_weekly_sources()
    daily_pulse = load_recent_daily_pulse(target_date, days=7)
    recent_weekly = load_recent_weekly_headlines(target_date, max_weeks=4)

    health = fetched["source_health"]
    print(
        f"[weekly] Fetch complete — science={len(fetched['science'])} ({health['science']}), "
        f"culture={len(fetched['culture'])} ({health['culture']}), "
        f"history={len(fetched['history'])} ({health['history']}), "
        f"long_reads={len(fetched['long_reads'])} ({health['long_reads']}), "
        f"daily_pulse_days={len(daily_pulse)}"
    )

    bundle = {
        "date": target_date,
        "week_label": week_label,
        "generated_at": generated_at,
        "source_health": health,
        "raw_science": fetched["science"],
        "raw_culture": fetched["culture"],
        "raw_history": fetched["history"],
        "raw_long_reads": fetched["long_reads"],
        "daily_pulse_7d": daily_pulse,
        "recently_shown_weekly_headlines": recent_weekly,
        "instructions": _build_synthesis_instructions(target_date, week_label),
        "synthesis_schema": WeeklySynthesis.model_json_schema(),
    }

    out_path = Path(out_path_str)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")
    print(f"[weekly] Wrote raw bundle to {out_path}")


def apply_synthesis(raw_path_str: str, synthesis_path_str: str, dry_run: bool = False) -> WeeklyBriefing:
    raw_bundle = json.loads(Path(raw_path_str).read_text(encoding="utf-8"))
    synth_raw = json.loads(Path(synthesis_path_str).read_text(encoding="utf-8"))
    synthesis = WeeklySynthesis.model_validate(synth_raw)

    health = WeeklySourceHealth.model_validate(raw_bundle.get("source_health", {}))
    briefing = WeeklyBriefing(
        date=raw_bundle["date"],
        week_label=raw_bundle.get("week_label") or _format_week_label(raw_bundle["date"]),
        generated_at=raw_bundle["generated_at"],
        theme_title=synthesis.theme_title,
        digest=synthesis.digest,
        featured_quote=synthesis.featured_quote,
        science=synthesis.science,
        culture=synthesis.culture,
        history=synthesis.history,
        this_week_in_history=synthesis.this_week_in_history,
        around_the_world=synthesis.around_the_world,
        long_reads=synthesis.long_reads,
        week_in_brief=synthesis.week_in_brief,
        source_health=health,
    )

    if dry_run:
        print(briefing.model_dump_json(indent=2))
    else:
        _write_weekly_files(briefing)
    return briefing


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the Weekly Briefing JSON artifacts.")
    parser.add_argument("--date", help="Override edition date (YYYY-MM-DD, defaults to UTC today)")
    parser.add_argument("--dry-run", action="store_true", help="Print JSON output without writing files")
    parser.add_argument("--rebuild-index", action="store_true", help="Only rebuild weekly/data/index.json")
    parser.add_argument(
        "--fetch-only",
        metavar="RAW_JSON_PATH",
        help="Fetch live cultural/scientific/historical feeds and write raw bundle to RAW_JSON_PATH.",
    )
    parser.add_argument(
        "--apply-synthesis",
        nargs=2,
        metavar=("RAW_JSON_PATH", "SYNTHESIS_JSON_PATH"),
        help="Validate WeeklySynthesis JSON and write weekly/data/latest.json + archive + index.",
    )
    args = parser.parse_args()

    if args.rebuild_index:
        idx = rebuild_index()
        print(f"[weekly] Rebuilt index with {len(idx['dates'])} editions.")
        return

    if args.fetch_only:
        asyncio.run(fetch_only(args.fetch_only, date_str=args.date))
        return

    if args.apply_synthesis:
        apply_synthesis(args.apply_synthesis[0], args.apply_synthesis[1], dry_run=args.dry_run)
        return

    parser.error("Specify --fetch-only, --apply-synthesis, or --rebuild-index.")


if __name__ == "__main__":
    main()
