const navigationPending = new Promise<never>(() => {});

let authenticationNavigationStarted = false;
let authenticationProbe: Promise<void> | null = null;
let lastAuthenticationProbeAt = 0;

function requestPath(input: RequestInfo | URL): string {
  const value = input instanceof Request ? input.url : String(input);
  return new URL(value, "http://local").pathname;
}

export function isAuthenticationRedirect(response: Pick<Response, "type">): boolean {
  return response.type === "opaqueredirect";
}

export function isExpiredApiSession(response: Pick<Response, "type" | "status">, input: RequestInfo | URL): boolean {
  if (isAuthenticationRedirect(response)) return true;
  return response.status === 401 && !requestPath(input).startsWith("/api/auth/");
}

export function shouldNavigateForAuthentication(
  response: Pick<Response, "type" | "status">,
  input: RequestInfo | URL,
  suppressAuthenticationNavigation = false,
): boolean {
  return !suppressAuthenticationNavigation && isExpiredApiSession(response, input);
}

function beginAuthenticationNavigation() {
  if (authenticationNavigationStarted) return;
  authenticationNavigationStarted = true;

  // Navigate the document, not the API request. The forward-auth proxy can
  // then send the user to its login page with the actual app view as `rd`.
  window.location.replace(window.location.href);
}

/** Fetch an application API resource without following an auth-proxy redirect. */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { suppressAuthenticationNavigation?: boolean },
): Promise<Response> {
  if (authenticationNavigationStarted) return navigationPending;

  const response = await fetch(input, { ...init, redirect: "manual" });
  if (!shouldNavigateForAuthentication(response, input, options?.suppressAuthenticationNavigation)) return response;

  beginAuthenticationNavigation();
  return navigationPending;
}

/**
 * EventSource hides redirect details. On an SSE error, probe a public API
 * endpoint with manual redirect handling. Network failures are intentionally
 * ignored so an offline server never creates a reload loop.
 */
export function probeApiAuthentication(): Promise<void> {
  if (authenticationNavigationStarted) return navigationPending;
  if (authenticationProbe) return authenticationProbe;

  const now = Date.now();
  if (now - lastAuthenticationProbeAt < 5_000) return Promise.resolve();
  lastAuthenticationProbeAt = now;

  authenticationProbe = fetch("/api/auth/status", { cache: "no-store", redirect: "manual" })
    .then((response) => {
      if (isAuthenticationRedirect(response)) beginAuthenticationNavigation();
    })
    .catch(() => {})
    .finally(() => { authenticationProbe = null; });
  return authenticationProbe;
}
