import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_URL } from "@/constant";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "RAG Playground | Chat with PDFs and Documents Using AI",
  description: "Explore retrieval-augmented generation with RAG Playground. Chat with PDF documents, paste your own text, or try sample documents and get streamed AI answers.",
  applicationName: "RAG Playground",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "RAG Playground",
    locale: "en_US",
    title: "RAG Playground | Chat with PDFs and Documents Using AI",
    description: "Explore retrieval-augmented generation. Ask questions about PDFs, your own text, or sample documents with RAG Playground.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "RAG Playground - AI chat with PDFs and documents" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RAG Playground | Chat with PDFs and Documents Using AI",
    description: "Explore retrieval-augmented generation. Ask questions about PDFs, your own text, or sample documents with RAG Playground.",
    images: ["/opengraph-image"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": new URL("#website", SITE_URL).href,
      url: SITE_URL,
      name: "RAG Playground",
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": new URL("#application", SITE_URL).href,
      name: "RAG Playground",
      url: SITE_URL,
      description: metadata.description,
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web browser",
      browserRequirements: "Requires JavaScript and a modern browser.",
      isPartOf: { "@id": new URL("#website", SITE_URL).href },
      about: { "@type": "Thing", name: "Retrieval-augmented generation" },
      featureList: ["PDF document chat", "Custom text questions and answers", "Sample documents", "Streamed AI answers"],
    },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
        {children}
      </body>
    </html>
  );
}
