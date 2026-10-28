import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/env";

// Refreshes the Supabase session cookie and does optimistic route protection.
// Real authorization is enforced by Row Level Security and server checks.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Verifies the session token locally (signing keys) and refreshes it when needed — no auth-server round trip per page.
  const { data: c } = await supabase.auth.getClaims();
  const data = { user: c?.claims?.sub ? { id: c.claims.sub } : null };
  const path = request.nextUrl.pathname;
  const isProtected = path.startsWith("/app") || path.startsWith("/admin") || path.startsWith("/onboarding");

  if (isProtected && !data.user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if ((path === "/login" || path === "/signup") && data.user) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/onboarding/:path*", "/login", "/signup"],
};
