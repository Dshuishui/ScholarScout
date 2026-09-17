"""SMTP 邮件发送服务（QQ 邮箱 SSL）。"""
import html
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate
from datetime import date
from urllib.parse import quote

import aiosmtplib

from config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_NAME, FREE_SEARCHES_QUOTA, ADMIN_EMAIL, APP_BASE_URL
from models import Paper

logger = logging.getLogger(__name__)


def _esc(text: str | None) -> str:
    """邮件 HTML 里插入的所有用户输入和外部数据都要转义，否则可以往我们发出的邮件里塞任意链接。"""
    return html.escape(text or "", quote=True)


def _safe_href(url: str | None) -> str | None:
    """只允许 http/https 链接，防止 javascript: 之类的地址。"""
    if url and url.lower().startswith(("http://", "https://")):
        return html.escape(url, quote=True)
    return None


# 这些来源是预印本服务器或开放仓库，内容通常没有经过同行评审，推送时提示读者
_UNREVIEWED_VENUES = (
    "zenodo", "figshare", "arxiv", "biorxiv", "medrxiv", "chemrxiv", "research square",
    "ssrn", "preprints", "osf", "techrxiv", "authorea", "sciety",
)


def _is_unreviewed(paper: Paper) -> bool:
    venue = (paper.venue or "").lower()
    doi = (paper.doi or "").lower()
    return any(v in venue for v in _UNREVIEWED_VENUES) or doi.startswith(("10.48550/", "10.5281/", "10.1101/"))


def _paper_link(paper: Paper) -> str | None:
    """标题链接优先指向出版社原文（DOI），而不是 OpenAlex 这类数据库页面——读者点进去认不出来。"""
    if paper.doi:
        return _safe_href(f"https://doi.org/{paper.doi}")
    return _safe_href(paper.url)


def _button(href: str | None, text: str, primary: bool = False) -> str:
    if not href:
        return ""
    style = (
        "background:#4f46e5;color:#ffffff;border:1px solid #4f46e5;" if primary
        else "background:#ffffff;color:#4338ca;border:1px solid #c7d2fe;"
    )
    return (f'<a href="{href}" style="{style}display:inline-block;padding:7px 14px;border-radius:8px;'
            f'font-size:13px;font-weight:600;text-decoration:none;margin:6px 8px 0 0;">{_esc(text)}</a>')


def _paper_card_html(paper: Paper, expand_abstract: bool = False, search_url: str | None = None) -> str:
    """一篇论文的卡片。中文一句话总结放最前面：非英语母语的读者扫一眼就知道值不值得点开。"""
    link = _paper_link(paper)
    title_html = (
        f'<a href="{link}" style="color:#1d4ed8;text-decoration:none;font-weight:600;">{_esc(paper.title)}</a>'
        if link else f'<strong>{_esc(paper.title)}</strong>'
    )

    meta_parts = []
    if paper.authors:
        meta_parts.append(", ".join(paper.authors[:3]) + (" 等" if len(paper.authors) > 3 else ""))
    if paper.published_date:
        meta_parts.append(paper.published_date[:4])
    if paper.venue:
        meta_parts.append(paper.venue)
    if paper.citations:
        meta_parts.append(f"被引 {paper.citations} 次")
    meta = _esc(" · ".join(meta_parts))
    unreviewed_tag = (
        '<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:999px;'
        'background:#fef3c7;color:#92400e;font-size:11px;">预印本/未经同行评审</span>'
        if _is_unreviewed(paper) else ""
    )

    tldr_html = (
        f'<div style="font-size:16px;font-weight:700;color:#111827;line-height:1.5;margin-bottom:10px;">{_esc(paper.tldr)}</div>'
        if paper.tldr else ""
    )

    reason_html = ""
    if paper.relevance_reason:
        score = f"（相关度 {paper.relevance_score:.0f}/10）" if paper.relevance_score else ""
        reason_html = (
            '<div style="background:#f5f3ff;border-radius:8px;padding:9px 11px;margin:10px 0;'
            f'font-size:13px;color:#5b21b6;line-height:1.6;"><strong>为什么推荐：</strong>{_esc(paper.relevance_reason)}{_esc(score)}</div>'
        )

    abstract_text = (paper.abstract or "").strip()
    limit = 600 if expand_abstract and not paper.tldr else 220
    if len(abstract_text) > limit:
        abstract_text = abstract_text[:limit].rstrip() + "…"
    abstract_html = (
        f'<div style="font-size:12px;color:#6b7280;line-height:1.6;margin-top:8px;">英文摘要：{_esc(abstract_text)}</div>'
        if abstract_text else ""
    )

    full_text_href = _safe_href(paper.pdf_url) or link
    buttons = _button(full_text_href, "阅读全文", primary=True) + _button(search_url, "在 ScholarScout 搜更多相关论文")

    return f"""
<div style="margin-bottom:16px;padding:18px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;">
  {tldr_html}
  <div style="font-size:14px;line-height:1.5;margin-bottom:4px;">{title_html}</div>
  <div style="font-size:12px;color:#6b7280;line-height:1.6;">{meta}{unreviewed_tag}</div>
  {reason_html}
  {abstract_html}
  <div style="margin-top:6px;">{buttons}</div>
</div>"""


