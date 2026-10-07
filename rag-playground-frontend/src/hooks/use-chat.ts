"use client";

import { useEffect, useRef, useState } from "react";
import { getErrorMessage, rag_search, type RagStage } from "@/api";

export type ChatTurn = {
  id: string;
  question: string;
  answer: string;
  state: "streaming" | "complete" | "stopped" | "error";
  stages: { stage: RagStage; message: string }[];
  error?: string;
};

export function useChat() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const send = async (question: string, retryId?: string) => {
    const query = question.trim();
    if (!query || activeRequest.current) return;
    const id = retryId ?? crypto.randomUUID();
    const controller = new AbortController();
    activeRequest.current = controller;
    setIsStreaming(true);
    const turn: ChatTurn = { id, question: query, answer: "", state: "streaming", stages: [] };
    setTurns((previous) => retryId
      ? previous.map((item) => item.id === id ? turn : item)
      : [...previous, turn]);

    const update = (transform: (item: ChatTurn) => ChatTurn) => {
      setTurns((previous) => previous.map((item) => item.id === id ? transform(item) : item));
    };

    try {
      await rag_search(query, (_event, data) => {
        if (controller.signal.aborted) return;
        if (data.type === "tag") {
          update((item) => ({
            ...item,
            stages: [...item.stages.filter((tag) => tag.stage !== data.stage),
              { stage: data.stage, message: data.message }],
          }));
        } else if (data.stage === "response" || data.stage === "done") {
          update((item) => ({ ...item, answer: item.answer + data.message }));
        }
      }, controller.signal);
      update((item) => ({ ...item, state: controller.signal.aborted ? "stopped" : "complete" }));
    } catch (error: unknown) {
      update((item) => controller.signal.aborted
        ? { ...item, state: "stopped" }
        : { ...item, state: "error", error: getErrorMessage(error) });
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsStreaming(false);
      }
    }
  };

  const stop = () => activeRequest.current?.abort();
  const clear = () => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setIsStreaming(false);
    setTurns([]);
  };

  return { turns, isStreaming, send, stop, clear };
}