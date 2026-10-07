import { Check, FileCheck2, LoaderCircle, Search, Sparkles } from "lucide-react";
import type { ChatTurn } from "@/hooks/use-chat";
import styles from "./chat.module.css";

const icons = { searching: Search, retrieved: FileCheck2, generating: Sparkles, done: Check };

export function StatusTags({ turn }: { turn: ChatTurn }) {
  const tag = turn.stages.at(-1) ?? { stage: "searching" as const, message: "Connecting" };
  const active = turn.state === "streaming" && tag.stage !== "done";
  const Icon = active ? LoaderCircle : icons[tag.stage];

  return (
    <div className={styles.statusTags} role="status" aria-live="polite" aria-atomic="true">
      <span className={`${styles.statusTag} ${active ? styles.activeTag : ""}`}>
        <Icon size={13} aria-hidden="true" className={active ? styles.spinner : undefined} />
        <span>{tag.message}</span>
      </span>
    </div>
  );
}