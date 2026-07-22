import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Check, Lock, LogOut, Settings, SlidersHorizontal, UserPlus, X } from "lucide-react";
import { api, type AuthStatus, type Profile } from "../api";
import { emit, subscribe } from "../events";
import { useI18n } from "../i18n";
import { parseVideoCardSize, persistVideoCardSize } from "../videoCardSize";
import { IconButton, Popover, SteppedSlider } from "./ui";
import NotificationCenter from "./NotificationCenter";

/** Round avatar: uploaded image, or a colored circle with the name initial. */
export function ProfileAvatar({ profile, size = 32 }: { profile: Pick<Profile, "name" | "avatar" | "avatar_color">; size?: number }) {
  const initial = (profile.name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className="profile-avatar"
      style={{ width: size, height: size, background: profile.avatar ? undefined : profile.avatar_color, fontSize: Math.round(size * 0.44) }}
    >
      {profile.avatar ? <img src={profile.avatar} alt="" /> : initial}
    </span>
  );
}

export default function ProfileMenu() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const [cardSizeOpen, setCardSizeOpen] = useState(false);
  const [cardSize, setCardSize] = useState(248);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const [childLockPin, setChildLockPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [childLockEnabled, setChildLockEnabled] = useState(false);
  const [reloginFor, setReloginFor] = useState<Profile | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.profiles().then((r) => setProfiles(r.profiles)).catch(() => {});
    api.authStatus().then(setAuth).catch(() => {});
    api.childLock().then((r) => setChildLockEnabled(r.child_lock.enabled)).catch(() => {});
    api.settings().then((r) => setCardSize(parseVideoCardSize(r.settings.grid_size))).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => subscribe("profiles-changed", load), [load]);


  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); setCardSizeOpen(false); }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = profiles.find((p) => p.active) ?? profiles[0];
  const cardSizeSteps = [180, 220, 260, 300, 372, 480] as const;
  // Leaving a child profile is gated by the app-wide child lock PIN.
  const needsChildLock = Boolean(active?.is_child && childLockEnabled);

  const doSwitch = async (p: Profile, enteredPin?: string, enteredChildLockPin?: string) => {
    try {
      await api.switchProfile(p.id, enteredPin, enteredChildLockPin);
      // Full reload so feed, sidebar, settings and language all re-resolve.
      window.location.reload();
    } catch {
      setPinError(true);
      setPin(""); // clear for a fresh retry (avoids re-firing auto-submit)
      setChildLockPin("");
      // Repeated failures may have locked the child profile — reload so the
      // lock screen takes over right away instead of on the next poll.
      api.childStatus().then((s) => { if (s.locked) window.location.reload(); }).catch(() => {});
    }
  };

  const onPick = (p: Profile) => {
    if (p.active) { setOpen(false); return; }
    // Methods that pin a session to one profile can't switch internally — the
    // user must sign out (and possibly be redirected to the IdP/proxy logout).
    if (!p.can_switch) {
      setOpen(false);
      setReloginFor(p);
      return;
    }
    if (p.has_pin || needsChildLock) {
      setPinFor(p);
      setPin("");
      setChildLockPin("");
      setPinError(false);
    } else {
      doSwitch(p);
    }
  };

  const doLogout = async () => {
    try {
      const { logout_url } = await api.logout();
      if (logout_url) window.location.href = logout_url;
      else window.location.replace("/");
    } catch {
      window.location.replace("/");
    }
  };

  const pinComplete = (p: Profile, targetPin: string, lockPin: string) =>
    (!p.has_pin || /^\d{6}$/.test(targetPin)) && (!needsChildLock || /^\d{6}$/.test(lockPin));

  const submitPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinFor && pinComplete(pinFor, pin, childLockPin)) doSwitch(pinFor, pin || undefined, childLockPin || undefined);
    else setPinError(true);
  };

  if (!active) return null;

  return (
    <div className="profile-menu" ref={wrapRef}>
      <button className="profile-trigger" aria-label={t("profiles")} onClick={() => setOpen((v) => !v)}>
        <ProfileAvatar profile={active} size={32} />
      </button>
      <div className="profile-card-size-wrap">
        <Popover
          open={cardSizeOpen}
          onOpenChange={setCardSizeOpen}
          align="end"
          title={t("videoCardSize")}
          className="profile-card-size-popover"
          trigger={<IconButton variant="ghost" size="sm" className="profile-card-size-trigger" label={t("videoCardSize")} icon={<SlidersHorizontal />} />}
        >
          <SteppedSlider value={cardSize} steps={cardSizeSteps} ariaLabel={t("videoCardSize")} onChange={(next) => { setCardSize(next); persistVideoCardSize(next).then(() => emit("video-card-size-changed")).catch(() => {}); }} />
        </Popover>
      </div>
      <NotificationCenter />

      {open && (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-list">
            {profiles.map((p) => (
              <button key={p.id} className={`profile-row${p.active ? " active" : ""}`} role="menuitem" onClick={() => onPick(p)}>
                <ProfileAvatar profile={p} size={36} />
                <span className="profile-row-name">{p.name}</span>
                {p.has_pin && <Lock size={14} className="profile-row-lock" />}
                {p.active && <Check size={16} className="profile-row-check" />}
              </button>
            ))}
          </div>
          <div className="profile-dropdown-sep" />
          <button
            className="profile-action"
            role="menuitem"
            onClick={() => { setOpen(false); navigate("/settings?tab=profiles&new=1"); }}
          >
            <UserPlus size={18} />
            <span>{t("addProfile")}</span>
          </button>
          <button
            className="profile-action"
            role="menuitem"
            onClick={() => { setOpen(false); navigate("/settings?tab=profiles"); }}
          >
            <Settings size={18} />
            <span>{t("manageProfiles")}</span>
          </button>
          {auth && auth.method !== "none" && (
            <button className="profile-action" role="menuitem" onClick={doLogout}>
              <LogOut size={18} />
              <span>{t("logout")}</span>
            </button>
          )}
        </div>
      )}

      {reloginFor && createPortal(
        <div className="profile-pin-backdrop" onClick={() => setReloginFor(null)}>
          <div className="profile-pin-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="profile-pin-close" aria-label={t("close")} onClick={() => setReloginFor(null)}>
              <X size={18} />
            </button>
            <ProfileAvatar profile={reloginFor} size={56} />
            <div className="profile-pin-title">{t("switchNeedsLogoutTitle")}</div>
            <div className="profile-pin-hint">{t("switchNeedsLogout")}</div>
            <button type="button" className="btn primary" onClick={doLogout}>
              <LogOut size={16} /> {t("logout")}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Rendered into <body> so the fixed overlay escapes the topbar's
          backdrop-filter containing block (otherwise it clips to the topbar). */}
      {pinFor && createPortal(
        <div className="profile-pin-backdrop" onClick={() => setPinFor(null)}>
          <form className="profile-pin-modal" onClick={(e) => e.stopPropagation()} onSubmit={submitPin}>
            <button type="button" className="profile-pin-close" aria-label={t("close")} onClick={() => setPinFor(null)}>
              <X size={18} />
            </button>
            <ProfileAvatar profile={pinFor} size={56} />
            <div className="profile-pin-title">{pinFor.name}</div>
            {needsChildLock && (
              <>
                <div className="profile-pin-hint">{t("enterChildLockPin")}</div>
                <input
                  className={`profile-pin-input${pinError ? " error" : ""}`}
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  maxLength={6}
                  value={childLockPin}
                  placeholder="••••••"
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setChildLockPin(v);
                    setPinError(false);
                    // Auto-submit when this is the only PIN the switch needs.
                    if (v.length === 6 && pinFor && !pinFor.has_pin) doSwitch(pinFor, undefined, v);
                  }}
                />
              </>
            )}
            {pinFor.has_pin && (
              <>
                <div className="profile-pin-hint">{t("enterProfilePin")}</div>
                <input
                  className={`profile-pin-input${pinError ? " error" : ""}`}
                  type="password"
                  inputMode="numeric"
                  autoFocus={!needsChildLock}
                  maxLength={6}
                  value={pin}
                  placeholder="••••••"
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setPin(v);
                    setPinError(false);
                    // Auto-submit once all 6 digits are in.
                    if (v.length === 6 && pinFor && !needsChildLock) doSwitch(pinFor, v);
                  }}
                />
              </>
            )}
            <button
              type="submit"
              className="btn primary"
              disabled={!pinComplete(pinFor, pin, childLockPin)}
            >{t("switchProfile")}</button>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
