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
    date_label: str,
    title: str,
    accent: str,
    items: list[str] | None = None,
) -> str:
    rows_html = ""
    for line in (items or [])[:3]:
        rows_html += (
            f'<div class="item"><span class="dot"></span>'
            f'<span class="line">{html.escape(line)}</span></div>'
        )

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
    padding: 46px 60px 36px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    border-top: 12px solid {accent};
    background: radial-gradient(circle at 92% 10%, {accent}14 0%, transparent 45%), #faf8f5;
  }}
  .header {{
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 22px;
    border-bottom: 2px solid #e4dfd6;
  }}
  h1 {{
    font-family: Georgia, "Times New Roman", serif;
    font-size: 64px;
    font-weight: 700;
    letter-spacing: -0.025em;
    line-height: 1.05;
    color: #181a1f;
    white-space: nowrap;
  }}
  .date {{
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 25px;
    font-weight: 600;
    color: {accent};
    white-space: nowrap;
  }}
  .items {{
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 26px;
    padding: 18px 0;
  }}
  .item {{
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }}
  .dot {{
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: {accent};
    flex-shrink: 0;
    margin-top: 15px;
  }}
  .line {{
    font-size: 35px;
    font-weight: 600;
    line-height: 1.24;
    letter-spacing: -0.015em;
    color: #181a1f;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }}
  .footer {{
    display: flex;
    align-items: center;
    justify-content: flex-end;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 20px;
    font-weight: 600;
    color: #6f7684;
  }}
</style>
</head>
<body>
  <div class="frame">
    <div class="header">
      <h1>{html.escape(title)}</h1>
      <span class="date">{html.escape(date_label)}</span>
    </div>
    <div class="items">{rows_html}</div>
    <div class="footer">colintan.dev</div>
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
    top_news = briefing_dict.get("top_news") or []
    bullets = (briefing_dict.get("morning_brief") or {}).get("bullets") or []

    items: list[str] = [_truncate(str(st.get("headline") or ""), 84) for st in top_news[:3]]
    if not items:
        for b in bullets[:3]:
            txt = b.get("text") if isinstance(b, dict) else str(b)
            items.append(_truncate(str(txt or ""), 84))

    lead = ""
    if bullets:
        first = bullets[0]
        lead = _truncate(first.get("text") if isinstance(first, dict) else str(first), 160)
    elif top_news:
        lead = _truncate(str(top_news[0].get("summary") or top_news[0].get("headline") or ""), 160)
    else:
        lead = "Daily intelligence briefing covering world news, markets, global conflicts, and US politics."

    card_html = _build_card_html(
        date_label=readable,
        title="Daily Briefing",
        accent="#a63a2b",
        items=items,
    )
    out_png = REPO_ROOT / "briefing" / "og-latest.png"
    _render_html_to_png(card_html, out_png)

    update_html_og_tags(
        REPO_ROOT / "briefing" / "index.html",
        title=f"Daily Briefing — {readable}",
        description=lead,
        url=f"{SITE_ORIGIN}/briefing/",
        image_url=f"{SITE_ORIGIN}/briefing/og-latest.png?v={date_str or 'latest'}-2",
    )
    print(f"[og_preview] Updated Daily Briefing OG card & meta ({date_str})")


def generate_weekly_og(weekly_dict: dict[str, Any]) -> None:
    """Generate `weekly/og-latest.png` and update `weekly/index.html` OG meta tags."""
    date_str = str(weekly_dict.get("date") or "")
    readable = _fmt_readable_date(date_str)
    digest = weekly_dict.get("digest") or []

    items: list[str] = []
    for sec_key in ("science", "culture", "history"):
        sec_items = (weekly_dict.get(sec_key) or {}).get("items") or []
        if sec_items:
            items.append(_truncate(str(sec_items[0].get("headline") or ""), 84))

    lead = ""
    if digest:
        first = digest[0]
        lead = _truncate(first.get("text") if isinstance(first, dict) else str(first), 160)
    else:
        lead = "Sunday weekly briefing curating science, culture, arts, history, and long-form essays."

    card_html = _build_card_html(
        date_label=readable,
        title="Weekly Briefing",
        accent="#2c5d6b",
        items=items,
    )
    out_png = REPO_ROOT / "weekly" / "og-latest.png"
    _render_html_to_png(card_html, out_png)

    update_html_og_tags(
        REPO_ROOT / "weekly" / "index.html",
        title=f"Weekly Briefing — {readable}",
        description=lead,
        url=f"{SITE_ORIGIN}/weekly/",
        image_url=f"{SITE_ORIGIN}/weekly/og-latest.png?v={date_str or 'latest'}-2",
    )
    print(f"[og_preview] Updated Weekly Briefing OG card & meta ({date_str})")


def generate_static_site_ogs() -> None:
    """Generate static OG cards & meta tags for Home (`/`) and Bookmarks (`/bookmarks/`)."""
    home_html = _build_card_html(
        date_label="Daily & Weekly",
        title="Home Editions",
        accent="#a63a2b",
        items=[
            "Daily Briefing — World news, live markets, conflicts & US politics",
            "Weekly Briefing — Science, culture, arts, history & long reads",
            "Bookmarks — Synced reading list across devices",
        ],
    )
    _render_html_to_png(home_html, REPO_ROOT / "og-home.png")
    update_html_og_tags(
        REPO_ROOT / "index.html",
        title="Home Editions — colintan.dev",
        description="Daily Briefing (news, markets, global conflicts & US politics) and Weekly Briefing (science, culture, arts & history).",
        url=f"{SITE_ORIGIN}/",
        image_url=f"{SITE_ORIGIN}/og-home.png?v=2",
    )

    bm_html = _build_card_html(
        date_label="Reading List",
        title="Bookmarks",
        accent="#2c5d6b",
        items=[
            "Saved stories across Daily Briefing and Weekly Briefing",
            "Categorized by topic with cloud sync across devices",
            "Daily retained 60 days · Weekly retained 52 weeks",
        ],
    )
    _render_html_to_png(bm_html, REPO_ROOT / "bookmarks" / "og-bookmarks.png")
    update_html_og_tags(
        REPO_ROOT / "bookmarks" / "index.html",
        title="Bookmarks — colintan.dev",
        description="Saved stories across Daily Briefing and Weekly Briefing, categorized by topic with cross-device sync.",
        url=f"{SITE_ORIGIN}/bookmarks/",
        image_url=f"{SITE_ORIGIN}/bookmarks/og-bookmarks.png?v=2",
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
