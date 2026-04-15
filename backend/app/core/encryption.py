import json
from cryptography.fernet import Fernet
from app.core.config import settings


def _fernet() -> Fernet:
    return Fernet(settings.transcript_encryption_key.encode())


def encrypt_json(data: dict) -> bytes:
    return _fernet().encrypt(json.dumps(data).encode())


def decrypt_json(ciphertext: bytes) -> dict:
    return json.loads(_fernet().decrypt(ciphertext).decode())
