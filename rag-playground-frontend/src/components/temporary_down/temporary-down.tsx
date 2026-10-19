import { ArrowUpRight, CloudOff } from "lucide-react";
import styles from "./temporary-down.module.css";

const TemporaryDown = () => {
	return (
		<main className={styles.page} aria-labelledby="outage-title">
			<div className={styles.content}>
				<CloudOff className={styles.icon} size={56} strokeWidth={1.25} aria-hidden="true" />
				<p className={styles.brand}>RAG Playground</p>
				<h1 id="outage-title">Temporarily unavailable</h1>
				<p role="status">Cloudflare is reporting a service outage. RAG Playground may be unavailable until service is restored.</p>
				<a className={styles.link} href="https://www.cloudflarestatus.com/">
					Cloudflare status <ArrowUpRight size={18} aria-hidden="true" />
				</a>
			</div>
		</main>
	);
};

export default TemporaryDown;