"""Deterministic, URL-safe card ID generation and deduplication helpers."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Sequence
from typing import Any

CARD_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$")
_NON_ID_CHARS_RE = re.compile(r"[^a-zA-Z0-9_-]+")
_NON_SLUG_CHARS_RE = re.compile(r"[^a-z0-9]+")


def sanitize_id(raw: str | None, max_len: int = 80) -> str:
    """Normalize a candidate ID into ASCII `[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}`."""
    if not raw or not isinstance(raw, str):
        return ""
    trimmed = raw.strip()
    if CARD_ID_RE.match(trimmed) and len(trimmed) <= max_len:
        return trimmed
    ascii_str = unicodedata.normalize("NFKD", trimmed).encode("ascii", "ignore").decode("ascii")
    cleaned = _NON_ID_CHARS_RE.sub("-", ascii_str).strip("-_")
    cleaned = re.sub(r"-{2,}", "-", cleaned)
    cleaned = cleaned.lstrip("-_")
    if not cleaned:
        return ""
    if not cleaned[0].isalnum():
        cleaned = re.sub(r"^[^a-zA-Z0-9]+", "", cleaned)
    return cleaned[:max_len].rstrip("-_")


def deterministic_id(prefix: str, *parts: str, max_len: int = 80) -> str:
    """Build a deterministic ASCII slug + 6-char SHA-1 suffix ID."""
    clean_parts = [str(p).strip() for p in parts if p is not None and str(p).strip()]
    digest_input = f"{prefix}|" + "|".join(clean_parts)
    digest = hashlib.sha1(digest_input.encode("utf-8")).hexdigest()[:6]

    prefix_slug = _NON_SLUG_CHARS_RE.sub("-", unicodedata.normalize("NFKD", prefix).encode("ascii", "ignore").decode("ascii").lower()).strip("-")
    raw_body = " ".join(clean_parts[:2])
    body_ascii = unicodedata.normalize("NFKD", raw_body).encode("ascii", "ignore").decode("ascii").lower()
    body_slug = _NON_SLUG_CHARS_RE.sub("-", body_ascii).strip("-")

    # Reserve room for "-" + 6-char digest and optional prefix + "-"
    suffix = f"-{digest}"
    head = f"{prefix_slug}-" if prefix_slug else ""
    budget = max(0, max_len - len(head) - len(suffix))
    if budget > 0 and body_slug:
        trimmed_slug = body_slug[:budget].rstrip("-")
        candidate = f"{head}{trimmed_slug}{suffix}" if trimmed_slug else f"{prefix_slug or 'item'}{suffix}"
    else:
        candidate = f"{prefix_slug or 'item'}{suffix}"

    result = sanitize_id(candidate, max_len=max_len)
    if not result:
        return f"item-{digest}"
    return result


def ensure_card_id(current_id: str | None, prefix: str, *parts: str, max_len: int = 80) -> str:
    """Preserve a valid existing card ID, or synthesize a deterministic one."""
    if isinstance(current_id, str):
        trimmed = current_id.strip()
        if CARD_ID_RE.match(trimmed) and len(trimmed) <= max_len:
            return trimmed
    return deterministic_id(prefix, *parts, max_len=max_len)


def dedupe_ids(items: Sequence[Any], attr: str = "id", max_len: int = 80) -> None:
    """Ensure every item in `items` has a unique ID in place, appending `-2`, `-3`, ... on collision."""
    seen: set[str] = set()
    for item in items:
        is_dict = isinstance(item, dict)
        raw_id = item.get(attr, "") if is_dict else getattr(item, attr, "")
        base = sanitize_id(str(raw_id), max_len=max_len) or deterministic_id("item", str(len(seen)))
        candidate = base
        if candidate in seen:
            counter = 2
            while True:
                tag = f"-{counter}"
                trimmed = base[: max_len - len(tag)].rstrip("-_") or "item"
                candidate = f"{trimmed}{tag}"
                if candidate not in seen:
                    break
                counter += 1
        seen.add(candidate)
        if candidate != raw_id:
            if is_dict:
                item[attr] = candidate
            else:
                setattr(item, attr, candidate)
