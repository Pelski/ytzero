import { getUserSetting, setUserSetting } from "./db";

export const TAG_FILTER_VISIBILITY_SETTING = "hidden_filter_tag_uuids";

export function parseHiddenFilterTagUuids(value: unknown): Set<string> {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function hiddenFilterTagUuids(userId: number): Set<string> {
  return parseHiddenFilterTagUuids(getUserSetting(userId, TAG_FILTER_VISIBILITY_SETTING));
}

export function serializeHiddenFilterTagUuids(uuids: Iterable<string>): string {
  return JSON.stringify([...new Set(uuids)].sort());
}

export async function setTagHiddenFromFilters(userId: number, tagUuid: string, hidden: boolean): Promise<void> {
  const uuids = hiddenFilterTagUuids(userId);
  if (hidden) uuids.add(tagUuid);
  else uuids.delete(tagUuid);
  await setUserSetting(userId, TAG_FILTER_VISIBILITY_SETTING, serializeHiddenFilterTagUuids(uuids));
}
