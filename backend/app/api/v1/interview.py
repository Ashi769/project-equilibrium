import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.encryption import encrypt_json, decrypt_json
from app.models.user import User
from app.models.interview import InterviewSession, ProcessingStatus
from app.models.psychometric import PsychometricProfile, AnalysisStatus
from app.schemas.interview import (
    InterviewStartResponse,
    InterviewMessageRequest,
    InterviewEndRequest,
)
from app.services.interview_service import stream_response, OPENING_MESSAGE
from app.workers.tasks import process_interview_transcript

router = APIRouter(prefix="/interview", tags=["interview"])


@router.post("/start", response_model=InterviewStartResponse)
async def start_interview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = InterviewSession(user_id=current_user.id)
    # Store empty transcript with opening message already in it
    initial_transcript = [{"role": "assistant", "content": OPENING_MESSAGE}]
    session.transcript_encrypted = encrypt_json(initial_transcript)
    db.add(session)
    await db.flush()

    return InterviewStartResponse(session_id=session.id, opening_message=OPENING_MESSAGE)


@router.post("/message")
async def send_message(
    body: InterviewMessageRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InterviewSession).where(
            InterviewSession.id == body.session_id,
            InterviewSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Decrypt and append user message
    transcript = decrypt_json(session.transcript_encrypted)
    transcript.append({"role": "user", "content": body.message})

    # Collect full assistant response to store in transcript
    full_response_parts: list[str] = []

    async def generate():
        async for chunk in stream_response(transcript, body.session_id):
            # Collect non-sentinel content
            if chunk.startswith("data: ") and not chunk.startswith("data: ["):
                full_response_parts.append(chunk[6:].rstrip("\n"))
            yield chunk

        # After streaming: persist updated transcript
        assistant_text = "".join(full_response_parts)
        transcript.append({"role": "assistant", "content": assistant_text})
        session.transcript_encrypted = encrypt_json(transcript)
        await db.commit()

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.post("/end")
async def end_interview(
    body: InterviewEndRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(InterviewSession).where(
            InterviewSession.id == body.session_id,
            InterviewSession.user_id == current_user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.processing_status = ProcessingStatus.processing
    session.completed_at = datetime.now(timezone.utc)

    # Update profile status
    profile_result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == current_user.id)
    )
    profile = profile_result.scalar_one_or_none()
    if profile:
        profile.analysis_status = AnalysisStatus.processing

    await db.commit()

    # Fire Celery task
    process_interview_transcript.delay(session.id)

    return {"status": "processing"}


@router.post("/reset")
async def reset_interview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Allow re-interview: resets psychometric profile status."""
    result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == current_user.id)
    )
    profile = result.scalar_one_or_none()
    if profile:
        profile.analysis_status = AnalysisStatus.pending
        profile.identity_vector = None
        profile.aspiration_vector = None

    return {"status": "reset"}
