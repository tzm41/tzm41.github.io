# colintan.dev — UX & Design Requirements

Consolidated user-experience, visual, and interaction specification across `colintan.dev` (Home Hub, Daily Briefing, Weekly Briefing, and Bookmarks).

---

## 1. Theme, Typography & Branding
- **System Light/Dark Mode:** Follows OS `prefers-color-scheme` (`Auto`) by default and reacts live to system theme changes.
- **Single Icon-Only Theme Toggle:** Compact `32×32` masthead icon button cycles **Auto** → **Light** → **Dark** → **Auto** with descriptive tooltips.
- **Dark Theme Palette:** Slate-blue dark theme (`#161b24` background, `#1d2430` card surfaces). All floating tooltips (sparklines, company cards, maps, source bias) render on dark surfaces (`#0f141c` with subtle border) rather than bright white.
- **Text Sizing Stability:** Root sets `-webkit-text-size-adjust: 100%; text-size-adjust: 100%;` to prevent mobile Safari font inflation.
- **Adaptive Branding:** Light/dark adaptive 4-point red star SVG favicon (`/favicon.svg`), PNG favicons, root & subpage `apple-touch-icon.png`, and `1200×630` mobile-friendly Open Graph preview cards (large legible 3-point summary, zero small clutter).

---

## 2. Shared Masthead, Navigation & Footer
- **Shared Responsive Masthead (`initMasthead`):**
  - Unified breadcrumb row and responsive `<h1>` shrinking logic across Daily Briefing, Weekly Briefing, and Bookmarks (e.g., `Daily Briefing` → `Daily`, `Weekly Briefing` → `Weekly` on narrow screens `<= 768px`).
  - Archive date selector (`‹` / dropdown / `›`) is integrated directly into the `.title-row` beside the edition title.
  - Compact `32px` control row: **Expand All / Collapse All**, **Refresh** (icon-only, spins while re-fetching with `cache: "no-store"`), **Customize Sections** (sliders icon), **Theme** toggle, and **Sign-In / Avatar** menu.
  - `Updated ...` timestamp reflects the latest edition update formatted in the viewer's local timezone.
- **Sticky Section Tab Bar:**
  - Horizontal sticky nav with dynamic scroll-spy and centered auto-scroll on narrow viewports.
  - Tab order and visibility stay automatically synchronized with user Section Settings.
  - Market tab is labeled **`Market`**; no fetch status dots in the tab bar.
- **Section Headers:**
  - Clean titles only (no uppercase `.kicker` subtitles).
  - Section narrative paragraphs (`.section-narrative`) span `90%` max-width on desktop, `100%` on narrow screens.
- **Footer / Footnote:**
  - Clean data-source attribution (no "Automated daily/weekly via Antigravity" boilerplate).
  - Houses section fetch status indicators (including `Local News` on Daily) and the local timestamp of the latest company facts refresh.

---

## 3. Section Layout Settings (Show/Hide, Collapse on Load, Reorder)
- **Accessible Everywhere:** Sliders button in the masthead on both **Daily Briefing** and **Weekly Briefing** opens a **Customize Sections** modal.
- **Per-Section Controls:**
  - **Reorder (`↑` / `↓`):** Reorders both `<section>` blocks in `<main>` and their corresponding sticky `<nav>` links. Replaces the old single-purpose Positive News placement button.
  - **Expanded / Collapsed on Load:** Chooses whether each section starts expanded or collapsed on page load (including Overview/Briefs and Top News).
  - **Show / Hide (Eye Toggle):** Hides both the section and its sticky nav link (at least one section must remain visible).
  - **Reset to Defaults:** Restores default order, visibility, and collapse states in one click.
- **Default Collapse States:**
  - **Daily Briefing:** `Overview & Briefs` and `Top News` open; `Stock Market Trends`, `Global Conflict Tracker`, `US Politics Pulse`, `Local News`, and `Positive News` collapsed.
  - **Weekly Briefing:** `Sunday Digest`, `Science & Discovery`, `Culture & Arts`, `History & Archaeology`, and `Around the World` open; `Long Reads & Essays` and `Week in Brief` collapsed.
