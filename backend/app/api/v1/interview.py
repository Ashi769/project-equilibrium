import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
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
from app.services.interview_service import (
    stream_response,
    check_covered_topics,
    all_topics_covered,
    OPENING_MESSAGE,
    CLOSING_MESSAGE,
)
from app.workers.tasks import process_interview_transcript

router = APIRouter(prefix="/interview", tags=["interview"])


@router.post("/start", response_model=InterviewStartResponse)
async def start_interview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = InterviewSession(user_id=current_user.id)
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

    transcript = decrypt_json(session.transcript_encrypted)
    transcript.append({"role": "user", "content": body.message})

    # Check topic coverage BEFORE streaming (parallel with stream setup)
    covered = await check_covered_topics(transcript)
    should_end = all_topics_covered(covered)

    full_response_parts: list[str] = []
    stream_complete = asyncio.Event()

    async def generate():
        try:
            if should_end:
                for word in CLOSING_MESSAGE.split(" "):
                    chunk = word + " "
                    full_response_parts.append(chunk)
                    yield f"data: {chunk}\n\n"
                yield "data: [END_INTERVIEW]\n\n"
            else:
                async for chunk in stream_response(transcript):
                    if chunk.startswith("data: ") and not chunk.startswith("data: ["):
                        full_response_parts.append(chunk[6:].rstrip("\n"))
                    yield chunk
        finally:
            stream_complete.set()

    async def persist_after_stream(response: StreamingResponse):
        await stream_complete.wait()
        assistant_text = "".join(full_response_parts).strip()
        transcript.append({"role": "assistant", "content": assistant_text})
        session.transcript_encrypted = encrypt_json(transcript)
        await db.commit()

    response = StreamingResponse(generate(), media_type="text/event-stream")
    response.background = BackgroundTask(persist_after_stream, response)
    return response


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

    profile_result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == current_user.id)
    )
    profile = profile_result.scalar_one_or_none()
    if profile:
        profile.analysis_status = AnalysisStatus.processing

    await db.commit()
    process_interview_transcript.delay(session.id)

    return {"status": "processing"}


@router.post("/reset")
async def reset_interview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return {"status": "reset"}