def build_daily_email_html(keywords: list[str], papers: list[Paper], unsubscribe_url: str | None = None) -> str:
    """每日推送邮件：1～N 篇（由 daily_limit 决定），摘要展开。"""
    today = date.today().strftime("%Y年%m月%d日")
    kw_str = _esc(" · ".join(keywords))
    count = len(papers)
    single = count == 1

    if single:
        banner_text = f'您订阅的关键词 <strong>{kw_str}</strong> 今日推荐论文 1 篇'
    else:
        banner_text = f'您订阅的关键词 <strong>{kw_str}</strong> 今日推送 <strong style="font-size:16px;">{count}</strong> 篇论文'

    # 回到网站继续搜：预填订阅关键词（网站读取 ?q= 放进搜索框，不会自动消耗免费次数）
    search_url = _safe_href(f"{APP_BASE_URL}/?q={quote(' '.join(keywords))}&from=email")
    cards = "".join(_paper_card_html(p, expand_abstract=single, search_url=search_url) for p in papers)

    if unsubscribe_url:
        unsubscribe_line = (
            f'不想再收到此订阅？<a href="{unsubscribe_url}" style="color:#6b7280;text-decoration:underline;">一键退订</a>'
            '（无需登录）'
        )
    else:
        unsubscribe_line = "如需停止接收，请登录 ScholarScout → 右上角头像 → 订阅管理"

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;background:#f9fafb;">
<div style="background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:20px;font-weight:700;color:#4f46e5;margin-bottom:2px;">ScholarScout</div>
    <div style="color:#6b7280;font-size:13px;">每日论文推送 · {today}</div>
  </div>

  <!-- Summary banner -->
  <div style="background:#eef2ff;border-radius:10px;padding:14px 16px;margin-bottom:24px;">
    <div style="font-size:14px;color:#3730a3;">{banner_text}</div>
  </div>

  <!-- Paper cards -->
  {cards}

  <!-- Footer -->
  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;line-height:1.8;">
    <div>下次推送：明天早 8 点（北京时间 08:00）· 由 ScholarScout 自动发送，请勿直接回复</div>
    <div>想调整每天推送几篇或修改关键词：登录 <a href="{_esc(APP_BASE_URL)}" style="color:#6b7280;text-decoration:underline;">ScholarScout</a> → 右上角头像 → 订阅管理</div>
    <div>{unsubscribe_line}</div>
  </div>
