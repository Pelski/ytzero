import { useEffect, useState } from "react";
import { api, type AuthStatus } from "./api";
import { forgetRememberedProfile, rememberProfile, rememberedProfileId, restorableRememberedProfile } from "./profilePreference";

const AUTH_FALLBACK: AuthStatus = {
  method: "none",
  authenticated: true,
  can_switch: true,
  hide_other_profiles: false,
  can_manage_administrators: false,
  admin_delegation_available: false,
};

async function restoreRememberedProfile(status: AuthStatus): Promise<boolean> {
  if (!status.authenticated || !status.can_switch || status.hide_other_profiles) return false;
  const response = await api.profiles();
  const active = response.profiles.find((profile) => profile.active);
  const storedId = rememberedProfileId();
  const remembered = restorableRememberedProfile(response.profiles);
  if (remembered && remembered.id !== response.active_id) {
    try {
      const switched = await api.switchProfile(remembered.id);
      rememberProfile(switched.active_id);
      window.location.reload();
      return true;
    } catch {
      // PIN and child-lock boundaries remain authoritative. The normal picker
      // can complete a switch that cannot be restored silently.
    }
  } else if (storedId == null && active) {
    rememberProfile(active.id);
  } else if (storedId != null && !response.profiles.some((profile) => profile.id === storedId)) {
    forgetRememberedProfile();
    if (active) rememberProfile(active.id);
  }
  return false;
}

export function useAuthBootstrap(): AuthStatus | null {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  useEffect(() => {
    void (async () => {
      const status = await api.authStatus().catch(() => AUTH_FALLBACK);
      try {
        if (await restoreRememberedProfile(status)) return;
      } catch {
        // Device preference restoration is best-effort; the cookie remains.
      }
      setAuth(status);
    })();
  }, []);
  return auth;
}
