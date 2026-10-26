// On known careers sites, a small "Fill with Vantage" button appears next to application forms.
(() => {
  if (window !== window.top || document.getElementById("vantage-launch")) return;
  const looksLikeForm = () => document.querySelectorAll("input[type='file'], input[type='email'], input[name*='name' i]").length >= 2;
  const add = () => {
    if (document.getElementById("vantage-launch") || !looksLikeForm()) return;
    const b = document.createElement("button");
    b.id = "vantage-launch";
    b.textContent = "Fill with Vantage";
    b.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:999px;padding:12px 18px;background:#2f5beb;color:#fff;font:600 14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 10px 30px rgba(47,91,235,.35);cursor:pointer";
    b.onclick = () => { b.remove(); chrome.runtime.sendMessage({ type: "fill" }); };
    document.body.appendChild(b);
  };
  add();
  new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: true });
})();
