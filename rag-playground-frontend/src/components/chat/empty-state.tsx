import { ArrowUpRight, Orbit } from "lucide-react";
import styles from "./chat.module.css";

const suggestions = [
  { label: "Explore the solar system", question: "What are the main objects in our solar system?" },
  { label: "Compare the planets", question: "How do terrestrial planets differ from gas giants?" },
  { label: "A little cosmic curiosity", question: "What makes Saturn's rings unique?" },
];

export function EmptyState({ onSelect }: { onSelect: (question: string) => void }) {
  return (
    <section className={styles.emptyState}>
      <div className={styles.emptyMark}><Orbit size={38} strokeWidth={1.3} aria-hidden="true" /></div>
      <p className={styles.eyebrow}>RAG PLAYGROUND</p>
      <h1>A question. A little discovery.</h1>
      <p className={styles.emptySubtitle}>What are you curious about?</p>
      <div className={styles.suggestions}>
        {/* {suggestions.map((suggestion) => <button key={suggestion.label} type="button" onClick={() => onSelect(suggestion.question)}>
          <span>{suggestion.label}</span><ArrowUpRight size={16} aria-hidden="true" />
        </button>)} */}
      </div>
    </section>
  );
}