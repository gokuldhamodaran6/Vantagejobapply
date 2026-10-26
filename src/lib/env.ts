// Public values (safe to ship to the browser). Server-only secrets are read
// directly from process.env inside server files and never imported here.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://fplxzhjjribmscduypoj.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_0gN2DJa_K3TGHCzYtIyZow_GYwpXedd";
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const ADMIN_EMAIL = "gokuldhamodaran6@gmail.com";
export const APP_NAME = "Vantage";
