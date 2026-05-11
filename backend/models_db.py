from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, UniqueConstraint
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
