"use client";

import { ArrowRight, BookOpen, Download, Eye, EyeOff, FileText, FileUp, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildDocument, getErrorMessage, MAX_DOCUMENT_BYTES, measureText, RagRequestError, type DocumentContext, type DocumentSource } from "@/api";
import styles from "./document-setup.module.css";

const templates = [
  {
    name: "Solar System", filename: "solar-system.txt", content: [
      "The Solar System consists of the Sun and objects gravitationally bound to it, including eight planets, dwarf planets, moons, asteroids, and comets.",
      "The Sun is a star composed mainly of hydrogen and helium. Nuclear fusion in its core supplies the energy that reaches Earth as sunlight.",
      "Mercury, Venus, Earth, and Mars are terrestrial planets with solid surfaces. Jupiter and Saturn are gas giants; Uranus and Neptune are ice giants.",
      "Mercury is the smallest planet and closest to the Sun. Venus has a thick carbon dioxide atmosphere and a strong greenhouse effect.",
      "Earth has liquid surface water and an atmosphere dominated by nitrogen and oxygen. Mars has a thin atmosphere and evidence of ancient flowing water.",
      "Jupiter is the largest planet. Its Great Red Spot is a long-lived atmospheric storm. Jupiter's moon Europa has evidence of a subsurface ocean.",
      "Saturn's prominent rings consist mainly of ice particles. Its moon Titan has a dense atmosphere and lakes of liquid hydrocarbons.",
      "Uranus rotates with its axis tilted strongly relative to its orbit. Neptune has powerful winds and a large moon named Triton.",
      "The asteroid belt lies mainly between Mars and Jupiter. The Kuiper Belt lies beyond Neptune and contains icy bodies including Pluto.",
      "Comets contain ice and dust. When a comet approaches the Sun, heating can produce a coma and tails. One astronomical unit is approximately the mean Earth-Sun distance.",
    ].join("\n\n"),
  },
  {
    name: "RAG Essentials", filename: "rag-essentials.txt", content: [
      "Retrieval-augmented generation, or RAG, combines document retrieval with language-model generation. Retrieved passages provide context for a user's question.",
      "Ingestion extracts readable text from source documents. Documents are split into chunks so retrieval can select relevant passages rather than entire files.",
      "Chunk size balances context and precision. Overlap can preserve information across chunk boundaries but increases storage and duplicate content.",
      "An embedding model converts text into numeric vectors. Semantically related text often has nearby vectors under the model's similarity metric.",
      "A vector database stores embeddings alongside text and metadata. Every stored vector must have the dimensionality expected by its collection.",
      "At query time, the question is embedded using the same embedding model. Similarity search returns candidate passages for the generator.",
      "Metadata filters constrain retrieval to an intended user, document, date, or category. Filtering should happen in the database before results are returned.",
      "The prompt combines instructions, the question, and retrieved context. A model should acknowledge insufficient evidence instead of inventing unsupported details.",
      "Streaming delivers generated text incrementally. Cancellation can close the client connection, but stopping upstream generation depends on server and provider behavior.",
      "RAG evaluation includes retrieval relevance, answer faithfulness, and latency. User-provided identifiers are not a replacement for authentication and access control.",
    ].join("\n\n"),
  },
  {
    name: "Ocean Life", filename: "ocean-life.txt", content: [
      "The ocean covers about 71 percent of Earth's surface. Marine ecosystems vary with depth, temperature, salinity, light, and nutrient availability.",
      "Phytoplankton are photosynthetic organisms that form the base of many marine food webs. Their growth depends on sunlight and nutrients.",
      "Zooplankton include small drifting animals that consume phytoplankton or other organisms. They transfer energy to fish and larger predators.",
      "Coral reefs are built by colonies of coral animals. Many reef-building corals host symbiotic algae that provide energy through photosynthesis.",
      "Coral bleaching occurs when stressed corals lose their symbiotic algae. Prolonged heat stress can reduce survival and damage reef ecosystems.",
      "Kelp forests grow in cool, nutrient-rich coastal waters. They provide habitat and shelter for fish, invertebrates, and marine mammals.",
      "Mangroves grow along tropical and subtropical coasts. Their roots support nursery habitats and help reduce coastal erosion.",
      "The deep ocean receives little or no sunlight. Some hydrothermal-vent ecosystems depend on chemosynthetic microbes rather than photosynthesis.",
      "Whales and dolphins are mammals that breathe air. Sharks are cartilaginous fish; most bony fish belong to a different evolutionary group.",
      "Overfishing, habitat loss, pollution, and climate change threaten marine ecosystems. Conservation measures include habitat protection and sustainable fishing practices.",
    ].join("\n\n"),
  },
];

