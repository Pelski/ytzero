import { useSyncExternalStore } from "react";
import { emit, subscribe } from "./events";

export const VIDEO_CARD_ACTION_IDS = ["schedule", "playlist", "download", "archive", "watched", "restore", "remove"] as const;
export type VideoCardActionId = (typeof VIDEO_CARD_ACTION_IDS)[number];
export type VideoCardActionConfig = { version: 1; actions: Array<{ id: VideoCardActionId; hidden: boolean }> };
export const LOCKED_VIDEO_CARD_ACTION_IDS = new Set<VideoCardActionId>(["schedule", "restore", "remove"]);
export const DEFAULT_VIDEO_CARD_ACTION_CONFIG: VideoCardActionConfig = { version: 1, actions: VIDEO_CARD_ACTION_IDS.map((id) => ({ id, hidden: id === "playlist" || id === "download" })) };
const defaultConfig = () => structuredClone(DEFAULT_VIDEO_CARD_ACTION_CONFIG);

export function parseVideoCardActionConfig(value: unknown): VideoCardActionConfig {
  if (typeof value === "string") {
    try { return parseVideoCardActionConfig(JSON.parse(value)); } catch { return defaultConfig(); }
  }
  if (!value || typeof value !== "object") return defaultConfig();
  const config = value as { version?: unknown; actions?: unknown };
  if (config.version !== 1 || !Array.isArray(config.actions)) return defaultConfig();
  const seen = new Set<string>();
  const actions: VideoCardActionConfig["actions"] = [];
  for (const entry of config.actions) {
    if (!entry || typeof entry !== "object") return defaultConfig();
    const { id, hidden } = entry as { id?: unknown; hidden?: unknown };
    if (typeof id !== "string" || !(VIDEO_CARD_ACTION_IDS as readonly string[]).includes(id) || typeof hidden !== "boolean" || seen.has(id)) return defaultConfig();
    seen.add(id);
    actions.push({ id: id as VideoCardActionId, hidden: LOCKED_VIDEO_CARD_ACTION_IDS.has(id as VideoCardActionId) ? false : hidden });
  }
  for (const action of DEFAULT_VIDEO_CARD_ACTION_CONFIG.actions) if (!seen.has(action.id)) actions.push({ ...action });
  return { version: 1, actions: [actions.find((action) => action.id === "schedule")!, ...actions.filter((action) => action.id !== "schedule")] };
}

export function serializeVideoCardActionConfig(value: unknown): string { return JSON.stringify(parseVideoCardActionConfig(value)); }
const CHANGE_EVENT = "card-actions";
export function applyVideoCardActionConfig(value: unknown) {
  const serialized = serializeVideoCardActionConfig(value);
  if (document.documentElement.dataset.videoCardActionButtons === serialized) return;
  document.documentElement.dataset.videoCardActionButtons = serialized;
  emit(CHANGE_EVENT);
}
function readValue(): string { return document.documentElement.dataset.videoCardActionButtons ?? serializeVideoCardActionConfig(null); }
export function useAppliedVideoCardActionConfig(): VideoCardActionConfig {
  const value = useSyncExternalStore(
    (notify) => subscribe(CHANGE_EVENT, notify),
    readValue,
    () => serializeVideoCardActionConfig(null),
  );
  return parseVideoCardActionConfig(value);
}
