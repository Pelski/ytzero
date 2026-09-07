/**
 * External delivery for everything that reaches the notification bell.
 *
 * The instance administrator picks one provider in the "External notifications"
 * plugin. Provider connection details and profile targets live with the other
 * notification settings, so the plugin surface remains a provider selector.
 * Delivery is best effort: a provider that
 * is down, slow, or misconfigured logs a warning and never blocks or fails the
 * in-app notification that triggered it.
 */

import { database } from "./database";
import { getSetting, setSetting } from "./db";
import { log } from "./logger";
import {
  buildDeliveryMessage,
  isNotificationProvider,
  parseDeliveryTargets,
  type DeliveryMessage,
  type NotificationProvider,
} from "./notificationDeliveryFormat";

export { NOTIFICATION_PROVIDERS, type NotificationProvider } from "./notificationDeliveryFormat";

const REQUEST_TIMEOUT_MS = 10_000;

export interface ExternalNotificationConfig {
  provider: NotificationProvider;
  /** Base URL of an Apprise API server, e.g. http://apprise:8000 */
  appriseServerUrl: string;
  /** Base URL of an ntfy server, e.g. https://ntfy.sh */
  ntfyServerUrl: string;
  /** Public address of this installation, used to build clickable links. */
  publicBaseUrl: string;
}

export interface NotificationDeliverySnapshot extends ExternalNotificationConfig {
  /** False when the administrator disabled the plugin entirely. */
  pluginEnabled: boolean;
  /** True when the selected provider has everything it needs instance-side. */
  providerConfigured: boolean;
  /** True when forwarded links can be made absolute. */
  publicBaseUrlConfigured: boolean;
  /** Whether this caller may edit instance-wide connection details. */
  canConfigureProvider: boolean;
  /** This profile forwards its notifications. */
  enabled: boolean;
  /** Raw target text as the profile typed it. */
  targets: string;
}

function settingValue(key: string, fallback = ""): string {
  return (getSetting(`plugin_notifications_${key}`) ?? "").trim() || fallback;
}

export function externalNotificationConfig(): ExternalNotificationConfig {
  const provider = settingValue("provider", "off");
  return {
    provider: isNotificationProvider(provider) ? provider : "off",
    appriseServerUrl: settingValue("apprise_server_url"),
    ntfyServerUrl: settingValue("ntfy_server_url", "https://ntfy.sh"),
    publicBaseUrl: settingValue("public_base_url"),
  };
}

export function providerConfigured(config: ExternalNotificationConfig): boolean {
  if (config.provider === "apprise") return config.appriseServerUrl.length > 0;
  if (config.provider === "ntfy") return config.ntfyServerUrl.length > 0;
  return config.provider === "webhook";
}

