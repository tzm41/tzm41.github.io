"""Stock market, macro asset, and 11 GICS sector ETF fetcher via yfinance."""

from __future__ import annotations

import asyncio
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
from bs4 import BeautifulSoup
import yfinance as yf

from ..config import (
    FEAR_GREED_URL,
    HTTP_TIMEOUT_SECONDS,
    INLINE_TICKER_DIRECTORY,
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


def _download_df(symbols: list[str], period: str, interval: str, prepost: bool = False) -> Any:
    try:
        return yf.download(
            tickers=symbols,
            period=period,
            interval=interval,
            group_by="ticker",
            auto_adjust=True,
            prepost=prepost,
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


def _fmt_iso_utc(ts: Any) -> str:
    try:
        if getattr(ts, "tzinfo", None) is not None:
            return ts.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")
        return ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return str(ts)


def _fmt_date(ts: Any) -> str:
    try:
        return ts.strftime("%Y-%m-%d")
    except Exception:
        return str(ts)[:10]


def _merge_daily_closes(
    prior_30d: list[float],
    prior_30d_times: list[str],
    recent_5d: list[float],
    recent_5d_times: list[str],
) -> tuple[list[float], list[str]] | None:
    """Stitch new daily closes & dates from a 5D fetch onto yesterday's cached 30D series."""
    if len(prior_30d) < 20 or len(prior_30d_times) != len(prior_30d) or not recent_5d:
        return None
    anchor_val = prior_30d[-1]
    anchor_date = prior_30d_times[-1]
    # Exact date match: overwrite anchor_date so intraday/closing updates replace stale morning values
    for idx in range(len(recent_5d) - 1, -1, -1):
        if recent_5d_times[idx] == anchor_date:
            merged_vals = (prior_30d[:-1] + recent_5d[idx:])[-30:]
            merged_times = (prior_30d_times[:-1] + recent_5d_times[idx:])[-30:]
            return merged_vals, merged_times
    for idx in range(len(recent_5d) - 1, -1, -1):
        if abs(recent_5d[idx] - anchor_val) <= 0.02:
            merged_vals = (prior_30d + recent_5d[idx + 1 :])[-30:]
            merged_times = (prior_30d_times + recent_5d_times[idx + 1 :])[-30:]
            return merged_vals, merged_times
    return None


def _download_timeframes(
    quote_symbols: list[str],
    sector_symbols: list[str] | None = None,
    include_intraday: bool = True,
    prior_map: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Download 5D daily (stitching cached 30D when possible), 5D hourly, and 1D 30-min closes in parallel."""
    all_daily_symbols = list(quote_symbols) + list(sector_symbols or [])

    with ThreadPoolExecutor(max_workers=3) as pool:
        fut_5d_daily = pool.submit(_download_df, all_daily_symbols, "5d", "1d")
        fut_5d_1h = pool.submit(_download_df, quote_symbols, "5d", "1h") if include_intraday else None
        fut_1d_15m = pool.submit(_download_df, quote_symbols, "2d", "15m", True) if include_intraday else None

        df_5d_daily = fut_5d_daily.result()

        # Determine which symbols can reuse cached 30D history vs needing a 45D backfill
        stitched_30d: dict[str, tuple[list[float], list[str]]] = {}
        need_45d: list[str] = []
        for sym in all_daily_symbols:
            s5_daily = _extract_series(df_5d_daily, sym)
            recent_vals = [round(float(x), 2) for x in s5_daily.tolist()] if s5_daily is not None else []
            recent_times = [_fmt_date(ts) for ts in s5_daily.index] if s5_daily is not None else []
            prior_q = (prior_map or {}).get(sym, {})
            merged = _merge_daily_closes(
                prior_q.get("sparkline_30d", []),
                prior_q.get("sparkline_30d_times", []),
                recent_vals,
                recent_times,
            )
            if merged is not None:
                stitched_30d[sym] = merged
            else:
                need_45d.append(sym)

        df_45d = _download_df(need_45d, "45d", "1d") if need_45d else None
        df_5d = fut_5d_1h.result() if fut_5d_1h else None
        df_1d = fut_1d_15m.result() if fut_1d_15m else None

    if stitched_30d:
        print(f"[markets] Reused cached 30D history for {len(stitched_30d)}/{len(all_daily_symbols)} symbols.")

    def get_30d(symbol: str) -> tuple[list[float], list[str]]:
        if symbol in stitched_30d:
            return stitched_30d[symbol]
        s = _extract_series(df_45d, symbol)
        if s is not None:
            tail = s.iloc[-30:]
            return [round(float(x), 2) for x in tail.tolist()], [_fmt_date(ts) for ts in tail.index]
        prior_q = (prior_map or {}).get(symbol, {})
        return prior_q.get("sparkline_30d", []), prior_q.get("sparkline_30d_times", [])

    def get_5d(symbol: str) -> tuple[list[float], list[str]]:
        s = _extract_series(df_5d, symbol)
        if s is not None:
            return [round(float(x), 2) for x in s.tolist()], [_fmt_iso_utc(ts) for ts in s.index]
        prior_q = (prior_map or {}).get(symbol, {})
        return prior_q.get("sparkline_5d", []), prior_q.get("sparkline_5d_times", [])

    def get_1d(symbol: str) -> tuple[list[float], list[str]]:
        s = _extract_series(df_1d, symbol)
        if s is None:
            prior_q = (prior_map or {}).get(symbol, {})
            return prior_q.get("sparkline_1d", []), prior_q.get("sparkline_1d_times", [])
        if symbol == "BTC-USD":
            cutoff = s.index[-1] - pd.Timedelta(hours=24)
            sliced = s[s.index >= cutoff]
            if len(sliced) < 2:
                sliced = s.iloc[-96:]
            return [round(float(x), 2) for x in sliced.tolist()], [_fmt_iso_utc(ts) for ts in sliced.index]
        idx_ny = (
            s.index.tz_convert("America/New_York")
            if getattr(s.index, "tz", None) is not None
            else s.index
        )
        is_full_day = symbol in {"CL=F", "GC=F"}
        unique_days = sorted({ts.date() for ts in idx_ny})
        sliced = s.iloc[0:0]
        for day in reversed(unique_days):
            day_mask = idx_ny.date == day
            if is_full_day:
                cand = s[day_mask]
            else:
                open_mask = day_mask & (
                    (idx_ny.hour > 9) | ((idx_ny.hour == 9) & (idx_ny.minute >= 30))
                )
                cand = s[open_mask] if int(open_mask.sum()) >= 2 else s[day_mask]
            if len(cand) >= 2:
                sliced = cand
                break
        if len(sliced) < 2:
            sliced = s.iloc[-28:]
        return [round(float(x), 2) for x in sliced.tolist()], [_fmt_iso_utc(ts) for ts in sliced.index]

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
        closes, closes_times = tf_extractors["30d"](sym)
        if len(closes) >= 2:
            latest = closes[-1]
            prev_1d = closes[-2]
            prev_5d = closes[-6] if len(closes) >= 6 else closes[0]
            prev_30d = closes[0]
            s1d, t1d = tf_extractors["1d"](sym)
            s5d, t5d = tf_extractors["5d"](sym)
            if s1d and t1d and closes_times:
                try:
                    last_1d_ny = pd.Timestamp(t1d[-1]).tz_convert("America/New_York").strftime("%Y-%m-%d")
                except Exception:
                    last_1d_ny = t1d[-1][:10]
                if last_1d_ny > closes_times[-1]:
                    prev_1d = closes[-1]
                    latest = s1d[-1]
                elif last_1d_ny == closes_times[-1]:
                    latest = s1d[-1]
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
                    "sparkline_1d_times": t1d if len(s1d) >= 2 else closes_times[-2:],
                    "sparkline_5d": s5d if len(s5d) >= 2 else closes[-6:],
                    "sparkline_5d_times": t5d if len(s5d) >= 2 else closes_times[-6:],
                    "sparkline_30d": closes,
                    "sparkline_30d_times": closes_times,
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
                        "sparkline_1d_times": [],
                        "sparkline_5d": [price],
                        "sparkline_5d_times": [],
                        "sparkline_30d": [price],
                        "sparkline_30d_times": [],
                    }
                )
    return quotes


_NY_TZ = ZoneInfo("America/New_York")


def _us_market_holidays(year: int) -> set[date]:
    """Fixed + nth-weekday major NYSE/US market holidays."""
    from datetime import timedelta

    def nth_weekday(month: int, weekday: int, n: int) -> date:
        d = date(year, month, 1)
        offset = (weekday - d.weekday()) % 7
        return d + timedelta(days=offset + (n - 1) * 7)

    def last_weekday(month: int, weekday: int) -> date:
        nxt = date(year + (1 if month == 12 else 0), (month % 12) + 1, 1)
        d = nxt - timedelta(days=1)
        return d - timedelta(days=(d.weekday() - weekday) % 7)

    def observed(d: date) -> date:
        if d.weekday() == 5:
            return d - timedelta(days=1)
        if d.weekday() == 6:
            return d + timedelta(days=1)
        return d

    return {
        observed(date(year, 1, 1)),   # New Year's Day
        nth_weekday(1, 0, 3),         # MLK Jr. Day (3rd Mon Jan)
        nth_weekday(2, 0, 3),         # Presidents' Day (3rd Mon Feb)
        last_weekday(5, 0),           # Memorial Day (last Mon May)
        observed(date(year, 6, 19)),  # Juneteenth
        observed(date(year, 7, 4)),   # Independence Day
        nth_weekday(9, 0, 1),         # Labor Day (1st Mon Sep)
        nth_weekday(11, 3, 4),        # Thanksgiving (4th Thu Nov)
        observed(date(year, 12, 25)), # Christmas
    }


def is_symbol_trading_now(symbol: str, now_utc: datetime | None = None) -> bool:
    """Return True if the given symbol is currently in an active trading session (ET)."""
    if symbol == "BTC-USD":
        return True
    now_et = (now_utc or datetime.now(timezone.utc)).astimezone(_NY_TZ)
    wd = now_et.weekday()  # 0=Mon .. 6=Sun
    mins = now_et.hour * 60 + now_et.minute
    is_holiday = now_et.date() in _us_market_holidays(now_et.year)

    # CME Globex futures (WTI Crude, Gold): Sun 18:00 ET -> Fri 17:00 ET (17:00-18:00 ET break)
    if symbol in {"CL=F", "GC=F"}:
        if wd == 5:  # Saturday
            return False
        if wd == 6:  # Sunday opens 18:00 ET
            return mins >= 18 * 60
        if wd == 4 and mins >= 17 * 60:  # Friday closes 17:00 ET
            return False
        if 17 * 60 <= mins < 18 * 60:  # Daily maintenance break
            return False
        if is_holiday and mins >= 13 * 60:  # Holiday early halt
            return False
        return True

    # CBOE VIX: Mon-Fri 03:15-16:15 ET (early holiday close 11:30 ET)
    if symbol == "^VIX":
        if wd >= 5:
            return False
        end_min = 11 * 60 + 30 if is_holiday else 16 * 60 + 15
        return 3 * 60 + 15 <= mins <= end_min

    # US equities, indices, sector ETFs, 10Y yield: Mon-Fri 04:00-20:00 ET (incl. pre/aftermarket)
    if wd >= 5 or is_holiday:
        return False
    return 4 * 60 <= mins <= 20 * 60


def _fetch_markets_sync(
    prior_markets: dict[str, Any] | None = None,
    active_only: bool = False,
) -> tuple[dict[str, Any], str]:
    quote_symbols = [item["symbol"] for item in MARKET_WATCHLIST] + [
        item["symbol"] for item in MARKET_BIG7
    ]
    sector_symbols = [item["symbol"] for item in MARKET_SECTORS]

    prior_map: dict[str, dict[str, Any]] = {}
    prior_sector_map: dict[str, dict[str, Any]] = {}
    if prior_markets:
        for q in prior_markets.get("watchlist", []) + prior_markets.get("big7", []):
            if q.get("symbol"):
                prior_map[q["symbol"]] = q
        for s in prior_markets.get("sectors", []):
            if s.get("symbol"):
                prior_sector_map[s["symbol"]] = s

    if active_only and prior_map:
        active_quote_syms = [
            s for s in quote_symbols if is_symbol_trading_now(s) or s not in prior_map
        ]
        active_sector_syms = [
            s for s in sector_symbols if is_symbol_trading_now(s) or s not in prior_sector_map
        ]
        skipped = (len(quote_symbols) - len(active_quote_syms)) + (
            len(sector_symbols) - len(active_sector_syms)
        )
        print(
            f"[markets] Active-only refresh: fetching {len(active_quote_syms) + len(active_sector_syms)}/"
            f"{len(quote_symbols) + len(sector_symbols)} trading symbols (reusing {skipped} closed-market snapshots)."
        )
    else:
        active_quote_syms = quote_symbols
        active_sector_syms = sector_symbols

    active_quote_set = set(active_quote_syms)
    active_sector_set = set(active_sector_syms)

    tf_all = (
        _download_timeframes(
            active_quote_syms,
            sector_symbols=active_sector_syms,
            include_intraday=True,
            prior_map=prior_map,
        )
        if (active_quote_syms or active_sector_syms)
        else {"1d": lambda s: ([], []), "5d": lambda s: ([], []), "30d": lambda s: ([], [])}
    )

    gf_client: httpx.Client | None = None

    def get_gf_client() -> httpx.Client:
        nonlocal gf_client
        if gf_client is None:
            gf_client = httpx.Client(
                timeout=HTTP_TIMEOUT_SECONDS,
                headers={"User-Agent": USER_AGENT},
            )
        return gf_client

    def build_or_reuse(configs: list[dict[str, str]]) -> list[dict[str, Any]]:
        active_cfgs = [c for c in configs if c["symbol"] in active_quote_set]
        fresh_map = {q["symbol"]: q for q in _build_quote_list(active_cfgs, tf_all, get_gf_client)}
        out: list[dict[str, Any]] = []
        for cfg in configs:
            sym = cfg["symbol"]
            if sym in fresh_map:
                out.append(fresh_map[sym])
            elif sym in prior_map:
                out.append(prior_map[sym])
        return out

    watchlist = build_or_reuse(MARKET_WATCHLIST)
    big7 = build_or_reuse(MARKET_BIG7)

    sectors: list[dict[str, Any]] = []
    for cfg in MARKET_SECTORS:
        sym = cfg["symbol"]
        if sym not in active_sector_set and sym in prior_sector_map:
            sectors.append(prior_sector_map[sym])
            continue
        closes, _ = tf_all["30d"](sym)
        if len(closes) >= 2:
            latest = closes[-1]
            prev_1d = closes[-2]
            prev_5d = closes[-6] if len(closes) >= 6 else closes[0]
            sectors.append(
                {
                    "symbol": sym,
                    "name": cfg["name"],
                    "change_pct": _pct_change(latest, prev_1d),
                    "change_5d_pct": _pct_change(latest, prev_5d),
                    "change_30d_pct": _pct_change(latest, closes[0]),
                }
            )
        else:
            gf = _fetch_google_finance_quote(get_gf_client(), sym)
            if gf:
                _, chg = gf
                sectors.append(
                    {
                        "symbol": sym,
                        "name": cfg["name"],
                        "change_pct": chg,
                        "change_5d_pct": chg,
                        "change_30d_pct": chg,
                    }
                )
            elif sym in prior_sector_map:
                sectors.append(prior_sector_map[sym])

    fear_greed = (
        (prior_markets or {}).get("fear_greed")
        if (active_only and not active_sector_syms and (prior_markets or {}).get("fear_greed"))
        else (_fetch_fear_greed(get_gf_client()) or (prior_markets or {}).get("fear_greed"))
    )

    if gf_client is not None:
        gf_client.close()

    if not watchlist and not sectors and not big7:
        if prior_markets:
            return prior_markets, "partial"
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


def fetch_mentioned_quotes(texts: list[str]) -> list[dict[str, Any]]:
    """Scan briefing texts for mentioned global public stocks and fetch lightweight 1D quotes."""
    combined = "\n".join(t for t in texts if t)
    if not combined:
        return []

    matched: list[tuple[str, str, str, list[str]]] = []
    for sym, (name, currency, aliases) in INLINE_TICKER_DIRECTORY.items():
        found_aliases: list[str] = []
        for alias in aliases:
            is_ascii = all(ord(ch) < 128 for ch in alias)
            if is_ascii:
                if re.search(rf"\b{re.escape(alias)}\b", combined):
                    found_aliases.append(alias)
            elif alias in combined:
                found_aliases.append(alias)
        if found_aliases:
            matched.append((sym, name, currency, found_aliases))

    if not matched:
        return []

    symbols = [m[0] for m in matched]
    df = _download_df(symbols, "5d", "1d")
    results: list[dict[str, Any]] = []
    for sym, name, currency, aliases in matched:
        s = _extract_series(df, sym)
        if s is None or len(s) < 2:
            continue
        latest = _safe_float(s.iloc[-1], 2)
        prev = _safe_float(s.iloc[-2], 2)
        results.append(
            {
                "symbol": sym,
                "name": name,
                "price": latest,
                "change_pct": _pct_change(latest, prev),
                "currency": currency,
                "aliases": aliases,
            }
        )
    if results:
        print(f"[markets] Fetched {len(results)} mentioned inline quotes: {[r['symbol'] for r in results]}")
    return results


async def fetch_markets(
    prior_markets: dict[str, Any] | None = None,
    active_only: bool = False,
) -> tuple[dict[str, Any], str]:
    """Run yfinance download (with cached 30D reuse & Google Finance fallback) in a worker thread."""
    return await asyncio.to_thread(_fetch_markets_sync, prior_markets, active_only)
