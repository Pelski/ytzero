import type { Profile } from "./api";

const ACTIVE_PROFILE_KEY = "ytzero.activeProfileId";

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function rememberedProfileId(): number | null {
  const value = Number(storage()?.getItem(ACTIVE_PROFILE_KEY));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function rememberProfile(id: number): void {
  if (!Number.isSafeInteger(id) || id < 1) return;
  try { storage()?.setItem(ACTIVE_PROFILE_KEY, String(id)); } catch {}
}

export function forgetRememberedProfile(): void {
  try { storage()?.removeItem(ACTIVE_PROFILE_KEY); } catch {}
}

export function restorableRememberedProfile(profiles: Profile[]): Profile | null {
  const remembered = rememberedProfileId();
  if (remembered == null) return null;
  return profiles.find((profile) => profile.id === remembered && profile.can_switch && !profile.has_pin) ?? null;
}
