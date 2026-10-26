import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") || "/app";
  const next = nextParam.startsWith("/") ? nextParam : "/app";
  const origin = process.env.NEXT_PUBLIC_SITE_URL || url.origin;

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("That link has expired. Log in or request a new one.")}`);
  }
  return NextResponse.redirect(`${origin}/login`);
}
