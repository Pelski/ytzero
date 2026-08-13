import { expect, test } from "bun:test";
import { profileTranscriptLanguage, rememberProfileTranscriptLanguage } from "./transcriptLanguagePreference";

const originalStorage = globalThis.sessionStorage;
function withStorage(run: () => void): void {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try { run(); }
  finally { Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: originalStorage }); }
}

test("remembers an available transcript language per profile", () => {
  withStorage(() => {
    rememberProfileTranscriptLanguage(1, "pl");
    rememberProfileTranscriptLanguage(2, "de");
    expect(profileTranscriptLanguage(1, ["en", "pl"])).toBe("pl");
    expect(profileTranscriptLanguage(2, ["en", "de"])).toBe("de");
  });
});

test("ignores a remembered language unavailable for the current video", () => {
  withStorage(() => {
    rememberProfileTranscriptLanguage(1, "pl");
    expect(profileTranscriptLanguage(1, ["en", "de"])).toBe(null);
    expect(profileTranscriptLanguage(null, ["pl"])).toBe(null);
  });
});
