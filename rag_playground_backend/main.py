import os
from fastapi import FastAPI
from routes.rag import rag_router
from db_handler.db import Base
from db_models.conversation import ConversationModel
from contextlib import asynccontextmanager
from db_handler.db import engine
from fastapi.middleware.cors import CORSMiddleware
from guard.lifespan import make_lifespan
from utils import BuildBodyLimit
from security import APISecurityMiddleware, ConcurrencyLimitMiddleware, create_security_config, positive_int

security_config = create_security_config()

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        yield
    finally:
        await engine.dispose()


app = FastAPI(
    lifespan=make_lifespan(lifespan),
    docs_url=None if os.getenv("K_SERVICE") else "/docs",
    redoc_url=None if os.getenv("K_SERVICE") else "/redoc",
    openapi_url=None if os.getenv("K_SERVICE") else "/openapi.json",
)
app.add_middleware(BuildBodyLimit)
app.add_middleware(
    ConcurrencyLimitMiddleware,
    build_limit=positive_int("MAX_CONCURRENT_BUILDS", 1),
    search_limit=positive_int("MAX_CONCURRENT_SEARCHES", 2),
)
app.add_middleware(APISecurityMiddleware, config=security_config)
app.add_middleware(
    CORSMiddleware,
    allow_origins=security_config.cors_allow_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Accept", "Authorization"],
    expose_headers=["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
)



@app.get('/status')
def status():
    return {'status': 200}

app.include_router(rag_router)