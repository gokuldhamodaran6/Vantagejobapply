const APP = "https://vantagejobapply.onrender.com";
const el = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

chrome.runtime.sendMessage({ type: "status" }, async (s) => {
  if (!s?.connected) {
    el.innerHTML = `<p><b>Connect your Vantage account</b></p>
      <p class="muted">Vantage fills job applications with your profile, saved answers and a resume tailored to each job. You check every page, then press Submit — or ask Vantage to press it for you.</p>
      <a class="btn" id="c" href="${APP}/app/extension?connect=1" target="_blank">Connect to Vantage</a>`;
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onPage = /^https:\/\//.test(tab?.url || "");
  el.innerHTML = `<p class="muted">Signed in as <b>${esc(s.me.name || s.me.email)}</b></p>
    ${onPage ? `<button class="btn" id="fill">Fill this application</button>` : `<p class="muted">Open a job application page, then click here.</p>`}
    <ol class="muted"><li>Vantage reads the job and writes a tailored resume and cover letter.</li><li>It fills every question it knows; you answer anything new once.</li><li>You check it and press Submit (or “Submit it for me”) — it's added to your Applications automatically.</li></ol>
    <a class="btn g" href="${APP}/app/applications" target="_blank">Open my applications</a>
    <p class="muted" style="margin-top:12px"><a href="#" id="out">Disconnect</a></p>`;
  document.getElementById("fill")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "fill", tabId: tab.id });
    window.close();
  });
  document.getElementById("out").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: "disconnect" }, () => location.reload());
  });
});
