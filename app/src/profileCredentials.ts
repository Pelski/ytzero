const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function profileUsername(name: unknown, fallbackId?: number): string {
  const normalized = String(name ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || `profile_${fallbackId ?? 1}`;
}

export function uniqueProfileUsername(name: unknown, used: Set<string>, fallbackId?: number): string {
  const base = profileUsername(name, fallbackId);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${base.slice(0, Math.max(1, 80 - String(suffix).length - 1))}_${suffix++}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function generateTemporaryPassword(length = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.max(16, length)));
  return Array.from(bytes, (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]).join("").slice(0, Math.max(16, length));
}
