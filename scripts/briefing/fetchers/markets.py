"""Stock market, macro asset, and 11 GICS sector ETF fetcher via yfinance."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pandas as pd
from bs4 import BeautifulSoup
import yfinance as yf

from ..config import (
    FEAR_GREED_URL,
    HTTP_TIMEOUT_SECONDS,
    MARKET_BIG7,
    MARKET_SECTORS,
    MARKET_WATCHLIST,
    USER_AGENT,
)

# Mapping from Yahoo Finance tickers to Google Finance public quote slugs
GOOGLE_FINANCE_SLUGS: dict[str, str] = {
    "^GSPC": ".INX:INDEXSP",
    "^IXIC": ".IXIC:INDEXNASDAQ",
    "^DJI": ".DJI:INDEXDJX",
    "^RUT": "RUT:INDEXRUSSELL",
    "^VIX": "VIX:INDEXCBOE",
    "^TNX": "TNX:INDEXCBOE",
    "BTC-USD": "BTC-USD",
    "AAPL": "AAPL:NASDAQ",
    "MSFT": "MSFT:NASDAQ",
    "GOOGL": "GOOGL:NASDAQ",
    "AMZN": "AMZN:NASDAQ",
    "NVDA": "NVDA:NASDAQ",
    "META": "META:NASDAQ",
    "TSLA": "TSLA:NASDAQ",
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


def _fetch_fear_greed(client: httpx.Client) -> dict[str, Any] | None:
    """Fetch CNN Market Fear & Greed Index score, rating, and historical benchmarks."""
    try:
        resp = client.get(
            FEAR_GREED_URL,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
                )
            },
            follow_redirects=True,
        )
        resp.raise_for_status()
        fg = resp.json().get("fear_and_greed") or {}
        if fg.get("score") is None:
            return None
        return {
            "score": _safe_float(fg.get("score"), 1),
            "rating": str(fg.get("rating") or "neutral").title(),
            "previous_close": _safe_float(fg.get("previous_close"), 1) if fg.get("previous_close") is not None else None,
            "previous_1_week": _safe_float(fg.get("previous_1_week"), 1) if fg.get("previous_1_week") is not None else None,
            "previous_1_month": _safe_float(fg.get("previous_1_month"), 1) if fg.get("previous_1_month") is not None else None,
            "previous_1_year": _safe_float(fg.get("previous_1_year"), 1) if fg.get("previous_1_year") is not None else None,
        }
    except Exception as exc:
        print(f"[markets] Fear & Greed fetch failed: {exc}")
        return None


def _download_df(symbols: list[str], period: str, interval: str) -> Any:
    try:
        return yf.download(
            tickers=symbols,
            period=period,
            interval=interval,
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )
    except Exception as exc:
        print(f"[markets] yfinance download failed ({period}/{interval}): {exc}")
        return None


def _extract_series(df: Any, symbol: str) -> Any:
    if df is None or df.empty:
        return None
    try:
        if hasattr(df.columns, "get_level_values") and symbol in df.columns.get_level_values(0):
            series = df[symbol]["Close"].dropna()
        elif "Close" in df.columns:
            series = df["Close"].dropna()
        else:
            return None
        return series if not series.empty else None
    except Exception:
        return None


def _download_timeframes(symbols: list[str], include_intraday: bool = True) -> dict[str, Any]:
    """Download 30D daily, 5D hourly, and 1D 30-min closes for symbols."""
    df_30d = _download_df(symbols, "45d", "1d")
    df_5d = _download_df(symbols, "5d", "1h") if include_intraday else None
    df_1d = _download_df(symbols, "2d", "30m") if include_intraday else None

    def get_30d(symbol: str) -> list[float]:
        s = _extract_series(df_30d, symbol)
        return [round(float(x), 2) for x in s.tolist()[-30:]] if s is not None else []

    def get_5d(symbol: str) -> list[float]:
        s = _extract_series(df_5d, symbol)
        return [round(float(x), 2) for x in s.tolist()] if s is not None else []

    def get_1d(symbol: str) -> list[float]:
        s = _extract_series(df_1d, symbol)
        if s is None:
            return []
        cutoff = s.index[-1] - pd.Timedelta(hours=24)
        sliced = s[s.index >= cutoff]
        if len(sliced) < 2:
            sliced = s.iloc[-14:]
        return [round(float(x), 2) for x in sliced.tolist()]

    return {"1d": get_1d, "5d": get_5d, "30d": get_30d}


def _build_quote_list(
    configs: list[dict[str, str]],
    tf_extractors: dict[str, Any],
    get_gf_client: Any,
) -> list[dict[str, Any]]:
    """Build MarketQuote dicts from yfinance closes with Google Finance fallback."""
    quotes: list[dict[str, Any]] = []
    for cfg in configs:
        sym = cfg["symbol"]
        closes = tf_extractors["30d"](sym)
        if len(closes) >= 2:
            latest = closes[-1]
            prev_1d = closes[-2]
            prev_5d = closes[-6] if len(closes) >= 6 else closes[0]
            prev_30d = closes[0]
            s1d = tf_extractors["1d"](sym)
            s5d = tf_extractors["5d"](sym)
            quotes.append(
                {
                    "symbol": sym,
                    "name": cfg["name"],
                    "group": cfg["group"],
                    "price": _safe_float(latest, 2),
                    "change_pct": _pct_change(latest, prev_1d),
                    "change_5d_pct": _pct_change(latest, prev_5d),
                    "change_30d_pct": _pct_change(latest, prev_30d),
                    "sparkline_1d": s1d if len(s1d) >= 2 else closes[-2:],
                    "sparkline_5d": s5d if len(s5d) >= 2 else closes[-6:],
                    "sparkline_30d": closes,
                }
            )
        else:
            gf = _fetch_google_finance_quote(get_gf_client(), sym)
            if gf:
                price, chg = gf
                quotes.append(
                    {
                        "symbol": sym,
                        "name": cfg["name"],
                        "group": cfg["group"],
                        "price": price,
                        "change_pct": chg,
                        "change_5d_pct": chg,
                        "change_30d_pct": chg,
                        "sparkline_1d": [price],
                        "sparkline_5d": [price],
                        "sparkline_30d": [price],
                    }
                )
    return quotes


def _fetch_markets_sync() -> tuple[dict[str, Any], str]:
    quote_symbols = [item["symbol"] for item in MARKET_WATCHLIST] + [
        item["symbol"] for item in MARKET_BIG7
    ]
    sector_symbols = [item["symbol"] for item in MARKET_SECTORS]

    tf_quotes = _download_timeframes(quote_symbols, include_intraday=True)
    tf_sectors = _download_timeframes(sector_symbols, include_intraday=False)

    gf_client: httpx.Client | None = None

    def get_gf_client() -> httpx.Client:
        nonlocal gf_client
        if gf_client is None:
            gf_client = httpx.Client(
                timeout=HTTP_TIMEOUT_SECONDS,
                headers={"User-Agent": USER_AGENT},
            )
        return gf_client

    watchlist = _build_quote_list(MARKET_WATCHLIST, tf_quotes, get_gf_client)
    big7 = _build_quote_list(MARKET_BIG7, tf_quotes, get_gf_client)

    sectors: list[dict[str, Any]] = []
    for cfg in MARKET_SECTORS:
        closes = tf_sectors["30d"](cfg["symbol"])
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
                    "change_30d_pct": _pct_change(latest, closes[0]),
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
                        "change_30d_pct": chg,
                    }
                )

    fear_greed = _fetch_fear_greed(get_gf_client())

    if gf_client is not None:
        gf_client.close()

    if not watchlist and not sectors and not big7:
        return {"watchlist": [], "big7": [], "fear_greed": None, "sectors": []}, "failed"

    health = "ok" if len(watchlist) >= 5 and len(sectors) >= 8 else "partial"
    return {
        "watchlist": watchlist,
        "big7": big7,
        "fear_greed": fear_greed,
        "sectors": sectors,
    }, health


def fetch_big7_and_fear_greed() -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Fetch only Big 7 tickers and Fear & Greed Index (for incremental enrichment)."""
    tf_extractors = _download_timeframes([item["symbol"] for item in MARKET_BIG7], include_intraday=True)
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        big7 = _build_quote_list(MARKET_BIG7, tf_extractors, lambda: client)
        fear_greed = _fetch_fear_greed(client)
    return big7, fear_greed


async def fetch_markets() -> tuple[dict[str, Any], str]:
    """Run yfinance download (with Google Finance fallback) in a worker thread."""
    return await asyncio.to_thread(_fetch_markets_sync)
