import { apiFetch } from "./apiTransport";
import { decodeApiTitles } from "./htmlEntities";
import { shareInFlight } from "./shareInFlight";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly detail?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function http<T>(path: string, init?: RequestInit, options?: { suppressAuthenticationNavigation?: boolean }): Promise<T> {
  const res = await apiFetch(`/api${path}`, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  }, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as any).error ?? `HTTP ${res.status}`, res.status, (body as any).code, (body as any).detail);
  }
  return decodeApiTitles(await res.json()) as T;
}

export function sharedGet<T>(key: string, path: string, options?: { suppressAuthenticationNavigation?: boolean }): Promise<T> {
  return shareInFlight(key, () => http<T>(path, undefined, options));
}
