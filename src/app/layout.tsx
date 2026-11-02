import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Vantage — Jobs abroad that can actually hire you", template: "%s · Vantage" },
  description:
    "Vantage writes a resume and cover letter for every job, checks every line against your real history like a hiring manager, fills the company's form, and keeps every application and interview up to date. Visa rules for the US, UK, Canada and Australia built in.",
  openGraph: {
    title: "Vantage — Jobs abroad that can actually hire you",
    description: "A resume for every job. Every word still true.",
    images: [{ url: "/vantage-film-poster.jpg", width: 1280, height: 720, alt: "Vantage" }],
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  );
}
