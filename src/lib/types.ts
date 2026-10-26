export type Sponsorship = "offers" | "silent" | "no" | "unknown";

export type Job = {
  id: string;
  source: string;
  country: string; // ISO-2 upper
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  description: string | null;
  url: string;
  salary_min: number | null;
  salary_max: number | null;
  currency: string | null;
  category: string | null;
  contract_time: string | null;
  posted_at: string | null;
  sponsorship: Sponsorship;
  sponsor_registered: boolean;
  restrictions: string[];
};

export type WorkStatus =
  | "citizen"
  | "permanent_resident"
  | "student_visa"
  | "post_study_work"
  | "work_visa"
  | "dependent_visa"
  | "none";

export type ApplyScope = "sponsor_only" | "sponsor_or_silent" | "any_legal";

export type WorkAuth = {
  id?: string;
  country: string;
  status: WorkStatus;
  needs_sponsorship_now: boolean;
  needs_sponsorship_future: boolean;
  apply_scope: ApplyScope;
  details: Record<string, unknown>;
};

export type TargetRole = {
  id: string;
  title: string;
  levels: string[];
  keywords: string[];
  priority: number;
  active: boolean;
};

export type TargetPrefs = {
  countries: string[];
  locations: { country: string; city: string; state?: string; radius_km: number }[];
  remote_ok: boolean;
  industries: string[];
  industry_mode: "only" | "prefer" | "all";
  salary_min: number | null;
  currency: string | null;
  job_types: string[];
  companies: string[];
  blocked_companies: string[];
  max_days_old: number;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "user" | "admin";
  plan: "free" | "pro" | "autopilot";
  plan_status: string;
  plan_renews_at?: string | null;
  stripe_customer_id?: string | null;
  last_seen_at?: string | null;
  home_country: string | null;
  citizenship: string | null;
  phone: string | null;
  linkedin_url: string | null;
  autonomy: "approve_all" | "approve_important" | "fully_automatic";
  agent_enabled?: boolean;
  daily_limit: number;
  onboarding_complete: boolean;
  created_at: string;
};

export type AppStatus =
  | "saved"
  | "ready"
  | "applied"
  | "in_review"
  | "assessment"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

export type Application = {
  id: string;
  job_id: string | null;
  job: { title: string; company: string; url: string; country: string; location?: string | null };
  target_role_id: string | null;
  resume_id: string | null;
  status: AppStatus;
  match_score: number | null;
  cover_letter: string | null;
  answers: Record<string, string>;
  notes: string | null;
  events: { at: string; type: string; text: string }[];
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ResumeContent = {
  name: string;
  headline?: string;
  location?: string;
  email?: string;
  phone?: string;
  links?: string[];
  summary?: string;
  skills?: { group: string; items: string[] }[];
  experience?: { title: string; company: string; location?: string; start?: string; end?: string; bullets: string[] }[];
  projects?: { name: string; tech?: string; bullets: string[] }[];
  education?: { degree: string; school: string; location?: string; end?: string; details?: string }[];
  certifications?: string[];
  awards?: string[];
  additional?: string[];
};

export type Resume = {
  id: string;
  target_role_id: string | null;
  name: string;
  is_master: boolean;
  level_format: string;
  style?: ResumeStyle | null;
  content: ResumeContent;
  ats_score: number | null;
  updated_at: string;
};

export type MatchResult = {
  score: number; // 0-100
  eligible: boolean;
  verdict: "great" | "good" | "stretch" | "blocked";
  reasons: string[];
  warnings: string[];
  blockers: string[];
  role?: TargetRole;
  tooSenior?: boolean;
  roleFit?: number;
};

export type ResumeStyle = "classic" | "modern" | "compact" | "executive";
export type LetterTone = "confident" | "warm" | "bold" | "formal";
