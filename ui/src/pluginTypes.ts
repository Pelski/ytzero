import type { SettingDefinition, SettingValue } from "./apiTypes";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  route?: string;
  icon: string;
  permissions: string[];
  enabled: boolean;
}

export type PluginSettingValue = SettingValue;
export type PluginSettingDef = SettingDefinition & { scope?: "user" | "global"; adminOnly?: boolean };

export interface PluginTermState {
  lastTerms: string[];
  blockedTerms: string[];
}

export interface PluginSettingsResponse {
  definitions: PluginSettingDef[];
  settings: Record<string, PluginSettingValue>;
  terms?: PluginTermState;
}

export interface TubeArchivistStatus {
  baseUrl: string;
  tokenConfigured: boolean;
  configured: boolean;
  running: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  itemCount: number;
}
