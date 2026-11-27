"""Idempotent backfill CLI adding stable card IDs and archive_ttl_days metadata."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from scripts.briefing.config import (
    ARCHIVE_DIR as BRIEFING_ARCHIVE_DIR,
    INDEX_PATH as BRIEFING_INDEX_PATH,
    LATEST_PATH as BRIEFING_LATEST_PATH,
    MAX_ARCHIVE_DAYS,
)
from scripts.briefing.run import rebuild_index as rebuild_briefing_index
from scripts.briefing.schema import DailyBriefing
from scripts.weekly.config import (
    ARCHIVE_DIR as WEEKLY_ARCHIVE_DIR,
    INDEX_PATH as WEEKLY_INDEX_PATH,
    LATEST_PATH as WEEKLY_LATEST_PATH,
    MAX_ARCHIVE_WEEKS,
)
from scripts.weekly.run import rebuild_index as rebuild_weekly_index
from scripts.weekly.schema import WeeklyBriefing


def _backfill_daily_file(path: Path, dry_run: bool = False) -> bool:
    raw_text = path.read_text(encoding="utf-8")
    data: dict[str, Any] = json.loads(raw_text)
    data["schema_version"] = "1.1"
    data["archive_ttl_days"] = MAX_ARCHIVE_DAYS
    model = DailyBriefing.model_validate(data)
    updated_text = model.model_dump_json(indent=2) + "\n"
    if updated_text == raw_text:
        return False
    if not dry_run:
        path.write_text(updated_text, encoding="utf-8")
    return True


def _backfill_weekly_file(path: Path, dry_run: bool = False) -> bool:
    raw_text = path.read_text(encoding="utf-8")
    data: dict[str, Any] = json.loads(raw_text)
    data["schema_version"] = "1.1"
    data["archive_ttl_days"] = MAX_ARCHIVE_WEEKS * 7
    model = WeeklyBriefing.model_validate(data)
    updated_text = model.model_dump_json(indent=2) + "\n"
    if updated_text == raw_text:
        return False
    if not dry_run:
        path.write_text(updated_text, encoding="utf-8")
    return True


def _index_needs_update(index_path: Path, expected_fields: dict[str, Any], archive_dir: Path) -> bool:
    if not index_path.exists():
        return True
    try:
        current = json.loads(index_path.read_text(encoding="utf-8"))
    except Exception:
        return True
    for k, v in expected_fields.items():
        if current.get(k) != v:
            return True
    expected_dates = [p.stem for p in sorted(archive_dir.glob("*.json"), reverse=True)]
    return current.get("dates") != expected_dates


def run_backfill(dry_run: bool = False) -> dict[str, int]:
    stats = {
        "daily_checked": 0,
        "daily_updated": 0,
        "weekly_checked": 0,
        "weekly_updated": 0,
        "indexes_updated": 0,
    }

    # Daily briefing archives + latest.json
    daily_targets: list[Path] = []
    if BRIEFING_ARCHIVE_DIR.exists():
        daily_targets.extend(sorted(BRIEFING_ARCHIVE_DIR.glob("*.json")))
    if BRIEFING_LATEST_PATH.exists():
        daily_targets.append(BRIEFING_LATEST_PATH)

    for path in daily_targets:
        stats["daily_checked"] += 1
        if _backfill_daily_file(path, dry_run=dry_run):
            stats["daily_updated"] += 1
            print(f"[backfill] {'Would update' if dry_run else 'Updated'} {path}")

    if stats["daily_updated"] > 0 or _index_needs_update(
        BRIEFING_INDEX_PATH,
        {"archive_ttl_days": MAX_ARCHIVE_DAYS},
        BRIEFING_ARCHIVE_DIR,
    ):
        stats["indexes_updated"] += 1
        if not dry_run:
            rebuild_briefing_index()
        print(f"[backfill] {'Would rebuild' if dry_run else 'Rebuilt'} {BRIEFING_INDEX_PATH}")

    # Weekly briefing archives + latest.json
    weekly_targets: list[Path] = []
    if WEEKLY_ARCHIVE_DIR.exists():
        weekly_targets.extend(sorted(WEEKLY_ARCHIVE_DIR.glob("*.json")))
    if WEEKLY_LATEST_PATH.exists():
        weekly_targets.append(WEEKLY_LATEST_PATH)

    for path in weekly_targets:
        stats["weekly_checked"] += 1
        if _backfill_weekly_file(path, dry_run=dry_run):
            stats["weekly_updated"] += 1
            print(f"[backfill] {'Would update' if dry_run else 'Updated'} {path}")

    if stats["weekly_updated"] > 0 or _index_needs_update(
        WEEKLY_INDEX_PATH,
        {"archive_ttl_days": MAX_ARCHIVE_WEEKS * 7, "max_archive_weeks": MAX_ARCHIVE_WEEKS},
        WEEKLY_ARCHIVE_DIR,
    ):
        stats["indexes_updated"] += 1
        if not dry_run:
            rebuild_weekly_index()
        print(f"[backfill] {'Would rebuild' if dry_run else 'Rebuilt'} {WEEKLY_INDEX_PATH}")

    return stats


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Idempotently backfill stable card IDs and archive_ttl_days across daily and weekly archives."
    )
    parser.add_argument("--dry-run", action="store_true", help="Report files that would change without modifying disk.")
    args = parser.parse_args()
    stats = run_backfill(dry_run=args.dry_run)
    print(
        f"[backfill] Done — daily={stats['daily_updated']}/{stats['daily_checked']} updated, "
        f"weekly={stats['weekly_updated']}/{stats['weekly_checked']} updated, "
        f"indexes={stats['indexes_updated']} rebuilt."
    )


if __name__ == "__main__":
    main()
