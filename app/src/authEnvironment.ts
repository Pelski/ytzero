type Environment = Record<string, string | undefined>;
const passwordHashByEnvironment = new WeakMap<Environment, Promise<string>>();

export function environmentAuthMethod(environment: Environment = process.env): "shared" | null {
  return environment.YTZERO_AUTH_METHOD === "shared" ? "shared" : null;
}

export function environmentAuthPasswordConfigured(environment: Environment = process.env): boolean {
  return Boolean(environment.YTZERO_AUTH_PASSWORD);
}

export async function verifyEnvironmentAuthPassword(candidate: string, environment: Environment = process.env): Promise<boolean> {
  const expected = environment.YTZERO_AUTH_PASSWORD;
  if (!expected) return false;
  let expectedHash = passwordHashByEnvironment.get(environment);
  if (!expectedHash) {
    expectedHash = Bun.password.hash(expected, { algorithm: "argon2id" });
    passwordHashByEnvironment.set(environment, expectedHash);
  }
  return Bun.password.verify(candidate, await expectedHash);
}
