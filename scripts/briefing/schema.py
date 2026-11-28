"""Pydantic models defining the JSON data contract for the daily briefing."""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field, model_validator

from ..common.ids import dedupe_ids, ensure_card_id
from .config import MAX_ARCHIVE_DAYS


HealthStatus = Literal["ok", "partial", "failed"]
NewsCategory = Literal["World", "Economy", "Tech", "Policy", "Science"]
LocalNewsCategory = Literal[
    "Weather",
    "Transit",
    "Housing",
    "Sports",
    "Community",
    "Public Safety",
    "Finance",
    "Trade",
    "Tech",
    "Economy",
    "Policy",
    "Culture",
    "Health",
    "Education",
    "Science",
    "Industry",
    "World",
]
StorySentiment = Literal[
    "very_negative",
    "negative",
    "slightly_negative",
    "neutral",
    "slightly_positive",
    "positive",
    "very_positive",
]
MarketRegime = Literal["Risk-On", "Risk-Off", "Mixed", "Volatility Spike"]
ConflictStatus = Literal["escalating", "elevated", "stable", "de-escalating"]
TrendDirection = Literal["up", "flat", "down"]
MomentumTag = Literal["rising", "steady", "cooling"]


class SourceLink(BaseModel):
    name: str
    url: str


EntityType = Literal["company", "person", "place", "none"]


class EntityIdentity(BaseModel):
    mention: str = Field(
        description="Exact surface text as it appears in the story/briefing (e.g., 'ABC', 'BOC', 'Georgia', 'Apple')."
    )
    type: EntityType = Field(
        description="Semantic identity type: 'company' (for companies, banks, institutions), 'person', 'place', or 'none' to suppress false-positive auto-tagging."
    )
    canonical_name: str = Field(
        default="",
        description="Full disambiguated canonical name (e.g., 'Agricultural Bank of China', 'Bank of China', 'Georgia (U.S. state)').",
    )
    domain: str = Field(
        default="",
        description="Primary web domain for logo/fact lookup when type='company' (e.g., 'abchina.com', 'icbc.com.cn', 'jpmorganchase.com').",
    )
    country_code: str = Field(
        default="",
        description="2-letter lowercase ISO code when type='place' (e.g., 'ge', 'cn', 'us').",
    )
    wiki_title: str = Field(
        default="",
        description="Exact English Wikipedia article title for direct linking (e.g., 'Agricultural_Bank_of_China').",
    )


class NewsStory(BaseModel):
    id: str = ""
    category: NewsCategory
    headline: str
    summary: str
    why_it_matters: str
    reader_text: str = Field(
        default="",
        description="Optional clean spoken/reader prose (plain text without markdown or parenthetical ticker syntax) for TTS playback.",
    )
    sources: list[SourceLink] = Field(default_factory=list)
    sentiment: StorySentiment = "neutral"
    continued_from_prior: bool = False
    is_afternoon: bool = False
    entities: list[EntityIdentity] = Field(
        default_factory=list,
        description="Optional semantically disambiguated entity identities for ambiguous acronyms, homonyms, banks, companies, people, or places mentioned in this story.",
    )

    @model_validator(mode="after")
    def _ensure_id(self) -> NewsStory:
        first_url = self.sources[0].url if self.sources else ""
        self.id = ensure_card_id(self.id, "story", self.headline, first_url)
        return self


class MarketQuote(BaseModel):
    symbol: str
    name: str
    group: str
    price: float
    change_pct: float
    change_5d_pct: float = 0.0
    change_30d_pct: float = 0.0
    sparkline_1d: list[float] = Field(default_factory=list)
    sparkline_1d_times: list[str] = Field(default_factory=list)
    sparkline_5d: list[float] = Field(default_factory=list)
    sparkline_5d_times: list[str] = Field(default_factory=list)
    sparkline_30d: list[float] = Field(default_factory=list)
    sparkline_30d_times: list[str] = Field(default_factory=list)


class SectorTile(BaseModel):
    symbol: str
    name: str
    change_pct: float
    change_5d_pct: float = 0.0
    change_30d_pct: float = 0.0


class FearGreedIndex(BaseModel):
    score: float
    rating: str
    previous_close: float | None = None
    previous_1_week: float | None = None
    previous_1_month: float | None = None
    previous_1_year: float | None = None


class MentionedQuote(BaseModel):
    symbol: str
    name: str
    price: float
    change_pct: float
    currency: str = "$"
    aliases: list[str] = Field(default_factory=list)


