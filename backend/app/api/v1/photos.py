import io
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import RedirectResponse
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.photo import UserPhoto, PhotoStatus
from app.models.psychometric import PsychometricProfile
from app.services import r2_service

MAX_DIMENSION = 1200  # longest edge in pixels
JPEG_QUALITY = 82


def _compress(data: bytes, content_type: str) -> tuple[bytes, str]:
    """Resize to MAX_DIMENSION on longest edge and re-encode as JPEG."""
    img = Image.open(io.BytesIO(data))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    if max(w, h) > MAX_DIMENSION:
        scale = MAX_DIMENSION / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue(), "image/jpeg"


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
        select(UserPhoto)
        .where(UserPhoto.user_id == current_user.id, UserPhoto.status == PhotoStatus.active)
        .order_by(UserPhoto.uploaded_at)
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
            raise HTTPException(
                status_code=422, detail=f"Unsupported file type: {upload.content_type}"
            )
        data = await upload.read()
        if len(data) > MAX_SIZE_MB * 1024 * 1024:
            raise HTTPException(
                status_code=422, detail=f"File too large (max {MAX_SIZE_MB}MB)"
            )
        data, content_type = _compress(data, upload.content_type)
        filename = f"{'selfie' if is_selfie else uuid.uuid4()}.jpg"
        key = f"users/{current_user.id}/{filename}"
        r2_service.upload_photo(data, key, content_type)
        return filename, key, is_selfie

    uploaded: list[tuple[str, str, bool]] = []
    for photo in photos:
        uploaded.append(await _upload(photo, is_selfie=False))
    uploaded.append(await _upload(selfie, is_selfie=True))

    # Retire old photos: remove from R2 (storage cost) but keep DB rows for audit
    old_result = await db.execute(
        select(UserPhoto).where(
            UserPhoto.user_id == current_user.id, UserPhoto.status == PhotoStatus.active
        )
    )
    now = datetime.now(timezone.utc)
    for old in old_result.scalars().all():
        if old.r2_key:
            r2_service.delete_photo(old.r2_key)
        old.status = PhotoStatus.deleted
        old.deleted_at = now

    for filename, key, is_selfie in uploaded:
        db.add(
            UserPhoto(
                user_id=current_user.id,
                filename=filename,
                r2_key=key,
                is_selfie=is_selfie,
            )
        )

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
        select(func.count()).where(
            UserPhoto.user_id == current_user.id,
            UserPhoto.status == PhotoStatus.active,
            UserPhoto.r2_key != "",
        )
    )
    count = result.scalar()
    return {"count": count, "ready": count >= (MIN_PHOTOS + 1)}


@router.delete("/{photo_id}", status_code=204)
async def delete_photo(
    photo_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserPhoto).where(
            UserPhoto.id == photo_id,
            UserPhoto.user_id == current_user.id,
            UserPhoto.status == PhotoStatus.active,
        )
    )
    photo = result.scalar_one_or_none()
    if not photo:
        raise HTTPException(status_code=404)
    if photo.r2_key:
        r2_service.delete_photo(photo.r2_key)
    photo.status = PhotoStatus.deleted
    photo.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/add")
async def add_photos(
    photos: list[UploadFile] = File(default=[]),
    selfie: UploadFile = File(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add gallery photos and/or replace selfie without touching existing photos."""
    existing = await db.execute(
        select(UserPhoto).where(
            UserPhoto.user_id == current_user.id,
            UserPhoto.is_selfie == False,
            UserPhoto.status == PhotoStatus.active,
        )
    )
    existing_count = len(existing.scalars().all())
    if photos and existing_count + len(photos) > MAX_PHOTOS:
        raise HTTPException(
            status_code=422,
            detail=f"Would exceed {MAX_PHOTOS} gallery photos (have {existing_count})",
        )

    async def _upload(upload: UploadFile, is_selfie: bool) -> tuple[str, str, bool]:
        if upload.content_type not in ALLOWED_TYPES:
            raise HTTPException(
                status_code=422, detail=f"Unsupported file type: {upload.content_type}"
            )
        data = await upload.read()
        if len(data) > MAX_SIZE_MB * 1024 * 1024:
            raise HTTPException(
                status_code=422, detail=f"File too large (max {MAX_SIZE_MB}MB)"
            )
        data, content_type = _compress(data, upload.content_type)
        filename = f"{'selfie' if is_selfie else uuid.uuid4()}.jpg"
        key = f"users/{current_user.id}/{filename}"
        r2_service.upload_photo(data, key, content_type)
        return filename, key, is_selfie

    if selfie:
        # Replace existing selfie: remove from R2 but keep DB row
        old_selfie = await db.execute(
            select(UserPhoto).where(
                UserPhoto.user_id == current_user.id,
                UserPhoto.is_selfie == True,
                UserPhoto.status == PhotoStatus.active,
            )
        )
        now = datetime.now(timezone.utc)
        for old in old_selfie.scalars().all():
            if old.r2_key:
                r2_service.delete_photo(old.r2_key)
            old.status = PhotoStatus.deleted
            old.deleted_at = now
        filename, key, _ = await _upload(selfie, is_selfie=True)
        db.add(
            UserPhoto(
                user_id=current_user.id, filename=filename, r2_key=key, is_selfie=True
            )
        )

    for photo in photos:
        filename, key, _ = await _upload(photo, is_selfie=False)
        db.add(
            UserPhoto(
                user_id=current_user.id, filename=filename, r2_key=key, is_selfie=False
            )
        )

    await db.commit()

    from app.workers.tasks import score_user_photos

    score_user_photos.delay(current_user.id)

    return {"added": len(photos) + (1 if selfie else 0), "status": "scoring"}


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
            UserPhoto.status == PhotoStatus.active,
        )
    )
    photo = result.scalar_one_or_none()
    if not photo or not photo.r2_key:
        raise HTTPException(status_code=404)

    url = r2_service.presigned_url(photo.r2_key)
    return RedirectResponse(url=url, status_code=302)


@router.get("/user/{user_id}/selfie")
async def get_user_selfie(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a user's selfie for display to matches. No auth required."""
    result = await db.execute(
        select(UserPhoto).where(
            UserPhoto.user_id == user_id,
            UserPhoto.is_selfie == True,
            UserPhoto.status == PhotoStatus.active,
        )
    )
    photo = result.scalar_one_or_none()
    if not photo or not photo.r2_key:
        return {"has_photo": False}

    return {
        "has_photo": True,
        "url": r2_service.presigned_url(photo.r2_key),
    }


@router.get("/user/{user_id}/carousel")
async def get_user_carousel(
    user_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get user's photos for carousel: first gallery photo, then selfie. No auth."""
    result = await db.execute(
        select(UserPhoto)
        .where(UserPhoto.user_id == user_id, UserPhoto.status == PhotoStatus.active)
        .order_by(UserPhoto.is_selfie == False, UserPhoto.uploaded_at)
        .limit(2)
    )
    photos = result.scalars().all()
    return [
        {"url": r2_service.presigned_url(p.r2_key), "is_selfie": p.is_selfie}
        for p in photos
        if p.r2_key
    ]
