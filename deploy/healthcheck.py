#!/usr/bin/env python3
"""服务器自检：网站或后端不可用时给站长发邮件。

由 cron 每 5 分钟执行一次。只用标准库，不依赖项目的虚拟环境——后端挂了它也要能跑。

判断规则：
- 连续 FAIL_THRESHOLD 次检查失败才发信（避免重启、瞬时抖动误报）；
- 处于故障中时每 ALERT_INTERVAL_SEC 最多提醒一次；
- 恢复后发一封"已恢复"。

用法：python3 deploy/healthcheck.py
"""
import json
import os
import smtplib
import ssl
import time
import urllib.error
import urllib.request
from email.mime.text import MIMEText
from email.utils import formatdate
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STATE_FILE = Path(os.environ.get("HEALTHCHECK_STATE", REPO / "backend" / ".healthcheck_state.json"))
CHECKS = [
    ("网站首页", "http://127.0.0.1/", None),
    ("后端接口", "http://127.0.0.1/api/health", '"status":"ok"'),
]
TIMEOUT = 15
FAIL_THRESHOLD = 2
ALERT_INTERVAL_SEC = 3600


def load_env() -> dict:
    env = {}
    env_file = REPO / "backend" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def check() -> list[str]:
    failures = []
    for name, url, expect in CHECKS:
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
                body = r.read(4096).decode("utf-8", "ignore")
                if r.status != 200:
                    failures.append(f"{name} 返回 HTTP {r.status}")
                elif expect and expect not in body:
                    failures.append(f"{name} 响应异常：{body[:120]}")
        except (urllib.error.URLError, OSError, ValueError) as e:
            failures.append(f"{name} 无法访问：{e}")
    return failures


def send_mail(env: dict, subject: str, body: str) -> bool:
    user, password = env.get("SMTP_USER"), env.get("SMTP_PASS")
    to = env.get("ADMIN_EMAIL")
    if not (user and password and to):
        print("SMTP 未配置，跳过邮件")
        return False
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = f"ScholarScout <{user}>"
    msg["To"] = to
    msg["Date"] = formatdate(localtime=True)
    try:
        with smtplib.SMTP_SSL(env.get("SMTP_HOST", "smtp.qq.com"), int(env.get("SMTP_PORT", 465)),
                              context=ssl.create_default_context(), timeout=30) as smtp:
            smtp.login(user, password)
            smtp.send_message(msg)
        return True
    except Exception as e:
        print("发信失败:", e)
        return False


def main() -> None:
    state = {}
    if STATE_FILE.exists():
        try:
            state = json.loads(STATE_FILE.read_text())
        except ValueError:
            pass
    now = time.time()
    failures = check()

    if failures:
        state["fails"] = state.get("fails", 0) + 1
        if state["fails"] >= FAIL_THRESHOLD and now - state.get("alerted_at", 0) > ALERT_INTERVAL_SEC:
            body = ("ScholarScout 自检失败：\n\n- " + "\n- ".join(failures) +
                    f"\n\n连续失败 {state['fails']} 次（每 5 分钟检查一次）。\n"
                    "排查：sudo systemctl status scholarscout-backend / sudo journalctl -u scholarscout-backend -n 50")
            if send_mail(load_env(), "[ScholarScout 告警] 网站无法访问", body):
                state["alerted_at"] = now
                state["down"] = True
    else:
        if state.get("down"):
            send_mail(load_env(), "[ScholarScout] 网站已恢复",
                      "ScholarScout 自检恢复正常，网站和后端接口都能访问了。")
        state = {"fails": 0}

    STATE_FILE.write_text(json.dumps(state))
    print("OK" if not failures else "FAIL: " + "; ".join(failures))


if __name__ == "__main__":
    main()
