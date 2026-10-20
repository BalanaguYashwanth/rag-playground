import { fetchEventSource } from "@microsoft/fetch-event-source";
import { config_document_limits } from "./document_limits";

const documentLimits = config_document_limits;
export const MAX_DOCUMENT_BYTES = documentLimits.max_document_bytes;
export const MIN_CUSTOM_TEXT_LINES = documentLimits.min_custom_text_lines;
export const MAX_PDF_PAGES = documentLimits.max_pdf_pages;
export const MAX_DOCUMENT_SIZE_LABEL = `${MAX_DOCUMENT_BYTES / (1024 * 1024)} MiB`;
export type DocumentSource = "custom" | "pdf" | "template";
export type DocumentContext = { user_id: string; document_id: string; filename: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function measureText(text: string) {
  let lines = text.length ? 1 : 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\r") {
      lines += 1;
      if (text[index + 1] === "\n") index += 1;
    } else if (text[index] === "\n") lines += 1;
  }
  if (text.endsWith("\n") || text.endsWith("\r")) lines -= 1;
  return { lines, bytes: new Blob([text]).size };
}

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

export async function buildDocument(
  file: File, userId: string, source: DocumentSource, signal?: AbortSignal,
): Promise<DocumentContext> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl) throw new RagRequestError("The backend isn't configured. Set NEXT_PUBLIC_API_URL and restart the frontend.");
  if (!file.size || file.size > MAX_DOCUMENT_BYTES) throw new RagRequestError(`Choose a nonempty document no larger than ${MAX_DOCUMENT_SIZE_LABEL}.`);
  if (!(source === "pdf" ? /\.pdf$/i : /\.txt$/i).test(file.name)) throw new RagRequestError("The file type does not match the selected source.");
  if (!userId.startsWith("user_") || !uuidPattern.test(userId.slice(5))) throw new RagRequestError("Invalid user session. Please refresh the page.");
  if (source !== "pdf") {
    const bytes = await file.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new RagRequestError("Text files must use UTF-8 encoding.");
    }
    if (!text.trim() || text.includes("\x00")) throw new RagRequestError("Document must contain readable text.");
    if (source === "custom" && measureText(text).lines < MIN_CUSTOM_TEXT_LINES) {
      throw new RagRequestError(`Text must contain at least ${MIN_CUSTOM_TEXT_LINES} lines.`);
    }
  }
  const form = new FormData();
  form.append("file", file);
  form.append("user_id", userId);
  form.append("source", source);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 300_000);
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/rag/build`, {
      method: "POST", body: form, signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data && typeof data === "object" && "detail" in data && typeof data.detail === "string" ? data.detail : "Could not build this document. Please try again.";
      throw new RagRequestError(detail);
    }
    if (!data || typeof data !== "object" || !("user_id" in data) || data.user_id !== userId ||
        !("document_id" in data) || typeof data.document_id !== "string" || !uuidPattern.test(data.document_id) ||
        !("filename" in data) || typeof data.filename !== "string") {
      throw new RagRequestError("The server returned an invalid document session.");
    }
    return { user_id: userId, document_id: data.document_id, filename: data.filename };
  } catch (error) {
    if (timedOut) throw new RagRequestError("Building the document timed out. Please try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function rag_search(
  input: string,
  onEvent: (event: string, data: RagEvent) => void,
  document: DocumentContext,
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
      body: JSON.stringify({ query: input, user_id: document.user_id, document_id: document.document_id }),
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