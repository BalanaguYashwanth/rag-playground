# Rag playground

## Setup

From this directory, run `uv sync`, then `uv run uvicorn main:app --reload`.
Configure `.env` with `QDRANT_API_URL`, `QDRANT_API_KEY`,
`EMBEDDINGS_COLLECTION_NAME`, and `GOOGLE_API_KEY`. Collection permissions
must allow creating keyword payload indexes for `metadata.user_id` and
`metadata.document_id`. Keep embedding dimensions consistent with existing collections.

## Document Build

`POST /rag/build` accepts multipart fields:

- `file`: one UTF-8 `.txt` or text-based `.pdf`, at most 1 MiB (1,048,576 bytes).
- `user_id`: `user_<UUID v4>`.
- `source`: `custom`, `pdf`, or `template` (default: `custom`).

Custom text requires at least 100 lines. Curated template text may be shorter.
PDFs are limited to 100 pages and 1 MiB of extracted UTF-8 text; encrypted,
unreadable, and scanned/image-only PDFs are rejected. No OCR is performed.
Requests are disk-spooled with a bounded multipart overhead allowance.

A successful build returns `user_id`, a server-generated UUID v4 `document_id`,
and `filename`. Every chunk stores these IDs in its metadata; embeddings are
cached per process and indexed in batches of 32.

`POST /rag/search` requires JSON containing `query`, `user_id`, and `document_id`.
Both IDs are mandatory Qdrant filters. Existing unscoped data is not returned.
Responses use the existing SSE contract.

These IDs scope retrieval, not authentication. Before deploying with private
documents, authenticate users, derive their identity server-side, verify document
ownership, restrict CORS, add request/rate limits, and configure document retention.
Uploaded PDF parsers also need resource isolation for adversarial workloads.

## Tests

Run `uv run python -m unittest discover -s tests -v`.
Tests use fake ingestion and an in-memory Qdrant collection; no cloud calls or
model downloads are needed.
