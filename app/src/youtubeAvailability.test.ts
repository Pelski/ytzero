import { describe, expect, test } from "bun:test";
import { isPrivateVideoError, PrivateVideoError } from "./youtube";

describe("private video errors", () => {
  test("recognizes typed and YouTube player errors", () => {
    expect(isPrivateVideoError(new PrivateVideoError())).toBe(true);
    expect(isPrivateVideoError(new Error("videoDetails missing (LOGIN_REQUIRED: Private video)"))).toBe(true);
  });

  test("does not classify unrelated login errors as private", () => {
    expect(isPrivateVideoError(new Error("LOGIN_REQUIRED: Sign in to confirm you're not a bot"))).toBe(false);
  });
});