class MarketsSection(BaseModel):
    narrative: str
    regime_tag: MarketRegime = "Mixed"
    watchlist: list[MarketQuote] = Field(default_factory=list)
    big7: list[MarketQuote] = Field(default_factory=list)
    fear_greed: FearGreedIndex | None = None
    sectors: list[SectorTile] = Field(default_factory=list)
    mentioned_quotes: list[MentionedQuote] = Field(default_factory=list)


class TimelineEvent(BaseModel):
    headline: str
    source: str
    url: str


class ConflictTheater(BaseModel):
    id: str
    name: str
    region: str
    status: ConflictStatus = "elevated"
    trend_7d: TrendDirection = "flat"
    intensity_score: float = 0.0
    intensity_series_14d: list[float] = Field(default_factory=list)
    intensity_dates_14d: list[str] = Field(default_factory=list)
    summary: str
    timeline_events: list[TimelineEvent] = Field(default_factory=list)


class ConflictsSection(BaseModel):
    overview: str
    theaters: list[ConflictTheater] = Field(default_factory=list)


class PredictionMarket(BaseModel):
    question: str
    yes_prob: float
    delta_24h: float = 0.0
    volume_usd: float = 0.0
    url: str = ""
    source: str = ""


class PolicyItem(BaseModel):
    title: str
    chamber_or_branch: str
    summary: str
    url: str = ""


class PoliticalTopic(BaseModel):
    topic: str
    momentum: MomentumTag = "steady"
    framing_note: str


class PoliticsSection(BaseModel):
    pulse_summary: str
    prediction_markets: list[PredictionMarket] = Field(default_factory=list)
    legislative_and_executive: list[PolicyItem] = Field(default_factory=list)
    trending_topics: list[PoliticalTopic] = Field(default_factory=list)


class SourceHealth(BaseModel):
    news: HealthStatus = "ok"
    markets: HealthStatus = "ok"
    conflicts: HealthStatus = "ok"
    politics: HealthStatus = "ok"
    local_news: HealthStatus = "ok"


class ExecutiveBriefItem(BaseModel):
    text: str
    points: list[str] = Field(
        min_length=1,
        description="1 to 3 concise, self-contained single-news bullet points breaking down `text` (one distinct news development per point, preserving **bold** key takeaways and *italic* human names).",
    )
    category: NewsCategory = "World"
    sentiment: StorySentiment = "neutral"


class BriefSection(BaseModel):
    generated_at: str
    bullets: list[str | ExecutiveBriefItem] = Field(default_factory=list)


AfternoonBrief = BriefSection


class AfternoonSynthesis(BaseModel):
    bullets: list[ExecutiveBriefItem] = Field(
        description="3 to 5 concise afternoon update bullets covering breaking developments since the morning briefing (limit to at most one item primarily about the stock market on US trading days; omit US stock market updates entirely on US weekends or market holidays when us_market_open_today is false), each with `text`, required `points` (1-3 standalone single-news lines), category, 7-level sentiment, **bold** takeaways, and *italic* human names."
    )
    market_narrative: str | None = Field(
        default=None,
        description="Updated 2 to 3 sentence market narrative reflecting the US market close, extended-hours movers, VIX, rates, and commodities, with **bold** takeaways.",
    )
    market_regime: MarketRegime | None = Field(
        default=None,
        description="Updated market regime tag (Risk-On | Risk-Off | Mixed | Volatility Spike) reflecting the afternoon/close session.",
    )
    new_top_news: list[NewsStory] = Field(
        default_factory=list,
        description="2 to 4 newly broken afternoon top news stories not already covered in morning_top_news, each with 2-3 sentence summary, why_it_matters, 7-level sentiment, and verbatim source URLs from raw_news or raw_politics_articles.",
    )


class LocalNewsStory(NewsStory):
    category: LocalNewsCategory


class LocalNewsRegion(BaseModel):
    id: str
    name: str
    stories: list[LocalNewsStory] = Field(default_factory=list)
    stories_en: list[LocalNewsStory] = Field(default_factory=list)

    @model_validator(mode="after")
    def _align_story_ids(self) -> LocalNewsRegion:
        dedupe_ids(self.stories)
        if len(self.stories_en) == len(self.stories):
            for native_story, en_story in zip(self.stories, self.stories_en):
                en_story.id = native_story.id
        else:
            dedupe_ids(self.stories_en)
        return self


