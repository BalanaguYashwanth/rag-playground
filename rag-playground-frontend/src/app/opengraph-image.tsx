import { ImageResponse } from "next/og";
import { SITE_URL } from "@/constant";

export const alt = "RAG Playground - AI chat with PDFs and documents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 72, background: "#232525", color: "#eeefeb", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", color: "#a8d7be", fontSize: 28 }}>RETRIEVAL-AUGMENTED GENERATION</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 700 }}>RAG Playground</div>
        <div style={{ display: "flex", fontSize: 36, color: "#c9ccc6" }}>Chat with PDFs and documents using AI.</div>
      </div>
      <div style={{ display: "flex", borderTop: "1px solid #526c60", paddingTop: 24, fontSize: 24, color: "#a8d7be" }}>{new URL(SITE_URL).host}</div>
    </div>,
    size,
  );
}