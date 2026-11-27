---
name: weekly-briefing
description: Fetch live science, culture, arts, history, and long-read RSS data for colintan.dev/weekly/, synthesize the Sunday Weekly Briefing using the active Antigravity model, validate the JSON schema, and publish to GitHub Pages.
---

# Weekly Briefing Pipeline

Use this skill every Sunday morning (or on demand) to generate and publish the Weekly Briefing at `https://colintan.dev/weekly/`.

Unlike the Daily Briefing, the Weekly Briefing focuses on **scientific breakthroughs, cultural & artistic learnings, archaeology & deep history, and long-form essays**, keeping stocks, conflicts, and partisan politics minimal and confined to the compact optional `Week in Brief` section.

## Execution Steps

Run all commands from the repository root (`/Users/colin/Developer/tzm41.github.io`).

### 1. Sync repository (skip if already synced in the same Morning Briefing run)
```bash
git pull --rebase origin master
```

### 2. Fetch live cultural, historical, artistic & scientific RSS data
```bash
python3 -m scripts.weekly.run --fetch-only /tmp/raw_weekly.json
```
This fetches live RSS feeds across **Science & Discovery** (Quanta, Nature, ScienceDaily, Ars Technica, Phys.org, NASA, Smithsonian), **Culture & Arts** (Smithsonian, Artnet News, Colossal, Open Culture, Literary Hub, ArchDaily, Dezeen, Guardian Culture), **History & Archaeology** (Smithsonian History, Archaeology Magazine, Public Domain Review, Atlas Obscura, Lapham's Quarterly, HeritageDaily), and **Long Reads** (Aeon, Guardian Long Read, Psyche, Works in Progress, The Marginalian, Nautilus, The Atlantic), filters out repeat candidates against the rolling **3-edition memory** (`weekly/data/weekly_memory.json`), and includes a compact 7-day recap from recent `briefing/data/archive/*.json` files.

### 3. Synthesize the Weekly Briefing directly
Read `/tmp/raw_weekly.json`, inspect the `instructions`, `synthesis_schema`, and fetched candidates, and write a strictly valid JSON file to `/tmp/weekly_synthesis.json` matching `WeeklySynthesis`:

- `theme_title`: Evocative 2–5 word thematic title capturing the connecting thread across this Sunday's edition.
- `digest`: 4–6 high-signal weekly takeaway bullets (`{text, category, sentiment}`) spanning Science, Culture & Arts, History, and Long Reads.
- `featured_quote`: A real, accurately attributed quote (`{quote, author, context}`) from a scientist, artist, writer, or historian resonating with the week's theme.
- `science`: `{narrative, items}` with **4–5** grounded discoveries (`id`, `category`, `discipline`, `headline`, `summary`, `takeaway`, `sentiment`, `sources`).
- `culture`: `{narrative, items}` with **4–5** grounded art, architecture, literature, film, music, or cultural stories.
- `history`: `{narrative, items}` with **3–4** grounded archaeology, archival, or deep-history stories.
- `this_week_in_history`: **4** well-verified historical, scientific, or artistic anniversaries falling within `week_label` (`{year, date_label, title, summary}`).
- `around_the_world`: **10–11** geographically well-spaced pins across all continents: **6** geological fun facts (`kind: "geology"`) and **4–5** iconic regional dishes/cuisines (`kind: "cuisine"`), each with accurate decimal `lat`/`lon`, `country_code`, `feature_type`, `title`, `fact`, and `wiki_title` (avoiding any places/dishes in `recently_shown_3_editions`).
- `long_reads`: **4–5** curated essays (`{id, topic, reading_time, headline, summary, sources}`).
- `week_in_brief`: **3–4** concise macro/world recap bullets (`{text, category, sentiment}`), keeping markets/politics light.

**Formatting & Grounding Rules:**
- Every story in `science`, `culture`, `history`, and `long_reads` must be grounded in `/tmp/raw_weekly.json` with **verbatim source URLs**.
- Avoid repeating any story, place, dish, or quote from `recently_shown_3_editions` (the rolling 3-edition memory).
- Wrap the single most illuminating takeaway in `**double asterisks**` and wrap human names in `*single asterisks*` so the UI renders bold highlights and person/Wikipedia links cleanly.
- When an item or digest contains an ambiguous acronym or homonym (e.g., `CMB` as cosmic microwave background vs China Merchants Bank, `Apple` as fruit, `Georgia` as U.S. state), populate `entities` (`{mention, type, canonical_name, domain, wiki_title}`) on the item or top-level `WeeklySynthesis` so the UI disambiguates it semantically.

### 4. Validate and publish JSON artifacts
```bash
python3 -m scripts.weekly.run --apply-synthesis /tmp/raw_weekly.json /tmp/weekly_synthesis.json && rm -f /tmp/raw_weekly.json /tmp/weekly_synthesis.json
```
This validates the synthesis with Pydantic v2 and writes:
- `weekly/data/latest.json`
- `weekly/data/archive/YYYY-MM-DD.json`
- `weekly/data/index.json`
- `weekly/data/weekly_memory.json` (rolling 3-edition memory)

### 5. Commit and push to GitHub Pages
```bash
git add weekly/data/ && git commit -m "chore(weekly): update weekly briefing ($(date -u +%Y-%m-%d))" && git pull --rebase origin master && git push origin master
```
(When run alongside the Sunday Morning Briefing automation, stage both `briefing/data/` and `weekly/data/` in a single commit or separate clean commit before pushing.)
