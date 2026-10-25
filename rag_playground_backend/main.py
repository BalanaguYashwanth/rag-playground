import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from guard.lifespan import guard_lifespan
from utils import BuildBodyLimit
from security import APISecurityMiddleware, ConcurrencyLimitMiddleware, create_security_config, positive_int

security_config = create_security_config()
app = FastAPI(
    lifespan=guard_lifespan,
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