"""Unified Two-Tier Sharded Entity Store (`shared/data/entities/`).

Provides atomic sharded persistence, deterministic home categories,
edition-level shard detection (matching `shared/entities.js` boundary rules),
and recency-weighted hot/cold shard rebalancing with hysteresis.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

# Repository & store paths
REPO_ROOT = Path(__file__).resolve().parents[2]
ENTITIES_DIR = REPO_ROOT / "shared" / "data" / "entities"
MANIFEST_PATH = ENTITIES_DIR / "manifest.json"
LEGACY_ENTITIES_PATH = REPO_ROOT / "shared" / "data" / "entities.json"

_DEFAULT_ENTITIES_DIR = ENTITIES_DIR
_DEFAULT_MANIFEST_PATH = MANIFEST_PATH

DAILY_DATA_DIR = REPO_ROOT / "briefing" / "data"
DAILY_ARCHIVE_DIR = DAILY_DATA_DIR / "archive"
DAILY_LATEST_PATH = DAILY_DATA_DIR / "latest.json"
WEEKLY_DATA_DIR = REPO_ROOT / "weekly" / "data"
WEEKLY_ARCHIVE_DIR = WEEKLY_DATA_DIR / "archive"
WEEKLY_LATEST_PATH = WEEKLY_DATA_DIR / "latest.json"

# Shard topology
HOT_SHARD_ID = "hot"
COLD_SHARD_IDS: tuple[str, ...] = (
    "tech-ai",
    "finance-banking",
    "media-entertainment",
    "aviation-space",
    "consumer-energy-health",
    "science-culture",
)
ALL_SHARD_IDS: tuple[str, ...] = (HOT_SHARD_ID, *COLD_SHARD_IDS)
SCHEMA_VERSION = "3.0"

# Rebalance parameters
HOT_TARGET = 45
HOT_CEILING = 50
PROMOTE_RANK_CUTOFF = 35
DEMOTE_RANK_CUTOFF = 55
HALF_LIFE_DAYS = 14.0
DAILY_WINDOW = 30
WEEKLY_WINDOW = 8
WEEKLY_WEIGHT = 1.5
REBALANCE_INTERVAL_DAYS = 7

# 26 pinned hot domains (never demoted)
PINNED_HOT_DOMAINS: tuple[str, ...] = (
    # Big 7
    "nvidia.com",
    "apple.com",
    "microsoft.com",
    "google.com",
    "amazon.com",
    "meta.com",
    "tesla.com",
    # Core AI labs, space agencies, central bank
    "openai.com",
    "anthropic.com",
    "nasa.gov",
    "esa.int",
    "federalreserve.gov",
    # 14 core news outlets
    "bbc.com",
    "reuters.com",
    "apnews.com",
    "bloomberg.com",
    "nytimes.com",
    "wsj.com",
    "ft.com",
    "theguardian.com",
    "washingtonpost.com",
    "cnn.com",
    "cnbc.com",
    "npr.org",
    "aljazeera.com",
    "politico.com",
)

# Deterministic canonical home category for all 173 existing companies:
# tech-ai (60), finance-banking (30), media-entertainment (31),
# aviation-space (39), consumer-energy-health (13), science-culture (0)
DEFAULT_CATEGORY_MAP: dict[str, str] = {
    # --- tech-ai (60) ---
    "nvidia.com": "tech-ai",
    "apple.com": "tech-ai",
    "microsoft.com": "tech-ai",
    "google.com": "tech-ai",
    "amazon.com": "tech-ai",
    "meta.com": "tech-ai",
    "tesla.com": "tech-ai",
    "anthropic.com": "tech-ai",
    "openai.com": "tech-ai",
    "deepmind.google": "tech-ai",
    "deepseek.com": "tech-ai",
    "x.ai": "tech-ai",
    "mistral.ai": "tech-ai",
    "perplexity.ai": "tech-ai",
    "cohere.com": "tech-ai",
    "huggingface.co": "tech-ai",
    "ai.meta.com": "tech-ai",
    "ssi.inc": "tech-ai",
    "thinkingmachines.ai": "tech-ai",
    "scale.com": "tech-ai",
    "moonshot.cn": "tech-ai",
    "zhipuai.cn": "tech-ai",
    "minimax.io": "tech-ai",
    "midjourney.com": "tech-ai",
    "runwayml.com": "tech-ai",
    "elevenlabs.io": "tech-ai",
    "cursor.com": "tech-ai",
    "character.ai": "tech-ai",
    "huawei.com": "tech-ai",
    "tsmc.com": "tech-ai",
    "samsung.com": "tech-ai",
    "bytedance.com": "tech-ai",
    "tiktok.com": "tech-ai",
    "alibaba.com": "tech-ai",
    "tencent.com": "tech-ai",
    "baidu.com": "tech-ai",
    "mi.com": "tech-ai",
    "meituan.com": "tech-ai",
    "jd.com": "tech-ai",
    "pddholdings.com": "tech-ai",
    "intel.com": "tech-ai",
    "amd.com": "tech-ai",
    "broadcom.com": "tech-ai",
    "qualcomm.com": "tech-ai",
    "asml.com": "tech-ai",
    "oracle.com": "tech-ai",
    "palantir.com": "tech-ai",
    "salesforce.com": "tech-ai",
    "adobe.com": "tech-ai",
    "uber.com": "tech-ai",
    "ibm.com": "tech-ai",
    "cisco.com": "tech-ai",
    "softbank.jp": "tech-ai",
    "cloudflare.com": "tech-ai",
    "crowdstrike.com": "tech-ai",
    "snowflake.com": "tech-ai",
    "databricks.com": "tech-ai",
    "arm.com": "tech-ai",
    "smics.com": "tech-ai",
    "neteasegames.com": "tech-ai",
    # --- finance-banking (30) ---
    "jpmorganchase.com": "finance-banking",
    "goldmansachs.com": "finance-banking",
    "stripe.com": "finance-banking",
    "coinbase.com": "finance-banking",
    "visa.com": "finance-banking",
    "mastercard.com": "finance-banking",
    "abchina.com": "finance-banking",
    "icbc.com.cn": "finance-banking",
    "ccb.com": "finance-banking",
    "boc.cn": "finance-banking",
    "bankcomm.com": "finance-banking",
    "psbc.com": "finance-banking",
    "cmbchina.com": "finance-banking",
    "citicbank.com": "finance-banking",
    "bank.pingan.com": "finance-banking",
    "spdb.com.cn": "finance-banking",
    "cib.com.cn": "finance-banking",
    "pbc.gov.cn": "finance-banking",
    "bankofamerica.com": "finance-banking",
    "citigroup.com": "finance-banking",
    "wellsfargo.com": "finance-banking",
    "morganstanley.com": "finance-banking",
    "usbank.com": "finance-banking",
    "pnc.com": "finance-banking",
    "truist.com": "finance-banking",
    "capitalone.com": "finance-banking",
    "schwab.com": "finance-banking",
    "bny.com": "finance-banking",
    "statestreet.com": "finance-banking",
    "federalreserve.gov": "finance-banking",
    # --- media-entertainment (31) ---
    "bbc.com": "media-entertainment",
    "cnn.com": "media-entertainment",
    "reuters.com": "media-entertainment",
    "bloomberg.com": "media-entertainment",
    "cnbc.com": "media-entertainment",
    "foxnews.com": "media-entertainment",
    "nbcnews.com": "media-entertainment",
    "cbsnews.com": "media-entertainment",
    "abcnews.go.com": "media-entertainment",
    "msnbc.com": "media-entertainment",
    "npr.org": "media-entertainment",
    "nytimes.com": "media-entertainment",
    "washingtonpost.com": "media-entertainment",
    "wsj.com": "media-entertainment",
    "ft.com": "media-entertainment",
    "theguardian.com": "media-entertainment",
    "apnews.com": "media-entertainment",
    "aljazeera.com": "media-entertainment",
    "politico.com": "media-entertainment",
    "economist.com": "media-entertainment",
    "theatlantic.com": "media-entertainment",
    "axios.com": "media-entertainment",
    "newscorp.com": "media-entertainment",
    "comcastcorporation.com": "media-entertainment",
    "wbd.com": "media-entertainment",
    "paramount.com": "media-entertainment",
    "netflix.com": "media-entertainment",
    "disney.com": "media-entertainment",
    "spotify.com": "media-entertainment",
    "sony.com": "media-entertainment",
    "nintendo.com": "media-entertainment",
    # --- aviation-space (39) ---
    "spacex.com": "aviation-space",
    "boeing.com": "aviation-space",
    "airbus.com": "aviation-space",
    "delta.com": "aviation-space",
    "united.com": "aviation-space",
    "aa.com": "aviation-space",
    "southwest.com": "aviation-space",
    "alaskaair.com": "aviation-space",
    "jetblue.com": "aviation-space",
    "fedex.com": "aviation-space",
    "ups.com": "aviation-space",
    "lufthansa.com": "aviation-space",
    "britishairways.com": "aviation-space",
    "airfrance.com": "aviation-space",
    "emirates.com": "aviation-space",
    "qatarairways.com": "aviation-space",
    "singaporeair.com": "aviation-space",
    "cathaypacific.com": "aviation-space",
    "jal.co.jp": "aviation-space",
    "koreanair.com": "aviation-space",
    "airchina.com.cn": "aviation-space",
    "ceair.com": "aviation-space",
    "csair.com": "aviation-space",
    "qantas.com": "aviation-space",
    "ryanair.com": "aviation-space",
    "aircanada.com": "aviation-space",
    "nasa.gov": "aviation-space",
    "esa.int": "aviation-space",
    "cnsa.gov.cn": "aviation-space",
    "roscosmos.ru": "aviation-space",
    "jaxa.jp": "aviation-space",
    "isro.gov.in": "aviation-space",
    "asc-csa.gc.ca": "aviation-space",
    "cnes.fr": "aviation-space",
    "dlr.de": "aviation-space",
    "asi.it": "aviation-space",
    "kasa.go.kr": "aviation-space",
    "space.gov.ae": "aviation-space",
    "space.gov.au": "aviation-space",
    # --- consumer-energy-health (13) ---
    "walmart.com": "consumer-energy-health",
    "costco.com": "consumer-energy-health",
    "toyota.com": "consumer-energy-health",
    "ford.com": "consumer-energy-health",
    "byd.com": "consumer-energy-health",
    "catl.com": "consumer-energy-health",
    "moutaichina.com": "consumer-energy-health",
    "pfizer.com": "consumer-energy-health",
    "lilly.com": "consumer-energy-health",
    "novonordisk.com": "consumer-energy-health",
    "exxonmobil.com": "consumer-energy-health",
    "chevron.com": "consumer-energy-health",
    "aramco.com": "consumer-energy-health",
}

_ASCII_WORD_CHAR_RE = re.compile(r"[A-Za-z0-9_]")
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


def _resolve_manifest_path() -> Path:
    if ENTITIES_DIR != _DEFAULT_ENTITIES_DIR and MANIFEST_PATH == _DEFAULT_MANIFEST_PATH:
        return ENTITIES_DIR / "manifest.json"
    return MANIFEST_PATH


def _shard_path(shard_id: str) -> Path:
    if shard_id not in ALL_SHARD_IDS:
        raise ValueError(f"Unknown entity shard id: {shard_id!r}")
    return ENTITIES_DIR / f"{shard_id}.json"


def _utc_now_iso(now: datetime | None = None) -> str:
    dt = now if now is not None else datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw_bytes = (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    tmp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as tmp:
            tmp_name = tmp.name
            tmp.write(raw_bytes)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_name, path)
        tmp_name = None
    finally:
        if tmp_name is not None:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
    return len(raw_bytes)


def load_manifest() -> dict[str, Any]:
    """Load `shared/data/entities/manifest.json`."""
    mpath = _resolve_manifest_path()
    return json.loads(mpath.read_text(encoding="utf-8"))


def load_shard(shard_id: str) -> dict[str, Any]:
    """Load a single shard JSON file by shard id."""
    spath = _shard_path(shard_id)
    return json.loads(spath.read_text(encoding="utf-8"))


def load_all_entities() -> dict[str, Any]:
    """Load and merge all entity shards into the unified dictionary view.

    Raises `ValueError` if any company domain appears in more than one shard.
    Falls back to legacy `shared/data/entities.json` only if the sharded
    directory has not been initialized yet.
    """
    mpath = _resolve_manifest_path()
    hot_path = _shard_path(HOT_SHARD_ID)
    if not mpath.exists() and not hot_path.exists():
        if LEGACY_ENTITIES_PATH.exists():
            return json.loads(LEGACY_ENTITIES_PATH.read_text(encoding="utf-8"))
        raise FileNotFoundError(f"Entity store not found at {ENTITIES_DIR}")

    companies: dict[str, dict[str, Any]] = {}
    seen_shard: dict[str, str] = {}
    indices: dict[str, Any] = {}
    people: list[str] = []
    us_parties: dict[str, str] = {}
    updated_candidates: list[str] = []

    if mpath.exists():
        try:
            manifest_raw = json.loads(mpath.read_text(encoding="utf-8"))
            if manifest_raw.get("updated_at"):
                updated_candidates.append(str(manifest_raw["updated_at"]))
        except (OSError, ValueError):
            pass

    for shard_id in ALL_SHARD_IDS:
        shard_data = load_shard(shard_id)
        if shard_data.get("updated_at"):
            updated_candidates.append(str(shard_data["updated_at"]))
        if shard_id == HOT_SHARD_ID:
            indices = dict(shard_data.get("indices") or {})
            people = list(shard_data.get("people") or [])
            us_parties = dict(shard_data.get("us_parties") or {})
        shard_companies = shard_data.get("companies") or {}
        for domain, info in shard_companies.items():
            if domain in seen_shard:
                raise ValueError(
                    f"Duplicate entity domain {domain!r} found in shard {shard_id!r} "
                    f"(already present in {seen_shard[domain]!r})"
                )
            seen_shard[domain] = shard_id
            companies[domain] = info

    updated_at = max(updated_candidates) if updated_candidates else _utc_now_iso()
    return {
        "schema_version": SCHEMA_VERSION,
        "updated_at": updated_at,
        "companies": companies,
        "indices": indices,
        "people": people,
        "us_parties": us_parties,
    }


def _resolve_category(domain: str, info: dict[str, Any]) -> str:
    cat = info.get("category")
    if isinstance(cat, str) and cat in COLD_SHARD_IDS:
        return cat
    return DEFAULT_CATEGORY_MAP.get(domain, "tech-ai")


def save_entities_sharded(
    data: dict[str, Any],
    dirty_domains: Iterable[str] | None = None,
    *,
    domain_shard_override: dict[str, str] | None = None,
    last_rebalanced_at: str | None = None,
) -> dict[str, Any]:
    """Persist unified entity data into sharded files + `manifest.json`.

    When `dirty_domains` is provided, only shards touched by those domains
    (or structural additions/removals/moves/hot-metadata changes) are written
    atomically; clean shards remain untouched on disk.
    """
    ENTITIES_DIR.mkdir(parents=True, exist_ok=True)
    mpath = _resolve_manifest_path()

    existing_manifest: dict[str, Any] = {}
    if mpath.exists():
        try:
            existing_manifest = json.loads(mpath.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            existing_manifest = {}

    old_domain_shard: dict[str, str] = dict(existing_manifest.get("domain_shard") or {})
    pinned_hot: list[str] = list(existing_manifest.get("pinned_hot") or PINNED_HOT_DOMAINS)
    pinned_set = set(pinned_hot)

    companies: dict[str, dict[str, Any]] = data.get("companies") or {}
    indices: dict[str, Any] = data.get("indices") or {}
    people: list[str] = list(data.get("people") or [])
    us_parties: dict[str, str] = data.get("us_parties") or {}
    updated_at = str(data.get("updated_at") or _utc_now_iso())

    shard_buckets: dict[str, dict[str, dict[str, Any]]] = {sid: {} for sid in ALL_SHARD_IDS}
    new_domain_shard: dict[str, str] = {}

    for domain, raw_info in companies.items():
        info = dict(raw_info)
        category = _resolve_category(domain, info)
        info["category"] = category

        if domain_shard_override is not None and domain in domain_shard_override:
            target_shard = domain_shard_override[domain]
            if target_shard not in ALL_SHARD_IDS:
                raise ValueError(f"Invalid override shard {target_shard!r} for domain {domain!r}")
        elif old_domain_shard.get(domain) in ALL_SHARD_IDS:
            target_shard = old_domain_shard[domain]
        elif domain in pinned_set:
            target_shard = HOT_SHARD_ID
        else:
            target_shard = category

        shard_buckets[target_shard][domain] = info
        new_domain_shard[domain] = target_shard

    if dirty_domains is None:
        dirty_shards: set[str] = set(ALL_SHARD_IDS)
    else:
        dirty_shards = set()
        for d in dirty_domains:
            if d in new_domain_shard:
                dirty_shards.add(new_domain_shard[d])
            if d in old_domain_shard and old_domain_shard[d] in ALL_SHARD_IDS:
                dirty_shards.add(old_domain_shard[d])

        # Detect any structural changes (added, removed, or moved domains)
        all_known = set(old_domain_shard.keys()) | set(new_domain_shard.keys())
        for d in all_known:
            old_s = old_domain_shard.get(d)
            new_s = new_domain_shard.get(d)
            if old_s != new_s:
                if old_s in ALL_SHARD_IDS:
                    dirty_shards.add(old_s)
                if new_s in ALL_SHARD_IDS:
                    dirty_shards.add(new_s)

        # Ensure any missing shard file is materialized
        for sid in ALL_SHARD_IDS:
            if not _shard_path(sid).exists():
                dirty_shards.add(sid)

        # Check if hot top-level collections (indices, people, us_parties) changed
        if HOT_SHARD_ID not in dirty_shards and _shard_path(HOT_SHARD_ID).exists():
            try:
                cur_hot = load_shard(HOT_SHARD_ID)
                if (
                    cur_hot.get("indices") != indices
                    or cur_hot.get("people") != people
                    or cur_hot.get("us_parties") != us_parties
                ):
                    dirty_shards.add(HOT_SHARD_ID)
            except (OSError, ValueError):
                dirty_shards.add(HOT_SHARD_ID)

    shards_meta: dict[str, dict[str, Any]] = {}
    for sid in ALL_SHARD_IDS:
        spath = _shard_path(sid)
        if sid in dirty_shards:
            payload: dict[str, Any] = {
                "schema_version": SCHEMA_VERSION,
                "shard": sid,
                "updated_at": updated_at,
                "companies": shard_buckets[sid],
            }
            if sid == HOT_SHARD_ID:
                payload["indices"] = indices
                payload["people"] = people
                payload["us_parties"] = us_parties
            size_bytes = _atomic_write_json(spath, payload)
        else:
            size_bytes = spath.stat().st_size

        shards_meta[sid] = {
            "file": f"{sid}.json",
            "company_count": len(shard_buckets[sid]),
            "bytes": size_bytes,
        }

    resolved_rebalanced_at = (
        last_rebalanced_at
        if last_rebalanced_at is not None
        else existing_manifest.get("last_rebalanced_at")
    )

    manifest: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": updated_at,
        "last_rebalanced_at": resolved_rebalanced_at,
        "pinned_hot": pinned_hot,
        "shards": shards_meta,
        "domain_shard": new_domain_shard,
    }
    _atomic_write_json(mpath, manifest)
    return manifest


# ---------- Prefix Trie Matcher (mirrors shared/entities.js boundary rules) ----------

def _is_ascii_key(key: str) -> bool:
    return all(ord(ch) <= 0x7F for ch in key)


def _is_word_boundary_ok(
    text: str,
    start: int,
    end: int,
    need_left: bool,
    need_right: bool,
) -> bool:
    if need_left and start > 0 and _ASCII_WORD_CHAR_RE.match(text[start - 1]):
        return False
    if need_right and end < len(text) and _ASCII_WORD_CHAR_RE.match(text[end]):
        return False
    return True


def _build_alias_trie(companies: dict[str, dict[str, Any]]) -> tuple[dict[str, Any], dict[str, list[str]]]:
    """Build a prefix trie and alias->domains lookup from companies."""
    alias_to_domains: dict[str, list[str]] = {}
    for domain, info in companies.items():
        if not isinstance(info, dict):
            continue
        for alias in info.get("aliases") or []:
            if not alias:
                continue
            lst = alias_to_domains.setdefault(str(alias), [])
            if domain not in lst:
                lst.append(domain)
        for alias in info.get("ambiguous_aliases") or []:
            if not alias:
                continue
            lst = alias_to_domains.setdefault(str(alias), [])
            if domain not in lst:
                lst.append(domain)

    root: dict[str, Any] = {}
    for key in alias_to_domains:
        node = root
        for ch in key:
            nxt = node.get(ch)
            if nxt is None:
                nxt = {}
                node[ch] = nxt
            node = nxt
        is_ascii = _is_ascii_key(key)
        node["$"] = (
            key,
            len(key),
            is_ascii and bool(_ASCII_WORD_CHAR_RE.match(key[0])),
            is_ascii and bool(_ASCII_WORD_CHAR_RE.match(key[-1])),
        )
    return root, alias_to_domains


def _longest_match_at(text: str, pos: int, trie: dict[str, Any]) -> tuple[str, int, bool, bool] | None:
    node = trie
    best = None
    n = len(text)
    for i in range(pos, n):
        nxt = node.get(text[i])
        if nxt is None:
            break
        node = nxt
        hit = node.get("$")
        if hit is not None and _is_word_boundary_ok(text, pos, i + 1, hit[2], hit[3]):
            best = hit
    return best


def _find_matched_aliases(text: str, trie: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    i = 0
    n = len(text)
    while i < n:
        best = _longest_match_at(text, i, trie)
        if best is not None:
            found.add(best[0])
            i += best[1]
        else:
            i += 1
    return found


def _collect_prose_and_entities(
    obj: Any,
    prose_segments: list[tuple[str, frozenset[str]]],
    explicit_domains: set[str],
    inherited_suppressed: frozenset[str] = frozenset(),
) -> None:
    """Recursively collect user-visible prose segments and explicit `entities[].domain`."""
    if isinstance(obj, str):
        s = obj.strip()
        if s and not _URL_PREFIX_RE.match(s):
            prose_segments.append((s, inherited_suppressed))
        return

    if isinstance(obj, list):
        for item in obj:
            _collect_prose_and_entities(item, prose_segments, explicit_domains, inherited_suppressed)
        return

    if isinstance(obj, dict):
        local_suppressed = set(inherited_suppressed)
        entities_field = obj.get("entities")
        if isinstance(entities_field, list):
            for ent in entities_field:
                if not isinstance(ent, dict):
                    continue
                etype = str(ent.get("type") or "").strip().lower()
                mention = str(ent.get("mention") or "").strip()
                domain = str(ent.get("domain") or "").strip().lower()
                if etype == "company" and domain:
                    explicit_domains.add(domain)
                elif etype in ("none", "person", "place") and mention:
                    local_suppressed.add(mention)
        frozen_suppressed = frozenset(local_suppressed)

        for key, value in obj.items():
            if key == "entities" or key in _SKIP_PROSE_KEYS:
                continue
            _collect_prose_and_entities(value, prose_segments, explicit_domains, frozen_suppressed)


def _detect_mentioned_domains(
    edition_dict: dict[str, Any],
    trie: dict[str, Any],
    alias_to_domains: dict[str, list[str]],
    known_domains: set[str],
) -> set[str]:
    prose_segments: list[tuple[str, frozenset[str]]] = []
    explicit_domains: set[str] = set()
    _collect_prose_and_entities(edition_dict, prose_segments, explicit_domains)

    matched_domains: set[str] = {d for d in explicit_domains if d in known_domains}
    for segment, suppressed in prose_segments:
        aliases = _find_matched_aliases(segment, trie)
        for alias in aliases:
            if alias in suppressed:
                continue
            for dom in alias_to_domains.get(alias, ()):
                matched_domains.add(dom)
    return matched_domains


def detect_edition_shards(
    edition_dict: dict[str, Any],
    *,
    entities: dict[str, Any] | None = None,
    manifest: dict[str, Any] | None = None,
) -> list[str]:
    """Detect all entity shards needed to render an edition.

    Scans user-visible prose and explicit `entities[].domain` (skipping URLs,
    IDs, timestamps, and metadata) using `shared/entities.js` boundary rules.
    Returns `["hot", ...matched cold shards in canonical COLD_SHARD_IDS order]`.
    """
    loaded_entities = entities if entities is not None else load_all_entities()
    loaded_manifest = manifest if manifest is not None else load_manifest()
    companies: dict[str, dict[str, Any]] = loaded_entities.get("companies") or {}
    domain_shard: dict[str, str] = loaded_manifest.get("domain_shard") or {}

    trie, alias_to_domains = _build_alias_trie(companies)
    matched_domains = _detect_mentioned_domains(
        edition_dict, trie, alias_to_domains, set(companies.keys())
    )

    matched_cold: set[str] = set()
    for dom in matched_domains:
        sid = domain_shard.get(dom)
        if sid and sid != HOT_SHARD_ID and sid in COLD_SHARD_IDS:
            matched_cold.add(sid)

    ordered_cold = [sid for sid in COLD_SHARD_IDS if sid in matched_cold]
    return [HOT_SHARD_ID, *ordered_cold]


# ---------- Recency Scoring & Hot/Cold Rebalancing ----------

def _collect_archive_editions() -> list[tuple[str, float, dict[str, Any]]]:
    """Return list of `(date_str, weight, edition_dict)` from recent Daily & Weekly archives."""
    editions: list[tuple[str, float, dict[str, Any]]] = []

    daily_seen: set[str] = set()
    if DAILY_ARCHIVE_DIR.exists():
        for path in sorted(DAILY_ARCHIVE_DIR.glob("*.json"), reverse=True)[:DAILY_WINDOW]:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                ed_date = str(payload.get("date") or path.stem)
                daily_seen.add(ed_date)
                editions.append((ed_date, 1.0, payload))
            except (OSError, ValueError):
                continue
    if DAILY_LATEST_PATH.exists():
        try:
            payload = json.loads(DAILY_LATEST_PATH.read_text(encoding="utf-8"))
            ed_date = str(payload.get("date") or "")
            if ed_date and ed_date not in daily_seen and len(daily_seen) < DAILY_WINDOW:
                editions.append((ed_date, 1.0, payload))
        except (OSError, ValueError):
            pass

    weekly_seen: set[str] = set()
    if WEEKLY_ARCHIVE_DIR.exists():
        for path in sorted(WEEKLY_ARCHIVE_DIR.glob("*.json"), reverse=True)[:WEEKLY_WINDOW]:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                ed_date = str(payload.get("date") or path.stem)
                weekly_seen.add(ed_date)
                editions.append((ed_date, WEEKLY_WEIGHT, payload))
            except (OSError, ValueError):
                continue
    if WEEKLY_LATEST_PATH.exists():
        try:
            payload = json.loads(WEEKLY_LATEST_PATH.read_text(encoding="utf-8"))
            ed_date = str(payload.get("date") or "")
            if ed_date and ed_date not in weekly_seen and len(weekly_seen) < WEEKLY_WINDOW:
                editions.append((ed_date, WEEKLY_WEIGHT, payload))
        except (OSError, ValueError):
            pass

    return editions


def _compute_recency_scores(
    companies: dict[str, dict[str, Any]],
    now_dt: datetime,
) -> dict[str, float]:
    scores: dict[str, float] = {domain: 0.0 for domain in companies}
    editions = _collect_archive_editions()
    if not editions:
        return scores

    trie, alias_to_domains = _build_alias_trie(companies)
    known_domains = set(companies.keys())
    today = now_dt.date()

    for ed_date_str, weight, payload in editions:
        try:
            ed_date = datetime.strptime(ed_date_str[:10], "%Y-%m-%d").date()
            age_days = max(0.0, float((today - ed_date).days))
        except ValueError:
            age_days = 0.0
        decay = math.pow(0.5, age_days / HALF_LIFE_DAYS)
        contribution = weight * decay

        mentioned = _detect_mentioned_domains(payload, trie, alias_to_domains, known_domains)
        for dom in mentioned:
            scores[dom] = scores.get(dom, 0.0) + contribution

    return scores


def rebalance_hot_shard(
    force: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Rebalance hot/cold shard membership using recency-weighted decay & hysteresis.

    Rules:
    - 7-day throttle via `manifest.last_rebalanced_at` unless `force=True`.
    - 14-day half-life recency score across last 30 Daily (1.0x) + 8 Weekly (1.5x) editions.
    - Pinned domains are never demoted.
    - Hysteresis deadband: cold domains ranked <= 35 are promoted; non-pinned hot
      domains ranked > 55 are demoted back to their canonical `category`.
    - Enforces `HOT_CEILING` (50) by trimming lowest-ranked non-pinned hot domains,
      and backfills up to `HOT_TARGET` (45) from highest-ranked cold domains if below target.
    """
    now_dt = now if now is not None else datetime.now(timezone.utc)
    if now_dt.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=timezone.utc)
    else:
        now_dt = now_dt.astimezone(timezone.utc)
    now_iso = _utc_now_iso(now_dt)

    manifest = load_manifest()
    last_rebal_str = manifest.get("last_rebalanced_at")
    if not force and last_rebal_str:
        last_dt = _parse_iso(last_rebal_str)
        if last_dt is not None and (now_dt - last_dt) < timedelta(days=REBALANCE_INTERVAL_DAYS):
            hot_count = int((manifest.get("shards") or {}).get(HOT_SHARD_ID, {}).get("company_count", 0))
            return {
                "rebalanced": False,
                "reason": "throttled",
                "hot_count": hot_count,
                "promoted": [],
                "demoted": [],
                "last_rebalanced_at": last_rebal_str,
            }

    data = load_all_entities()
    companies: dict[str, dict[str, Any]] = data.get("companies") or {}
    old_domain_shard: dict[str, str] = dict(manifest.get("domain_shard") or {})
    pinned_list: list[str] = [
        d for d in (manifest.get("pinned_hot") or PINNED_HOT_DOMAINS) if d in companies
    ]
    pinned_set = set(pinned_list)
    current_hot = {d for d, sid in old_domain_shard.items() if sid == HOT_SHARD_ID and d in companies}

    scores = _compute_recency_scores(companies, now_dt)

    # Deterministic 1-based ranking across all domains
    ranked_domains = sorted(
        companies.keys(),
        key=lambda d: (
            -scores.get(d, 0.0),
            0 if d in current_hot else 1,
            0 if companies[d].get("inline_ticker") else 1,
            0 if companies[d].get("public") else 1,
            d,
        ),
    )
    rank_of = {d: idx + 1 for idx, d in enumerate(ranked_domains)}

    next_hot: set[str] = set(pinned_set)

    # 1. Keep currently-hot non-pinned domains within demotion cutoff (hysteresis)
    for d in current_hot:
        if d in pinned_set:
            continue
        if rank_of[d] <= DEMOTE_RANK_CUTOFF:
            next_hot.add(d)

    # 2. Promote cold domains within promotion cutoff
    for d in ranked_domains:
        if rank_of[d] > PROMOTE_RANK_CUTOFF:
            break
        next_hot.add(d)

    # 3. Enforce ceiling: trim lowest-ranked non-pinned domains if over HOT_CEILING
    if len(next_hot) > HOT_CEILING:
        non_pinned_hot = sorted(
            (d for d in next_hot if d not in pinned_set),
            key=lambda d: rank_of[d],
            reverse=True,
        )
        excess = len(next_hot) - HOT_CEILING
        for d in non_pinned_hot[:excess]:
            next_hot.remove(d)

    # 4. Backfill up to HOT_TARGET if under target
    target_size = min(HOT_TARGET, len(companies))
    if len(next_hot) < target_size:
        for d in ranked_domains:
            if d not in next_hot:
                next_hot.add(d)
                if len(next_hot) >= target_size:
                    break

    next_domain_shard: dict[str, str] = {}
    for d, info in companies.items():
        if d in next_hot:
            next_domain_shard[d] = HOT_SHARD_ID
        else:
            next_domain_shard[d] = _resolve_category(d, info)

    promoted = sorted(d for d in next_hot if d not in current_hot)
    demoted = sorted(d for d in current_hot if d not in next_hot)
    changed_domains = set(promoted) | set(demoted)

    # Ensure moved domains also include any whose cold shard changed
    for d, new_s in next_domain_shard.items():
        if old_domain_shard.get(d) != new_s:
            changed_domains.add(d)

    save_entities_sharded(
        data,
        dirty_domains=changed_domains,
        domain_shard_override=next_domain_shard,
        last_rebalanced_at=now_iso,
    )

    return {
        "rebalanced": True,
        "reason": "forced" if force else "scheduled",
        "hot_count": len(next_hot),
        "promoted": promoted,
        "demoted": demoted,
        "last_rebalanced_at": now_iso,
    }


