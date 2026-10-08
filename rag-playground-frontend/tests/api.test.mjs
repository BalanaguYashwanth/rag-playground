import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const documentLimits = {};
const documentLimitsSource = ts.transpileModule(readFileSync(new URL("../src/document_limits.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
runInNewContext(documentLimitsSource, { exports: documentLimits });
const documentContext = { user_id: "user_550e8400-e29b-41d4-a716-446655440000", document_id: "550e8400-e29b-41d4-a716-446655440001", filename: "notes.txt" };
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
    require: (name) => name === "./document_limits" ? documentLimits : dependencyExports,
    process: { env: { NEXT_PUBLIC_API_URL: apiUrl } },
    AbortController,
    fetch,
    Blob,
    File,
    FormData,
    TextDecoder,
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
    await api.rag_search("question", (_name, data) => events.push(data), documentContext);
    assert.equal(request.url, "http://localhost:8000/rag/search");
    assert.deepEqual(JSON.parse(request.options.body), { query: "question", user_id: documentContext.user_id, document_id: documentContext.document_id });
    assert.equal(events.filter((data) => data.stage === "response").map((data) => data.message).join(""), "Hello world");
    assert.equal(events.at(-1).stage, "done");
  } finally { dispose(); }
});

test("supports the backend's no-data completion event", async () => {
  const { api, dispose } = loadApi(async () => stream(event({ stage: "done", message: "No data found" })));
  try {
    let answer;
    await api.rag_search("question", (_name, data) => { answer = data.message; }, documentContext);
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
      await assert.rejects(api.rag_search("question", () => {}, documentContext), expected);
      assert.equal(requests, 1);
    } finally { dispose(); }
  });
}

test("reports missing configuration before fetching", async () => {
  const { api, dispose } = loadApi(() => assert.fail("Should not fetch"), "");
  try {
    await assert.rejects(api.rag_search("question", () => {}, documentContext), /NEXT_PUBLIC_API_URL/);
  } finally { dispose(); }
});

test("user cancellation completes without an error", async () => {
  const controller = new AbortController();
  const { api, dispose } = loadApi(async () => {
    controller.abort();
    return stream("");
  });
  try {
    await api.rag_search("question", () => {}, documentContext, controller.signal);
    assert.equal(controller.signal.aborted, true);
  } finally { dispose(); }
});

test("times out an unresponsive backend", async () => {
  const { api, dispose } = loadApi(() => new Promise(() => {}), "http://localhost:8000", true);
  try {
    await assert.rejects(api.rag_search("question", () => {}, documentContext), /stopped responding/);
  } finally { dispose(); }
});

test("uploads one multipart file with user scope and source", async () => {
  let request;
  const { api, dispose } = loadApi(async (url, options) => {
    request = { url, options };
    return Response.json(documentContext);
  });
  try {
    const file = new File(["Document facts"], "notes.txt", { type: "text/plain" });
    const result = await api.buildDocument(file, documentContext.user_id, "template");
    assert.equal(result.document_id, documentContext.document_id);
    assert.equal(request.url, "http://localhost:8000/rag/build");
    assert.equal(request.options.headers, undefined);
    assert.equal(request.options.body.getAll("file").length, 1);
    assert.equal(request.options.body.get("user_id"), documentContext.user_id);
    assert.equal(request.options.body.get("source"), "template");
    assert.equal(request.options.body.get("file").name, "notes.txt");
  } finally { dispose(); }
});

test("rejects oversized documents before uploading", async () => {
  const { api, dispose } = loadApi(() => assert.fail("Should not upload"));
  try {
    const file = new File([new Uint8Array(api.MAX_DOCUMENT_BYTES + 1)], "large.pdf");
    await assert.rejects(api.buildDocument(file, documentContext.user_id, "pdf"), /1 MiB/);
  } finally { dispose(); }
});

