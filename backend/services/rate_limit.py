"""进程内的简单限流与客户端 IP 识别（单进程部署够用；多进程/多机要换 Redis）。"""
import time

from fastapi import Request


def rate_ok(store: dict[str, list[float]], key: str, limit: int, window_sec: int) -> bool:
    """检查是否在限额内。是则记录本次并返回 True；否则返回 False。store 需为 defaultdict(list)。"""
    now = time.time()
    store[key] = [t for t in store[key] if now - t < window_sec]
    if len(store[key]) >= limit:
        return False
    store[key].append(now)
    return True


def client_ip(request: Request) -> str:
    """取真实客户端 IP。

    只信任 X-Real-IP：nginx 用 `proxy_set_header X-Real-IP $remote_addr` 覆盖它，客户端改不了。
    不能用 X-Forwarded-For 的第一段：nginx 的 $proxy_add_x_forwarded_for 会保留客户端自己填的值，
    伪造这个头就能绕过所有按 IP 的限流。后端只监听 127.0.0.1，外部请求必经 nginx。
    """
    real_ip = request.headers.get("X-Real-IP", "").strip()
    if real_ip:
        return real_ip
    return request.client.host if request.client else "unknown"
