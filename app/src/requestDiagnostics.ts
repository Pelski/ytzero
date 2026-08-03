import { log } from "./logger";

/** Keep bearer invitation room ids out of request diagnostics. */
export function diagnosticRequestPath(path: string): string {
  return path.replace(/^(\/api)?(\/social\/watch-parties)\/[^/]+(?=\/|$)/, "$1$2/:id");
}

/** Install the shared error and slow-request diagnostics before auth middleware. */
export function registerRequestDiagnostics(api: any): void {
  api.onError((err: Error, c: any) => {
    log.error("api.unhandled_error", { path: diagnosticRequestPath(c.req.path), method: c.req.method, error: err.message });
    return c.json({ error: err.message }, 500);
  });

  // Log only failed or unusually slow requests. Query strings, request bodies,
  // headers and cookies are intentionally excluded from diagnostic logs.
  api.use("*", async (c: any, next: () => Promise<void>) => {
    const startedAt = Date.now();
    await next();
    const ms = Date.now() - startedAt;
    const meta = {
      method: c.req.method,
      path: diagnosticRequestPath(c.req.path),
      status: c.res.status,
      ms,
      userId: c.get("userId") || undefined,
    };
    if (c.res.status >= 500) log.error("api.request_failed", meta);
    else if (c.res.status >= 400) log.warn("api.request_failed", meta);
    else if (ms >= 2_000) log.warn("api.request_slow", meta);
  });
}
