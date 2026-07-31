import { useCallback, useEffect, useState } from "react";
import "./ProfileMenu.css";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronRight, Eraser, EyeOff, Lock, LogOut, Puzzle, Settings, SlidersHorizontal, X } from "lucide-react";
import { api, type AppSettings, type AuthStatus, type Profile, type ProfilePermissions } from "../api";
import { emit, subscribe } from "../events";
import { useI18n } from "../i18n";
import { parseVideoCardSize, persistVideoCardSize } from "../videoCardSize";
import { Button, IconButton, Menu, MenuItem, MenuSeparator, Popover, ScrollArea, SegmentedControl, SettingRow, SteppedSlider, Switch } from "./ui";
import NotificationCenter from "./NotificationCenter";
import Tooltip from "./Tooltip";
import { ENHANCE_EXTENSION_STATUS } from "../enhanceBridge";
import { setIncognitoMode } from "../incognitoMode";
import { clearDownloadActivity } from "../downloadActivity";

/** Round avatar: uploaded image, or a colored circle with the name initial. */
export function ProfileAvatar({ profile, size = 32 }: { profile: Pick<Profile, "name" | "avatar" | "avatar_color">; size?: number }) {
  const initial = (profile.name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className="profile-avatar"
      style={{ width: size, height: size, background: profile.avatar ? undefined : profile.avatar_color, fontSize: Math.round(size * 0.44) }}
    >
      {profile.avatar ? <img src={profile.avatar} alt="" decoding="async" /> : initial}
    </span>
  );
}

