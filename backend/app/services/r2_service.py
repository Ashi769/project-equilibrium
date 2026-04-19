import boto3
from botocore.config import Config
from app.core.config import settings


def _client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


def upload_photo(data: bytes, key: str, content_type: str) -> str:
    _client().put_object(
        Bucket=settings.r2_bucket_name,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return key


def download_photo(key: str) -> bytes:
    response = _client().get_object(Bucket=settings.r2_bucket_name, Key=key)
    return response["Body"].read()


def delete_photo(key: str) -> None:
    _client().delete_object(Bucket=settings.r2_bucket_name, Key=key)


def presigned_url(key: str, expires: int = 3600) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket_name, "Key": key},
        ExpiresIn=expires,
    )
