"""Refresh live market caps for public companies in briefing/data/company_facts.json."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yfinance as yf

from .config import DATA_DIR

FACTS_PATH = DATA_DIR / "company_facts.json"

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
    "DKK": 0.145,
}


def _fmt_usd_cap(usd_val: float) -> str:
    if usd_val >= 1e12:
        return f"~${usd_val / 1e12:.2f}T"
    if usd_val >= 1e9:
        return f"~${usd_val / 1e9:.0f}B"
    if usd_val >= 1e6:
        return f"~${usd_val / 1e6:.0f}M"
    return f"~${usd_val:,.0f}"


def _fetch_cap(item: tuple[str, str]) -> tuple[str, str | None]:
    domain, symbol = item
    try:
        tk = yf.Ticker(symbol)
        fi = tk.fast_info
        mcap = fi.get("marketCap") if hasattr(fi, "get") else getattr(fi, "market_cap", None)
        cur = (fi.get("currency") if hasattr(fi, "get") else getattr(fi, "currency", None)) or "USD"
        if mcap and float(mcap) > 0:
            usd = float(mcap) * FX_TO_USD.get(str(cur).upper(), 1.0)
            return domain, _fmt_usd_cap(usd)
    except Exception:
        pass
    return domain, None


def main() -> None:
    data: dict[str, Any] = json.loads(FACTS_PATH.read_text(encoding="utf-8"))
    companies: dict[str, dict[str, Any]] = data.get("companies", {})

    targets = [
        (domain, str(info["symbol"]))
        for domain, info in companies.items()
        if info.get("public") and info.get("symbol")
    ]

    updated = 0
    with ThreadPoolExecutor(max_workers=10) as pool:
        for domain, cap_str in pool.map(_fetch_cap, targets):
            if cap_str:
                companies[domain]["valuation"] = cap_str
                updated += 1

    now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    data["updated_at"] = now_utc
    FACTS_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[company_facts] Refreshed {updated}/{len(targets)} public market caps (updated_at={now_utc})")


if __name__ == "__main__":
    main()
