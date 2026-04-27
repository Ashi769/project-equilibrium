from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete
from sqlalchemy.orm import aliased

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.schedule import Meeting, MeetingStatus, VerdictChoice
from app.models.match import Match
from app.schemas.schedule import (
    ProposeRequest,
    CounterRequest,
    LockRequest,
    VerdictRequest,
    MeetingResponse,
)

router = APIRouter(prefix="/schedule", tags=["schedule"])


def _meeting_to_response(
    meeting: Meeting,
    current_user_id: str,
    proposer_name: str | None = None,
    match_name: str | None = None,
    proposer_email: str | None = None,
    match_email: str | None = None,
) -> MeetingResponse:
    is_mutual = (
        meeting.proposer_verdict == VerdictChoice.commit
        and meeting.match_verdict == VerdictChoice.commit
    )
    partner_committed = False
    if current_user_id == meeting.proposer_id:
        partner_committed = meeting.match_verdict == VerdictChoice.commit
    elif current_user_id == meeting.match_id:
        partner_committed = meeting.proposer_verdict == VerdictChoice.commit
    return MeetingResponse(
        id=meeting.id,
        proposer_id=meeting.proposer_id,
        match_id=meeting.match_id,
        proposer_name=proposer_name,
        match_name=match_name,
        proposer_email=proposer_email if is_mutual else None,
        match_email=match_email if is_mutual else None,
        slot_1=meeting.slot_1,
        slot_2=meeting.slot_2,
        slot_3=meeting.slot_3,
        locked_slot=meeting.locked_slot,
        status=meeting.status,
        proposer_verdict=meeting.proposer_verdict,
        match_verdict=meeting.match_verdict,
        created_at=meeting.created_at,
        is_mutual_match=is_mutual,
        partner_committed=partner_committed,
    )


async def _fetch_meeting_with_users(meeting_id: str, db: AsyncSession):
    ProposerUser = aliased(User)
    MatchUser = aliased(User)
    result = await db.execute(
        select(
            Meeting,
            ProposerUser.name,
            MatchUser.name,
            ProposerUser.email,
            MatchUser.email,
        )
        .join(ProposerUser, ProposerUser.id == Meeting.proposer_id)
        .join(MatchUser, MatchUser.id == Meeting.match_id)
        .where(Meeting.id == meeting_id)
    )
    row = result.first()
    if not row:
        return None
    return row[0], row[1], row[2], row[3], row[4]