- **Clickable Titles & Expand All Sync:** Clicking any collapsible section heading toggles expand/collapse in sync with its button and the masthead **Expand All / Collapse All** control (which ignores user-hidden sections).
- **Persistence & Cloud Sync:** Saved immediately to `localStorage` and synced across devices for signed-in users (`daily_sections` and `weekly_sections` preferences in Cloudflare KV).

---

## 4. Overview, Briefs & Bullet Style Toggle
- **Daily KPI Strip (Signals):** 4 cards (`S&P 500`, `VIX Volatility`, `US 10Y Yield`, `Highest Conflict Activity`). Collapsed by default on mobile (`<= 680px`) behind a toggle showing `S&P 500 <price> (<change>)`.
- **Morning Brief & Afternoon Brief / Sunday Digest:**
  - Symmetric `{ generated_at, bullets }` structure; each panel displays its local generation timestamp in the top-right corner.
  - Each bullet stacks a 7-level sentiment half-ring gauge + category pill above the text.
  - Daily briefs include at most one item primarily about the stock market.
- **Brief Display Style Toggle (`Regular` vs `Bullets`):**
  - Available in the Sign-In / Avatar dropdown menu (default: `Regular`, persisted locally and synced with signed-in accounts via `brief_style`).
  - In `Bullets` mode, each brief item renders its structured LLM-generated `points[]` array with one distinct news item per line.

---

## 5. Top News, Local News & Weekly Sections
- **Top News Category Filters:** `World`, `Economy`, `Tech`, `Policy`, `Science` (no `All` button; clicking the active category resets to all stories).
- **Edition & Continuation Badges:** `Morning` (terracotta) and `Afternoon` (amber) pills; stories continuing from yesterday load collapsed with a `From yesterday` badge and `Expand ▾` button.
- **Source Bias Tooltips:** Color-coded half-ring bias gauge popover for each source chip (hover on desktop; tap with `Open ↗` link on touch).
- **Local News:** Regional digest (**Bay Area** and **China**); China defaults to **`EN`** and toggles cleanly to **`中文`**, with specific topic tags (`Bay Area` / `China` + topic).
- **Weekly Briefing:** `Sunday Digest`, `Featured Quote`, `Science & Discovery`, `Culture & Arts`, `History & Archaeology` (+ `This Week in History` timeline), interactive **`Around the World`** Geology & Cuisine map (with `All / Geology / Cuisine` filter and hover/tap fact popovers), `Long Reads & Essays`, and `Week in Brief`.

---

## 6. Stock Market Trends & Interactive Graphs
- **Freshness Indicator:** Colored status dot beside the market timestamp: **Green** (`< 45m`), **Amber** (`45m–3h`), **Red** (`> 3h`), with concise relative-age hover tooltip.
- **Timeframes:** **`1D`**, **`7D`** (5-trading-day series), **`30D`**; defaults to `1D` on weekdays and `7D` on weekends.
- **1D Chart Windows:**
  - US equities/indices map onto `9:30 AM – 4:00 PM ET` (extending to `8:00 PM ET` for pre/post-market; after-hours dimmed to `0.45` opacity with a dotted 4:00 PM ET divider).
  - `^TNX` spans `9:30 AM – 3:00 PM ET`; `^VIX`, `CL=F`, and `GC=F` anchor left to their first bar and span edge-to-edge once closed; `BTC-USD` plots a rolling 24h window edge-to-edge.
- **Interactive Hover & Tap-to-Expand:**
  - Sparkline hover tooltips display timestamps in the viewer's **local browser timezone**.
  - Clicking/tapping a stock tile expands it to `2×2` (single expanded tile at a time) with `1D / 7D / 30D / Low / High` stats; horizontal chart scrubbing does not accidentally collapse the tile.
  - Magnificent 7 tiles show high-resolution logos and trigger the company facts tooltip when hovering/tapping the company name.

