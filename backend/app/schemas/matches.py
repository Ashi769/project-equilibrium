from pydantic import BaseModel


class DimensionScore(BaseModel):
    label: str
    score: float
    description: str = ""


class MatchSummary(BaseModel):
    id: str
    name: str
    age: int | None
    compatibility_score: float
    top_dimensions: list[DimensionScore]


class MatchDetail(BaseModel):
    id: str
    name: str
    age: int | None
    compatibility_score: float
    dimension_scores: list[DimensionScore]
    attachment_style: str | None
    shared_values: list[str]
