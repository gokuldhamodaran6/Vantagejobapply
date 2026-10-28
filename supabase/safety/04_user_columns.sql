-- Applied as migration agent_tasks_user_columns_fix (2026-10-28).
-- The app's own buttons (Save answers, Dismiss, Finish on site, I'm 18+) write a progress note and a dismiss reason.
-- Both are plain text the user may set on their own tasks; sending, attempts, priority and Submit stay server-only.
grant update (step, cancel_reason) on public.agent_tasks to authenticated;