export default function ProfileMenu({ isAdmin, isChildProfile, profilePermissions, feedSort, onFeedSortChange, incognito, onIncognitoChange }: {
  isAdmin: boolean;
  isChildProfile: boolean;
  profilePermissions: ProfilePermissions;
  feedSort: "published" | "arrival";
  onFeedSortChange: (next: "published" | "arrival") => void;
  incognito: boolean;
  onIncognitoChange: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
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
  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [enhanceEnabled, setEnhanceEnabled] = useState(true);
  const [enhanceReplaceControls, setEnhanceReplaceControls] = useState(true);

  const load = useCallback(() => {
    api.profiles().then((r) => setProfiles(r.profiles)).catch(() => {});
    api.authStatus().then(setAuth).catch(() => {});
    api.childLock().then((r) => setChildLockEnabled(r.child_lock.enabled)).catch(() => {});
    api.settings().then((r) => {
      setCardSize(parseVideoCardSize(r.settings.grid_size));
      setEnhanceEnabled(r.settings.enhance_enabled !== "0");
      setEnhanceReplaceControls(r.settings.enhance_replace_controls !== "0");
    }).catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => subscribe("profiles-changed", load), [load]);

  const active = profiles.find((p) => p.active) ?? profiles[0];
  // Until auth status is known, expose only the active profile. This avoids a
  // brief flash of other profile names when the administrator hid the list.
  const pickerProfiles = auth && !auth.hide_other_profiles ? profiles : profiles.filter((profile) => profile.active);
  const cardSizeSteps = [180, 220, 260, 300, 372, 480] as const;
  // Leaving a child profile is gated by the app-wide child lock PIN.
  const needsChildLock = Boolean(active?.is_child && childLockEnabled);
  const canManageArea = (area: ProfilePermissions["admin_only_areas"][number]) => isAdmin || !profilePermissions.admin_only_areas.includes(area);

  const doSwitch = async (p: Profile, enteredPin?: string, enteredChildLockPin?: string) => {
    try {
      await api.switchProfile(p.id, enteredPin, enteredChildLockPin);
      setIncognitoMode(false);
      clearDownloadActivity();
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

  const saveEnhanceSetting = async (patch: Partial<AppSettings>) => {
    try {
      await api.updateSettings(patch);
      emit("player-settings-changed");
    } catch {
      load();
    }
  };

  if (!active) return null;

  return (
    <div className="profile-menu">
      <Popover
        align="end"
        surface="menu"
        rootClassName="profile-picker-anchor"
        open={open}
        onOpenChange={(next) => { setOpen(next); if (!next) setCardSizeOpen(false); }}
        className="profile-picker-popover"
        trigger={<Button variant="ghost" iconOnly className="profile-trigger" aria-label={t("profiles")}>
        <ProfileAvatar profile={active} size={32} />
        </Button>}
      >
        <div className="profile-picker" role="menu">
          <ScrollArea viewportClassName="profile-dropdown-list">
            {pickerProfiles.map((p) => (
              <button key={p.id} className={`profile-row${p.active ? " active" : ""}`} role="menuitem" onClick={() => onPick(p)}>
                <ProfileAvatar profile={p} size={36} />
                <span className="profile-row-name">{p.name}</span>
                {p.has_pin && <Lock size={14} className="profile-row-lock" />}
                {p.active && <Check size={16} className="profile-row-check" />}
              </button>
            ))}
          </ScrollArea>
          <MenuSeparator />
          <Menu className="profile-picker-actions">
            {canManageArea("profiles") && <MenuItem icon={<Settings size={18} />} onClick={() => { setOpen(false); navigate("/settings?tab=profiles"); }}>{t("manageProfiles")}</MenuItem>}
            {auth && auth.method !== "none" && <MenuItem icon={<LogOut size={18} />} onClick={doLogout}>{t("logout")}</MenuItem>}
          </Menu>
        </div>
      </Popover>
      {canManageArea("playback") && <div
        id={ENHANCE_EXTENSION_STATUS.elementId}
        className="profile-enhance-extension"
        data-extension-status="inactive"
      >
        <Popover
          align="end"
          open={enhanceOpen}
          onOpenChange={setEnhanceOpen}
          title={t("enhanceSettingsTitle")}
          className="profile-enhance-popover"
          trigger={
            <span className="profile-enhance-extension-trigger-wrap">
              <Tooltip text={t("enhanceExtensionConnected")} pos="bottom">
                <IconButton
                  variant={enhanceOpen ? "secondary" : "ghost"}
                  size="sm"
                  className="profile-enhance-extension-trigger"
                  label={t("enhanceExtensionConnected")}
                  icon={<Puzzle />}
                />
              </Tooltip>
            </span>
          }
        >
          <div className="profile-enhance-settings">
            <SettingRow label={t("enhanceEnabled")} description={t("enhanceEnabledHint")} align="start">
              <Switch
                checked={enhanceEnabled}
                ariaLabel={t("enhanceEnabled")}
                onCheckedChange={(next) => {
                  setEnhanceEnabled(next);
                  void saveEnhanceSetting({ enhance_enabled: next ? "1" : "0" });
                }}
              />
            </SettingRow>
            <SettingRow label={t("enhanceReplaceControls")} description={t("enhanceReplaceControlsHint")} align="start">
              <Switch
                checked={enhanceReplaceControls}
                ariaLabel={t("enhanceReplaceControls")}
                onCheckedChange={(next) => {
                  setEnhanceReplaceControls(next);
                  void saveEnhanceSetting({ enhance_replace_controls: next ? "1" : "0" });
                }}
              />
            </SettingRow>
          </div>
        </Popover>
        <span className="profile-enhance-extension-badge" aria-hidden="true" />
      </div>}
      <div className="profile-card-size-wrap">
        <Popover
          open={cardSizeOpen}
          onOpenChange={setCardSizeOpen}
          align="end"
          title={t("videoCardSize")}
          className="profile-card-size-popover"
          trigger={<IconButton variant="ghost" size="sm" className="profile-card-size-trigger" label={t("videoCardSize")} icon={<SlidersHorizontal />} />}
        >
          {canManageArea("appearance") && <SteppedSlider value={cardSize} steps={cardSizeSteps} ariaLabel={t("videoCardSize")} onChange={(next) => {
            setCardSize(next);
            persistVideoCardSize(next);
            emit("video-card-size-changed");
          }} />}
          {location.pathname === "/" && (
            <>
              {canManageArea("appearance") && <MenuSeparator />}
              <SettingRow label={t("feedSortLabel")} className="profile-feed-sort-row">
                <SegmentedControl
                  className="profile-feed-sort-control"
                  value={feedSort}
                  onChange={onFeedSortChange}
                  label={t("feedSortLabel")}
                  options={[
                    { value: "published", label: t("feedSortUploaded") },
                    { value: "arrival", label: t("feedSortFound") },
                  ]}
                />
              </SettingRow>
            </>
          )}
          {!isChildProfile && (
            <>
              <MenuSeparator />
              <SettingRow
                label={t("incognitoMode")}
                description={t("incognitoModeHint")}
                className={`profile-incognito-row${incognito ? " profile-incognito-row--active" : ""}`}
              >
                <span className="profile-incognito-control">
                  <EyeOff size={17} aria-hidden="true" />
                  <Switch checked={incognito} ariaLabel={t("incognitoMode")} onCheckedChange={onIncognitoChange} />
                </span>
              </SettingRow>
            </>
          )}
          <MenuSeparator />
          <Menu>
            <MenuItem icon={<Eraser size={16} />} suffix={<ChevronRight size={15} className="cleanup-menu-item-chevron" />} onClick={() => { setCardSizeOpen(false); navigate("/cleanup"); }}>{t("cleanupFeed")}</MenuItem>
          </Menu>
        </Popover>
      </div>
      <NotificationCenter />

      {reloginFor && createPortal(
        <div className="profile-pin-backdrop" onClick={() => setReloginFor(null)}>
          <div className="profile-pin-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="profile-pin-close" aria-label={t("close")} onClick={() => setReloginFor(null)}>
              <X size={18} />
            </button>
            <ProfileAvatar profile={reloginFor} size={56} />
            <div className="profile-pin-title">{t("switchNeedsLogoutTitle")}</div>
            <div className="profile-pin-hint">{t("switchNeedsLogout")}</div>
            <Button type="button" variant="primary" onClick={doLogout}>
              <LogOut size={16} /> {t("logout")}
            </Button>
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
            <Button
              type="submit"
              variant="primary"
              disabled={!pinComplete(pinFor, pin, childLockPin)}
            >{t("switchProfile")}</Button>
          </form>
        </div>,
        document.body
      )}
    </div>
  );
}
