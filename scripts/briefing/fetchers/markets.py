"""Stock market, macro asset, and 11 GICS sector ETF fetcher via yfinance."""

from __future__ import annotations

import asyncio
from typing import Any

import yfinance as yf

from ..config import MARKET_SECTORS, MARKET_WATCHLIST


def _safe_float(val: Any, digits: int = 2) -> float:
    try:
        return round(float(val), digits)
    except (TypeError, ValueError):
        return 0.0


def _pct_change(current: float, previous: float) -> float:
    if not previous:
        return 0.0
    return round(((current - previous) / previous) * 100.0, 2)


def _fetch_markets_sync() -> tuple[dict[str, Any], str]:
    all_symbols = [item["symbol"] for item in MARKET_WATCHLIST] + [
        item["symbol"] for item in MARKET_SECTORS
    ]

    try:
        df = yf.download(
            tickers=all_symbols,
            period="45d",
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as exc:
        print(f"[markets] yfinance download failed: {exc}")
        return {"watchlist": [], "sectors": []}, "failed"

    if df is None or df.empty:
        return {"watchlist": [], "sectors": []}, "failed"

    def extract_closes(symbol: str) -> list[float]:
        try:
            if isinstance(df.columns, type(df.columns)) and symbol in df.columns.get_level_values(0):
                series = df[symbol]["Close"].dropna()
            elif "Close" in df.columns:
                series = df["Close"].dropna()
            else:
                return []
            return [round(float(x), 2) for x in series.tolist()[-30:]]
        except Exception:
            return []

    watchlist: list[dict[str, Any]] = []
    for cfg in MARKET_WATCHLIST:
        closes = extract_closes(cfg["symbol"])
        if len(closes) < 2:
            continue
        latest = closes[-1]
        prev_1d = closes[-2]
        prev_5d = closes[-6] if len(closes) >= 6 else closes[0]
        watchlist.append(
            {
                "symbol": cfg["symbol"],
                "name": cfg["name"],
                "group": cfg["group"],
                "price": _safe_float(latest, 2),
                "change_pct": _pct_change(latest, prev_1d),
                "change_5d_pct": _pct_change(latest, prev_5d),
                "sparkline_30d": closes,
            }
        )

    sectors: list[dict[str, Any]] = []
    for cfg in MARKET_SECTORS:
        closes = extract_closes(cfg["symbol"])
        if len(closes) < 2:
            continue
        latest = closes[-1]
        prev_1d = closes[-2]
        prev_5d = closes[-6] if len(closes) >= 6 else closes[0]
        sectors.append(
            {
                "symbol": cfg["symbol"],
                "name": cfg["name"],
                "change_pct": _pct_change(latest, prev_1d),
                "change_5d_pct": _pct_change(latest, prev_5d),
            }
        )

    if not watchlist and not sectors:
        return {"watchlist": [], "sectors": []}, "failed"

    health = "ok" if len(watchlist) >= 5 and len(sectors) >= 8 else "partial"
    return {"watchlist": watchlist, "sectors": sectors}, health


async def fetch_markets() -> tuple[dict[str, Any], str]:
    """Run yfinance download in a worker thread."""
    return await asyncio.to_thread(_fetch_markets_sync)