@router.post("/propose", response_model=MeetingResponse)
async def propose_meeting(
    body: ProposeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if body.match_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot schedule with yourself")

    result = await db.execute(
        select(Meeting).where(
            or_(
                (Meeting.proposer_id == current_user.id)
                & (Meeting.match_id == body.match_id),
                (Meeting.proposer_id == body.match_id)
                & (Meeting.match_id == current_user.id),
            ),
            Meeting.status.in_([MeetingStatus.proposed, MeetingStatus.confirmed]),
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=409, detail="Active meeting already exists with this match"
        )

    match_user = await db.get(User, body.match_id)

    meeting = Meeting(
        proposer_id=current_user.id,
        match_id=body.match_id,
        slot_1=body.slot_1,
        slot_2=body.slot_2,
        slot_3=body.slot_3,
    )
    db.add(meeting)

    await db.execute(
        delete(Match).where(
            Match.user_id == current_user.id,
            Match.matched_user_id == body.match_id,
        )
    )
    await db.execute(
        delete(Match).where(
            Match.user_id == body.match_id,
            Match.matched_user_id == current_user.id,
        )
    )

    await db.commit()
    return _meeting_to_response(
        meeting,
        current_user.id,
        current_user.name,
        match_user.name if match_user else None,
        current_user.email,
        match_user.email if match_user else None,
    )


@router.post("/lock", response_model=MeetingResponse)
async def lock_slot(
    body: LockRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _fetch_meeting_with_users(body.meeting_id, db)
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting, proposer_name, match_name, proposer_email, match_email = row

    if current_user.id not in (meeting.proposer_id, meeting.match_id):
        raise HTTPException(status_code=403, detail="Not a participant")

    if meeting.status != MeetingStatus.proposed:
        raise HTTPException(status_code=400, detail="Meeting is not in proposed state")

    valid_slots = {meeting.slot_1, meeting.slot_2, meeting.slot_3}
    if body.locked_slot not in valid_slots:
        raise HTTPException(status_code=400, detail="Slot not in proposed options")

    meeting.locked_slot = body.locked_slot
    meeting.status = MeetingStatus.confirmed
    await db.commit()
    return _meeting_to_response(
        meeting, current_user.id, proposer_name, match_name, proposer_email, match_email
    )


@router.post("/verdict", response_model=MeetingResponse)
async def submit_verdict(
    body: VerdictRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _fetch_meeting_with_users(body.meeting_id, db)
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting, proposer_name, match_name, proposer_email, match_email = row

    if current_user.id == meeting.proposer_id:
        meeting.proposer_verdict = body.verdict
    elif current_user.id == meeting.match_id:
        meeting.match_verdict = body.verdict
    else:
        raise HTTPException(status_code=403, detail="Not a participant")

    if meeting.proposer_verdict and meeting.match_verdict:
        meeting.status = MeetingStatus.completed

    await db.commit()
    return _meeting_to_response(
        meeting, current_user.id, proposer_name, match_name, proposer_email, match_email
    )


@router.post("/{meeting_id}/decline", response_model=MeetingResponse)
async def decline_meeting(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _fetch_meeting_with_users(meeting_id, db)
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting, proposer_name, match_name, proposer_email, match_email = row

    if current_user.id != meeting.match_id:
        raise HTTPException(status_code=403, detail="Only the recipient can decline")

    if meeting.status != MeetingStatus.proposed:
        raise HTTPException(status_code=400, detail="Only proposed meetings can be declined")

    meeting.status = MeetingStatus.cancelled
    await db.commit()
    return _meeting_to_response(
        meeting, current_user.id, proposer_name, match_name, proposer_email, match_email
    )


@router.post("/{meeting_id}/counter", response_model=MeetingResponse)
async def counter_propose(
    meeting_id: str,
    body: CounterRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _fetch_meeting_with_users(meeting_id, db)
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting, proposer_name, match_name, proposer_email, match_email = row

    if current_user.id != meeting.match_id:
        raise HTTPException(status_code=403, detail="Only the recipient can counter-propose")

    if meeting.status != MeetingStatus.proposed:
        raise HTTPException(status_code=400, detail="Only proposed meetings can be countered")

    original_proposer_id = meeting.proposer_id
    meeting.status = MeetingStatus.cancelled

    existing = await db.execute(
        select(Meeting).where(
            Meeting.proposer_id == current_user.id,
            Meeting.match_id == original_proposer_id,
            Meeting.status.in_([MeetingStatus.proposed, MeetingStatus.confirmed]),
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Active meeting already exists")

    new_meeting = Meeting(
        proposer_id=current_user.id,
        match_id=original_proposer_id,
        slot_1=body.slot_1,
        slot_2=body.slot_2,
        slot_3=body.slot_3,
    )
    db.add(new_meeting)
    await db.commit()
    await db.refresh(new_meeting)

    # Names/emails are now flipped — current_user is the new proposer
    return _meeting_to_response(
        new_meeting,
        current_user.id,
        proposer_name=match_name,
        match_name=proposer_name,
        proposer_email=match_email,
        match_email=proposer_email,
    )


@router.get("", response_model=list[MeetingResponse])
async def list_meetings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ProposerUser = aliased(User)
    MatchUser = aliased(User)
    result = await db.execute(
        select(
            Meeting,
            ProposerUser.name,
            MatchUser.name,
            ProposerUser.email,
            MatchUser.email,
        )
        .join(ProposerUser, ProposerUser.id == Meeting.proposer_id)
        .join(MatchUser, MatchUser.id == Meeting.match_id)
        .where(
            or_(
                Meeting.proposer_id == current_user.id,
                Meeting.match_id == current_user.id,
            )
        )
        .order_by(Meeting.created_at.desc())
    )
    rows = result.all()
    return [
        _meeting_to_response(m, current_user.id, pn, mn, pe, me)
        for m, pn, mn, pe, me in rows
    ]


@router.get("/{meeting_id}", response_model=MeetingResponse)
async def get_meeting(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = await _fetch_meeting_with_users(meeting_id, db)
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    meeting, proposer_name, match_name, proposer_email, match_email = row

    if current_user.id not in (meeting.proposer_id, meeting.match_id):
        raise HTTPException(status_code=403, detail="Not a participant")
    return _meeting_to_response(
        meeting, current_user.id, proposer_name, match_name, proposer_email, match_email
    )
