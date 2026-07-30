import { describe, expect, test } from "bun:test";
import { generateTemporaryPassword, profileUsername, uniqueProfileUsername } from "./profileCredentials";

describe("per-profile credentials", () => {
  test("derives a login from the profile name", () => {
    expect(profileUsername("  Jan Kowalski!  ")).toBe("Jan_Kowalski");
    expect(profileUsername("Żółty  Profil #2")).toBe("Żółty_Profil_2");
    expect(profileUsername("!!!", 7)).toBe("profile_7");
  });

  test("adds deterministic suffixes for duplicate names", () => {
    const used = new Set<string>();
    expect(uniqueProfileUsername("Dom", used, 1)).toBe("Dom");
    expect(uniqueProfileUsername("dom", used, 2)).toBe("dom_2");
    expect(uniqueProfileUsername("Dom!", used, 3)).toBe("Dom_3");
  });

  test("creates a copyable high-entropy temporary password", () => {
    const first = generateTemporaryPassword();
    const second = generateTemporaryPassword();
    expect(first).toHaveLength(20);
    expect(second).toHaveLength(20);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9]+$/);
  });
});
