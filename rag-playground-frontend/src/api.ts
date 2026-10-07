import { fetchEventSource } from "@microsoft/fetch-event-source";

export type RagStage = "searching" | "retrieved" | "generating" | "done";

export type RagEvent =
  | { type: "tag"; stage: RagStage; message: string }
  | { type?: never; stage: "response" | "done" | "error"; message: string };

export class RagRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RagRequestError";
  }
}

export function parseRagEvent(data: unknown): RagEvent {
  if (typeof data !== "object" || data === null || !("stage" in data) ||
      !("message" in data) || typeof data.message !== "string") {
    throw new RagRequestError("The server sent an invalid response. Please try again.");
  }
  if ("type" in data && data.type === "tag" &&
      (data.stage === "searching" || data.stage === "retrieved" ||
       data.stage === "generating" || data.stage === "done")) {
    return { type: "tag", stage: data.stage, message: data.message };
  }
  if (!("type" in data) &&
      (data.stage === "response" || data.stage === "done" || data.stage === "error")) {
    return { stage: data.stage, message: data.message };
  }
  throw new RagRequestError("The server sent an unsupported event. Please try again.");
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof RagRequestError) return error.message;
  return "Couldn't reach the server. Check your connection and try again.";
}

export async function rag_search(
  input: string,
  onEvent: (event: string, data: RagEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) {
    throw new RagRequestError("The backend isn't configured. Set NEXT_PUBLIC_API_URL and restart the frontend.");
  }
  if (signal?.aborted) return;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let completed = false;
  let timeoutError: RagRequestError | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timeoutError = new RagRequestError("The server stopped responding. Please try again.");
      controller.abort();
    }, 60_000);
  };
  resetTimeout();
  try {
    await fetchEventSource(`${apiUrl.replace(/\/$/, "")}/rag/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ query: input }),
      signal: controller.signal,
      openWhenHidden: true,
      async onopen(response) {
        if (!response.ok) {
          const message = response.status === 429
            ? "Too many requests. Give it a moment, then try again."
            : response.status >= 500
              ? "The server couldn't complete your request. Please try again."
              : `The request was rejected (HTTP ${response.status}). Please try again.`;
          throw new RagRequestError(message);
        }
        if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
          throw new RagRequestError("The server didn't return an event stream. Check the backend URL.");
        }
        resetTimeout();
      },
      onmessage(message) {
        resetTimeout();
        if (!message.data || (message.event && message.event !== "status" && message.event !== "message")) return;
        let raw: unknown;
        try {
          raw = JSON.parse(message.data);
        } catch {
          throw new RagRequestError("The server sent unreadable data. Please try again.");
        }
        const data = parseRagEvent(raw);
        if (data.stage === "error") {
          throw new RagRequestError("The server couldn't generate an answer. Please try again.");
        }
        if (data.stage === "done") completed = true;
        onEvent(message.event || "message", data);
      },
      onclose() {
        if (!completed) {
          throw new RagRequestError("The connection ended before the answer was complete. Please try again.");
        }
      },
      onerror(error: unknown) {
        throw error;
      },
    });
    if (timeoutError) throw timeoutError;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}