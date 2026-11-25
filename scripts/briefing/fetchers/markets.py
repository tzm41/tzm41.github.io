"""Stock market, macro asset, and 11 GICS sector ETF fetcher via yfinance."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from bs4 import BeautifulSoup
import yfinance as yf

from ..config import HTTP_TIMEOUT_SECONDS, MARKET_SECTORS, MARKET_WATCHLIST, USER_AGENT

# Mapping from Yahoo Finance tickers to Google Finance public quote slugs
GOOGLE_FINANCE_SLUGS: dict[str, str] = {
    "^GSPC": ".INX:INDEXSP",
    "^IXIC": ".IXIC:INDEXNASDAQ",
    "^DJI": ".DJI:INDEXDJX",
    "^RUT": "RUT:INDEXRUSSELL",
    "^VIX": "VIX:INDEXCBOE",
    "^TNX": "TNX:INDEXCBOE",
    "BTC-USD": "BTC-USD",
    "XLK": "XLK:NYSEARCA",
    "XLF": "XLF:NYSEARCA",
    "XLV": "XLV:NYSEARCA",
    "XLE": "XLE:NYSEARCA",
    "XLI": "XLI:NYSEARCA",
    "XLY": "XLY:NYSEARCA",
    "XLP": "XLP:NYSEARCA",
    "XLU": "XLU:NYSEARCA",
    "XLRE": "XLRE:NYSEARCA",
    "XLB": "XLB:NYSEARCA",
    "XLC": "XLC:NYSEARCA",
}


def _safe_float(val: Any, digits: int = 2) -> float:
    try:
        return round(float(val), digits)
    except (TypeError, ValueError):
        return 0.0


def _pct_change(current: float, previous: float) -> float:
    if not previous:
        return 0.0
    return round(((current - previous) / previous) * 100.0, 2)


def _fetch_google_finance_quote(client: httpx.Client, symbol: str) -> tuple[float, float] | None:
    """Fallback: parse public Google Finance quote page for (price, change_pct)."""
    slug = GOOGLE_FINANCE_SLUGS.get(symbol)
    if not slug:
        return None
    try:
        resp = client.get(
            f"https://www.google.com/finance/quote/{slug}",
            follow_redirects=True,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        el = soup.find(attrs={"data-last-price": True})
        if not el:
            return None
        price = float(el["data-last-price"])
        prev_attr = el.get("data-previous-close")
        if prev_attr:
            prev = float(prev_attr)
            return round(price, 2), _pct_change(price, prev)
        return round(price, 2), 0.0
    except Exception as exc:
        print(f"[markets] Google Finance fallback failed for {symbol}: {exc}")
        return None


def _fetch_markets_sync() -> tuple[dict[str, Any], str]:
    all_symbols = [item["symbol"] for item in MARKET_WATCHLIST] + [
        item["symbol"] for item in MARKET_SECTORS
    ]

    df = None
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

    def extract_closes(symbol: str) -> list[float]:
        if df is None or df.empty:
            return []
        try:
            if hasattr(df.columns, "get_level_values") and symbol in df.columns.get_level_values(0):
                series = df[symbol]["Close"].dropna()
            elif "Close" in df.columns:
                series = df["Close"].dropna()
            else:
                return []
            return [round(float(x), 2) for x in series.tolist()[-30:]]
        except Exception:
            return []

    gf_client: httpx.Client | None = None

    def get_gf_client() -> httpx.Client:
        nonlocal gf_client
        if gf_client is None:
            gf_client = httpx.Client(
                timeout=HTTP_TIMEOUT_SECONDS,
                headers={"User-Agent": USER_AGENT},
            )
        return gf_client

    watchlist: list[dict[str, Any]] = []
    for cfg in MARKET_WATCHLIST:
        closes = extract_closes(cfg["symbol"])
        if len(closes) >= 2:
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
        else:
            gf = _fetch_google_finance_quote(get_gf_client(), cfg["symbol"])
            if gf:
                price, chg = gf
                watchlist.append(
                    {
                        "symbol": cfg["symbol"],
                        "name": cfg["name"],
                        "group": cfg["group"],
                        "price": price,
                        "change_pct": chg,
                        "change_5d_pct": chg,
                        "sparkline_30d": [price],
                    }
                )

    sectors: list[dict[str, Any]] = []
    for cfg in MARKET_SECTORS:
        closes = extract_closes(cfg["symbol"])
        if len(closes) >= 2:
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
        else:
            gf = _fetch_google_finance_quote(get_gf_client(), cfg["symbol"])
            if gf:
                _, chg = gf
                sectors.append(
                    {
                        "symbol": cfg["symbol"],
                        "name": cfg["name"],
                        "change_pct": chg,
                        "change_5d_pct": chg,
                    }
                )

    if gf_client is not None:
        gf_client.close()

    if not watchlist and not sectors:
        return {"watchlist": [], "sectors": []}, "failed"

    health = "ok" if len(watchlist) >= 5 and len(sectors) >= 8 else "partial"
    return {"watchlist": watchlist, "sectors": sectors}, health


async def fetch_markets() -> tuple[dict[str, Any], str]:
    """Run yfinance download (with Google Finance fallback) in a worker thread."""
    return await asyncio.to_thread(_fetch_markets_sync)
