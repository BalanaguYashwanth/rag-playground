import styles from "./page.module.css";
import Link from "next/link";
import { FileText, MessageSquare, Monitor, Orbit, Plus } from "lucide-react";
import { useChat } from "@/hooks/use-chat";

const SideBar = () => {
  const { turns } = useChat();

  return (
   <aside className={styles.sidebar} aria-label="Workspace">
        <Link className={styles.brand} href="/" aria-label="RAG Playground home">
          <Orbit size={27} strokeWidth={1.5} aria-hidden="true" />
          <span>RAG <span className={styles.brandSecondary}>Playground</span></span>
        </Link>
        <button className={styles.newChat} type="button" onClick={()=>{}}><Plus size={16} aria-hidden="true" /> New conversation</button>
        <div className={styles.sidebarSection}>
          <h2>CONVERSATION</h2>
          <div className={styles.currentChat}><MessageSquare size={15} aria-hidden="true" /><span>{turns[0]?.question ?? "New conversation"}</span></div>
        </div>
        <div className={styles.sidebarSection}>
          <h2>WORKSPACE DOCUMENT</h2>
          <div className={styles.document}><FileText size={18} aria-hidden="true" /><div><p>Solar system</p><span>solar_system_wiki.txt</span></div></div>
        </div>
        <div className={styles.workspace}><Monitor size={15} aria-hidden="true" /><span>Local workspace</span><span className={styles.workspaceBadge}>RAG</span></div>
      </aside>
  );
};

export default SideBar;