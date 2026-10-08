# RAG Playground Frontend

A document chat interface built with Next.js, React, and TypeScript. It uses a default soft-charcoal theme, streamed Markdown answers, and animated retrieval status tags.

## Development

Run commands from this directory:

```bash
pnpm install
pnpm dev
```

Set the backend origin in `.env.local` (or the existing `.env`):

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Restart the frontend after changing environment variables. Start the backend separately and allow the frontend origin in its CORS configuration. The frontend runs at [http://localhost:3000](http://localhost:3000).

## Structure

- `src/api.ts`: SSE connection, runtime event validation, and readable request errors.
- `src/hooks/use-chat.ts`: per-message request state, cancellation, retry, and conversation reset.
- `src/components/chat/`: composer, message, empty state, and status tags with scoped styles.
- `src/app/page.tsx`: workspace layout and scroll-aware conversation view.
- `tests/api.test.mjs`: dependency-free Node tests using the existing TypeScript compiler and real SSE parser.

## Stream Contract

The frontend first presents three mutually exclusive document sources: custom
text (at least 50 lines), a PDF, or a quick template. All document sources are
limited to 1 MiB (1,048,576 bytes). PDF contents are not read or parsed in the
browser; the original `File` is uploaded directly. Custom text is wrapped in a
UTF-8 `.txt` file. Selecting a template immediately builds it.

Frontend document limits come from the `config_document_limits` export in
`src/document_limits.ts`: `max_document_bytes`, `min_custom_text_lines`, and
`max_pdf_pages`. Edit that export and rebuild/restart the frontend to change its
limits. Frontend builds do not need the backend directory. Backend limits are
configured separately and still enforced by the API; keep the values aligned.
Labels and validation use the same frontend values; custom/template text is
checked for readable UTF-8 before upload. PDF contents are validated by the
backend before indexing.

`POST /rag/build` uses `FormData` containing `file`, `user_id`, and `source`.
The browser supplies the multipart boundary. A `user_<UUID v4>` is kept in
session storage (or memory when storage is unavailable); the backend returns
a document UUID. Only one build runs at a time, with a five-minute client timeout.
The composer appears after a successful build. The header's document button
clears the current conversation and returns to document selection.

The frontend posts `{ "query": "...", "user_id": "user_<uuid>", "document_id": "<uuid>" }` to `/rag/search` and expects `text/event-stream`. Each `status` event contains a JSON payload:

```json
{ "type": "tag", "stage": "searching", "message": "Searching documents" }
```

Status tags support `searching`, `retrieved`, `generating`, and `done`; only the latest stage is displayed. Answer chunks use `{ "stage": "response", "message": "..." }`. A non-tag `done` event supports the backend's no-data result. A `done` event must precede a normal connection close; early disconnects are treated as incomplete answers.

HTTP errors, invalid data, backend `error` events, and 60 seconds without an event produce a recoverable error without discarding partial text. Failed POST requests are not automatically retried. Retry is explicit; stopping a response is not an error.

Conversations and active document context are kept in memory only. Refreshing
returns to document selection. UUID creation requires HTTPS or localhost and a
modern browser. The UUID filters separate retrieval scopes, but are not an
authentication or authorization mechanism.

## Checks

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```
