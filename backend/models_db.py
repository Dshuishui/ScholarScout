from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, UniqueConstraint, Boolean
from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # 邮箱验证 & 免费搜索额度
    is_verified = Column(Boolean, default=False, nullable=False)
    verify_token = Column(String(64), nullable=True)
    verify_token_expires = Column(DateTime, nullable=True)
    free_searches = Column(Integer, default=0, nullable=False)


class SavedPaper(Base):
    __tablename__ = "saved_papers"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False)
    paper_id_hash = Column(String(64), nullable=False)
    paper_json = Column(Text, nullable=False)
    saved_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("user_id", "paper_id_hash"),)


class ReadingHistory(Base):
    __tablename__ = "reading_history"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False)
    paper_json = Column(Text, nullable=False)
    viewed_at = Column(DateTime, default=datetime.utcnow)


class Feedback(Base):
    __tablename__ = "feedback"
    id = Column(Integer, primary_key=True)
    content = Column(String(200), nullable=False)
    location = Column(String(100), nullable=True)
    is_author = Column(Integer, default=0)
    user_id = Column(Integer, nullable=True)
    reply_to_id = Column(Integer, nullable=True)
    recalled = Column(Integer, default=0)
    category = Column(String(20), nullable=True, default='chat')
    reactions_json = Column(Text, nullable=True, default='{}')
    created_at = Column(DateTime, default=datetime.utcnow)


class PaperChat(Base):
    __tablename__ = "paper_chats"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False)
    paper_id_hash = Column(String(64), nullable=False)
    paper_json = Column(Text, nullable=False)
    messages_json = Column(Text, nullable=False, default="[]")
    pdf_text = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    __table_args__ = (UniqueConstraint("user_id", "paper_id_hash"),)


class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    keywords_json = Column(Text, nullable=False)   # JSON 数组，如 ["LLM", "RAG"]
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_sent = Column(DateTime, nullable=True)    # 上次成功发送时间
    daily_limit = Column(Integer, default=1, nullable=False)  # 每天推送篇数（用户可配置）


class SubscriptionQueueItem(Base):
    """推送队列：每个订阅预先搜索好的论文，按 planned_date 每天发送。"""
    __tablename__ = "subscription_queue"
    id = Column(Integer, primary_key=True)
    subscription_id = Column(Integer, nullable=False, index=True)
    paper_json = Column(Text, nullable=False)
    paper_id = Column(String(128), nullable=True)   # 用于去重
    planned_date = Column(String(10), nullable=False)  # YYYY-MM-DD
    sent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SearchSession(Base):
    """搜索快照：保存用户每次搜索的关键词、结果和多论文分析。"""
    __tablename__ = "search_sessions"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, nullable=False, index=True)
    query = Column(Text, nullable=True)            # 原始用户输入
    keywords_json = Column(Text, nullable=False)   # JSON 数组
    papers_json = Column(Text, nullable=False)     # JSON 数组（AI 筛选后的论文）
    analysis_json = Column(Text, nullable=True)    # JSON 对象 {mode: content}
    created_at = Column(DateTime, default=datetime.utcnow)
