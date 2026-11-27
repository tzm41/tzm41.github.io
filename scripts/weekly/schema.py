"""Pydantic v2 schemas for the Weekly Briefing JSON artifacts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

SentimentTag = Literal[
    "very_negative",
    "negative",
    "slightly_negative",
    "neutral",
    "slightly_positive",
    "positive",
    "very_positive",
]

HealthStatus = Literal["ok", "partial", "failed"]


class SourceLink(BaseModel):
    name: str
    url: str


class WeeklyDigestBullet(BaseModel):
    text: str = Field(
        description="Concise 1-2 sentence weekly synthesis bullet with **bold** key insight and *italic* person names."
    )
    category: Literal["Science", "Culture & Arts", "History", "Long Reads", "World"] = "Science"
    sentiment: SentimentTag = "positive"


class FeaturedQuote(BaseModel):
    quote: str = Field(description="Memorable historical, scientific, or artistic quote or aphorism tied to this week's themes.")
    author: str = Field(description="Author or thinker behind the quote.")
    context: str = Field(default="", description="Short context (work, year, or connection to this week's edition).")


class WeeklyLearningItem(BaseModel):
    id: str
    category: str = Field(description="Short badge such as Physics, Biology, Space, Visual Arts, Architecture, Literature, Archaeology, History.")
    discipline: str = Field(default="", description="Optional narrower field or era label, e.g. 'Quantum Optics' or 'Bronze Age'.")
    headline: str
    summary: str = Field(description="2-3 sentences of rich educational explanation using **bold** key insights and *italic* human names.")
    takeaway: str = Field(default="", description="1 concise sentence explaining why this discovery/work matters or what mental model it shifts.")
    sentiment: SentimentTag = "positive"
    sources: list[SourceLink] = Field(default_factory=list)


class LearningSection(BaseModel):
    narrative: str = Field(default="", description="1-2 sentence thematic framing for this section.")
    items: list[WeeklyLearningItem] = Field(default_factory=list)


class HistoryMilestone(BaseModel):
    year: str = Field(description="Year or era, e.g. '1922' or '1609'.")
    date_label: str = Field(default="", description="Calendar date in this week, e.g. 'Nov 26'.")
    title: str
    summary: str = Field(description="1-2 sentences capturing why this historical turning point still resonates.")


class LongReadItem(BaseModel):
    id: str
    topic: str = Field(description="Short topic label such as Essay, Philosophy, Architecture, Science History, Cultural Criticism.")
    reading_time: str = Field(default="10 min read", description="Estimated reading time like '12 min read'.")
    headline: str
    summary: str = Field(description="2-3 sentences summarizing the essay's central argument and why it is worth reading.")
    sources: list[SourceLink] = Field(default_factory=list)


class PulseBullet(BaseModel):
    text: str
    category: Literal["World", "Economy", "Tech", "Policy", "Climate"] = "World"
    sentiment: SentimentTag = "neutral"


class WeeklySourceHealth(BaseModel):
    science: HealthStatus = "ok"
    culture: HealthStatus = "ok"
    history: HealthStatus = "ok"
    long_reads: HealthStatus = "ok"


class WeeklySynthesis(BaseModel):
    """Structured weekly synthesis output produced by the active Antigravity model."""

    theme_title: str = Field(description="Evocative 2-5 word thematic title capturing the thread across this Sunday's learnings.")
    digest: list[WeeklyDigestBullet] = Field(description="4-6 high-signal weekly takeaway bullets across science, culture, arts, and history.")
    featured_quote: FeaturedQuote
    science: LearningSection = Field(description="4-5 grounded science, math, space, biology, or nature discoveries.")
    culture: LearningSection = Field(description="4-5 grounded visual art, architecture, literature, film, music, or cultural stories.")
    history: LearningSection = Field(description="3-4 grounded archaeology, archival, or deep-history stories.")
    this_week_in_history: list[HistoryMilestone] = Field(description="4 notable historical, scientific, or artistic anniversaries falling within this calendar week.")
    long_reads: list[LongReadItem] = Field(description="4-5 curated long-form essays or deep dives worth lingering over.")
    week_in_brief: list[PulseBullet] = Field(description="3-4 concise bullets recapping major world/macro developments from the past week, keeping politics/markets light.")


class WeeklyBriefing(BaseModel):
    schema_version: str = "1.0"
    date: str
    week_label: str
    generated_at: str
    theme_title: str
    digest: list[WeeklyDigestBullet]
    featured_quote: FeaturedQuote
    science: LearningSection
    culture: LearningSection
    history: LearningSection
    this_week_in_history: list[HistoryMilestone]
    long_reads: list[LongReadItem]
    week_in_brief: list[PulseBullet]
    source_health: WeeklySourceHealth
