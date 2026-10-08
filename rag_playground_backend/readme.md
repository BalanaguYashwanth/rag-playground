# Rag playground

## Setup

From this directory, run `uv sync`, then `uv run uvicorn main:app --reload --no-proxy-headers`.
Configure `.env` with `QDRANT_API_URL`, `QDRANT_API_KEY`,
`EMBEDDINGS_COLLECTION_NAME`, and `GOOGLE_API_KEY`. Collection permissions
must allow creating keyword payload indexes for `metadata.user_id` and
`metadata.document_id`. Keep embedding dimensions consistent with existing collections.

## Docker

Build from this backend directory, then supply `.env` at runtime:

```bash
docker build -t rag-playground-backend .
docker run --rm --name rag-playground-backend \
	--env-file .env \
	-p 8000:8000 \
	rag-playground-backend
```

Docker's `--env-file` expects unquoted `KEY=value` entries. For an existing
python-dotenv file containing quotes or interpolation, mount it read-only instead
of using `--env-file`; the application's `load_dotenv()` will parse it:

```bash
docker run --rm --name rag-playground-backend \
	--mount "type=bind,source=$(pwd)/.env,target=/code/.env,readonly" \
	-p 8000:8000 \
	rag-playground-backend
```

The mounted file must be readable by the container's non-root user (UID 10001).
Do not copy secrets into the image or commit them. `.dockerignore` excludes
environment files, local virtual environments, and caches.

The image uses Python 3.13, frozen `uv.lock` dependencies, and Linux CPU-only
PyTorch wheels. The build needs network access to download
`sentence-transformers/all-mpnet-base-v2` (768 dimensions) into `/opt/huggingface`.
At runtime `HF_HUB_OFFLINE=1` reuses that cache without contacting Hugging Face;
Qdrant and the LLM provider still require network access. Do not mount an empty
bind directory over `/opt/huggingface`, as it hides the bundled model.

The API listens on port 8000 with one worker to avoid duplicate model memory.
It runs as a non-root user and has a `/status` health check. Allow several GiB
of memory for embeddings and indexing. GPU deployment needs a different image
and PyTorch source; this image is intended for CPU inference.

## Security And Cloud Run

FastAPI Guard provides per-client-IP limits: 60 requests/minute globally,
5 builds/minute, and 10 searches/minute. Configure these with `GLOBAL_RATE_LIMIT`,
`BUILD_RATE_LIMIT`, and `SEARCH_RATE_LIMIT`. Browser-generated user UUIDs are
not used for rate-limit identity because clients can replace them.

Concurrency is capped per instance at one build and two chat streams, including
the full lifetime of a streamed response. `MAX_CONCURRENT_BUILDS` and
`MAX_CONCURRENT_SEARCHES` override these caps. Excess work returns 429 with
`Retry-After: 5`, rather than building an unbounded queue. Search JSON bodies are
limited to 128 KiB; multipart uploads retain the 1 MiB document limit plus a
64 KiB multipart allowance. Request bodies must arrive within 15 seconds.

Guard scans request paths, query strings, and headers. Uploaded document content
is intentionally not signature-scanned: legitimate documents can contain code
or attack examples. Localhost referrers from configured frontend origins are
normalized to their path for scanning only; endpoints retain the original
headers. Unknown referrers remain scanned. Suspicious requests can trigger a
15-minute IP ban after 10 detections. Do not exempt localhost IPs globally.

Local development defaults to in-memory counters; configure frontend origins
explicitly. In Cloud Run (`K_SERVICE` set), only `CORS_ALLOW_ORIGINS` is required:
comma-separated exact HTTPS frontend origins, no wildcard.

- `REDIS_URL`: optional shared Redis/Memorystore reachable through the configured
	VPC. Leave unset or empty to use in-memory counters and bans per instance.
- `TRUSTED_PROXIES`: optional verified immediate proxy IPs/CIDRs, never
	`0.0.0.0/0` or `::/0`. Leave unset or empty until these are verified.
- `TRUSTED_PROXY_DEPTH`: the verified forwarding-chain depth (default: 1), used
	when trusted proxies are configured.

Temporary Cloud Run configuration without Redis or trusted proxies:

```dotenv
CORS_ALLOW_ORIGINS=https://rag.playground.reezoai.com
REDIS_URL=
TRUSTED_PROXIES=
```

