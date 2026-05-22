from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, UniqueConstraint, Boolean
from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


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
    last_sent = Column(DateTime, nullable=True)    # 上次成功发送时间，用于过滤新论文
