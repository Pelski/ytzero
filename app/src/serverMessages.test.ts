import { describe, expect, test } from "bun:test";
import { DOWNLOADS_SETTINGS } from "./downloadSettings";
import { DISCOVERY_SETTINGS, NOTIFICATION_PROVIDER_SETTINGS, PLUGIN_TEXT, SOCIAL_SETTINGS, TUBE_ARCHIVIST_SETTINGS } from "./pluginCatalog";
import { SERVER_MESSAGES, type BaseLocalizedText, type ServerCatalogueLanguage } from "./serverMessages";

function collectLocalizedText(value: unknown, messages = new Map<string, BaseLocalizedText>()): Map<string, BaseLocalizedText> {
  if (!value || typeof value !== "object") return messages;
  const candidate = value as Partial<BaseLocalizedText>;
  if (typeof candidate.en === "string" && typeof candidate.pl === "string" && typeof candidate.de === "string") {
    messages.set(candidate.en, candidate as BaseLocalizedText);
    return messages;
  }
  for (const child of Object.values(value)) collectLocalizedText(child, messages);
  return messages;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("server-owned localization catalogues", () => {
  test("cover every download and plugin string in every additional UI language", () => {
    const source = collectLocalizedText([
      DOWNLOADS_SETTINGS,
      SOCIAL_SETTINGS,
      TUBE_ARCHIVIST_SETTINGS,
      DISCOVERY_SETTINGS,
      NOTIFICATION_PROVIDER_SETTINGS,
      PLUGIN_TEXT,
    ]);

    for (const [language, catalogue] of Object.entries(SERVER_MESSAGES) as [ServerCatalogueLanguage, Record<string, string>][]) {
      for (const english of source.keys()) {
        const translated = catalogue[english];
        expect(translated, `${language}: ${english}`).toBeString();
        expect(translated.trim().length, `${language}: ${english}`).toBeGreaterThan(0);
        expect(placeholders(translated), `${language}: ${english}`).toEqual(placeholders(english));
      }
    }
  });
});