test("measures UTF-8 bytes and lines without counting trailing newlines", () => {
  const { api, dispose } = loadApi();
  try {
    assert.equal(api.measureText("\u00e9").bytes, 2);
    assert.equal(api.measureText("first\r\nsecond\n").lines, 2);
    assert.equal(api.measureText("").lines, 0);
    assert.equal(api.measureText("line\n".repeat(50)).lines, 50);
  } finally { dispose(); }
});

test("custom text requires 50 lines before uploading", async () => {
  let uploads = 0;
  const { api, dispose } = loadApi(async () => { uploads += 1; return Response.json(documentContext); });
  try {
    assert.equal(api.MIN_CUSTOM_TEXT_LINES, 50);
    const short = new File(["line\n".repeat(49)], "notes.txt");
    await assert.rejects(api.buildDocument(short, documentContext.user_id, "custom"), /at least 50 lines/);
    assert.equal(uploads, 0);
    const valid = new File(["line\n".repeat(50)], "notes.txt");
    await api.buildDocument(valid, documentContext.user_id, "custom");
    assert.equal(uploads, 1);
  } finally { dispose(); }
});

test("custom and template text reject invalid content before uploading", async () => {
  const { api, dispose } = loadApi(() => assert.fail("Should not upload"));
  try {
    for (const source of ["custom", "template"]) {
      for (const [content, expected] of [[" \n ", /readable text/], ["facts\x00", /readable text/], [new Uint8Array([255]), /UTF-8/]]) {
        await assert.rejects(api.buildDocument(new File([content], "notes.txt"), documentContext.user_id, source), expected);
      }
    }
  } finally { dispose(); }
});

test("reports build errors and rejects another user's session", async () => {
  for (const [response, expected] of [
    [Response.json({ detail: "Document exceeds 1 MiB." }, { status: 413 }), /exceeds 1 MiB/],
    [Response.json({ ...documentContext, user_id: "user_other" }), /invalid document session/],
  ]) {
    const { api, dispose } = loadApi(async () => response);
    try {
      await assert.rejects(api.buildDocument(new File(["facts"], "notes.txt"), documentContext.user_id, "template"), expected);
    } finally { dispose(); }
  }
});

