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
  - Compact `32px` control row: **Expand All / Collapse All**, **Refresh** (icon-only, spins while re-fetching with `cache: "no-store"`), **Customize** (sliders icon), **Theme** toggle, and **Sign-In / Avatar** menu.
  - `Updated ...` timestamp reflects the latest edition update formatted in the viewer's local timezone.
- **Sticky Shrunken Titlebar (On Scroll):**
  - When scrolled past the full masthead, a compact sticky bar (sized cleanly to the `32px` control buttons, using a zero-layout-shift spacer) docks at the top of the viewport directly above the sticky section tab bar.
  - **Desktop & Mobile Landscape:** Shrinks the title font size, displays only the title and date picker (left-aligned) plus the action buttons (right-aligned), omitting breadcrumbs and subtitle metadata.
  - **Mobile Portrait (`<= 680px` portrait):** Shrinks the title font size, shows only the title and short-form date picker omitting the year (e.g., `Fri, Nov 27`, left-aligned), and collapses all action buttons into a single right-aligned three-dot (`⋮`) overflow menu.
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
  - Located inside the **Customize** modal (sliders icon in the masthead; default: `Regular`, persisted locally and synced with signed-in accounts via `brief_style`).
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
- **Two-Tier Sharded Entity Database (`shared/data/entities/`):**
  - Split into `hot.json` (45 frequent + 26 pinned entities, indices, US parties, core people), 6 domain cold shards (`tech-ai`, `finance-banking`, `media-entertainment`, `aviation-space`, `consumer-energy-health`, `science-culture`), and `manifest.json` (`domain_shard` lookup map).
  - Pages fetch `hot.json` + `country_leaders.json` directly in parallel (zero manifest waterfall), load only the cold shards declared in each edition's `entity_shards` list via incremental `O(text)` Prefix Trie insertion, and lazily fetch cold shards on hover if an unloaded domain is encountered.
  - Maintained automatically via weekly recency-weighted rebalancing (14-day half-life across 30 Daily + 8 Weekly archives, 1.5× Weekly weight, rank 35/55 hysteresis deadband) inside `scripts/briefing/refresh_company_facts.py`.
- **Formatting:**
  - `**bold**` key takeaways (cleanly supporting nested `*italic*` human names without markdown boundary artifacts).
  - Per-paragraph icon/flag/logo deduplication (first mention shows badge/flag + dashed underline; repeat mentions keep the underline without repeating the icon).
- **Geographic Tooltips:** ~203 countries/territories/demonyms (`16×12px` flags), 50 US states + DC, 31 Chinese provinces, 21 Guangdong cities, and 32 California cities — lazy-loaded TopoJSON contour map tooltips on hover/tap.
- **Company & Org Tooltips:** High-resolution logos (including bundled crisp `128×128` square emblems in `shared/logos/`), live quote (if public), country flag, valuation/budget/bias, and CEO/leader.
- **Touch Rule:** On touch devices, tooltips appear only on a completed tap (`click`), never on `pointerdown` or scroll gestures, and dismiss on outside tap or scroll.

---

## 10. Reader-Friendly Text & Device-Native TTS Playback
- **Progressive Feature Detection:** All `.tts-btn` and `.tts-player` UI is hidden by default (`html:not(.tts-supported)`) and revealed only on devices where `window.speechSynthesis` + `SpeechSynthesisUtterance` expose at least one voice.
- **Reader-Friendly Speech Normalization (`shared/tts.js`):** Uses optional `reader_text` when present or composes clean prose from structured item fields, stripping markdown/URLs/arrows and expanding market deltas (`(+0.54%)` → `up 0.54 percent` / `上涨0.54%`) across both `en-US` and `zh-CN` (China Local News).
- **Controls & Placement:**
  - Per-card `Listen` pill right-aligned in `.source-links` (and `.geo-fact-foot-actions` on Around the World popovers) so it never crowds top-edge bookmark/share buttons.
  - Compact per-bullet play icon in `.exec-meta` and section-level `Listen` buttons on Morning/Afternoon Brief, Sunday Digest, Top/Local/Positive News, Science, Culture, History, Long Reads, Week in Brief, and Bookmarks.
- **Reliable Cross-Platform Playback:** Synchronous `speak()` inside click handlers (iOS Safari), abbreviation/decimal-safe sentence chunking (`<= 220` EN / `<= 110` ZH chars to prevent Chrome's 15s stall), ranked voice picker, deterministic chunk-level Pause/Resume, `.is-speaking` active highlight, and a compact floating bottom mini-player (`z-index: 88`, respecting `env(safe-area-inset-bottom)`) with Play/Pause, Next, Speed (`0.9×–1.5×`, persisted locally), and Stop.

---

## 11. Progressive Web App (PWA), Offline Support & Architecture
- **Unified Root Manifest (`/manifest.json`):** `id: "/"`, `scope: "/"`, `start_url: "/briefing/?date=latest"`, `display: "standalone"`, app shortcuts (Daily Briefing, Weekly Briefing, Bookmarks), and `192×192` + `512×512` `any` + padded `512×512` `maskable` icons. Linked across all 4 pages (`/`, `/briefing/`, `/weekly/`, `/bookmarks/`) with canonical `/` home links so subpage navigation stays inside the standalone app shell on iOS and Android.
- **Native Chrome & Safe-Area Polish:** Dynamic `<meta name="theme-color">` synchronized synchronously on boot and on every Light/Dark/Auto switch; `viewport-fit=cover` with `env(safe-area-inset-*)` padding across masthead, containers, footer, modals, toasts, and TTS mini-player.
- **Root Service Worker (`/sw.js` + `shared/pwa.js`):** Network-first HTML (with ETag/Last-Modified `.js`/`.css` cache invalidation to prevent HTML/ES-module version skew), network-first mutable JSON (including `shared/data/entities/*.json`) with graceful offline notice banner/toast, bounded 60-entry LRU cache-first for immutable archive JSON, stale-while-revalidate for static assets, and strict bypass for `/auth/*`, `/user/*`, `/markets`, `/s/*`, and cross-origin requests.
- **Google Sign-In & Same-Origin API:** Lazy-loads Google Identity Services only when clicked; stores Bearer session token in `localStorage` and syncs preferences + bookmarks to Cloudflare KV via same-origin `https://colintan.dev/auth/*` and `/user/*` routes.
- **Cloudflare DNS & Edge Routing:** `colintan.dev` uses Cloudflare Free DNS (proxied with SSL `Full` over GitHub Pages) with Worker routes for `/s/*`, `/briefing/`, `/weekly/`, `/auth/*`, `/user/*`, and `/markets` — keeping all URLs first-party and preserving iCloud Custom Email DNS records.
