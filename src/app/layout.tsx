import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Vantage — Jobs abroad that can actually hire you", template: "%s · Vantage" },
  description:
    "Vantage finds live jobs in the US, UK, Canada, Australia and more, filters out roles you can't legally take, tailors your resume per role and tracks every application.",
  openGraph: {
    title: "Vantage — Jobs abroad that can actually hire you",
    description: "Live jobs, visa-aware filtering, ATS-ready resumes and an agent that tracks everything.",
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
