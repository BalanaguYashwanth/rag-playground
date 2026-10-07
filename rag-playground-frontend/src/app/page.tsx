"use client";

import { FileText, Orbit } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { ChatMessage } from "@/components/chat/chat-message";
import { EmptyState } from "@/components/chat/empty-state";
import { useChat } from "@/hooks/use-chat";
import styles from "./page.module.css";

export default function Home() {
  const { turns, isStreaming, send, stop } = useChat();
  const conversation = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);

  useEffect(() => {
    if (turns.length > 0 && conversation.current && followResponse.current) {
      conversation.current.scrollTop = conversation.current.scrollHeight;
    }
  }, [turns]);

  const submit = (question: string) => {
    followResponse.current = true;
    void send(question);
  };


  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="RAG Playground home">
            <Orbit size={27} strokeWidth={1.5} aria-hidden="true" />
            <span>RAG <span className={styles.brandSecondary}>Playground</span></span>
          </Link>
          <span className={styles.headerBadge}><FileText size={12} aria-hidden="true" /> Solar system</span>
        </header>

        <div ref={conversation} className={styles.conversation} onScroll={(event) => {
          const element = event.currentTarget;
          followResponse.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        }}>
          <div className={`${styles.conversationInner} ${turns.length === 0 ? styles.emptyConversation : ""}`}>
            {turns.length === 0 ? <EmptyState onSelect={submit} /> : (
              <div role="log" aria-label="Conversation" aria-live="off" className={styles.messages}>
                {turns.map((turn) => <ChatMessage key={turn.id} turn={turn} isStreaming={isStreaming} onRetry={() => { followResponse.current = true; void send(turn.question, turn.id); }} />)}
              </div>
            )}
          </div>
        </div>

        <footer className={styles.footer}>
          <div className={styles.composerWidth}>
            <ChatComposer isStreaming={isStreaming} onSend={submit} onStop={stop} />
            <p className={styles.disclaimer}>Answers may be imperfect. Check important details.</p>
          </div>
        </footer>
      </main>
    </div>
  );
}