"use client";

import { ArrowUp, Square } from "lucide-react";
import { useRef, useState } from "react";
import styles from "./chat.module.css";
import { config_document_limits } from "../../document_limits";

const MAX_MESSAGE_CHARACTERS = config_document_limits.max_message_characters;
const MAX_MESSAGE_WORDS = config_document_limits.max_message_words;

type ChatComposerProps = {
  isStreaming: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
};

export function ChatComposer({ isStreaming, onSend, onStop }: ChatComposerProps) {
  const [input, setInput] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const question = input.trim();
    if (!question || isStreaming || question.length > MAX_MESSAGE_CHARACTERS ||
        (question.match(/\S+/g)?.length ?? 0) > MAX_MESSAGE_WORDS) return;
    onSend(question);
    setInput("");
    if (textarea.current) textarea.current.style.height = "auto";
    textarea.current?.focus();
  };

  return (
    <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <textarea
        ref={textarea}
        aria-label="Message RAG Playground"
        placeholder="Ask a question about your documents..."
        value={input}
        rows={1}
        maxLength={MAX_MESSAGE_CHARACTERS}
        onChange={(event) => {
          let value = event.target.value.slice(0, MAX_MESSAGE_CHARACTERS);
          const words = [...value.matchAll(/\S+/g)];
          if (words.length > MAX_MESSAGE_WORDS) {
            value = value.slice(0, words[MAX_MESSAGE_WORDS].index).trimEnd();
          }
          setInput(value);
          event.target.style.height = "auto";
          event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className={styles.composerBar}>
        <span className={styles.composerLabel}><span className={styles.smallDot} /> Document context</span>
        {isStreaming ? (
          <button type="button" className={styles.sendButton} onClick={onStop} aria-label="Stop generating" title="Stop generating">
            <Square size={15} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className={styles.sendButton} disabled={!input.trim()} aria-label="Send message" title="Send message">
            <ArrowUp size={20} aria-hidden="true" />
          </button>
        )}
      </div>
    </form>
  );
}