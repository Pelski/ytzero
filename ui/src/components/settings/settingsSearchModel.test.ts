import { describe, expect, test } from "bun:test";
import { filterSettingsSearchEntries, normalizeSettingsSearch, type SettingsSearchEntry } from "./settingsSearchModel";

const entries: SettingsSearchEntry[] = [
  { id: "sponsor", view: "display:privacy", label: "SponsorBlock", description: "Pomijaj sponsorów", section: "Prywatność" },
  { id: "language", view: "display:appearance", label: "Język interfejsu", description: "Polski, English, Deutsch", section: "Wygląd" },
  { id: "playback", view: "display:playback", label: "Odtwarzanie", section: "Wygląd i odtwarzanie" },
];

describe("settings search", () => {
  test("matches without case or Polish diacritics", () => {
    expect(normalizeSettingsSearch("  JĘZYK  ")).toBe("jezyk");
    expect(JSON.stringify(filterSettingsSearchEntries(entries, "jezyk").map((entry) => entry.id))).toBe('["language"]');
  });

  test("searches descriptions and ranks label matches first", () => {
    expect(JSON.stringify(filterSettingsSearchEntries(entries, "odtwarzanie").map((entry) => entry.id))).toBe('["playback"]');
    expect(JSON.stringify(filterSettingsSearchEntries(entries, "deutsch").map((entry) => entry.id))).toBe('["language"]');
  });
});
