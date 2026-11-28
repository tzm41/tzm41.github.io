"""Batched, sharded, and cascaded refresh for public entities in shared/data/entities/.

Rate-limit-safe architecture:
- Sharded selection (`--mode active|stale|all`, `--batch-size 40`): prioritizes recently
  mentioned public entities (last 7 days of briefings) plus the stalest records oldest-first.
- Cascaded fetch:
  - Stage 1 (fast): market cap via `yf.Ticker.fast_info` in paced chunks with exponential backoff.
  - Stage 2 (slow): CEO/leader check via `tk.info` ONLY on a 30-day cadence (`leader_refreshed_at`),
    avoiding ~97% of heavy `.info` API calls.
- Incremental checkpointing: saves only dirty shards in `shared/data/entities/` after each chunk
  so partial runs resume cleanly on the next execution, followed by scheduled hot/cold rebalancing.
"""

from __future__ import annotations

import argparse
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yfinance as yf

from ..common.entity_store import load_all_entities, rebalance_hot_shard, save_entities_sharded
from .config import ARCHIVE_DIR, ENTITIES_DIR, LATEST_PATH

_HONORIFIC_RE = re.compile(r"^(?:Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)\s+", re.IGNORECASE)
_SUFFIX_RE = re.compile(
    r",?\s+(?:Ph\.?D\.?|J\.?D\.?|M\.?D\.?|B\.?A\.?|B\.?S\.?(?:c\.?)?(?:\s*\([^)]*\))?(?:\s+Mgmt\.?)?|M\.?S\.?(?:c\.?)?(?:\s+[A-Z]{2,}(?:\s+[A-Z]{2,})*)?|M\.?B\.?A\.?|B\.?Com\.?|C\.?A\.?|F\.?C\.?A\.?|C\.?F\.?A\.?|LL\.?B\.?|LL\.?M\.?|D\.?V\.?M\.?|LCA|CPA|Jr\.|Sr\.|II|III)\b\.?",
    re.IGNORECASE,
)

FX_TO_USD = {
    "USD": 1.0,
    "HKD": 0.128,
    "CNY": 0.138,
    "JPY": 0.0065,
    "TWD": 0.031,
    "KRW": 0.00072,
    "SAR": 0.2666,
    "EUR": 1.08,
    "GBP": 1.27,
    "GBp": 0.0127,
    "GBX": 0.0127,
    "DKK": 0.145,
    "SGD": 0.74,
    "AUD": 0.65,
    "CAD": 0.72,
}


def _fmt_usd_cap(usd_val: float) -> str:
    if usd_val >= 1e12:
        return f"~${usd_val / 1e12:.2f}T"
    if usd_val >= 1e9:
        return f"~${usd_val / 1e9:.0f}B"
    if usd_val >= 1e6:
        return f"~${usd_val / 1e6:.0f}M"
    return f"~${usd_val:,.0f}"


def _clean_person_name(raw: str) -> str:
    s = re.sub(r"\s+", " ", raw.strip())
    s = _HONORIFIC_RE.sub("", s)
    s = _SUFFIX_RE.sub("", s)
    return re.sub(r"\s+", " ", s).strip(" ,")


def _extract_live_ceo(officers: list[dict[str, Any]]) -> str | None:
    ceos: list[str] = []
    for o in officers:
        name = _clean_person_name(str(o.get("name") or ""))
        title = str(o.get("title") or "")
        tl = title.lower()
        if (
            not name
            or "chief of staff" in tl
            or re.search(r"\b(?:ceo|chief executive officer)\s+(?:of|for|-)\b", tl)
            or any(k in tl for k in ("segment", "division", "business", "stores", "airplanes", "institute", "slack", "wealth"))
        ):
            continue
        if re.search(r"\b(?:co-?ceo|chief executive officer|ceo)\b", tl):
            if name not in ceos:
                ceos.append(name)
    if not ceos:
        return None
    if len(ceos) >= 2:
        return f"{ceos[0]} & {ceos[1]} (Co-CEOs)"
    return f"{ceos[0]} (CEO)"


def _surname_changed(saved: str, live: str) -> bool:
    saved_low = saved.lower()
    base = re.sub(r"\s*\([^)]*\)\s*$", "", live)
    names = [n.strip() for n in base.split("&") if n.strip()]
    if not names:
        return False
    for n in names:
        tokens = n.split()
        if tokens and tokens[-1].lower() not in saved_low:
            return True
    return False


