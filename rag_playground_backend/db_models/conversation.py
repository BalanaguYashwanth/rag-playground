from sqlalchemy import Column, Integer, DateTime, func, Text, String
from sqlalchemy.dialects.postgresql import UUID
from db_handler.db import Base

class ConversationModel(Base):

    __tablename__ = "conversations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user = Column(Text, nullable=False)
    agent = Column(Text)
    reference_uuid = Column(String, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
