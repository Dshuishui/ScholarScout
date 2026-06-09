"""WebSocket endpoint for real-time push notifications."""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from services.ws_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter()


def _resolve_client_key(token: Optional[str], fallback_id: str) -> str:
    if token:
        try:
            from services.auth_service import decode_token
            user_id = decode_token(token)
            return f"user:{user_id}"
        except Exception:
            pass
    return f"anon:{fallback_id}"


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None),
    cid: Optional[str] = Query(default=None),
):
    """
    Persistent WebSocket for server-to-client push notifications.

    Query params:
      token  — JWT bearer token for authenticated users
      cid    — ephemeral client ID for anonymous users

    Events sent by server:
      connected          — handshake confirmation
      pong               — keepalive reply
      search_indexed     — vector indexing completed for a search batch
      subscription_ready — background queue population finished
    """
    client_key = _resolve_client_key(token, cid or str(id(websocket)))
    await manager.connect(websocket, client_key)

    await websocket.send_text(json.dumps({
        "event": "connected",
        "data": {
            "client_key": client_key,
            "connections": manager.connection_count,
        },
    }))

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"event": "pong", "data": {}}))
            except Exception:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket, client_key)