Without Redis, limits are not shared across instances and reset on restart or
scale-to-zero. Without trusted proxies, forwarded client-IP and protocol headers
are ignored; limits and bans use the socket peer, which may group multiple users
behind the same proxy. This temporary mode is not reliable per-user abuse
protection. Keep instance limits and provider spending quotas conservative.

Verify the actual Cloud Run/load-balancer peer and forwarding chain before
setting proxy trust. Do not copy Compute Engine firewall ranges blindly.
Uvicorn uses `--no-proxy-headers` so Guard alone resolves client identity.
Configure HTTPS enforcement at the Google edge; Guard verifies the forwarded
scheme and enforces HTTPS in the application only when trusted proxies are
configured. With no trusted proxies, edge HTTPS enforcement is required because
Cloud Run forwards requests to the container over HTTP. If `REDIS_URL` is
configured but Redis is unavailable, security checks still fail closed rather
than falling back to memory. Use shared Redis and verified proxy trust for
distributed, accurate per-client protection in production.
Secrets should come from Secret Manager, not image layers or source control.

`GET /status` and CORS preflight are exempt from Guard to keep probes healthy.
Public Swagger/OpenAPI routes are disabled in Cloud Run. Container port remains
8000: deploy with `--port=8000`. Use a small Cloud Run concurrency/max-instance
setting consistent with the application caps, and set provider quotas and budget
alerts; these limits are not a global spending cap.

For internet bot/DDoS protection, place Cloud Run behind an external Application
Load Balancer with Cloud Armor rate-based rules and tuned WAF rules. Set ingress
to `internal-and-cloud-load-balancing` so direct `run.app` traffic cannot bypass
Cloud Armor. Recreate `X-Forwarded-For` at the load balancer from verified client
and load-balancer addresses instead of retaining client-supplied prefixes. Add
reCAPTCHA/verified authentication when stronger bot controls are needed.
Cloud Armor, Redis infrastructure, and ingress settings must be configured in
GCP separately; adding middleware does not provision them or stop every attack.

Sources: [FastAPI Guard configuration](https://rennf93.github.io/fastapi-guard/latest/tutorial/configuration/security-config/),
[proxy security](https://rennf93.github.io/fastapi-guard/latest/tutorial/security/proxy-security/),
[Redis integration](https://rennf93.github.io/fastapi-guard/latest/tutorial/redis-integration/caching/),
and [Cloud Run with Cloud Armor](https://docs.cloud.google.com/run/docs/securing/cloud-armor).

## Document Build

`POST /rag/build` accepts multipart fields:

- `file`: one UTF-8 `.txt` or text-based `.pdf`, at most 1 MiB (1,048,576 bytes).
- `user_id`: `user_<UUID v4>`.
- `source`: `custom`, `pdf`, or `template` (default: `custom`).

Custom text requires at least 50 lines. Curated template text may be shorter.
PDFs are limited to 100 pages and 1 MiB of extracted UTF-8 text; encrypted,
unreadable, and scanned/image-only PDFs are rejected. No OCR is performed.
Requests are disk-spooled with a bounded multipart overhead allowance.

Edit `document_limits.json` to change `max_document_bytes`,
`min_custom_text_lines`, or `max_pdf_pages`. This is the single shared config:
the backend reads it at startup and the frontend imports it at build time.
Restart the backend and rebuild/restart the frontend after changing it.
Size limits apply to custom text, templates, PDFs, and extracted PDF text.
The build API validates size, source/file extension, UTF-8/readable text,
custom line count, and PDF constraints before calling the indexer.

A successful build returns `user_id`, a server-generated UUID v4 `document_id`,
and `filename`. Every chunk stores these IDs in its metadata; embeddings are
cached per process and indexed in batches of 32.

`POST /rag/search` requires JSON containing `query`, `user_id`, and `document_id`.
Both IDs are mandatory Qdrant filters. Existing unscoped data is not returned.
Responses use the existing SSE contract.

These IDs scope retrieval, not authentication. Before deploying with private
documents, authenticate users, derive their identity server-side, verify document
ownership, and configure document retention.
Uploaded PDF parsers also need resource isolation for adversarial workloads.

## Tests

Run `uv run python -m unittest discover -s tests -v`.
Tests use fake ingestion and an in-memory Qdrant collection; no cloud calls or
model downloads are needed.
