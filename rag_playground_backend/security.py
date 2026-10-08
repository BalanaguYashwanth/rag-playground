import asyncio
import os
from ipaddress import ip_network
from urllib.parse import urlsplit

from guard import SecurityConfig, SecurityMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


def positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value < 1:
        raise ValueError(f"{name} must be positive.")
    return value


def create_security_config() -> SecurityConfig:
    cloud_run = bool(os.getenv("K_SERVICE"))
    redis_url = os.getenv("REDIS_URL") or None
    origins = [origin.strip() for origin in os.getenv("CORS_ALLOW_ORIGINS", "").split(",") if origin.strip()]
    proxies = [proxy.strip() for proxy in os.getenv("TRUSTED_PROXIES", "").split(",") if proxy.strip()]
    for proxy in proxies:
        if ip_network(proxy, strict=False).prefixlen == 0:
            raise ValueError("TRUSTED_PROXIES must not trust every address.")
    if cloud_run and not origins:
        raise ValueError("Cloud Run requires CORS_ALLOW_ORIGINS with explicit HTTPS frontend origins.")
    if "*" in origins:
        raise ValueError("CORS_ALLOW_ORIGINS must list explicit frontend origins.")
    if not origins:
        origins = []
    if cloud_run and any(not origin.startswith("https://") for origin in origins):
        raise ValueError("Cloud Run frontend origins must use HTTPS.")
    return SecurityConfig(
        enable_rate_limiting=True,
        rate_limit=positive_int("GLOBAL_RATE_LIMIT", 60),
        rate_limit_window=60,
        endpoint_rate_limits={
            "/rag/build": (positive_int("BUILD_RATE_LIMIT", 5), 60),
            "/rag/search": (positive_int("SEARCH_RATE_LIMIT", 10), 60),
        },
        enable_redis=bool(redis_url),
        redis_url=redis_url,
        redis_prefix="rag_playground:security:",
        redis_fail_open=False,
        enable_ip_banning=True,
        auto_ban_threshold=10,
        auto_ban_duration=900,
        enable_penetration_detection=True,
        detection_scan_body=False,
        excluded_detection_headers={"referer", "origin"},
        detection_max_content_length=8192,
        detection_compiler_timeout=0.5,
        trusted_proxies=proxies,
        trusted_proxy_depth=positive_int("TRUSTED_PROXY_DEPTH", 1),
        trust_x_forwarded_proto=bool(proxies),
        enforce_https=cloud_run and bool(proxies),
        enable_cors=False,
        cors_allow_origins=origins,
        fail_secure=True,
        enable_agent=False,
        custom_log_file=None,
        log_format="json",
        custom_error_responses={
            429: "Too many requests. Please wait before trying again.",
            503: "Security checks are temporarily unavailable. Please try again shortly.",
        },
    )


class APISecurityMiddleware(SecurityMiddleware):
    async def _process_response(self, request, response, response_time, route_config):
        from guard.adapters import StarletteGuardRequest, StarletteGuardResponse

        processed = await self.response_factory.process_response(
            StarletteGuardRequest(request),
            StarletteGuardResponse(response),
            response_time,
            route_config,
            process_behavioral_rules=self.behavioral_processor.process_return_rules,
            process_global_behavioral_rules=self.behavioral_processor.process_global_return_rules,
        )
        response.headers.update(dict(processed.headers))
        response.status_code = processed.status_code
        return response

    async def dispatch(self, request, call_next):
        if request.method == "OPTIONS" or (request.method == "GET" and request.url.path == "/status"):
            return await call_next(request)
        referer = request.headers.get("referer")
        if referer:
            try:
                parsed = urlsplit(referer)
            except ValueError:
                return JSONResponse(status_code=400, content={"detail": "Invalid Referer header."})
            if f"{parsed.scheme}://{parsed.netloc}" in self.config.cors_allow_origins:
                inspected_scope = request.scope.copy()
                inspected_referer = parsed.path or "/"
                if parsed.query:
                    inspected_referer += "?" + parsed.query
                inspected_scope["headers"] = [
                    (name, inspected_referer.encode("latin-1")) if name.lower() == b"referer" else (name, value)
                    for name, value in request.scope["headers"]
                ]
                inspected_request = Request(inspected_scope, receive=request.receive)

                async def forward_original(inspected):
                    return await call_next(request)

                return await super().dispatch(inspected_request, forward_original)
        return await super().dispatch(request, call_next)


class ConcurrencyLimitMiddleware:
    def __init__(self, app, build_limit: int = 1, search_limit: int = 2):
        self.app = app
        self.limits = {
            "/rag/build": asyncio.Semaphore(build_limit),
            "/rag/search": asyncio.Semaphore(search_limit),
        }

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        semaphore = self.limits.get(scope["path"])
        if semaphore is None:
            return await self.app(scope, receive, send)
        if semaphore.locked():
            return await JSONResponse(
                status_code=429,
                content={"detail": "The server is busy. Please try again shortly."},
                headers={"Retry-After": "5"},
            )(scope, receive, send)
        async with semaphore:
            await self.app(scope, receive, send)