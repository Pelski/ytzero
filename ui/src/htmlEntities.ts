const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  ndash: "–",
  nbsp: "\u00a0",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
};

export function decodeHtmlEntities(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 2; pass++) {
    const next = decoded.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (entity, decimal, hex, named) => {
      if (decimal || hex) {
        const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
        try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity; }
        catch { return entity; }
      }
      return NAMED_ENTITIES[String(named).toLowerCase()] ?? entity;
    });
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

const TITLE_FIELDS = new Set(["title", "channel_title", "channelTitle"]);

/** Normalize title fields in API payloads, including records already stored in SQLite. */
export function decodeApiTitles<T>(value: T): T {
  if (Array.isArray(value)) return value.map(decodeApiTitles) as T;
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (TITLE_FIELDS.has(key) && typeof child === "string") record[key] = decodeHtmlEntities(child);
    else if (child && typeof child === "object") record[key] = decodeApiTitles(child);
  }
  return value;
}
