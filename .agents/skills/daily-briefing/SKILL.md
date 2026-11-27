---
name: daily-briefing
description: Fetch live news, stock market, global conflict, and US politics data for tzm41.github.io/briefing/, synthesize the daily intelligence briefing directly using the active Antigravity model, validate the JSON schema, and publish to GitHub Pages.
---
# Daily Briefing Automation Skill

Use this skill whenever the user asks to generate, refresh, or publish their daily news & trends briefing for `tzm41/tzm41.github.io`.

## Workflow

1. **Sync repository** (run from the `tzm41.github.io` repo root):
   ```bash
   git pull --rebase origin master
   ```
2. **Fetch live raw data** (uses RSS, yfinance, GDELT, Polymarket, with automatic Google News & Google Finance public fallbacks):
   ```bash
   python3 -m scripts.briefing.run --fetch-only /tmp/raw_briefing.json
   ```
3. **Synthesize with Antigravity's active model** (no `GEMINI_API_KEY` needed):
   - Read `/tmp/raw_briefing.json` (specifically `prompt` and `synthesis_schema`).
   - Produce a strictly grounded, neutral JSON object matching `synthesis_schema` (`GeminiBriefingSynthesis`):
     - `executive_brief`: 3–5 crisp cross-domain morning items (`{text, category, sentiment}` using the 7-level spectrum: `very_negative`, `negative`, `slightly_negative`, `neutral`, `slightly_positive`, `positive`, `very_positive`); **limit to at most one item primarily about the stock market on US trading days, and omit US stock market bullets entirely on US weekends/holidays (`us_market_open_today: false`)**
     - `top_news`: 6–10 deduplicated stories with 2–3 sentence summaries, `why_it_matters`, 7-level `sentiment`, and verbatim URLs from `raw_news` (**do not re-feature stories already listed in `recently_shown_headlines_3d`** unless a major new development occurred)
     - `market_narrative` & `market_regime` (`Risk-On` | `Risk-Off` | `Mixed` | `Volatility Spike`)
     - `conflicts_overview` & `conflict_theaters` (one per tracked theater `id`)
     - `politics_pulse_summary`, `legislative_and_executive` (3–5 items), and `trending_topics` (3–5 items — **must be distinct and non-overlapping** with `legislative_and_executive`; never repeat the same bill, probe, or policy story in both)
     - `positive_news`: 3 distinct uplifting/constructive stories grounded in `positive_news_candidates` (or `raw_news`), each with a 2–3 sentence summary, `why_it_matters`, and verbatim source URL
     - `local_news`: 1 entry per configured region in `local_news_candidates` (`bay-area` / `Bay Area`, `china` / `China`) with 3–5 grounded local stories and verbatim URLs. Give each local story a **specific topic `category`** (`Weather`, `Transit`, `Housing`, `Sports`, `Community`, `Public Safety`, `Finance`, `Trade`, `Tech`, `Industry`, `Policy`, `Culture`, `Health`, `Education`, `Economy`, `Science`) — avoid generic `World` or the region name. For `china`, write `stories` in Simplified Chinese (中文) and populate `stories_en` with the matching English translations and matching `category` tags.
     - **Semantic bolding & italics**: In bullets, summaries, `why_it_matters`, narratives, overviews, and `framing_note`s, wrap the 1–2 highest-signal phrases per sentence (core outcome, decisive action, or key metric — ~15–25% of each sentence) in `**double asterisks**`, and wrap human person names in `*single asterisks*` (never bold whole sentences or headlines).
     - **Semantic entity disambiguation (`entities`)**: Whenever a story or brief contains ambiguous acronyms, homonyms, or non-obvious institutions (e.g., `ABC` → Agricultural Bank of China `abchina.com` vs ABC News `abcnews.go.com`; `BOC` → Bank of China `boc.cn` vs Bank of Canada; `Georgia` US state → `type: "none"` vs country; `Apple` fruit → `type: "none"`), populate `entities` (on the story and/or top-level) with `{mention, type, canonical_name, domain, country_code, wiki_title}`.
   - Write the raw JSON (no markdown fences) to `/tmp/synthesis.json`.
4. **Validate, merge deterministic numbers, and write `briefing/data/`**:
   ```bash
   python3 -m scripts.briefing.run --apply-synthesis /tmp/raw_briefing.json /tmp/synthesis.json
   rm -f /tmp/raw_briefing.json /tmp/synthesis.json
   ```
5. **Conditional company facts & country leaders refresh**:
   - If any of today's synthesized news reports a **new CEO/leadership change, funding round, valuation, IPO, or acquisition** for a company or frontier AI lab tracked in `shared/data/entities.json`, update that entry (and `updated_at`) in `shared/data/entities.json` and run `python3 -m scripts.briefing.refresh_company_facts`.
   - If any of today's synthesized news reports a **new head of state / head of government, election victory, inauguration, resignation, or leadership transition** for any country or territory in `briefing/data/country_leaders.json`, update that entry (and `updated_at`) in `briefing/data/country_leaders.json` and validate with `python3 -m json.tool briefing/data/country_leaders.json > /dev/null`.
6. **Commit and push** to GitHub Pages:
   ```bash
   git add briefing/data/
   git commit -m "chore(briefing): update daily briefing ($(date -u +%Y-%m-%d))"
   git pull --rebase origin master
   git push origin master
   ```
7. Report a concise summary of the published edition and link to `https://tzm41.github.io/briefing/`.