test("status UI renders only the latest stage", () => {
  const component = ts.transpileModule(readFileSync(new URL("../src/components/chat/status-tags.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(component, { exports, require: (name) => name.endsWith(".css") ? { default: { statusTag: "status-tag", spinner: "spinner" } } : require(name) });
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const stages = [];
  for (const stage of ["searching", "retrieved", "generating", "done"]) {
    stages.push({ stage, message: `Stage ${stage}` });
    const html = renderToStaticMarkup(createElement(exports.StatusTags, { turn: { stages, state: stage === "done" ? "complete" : "streaming" } }));
    assert.equal((html.match(/class="status-tag/g) ?? []).length, 1);
    assert.ok(html.includes(`Stage ${stage}`));
    for (const previous of stages.slice(0, -1)) assert.ok(!html.includes(previous.message));
  }
});

function loadChat() {
  const source = ts.transpileModule(readFileSync(new URL("../src/hooks/use-chat.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const states = [];
  const requests = [];
  const react = {
    useEffect() {},
    useRef: (current) => ({ current }),
    useState: (initial) => {
      const index = states.length;
      states.push(initial);
      return [initial, (update) => { states[index] = typeof update === "function" ? update(states[index]) : update; }];
    },
  };
  const api = {
    getErrorMessage: () => "Request failed",
    rag_search: async (question, onEvent, document) => {
      requests.push({ question, document });
      onEvent("status", { stage: "response", message: "Document answer" });
      onEvent("status", { type: "tag", stage: "done", message: "Complete" });
    },
  };
  runInNewContext(source, {
    exports, AbortController, crypto: require("node:crypto").webcrypto,
    require: (name) => name === "react" ? react : name === "@/api" ? api : require(name),
  });
  return { exports, states, requests };
}

test("chat composer caps input at 50 words and 313 characters", () => {
  const component = ts.transpileModule(readFileSync(new URL("../src/components/chat/chat-composer.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  let input = "";
  const sent = [];
  const react = {
    useState: () => [input, (value) => { input = value; }],
    useRef: () => ({ current: null }),
  };
  runInNewContext(component, {
    exports,
    require: (name) => name === "react" ? react : name.endsWith(".css") ? { default: {} } : require(name),
  });
  const render = (isStreaming = false) => exports.ChatComposer({ isStreaming, onSend: (question) => sent.push(question), onStop() {} });
  const change = (value) => render().props.children[0].props.onChange({ target: { value, style: {}, scrollHeight: 40 } });
  assert.equal(render().props.children[0].props.maxLength, 313);
  change("a".repeat(314));
  assert.equal(input, "a".repeat(313));
  render().props.onSubmit({ preventDefault() {} });
  assert.equal(sent.at(-1), "a".repeat(313));
  assert.equal(input, "");
  for (const separator of [" ", "\n", "\t", "  "]) {
    const words = Array.from({ length: 50 }, () => "word").join(separator);
    change(words);
    assert.equal(input, words);
    change(`${words}${separator}extra`);
    assert.equal(input, words);
  }
  render(true).props.onSubmit({ preventDefault() {} });
  assert.equal(sent.length, 1);
  render().props.onSubmit({ preventDefault() {} });
  assert.equal(sent.at(-1).match(/\S+/g).length, 50);
  for (const invalid of ["a".repeat(314), "word ".repeat(51), " \n "]) {
    input = invalid;
    render().props.onSubmit({ preventDefault() {} });
    assert.equal(sent.length, 2);
  }
});

test("recognizes greeting-only messages, punctuation, and repeated letters", () => {
  const { exports } = loadChat();
  for (const message of ["hi", "HELLO!!!", "Hola", "hey there", "good morning", "what's up?", "hiiii", "helloooo", "hi \u{1f44b}"]) {
    assert.match(exports.getGreetingResponse(message), /Hello, welcome/, message);
  }
  for (const message of ["bye", "goodbye!", "byeee", "see you later", "good night"]) {
    assert.match(exports.getGreetingResponse(message), /Goodbye/, message);
  }
});

test("handles conservative greeting typos without swallowing document questions", () => {
  const { exports } = loadChat();
  for (const message of ["helo", "helllo", "hellp", "welcom", "goodby", "good mornng"]) {
    assert.ok(exports.getGreetingResponse(message), message);
  }
  for (const message of ["", "help", "history", "halo", "hi, what is RAG?", "hello explain Saturn", "bye what are comets", "what does hello mean", "summarize my document", "hi " + "document ".repeat(20)]) {
    assert.equal(exports.getGreetingResponse(message), null, message);
  }
});

test("greetings create completed turns without backend requests or streaming", async () => {
  const { exports, states, requests } = loadChat();
  const chat = exports.useChat(documentContext);
  await chat.send("helo!");
  assert.equal(requests.length, 0);
  assert.equal(states[0].length, 1);
  assert.equal(states[0][0].state, "complete");
  assert.equal(states[0][0].stages.length, 0);
  assert.match(states[0][0].answer, /Hello, welcome/);
  assert.equal(states[1], false);
  await chat.send("bye");
  assert.match(states[0][1].answer, /Goodbye/);
  assert.equal(requests.length, 0);
});

test("greeting-prefixed questions still reach scoped retrieval", async () => {
  const { exports, states, requests } = loadChat();
  const chat = exports.useChat(documentContext);
  await chat.send("Hi, what makes Saturn's rings unique?");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].document.document_id, documentContext.document_id);
  assert.equal(states[0][0].answer, "Document answer");
  assert.equal(states[0][0].state, "complete");
  assert.equal(states[1], false);
});