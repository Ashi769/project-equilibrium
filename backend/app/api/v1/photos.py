import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.photo import UserPhoto
from app.models.psychometric import PsychometricProfile
from app.services import r2_service

router = APIRouter(prefix="/photos", tags=["photos"])

ALLOWED_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MAX_SIZE_MB = 10
MIN_PHOTOS = 3
MAX_PHOTOS = 5


@router.get("")
async def list_photos(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserPhoto).where(UserPhoto.user_id == current_user.id).order_by(UserPhoto.uploaded_at)
    )
    photos = result.scalars().all()
    return [
        {
            "id": p.id,
            "filename": p.filename,
            "is_selfie": p.is_selfie,
            "url": r2_service.presigned_url(p.r2_key) if p.r2_key else None,
        }
        for p in photos
    ]


@router.post("/upload")
async def upload_photos(
    photos: list[UploadFile] = File(...),
    selfie: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload 3-5 photos + 1 selfie. Triggers async SMV scoring."""
    if not (MIN_PHOTOS <= len(photos) <= MAX_PHOTOS):
        raise HTTPException(
            status_code=422,
            detail=f"Upload between {MIN_PHOTOS} and {MAX_PHOTOS} photos (got {len(photos)})",
        )

    async def _upload(upload: UploadFile, is_selfie: bool) -> tuple[str, str, bool]:
        if upload.content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=422, detail=f"Unsupported file type: {upload.content_type}")
        data = await upload.read()
        if len(data) > MAX_SIZE_MB * 1024 * 1024:
            raise HTTPException(status_code=422, detail=f"File too large (max {MAX_SIZE_MB}MB)")
        ext = ALLOWED_TYPES[upload.content_type]
        filename = f"{'selfie' if is_selfie else uuid.uuid4()}.{ext}"
        key = f"users/{current_user.id}/{filename}"
        r2_service.upload_photo(data, key, upload.content_type)
        return filename, key, is_selfie

    uploaded: list[tuple[str, str, bool]] = []
    for photo in photos:
        uploaded.append(await _upload(photo, is_selfie=False))
    uploaded.append(await _upload(selfie, is_selfie=True))

    # Delete old photos from R2 and DB
    old_result = await db.execute(select(UserPhoto).where(UserPhoto.user_id == current_user.id))
    for old in old_result.scalars().all():
        if old.r2_key:
            r2_service.delete_photo(old.r2_key)
        await db.delete(old)

    for filename, key, is_selfie in uploaded:
        db.add(UserPhoto(
            user_id=current_user.id,
            filename=filename,
            r2_key=key,
            is_selfie=is_selfie,
        ))

    await db.commit()

    from app.workers.tasks import score_user_photos
    score_user_photos.delay(current_user.id)

    return {"uploaded": len(uploaded), "status": "scoring"}


@router.get("/status")
async def photo_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(func.count()).where(UserPhoto.user_id == current_user.id)
    )
    count = result.scalar()
    return {"count": count, "ready": count >= (MIN_PHOTOS + 1)}


@router.get("/{photo_id}")
async def serve_photo(
    photo_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Redirect to a short-lived presigned R2 URL — only for the owning user."""
    result = await db.execute(
        select(UserPhoto).where(
            UserPhoto.id == photo_id,
            UserPhoto.user_id == current_user.id,
        )
    )
    photo = result.scalar_one_or_none()
    if not photo or not photo.r2_key:
        raise HTTPException(status_code=404)

    url = r2_service.presigned_url(photo.r2_key)
    return RedirectResponse(url=url, status_code=302)
