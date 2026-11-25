"""Stock market, macro asset, and 11 GICS sector ETF fetcher via yfinance."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
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


def _download_closes_map(symbols: list[str]):
    """Download 45d daily closes for a list of Yahoo Finance symbols."""
    df = None
    try:
        df = yf.download(
            tickers=symbols,
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

    return extract_closes


def _build_quote_list(
    configs: list[dict[str, str]],
    extract_closes: Any,
    get_gf_client: Any,
) -> list[dict[str, Any]]:
    """Build MarketQuote dicts from yfinance closes with Google Finance fallback."""
    quotes: list[dict[str, Any]] = []
    for cfg in configs:
        closes = extract_closes(cfg["symbol"])
        if len(closes) >= 2:
            latest = closes[-1]
            prev_1d = closes[-2]
            prev_5d = closes[-6] if len(closes) >= 6 else closes[0]
            quotes.append(
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
                quotes.append(
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
    return quotes


def _fetch_markets_sync() -> tuple[dict[str, Any], str]:
    all_symbols = (
        [item["symbol"] for item in MARKET_WATCHLIST]
        + [item["symbol"] for item in MARKET_BIG7]
        + [item["symbol"] for item in MARKET_SECTORS]
    )
    extract_closes = _download_closes_map(all_symbols)

    gf_client: httpx.Client | None = None

    def get_gf_client() -> httpx.Client:
        nonlocal gf_client
        if gf_client is None:
            gf_client = httpx.Client(
                timeout=HTTP_TIMEOUT_SECONDS,
                headers={"User-Agent": USER_AGENT},
            )
        return gf_client

    watchlist = _build_quote_list(MARKET_WATCHLIST, extract_closes, get_gf_client)
    big7 = _build_quote_list(MARKET_BIG7, extract_closes, get_gf_client)

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
    extract_closes = _download_closes_map([item["symbol"] for item in MARKET_BIG7])
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, headers={"User-Agent": USER_AGENT}) as client:
        big7 = _build_quote_list(MARKET_BIG7, extract_closes, lambda: client)
        fear_greed = _fetch_fear_greed(client)
    return big7, fear_greed


async def fetch_markets() -> tuple[dict[str, Any], str]:
    """Run yfinance download (with Google Finance fallback) in a worker thread."""
    return await asyncio.to_thread(_fetch_markets_sync)
