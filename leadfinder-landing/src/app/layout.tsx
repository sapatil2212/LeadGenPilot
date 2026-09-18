import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexaLeadAi — Automated Google Maps Lead Generation",
  description: "NexaLeadAi automatically scrapes Google Maps to find high-quality local business leads without websites, scores them with AI, and delivers qualified leads to your Google Sheet in real-time.",
  keywords: "lead generation, Google Maps scraper, AI leads, local business leads, sales automation, outreach",
  icons: {
    icon: [],
  },
  openGraph: {
    title: "NexaLeadAi — Find Hot Leads Automatically",
    description: "AI-powered Google Maps scraping. Find, score, and reach local business leads automatically.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="data:," />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
