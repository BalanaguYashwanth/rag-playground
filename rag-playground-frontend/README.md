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

The frontend posts `{ "query": "..." }` to `/rag/search` and expects `text/event-stream`. Each `status` event contains a JSON payload:

```json
{ "type": "tag", "stage": "searching", "message": "Searching documents" }
```

Status tags support `searching`, `retrieved`, `generating`, and `done`. Answer chunks use `{ "stage": "response", "message": "..." }`. A non-tag `done` event supports the backend's no-data result. A `done` event must precede a normal connection close; early disconnects are treated as incomplete answers.

HTTP errors, invalid data, backend `error` events, and 60 seconds without an event produce a recoverable error without discarding partial text. Failed POST requests are not automatically retried. Retry is explicit; stopping a response is not an error.

Conversations are kept in memory only. Refreshing clears them; starting a new conversation cancels the active request and clears the messages and draft. The workspace document label and suggested questions reflect the bundled solar-system dataset, not a live document inventory.

## Checks

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```
