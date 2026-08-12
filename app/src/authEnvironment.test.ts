import { describe, expect, test } from "bun:test";
import {
  environmentAuthMethod,
  environmentAuthPasswordConfigured,
  verifyEnvironmentAuthPassword,
} from "./authEnvironment";

describe("environment authentication policy", () => {
  test("forces only the supported shared-password method", () => {
    expect(environmentAuthMethod({ YTZERO_AUTH_METHOD: "shared" })).toBe("shared");
    expect(environmentAuthMethod({})).toBeNull();
    expect(environmentAuthMethod({ YTZERO_AUTH_METHOD: "none" })).toBeNull();
  });

  test("requires a non-empty environment password and compares it exactly", () => {
    const environment = { YTZERO_AUTH_PASSWORD: "correct horse battery staple" };
    expect(environmentAuthPasswordConfigured(environment)).toBe(true);
    expect(verifyEnvironmentAuthPassword("correct horse battery staple", environment)).toBe(true);
    expect(verifyEnvironmentAuthPassword("Correct horse battery staple", environment)).toBe(false);
    expect(environmentAuthPasswordConfigured({ YTZERO_AUTH_PASSWORD: "" })).toBe(false);
    expect(verifyEnvironmentAuthPassword("", { YTZERO_AUTH_PASSWORD: "" })).toBe(false);
  });
});
