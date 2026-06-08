"""SMTP 邮件发送服务（QQ 邮箱 SSL）。"""
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formatdate
from datetime import date

import aiosmtplib

from config import SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM_NAME, FREE_SEARCHES_QUOTA
from models import Paper

logger = logging.getLogger(__name__)


def _paper_card_html(paper: Paper, expand_abstract: bool = False) -> str:
    title_link = (
        f'<a href="{paper.url}" style="color:#1d4ed8;text-decoration:none;font-weight:600;">{paper.title}</a>'
        if paper.url else f'<strong>{paper.title}</strong>'
    )
    meta_parts = []
    if paper.authors:
        authors_str = ", ".join(paper.authors[:3]) + (" 等" if len(paper.authors) > 3 else "")
        meta_parts.append(authors_str)
    if paper.published_date:
        meta_parts.append(paper.published_date[:4])
    if paper.venue:
        meta_parts.append(paper.venue)
    meta = " · ".join(meta_parts)
    abstract_text = (paper.abstract or "").strip()
    if not expand_abstract and len(abstract_text) > 300:
        abstract_text = abstract_text[:300] + "…"
    return f"""
<div style="margin-bottom:16px;padding:16px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;">
  <div style="font-size:15px;margin-bottom:6px;">{title_link}</div>
  <div style="font-size:12px;color:#6b7280;margin-bottom:8px;">{meta}</div>
  {"" if not abstract_text else f'<div style="font-size:13px;color:#374151;line-height:1.6;">{abstract_text}</div>'}
</div>"""


def build_daily_email_html(keywords: list[str], papers: list[Paper]) -> str:
    """每日推送邮件：1～N 篇（由 daily_limit 决定），摘要展开。"""
    today = date.today().strftime("%Y年%m月%d日")
    kw_str = " · ".join(keywords)
    count = len(papers)
    single = count == 1

    if single:
        banner_text = f'您订阅的关键词 <strong>{kw_str}</strong> 今日推荐论文 1 篇'
    else:
        banner_text = f'您订阅的关键词 <strong>{kw_str}</strong> 今日推送 <strong style="font-size:16px;">{count}</strong> 篇论文'

    cards = "".join(_paper_card_html(p, expand_abstract=single) for p in papers)

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
    <div>如需停止接收，请登录 ScholarScout → 右上角头像 → 订阅管理 → 删除此订阅</div>
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


async def send_subscription_email(
    to_email: str,
    keywords: list[str],
    papers: list[Paper],
) -> bool:
    if not SMTP_USER or not SMTP_PASS:
        logger.warning("SMTP not configured, skipping email to %s", to_email)
        return False

    kw_str = " · ".join(keywords)
    title = papers[0].title[:50] if len(papers) == 1 else f"{kw_str} 等 {len(papers)} 篇"
    subject = f"ScholarScout 日报：{title}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=True)

    html_body = build_daily_email_html(keywords, papers)
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