class DailyBriefing(BaseModel):
    schema_version: str = "1.1"
    archive_ttl_days: int = MAX_ARCHIVE_DAYS
    date: str
    generated_at: str
    synthesis_mode: Literal["gemini", "extractive_fallback"] = "gemini"
    source_health: SourceHealth = Field(default_factory=SourceHealth)
    morning_brief: BriefSection | None = None
    afternoon_brief: BriefSection | None = None
    executive_brief: list[str | ExecutiveBriefItem] | None = Field(default=None, exclude=True)
    top_news: list[NewsStory] = Field(default_factory=list)
    markets: MarketsSection
    conflicts: ConflictsSection
    us_politics: PoliticsSection
    positive_news: list[NewsStory] | NewsStory | None = None
    local_news: list[LocalNewsRegion] = Field(default_factory=list)
    entities: list[EntityIdentity] = Field(
        default_factory=list,
        description="Edition-wide semantically disambiguated entity identities for ambiguous acronyms, homonyms, or newly-mentioned entities across briefs and narratives.",
    )
    entity_shards: list[str] = Field(
        default_factory=list,
        description="Entity shards required to render all companies mentioned in this edition (always starts with 'hot').",
    )

    @model_validator(mode="after")
    def _dedupe_section_ids(self) -> DailyBriefing:
        dedupe_ids(self.top_news)
        if isinstance(self.positive_news, list):
            dedupe_ids(self.positive_news)
        return self


# --- Gemini structured output schema (LLM generates narratives/summaries only) ---

class TheaterSynthesis(BaseModel):
    id: str
    status: ConflictStatus
    trend_7d: TrendDirection
    summary: str


class GeminiBriefingSynthesis(BaseModel):
    executive_brief: list[ExecutiveBriefItem] = Field(
        description="3 to 5 concise, high-signal morning bullets synthesizing the day across news, markets, conflicts, and US politics, each with category and 7-level sentiment."
    )
    top_news: list[NewsStory] = Field(
        description="6 to 10 deduplicated top news stories with factual 2-3 sentence summaries, why_it_matters, and grounded source links from the provided articles."
    )
    market_narrative: str = Field(
        description="2 to 3 sentence synthesis explaining today's equity, bond, commodity, and sector moves using the provided market numbers and headlines."
    )
    market_regime: MarketRegime
    conflicts_overview: str = Field(
        description="2 sentence global geopolitical temperature check comparing today against recent days."
    )
    conflict_theaters: list[TheaterSynthesis] = Field(
        description="One entry per tracked theater id with updated status, 7-day trend direction, and 2-3 sentence 24h summary."
    )
    politics_pulse_summary: str = Field(
        description="2 to 3 sentence synthesis of key developments in US politics, policy, and public/media framing."
    )
    legislative_and_executive: list[PolicyItem] = Field(
        description="3 to 5 key bills, executive actions, agency moves, or court developments grounded in the provided items."
    )
    trending_topics: list[PoliticalTopic] = Field(
        description="3 to 5 trending US political topics with momentum and neutral framing notes. Every topic MUST be distinct from and non-overlapping with items in legislative_and_executive (never duplicate the same bill, probe, or agency action in both lists)."
    )
    positive_news: list[NewsStory] = Field(
        default_factory=list,
        description="Three distinct uplifting, constructive, or breakthrough positive news stories (science, health, conservation, technology, or human progress), each with a 2-3 sentence summary, why_it_matters, and grounded verbatim source URL.",
    )
    local_news: list[LocalNewsRegion] = Field(
        default_factory=list,
        description="Local news grouped by region id/name from local_news_candidates (3 to 5 top local stories per region with 2-3 sentence summaries, why_it_matters, and verbatim source URLs). Assign each story a specific local topic category (e.g., Weather, Transit, Housing, Sports, Community, Public Safety, Finance, Trade, Tech, Industry, Policy, Culture, Health, Education, Economy) — never generic 'World' or the region name. For non-English regions like 'china', write `stories` in Simplified Chinese and provide the matching English translation in `stories_en` with matching categories.",
    )
    entities: list[EntityIdentity] = Field(
        default_factory=list,
        description="Edition-wide semantically disambiguated entities for ambiguous abbreviations/homonyms (e.g., ABC -> Agricultural Bank of China 'abchina.com' vs ABC News 'abcnews.go.com'; BOC -> Bank of China 'boc.cn' vs Bank of Canada; Georgia US state -> type='none' vs country; CMB -> China Merchants Bank vs Cosmic Microwave Background).",
    )
