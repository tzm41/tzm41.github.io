# Daily News & Trends Briefing Pipeline

Automated static-first intelligence briefing hosted at `https://tzm41.github.io/briefing/`.

## Option 1: GitHub Actions (Cloud, Zero Local Setup)

1. In your GitHub repository, go to **Settings → Secrets and variables → Actions** and add a secret named `GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey).
2. Trigger **Actions → Daily News & Trends Briefing → Run workflow**.
3. The workflow runs automatically every day at **12:30 UTC** and commits to `briefing/data/`.

## Option 2: Antigravity Automation (Use Stronger Gemini Pro Models)

The saved **`daily-briefing`** Antigravity skill lets Antigravity itself synthesize the briefing using its active Pro model (no `GEMINI_API_KEY` required):
1. `python3 -m scripts.briefing.run --fetch-only /tmp/raw_briefing.json`
2. Antigravity reads the prompt & JSON schema from `/tmp/raw_briefing.json` and writes `/tmp/synthesis.json`.
3. `python3 -m scripts.briefing.run --apply-synthesis /tmp/raw_briefing.json /tmp/synthesis.json`
4. Commit and push `briefing/data/` to `origin master`.

## Option 3: Local Computer Daily Cron / macOS `launchd` (Gemini CLI)

Run `scripts/briefing/local_update.sh` on your Mac/Linux machine using [Gemini CLI](https://github.com/google-gemini/gemini-cli) signed in with your Google account (Google AI Pro / Ultra quota):

```bash
chmod +x scripts/briefing/local_update.sh

# Test once manually
./scripts/briefing/local_update.sh

# Example crontab entry (daily at 7:00 AM local time)
# 0 7 * * * /path/to/tzm41.github.io/scripts/briefing/local_update.sh >> /tmp/daily-briefing.log 2>&1
```

> If you switch exclusively to local automation, you can comment out the `schedule:` block in `.github/workflows/daily-briefing.yml` while keeping `workflow_dispatch:` as a manual cloud backup.

## Rate-Limit Fallbacks

All four fetchers automatically fall back to **Google public content** if an upstream API hits rate limits:
- **News**: Google News Top / World / Tech public RSS
- **Markets**: Google Finance public quote pages (`google.com/finance/quote/...`)
- **Conflicts**: Google News 14-day RSS publication-date histogram when GDELT returns `429`
- **US Politics**: Google News Congress / White House / polling public RSS

## Customization

Edit `scripts/briefing/config.py` to customize feeds, tickers, conflict theaters, and fallback models.