</div>
</body>
</html>"""


def build_email_html(keywords: list[str], papers: list[Paper]) -> str:
    """兼容旧接口，内部调用日报模板。"""
    return build_daily_email_html(keywords, papers)


async def send_verification_email(to_email: str, verify_url: str) -> bool:
    """发送邮箱验证邮件，包含验证链接和免费额度说明。"""
    if not SMTP_USER or not SMTP_PASS:
        logger.warning("SMTP not configured, skipping verification email to %s", to_email)
        return False

    html_body = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;background:#f9fafb;">
<div style="background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

  <div style="margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:20px;font-weight:700;color:#4f46e5;">ScholarScout</div>
    <div style="color:#6b7280;font-size:13px;">AI 学术论文搜索</div>
  </div>

  <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:8px;">验证您的邮箱</div>
  <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:20px;">
    感谢注册 ScholarScout！点击下方按钮完成验证，验证成功后将获得
    <strong style="color:#4f46e5;">{FREE_SEARCHES_QUOTA} 次免费搜索</strong>，
    无需配置自己的 API Key 即可立即体验。
  </p>

  <div style="text-align:center;margin-bottom:24px;">
    <a href="{verify_url}"
       style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;
              padding:12px 32px;border-radius:10px;text-decoration:none;">
      验证邮箱并开始使用
    </a>
  </div>

  <div style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
    <p style="font-size:12px;color:#6b7280;margin:0;">
      链接有效期 <strong>24 小时</strong>。如果按钮无法点击，请复制以下链接到浏览器：<br>
      <span style="color:#4f46e5;word-break:break-all;">{verify_url}</span>
    </p>
  </div>

  <div style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    如果您没有注册 ScholarScout，请忽略此邮件。
  </div>
</div>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "验证您的 ScholarScout 邮箱"
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            use_tls=True,
            username=SMTP_USER,
            password=SMTP_PASS,
        )
        logger.info("Verification email sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send verification email to %s: %s", to_email, e)
        return False


async def send_reset_password_email(to_email: str, reset_url: str) -> bool:
    """发送密码重置邮件。"""
    if not SMTP_USER or not SMTP_PASS:
        logger.warning("SMTP not configured, skipping reset email to %s", to_email)
        return False

    html_body = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;background:#f9fafb;">
<div style="background:#fff;border-radius:16px;padding:28px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

  <div style="margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:20px;font-weight:700;color:#4f46e5;">ScholarScout</div>
    <div style="color:#6b7280;font-size:13px;">AI 学术论文搜索</div>
  </div>

  <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:8px;">重置您的密码</div>
  <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:20px;">
    我们收到了您的密码重置请求。点击下方按钮设置新密码，链接
    <strong>1 小时</strong>内有效。
  </p>

  <div style="text-align:center;margin-bottom:24px;">
    <a href="{reset_url}"
       style="display:inline-block;background:#4f46e5;color:#fff;font-size:14px;font-weight:600;
              padding:12px 32px;border-radius:10px;text-decoration:none;">
      重置密码
    </a>
  </div>

  <div style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
    <p style="font-size:12px;color:#6b7280;margin:0;">
      如果按钮无法点击，请复制以下链接到浏览器：<br>
      <span style="color:#4f46e5;word-break:break-all;">{reset_url}</span>
    </p>
  </div>

  <div style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    如果您没有申请重置密码，请忽略此邮件，您的账号不会受到影响。
  </div>
</div>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "重置您的 ScholarScout 密码"
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            use_tls=True,
            username=SMTP_USER,
            password=SMTP_PASS,
        )
        logger.info("Reset password email sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send reset email to %s: %s", to_email, e)
        return False


async def send_feedback_notification(content: str, location: str | None, category: str) -> bool:
    """有新用户留言时通知作者。"""
    if not SMTP_USER or not SMTP_PASS:
        return False

    category_label = {"suggest": "建议", "bug": "Bug 反馈", "chat": "聊天"}.get(category, category)
    location_str = f" · {location}" if location else ""
    subject = f"[ScholarScout] 新留言：{content[:30]}{'…' if len(content) > 30 else ''}"

    html_body = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
<div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
  <div style="font-size:18px;font-weight:700;color:#4f46e5;margin-bottom:16px;">ScholarScout 新留言</div>
  <div style="background:#f9fafb;border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:15px;line-height:1.7;color:#111827;">
    {_esc(content)}
  </div>
  <div style="font-size:12px;color:#9ca3af;">
    类型：{_esc(category_label)}{_esc(location_str)}
  </div>
</div>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = ADMIN_EMAIL
    msg["Date"] = formatdate(localtime=True)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            use_tls=True,
            username=SMTP_USER,
            password=SMTP_PASS,
        )
        logger.info("Feedback notification sent for: %s", content[:40])
        return True
    except Exception as e:
        logger.error("Failed to send feedback notification: %s", e)
        return False


async def send_reply_notification(to_email: str, original_content: str, reply_content: str) -> bool:
    """有人回复用户留言时通知该用户。"""
    if not SMTP_USER or not SMTP_PASS:
        return False

    subject = f"[ScholarScout] 您的留言有新回复"
    preview = original_content[:60] + ("…" if len(original_content) > 60 else "")

    html_body = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827;">
<div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e5e7eb;">
  <div style="font-size:18px;font-weight:700;color:#4f46e5;margin-bottom:16px;">ScholarScout 留言板</div>
  <div style="font-size:14px;color:#6b7280;margin-bottom:8px;">您的留言收到了新回复：</div>
  <div style="background:#f3f4f6;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#6b7280;border-left:3px solid #d1d5db;">
    {_esc(preview)}
  </div>
  <div style="background:#eef2ff;border-radius:8px;padding:14px 16px;font-size:15px;line-height:1.7;color:#111827;">
    {_esc(reply_content)}
  </div>
  <div style="margin-top:20px;">
    <a href="http://118.25.192.117" style="display:inline-block;background:#4f46e5;color:#fff;font-size:13px;font-weight:600;padding:9px 20px;border-radius:8px;text-decoration:none;">
      前往留言板查看
    </a>
  </div>
</div>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            use_tls=True,
            username=SMTP_USER,
            password=SMTP_PASS,
        )
        logger.info("Reply notification sent to %s", to_email)
        return True
    except Exception as e:
        logger.error("Failed to send reply notification to %s: %s", to_email, e)
        return False


async def send_subscription_email(
    to_email: str,
    keywords: list[str],
    papers: list[Paper],
    unsubscribe_url: str | None = None,
) -> bool:
    if not SMTP_USER or not SMTP_PASS:
        logger.warning("SMTP not configured, skipping email to %s", to_email)
        return False

    kw_str = " · ".join(keywords)
    if len(papers) == 1:
        title = (papers[0].tldr or papers[0].title)[:50]
    else:
        title = f"{kw_str} 等 {len(papers)} 篇新论文"
    subject = f"ScholarScout 日报：{title}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)
    if unsubscribe_url:
        # 邮件客户端据此显示"退订"按钮（RFC 2369 / RFC 8058），用户就不必拉黑发件人
        msg["List-Unsubscribe"] = f"<{unsubscribe_url}>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    html_body = build_daily_email_html(keywords, papers, unsubscribe_url)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            use_tls=True,
            username=SMTP_USER,
            password=SMTP_PASS,
        )
        logger.info("Email sent to %s for keywords: %s", to_email, kw_str)
        return True
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        return False


async def send_admin_alert(message: str) -> bool:
    """给站长发运维告警（数据源失效、订阅停推等）。"""
    if not SMTP_USER or not SMTP_PASS:
        logger.warning("SMTP not configured, skipping admin alert: %s", message)
        return False
    html_body = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827;">
<div style="border:1px solid #fecaca;background:#fef2f2;border-radius:12px;padding:20px;">
  <div style="font-size:16px;font-weight:700;color:#b91c1c;margin-bottom:10px;">ScholarScout 运维告警</div>
  <div style="font-size:14px;line-height:1.7;">{_esc(message)}</div>
  <div style="font-size:12px;color:#6b7280;margin-top:14px;">
    同一问题每天最多提醒一次。查看各数据源状态：{_esc(APP_BASE_URL)}/api/health
  </div>
</div></body></html>"""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"[ScholarScout 告警] {message[:40]}"
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = ADMIN_EMAIL
    msg["Date"] = formatdate(localtime=True)
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    try:
        await aiosmtplib.send(msg, hostname=SMTP_HOST, port=SMTP_PORT, use_tls=True,
                              username=SMTP_USER, password=SMTP_PASS)
        logger.info("Admin alert sent: %s", message)
        return True
    except Exception as e:
        logger.error("Failed to send admin alert: %s", e)
        return False
