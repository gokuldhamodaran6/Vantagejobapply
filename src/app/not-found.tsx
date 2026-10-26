import Link from "next/link";
import { Logo } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <h1 className="mt-6 text-2xl font-bold">This page doesn&apos;t exist</h1>
      <p className="text-muted">The link may be old, or the page has moved.</p>
      <Link href="/" className="btn-primary">Go to the home page</Link>
    </div>
  );
}
