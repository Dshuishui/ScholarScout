"""WebSocket connection manager — shared singleton for push notifications."""
import json
import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        # Maps client_key → set of active WebSocket connections
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, ws: WebSocket, client_key: str) -> None:
        await ws.accept()
        self._connections.setdefault(client_key, set()).add(ws)
        logger.debug("WS connected: %s (total=%d)", client_key, self.connection_count)

    def disconnect(self, ws: WebSocket, client_key: str) -> None:
        conns = self._connections.get(client_key)
        if conns:
            conns.discard(ws)
            if not conns:
                del self._connections[client_key]
        logger.debug("WS disconnected: %s (total=%d)", client_key, self.connection_count)

    async def send(self, client_key: str, event: str, data: dict) -> None:
        """Send an event to all connections belonging to one client."""
        conns = self._connections.get(client_key)
        if not conns:
            return
        msg = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        dead: set[WebSocket] = set()
        for ws in conns:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.add(ws)
        conns -= dead

    async def broadcast(self, event: str, data: dict) -> None:
        """Send an event to every connected client."""
        msg = json.dumps({"event": event, "data": data}, ensure_ascii=False)
        for client_key, conns in list(self._connections.items()):
            dead: set[WebSocket] = set()
            for ws in conns:
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.add(ws)
            conns -= dead

    @property
    def connection_count(self) -> int:
        return sum(len(c) for c in self._connections.values())


# Module-level singleton — import this everywhere
manager = ConnectionManager()
