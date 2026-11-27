"""Generate 1200x630 broadsheet Open Graph PNG cards and update HTML meta tags.

Used by both Daily Briefing (`scripts/briefing/run.py`) and Weekly Briefing
(`scripts/weekly/run.py`) on publish, plus CLI generation for static Home & Bookmarks cards.
"""

from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SITE_ORIGIN = "https://colintan.dev"
OG_START_MARKER = "<!-- og:start -->"
OG_END_MARKER = "<!-- og:end -->"

_MD_BOLD_RE = re.compile(r"\*\*((?:(?!\*\*(?!\*)).)+?)\*\*(?!\*)")
_MD_ITALIC_RE = re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)")


def _strip_md(text: str) -> str:
    s = _MD_BOLD_RE.sub(r"\1", str(text or ""))
    s = _MD_ITALIC_RE.sub(r"\1", s)
    return re.sub(r"\s+", " ", s).strip()


def _truncate(text: str, max_len: int) -> str:
    s = _strip_md(text)
    if len(s) <= max_len:
        return s
    cut = s[: max_len - 1].rsplit(" ", 1)[0]
    return (cut or s[: max_len - 1]).rstrip(".,;:") + "…"


def _fmt_readable_date(date_str: str) -> str:
    try:
        dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
        return dt.strftime("%A, %b %-d, %Y")
    except Exception:
        return date_str


def _find_chrome_binary() -> str | None:
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
    ]
    for c in candidates:
        if c and Path(c).exists():
            return str(c)
    return None


def _render_html_to_png(html_doc: str, out_png: Path) -> bool:
    chrome = _find_chrome_binary()
    if not chrome:
        print("[og_preview] No headless Chrome/Chromium binary found; skipping PNG render.")
        return False
    out_png.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".html", encoding="utf-8", delete=False) as tf:
        tf.write(html_doc)
        tmp_html = Path(tf.name)
    try:
        cmd = [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--window-size=1200,630",
            "--force-device-scale-factor=1",
            f"--screenshot={out_png}",
            tmp_html.as_uri(),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=25)
        return out_png.exists() and out_png.stat().st_size > 1000
    except Exception as exc:
        print(f"[og_preview] Headless Chrome render failed: {exc}")
        return False
    finally:
        tmp_html.unlink(missing_ok=True)


def _build_card_html(
    *,
    kicker: str,
    title: str,
    subtitle: str,
    accent: str,
    badge: str = "",
    items: list[tuple[str, str]] | None = None,
    footer_right: str = "colintan.dev",
) -> str:
    badge_html = (
        f'<span class="badge">{html.escape(badge)}</span>' if badge else ""
    )
    rows_html = ""
    for tag, line in (items or [])[:3]:
        tag_html = f'<span class="tag">{html.escape(tag)}</span>' if tag else ""
        rows_html += f'<div class="item">{tag_html}<span class="line">{html.escape(line)}</span></div>'

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    width: 1200px;
    height: 630px;
    overflow: hidden;
    background: #faf8f5;
    color: #181a1f;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  .frame {{
    width: 1200px;
    height: 630px;
    padding: 52px 64px 44px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-top: 10px solid {accent};
    background: radial-gradient(circle at 92% 12%, {accent}14 0%, transparent 45%), #faf8f5;
  }}
  .top-row {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }}
  .kicker {{
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 18px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: {accent};
  }}
  .badge {{
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 16px;
    font-weight: 600;
    color: {accent};
    background: {accent}16;
    border: 1px solid {accent}38;
    padding: 6px 14px;
    border-radius: 999px;
  }}
  .hero {{
    margin-top: 18px;
  }}
  h1 {{
    font-family: Georgia, "Times New Roman", serif;
    font-size: 64px;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.06;
    color: #181a1f;
  }}
  .subtitle {{
    margin-top: 12px;
    font-size: 23px;
    line-height: 1.4;
    color: #4a505c;
    max-width: 1020px;
  }}
  .items {{
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    border-top: 1px solid #e4dfd6;
    padding-top: 22px;
  }}
  .item {{
    display: flex;
    align-items: baseline;
    gap: 14px;
    font-size: 21px;
    line-height: 1.35;
    color: #181a1f;
  }}
  .tag {{
    flex-shrink: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: {accent};
    background: {accent}15;
    padding: 4px 10px;
    border-radius: 5px;
    min-width: 98px;
    text-align: center;
  }}
  .line {{
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }}
  .footer {{
    margin-top: auto;
    padding-top: 18px;
    border-top: 1px solid #e4dfd6;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 16px;
    color: #6f7684;
  }}
  .brand {{
    font-weight: 700;
    color: #181a1f;
  }}
