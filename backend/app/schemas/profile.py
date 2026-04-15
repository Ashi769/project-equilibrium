from pydantic import BaseModel
from app.models.psychometric import AnalysisStatus


class HardFilters(BaseModel):
    wants_children: bool | None = None
    max_age_diff: int | None = None
    seeking_gender: list[str] = []


class ProfileResponse(BaseModel):
    id: str
    name: str
    email: str
    age: int | None
    gender: str | None
    analysis_status: AnalysisStatus | None
    hard_filters: dict

    model_config = {"from_attributes": True}


class ProfileUpdateRequest(BaseModel):
    hard_filters: HardFilters | None = None
