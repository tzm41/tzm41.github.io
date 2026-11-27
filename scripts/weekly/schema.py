"""Pydantic v2 schemas for the Weekly Briefing JSON artifacts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from ..common.ids import dedupe_ids, ensure_card_id
from .config import MAX_ARCHIVE_WEEKS

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


EntityType = Literal["company", "person", "place", "none"]


class EntityIdentity(BaseModel):
    mention: str = Field(description="Exact surface text as it appears in the item/edition.")
    type: EntityType = Field(description="Semantic entity type: 'company', 'person', 'place', or 'none' to suppress false-positive auto-tagging.")
    canonical_name: str = Field(default="", description="Full disambiguated canonical name.")
    domain: str = Field(default="", description="Primary web domain for logo lookup when type='company'.")
    country_code: str = Field(default="", description="2-letter lowercase ISO code when type='place'.")
    wiki_title: str = Field(default="", description="Exact English Wikipedia article title.")


class WeeklyDigestBullet(BaseModel):
    text: str = Field(
        description="Concise 1-2 sentence weekly synthesis bullet with **bold** key insight and *italic* person names."
    )
    points: list[str] = Field(
        min_length=1,
        description="1 to 3 standalone single-story bullet points breaking down `text` (one distinct discovery/work per point, preserving **bold** takeaways and *italic* human names).",
    )
    category: Literal["Science", "Culture & Arts", "History", "Long Reads", "World"] = "Science"
    sentiment: SentimentTag = "positive"


class FeaturedQuote(BaseModel):
    quote: str = Field(description="Memorable historical, scientific, or artistic quote or aphorism tied to this week's themes.")
    author: str = Field(description="Author or thinker behind the quote.")
    context: str = Field(default="", description="Short context (work, year, or connection to this week's edition).")


class WeeklyLearningItem(BaseModel):
    id: str = ""
    category: str = Field(description="Short badge such as Physics, Biology, Space, Visual Arts, Architecture, Literature, Archaeology, History.")
    discipline: str = Field(default="", description="Optional narrower field or era label, e.g. 'Quantum Optics' or 'Bronze Age'.")
    headline: str
    summary: str = Field(description="2-3 sentences of rich educational explanation using **bold** key insights and *italic* human names.")
    takeaway: str = Field(default="", description="1 concise sentence explaining why this discovery/work matters or what mental model it shifts.")
    sentiment: SentimentTag = "positive"
    sources: list[SourceLink] = Field(default_factory=list)
    entities: list[EntityIdentity] = Field(
        default_factory=list,
        description="Optional semantically disambiguated entity identities for ambiguous acronyms/homonyms mentioned in this item.",
    )

    @model_validator(mode="after")
    def _ensure_id(self) -> WeeklyLearningItem:
        first_url = self.sources[0].url if self.sources else ""
        self.id = ensure_card_id(self.id, "learn", self.category, self.headline, first_url)
        return self


class LearningSection(BaseModel):
    narrative: str = Field(default="", description="1-2 sentence thematic framing for this section.")
    items: list[WeeklyLearningItem] = Field(default_factory=list)


class HistoryMilestone(BaseModel):
    id: str = ""
    year: str = Field(description="Year or era, e.g. '1922' or '1609'.")
    date_label: str = Field(default="", description="Calendar date in this week, e.g. 'Nov 26'.")
    title: str
    summary: str = Field(description="1-2 sentences capturing why this historical turning point still resonates.")

    @model_validator(mode="after")
    def _ensure_id(self) -> HistoryMilestone:
        self.id = ensure_card_id(self.id, "milestone", self.year, self.title)
        return self


class GeoFact(BaseModel):
    id: str = ""
    kind: Literal["geology", "cuisine"] = Field(
        default="geology",
        description="Pin type: 'geology' for geological wonders or 'cuisine' for iconic regional dishes/culinary traditions.",
    )
    place: str = Field(description="Name of the geological landmark, city, or dish origin, e.g. 'Danakil Depression' or 'Oaxaca'.")
    region: str = Field(description="Country or region label, e.g. 'Ethiopia' or 'Mexico'.")
    country_code: str = Field(default="", description="Optional 2-letter lowercase ISO country code for flag display, e.g. 'et', 'au', 'mx'.")
    lat: float = Field(description="Latitude in decimal degrees (-60 to 82).")
    lon: float = Field(description="Longitude in decimal degrees (-180 to 180).")
    feature_type: str = Field(description="Short discipline tag: e.g. Tectonics, Volcanology, Karst, Deep Time (for geology) or Regional Dish, Street Food, Fermentation, Pastry, Culinary Heritage (for cuisine).")
    title: str = Field(description="Punchy 4-9 word title capturing the geological wonder or iconic dish.")
    fact: str = Field(description="2-3 engaging sentences explaining the geological fun fact or culinary history/technique, using **bold** for the key mechanism, ingredients, or number.")
    wiki_title: str = Field(default="", description="Optional exact English Wikipedia article title for further reading.")

    @model_validator(mode="after")
    def _ensure_id(self) -> GeoFact:
        prefix = "food" if self.kind == "cuisine" else "geo"
        self.id = ensure_card_id(self.id, prefix, self.place, self.title)
        return self


class LongReadItem(BaseModel):
    id: str = ""
    topic: str = Field(description="Short topic label such as Essay, Philosophy, Architecture, Science History, Cultural Criticism.")
    reading_time: str = Field(default="10 min read", description="Estimated reading time like '12 min read'.")
    headline: str
    summary: str = Field(description="2-3 sentences summarizing the essay's central argument and why it is worth reading.")
    sources: list[SourceLink] = Field(default_factory=list)
    entities: list[EntityIdentity] = Field(
        default_factory=list,
        description="Optional semantically disambiguated entity identities for ambiguous acronyms/homonyms mentioned in this essay.",
    )

    @model_validator(mode="after")
    def _ensure_id(self) -> LongReadItem:
        first_url = self.sources[0].url if self.sources else ""
        self.id = ensure_card_id(self.id, "lr", self.headline, first_url)
        return self


class PulseBullet(BaseModel):
    text: str
    points: list[str] = Field(
        min_length=1,
        description="1 to 3 standalone single-news bullet points breaking down `text` (one distinct development per point, preserving **bold** takeaways and *italic* human names).",
    )
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
    around_the_world: list[GeoFact] = Field(
        default_factory=list,
        description="10-11 geographically diverse pins across all inhabited continents: 6 geological fun facts (kind='geology') and 4-5 iconic regional dishes/cuisines (kind='cuisine') with accurate lat/lon coordinates.",
    )
    long_reads: list[LongReadItem] = Field(description="4-5 curated long-form essays or deep dives worth lingering over.")
    week_in_brief: list[PulseBullet] = Field(description="3-4 concise bullets recapping major world/macro developments from the past week, keeping politics/markets light.")
    entities: list[EntityIdentity] = Field(
        default_factory=list,
        description="Edition-wide semantically disambiguated entity identities for ambiguous acronyms, homonyms, or scientific/cultural terms (e.g., CMB -> cosmic microwave background with type='none'; Apple the fruit -> type='none').",
    )


class WeeklyBriefing(BaseModel):
    schema_version: str = "1.1"
    archive_ttl_days: int = MAX_ARCHIVE_WEEKS * 7
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
    around_the_world: list[GeoFact] = Field(default_factory=list)
    long_reads: list[LongReadItem]
    week_in_brief: list[PulseBullet]
    source_health: WeeklySourceHealth
    entities: list[EntityIdentity] = Field(default_factory=list)

    @model_validator(mode="after")
    def _dedupe_section_ids(self) -> WeeklyBriefing:
        dedupe_ids(self.science.items)
        dedupe_ids(self.culture.items)
        dedupe_ids(self.history.items)
        dedupe_ids(self.this_week_in_history)
        dedupe_ids(self.around_the_world)
        dedupe_ids(self.long_reads)
        return self
