import { MeProvider } from "@/lib/me";

export const metadata = { title: "Admin portal", robots: { index: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <MeProvider>{children}</MeProvider>;
}
