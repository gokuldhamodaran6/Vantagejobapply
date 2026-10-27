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
    ${onPage ? `<button class="btn" id="fill">Fill it here, in this tab</button><p class="muted" style="margin:6px 0 0">Fills every page in your Chrome. You press Submit.</p>
    <button class="btn g" id="queue">Send to my Vantage list</button><p class="muted" style="margin:6px 0 0" id="qmsg">Goes to Up next — your agent applies at its next run, or you finish it in Vantage.</p>` : `<p class="muted">Open a job application page, then click here.</p>`}
    <ol class="muted"><li>Vantage reads the job and writes a tailored resume and cover letter.</li><li>It fills every question it knows; you answer anything new once.</li><li>You check it and press Submit (or “Submit it for me”) — it's added to your Applications automatically.</li></ol>
    <a class="btn g" href="${APP}/app/applications" target="_blank">Open my applications</a>
    <p class="muted" style="margin-top:12px"><a href="#" id="out">Disconnect</a></p>`;
  document.getElementById("fill")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "fill", tabId: tab.id });
    window.close();
  });
  document.getElementById("queue")?.addEventListener("click", (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = "Sending… (tailoring your resume)";
    chrome.runtime.sendMessage({ type: "queue", tabId: tab.id }, (r) => {
      const m = document.getElementById("qmsg");
      if (r?.queued) {
        b.textContent = "✓ In your Vantage list";
        m.innerHTML = r.waiting ? `${esc(r.job.company)} is saved. Today's limit is reached, so it waits in Your agent for your OK.` : `${esc(r.job.title)} at ${esc(r.job.company)} is in Up next. <a href="${APP}/app/agent" target="_blank">Open Your agent</a>`;
      } else {
        b.disabled = false;
        b.textContent = "Send to my Vantage list";
        m.textContent = r?.error || "Couldn't send it. Try again.";
        m.style.color = "#b42318";
      }
    });
  });
  document.getElementById("out").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ type: "disconnect" }, () => location.reload());
  });
});
