/** Full page navigation — used after sign-in/out and external redirects so sessions reload cleanly. */
export function hardNavigate(url: string) {
  window.location.assign(url);
}
