"""Configuration for the daily news & trends briefing pipeline."""

from __future__ import annotations

from pathlib import Path

# Repository paths
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "briefing" / "data"
ARCHIVE_DIR = DATA_DIR / "archive"
LATEST_PATH = DATA_DIR / "latest.json"
INDEX_PATH = DATA_DIR / "index.json"
MARKETS_LIVE_PATH = DATA_DIR / "markets_live.json"

# Retention
MAX_ARCHIVE_DAYS = 60
INDEX_HISTORY_DAYS = 30

# HTTP settings
HTTP_TIMEOUT_SECONDS = 15.0
USER_AGENT = "DailyBriefingBot/1.0 (+https://tzm41.github.io/briefing/)"

# Gemini settings
GEMINI_MODEL = "gemini-3.8-flash"
GEMINI_FALLBACK_MODELS: list[str] = [
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
]

# Curated free RSS feeds for Top News
NEWS_FEEDS: list[dict[str, str]] = [
    {"name": "BBC World", "category": "World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml"},
    {"name": "NPR News", "category": "World", "url": "https://feeds.npr.org/1001/rss.xml"},
    {"name": "Al Jazeera", "category": "World", "url": "https://www.aljazeera.com/xml/rss/all.xml"},
    {"name": "The Guardian World", "category": "World", "url": "https://www.theguardian.com/world/rss"},
    {"name": "Google News Business", "category": "Economy", "url": "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en"},
    {"name": "BBC Business", "category": "Economy", "url": "https://feeds.bbci.co.uk/news/business/rss.xml"},
    {"name": "CNBC Top News", "category": "Economy", "url": "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"},
    {"name": "Ars Technica", "category": "Tech", "url": "https://feeds.arstechnica.com/arstechnica/index"},
    {"name": "The Verge", "category": "Tech", "url": "https://www.theverge.com/rss/index.xml"},
    {"name": "Google News Science", "category": "Science", "url": "https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en"},
]

# Curated feeds for the daily Positive News highlight
POSITIVE_NEWS_FEEDS: list[dict[str, str]] = [
    {"name": "Good News Network", "category": "Science", "url": "https://www.goodnewsnetwork.org/feed/"},
    {"name": "Google News Positive Science", "category": "Science", "url": "https://news.google.com/rss/search?q=%28breakthrough+OR+conservation+OR+recovery+OR+milestone%29+when:3d&hl=en-US&gl=US&ceid=US:en"},
]

# Configurable local news regions (add more regions here as needed)
LOCAL_NEWS_REGIONS: list[dict[str, object]] = [
    {
        "id": "bay-area",
        "name": "Bay Area",
        "feeds": [
            {"name": "Google News Bay Area", "category": "World", "url": "https://news.google.com/rss/search?q=%28%22Bay+Area%22+OR+%22San+Francisco%22+OR+%22Silicon+Valley%22+OR+Oakland+OR+%22San+Jose%22%29+when:2d&hl=en-US&gl=US&ceid=US:en"},
        ],
    },
    {
        "id": "china",
        "name": "China",
        "language": "zh-CN",
        "feeds": [
            {"name": "BBC 中文", "category": "World", "url": "https://feeds.bbci.co.uk/zhongwen/simp/rss.xml"},
            {"name": "Google News 中国", "category": "World", "url": "https://news.google.com/rss/search?q=%E4%B8%AD%E5%9B%BD+when:2d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"},
        ],
    },
]

# Stock market watchlist tickers (Yahoo Finance)
MARKET_WATCHLIST: list[dict[str, str]] = [
    {"symbol": "^GSPC", "name": "S&P 500", "group": "Equity"},
    {"symbol": "^IXIC", "name": "Nasdaq", "group": "Equity"},
    {"symbol": "^DJI", "name": "Dow Jones", "group": "Equity"},
    {"symbol": "^RUT", "name": "Russell 2000", "group": "Equity"},
    {"symbol": "^VIX", "name": "VIX", "group": "Volatility"},
    {"symbol": "^TNX", "name": "US 10Y Yield", "group": "Rates"},
    {"symbol": "CL=F", "name": "WTI Crude", "group": "Commodities"},
    {"symbol": "GC=F", "name": "Gold", "group": "Commodities"},
    {"symbol": "BTC-USD", "name": "Bitcoin", "group": "Crypto"},
]