function normalizedHttpUrl(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > 2_000) throw new Error(`${label} is too long`);
  let url: URL;
  try { url = new URL(trimmed); }
  catch { throw new Error(`${label} must be an absolute HTTP or HTTPS URL`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${label} must be an absolute HTTP or HTTPS URL`);
  return trimmed.replace(/\/+$/, "");
}

// The plugin registry imports most of the application, so it is loaded lazily
// here to keep `notifications.ts` free of an import cycle.
async function deliveryPluginEnabled(): Promise<boolean> {
  try {
    const { pluginEnabled } = await import("./plugins");
    return pluginEnabled("notifications");
  } catch {
    return false;
  }
}

async function readDelivery(userId: number, provider: NotificationProvider): Promise<{ enabled: boolean; targets: string }> {
  const row = await database.prepare("SELECT enabled, targets FROM notification_delivery WHERE user_id=? AND provider=?")
    .get<{ enabled: number; targets: string }>(userId, provider);
  return { enabled: row?.enabled === 1, targets: row?.targets ?? "" };
}

export async function notificationDeliverySnapshot(userId: number, canConfigureProvider = false): Promise<NotificationDeliverySnapshot> {
  const config = externalNotificationConfig();
  const stored = config.provider === "off" ? { enabled: false, targets: "" } : await readDelivery(userId, config.provider);
  return {
    ...config,
    // A server URL can contain basic-auth credentials. Non-admin profiles only
    // need to know whether the provider is ready, not the connection secret.
    appriseServerUrl: canConfigureProvider ? config.appriseServerUrl : "",
    ntfyServerUrl: canConfigureProvider ? config.ntfyServerUrl : "",
    publicBaseUrl: canConfigureProvider ? config.publicBaseUrl : "",
    pluginEnabled: await deliveryPluginEnabled(),
    providerConfigured: providerConfigured(config),
    publicBaseUrlConfigured: config.publicBaseUrl.length > 0,
    canConfigureProvider,
    ...stored,
  };
}

export async function setNotificationDelivery(
  userId: number,
  input: { enabled?: boolean; targets?: string; appriseServerUrl?: string; ntfyServerUrl?: string; publicBaseUrl?: string },
  canConfigureProvider = false,
): Promise<NotificationDeliverySnapshot> {
  const hasProviderPatch = input.appriseServerUrl !== undefined || input.ntfyServerUrl !== undefined || input.publicBaseUrl !== undefined;
  if (hasProviderPatch && !canConfigureProvider) throw new Error("administrator setting");

  // Validate the full patch before writing any part of it.
  const providerPatch: Array<[string, string]> = [];
  if (input.appriseServerUrl !== undefined) providerPatch.push(["apprise_server_url", normalizedHttpUrl(input.appriseServerUrl, "Apprise server URL")]);
  if (input.ntfyServerUrl !== undefined) providerPatch.push(["ntfy_server_url", normalizedHttpUrl(input.ntfyServerUrl, "ntfy server URL")]);
  if (input.publicBaseUrl !== undefined) providerPatch.push(["public_base_url", normalizedHttpUrl(input.publicBaseUrl, "public address")]);
  for (const [key, value] of providerPatch) await setSetting(`plugin_notifications_${key}`, value);

  const config = externalNotificationConfig();
  if (config.provider !== "off") {
    const current = await readDelivery(userId, config.provider);
    const enabled = input.enabled ?? current.enabled;
    // Targets are stored as typed so a profile can keep an unused draft, but the
    // total length is bounded: these values reach an outbound HTTP request.
    const targets = (input.targets ?? current.targets).slice(0, 4_000);
    await database.prepare(`
      INSERT INTO notification_delivery(user_id,provider,enabled,targets)
      VALUES(?,?,?,?)
      ON CONFLICT(user_id,provider) DO UPDATE SET enabled=excluded.enabled, targets=excluded.targets
    `).run(userId, config.provider, enabled ? 1 : 0, targets);
  }
  return notificationDeliverySnapshot(userId, canConfigureProvider);
}

async function postJson(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
}

async function sendApprise(config: ExternalNotificationConfig, targets: string[], message: DeliveryMessage): Promise<void> {
  const base = config.appriseServerUrl.replace(/\/+$/, "");
  await postJson(`${base}/notify`, {
    urls: targets,
    title: message.title,
    body: message.url ? `${message.body}\n\n${message.url}` : message.body,
    type: "info",
    format: "text",
  });
}

async function sendWebhook(targets: string[], kind: string, message: DeliveryMessage): Promise<void> {
  const failures: string[] = [];
  for (const target of targets) {
    try {
      await postJson(target, { kind, title: message.title, body: message.body, url: message.url, tags: message.tags });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length === targets.length && failures.length > 0) throw new Error(failures[0]);
}

async function sendNtfy(config: ExternalNotificationConfig, targets: string[], message: DeliveryMessage): Promise<void> {
  const base = config.ntfyServerUrl.replace(/\/+$/, "");
  const failures: string[] = [];
  for (const topic of targets) {
    try {
      await postJson(base, {
        topic,
        title: message.title,
        message: message.body,
        tags: message.tags,
        ...(message.url ? { click: message.url } : {}),
      });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length === targets.length && failures.length > 0) throw new Error(failures[0]);
}

async function send(config: ExternalNotificationConfig, targets: string[], kind: string, message: DeliveryMessage): Promise<void> {
  if (config.provider === "apprise") return sendApprise(config, targets, message);
  if (config.provider === "webhook") return sendWebhook(targets, kind, message);
  if (config.provider === "ntfy") return sendNtfy(config, targets, message);
}

/**
 * Forward one stored notification to the profile's external targets. Callers do
 * not await this: a slow provider must not delay the feed refresh or the
 * transaction that created the notification.
 */
export async function deliverNotification(
  userId: number,
  kind: string,
  payload: Record<string, unknown>,
  target: string,
): Promise<boolean> {
  const config = externalNotificationConfig();
  if (config.provider === "off" || !providerConfigured(config)) return false;
  if (!await deliveryPluginEnabled()) return false;
  const stored = await readDelivery(userId, config.provider);
  if (!stored.enabled) return false;
  const targets = parseDeliveryTargets(stored.targets);
  if (targets.length === 0) return false;

  try {
    await send(config, targets, kind, buildDeliveryMessage(kind, payload, target, config.publicBaseUrl));
    return true;
  } catch (error) {
    log.warn("notification.delivery.failed", { userId, kind, provider: config.provider, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Fire-and-forget wrapper used by `createNotification`. */
export function deliverNotificationInBackground(userId: number, kind: string, payload: Record<string, unknown>, target: string): void {
  void deliverNotification(userId, kind, payload, target).catch(() => {});
}

/**
 * Send a sample notification so a profile can confirm its targets work. Unlike
 * real delivery this reports the provider error instead of swallowing it.
 */
export async function sendTestNotification(userId: number): Promise<void> {
  const config = externalNotificationConfig();
  if (!await deliveryPluginEnabled()) throw new Error("external notifications are disabled");
  if (config.provider === "off") throw new Error("no notification provider is selected");
  if (!providerConfigured(config)) throw new Error("the selected notification provider is not configured");
  const stored = await readDelivery(userId, config.provider);
  const targets = parseDeliveryTargets(stored.targets);
  if (targets.length === 0) throw new Error("no delivery targets are configured for this profile");
  await send(config, targets, "test", {
    title: "YT Zero test notification",
    body: "External notifications are working. This is how your alerts will arrive.",
    url: config.publicBaseUrl,
    tags: ["ytzero", "test"],
  });
}
