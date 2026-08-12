import { createHash, timingSafeEqual } from "node:crypto";

type Environment = Record<string, string | undefined>;

export function environmentAuthMethod(environment: Environment = process.env): "shared" | null {
  return environment.YTZERO_AUTH_METHOD === "shared" ? "shared" : null;
}

export function environmentAuthPasswordConfigured(environment: Environment = process.env): boolean {
  return Boolean(environment.YTZERO_AUTH_PASSWORD);
}

export function verifyEnvironmentAuthPassword(candidate: string, environment: Environment = process.env): boolean {
  const expected = environment.YTZERO_AUTH_PASSWORD;
  if (!expected) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}
