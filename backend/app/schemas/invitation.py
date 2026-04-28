from datetime import datetime
from pydantic import BaseModel, computed_field
from datetime import timezone


class InvitationOut(BaseModel):
    id: str
    token: str
    status: str
    used_by: str | None
    used_at: datetime | None
    revoked_at: datetime | None
    expires_at: datetime
    created_at: datetime

    @computed_field
    @property
    def is_expired(self) -> bool:
        return datetime.now(timezone.utc) > self.expires_at

    @computed_field
    @property
    def is_used(self) -> bool:
        return self.status == "used"

    @computed_field
    @property
    def is_revoked(self) -> bool:
        return self.status == "revoked"

    model_config = {"from_attributes": True}


class InvitationJoinInfo(BaseModel):
    token: str
    inviter_name: str
    expires_at: datetime


class InvitationListResponse(BaseModel):
    invitations: list[InvitationOut]
    used_count: int
    remaining: int
    max_allowed: int
