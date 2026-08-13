interface ClientCrypto {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint32Array) => Uint32Array;
}

/** Browser-local correlation ID that also works on non-secure LAN origins. */
export function createClientId(source: ClientCrypto | null | undefined = globalThis.crypto): string {
  return source?.randomUUID?.()
    ?? source?.getRandomValues?.(new Uint32Array(2)).join("-")
    ?? `${Date.now()}-${Math.random()}`;
}
