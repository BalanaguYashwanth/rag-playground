"use client";
import { useParams } from "next/navigation";

import { FilePlus2, LoaderCircle, Orbit } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "@/components/chat/chat-composer";
import { DocumentSetup } from "@/components/chat/document-setup";
import { ChatMessage } from "@/components/chat/chat-message";
import { EmptyState } from "@/components/chat/empty-state";
import { useChat, type ChatTurn } from "@/hooks/use-chat";
import styles from "../page.module.css";
import { fetchConversation, getErrorMessage } from "@/api";

export default function Home() {
  const params = useParams();
  const chatId = (params?.chatId?.[0])?.toString() ?? null;
  const [userId, setUserId] = useState<string | null>(chatId);
  const { turns, addTurns, isStreaming, send, stop, clear } = useChat(userId);
  const conversation = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedChatId, setLoadedChatId] = useState<string | null>(null);
  const isLoading = chatId !== null && loadedChatId !== chatId;

  useEffect(() => {
    if (turns.length > 0 && conversation.current && followResponse.current) {
      conversation.current.scrollTop = conversation.current.scrollHeight;
    }
  }, [turns]);

  useEffect(() => {
    if (!chatId) return;
    const controller = new AbortController();
    fetchConversation(chatId, controller.signal)
      .then((conversations) => {
        if (controller.signal.aborted) return;
        setLoadError(null);
        followResponse.current = true;
        addTurns(conversations.map((item): ChatTurn => ({
          id: String(item.id),
          question: item.user,
          answer: item.agent,
          stages: [],
          state: "complete",
        })));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedChatId(chatId);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const submit = (question: string) => {
    followResponse.current = true;
    void send(question);
  };


  return (
      <main id="main-content" tabIndex={-1} className={styles.main}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" aria-label="RAG Playground home">
            <Orbit size={27} strokeWidth={1.5} aria-hidden="true" />
            <span>RAG <span className={styles.brandSecondary}>Playground</span></span>
          </Link>
          {userId && <div className={styles.headerTools}>
            <button className={styles.documentButton} type="button" disabled={isStreaming} aria-label="Choose another document" title="Choose another document" onClick={() => { clear(); setUserId(null); }}><FilePlus2 size={18} aria-hidden="true" /></button>
          </div>}
        </header>

        <div ref={conversation} className={styles.conversation} onScroll={(event) => {
          const element = event.currentTarget;
          followResponse.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
        }}>
          <div className={`${styles.conversationInner} ${turns.length === 0 ? styles.emptyConversation : ""}`}>
            {loadError && turns.length === 0 && <p role="alert" className={styles.loadError}>{loadError}</p>}
            {userId && isLoading && turns.length === 0 ? (
              <p role="status" className={styles.loading}><LoaderCircle size={18} className={styles.spinner} aria-hidden="true" /><span>Loading conversation...</span></p>
            ) : !userId ? <DocumentSetup onReady={setUserId} /> : turns.length === 0 ? <EmptyState onSelect={submit} /> : (
              <div role="log" aria-label="Conversation" aria-live="off" className={styles.messages}>
                {turns.map((turn) => <ChatMessage key={turn.id} turn={turn} isStreaming={isStreaming} onRetry={() => { followResponse.current = true; void send(turn.question, turn.id); }} />)}
              </div>
            )}
          </div>
        </div>

        {userId && <footer className={styles.footer}>
          <div className={styles.composerWidth}>
            <ChatComposer isStreaming={isStreaming} onSend={submit} onStop={stop} />
            <p className={styles.disclaimer}>Answers may be imperfect. Check important details.</p>
          </div>
        </footer>}
      </main>
  );
}