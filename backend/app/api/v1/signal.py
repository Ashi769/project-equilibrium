import json
import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.core.security import decode_token

router = APIRouter(tags=["signal"])
logger = logging.getLogger(__name__)

_rooms: dict[str, dict[str, WebSocket]] = {}
_room_locks: dict[str, asyncio.Lock] = {}
# _meta_lock guards only creation/deletion of entries in _room_locks.
# It is never held while doing I/O, so it is only held for microseconds.
_meta_lock = asyncio.Lock()


def _authenticate(token: str | None) -> str | None:
    if not token:
        return None
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            return None
        return payload.get("sub")
    except Exception:
        return None


async def _get_room_lock(meeting_id: str) -> asyncio.Lock:
    async with _meta_lock:
        if meeting_id not in _room_locks:
            _room_locks[meeting_id] = asyncio.Lock()
        return _room_locks[meeting_id]


@router.websocket("/api/v1/signal/{meeting_id}")
async def signaling(ws: WebSocket, meeting_id: str):
    token = ws.query_params.get("token")
    user_id = _authenticate(token)

    await ws.accept()

    if not user_id:
        await ws.close(code=4001, reason="Unauthorized")
        return

    lock = await _get_room_lock(meeting_id)

    async with lock:
        if meeting_id not in _rooms:
            _rooms[meeting_id] = {}
        room = _rooms[meeting_id]

        if len(room) >= 2 and user_id not in room:
            await ws.close(code=4002, reason="Room full")
            return

        # Close stale connection if same user reconnects
        old_ws = room.get(user_id)
        if old_ws and old_ws != ws:
            logger.info(f"closing stale connection for {user_id[:8]}")
            try:
                await old_ws.close(code=4003, reason="Replaced by new connection")
            except Exception:
                pass

        existing_peers = [uid for uid in room if uid != user_id]
        room[user_id] = ws

    logger.info(f"signal: {user_id[:8]} joined room {meeting_id[:8]}, peers={existing_peers}")

    if existing_peers:
        try:
            await ws.send_json({"type": "peer-joined", "role": "offerer"})
        except Exception as e:
            logger.error(f"signal: failed to notify newcomer: {e}")

        for pid in existing_peers:
            async with lock:
                peer_ws = _rooms.get(meeting_id, {}).get(pid)
            if peer_ws:
                try:
                    await peer_ws.send_json({"type": "peer-joined", "role": "answerer"})
                except Exception as e:
                    logger.error(f"signal: failed to notify existing peer: {e}")

    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping"})
                continue

            msg = json.loads(raw)
            msg_type = msg.get("type")

            async with lock:
                peers = {
                    uid: sock
                    for uid, sock in _rooms.get(meeting_id, {}).items()
                    if uid != user_id
                }

            for pid, peer_ws in peers.items():
                try:
                    await peer_ws.send_json({"type": msg_type, "data": msg.get("data")})
                except Exception as e:
                    logger.error(f"signal: relay {msg_type} to {pid[:8]} failed: {e}")

    except WebSocketDisconnect:
        logger.info(f"signal: {user_id[:8]} disconnected from {meeting_id[:8]}")
    except Exception as e:
        logger.error(f"signal: error in {user_id[:8]}: {e}")
    finally:
        remaining: dict[str, WebSocket] = {}
        async with lock:
            if meeting_id in _rooms:
                _rooms[meeting_id].pop(user_id, None)
                remaining = dict(_rooms[meeting_id])
                if not remaining:
                    del _rooms[meeting_id]

        # Clean up the room lock after releasing it.
        # Double-check the room is still gone — another user may have joined
        # between us releasing `lock` and acquiring `_meta_lock`.
        if not remaining:
            async with _meta_lock:
                if meeting_id not in _rooms:
                    _room_locks.pop(meeting_id, None)

        for pid, peer_ws in remaining.items():
            try:
                await peer_ws.send_json({"type": "peer-left"})
            except Exception:
                pass
