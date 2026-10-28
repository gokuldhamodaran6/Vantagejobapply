import type { NextRequest } from "next/server";
import { loadUserContext } from "@/lib/server-user";
import { coverLetterPdf, resumePdf } from "@/lib/resume/pdf";
import type { ResumeContent, ResumeStyle } from "@/lib/types";
import { bestName } from "@/lib/agent/fields";

/** Download a resume (or an application's cover letter) as a clean, ATS-readable PDF. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await loadUserContext();
  if (!ctx) return new Response("Log in first.", { status: 401 });
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const { data: r } = await ctx.supabase.from("resumes").select("content,style,name").eq("id", id).maybeSingle();
  if (!r) return new Response("Not found", { status: 404 });
  const content = r.content as ResumeContent;
  const style = (sp.get("style") || r.style || "classic") as ResumeStyle;
  const asked = (sp.get("country") || "").toUpperCase();
  const country = /^[A-Z]{2,4}$/.test(asked) ? asked : ctx.prefs?.countries?.[0] || "US";
  const kind = sp.get("kind");
  let bytes: Uint8Array;
  let filename: string;
  const name = bestName(ctx.profile.full_name, content.name);
  const person = (name || "Resume").replace(/[^A-Za-z0-9]+/g, "_");
  if (kind === "cover") {
    const { data: app } = await ctx.supabase.from("applications").select("cover_letter").eq("user_id", ctx.user.id).eq("resume_id", id).limit(1).maybeSingle();
    const { data: task } = app?.cover_letter ? { data: null } : await ctx.supabase.from("agent_tasks").select("cover_letter").eq("resume_id", id).maybeSingle();
    const letter = app?.cover_letter || task?.cover_letter || sp.get("text") || "";
    if (!letter) return new Response("No cover letter for this resume yet.", { status: 404 });
    bytes = await coverLetterPdf(letter, content, { style, country, name });
    filename = `${person}_Cover_Letter.pdf`;
  } else {
    bytes = await resumePdf(content, { style, country, name });
    filename = `${person}_Resume.pdf`;
  }
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${sp.get("inline") ? "inline" : "attachment"}; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
