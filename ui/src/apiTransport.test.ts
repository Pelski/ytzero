import { describe, expect, test } from "bun:test";
import { isAuthenticationRedirect, isExpiredApiSession, shouldNavigateForAuthentication } from "./apiTransport";

describe("API authentication redirect detection", () => {
  test("recognizes a manual cross-origin redirect from a forward-auth proxy", () => {
    expect(isAuthenticationRedirect({ type: "opaqueredirect" })).toBe(true);
    expect(isExpiredApiSession({ type: "opaqueredirect", status: 0 }, "/api/channels/top")).toBe(true);
  });

  test("recognizes an expired internal session without hijacking login failures", () => {
    expect(isExpiredApiSession({ type: "basic", status: 401 }, "/api/feed")).toBe(true);
    expect(isExpiredApiSession({ type: "basic", status: 401 }, "/api/auth/password/login")).toBe(false);
  });

  test("leaves ordinary API errors alone", () => {
    expect(isExpiredApiSession({ type: "basic", status: 403 }, "/api/settings")).toBe(false);
    expect(isExpiredApiSession({ type: "basic", status: 500 }, "/api/feed")).toBe(false);
  });

  test("does not reload during the unauthenticated localization bootstrap", () => {
    const unauthorized = { type: "basic" as ResponseType, status: 401 };
    expect(shouldNavigateForAuthentication(unauthorized, "/api/settings")).toBe(true);
    expect(shouldNavigateForAuthentication(unauthorized, "/api/settings", true)).toBe(false);
  });
});
