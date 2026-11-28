"""Single-file shared entity store (`shared/data/entities.json`).

Holds companies (logos, facts, tickers), market indices, known people and US party
aliases. Every page loads the whole file (~11 KB gzipped), so editions never need
to declare which entities they use and older editions always render with the
latest data.

Also normalizes per-edition LLM-provided `entities[]` identities for `*italic*`
mentions and reports gaps (see `normalize_edition_entities`).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
ENTITIES_PATH = REPO_ROOT / "shared" / "data" / "entities.json"

DAILY_DATA_DIR = REPO_ROOT / "briefing" / "data"
DAILY_ARCHIVE_DIR = DAILY_DATA_DIR / "archive"
DAILY_LATEST_PATH = DAILY_DATA_DIR / "latest.json"
WEEKLY_DATA_DIR = REPO_ROOT / "weekly" / "data"
WEEKLY_ARCHIVE_DIR = WEEKLY_DATA_DIR / "archive"
WEEKLY_LATEST_PATH = WEEKLY_DATA_DIR / "latest.json"

SCHEMA_VERSION = "4.0"

_URL_PREFIX_RE = re.compile(r"^https?://", re.IGNORECASE)

# Non-prose metadata / structural keys skipped when scanning editions for entities
_SKIP_PROSE_KEYS: frozenset[str] = frozenset(
    {
        "schema_version",
        "archive_ttl_days",
        "date",
        "generated_at",
        "updated_at",
        "synthesis_mode",
        "source_health",
        "entity_shards",
        "id",
        "url",
        "sources",
        "source",
        "country_code",
        "wiki_title",
        "symbol",
        "group",
        "currency",
        "sparkline_1d",
        "sparkline_1d_times",
        "sparkline_5d",
        "sparkline_5d_times",
        "sparkline_30d",
        "sparkline_30d_times",
        "intensity_series_14d",
        "intensity_dates_14d",
        "sentiment",
        "status",
        "trend_7d",
        "momentum",
        "regime_tag",
        "rating",
        "continued_from_prior",
        "is_afternoon",
        "category",
        "kind",
        "lat",
        "lon",
        "reading_time",
        "week_label",
    }
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw_bytes = (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
        ) as tmp:
            tmp_name = tmp.name
            tmp.write(raw_bytes)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.chmod(tmp_name, 0o644)
        os.replace(tmp_name, path)
        tmp_name = None
    finally:
        if tmp_name and os.path.exists(tmp_name):
            os.unlink(tmp_name)
    return len(raw_bytes)


def load_all_entities() -> dict[str, Any]:
    """Load `shared/data/entities.json`."""
    data = json.loads(ENTITIES_PATH.read_text(encoding="utf-8"))
    data.setdefault("companies", {})
    data.setdefault("indices", {})
    data.setdefault("people", [])
    data.setdefault("us_parties", {})
    return data


def save_entities(data: dict[str, Any]) -> int:
    """Atomically write the entity store (companies sorted by domain for stable diffs)."""
    payload = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": data.get("updated_at") or _utc_now_iso(),
        "companies": {d: data["companies"][d] for d in sorted(data.get("companies") or {})},
        "indices": data.get("indices") or {},
        "people": list(data.get("people") or []),
        "us_parties": data.get("us_parties") or {},
    }
    return _atomic_write_json(ENTITIES_PATH, payload)


def _collect_prose(obj: Any, out: list[str]) -> None:
    """Recursively collect user-visible prose strings (skipping metadata keys and URLs)."""
    if isinstance(obj, str):
        s = obj.strip()
        if s and not _URL_PREFIX_RE.match(s):
            out.append(s)
        return
    if isinstance(obj, list):
        for item in obj:
            _collect_prose(item, out)
        return
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "entities" or key in _SKIP_PROSE_KEYS:
                continue
            _collect_prose(value, out)


# ---------- Italic-Mention Entity Validation ----------

# Mirrors `EXPLICIT_ITALIC_RE` in `shared/entities.js`
_ITALIC_SPAN_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")


def _collect_italic_spans(obj: Any, out: list[str]) -> None:
    if isinstance(obj, str):
        # Bold markers are resolved before italics on the frontend (`***A* and *B***`)
        for m in _ITALIC_SPAN_RE.finditer(obj.replace("**", "")):
            span = m.group(1).strip()
            if span:
                out.append(span)
        return
    if isinstance(obj, list):
        for item in obj:
            _collect_italic_spans(item, out)
        return
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == "entities" or key in _SKIP_PROSE_KEYS:
                continue
            _collect_italic_spans(value, out)


def _collect_entity_mentions(obj: Any, out: set[str]) -> None:
    if isinstance(obj, list):
        for item in obj:
            _collect_entity_mentions(item, out)
        return
    if isinstance(obj, dict):
        ents = obj.get("entities")
        if isinstance(ents, list):
            for ent in ents:
                if isinstance(ent, dict) and str(ent.get("mention") or "").strip():
                    out.add(str(ent["mention"]).strip())
        for key, value in obj.items():
            if key != "entities":
                _collect_entity_mentions(value, out)


def normalize_edition_entities(edition_dict: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """Return `(top_level_entities, missing_italic_mentions)` for an edition.

    Canonical identities come only from the LLM: this de-duplicates top-level
    `entities[]` and drops entries whose mention no longer appears in the prose,
    then reports `*italic*` mentions with no identity anywhere in the edition.
    """
    spans: list[str] = []
    _collect_italic_spans(edition_dict, spans)
    prose_segments: list[str] = []
    _collect_prose(edition_dict, prose_segments)
    prose_blob = "\n".join(prose_segments)

    top_level: list[dict[str, Any]] = []
    seen_top: set[str] = set()
    for ent in edition_dict.get("entities") or []:
        if not isinstance(ent, dict):
            continue
        mention = str(ent.get("mention") or "").strip()
        if not mention or mention in seen_top or mention not in prose_blob:
            continue
        seen_top.add(mention)
        top_level.append(dict(ent))

    covered: set[str] = set()
    _collect_entity_mentions(edition_dict, covered)
    missing = [span for span in dict.fromkeys(spans) if span not in covered]
    return top_level, missing


def finalize_edition_entities(briefing: Any, entity_cls: Any, *, label: str = "edition") -> Any:
    """Normalize LLM-provided `entities[]` on a Pydantic edition model before it is written."""
    entities, missing = normalize_edition_entities(briefing.model_dump())
    briefing.entities = [entity_cls.model_validate(e) for e in entities]
    if missing:
        print(
            f"[entities] {label}: {len(missing)} italic mention(s) without an LLM identity "
            f"(rendered as plain person tooltips): {', '.join(missing)}"
        )
    return briefing


# ---------- CLI ----------

def _edition_paths() -> list[Path]:
    paths: list[Path] = []
    for latest, archive in ((DAILY_LATEST_PATH, DAILY_ARCHIVE_DIR), (WEEKLY_LATEST_PATH, WEEKLY_ARCHIVE_DIR)):
        if latest.exists():
            paths.append(latest)
        if archive.exists():
            paths.extend(sorted(archive.glob("*.json")))
    return paths


def fill_editions() -> dict[str, dict[str, Any]]:
    """Normalize `entities[]` on every Daily & Weekly edition file and report gaps.

    Also drops the obsolete `entity_shards` field. Only rewrites files that change.
    """
    results: dict[str, dict[str, Any]] = {}
    for path in _edition_paths():
        payload = json.loads(path.read_text(encoding="utf-8"))
        before = json.dumps(payload, sort_keys=True, ensure_ascii=False)
        entities, unresolved = normalize_edition_entities(payload)
        payload["entities"] = entities
        payload.pop("entity_shards", None)
        changed = json.dumps(payload, sort_keys=True, ensure_ascii=False) != before
        if changed:
            _atomic_write_json(path, payload)
        rel = str(path.relative_to(REPO_ROOT))
        results[rel] = {"changed": changed, "entities": len(entities), "unresolved": unresolved}
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Shared entity store utilities.")
    parser.add_argument(
        "--fill-editions",
        action="store_true",
        help="Normalize entities[] on all Daily & Weekly edition JSON files and list italic mentions missing an identity.",
    )
    args = parser.parse_args()
    if not args.fill_editions:
        parser.error("Specify --fill-editions.")
    for rel, info in fill_editions().items():
        flag = "updated" if info["changed"] else "unchanged"
        extra = f"; missing identity: {', '.join(info['unresolved'])}" if info["unresolved"] else ""
        print(f"[entity_store] {rel}: {flag}, {info['entities']} top-level entities{extra}")


if __name__ == "__main__":
    main()
