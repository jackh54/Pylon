/**
 * Recover from a redeploy while a tab is open.
 *
 * A running page keeps referencing the JavaScript chunks of the build it loaded. After a deploy
 * those files are gone, so the next lazy import or background refresh fails and React Router shows
 * the error boundary. Reloading the document picks up the new build. The timestamp guard makes sure
 * a genuinely broken page can never reload in a loop.
 */
const KEY = "pylon:last-reload";
const MIN_GAP_MS = 30_000;

// Deliberately narrow: only failures that mean "the files this page was built against are gone".
// A plain network error is not included, so someone who is briefly offline is never reloaded.
const STALE_PATTERNS = [
  /dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk \d+ failed/i,
  /error loading dynamically imported module/i,
  /Unable to decode turbo-stream/i,
];

export function looksLikeStaleBuild(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === "string" ? error : "";
  return !!message && STALE_PATTERNS.some((p) => p.test(message));
}

/** Reload unless we already did so moments ago. Returns true when a reload was started. */
export function reloadOnce(): boolean {
  if (typeof window === "undefined") return false;
  if (navigator.onLine === false) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < MIN_GAP_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // private mode or blocked storage: reloading once is still better than a dead page
  }
  window.location.reload();
  return true;
}

/** Listen for chunk-loading failures anywhere in the app (Vite preload, dynamic import, fetch). */
export function watchForStaleBuild(): () => void {
  if (typeof window === "undefined") return () => {};
  const onPreloadError = () => reloadOnce();
  const onRejection = (e: PromiseRejectionEvent) => { if (looksLikeStaleBuild(e.reason)) reloadOnce(); };
  window.addEventListener("vite:preloadError", onPreloadError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("vite:preloadError", onPreloadError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
