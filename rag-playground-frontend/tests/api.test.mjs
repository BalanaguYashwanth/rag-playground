import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const filename = fileURLToPath(new URL("../src/api.ts", import.meta.url));
const source = ts.transpileModule(readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function loadApi(fetch, apiUrl = "http://localhost:8000", timeout = false) {
  const exports = {};
  const timers = new Set();
  const schedule = (callback, delay) => {
    const timer = setTimeout(callback, timeout ? 10 : delay);
    timers.add(timer);
    return timer;
  };
  const cancel = (timer) => { clearTimeout(timer); timers.delete(timer); };
  const window = { fetch, setTimeout: schedule, clearTimeout: cancel };
  const document = { removeEventListener() {}, addEventListener() {} };
  const dependencyExports = {};
  const dependencySource = readFileSync(require.resolve("@microsoft/fetch-event-source/lib/cjs/fetch.js"), "utf8");
  const dependencyRequire = createRequire(require.resolve("@microsoft/fetch-event-source/lib/cjs/fetch.js"));
  runInNewContext(dependencySource, {
    exports: dependencyExports, require: dependencyRequire, window, document, AbortController,
  });
  runInNewContext(source, {
    exports,
    require: () => dependencyExports,
    process: { env: { NEXT_PUBLIC_API_URL: apiUrl } },
    AbortController,
    setTimeout: schedule,
    clearTimeout: cancel,
  }, { filename });
  return { api: exports, dispose: () => timers.forEach(clearTimeout) };
}

function event(data) {
  return `event: status\ndata: ${JSON.stringify(data)}\n\n`;
}

function stream(body) {
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

test("validates status tags and rejects unsupported payloads", () => {
  const { api, dispose } = loadApi();
  try {
    assert.equal(api.parseRagEvent({ type: "tag", stage: "searching", message: "Searching" }).stage, "searching");
    assert.equal(api.parseRagEvent({ stage: "response", message: "Hello" }).message, "Hello");
    for (const value of [null, {}, { stage: "response", message: 42 }, { type: "tag", stage: "unknown", message: "Invalid" }]) {
      assert.throws(() => api.parseRagEvent(value), { name: "RagRequestError" });
    }
  } finally { dispose(); }
});

test("streams split SSE frames, preserves tokens, and sends the query", async () => {
  let request;
  const body = event({ type: "tag", stage: "searching", message: "Searching" }) +
    event({ stage: "response", message: "Hello " }) + event({ stage: "response", message: "world" }) +
    event({ type: "tag", stage: "done", message: "Complete" });
  const bytes = new TextEncoder().encode(body);
  const { api, dispose } = loadApi(async (url, options) => {
    request = { url, options };
    return stream(new ReadableStream({ start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
      controller.close();
    } }));
  });
  try {
    const events = [];
    await api.rag_search("question", (_name, data) => events.push(data));
    assert.equal(request.url, "http://localhost:8000/rag/search");
    assert.deepEqual(JSON.parse(request.options.body), { query: "question" });
    assert.equal(events.filter((data) => data.stage === "response").map((data) => data.message).join(""), "Hello world");
    assert.equal(events.at(-1).stage, "done");
  } finally { dispose(); }
});

test("supports the backend's no-data completion event", async () => {
  const { api, dispose } = loadApi(async () => stream(event({ stage: "done", message: "No data found" })));
  try {
    let answer;
    await api.rag_search("question", (_name, data) => { answer = data.message; });
    assert.equal(answer, "No data found");
  } finally { dispose(); }
});

for (const [name, response, expected] of [
  ["HTTP failure", () => new Response("unavailable", { status: 503 }), /server couldn't complete/],
  ["rate limit", () => new Response("limited", { status: 429 }), /Too many requests/],
  ["wrong content type", () => new Response("not an event stream"), /didn't return an event stream/],
  ["malformed JSON", () => stream("event: status\ndata: {broken}\n\n"), /unreadable data/],
  ["invalid payload", () => stream(event({ stage: "response", message: null })), /invalid response/],
  ["backend error", () => stream(event({ stage: "error", message: "private details" })), /couldn't generate/],
  ["early disconnect", () => stream(event({ stage: "response", message: "Partial" })), /before the answer was complete/],
]) {
  test(`handles ${name} without retrying the POST`, async () => {
    let requests = 0;
    const { api, dispose } = loadApi(async () => { requests += 1; return response(); });
    try {
      await assert.rejects(api.rag_search("question", () => {}), expected);
      assert.equal(requests, 1);
    } finally { dispose(); }
  });
}

test("reports missing configuration before fetching", async () => {
  const { api, dispose } = loadApi(() => assert.fail("Should not fetch"), "");
  try {
    await assert.rejects(api.rag_search("question", () => {}), /NEXT_PUBLIC_API_URL/);
  } finally { dispose(); }
});

test("user cancellation completes without an error", async () => {
  const controller = new AbortController();
  const { api, dispose } = loadApi(async () => {
    controller.abort();
    return stream("");
  });
  try {
    await api.rag_search("question", () => {}, controller.signal);
    assert.equal(controller.signal.aborted, true);
  } finally { dispose(); }
});

test("times out an unresponsive backend", async () => {
  const { api, dispose } = loadApi(() => new Promise(() => {}), "http://localhost:8000", true);
  try {
    await assert.rejects(api.rag_search("question", () => {}), /stopped responding/);
  } finally { dispose(); }
});