def _parse_iso(ts: str | None) -> datetime:
    if not ts:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


def _find_recently_mentioned_domains(companies: dict[str, dict[str, Any]], days: int = 7) -> set[str]:
    """Scan recent daily briefings to prioritize actively mentioned public companies."""
    corpus_parts: list[str] = []
    files: list[Path] = []
    if LATEST_PATH.exists():
        files.append(LATEST_PATH)
    if ARCHIVE_DIR.exists():
        files.extend(sorted(ARCHIVE_DIR.glob("*.json"), reverse=True)[:days])
    for p in files:
        try:
            corpus_parts.append(p.read_text(encoding="utf-8"))
        except OSError:
            pass
    if not corpus_parts:
        return set()
    corpus = "\n".join(corpus_parts)

    active: set[str] = set()
    for domain, info in companies.items():
        if not (info.get("public") and info.get("symbol")):
            continue
        names = [info.get("name", ""), *(info.get("aliases") or [])]
        for alias in names:
            if alias and len(alias) >= 2 and alias in corpus:
                active.add(domain)
                break
    return active


def _select_targets(
    companies: dict[str, dict[str, Any]],
    mode: str,
    batch_size: int,
    max_age_days: int,
    leader_max_age_days: int,
    force_leaders: bool,
) -> list[tuple[str, str, bool]]:
    """Return prioritized list of (domain, symbol, should_refresh_leader)."""
    now = datetime.now(timezone.utc)
    cap_cutoff = now - timedelta(days=max_age_days)
    leader_cutoff = now - timedelta(days=leader_max_age_days)
    active_domains = _find_recently_mentioned_domains(companies, days=7) if mode == "active" else set()

    candidates: list[tuple[int, datetime, str, str, bool]] = []
    for domain, info in companies.items():
        if not (info.get("public") and info.get("symbol")):
            continue
        refreshed = _parse_iso(info.get("refreshed_at"))
        leader_refreshed = _parse_iso(info.get("leader_refreshed_at"))
        need_leader = force_leaders or (leader_refreshed < leader_cutoff)

        if mode == "stale" and refreshed >= cap_cutoff and not need_leader:
            continue

        # Priority 0: recently mentioned in briefings; Priority 1: stale/un-refreshed; Priority 2: routine rotation
        if domain in active_domains:
            priority = 0
        elif refreshed < cap_cutoff:
            priority = 1
        else:
            priority = 2
        candidates.append((priority, refreshed, domain, str(info["symbol"]), need_leader))

    candidates.sort(key=lambda x: (x[0], x[1], x[2]))
    if mode != "all" and batch_size > 0:
        candidates = candidates[:batch_size]
    return [(d, s, nl) for _, _, d, s, nl in candidates]


def _fetch_one_cascaded(item: tuple[str, str, bool]) -> tuple[str, str | None, str | None, bool]:
    """Cascaded fetch: Stage 1 fast_info (valuation), Stage 2 .info (CEO, only when due)."""
    domain, symbol, need_leader = item
    cap_str: str | None = None
    ceo_str: str | None = None
    leader_checked = False

    for attempt in range(3):
        try:
            tk = yf.Ticker(symbol)
            # Stage 1: Lightweight fast_info for market cap
            fi = tk.fast_info
            mcap = fi.get("marketCap") if hasattr(fi, "get") else getattr(fi, "market_cap", None)
            cur = (fi.get("currency") if hasattr(fi, "get") else getattr(fi, "currency", None)) or "USD"
            if mcap and float(mcap) > 0:
                cur_s = str(cur)
                fx = FX_TO_USD.get(cur_s, FX_TO_USD.get(cur_s.upper(), 1.0))
                cap_str = _fmt_usd_cap(float(mcap) * fx)

            # Stage 2: Cascaded heavy .info call ONLY on 30-day cadence (or explicit flag)
            if need_leader:
                officers = (tk.info or {}).get("companyOfficers") or []
                leader_checked = True
                if officers:
                    ceo_str = _extract_live_ceo(officers)
            break
        except Exception as exc:
            msg = str(exc).lower()
            if ("429" in msg or "too many requests" in msg or "rate" in msg) and attempt < 2:
                time.sleep((2 ** attempt) + random.uniform(0.4, 1.2))
                continue
            break

    return domain, cap_str, ceo_str, leader_checked


