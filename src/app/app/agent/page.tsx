import { redirect } from "next/navigation";

/** Auto-apply was retired: old links to "Your agent" land on Live jobs, where Tailor & apply starts every application. */
export default function AgentPage() {
  redirect("/app/jobs");
}
