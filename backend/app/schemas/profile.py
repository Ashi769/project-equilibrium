from datetime import datetime
from pydantic import BaseModel
from app.models.psychometric import AnalysisStatus


class HardFilters(BaseModel):
    wants_children: bool | None = None
    max_age_diff: int | None = None
    seeking_gender: list[str] = []
    seeking_drinking: str | None = None
    seeking_smoking: str | None = None
    seeking_religion: str | None = None
    seeking_language: str | None = None
    seeking_food: str | None = None


class UserAttributes(BaseModel):
    height: int | None = None
    drinking: str | None = None
    smoking: str | None = None
    religion: str | None = None
    language: str | None = None
    food_preference: str | None = None


class ProfileResponse(BaseModel):
    id: str
    name: str
    email: str
    age: int | None
    gender: str | None
    height: int | None = None
    drinking: str | None = None
    smoking: str | None = None
    religion: str | None = None
    language: str | None = None
    food_preference: str | None = None
    analysis_status: AnalysisStatus | None
    hard_filters: dict
    reinterview_due: bool = False
    reinterview_due_at: datetime | None = None

    model_config = {"from_attributes": True}


class ProfileUpdateRequest(BaseModel):
    hard_filters: HardFilters | None = None
    attributes: UserAttributes | None = None