def main() -> None:
    parser = argparse.ArgumentParser(description="Batched, sharded, cascaded entity facts refresher.")
    parser.add_argument("--mode", choices=["active", "stale", "all"], default="active")
    parser.add_argument("--batch-size", type=int, default=45, help="Max public entities per run (0 = unlimited).")
    parser.add_argument("--chunk-size", type=int, default=15, help="Tickers per paced chunk.")
    parser.add_argument("--workers", type=int, default=4, help="Concurrent workers per chunk.")
    parser.add_argument("--chunk-delay", type=float, default=0.8, help="Polite delay (seconds) between chunks.")
    parser.add_argument("--max-age-days", type=int, default=7, help="Staleness window for valuations.")
    parser.add_argument("--leader-max-age-days", type=int, default=30, help="Cadence for heavy .info CEO checks.")
    parser.add_argument("--refresh-leaders", action="store_true", help="Force Stage 2 CEO check on selected targets.")
    parser.add_argument("--rebalance", action="store_true", help="Force hot/cold shard rebalancing after refresh.")
    parser.add_argument("--dry-run", action="store_true", help="Print selected shard without calling yfinance or writing files.")
    args = parser.parse_args()

    data: dict[str, Any] = load_all_entities()
    companies: dict[str, dict[str, Any]] = data.get("companies", {})

    targets = _select_targets(
        companies,
        mode=args.mode,
        batch_size=args.batch_size,
        max_age_days=args.max_age_days,
        leader_max_age_days=args.leader_max_age_days,
        force_leaders=args.refresh_leaders,
    )
    leader_due_count = sum(1 for _, _, nl in targets if nl)
    if args.dry_run:
        print(f"[entities] DRY RUN mode={args.mode}: {len(targets)} targets ({leader_due_count} due for CEO check)")
        for d, s, nl in targets[:15]:
            print(f"  - {d} ({s}) leader_check={nl}")
        return

    updated_caps = 0
    checked_leaders = 0
    updated_ceos: list[str] = []

    for start in range(0, len(targets), args.chunk_size):
        chunk = targets[start : start + args.chunk_size]
        now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        chunk_dirty: set[str] = set()
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for domain, cap_str, ceo_str, leader_checked in pool.map(_fetch_one_cascaded, chunk):
                if cap_str:
                    companies[domain]["valuation"] = cap_str
                    companies[domain]["refreshed_at"] = now_utc
                    updated_caps += 1
                    chunk_dirty.add(domain)
                if leader_checked:
                    companies[domain]["leader_refreshed_at"] = now_utc
                    checked_leaders += 1
                    chunk_dirty.add(domain)
                if ceo_str and _surname_changed(str(companies[domain].get("leader") or ""), ceo_str):
                    old = companies[domain].get("leader")
                    companies[domain]["leader"] = ceo_str
                    updated_ceos.append(f"{companies[domain]['name']}: {old} -> {ceo_str}")
                    chunk_dirty.add(domain)

        # Checkpoint progress after each chunk (writes only dirty shards)
        if chunk_dirty:
            data["updated_at"] = now_utc
            save_entities_sharded(data, dirty_domains=chunk_dirty)

        if start + args.chunk_size < len(targets) and args.chunk_delay > 0:
            time.sleep(args.chunk_delay)

    rebal = rebalance_hot_shard(force=args.rebalance)
    print(
        f"[entities] mode={args.mode}: refreshed {updated_caps}/{len(targets)} valuations, "
        f"{checked_leaders} CEO checks (saved to {ENTITIES_DIR.relative_to(ENTITIES_DIR.parents[2])})"
    )
    if rebal.get("rebalanced"):
        print(
            f"[entities] Rebalanced shards ({rebal['reason']}): hot={rebal['hot_count']}, "
            f"promoted={len(rebal['promoted'])}, demoted={len(rebal['demoted'])}"
        )
    if updated_ceos:
        print("[entities] Updated CEOs:", "; ".join(updated_ceos))


if __name__ == "__main__":
    main()
