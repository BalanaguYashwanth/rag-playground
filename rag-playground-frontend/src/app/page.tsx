"use client";

import { FilePlus2, FileText, Orbit } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DocumentContext } from "@/api";
import TemporaryDown from "@/components/temporary_down/temporary-down";
import { ChatComposer } from "@/components/chat/chat-composer";
import { DocumentSetup } from "@/components/chat/document-setup";
import { ChatMessage } from "@/components/chat/chat-message";
import { EmptyState } from "@/components/chat/empty-state";
import { useChat } from "@/hooks/use-chat";
import styles from "./page.module.css";

export default function Home() {
  const [document, setDocument] = useState<DocumentContext | null>(null);
  const [cloudflareDown, setCloudflareDown] = useState(false);
  const { turns, isStreaming, send, stop, clear } = useChat(document);
  const conversation = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      try {
        const response = await fetch("https://www.cloudflarestatus.com/api/v2/status.json", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        });
        if (!response.ok) return;
        const data = await response.json();
        const indicator = data?.status?.indicator;
        if (!controller.signal.aborted && ["none", "minor", "major", "critical"].includes(indicator)) {
          setCloudflareDown(indicator === "major" || indicator === "critical");
        }
      } catch {
        return;
      }
    };
    void check();
    const interval = window.setInterval(() => { void check(); }, 60_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

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
    <>
      {cloudflareDown && <TemporaryDown />}
    <div className={styles.page} hidden={cloudflareDown} style={cloudflareDown ? { display: "none" } : undefined}>
      <main className={styles.main}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="RAG Playground home">
            <Orbit size={27} strokeWidth={1.5} aria-hidden="true" />
            <span>RAG <span className={styles.brandSecondary}>Playground</span></span>
          </Link>
          {document && <div className={styles.headerTools}>
            <span className={styles.headerBadge} title={document.filename}><FileText size={12} aria-hidden="true" /><span>{document.filename}</span></span>
            <button className={styles.documentButton} type="button" disabled={isStreaming} aria-label="Choose another document" title="Choose another document" onClick={() => { clear(); setDocument(null); }}><FilePlus2 size={18} aria-hidden="true" /></button>
          </div>}
        </header>

        <div ref={conversation} className={styles.conversation} onScroll={(event) => {
          const element = event.currentTarget;
          followResponse.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        }}>
          <div className={`${styles.conversationInner} ${turns.length === 0 ? styles.emptyConversation : ""}`}>
            {!document ? <DocumentSetup onReady={setDocument} /> : turns.length === 0 ? <EmptyState onSelect={submit} /> : (
              <div role="log" aria-label="Conversation" aria-live="off" className={styles.messages}>
                {turns.map((turn) => <ChatMessage key={turn.id} turn={turn} isStreaming={isStreaming} onRetry={() => { followResponse.current = true; void send(turn.question, turn.id); }} />)}
              </div>
            )}
          </div>
        </div>

        {document && <footer className={styles.footer}>
          <div className={styles.composerWidth}>
            <ChatComposer isStreaming={isStreaming} onSend={submit} onStop={stop} />
            <p className={styles.disclaimer}>Answers may be imperfect. Check important details.</p>
          </div>
        </footer>}
      </main>
    </div>
    </>
  );
}