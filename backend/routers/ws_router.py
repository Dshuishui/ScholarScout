"""WebSocket endpoint for real-time push notifications."""
import json
import logging
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from services.ws_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter()


async def _resolve_client_key(token: Optional[str], fallback_id: str) -> str:
    """有效的登录凭证按用户分组推送；无效或已撤销（改过密码）的凭证按匿名连接处理。"""
    if token:
        try:
            from database import AsyncSessionLocal
            from dependencies import user_from_token
            async with AsyncSessionLocal() as db:
                user = await user_from_token(token, db)
            if user:
                return f"user:{user.id}"
        except Exception:
            logger.warning("WebSocket token check failed", exc_info=True)
    return f"anon:{fallback_id}"


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    cid: Optional[str] = Query(default=None),
):
    """
    Persistent WebSocket for server-to-client push notifications.

    Query params:
      cid    — ephemeral client ID; every connection starts as anonymous

    Messages from client:
      {"type": "auth", "token": "<JWT>"} — switch to per-user pushes. The token is not
        accepted in the URL: nginx and uvicorn write URLs to the access logs verbatim.
      {"type": "ping"}

    Events sent by server:
      connected          — handshake confirmation
      authenticated      — reply to auth, with the resulting client_key
      pong               — keepalive reply
      search_indexed     — vector indexing completed for a search batch
      subscription_ready — background queue population finished
    """
    anon_id = cid or str(id(websocket))
    client_key = f"anon:{anon_id}"
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
                elif msg.get("type") == "auth":
                    new_key = await _resolve_client_key(msg.get("token"), anon_id)
                    if new_key != client_key:
                        manager.move(websocket, client_key, new_key)
                        client_key = new_key
                    await websocket.send_text(json.dumps({"event": "authenticated",
                                                          "data": {"client_key": client_key}}))
            except Exception:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket, client_key)
