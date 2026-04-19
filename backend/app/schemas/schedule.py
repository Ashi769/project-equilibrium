from datetime import datetime
from pydantic import BaseModel
from app.models.schedule import MeetingStatus, VerdictChoice


class ProposeRequest(BaseModel):
    match_id: str
    slot_1: datetime
    slot_2: datetime
    slot_3: datetime


class LockRequest(BaseModel):
    meeting_id: str
    locked_slot: datetime


class VerdictRequest(BaseModel):
    meeting_id: str
    verdict: VerdictChoice


class MeetingResponse(BaseModel):
    id: str
    proposer_id: str
    match_id: str
    proposer_name: str | None = None
    match_name: str | None = None
    proposer_email: str | None = None
    match_email: str | None = None
    slot_1: datetime
    slot_2: datetime
    slot_3: datetime
    locked_slot: datetime | None
    status: MeetingStatus
    proposer_verdict: VerdictChoice | None
    match_verdict: VerdictChoice | None
    created_at: datetime
    is_mutual_match: bool = False

    model_config = {"from_attributes": True}
