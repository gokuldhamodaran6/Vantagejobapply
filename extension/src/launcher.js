// On known careers sites, a small "Fill with Vantage" button appears next to application forms.
(() => {
  if (window !== window.top || document.getElementById("vantage-launch")) return;
  // Opened from Vantage's "Finish in my browser": start filling straight away.
  if (/vantage-apply/.test(location.hash)) {
    history.replaceState(null, "", location.href.replace(/#vantage-apply.*$/, ""));
    setTimeout(() => chrome.runtime.sendMessage({ type: "fill" }), 1500);
    return;
  }
  const ATS = /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkday\.com|icims\.com|smartrecruiters\.com|workable\.com|jobvite\.com|bamboohr\.com|recruitee\.com|amazon\.jobs|taleo\.net|successfactors\.(com|eu)|oraclecloud\.com|breezy\.hr|rippling\.com|teamtailor\.com|personio\.(de|com)|pinpointhq\.com|dover\.com|paylocity\.com|ultipro\.com|adp\.com)$/i;
  if (!ATS.test(location.hostname)) return;
  // On a careers site: a job page (Apply button) or any step of an application form.
  const looksLikeForm = () => document.querySelectorAll("input[type='file'], input[type='email'], input[name*='name' i], input[type='text']").length >= 1 || [...document.querySelectorAll("a, button")].some((b) => /^\s*(apply|apply now|apply for this job|start (your )?application)\s*$/i.test(b.textContent || ""));
  const add = () => {
    if (document.getElementById("vantage-launch") || !looksLikeForm()) return;
    const b = document.createElement("button");
    b.id = "vantage-launch";
    b.textContent = "Apply with Vantage";
    b.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:999px;padding:12px 18px;background:#2f5beb;color:#fff;font:600 14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 10px 30px rgba(47,91,235,.35);cursor:pointer";
    b.onclick = () => { b.remove(); chrome.runtime.sendMessage({ type: "fill" }); };
    document.body.appendChild(b);
  };
  add();
  new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: true });
})();
