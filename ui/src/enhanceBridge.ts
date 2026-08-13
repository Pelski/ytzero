import type { AppSettings } from "./api";
import { SUBTITLE_LANGUAGES } from "./subtitleLanguages";

export const ENHANCE_BRIDGE_VERSION = 1;
export const ENHANCE_CONFIGURATION_ELEMENT_ID = "ytzero-enhance-configuration";
export const ENHANCE_CONFIGURATION_FORMAT = "ytzero.enhance-configuration";
export const ENHANCE_EXTENSION_STATUS = {
  elementId: "ytzero-enhance-extension-status",
  attribute: "data-extension-status",
  activeValue: "active",
} as const;

export const ENHANCE_BRIDGE_EVENTS = {
  ready: "ytzero:enhance:ready",
  context: "ytzero:enhance:context",
  screenshotRequest: "ytzero:enhance:screenshot-request",
  screenshotResult: "ytzero:enhance:screenshot-result",
  playerEvent: "ytzero:enhance:player-event",
  playerCommand: "ytzero:enhance:player-command",
} as const;

export const ENHANCE_CONTENT_TYPES = ["default", "short", "livestream"] as const;
export type EnhanceContentType = typeof ENHANCE_CONTENT_TYPES[number];

export function resolveEnhanceContentType(video: {
  live_status: "none" | "upcoming" | "live" | "was_live";
  is_short: number | null;
}): EnhanceContentType {
  if (video.live_status === "live" || video.live_status === "upcoming") return "livestream";
  if (video.is_short === 1) return "short";
  return "default";
}

export interface EnhancePlayerState {
  paused: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  captionSize: number;
  captionsEnabled: boolean;
  fullscreen: boolean;
  pictureInPicture: boolean;
}

export interface EnhancePlayerShortcut {
  key: string;
  code: string;
  action: string;
  repeat: boolean;
  /** Numeric result for actions such as playback-rate changes. */
  value?: number;
  modifiers: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
}

export interface EnhancePlayerCommandResult {
  requestId: string;
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export type EnhancePlayerCommand =
  | "play" | "pause" | "toggle-play"
  | "seek-by" | "seek-to"
  | "set-volume" | "set-muted" | "toggle-muted"
  | "set-playback-rate"
  | "set-captions" | "toggle-captions" | "set-caption-size"
  | "capture-frame"
  | "toggle-fullscreen" | "enter-fullscreen" | "exit-fullscreen" | "toggle-picture-in-picture"
  | "request-state";

export type EnhancePlayerEvent = {
  version: 1;
  videoId: string;
} & (
  | { type: "ready" | "state"; payload: { state: EnhancePlayerState } }
  | { type: "shortcut"; payload: EnhancePlayerShortcut }
  | { type: "captions-toggle-request" | "ended"; payload: Record<string, unknown> }
  | { type: "command-result"; payload: EnhancePlayerCommandResult }
);

const PLAYER_EVENT_TYPES = new Set(["ready", "state", "shortcut", "captions-toggle-request", "ended", "command-result"]);
const PLAYER_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function eventRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function playerState(value: unknown): EnhancePlayerState | null {
  const state = eventRecord(value);
  if (!state) return null;
  const booleans = ["paused", "ended", "muted", "captionsEnabled", "fullscreen", "pictureInPicture"] as const;
  const numbers = ["currentTime", "duration", "volume", "playbackRate", "captionSize"] as const;
  if (booleans.some((key) => typeof state[key] !== "boolean")) return null;
  if (numbers.some((key) => typeof state[key] !== "number" || !Number.isFinite(state[key]))) return null;
  return state as unknown as EnhancePlayerState;
}

export function parseEnhancePlayerEvent(event: Event): EnhancePlayerEvent | null {
  const message = parseEnhanceEventDetail<Record<string, unknown>>(event);
  if (!message || message.version !== ENHANCE_BRIDGE_VERSION || typeof message.videoId !== "string" || !PLAYER_VIDEO_ID.test(message.videoId)) return null;
  if (typeof message.type !== "string" || !PLAYER_EVENT_TYPES.has(message.type)) return null;
  const payload = eventRecord(message.payload);
  if (!payload) return null;
  if (message.type === "ready" || message.type === "state") {
    const state = playerState(payload.state);
    return state ? { version: 1, videoId: message.videoId, type: message.type, payload: { state } } : null;
  }
  if (message.type === "shortcut") {
    const modifiers = eventRecord(payload.modifiers);
    if (typeof payload.key !== "string" || typeof payload.code !== "string" || typeof payload.action !== "string" || typeof payload.repeat !== "boolean" || !modifiers) return null;
    if (["alt", "ctrl", "meta", "shift"].some((key) => typeof modifiers[key] !== "boolean")) return null;
    if (payload.value !== undefined && (typeof payload.value !== "number" || !Number.isFinite(payload.value))) return null;
    return {
      version: 1,
      videoId: message.videoId,
      type: "shortcut",
      payload: {
        key: payload.key,
        code: payload.code,
        action: payload.action,
        repeat: payload.repeat,
        ...(typeof payload.value === "number" ? { value: payload.value } : {}),
        modifiers: modifiers as EnhancePlayerShortcut["modifiers"],
      },
    };
  }
  if (message.type === "command-result") {
    if (typeof payload.requestId !== "string" || typeof payload.ok !== "boolean") return null;
    return { version: 1, videoId: message.videoId, type: "command-result", payload: payload as EnhancePlayerCommandResult };
  }
  return { version: 1, videoId: message.videoId, type: message.type, payload } as EnhancePlayerEvent;
}

type PendingPlayerCommand = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: number;
};