# Magnificent 7 mega-cap tech stocks (Yahoo Finance)
MARKET_BIG7: list[dict[str, str]] = [
    {"symbol": "AAPL", "name": "Apple", "group": "Big 7"},
    {"symbol": "MSFT", "name": "Microsoft", "group": "Big 7"},
    {"symbol": "GOOGL", "name": "Alphabet", "group": "Big 7"},
    {"symbol": "AMZN", "name": "Amazon", "group": "Big 7"},
    {"symbol": "NVDA", "name": "Nvidia", "group": "Big 7"},
    {"symbol": "META", "name": "Meta", "group": "Big 7"},
    {"symbol": "TSLA", "name": "Tesla", "group": "Big 7"},
]

FEAR_GREED_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"

# 11 GICS SPDR Sector ETFs
MARKET_SECTORS: list[dict[str, str]] = [
    {"symbol": "XLK", "name": "Technology"},
    {"symbol": "XLF", "name": "Financials"},
    {"symbol": "XLV", "name": "Health Care"},
    {"symbol": "XLE", "name": "Energy"},
    {"symbol": "XLI", "name": "Industrials"},
    {"symbol": "XLY", "name": "Cons. Discret."},
    {"symbol": "XLP", "name": "Cons. Staples"},
    {"symbol": "XLU", "name": "Utilities"},
    {"symbol": "XLRE", "name": "Real Estate"},
    {"symbol": "XLB", "name": "Materials"},
    {"symbol": "XLC", "name": "Comm. Services"},
]

# Tracked Global Conflict Theaters (GDELT 2.0 DOC queries + keywords)
CONFLICT_THEATERS: list[dict[str, str]] = [
    {
        "id": "ukraine",
        "name": "Eastern Europe / Ukraine",
        "region": "Europe",
        "gdelt_query": '(Ukraine OR Crimea OR Donbas) (war OR strike OR frontline OR military OR NATO)',
        "rss_query": "Ukraine war frontline military",
    },
    {
        "id": "middle-east",
        "name": "Middle East & Levant",
        "region": "Middle East",
        "gdelt_query": '(Gaza OR Israel OR Lebanon OR Hezbollah OR Iran OR Syria) (strike OR military OR ceasefire OR conflict)',
        "rss_query": "Middle East Israel Gaza Iran Lebanon conflict",
    },
    {
        "id": "indo-pacific",
        "name": "Indo-Pacific / Taiwan Strait",
        "region": "Asia-Pacific",
        "gdelt_query": '("Taiwan Strait" OR "South China Sea" OR "North Korea") (military OR navy OR missile OR tension)',
        "rss_query": "Taiwan Strait South China Sea North Korea military",
    },
    {
        "id": "sudan-horn",
        "name": "Sudan & Horn of Africa",
        "region": "Africa",
        "gdelt_query": '(Sudan OR Khartoum OR Darfur OR "Red Sea" OR Houthi) (conflict OR RSF OR attack OR shipping)',
        "rss_query": "Sudan conflict Red Sea Houthi",
    },
    {
        "id": "sahel-global",
        "name": "Sahel & Myanmar",
        "region": "Global Flashpoints",
        "gdelt_query": '(Myanmar OR Mali OR Niger OR "Burkina Faso" OR Congo OR DRC) (junta OR rebel OR clashes OR coup)',
        "rss_query": "Myanmar junta DRC Congo Sahel conflict",
    },
]

# US Politics RSS feeds & Polymarket endpoints
POLITICS_FEEDS: list[dict[str, str]] = [
    {"name": "NPR Politics", "url": "https://feeds.npr.org/1014/rss.xml"},
    {"name": "The Hill", "url": "https://thehill.com/feed/"},
    {"name": "Politico Politics", "url": "https://rss.politico.com/politics-news.xml"},
    {"name": "Google News US Politics", "url": "https://news.google.com/rss/headlines/section/topic/POLITICS?hl=en-US&gl=US&ceid=US:en"},
    {"name": "GovTrack Bills", "url": "https://www.govtrack.us/events/events.rss"},
]

POLYMARKET_GAMMA_URL = "https://gamma-api.polymarket.com/events"