# ---------- CLI Actions ----------

def migrate_legacy_entities(now: datetime | None = None) -> dict[str, Any]:
    """Migrate legacy `shared/data/entities.json` into `shared/data/entities/`."""
    if not LEGACY_ENTITIES_PATH.exists():
        raise FileNotFoundError(f"Legacy entities file not found: {LEGACY_ENTITIES_PATH}")

    legacy = json.loads(LEGACY_ENTITIES_PATH.read_text(encoding="utf-8"))
    companies: dict[str, dict[str, Any]] = {}
    for domain, info in (legacy.get("companies") or {}).items():
        enriched = dict(info)
        enriched["category"] = _resolve_category(domain, enriched)
        companies[domain] = enriched

    now_dt = now if now is not None else datetime.now(timezone.utc)
    if now_dt.tzinfo is None:
        now_dt = now_dt.replace(tzinfo=timezone.utc)
    now_iso = _utc_now_iso(now_dt)

    scores = _compute_recency_scores(companies, now_dt)
    pinned_set = {d for d in PINNED_HOT_DOMAINS if d in companies}
    ranked_non_pinned = sorted(
        (d for d in companies if d not in pinned_set),
        key=lambda d: (
            -scores.get(d, 0.0),
            0 if companies[d].get("inline_ticker") else 1,
            0 if companies[d].get("public") else 1,
            d,
        ),
    )

    initial_hot = set(pinned_set)
    need = max(0, min(HOT_TARGET, len(companies)) - len(initial_hot))
    initial_hot.update(ranked_non_pinned[:need])

    domain_shard_override: dict[str, str] = {}
    for domain, info in companies.items():
        domain_shard_override[domain] = HOT_SHARD_ID if domain in initial_hot else info["category"]

    payload = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": legacy.get("updated_at") or now_iso,
        "companies": companies,
        "indices": dict(legacy.get("indices") or {}),
        "people": list(legacy.get("people") or []),
        "us_parties": dict(legacy.get("us_parties") or {}),
    }
    return save_entities_sharded(
        payload,
        dirty_domains=None,
        domain_shard_override=domain_shard_override,
        last_rebalanced_at=now_iso,
    )