const pendingPlayerCommands = new Map<string, PendingPlayerCommand>();
let playerCommandListenerInstalled = false;

function installPlayerCommandResultListener() {
  if (playerCommandListenerInstalled || typeof document === "undefined") return;
  playerCommandListenerInstalled = true;
  document.addEventListener(ENHANCE_BRIDGE_EVENTS.playerEvent, (event) => {
    const message = parseEnhancePlayerEvent(event);
    if (!message || message.type !== "command-result") return;
    const pending = pendingPlayerCommands.get(message.payload.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pendingPlayerCommands.delete(message.payload.requestId);
    if (message.payload.ok) pending.resolve(message.payload);
    else pending.reject(new Error(message.payload.error || "Player command failed"));
  });
}

export function sendPlayerCommand(
  videoId: string,
  command: EnhancePlayerCommand,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  installPlayerCommandResultListener();
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingPlayerCommands.delete(requestId);
      reject(new Error("Player command timed out"));
    }, 5_000);
    pendingPlayerCommands.set(requestId, { resolve, reject, timeout });
    const claimed = !document.dispatchEvent(new CustomEvent(ENHANCE_BRIDGE_EVENTS.playerCommand, {
      detail: JSON.stringify({ version: ENHANCE_BRIDGE_VERSION, requestId, videoId, command, payload }),
      cancelable: true,
    }));
    if (!claimed) {
      window.clearTimeout(timeout);
      pendingPlayerCommands.delete(requestId);
      reject(new Error("YT Zero Enhance is not available"));
    }
  });
}

function booleanSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
}

function numberSetting(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function sponsorBlockCategories(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : ["sponsor"];
  } catch {
    return ["sponsor"];
  }
}

export function createEnhanceConfiguration(settings: Partial<AppSettings>) {
  const screenshotFormat = settings.player_screenshot_format;
  return {
    format: ENHANCE_CONFIGURATION_FORMAT,
    version: ENHANCE_BRIDGE_VERSION,
    enabled: booleanSetting(settings.enhance_enabled, true),
    player: {
      replaceControls: booleanSetting(settings.enhance_replace_controls, true),
      language: settings.player_hl || "en",
      preferredQuality: settings.player_quality || "auto",
      defaultPlaybackRate: numberSetting(settings.player_speed, 1, 0.25, 4),
      keyboardSeekSeconds: numberSetting(settings.keyboard_seek_seconds, 5, 1, 120),
      frameStepFps: numberSetting(settings.enhance_frame_fps, 30, 1, 120),
      autoFullscreenLandscape: booleanSetting(settings.auto_fullscreen_landscape, false),
      captions: {
        enabledByDefault: booleanSetting(settings.player_cc, false),
        language: settings.player_cc_lang || settings.player_hl || "en",
        availableLanguages: SUBTITLE_LANGUAGES.map(({ code, label }) => ({ code, label })),
        style: {
          fontSizePx: numberSetting(settings.player_sub_size, 19, 12, 48),
          color: settings.player_sub_color || "#ffffff",
          backgroundOpacityPercent: numberSetting(settings.player_sub_bg, 75, 0, 100),
        },
      },
    },
    screenshots: {
      format: screenshotFormat === "png" || screenshotFormat === "webp" ? screenshotFormat : "jpeg",
      jpegQuality: numberSetting(settings.player_screenshot_quality, 0.92, 0.1, 1),
      filenameTemplate: settings.player_screenshot_filename || "{channel}_{title}_{timestamp_ms}",
      templateFields: ["channel", "title", "video_id", "timestamp", "timestamp_ms"],
    },
    sponsorBlock: {
      enabled: booleanSetting(settings.sponsorblock_enabled, false),
      categories: sponsorBlockCategories(settings.sponsorblock_categories),
    },
    bridge: {
      version: ENHANCE_BRIDGE_VERSION,
      detailEncoding: "json-string",
      events: ENHANCE_BRIDGE_EVENTS,
      extensionStatus: ENHANCE_EXTENSION_STATUS,
    },
  } as const;
}

export function serializeEnhanceConfiguration(settings: Partial<AppSettings>): string {
  // Keep the JSON safe if this client-rendered node is ever server-rendered.
  return JSON.stringify(createEnhanceConfiguration(settings)).replace(/</g, "\\u003c");
}

/** CustomEvent detail stays JSON so it crosses extension/page JS worlds. */
export function dispatchEnhanceEvent(
  name: string,
  payload: unknown,
  options: { cancelable?: boolean } = {},
): boolean {
  return document.dispatchEvent(new CustomEvent(name, {
    detail: JSON.stringify(payload),
    cancelable: options.cancelable,
  }));
}

export function parseEnhanceEventDetail<T>(event: Event): T | null {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return null;
  try { return JSON.parse(event.detail) as T; }
  catch { return null; }
}