export function DocumentSetup({ onReady }: { onReady: (document: DocumentContext) => void }) {
  const [mode, setMode] = useState<DocumentSource>("template");
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [buildingName, setBuildingName] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const userId = useRef<string | null>(null);
  const stats = measureText(text);
  const validText = stats.lines >= 100 && stats.bytes <= MAX_DOCUMENT_BYTES && !!text.trim();

  useEffect(() => () => active.current?.abort(), []);

  const choose = (source: DocumentSource) => {
    if (active.current) return;
    setMode(source);
    setText("");
    setPdf(null);
    setError("");
    setPreview(null);
  };

  const upload = async (file: File, source: DocumentSource) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setBuildingName(file.name);
    setError("");
    try {
      if (!userId.current) {
        let saved: string | null = null;
        try { saved = sessionStorage.getItem("rag-user-id"); } catch {}
        if (!globalThis.crypto?.randomUUID) throw new RagRequestError("This browser requires HTTPS or localhost to create a user session.");
        userId.current = saved && /^user_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved) ? saved : `user_${crypto.randomUUID()}`;
        try { sessionStorage.setItem("rag-user-id", userId.current); } catch {}
      }
      const document = await buildDocument(file, userId.current, source, controller.signal);
      if (!controller.signal.aborted) {
        setText("");
        setPdf(null);
        onReady(document);
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(getErrorMessage(failure));
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <section className={styles.setup} aria-labelledby="document-heading" aria-busy={busy}>
      <p className={styles.eyebrow}>AI DOCUMENT CHAT</p>
      <h1 id="document-heading">Chat with your documents</h1>
      <p className={styles.intro}>Your text, a PDF, or a sample document.</p>
      <fieldset className={styles.sources} disabled={busy}>
        <legend className={styles.srOnly}>Document source</legend>
        {([
          { source: "custom", label: "Paste text", Icon: FileText },
          { source: "pdf", label: "Upload PDF", Icon: FileUp },
          { source: "template", label: "Try a sample", Icon: BookOpen },
        ] as const).map(({ source, label, Icon }) => (
          <label className={styles.source} key={source}>
            <input type="radio" name="document-source" value={source} checked={mode === source} onChange={() => choose(source)} />
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      {mode === "custom" && <form className={styles.panel} onSubmit={(event) => {
        event.preventDefault();
        if (validText) void upload(new File([text], "custom-text.txt", { type: "text/plain;charset=utf-8" }), "custom");
      }}>
        <label htmlFor="document-text">Custom text</label>
        <textarea id="document-text" value={text} maxLength={MAX_DOCUMENT_BYTES} disabled={busy} aria-describedby="text-limits text-count" onChange={(event) => {
          const value = event.target.value;
          if (value.length > MAX_DOCUMENT_BYTES || measureText(value).bytes > MAX_DOCUMENT_BYTES) {
            setError("Custom text cannot exceed 1 MiB.");
            return;
          }
          setError("");
          setText(value);
        }} />
        <div className={styles.limits}>
          <span id="text-limits">100 lines minimum / 1 MiB maximum</span>
          <span id="text-count">{stats.lines} lines / {(stats.bytes / 1024).toFixed(1)} KiB</span>
        </div>
        <button className={styles.build} type="submit" disabled={busy || !validText}><span>Start chatting</span><ArrowRight size={16} aria-hidden="true" /></button>
      </form>}

      {mode === "pdf" && <form className={styles.panel} onSubmit={(event) => {
        event.preventDefault();
        if (pdf) void upload(pdf, "pdf");
      }}>
        <label htmlFor="document-pdf">PDF document</label>
        <input className={styles.fileInput} id="document-pdf" type="file" accept=".pdf,application/pdf" disabled={busy} aria-describedby="pdf-limits" onChange={(event) => {
          const file = event.target.files?.[0];
          setPdf(null);
          setError("");
          if (!file) return;
          if (!/\.pdf$/i.test(file.name) || !file.size || file.size > MAX_DOCUMENT_BYTES) {
            setError("Choose a nonempty PDF no larger than 1 MiB.");
            event.target.value = "";
            return;
          }
          setPdf(file);
        }} />
        <p className={styles.limits} id="pdf-limits">1 MiB maximum / 100 pages maximum / text-based PDF</p>
        <a className={styles.sampleDownload} href="/samples/solar-system.pdf" download="solar-system.pdf"><Download size={16} aria-hidden="true" /><span>Download sample PDF</span></a>
        {pdf && <p className={styles.selectedFile}>{pdf.name} / {(pdf.size / 1024).toFixed(1)} KiB</p>}
        <button className={styles.build} type="submit" disabled={busy || !pdf}><span>Start chatting</span><ArrowRight size={16} aria-hidden="true" /></button>
      </form>}

      {mode === "template" && <div className={styles.templates}>
        {templates.map((template) => {
          const expanded = preview === template.filename;
          const start = () => void upload(new File([template.content], template.filename, { type: "text/plain;charset=utf-8" }), "template");
          return <div key={template.filename} className={styles.templateGroup}>
            <div className={styles.templateRow}>
              <button className={styles.templateSelect} type="button" disabled={busy} onClick={start}>
                <BookOpen size={18} aria-hidden="true" /><span>{template.name}</span>
              </button>
              <button className={styles.templateAction} type="button" disabled={busy} onClick={() => setPreview(expanded ? null : template.filename)} aria-label={`${expanded ? "Hide" : "Preview"} ${template.name}${expanded ? " preview" : ""}`} title={`${expanded ? "Hide" : "Preview"} ${template.name}`} aria-expanded={expanded} aria-controls={`preview-${template.filename}`}>
                {expanded ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
              </button>
              <button className={styles.templateAction} type="button" disabled={busy} onClick={start} aria-label={`Chat with ${template.name}`} title={`Chat with ${template.name}`}><ArrowRight size={17} aria-hidden="true" /></button>
            </div>
            {expanded && <section className={styles.preview} id={`preview-${template.filename}`} aria-label={`${template.name} preview`}>
              <h2>{template.name}</h2>
              <p>{template.content}</p>
            </section>}
          </div>;
        })}
      </div>}

      {busy && <p className={styles.progress} role="status"><LoaderCircle size={16} className={styles.spinner} aria-hidden="true" /><span>Preparing {buildingName} for chat...</span></p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}