const requests = new Map<string, Promise<unknown>>();

/** Share only a currently running request. Completed responses are never cached. */
export function shareInFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const current = requests.get(key) as Promise<T> | undefined;
  if (current) return current;

  const request = load().finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
  requests.set(key, request);
  return request;
}
