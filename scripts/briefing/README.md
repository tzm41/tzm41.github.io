# Daily News & Trends Briefing Pipeline

Automated static-first intelligence briefing hosted at `https://tzm41.github.io/briefing/`.

## Setup (1 Step)

1. In your GitHub repository settings, go to **Settings → Secrets and variables → Actions** and add a repository secret named `GEMINI_API_KEY` (get a free/low-cost key from [Google AI Studio](https://aistudio.google.com/apikey)).
2. Go to **Actions → Daily News & Trends Briefing → Run workflow** to trigger your first live AI-synthesized edition immediately.
3. After that, GitHub Actions runs automatically every day at **12:30 UTC** and commits the updated JSON to `briefing/data/`.

> If `GEMINI_API_KEY` is not configured, the pipeline still runs and publishes in `extractive_fallback` mode using raw RSS, Yahoo Finance, GDELT, and Polymarket data.

## Local Usage

```bash
pip install -r scripts/briefing/requirements.txt

# Optional: enable Gemini 3.8 Flash synthesis locally
export GEMINI_API_KEY="your-key-here"

# Run the pipeline and write to briefing/data/
python3 -m scripts.briefing.run

# Preview locally
python3 -m http.server 8000
# Open http://localhost:8000/briefing/
```

## Customization

Edit `scripts/briefing/config.py` to customize:
- `NEWS_FEEDS`: RSS sources and categories
- `MARKET_WATCHLIST` & `MARKET_SECTORS`: Yahoo Finance tickers
- `CONFLICT_THEATERS`: GDELT 2.0 DOC queries and tracked regions
- `POLITICS_FEEDS`: US political & legislative RSS feeds