def backfill_editions() -> dict[str, list[str]]:
    """Populate `entity_shards` on all existing Daily and Weekly JSON files."""
    entities = load_all_entities()
    manifest = load_manifest()
    results: dict[str, list[str]] = {}

    targets: list[Path] = []
    if DAILY_LATEST_PATH.exists():
        targets.append(DAILY_LATEST_PATH)
    if DAILY_ARCHIVE_DIR.exists():
        targets.extend(sorted(DAILY_ARCHIVE_DIR.glob("*.json")))
    if WEEKLY_LATEST_PATH.exists():
        targets.append(WEEKLY_LATEST_PATH)
    if WEEKLY_ARCHIVE_DIR.exists():
        targets.extend(sorted(WEEKLY_ARCHIVE_DIR.glob("*.json")))

    for path in targets:
        payload = json.loads(path.read_text(encoding="utf-8"))
        shards = detect_edition_shards(payload, entities=entities, manifest=manifest)
        payload["entity_shards"] = shards
        _atomic_write_json(path, payload)
        rel = str(path.relative_to(REPO_ROOT)) if path.is_relative_to(REPO_ROOT) else str(path)
        results[rel] = shards

    return results


def verify_store() -> tuple[bool, list[str]]:
    """Run full integrity verification on `shared/data/entities/`."""
    errors: list[str] = []
    mpath = _resolve_manifest_path()
    if not mpath.exists():
        return False, [f"Missing manifest: {mpath}"]

    try:
        manifest = load_manifest()
    except Exception as exc:
        return False, [f"Failed to load manifest: {exc}"]

    if manifest.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"Unexpected manifest schema_version: {manifest.get('schema_version')!r}")

    for sid in ALL_SHARD_IDS:
        spath = _shard_path(sid)
        if not spath.exists():
            errors.append(f"Missing shard file: {spath}")

    if errors:
        return False, errors

    try:
        merged = load_all_entities()
    except Exception as exc:
        return False, [f"load_all_entities failed: {exc}"]

    companies = merged.get("companies") or {}
    domain_shard = manifest.get("domain_shard") or {}
    if set(domain_shard.keys()) != set(companies.keys()):
        errors.append(
            f"manifest.domain_shard keys ({len(domain_shard)}) != merged companies ({len(companies)})"
        )

    for domain, info in companies.items():
        cat = info.get("category")
        if cat not in COLD_SHARD_IDS:
            errors.append(f"Invalid category {cat!r} for domain {domain!r}")

    shards_meta = manifest.get("shards") or {}
    for sid in ALL_SHARD_IDS:
        spath = _shard_path(sid)
        shard_data = load_shard(sid)
        actual_companies = shard_data.get("companies") or {}
        actual_bytes = spath.stat().st_size
        meta = shards_meta.get(sid) or {}
        if meta.get("company_count") != len(actual_companies):
            errors.append(
                f"Shard {sid}: manifest company_count={meta.get('company_count')} != actual {len(actual_companies)}"
            )
        if meta.get("bytes") != actual_bytes:
            errors.append(
                f"Shard {sid}: manifest bytes={meta.get('bytes')} != actual {actual_bytes}"
            )
        for d in actual_companies:
            if domain_shard.get(d) != sid:
                errors.append(f"Domain {d!r} in shard {sid!r} but manifest says {domain_shard.get(d)!r}")

    hot_companies = (load_shard(HOT_SHARD_ID).get("companies") or {})
    if len(hot_companies) > HOT_CEILING:
        errors.append(f"Hot shard count {len(hot_companies)} exceeds HOT_CEILING ({HOT_CEILING})")
    for pinned in manifest.get("pinned_hot") or []:
        if pinned in companies and pinned not in hot_companies:
            errors.append(f"Pinned domain {pinned!r} missing from hot shard")

    if LEGACY_ENTITIES_PATH.exists():
        legacy = json.loads(LEGACY_ENTITIES_PATH.read_text(encoding="utf-8"))
        leg_companies = legacy.get("companies") or {}
        if set(companies.keys()) != set(leg_companies.keys()):
            errors.append(
                f"Company domain mismatch vs legacy: sharded={len(companies)}, legacy={len(leg_companies)}"
            )
        else:
            for d, leg_info in leg_companies.items():
                stripped = {k: v for k, v in companies[d].items() if k != "category"}
                if stripped != leg_info:
                    errors.append(f"Company record mismatch for {d!r}")
        if merged.get("indices") != legacy.get("indices"):
            errors.append("indices mismatch vs legacy")
        if merged.get("us_parties") != legacy.get("us_parties"):
            errors.append("us_parties mismatch vs legacy")
        if merged.get("people") != legacy.get("people"):
            errors.append("people mismatch vs legacy")

    return len(errors) == 0, errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the sharded entity store (shared/data/entities/).")
    parser.add_argument("--migrate", action="store_true", help="Migrate legacy shared/data/entities.json to sharded store.")
    parser.add_argument("--backfill-editions", action="store_true", help="Populate entity_shards on all Daily & Weekly JSON files.")
    parser.add_argument("--rebalance", action="store_true", help="Run hot/cold shard rebalancing.")
    parser.add_argument("--force", action="store_true", help="Bypass 7-day throttle during --rebalance.")
    parser.add_argument("--verify", action="store_true", help="Verify shard integrity, counts, bytes, and legacy parity.")
    args = parser.parse_args()

    if not any([args.migrate, args.backfill_editions, args.rebalance, args.verify]):
        parser.error("Specify at least one of --migrate, --backfill-editions, --rebalance, or --verify.")

    if args.migrate:
        manifest = migrate_legacy_entities()
        print("[entity_store] Migrated legacy entities.json -> shared/data/entities/")
        for sid, meta in manifest["shards"].items():
            print(f"  - {sid:24s}: {meta['company_count']:3d} companies ({meta['bytes']:,} bytes)")

    if args.rebalance:
        res = rebalance_hot_shard(force=args.force)
        print(
            f"[entity_store] Rebalance: rebalanced={res['rebalanced']} ({res['reason']}), "
            f"hot={res['hot_count']}, promoted={len(res['promoted'])}, demoted={len(res['demoted'])}"
        )
        if res["promoted"]:
            print("  promoted:", ", ".join(res["promoted"]))
        if res["demoted"]:
            print("  demoted:", ", ".join(res["demoted"]))

    if args.backfill_editions:
        res = backfill_editions()
        print(f"[entity_store] Backfilled entity_shards on {len(res)} edition files:")
        for rel, shards in res.items():
            print(f"  - {rel}: {shards}")

    if args.verify:
        ok, errs = verify_store()
        if ok:
            manifest = load_manifest()
            total = sum(m["company_count"] for m in manifest["shards"].values())
            print(f"[entity_store] VERIFY OK: {total} companies across {len(ALL_SHARD_IDS)} shards.")
        else:
            print("[entity_store] VERIFY FAILED:")
            for err in errs:
                print(f"  - {err}")
            sys.exit(1)


if __name__ == "__main__":
    main()
