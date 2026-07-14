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

/** Decode the HTML entities commonly returned by YouTube metadata endpoints. */
export function decodeHtmlEntities(value: string): string {
  let decoded = value;
  // Two passes also handle metadata that was escaped twice by an intermediary.
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
