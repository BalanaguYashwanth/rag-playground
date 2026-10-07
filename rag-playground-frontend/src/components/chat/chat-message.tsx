"use client";

import { AlertCircle, Check, Copy, Orbit, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { ChatTurn } from "@/hooks/use-chat";
import { StatusTags } from "./status-tags";
import styles from "./chat.module.css";

type ChatMessageProps = {
  turn: ChatTurn;
  isStreaming: boolean;
  onRetry: () => void;
};

export function ChatMessage({ turn, isStreaming, onRetry }: ChatMessageProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.answer);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState("idle"), 2500);
  };

  return (
    <article className={styles.turn}>
      <div className={styles.userMessage}><span className={styles.srOnly}>You: </span>{turn.question}</div>
      <div className={styles.assistantHeader}>
        <Orbit size={20} aria-hidden="true" />
        <span>Playground</span>
        <span className={styles.assistantLabel}>DOCUMENT ASSISTANT</span>
      </div>
      {(turn.stages.length > 0 || turn.state === "streaming") && <StatusTags turn={turn} />}
      {turn.answer && <div className={`${styles.answer} ${turn.state === "streaming" ? styles.streamingAnswer : ""}`}>
        <Markdown components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>{turn.answer}</Markdown>
      </div>}
      {turn.state === "streaming" && !turn.answer && <div className={styles.thinking} aria-label="Waiting for an answer"><span /><span /><span /></div>}
      {turn.state === "error" && <div className={styles.error} role="alert"><AlertCircle size={16} aria-hidden="true" /><p>{turn.error}</p></div>}
      {turn.state === "stopped" && <p className={styles.stopped}>Response stopped.</p>}
      {turn.state === "complete" && !turn.answer && <p className={styles.stopped}>No answer was returned.</p>}
      {turn.state !== "streaming" && <div className={styles.messageActions}>
        {turn.answer && <button className={styles.iconButton} type="button" onClick={() => void copy()} aria-label={copyState === "copied" ? "Answer copied" : "Copy answer"} title={copyState === "copied" ? "Copied" : "Copy answer"}>
          {copyState === "copied" ? <Check size={15} /> : <Copy size={15} />}
        </button>}
        {(turn.state === "error" || turn.state === "stopped") && <button className={styles.retryButton} type="button" disabled={isStreaming} onClick={onRetry}><RotateCcw size={14} aria-hidden="true" /> Try again</button>}
        {copyState === "error" && <span role="status" className={styles.stopped}>Clipboard unavailable.</span>}
      </div>}
    </article>
  );
}