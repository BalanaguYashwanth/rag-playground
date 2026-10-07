"use client";

import { useEffect, useRef, useState } from "react";
import { distance } from "fastest-levenshtein";
import { getErrorMessage, rag_search, type DocumentContext, type RagStage } from "@/api";

const greetingGroups = [
  {
    phrases: ["hi", "hello", "hey", "hola", "howdy", "bonjour", "ciao", "namaste", "greetings", "welcome", "good morning", "good afternoon", "good evening", "hi there", "hello there", "hey there", "hi all", "hello everyone", "how are you", "how are you doing", "what's up"],
    answer: "Hello, welcome! Ask me a question about your document, and I'll help you find answers in its contents.",
  },
  {
    phrases: ["bye", "goodbye", "good bye", "bye bye", "see you", "see you later", "good night", "adios", "hasta luego", "take care"],
    answer: "Goodbye! You're welcome back anytime to ask questions about your document.",
  },
];

function normalizeGreeting(message: string) {
  return message.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
}

export function getGreetingResponse(message: string): string | null {
  if (message.length > 80) return null;
  const normalized = normalizeGreeting(message);
  if (!normalized) return null;
  const unstretched = normalized.replace(/([a-z])\1+/g, "$1");
  for (const group of greetingGroups) {
    for (const phrase of group.phrases) {
      const candidate = normalizeGreeting(phrase);
      if (normalized === candidate || (normalized.length >= candidate.length && unstretched === candidate.replace(/([a-z])\1+/g, "$1"))) return group.answer;
      if (candidate.length >= 5 && normalized.length >= 4 && normalized[0] === candidate[0] &&
          normalized.split(" ").length === candidate.split(" ").length &&
          Math.abs(normalized.length - candidate.length) <= 1 && distance(normalized, candidate) <= 1) return group.answer;
    }
  }
  return null;
}

export type ChatTurn = {
  id: string;
  question: string;
  answer: string;
  state: "streaming" | "complete" | "stopped" | "error";
  stages: { stage: RagStage; message: string }[];
  error?: string;
};

export function useChat(document: DocumentContext | null = null) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const send = async (question: string, retryId?: string) => {
    const query = question.trim();
    if (!query || activeRequest.current || !document) return;
    const id = retryId ?? crypto.randomUUID();
    const greeting = getGreetingResponse(query);
    const turn: ChatTurn = { id, question: query, answer: greeting ?? "", state: greeting ? "complete" : "streaming", stages: [] };
    setTurns((previous) => retryId
      ? previous.map((item) => item.id === id ? turn : item)
      : [...previous, turn]);
    if (greeting) return;

    const controller = new AbortController();
    activeRequest.current = controller;
    setIsStreaming(true);

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
      }, document, controller.signal);
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