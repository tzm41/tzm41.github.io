"""Refresh live market caps for public companies in briefing/data/company_facts.json."""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yfinance as yf

from .config import DATA_DIR

FACTS_PATH = DATA_DIR / "company_facts.json"

_HONORIFIC_RE = re.compile(r"^(?:Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)\s+", re.IGNORECASE)
_SUFFIX_RE = re.compile(
    r",?\s+(?:Ph\.?D\.?|J\.?D\.?|M\.?D\.?|B\.?A\.?|B\.?S\.?(?:c\.?)?(?:\s*\([^)]*\))?(?:\s+Mgmt\.?)?|M\.?S\.?(?:c\.?)?(?:\s+[A-Z]{2,}(?:\s+[A-Z]{2,})*)?|M\.?B\.?A\.?|B\.?Com\.?|C\.?A\.?|F\.?C\.?A\.?|C\.?F\.?A\.?|LL\.?B\.?|LL\.?M\.?|D\.?V\.?M\.?|LCA|CPA|Jr\.|Sr\.|II|III)\b\.?",
    re.IGNORECASE,
)

# Approximate USD FX rates for non-USD market caps when ticker currency isn't USD
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
    """Return formatted CEO / Co-CEOs string from yfinance companyOfficers if unambiguous."""
    ceos: list[str] = []
    for o in officers:
        name = _clean_person_name(str(o.get("name") or ""))
        title = str(o.get("title") or "")
        tl = title.lower()
        # Skip divisional/subsidiary CEOs ("CEO of AWS", "Chief Executive Officer of ...") and staff roles
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
    """Only replace saved leader when the live CEO's surname is not already in saved."""
    saved_low = saved.lower()
    # Extract candidate surnames from live name(s) before parenthetical role
    base = re.sub(r"\s*\([^)]*\)\s*$", "", live)
    names = [n.strip() for n in base.split("&") if n.strip()]
    if not names:
        return False
    for n in names:
        tokens = n.split()
        if tokens and tokens[-1].lower() not in saved_low:
            return True
    return False


def _fetch_live_facts(item: tuple[str, str]) -> tuple[str, str | None, str | None]:
    domain, symbol = item
    cap_str: str | None = None
    ceo_str: str | None = None
    try:
        tk = yf.Ticker(symbol)
        fi = tk.fast_info
        mcap = fi.get("marketCap") if hasattr(fi, "get") else getattr(fi, "market_cap", None)
        cur = (fi.get("currency") if hasattr(fi, "get") else getattr(fi, "currency", None)) or "USD"
        if mcap and float(mcap) > 0:
            cur_s = str(cur)
            fx = FX_TO_USD.get(cur_s, FX_TO_USD.get(cur_s.upper(), 1.0))
            usd = float(mcap) * fx
            cap_str = _fmt_usd_cap(usd)
        officers = (tk.info or {}).get("companyOfficers") or []
        if officers:
            ceo_str = _extract_live_ceo(officers)
    except Exception:
        pass
    return domain, cap_str, ceo_str


def main() -> None:
    data: dict[str, Any] = json.loads(FACTS_PATH.read_text(encoding="utf-8"))
    companies: dict[str, dict[str, Any]] = data.get("companies", {})

    targets = [
        (domain, str(info["symbol"]))
        for domain, info in companies.items()
        if info.get("public") and info.get("symbol")
    ]

    updated_caps = 0
    updated_ceos: list[str] = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        for domain, cap_str, ceo_str in pool.map(_fetch_live_facts, targets):
            if cap_str:
                companies[domain]["valuation"] = cap_str
                updated_caps += 1
            if ceo_str and _surname_changed(str(companies[domain].get("leader") or ""), ceo_str):
                old = companies[domain].get("leader")
                companies[domain]["leader"] = ceo_str
                updated_ceos.append(f"{companies[domain]['name']}: {old} -> {ceo_str}")

    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data["updated_at"] = now_utc
    FACTS_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[company_facts] Refreshed {updated_caps}/{len(targets)} public market caps (updated_at={now_utc})")
    if updated_ceos:
        print("[company_facts] Updated CEOs:", "; ".join(updated_ceos))


if __name__ == "__main__":
    main()
