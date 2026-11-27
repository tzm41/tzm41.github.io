"""Configuration for the Weekly Briefing (Science, Culture, Arts & History) pipeline."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "weekly" / "data"
ARCHIVE_DIR = DATA_DIR / "archive"
LATEST_PATH = DATA_DIR / "latest.json"
INDEX_PATH = DATA_DIR / "index.json"
DAILY_ARCHIVE_DIR = REPO_ROOT / "briefing" / "data" / "archive"

MAX_ARCHIVE_WEEKS = 52
HTTP_TIMEOUT_SECONDS = 16.0
USER_AGENT = "WeeklyBriefingBot/1.0 (+https://colintan.dev/weekly/)"

SCIENCE_FEEDS: list[dict[str, str]] = [
    {"name": "Quanta Magazine", "category": "Science", "url": "https://www.quantamagazine.org/feed/"},
    {"name": "Nature", "category": "Science", "url": "https://www.nature.com/nature.rss"},
    {"name": "ScienceDaily", "category": "Science", "url": "https://www.sciencedaily.com/rss/top/science.xml"},
    {"name": "Ars Technica", "category": "Science", "url": "https://feeds.arstechnica.com/arstechnica/science"},
    {"name": "Phys.org", "category": "Science", "url": "https://phys.org/rss-feed/breaking/"},
    {"name": "NASA", "category": "Space", "url": "https://www.nasa.gov/rss/dyn/breaking_news.rss"},
    {"name": "Smithsonian", "category": "Science", "url": "https://www.smithsonianmag.com/rss/science-nature/"},
]

CULTURE_FEEDS: list[dict[str, str]] = [
    {"name": "Smithsonian", "category": "Culture", "url": "https://www.smithsonianmag.com/rss/arts-culture/"},
    {"name": "Artnet News", "category": "Visual Arts", "url": "https://news.artnet.com/feed"},
    {"name": "Colossal", "category": "Design & Art", "url": "https://www.thisiscolossal.com/feed/"},
    {"name": "Open Culture", "category": "Culture", "url": "https://www.openculture.com/feed"},
    {"name": "Literary Hub", "category": "Literature", "url": "https://lithub.com/feed/"},
    {"name": "ArchDaily", "category": "Architecture", "url": "https://www.archdaily.com/rss/"},
    {"name": "Dezeen", "category": "Architecture", "url": "https://www.dezeen.com/feed/"},
    {"name": "The Guardian", "category": "Culture", "url": "https://www.theguardian.com/culture/rss"},
]

HISTORY_FEEDS: list[dict[str, str]] = [
    {"name": "Smithsonian", "category": "History", "url": "https://www.smithsonianmag.com/rss/history/"},
    {"name": "Archaeology", "category": "Archaeology", "url": "https://www.archaeology.org/feed/"},
    {"name": "Public Domain Review", "category": "Archives", "url": "https://publicdomainreview.org/rss.xml"},
    {"name": "Atlas Obscura", "category": "History & Place", "url": "https://www.atlasobscura.com/feeds/latest"},
    {"name": "Lapham's Quarterly", "category": "History", "url": "https://www.laphamsquarterly.org/rss.xml"},
    {"name": "HeritageDaily", "category": "Archaeology", "url": "https://www.heritagedaily.com/feed"},
]

LONGREAD_FEEDS: list[dict[str, str]] = [
    {"name": "Aeon", "category": "Philosophy & Ideas", "url": "https://aeon.co/feed.rss"},
    {"name": "The Guardian", "category": "Long Read", "url": "https://www.theguardian.com/news/series/the-long-read/rss"},
    {"name": "Psyche", "category": "Mind & Culture", "url": "https://psyche.co/feed"},
    {"name": "Works in Progress", "category": "Progress & Science", "url": "https://worksinprogress.substack.com/feed"},
    {"name": "The Marginalian", "category": "Literature & Ideas", "url": "https://www.themarginalian.org/feed/"},
    {"name": "Nautilus", "category": "Science & Culture", "url": "https://nautil.us/feed/"},
    {"name": "The Atlantic", "category": "Culture", "url": "https://www.theatlantic.com/feed/channel/culture/"},
]
