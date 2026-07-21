import { useEffect, useState } from "react";
import { Hourglass, Lock, ShieldAlert, X } from "lucide-react";
import { api, type ChildStatus, type Profile } from "../api";
import { useI18n } from "../i18n";
import { ProfileAvatar } from "./ProfileMenu";
import { Button, IconButton, Input } from "./ui";

// Full-screen overlay shown to a child profile whose daily watch time ran out
// (lock_reason "time") or that got locked after repeated wrong child-lock PINs
// (lock_reason "pin"). Not a route on purpose: it covers whatever page is open
// and can't be left by navigating. From here the child can ask a parent for
// more time or switch to another profile — leaving is gated by the app-wide
// child lock PIN, plus the target profile's own PIN when it has one.
export default function ChildLockScreen({ status }: { status: ChildStatus }) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [childLockEnabled, setChildLockEnabled] = useState(false);
  const [sent, setSent] = useState(status.has_pending_request);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [pin, setPin] = useState("");
  const [childLockPin, setChildLockPin] = useState("");
  const [pinError, setPinError] = useState(false);

  useEffect(() => {
    api.profiles().then((r) => setProfiles(r.profiles)).catch(() => {});
    api.childLock().then((r) => setChildLockEnabled(r.child_lock.enabled)).catch(() => {});
  }, []);
  useEffect(() => setSent(status.has_pending_request), [status.has_pending_request]);

  const pinLock = status.lock_reason === "pin";
  const parentLock = status.lock_reason === "parent";
  const others = profiles.filter((p) => !p.active && p.can_switch);
  const needsChildLock = childLockEnabled;

  const askForTime = async () => {
    // If the lock fired mid-video, remember it for the "until video ends" grant.
    const videoId = window.location.pathname.match(/^\/watch\/([\w-]+)/)?.[1] ?? null;
    try {
      await api.childTimeRequest(videoId);
      setSent(true);
    } catch { /* keep the button visible for a retry */ }
  };

  const doSwitch = async (p: Profile, enteredPin?: string, enteredChildLockPin?: string) => {
    try {
      await api.switchProfile(p.id, enteredPin, enteredChildLockPin);
      window.location.reload();
    } catch {
      setPinError(true);
      setPin("");
      setChildLockPin("");
    }
  };

  const onPick = (p: Profile) => {
    if (p.has_pin || needsChildLock) {
      setPinFor(p);
      setPin("");
      setChildLockPin("");
      setPinError(false);
    } else {
      doSwitch(p);
    }
  };

  const pinComplete = (p: Profile) =>
    (!p.has_pin || /^\d{6}$/.test(pin)) && (!needsChildLock || /^\d{6}$/.test(childLockPin));

  return (
    <div className="child-lock-screen">
      <div className="child-lock-center">
        <div className="child-lock-icon">{pinLock || parentLock ? <ShieldAlert size={56} /> : <Hourglass size={56} />}</div>
        <h1 className="child-lock-title">{t(parentLock ? "childStoppedTitle" : pinLock ? "childPinLockedTitle" : "childTimeUpTitle")}</h1>
        <p className="child-lock-text">{t(parentLock ? "childStoppedText" : pinLock ? "childPinLockedText" : "childTimeUpText")}</p>
        {!pinLock && !parentLock && (
          sent ? (
            <div className="child-lock-sent">{t("childAskTimeSent")}</div>
          ) : (
            <Button variant="primary" className="child-lock-ask" onClick={askForTime}>
              {t("childAskTime")}
            </Button>
          )
        )}
      </div>

      {others.length > 0 && (
        <div className="child-lock-profiles">
          <div className="child-lock-profiles-label">{t("switchProfile")}</div>
          <div className="child-lock-profiles-row">
            {others.map((p) => (
              <button key={p.id} className="child-lock-profile" onClick={() => onPick(p)}>
                <ProfileAvatar profile={p} size={48} />
                <span className="child-lock-profile-name">
                  {p.name}
                  {(p.has_pin || needsChildLock) && <Lock size={12} />}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {pinFor && (
        <div className="profile-pin-backdrop" onClick={() => setPinFor(null)}>
          <form
            className="profile-pin-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (pinComplete(pinFor)) doSwitch(pinFor, pin || undefined, childLockPin || undefined);
              else setPinError(true);
            }}
          >
            <IconButton className="profile-pin-close" label={t("close")} onClick={() => setPinFor(null)}>
              <X size={18} />
            </IconButton>
            <ProfileAvatar profile={pinFor} size={56} />
            <div className="profile-pin-title">{pinFor.name}</div>
            {needsChildLock && (
              <>
                <div className="profile-pin-hint">{t("enterChildLockPin")}</div>
                <Input
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
                    if (v.length === 6 && pinFor && !pinFor.has_pin) doSwitch(pinFor, undefined, v);
                  }}
                />
              </>
            )}
            {pinFor.has_pin && (
              <>
                <div className="profile-pin-hint">{t("enterProfilePin")}</div>
                <Input
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
                    if (v.length === 6 && pinFor && !needsChildLock) doSwitch(pinFor, v);
                  }}
                />
              </>
            )}
            <Button type="submit" variant="primary" disabled={!pinComplete(pinFor)}>{t("switchProfile")}</Button>
          </form>
        </div>
      )}
    </div>
  );
}
