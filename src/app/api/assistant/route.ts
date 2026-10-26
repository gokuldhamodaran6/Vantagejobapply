import { answer, type Change } from "@/lib/assistant";
import { json, loadUserContext } from "@/lib/server-user";
import { resolveCompany } from "@/lib/jobs/sources";
import { refreshBoard } from "@/lib/jobs/engine";
import { ingestSecret, supabaseAnon } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await loadUserContext();
  if (!ctx) return json({ error: "Log in first." }, 401);
  const body = (await req.json().catch(() => ({}))) as { message?: string; apply?: Change[] };

  // Apply confirmed changes.
  if (body.apply?.length) {
    const done: string[] = [];
    const prefs = ctx.prefs || { countries: [], companies: [] } as unknown as NonNullable<typeof ctx.prefs>;
    for (const c of body.apply) {
      if (c.type === "add_role") {
        if (ctx.roles.length >= ctx.plan.limits.roles) {
          done.push(`Couldn't add ${c.title}: early access allows up to ${ctx.plan.limits.roles} target roles. Pause or remove one first.`);
          continue;
        }
        const { data: role } = await ctx.supabase.from("target_roles").insert({ user_id: ctx.user.id, title: c.title, levels: c.levels, priority: 2 }).select().single();
        const { data: master } = await ctx.supabase.from("resumes").select("content").eq("user_id", ctx.user.id).eq("is_master", true).maybeSingle();
        if (role && master) await ctx.supabase.from("resumes").insert({ user_id: ctx.user.id, target_role_id: role.id, name: `${c.title} resume`, content: master.content });
        done.push(`Now targeting ${c.title} roles${master ? " — a starting resume is in Resumes" : ""}.`);
      } else if (c.type === "add_companies") {
        const names = [...new Set([...(prefs.companies || []), ...c.names])];
        await ctx.supabase.from("target_prefs").update({ companies: names }).eq("user_id", ctx.user.id);
        for (const n of c.names.slice(0, 5)) {
          const b = await resolveCompany(n);
          if (b) {
            const { data: id } = await supabaseAnon().rpc("upsert_board", { secret: ingestSecret(), p: { ats: b.ats, token: b.token, name: n, site: "", added_by: ctx.user.id } });
            const count = await refreshBoard({ ...b, name: n, id: id as number, site: "" }, { now: true });
            done.push(`Watching ${n}'s careers site — ${count} open jobs right now.`);
          } else done.push(`Added ${n}. I couldn't find their careers feed automatically — paste one of their job links in My targets.`);
        }
      } else if (c.type === "add_country") {
        if (!(prefs.countries || []).includes(c.code)) {
          if ((prefs.countries || []).length >= ctx.plan.limits.countries) {
            done.push(`Couldn't add that country: early access allows up to ${ctx.plan.limits.countries} countries.`);
            continue;
          }
          await ctx.supabase.from("target_prefs").update({ countries: [...(prefs.countries || []), c.code] }).eq("user_id", ctx.user.id);
          await ctx.supabase.from("work_auth").upsert({ user_id: ctx.user.id, country: c.code, status: "none", needs_sponsorship_now: true, needs_sponsorship_future: true }, { onConflict: "user_id,country" });
          done.push(`Added ${c.code}. Check your work authorisation for it in My targets.`);
        }
      } else if (c.type === "pause_role") {
        await ctx.supabase.from("target_roles").update({ active: false }).eq("id", c.roleId).eq("user_id", ctx.user.id);
        done.push(`Paused ${c.title}.`);
      }
    }
    const text = done.join("\n") || "Nothing to change.";
    await ctx.supabase.from("chat_messages").insert({ user_id: ctx.user.id, role: "assistant", content: text });
    return json({ text, applied: true });
  }

  const message = (body.message || "").trim().slice(0, 2000);
  if (!message) return json({ error: "Type a question or instruction." }, 400);
  await ctx.supabase.from("chat_messages").insert({ user_id: ctx.user.id, role: "user", content: message });
  try {
    const reply = await answer(ctx.supabase, { userId: ctx.user.id, name: ctx.profile.full_name || "", roles: ctx.roles, prefs: ctx.prefs, auth: ctx.auth, roleLimit: ctx.plan.limits.roles }, message);
    await ctx.supabase.from("chat_messages").insert({ user_id: ctx.user.id, role: "assistant", content: reply.text, data: { apps: reply.apps, changes: reply.changes, jobs: reply.jobs } });
    return json(reply);
  } catch (e) {
    console.error("assistant failed", e);
    return json({ text: "I hit a snag answering that. Try again in a moment — or ask “What's my agent doing?”." });
  }
}