</style>
</head>
<body>
  <div class="frame">
    <div>
      <div class="top-row">
        <span class="kicker">{html.escape(kicker)}</span>
        {badge_html}
      </div>
      <div class="hero">
        <h1>{html.escape(title)}</h1>
        <p class="subtitle">{html.escape(subtitle)}</p>
      </div>
      {f'<div class="items">{rows_html}</div>' if rows_html else ''}
    </div>
    <div class="footer">
      <span class="brand">colintan.dev</span>
      <span>{html.escape(footer_right)}</span>
    </div>
  </div>
</body>
</html>
"""


def update_html_og_tags(
    html_path: Path,
    *,
    title: str,
    description: str,
    url: str,
    image_url: str,
    site_name: str = "colintan.dev",
) -> None:
    """Idempotently replace or insert Open Graph & Twitter Card meta tags."""
    raw = html_path.read_text(encoding="utf-8")
    block = "\n".join(
        [
            f"  {OG_START_MARKER}",
            f'  <meta property="og:type" content="website">',
            f'  <meta property="og:site_name" content="{html.escape(site_name, quote=True)}">',
            f'  <meta property="og:title" content="{html.escape(title, quote=True)}">',
            f'  <meta property="og:description" content="{html.escape(description, quote=True)}">',
            f'  <meta property="og:url" content="{html.escape(url, quote=True)}">',
            f'  <meta property="og:image" content="{html.escape(image_url, quote=True)}">',
            f'  <meta property="og:image:width" content="1200">',
            f'  <meta property="og:image:height" content="630">',
            f'  <meta name="twitter:card" content="summary_large_image">',
            f'  <meta name="twitter:title" content="{html.escape(title, quote=True)}">',
            f'  <meta name="twitter:description" content="{html.escape(description, quote=True)}">',
            f'  <meta name="twitter:image" content="{html.escape(image_url, quote=True)}">',
            f"  {OG_END_MARKER}",
        ]
    )

    pattern = re.compile(
        rf"[ \t]*{re.escape(OG_START_MARKER)}.*?{re.escape(OG_END_MARKER)}",
        re.DOTALL,
    )
    if pattern.search(raw):
        updated = pattern.sub(block, raw, count=1)
    else:
        updated = re.sub(
            r'(<meta\s+name="description"[^>]*>)',
            lambda m: m.group(1) + "\n" + block,
            raw,
            count=1,
        )
    html_path.write_text(updated, encoding="utf-8")


def generate_daily_og(briefing_dict: dict[str, Any]) -> None:
    """Generate `briefing/og-latest.png` and update `briefing/index.html` OG meta tags."""
    date_str = str(briefing_dict.get("date") or "")
    readable = _fmt_readable_date(date_str)
    regime = str((briefing_dict.get("markets") or {}).get("regime_tag") or "")
    top_news = briefing_dict.get("top_news") or []
    bullets = (briefing_dict.get("morning_brief") or {}).get("bullets") or []

    items: list[tuple[str, str]] = []
    for st in top_news[:3]:
        items.append((str(st.get("category") or "News"), _truncate(str(st.get("headline") or ""), 74)))
    if not items:
        for b in bullets[:3]:
            txt = b.get("text") if isinstance(b, dict) else str(b)
            cat = b.get("category", "Brief") if isinstance(b, dict) else "Brief"
            items.append((str(cat), _truncate(str(txt or ""), 74)))

    lead = ""
    if bullets:
        first = bullets[0]
        lead = _truncate(first.get("text") if isinstance(first, dict) else str(first), 160)
    elif top_news:
        lead = _truncate(str(top_news[0].get("summary") or top_news[0].get("headline") or ""), 160)
    else:
        lead = "Daily intelligence briefing covering world news, markets, global conflicts, and US politics."

    card_html = _build_card_html(
        kicker=f"Daily Briefing · {readable}",
        title="Daily Briefing",
        subtitle=_truncate(lead, 125),
        accent="#a63a2b",
        badge=f"Markets: {regime}" if regime else "Morning Edition",
        items=items,
        footer_right="News · Markets · Conflicts · US Politics",
    )
    out_png = REPO_ROOT / "briefing" / "og-latest.png"
    _render_html_to_png(card_html, out_png)

    update_html_og_tags(
        REPO_ROOT / "briefing" / "index.html",
        title=f"Daily Briefing — {readable}",
        description=lead,
        url=f"{SITE_ORIGIN}/briefing/",
        image_url=f"{SITE_ORIGIN}/briefing/og-latest.png?v={date_str or 'latest'}",
    )
    print(f"[og_preview] Updated Daily Briefing OG card & meta ({date_str})")


def generate_weekly_og(weekly_dict: dict[str, Any]) -> None:
    """Generate `weekly/og-latest.png` and update `weekly/index.html` OG meta tags."""
    date_str = str(weekly_dict.get("date") or "")
    readable = _fmt_readable_date(date_str)
    theme = str(weekly_dict.get("theme_title") or "Sunday Edition")
    digest = weekly_dict.get("digest") or []

    items: list[tuple[str, str]] = []
    for sec_key, label in [("science", "Science"), ("culture", "Culture"), ("history", "History")]:
        sec_items = (weekly_dict.get(sec_key) or {}).get("items") or []
        if sec_items:
            items.append((label, _truncate(str(sec_items[0].get("headline") or ""), 74)))

    lead = ""
    if digest:
        first = digest[0]
        lead = _truncate(first.get("text") if isinstance(first, dict) else str(first), 160)
    else:
        lead = "Sunday weekly briefing curating science, culture, arts, history, and long-form essays."

    card_html = _build_card_html(
        kicker=f"Weekly Briefing · {readable}",
        title="Weekly Briefing",
        subtitle=_truncate(lead, 125),
        accent="#2c5d6b",
        badge=theme,
        items=items,
        footer_right="Science · Culture · History · Long Reads",
    )
    out_png = REPO_ROOT / "weekly" / "og-latest.png"
    _render_html_to_png(card_html, out_png)

    update_html_og_tags(
        REPO_ROOT / "weekly" / "index.html",
        title=f"Weekly Briefing — {readable}",
        description=lead,
        url=f"{SITE_ORIGIN}/weekly/",
        image_url=f"{SITE_ORIGIN}/weekly/og-latest.png?v={date_str or 'latest'}",
    )
    print(f"[og_preview] Updated Weekly Briefing OG card & meta ({date_str})")


def generate_static_site_ogs() -> None:
    """Generate static OG cards & meta tags for Home (`/`) and Bookmarks (`/bookmarks/`)."""
    home_html = _build_card_html(
        kicker="colintan.dev · Editions",
        title="Home Editions",
        subtitle="Curated intelligence and curiosity — Daily Briefing for news & markets, Weekly Briefing for science, arts & history.",
        accent="#a63a2b",
        badge="Daily & Weekly",
        items=[
            ("Daily", "World news, live markets & sector heatmap, conflict trackers, and US politics"),
            ("Weekly", "Science breakthroughs, culture & arts, deep history, and Around the World"),
            ("Bookmarks", "Cross-device synced reading list across both editions"),
        ],
        footer_right="colintan.dev",
    )
    _render_html_to_png(home_html, REPO_ROOT / "og-home.png")
    update_html_og_tags(
        REPO_ROOT / "index.html",
        title="Home Editions — colintan.dev",
        description="Daily Briefing (news, markets, global conflicts & US politics) and Weekly Briefing (science, culture, arts & history).",
        url=f"{SITE_ORIGIN}/",
        image_url=f"{SITE_ORIGIN}/og-home.png?v=1",
    )

    bm_html = _build_card_html(
        kicker="colintan.dev · Reading List",
        title="Saved Bookmarks",
        subtitle="Your saved Daily and Weekly stories, categorized by topic with automatic cloud sync across devices.",
        accent="#2c5d6b",
        badge="Synced Reading List",
        items=[
            ("Daily", "Retained for 60 days across Top News, Local News & Positive News"),
            ("Weekly", "Retained for 52 weeks across Science, Culture, History & Around the World"),
        ],
        footer_right="colintan.dev/bookmarks/",
    )
    _render_html_to_png(bm_html, REPO_ROOT / "bookmarks" / "og-bookmarks.png")
    update_html_og_tags(
        REPO_ROOT / "bookmarks" / "index.html",
        title="Bookmarks — colintan.dev",
        description="Saved stories across Daily Briefing and Weekly Briefing, categorized by topic with cross-device sync.",
        url=f"{SITE_ORIGIN}/bookmarks/",
        image_url=f"{SITE_ORIGIN}/bookmarks/og-bookmarks.png?v=1",
    )
    print("[og_preview] Updated static Home & Bookmarks OG cards & meta")


if __name__ == "__main__":
    generate_static_site_ogs()
    daily_latest = REPO_ROOT / "briefing" / "data" / "latest.json"
    if daily_latest.exists():
        generate_daily_og(json.loads(daily_latest.read_text(encoding="utf-8")))
    weekly_latest = REPO_ROOT / "weekly" / "data" / "latest.json"
    if weekly_latest.exists():
        generate_weekly_og(json.loads(weekly_latest.read_text(encoding="utf-8")))