---

## 7. US Politics Pulse
- **Prediction Markets:** Aggregates **Polymarket** and **Kalshi** with implied YES probability, 24h shift, source label, and volume.
- **Legislative & Executive Tracker:** Stacks the branch/chamber tag above the title; deduplicated against Trending Topics.
- **Entity Treatment:** All prediction market questions, legislative items, and trending topic titles receive full inline entity formatting.

---

## 8. Bookmarks, Card Sharing & Deep-Linking
- **Top-Edge Bookmark Ribbon & Share Paperplane:**
  - Both sit tucked along the top edge of every story card (`overflow: hidden`), peeking half-hidden on card hover/focus/tap and sliding further out on button hover.
  - Share icon is a top-right-pointing paperplane matching the bookmark ribbon's borderless SVG + drop-shadow aesthetic (turns green checkmark briefly when copied).
  - **Stacking Rule:** Both bookmark and share buttons render **behind** all card text/badge components (`z-index: 1` vs `z-index: 2`), with transparent metadata row whitespace passing pointer events through so the buttons remain easily clickable.
- **Card Sharing & Dynamic Previews:**
  - Share links point to `https://colintan.dev/s/{d|w}/{date}/{cardId}` (routed via Cloudflare Worker).
  - Social/messaging crawlers (iMessage, Slack, WhatsApp, X) receive dynamic card-specific `og:title`, `og:description`, and absolute `colintan.dev` favicons; human visitors redirect straight to `https://colintan.dev/{briefing|weekly}/?date=...&card=...`, which auto-expands the target section/card, smoothly scrolls to it, and pulses its border.
- **Bookmarks Page (`/bookmarks/`):**
  - Subtitle: **`Daily retained 60 days · Weekly retained 52 weeks`**.
  - Supports cross-device sync (LWW merge + tombstones) and retention/expiring-soon indicators.

---

## 9. Inline Entity Recognition & Hover/Tap Tooltips
- **Sharded Entity Database (`shared/data/entities/`):** Two-tier sharded source of truth (`hot.json` + domain-categorized cold shards + `manifest.json`) for companies, central banks, space agencies, media outlets, US parties, and known people, indexed via an incremental `O(text)` Prefix Trie.
- **Formatting:**
  - `**bold**` key takeaways (cleanly supporting nested `*italic*` human names without markdown boundary artifacts).
  - Per-paragraph icon/flag/logo deduplication (first mention shows badge/flag + dashed underline; repeat mentions keep the underline without repeating the icon).
- **Geographic Tooltips:** ~203 countries/territories/demonyms (`16×12px` flags), 50 US states + DC, 31 Chinese provinces, 21 Guangdong cities, and 32 California cities — lazy-loaded TopoJSON contour map tooltips on hover/tap.
- **Company & Org Tooltips:** High-resolution logos (including bundled crisp `128×128` square emblems in `shared/logos/`), live quote (if public), country flag, valuation/budget/bias, and CEO/leader.
- **Touch Rule:** On touch devices, tooltips appear only on a completed tap (`click`), never on `pointerdown` or scroll gestures, and dismiss on outside tap or scroll.

---

## 10. Auth, Sync & Architecture
- **Google Sign-In (Zero-Bloat):** Lazy-loads Google Identity Services only when clicked; stores Bearer session token in `localStorage` and syncs preferences + bookmarks to Cloudflare KV via same-origin `https://colintan.dev/auth/*` and `/user/*` routes.
- **Same-Origin API & DNS:** `colintan.dev` uses Cloudflare Free DNS (proxied with SSL `Full` over GitHub Pages) with Worker routes for `/s/*`, `/briefing/`, `/weekly/`, `/auth/*`, `/user/*`, and `/markets` — keeping all URLs first-party and preserving iCloud Custom Email DNS records.
