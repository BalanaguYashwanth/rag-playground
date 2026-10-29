from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
from config import DATABASE_URL

if not DATABASE_URL:
    raise ValueError("Database URL must be provided in the env")
engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True, pool_recycle=3600)
Base = declarative_base()
AsyncSessionLocal = async_sessionmaker(engine)