import type { Metadata } from "next";
import { MeProvider } from "@/lib/me";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = { title: "Your job search", robots: { index: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <MeProvider>
      <AppShell>{children}</AppShell>
    </MeProvider>
  );
}
