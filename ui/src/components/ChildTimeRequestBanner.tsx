import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type ChildGrant, type ChildTimeRequest } from "../api";
import { useI18n, type I18nKey } from "../i18n";
import { ProfileAvatar } from "./ProfileMenu";

const GRANTS: { grant: ChildGrant; labelKey: I18nKey }[] = [
  { grant: "15m", labelKey: "childGrant15m" },
  { grant: "1h", labelKey: "childGrant1h" },
  { grant: "video_end", labelKey: "childGrantVideoEnd" },
  { grant: "today_off", labelKey: "childGrantTodayOff" },
];

// Shown on the home feed of non-child profiles while a child's "more time"
// request is pending (the server expires requests after an hour). Approving
// asks for the child profile's PIN when one is set.
export default function ChildTimeRequestBanner() {
  const { t } = useI18n();
  const [requests, setRequests] = useState<ChildTimeRequest[]>([]);
  const [pinFor, setPinFor] = useState<{ request: ChildTimeRequest; grant: ChildGrant } | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);

  const load = useCallback(() => {
    api.childTimeRequests().then((r) => setRequests(r.requests)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const resolve = async (request: ChildTimeRequest, grant?: ChildGrant, enteredPin?: string) => {
    try {
      await api.resolveChildTimeRequest(request.id, grant ? "approve" : "dismiss", grant, enteredPin);
      setPinFor(null);
      setPin("");
      load();
    } catch {
      setPinError(true);
      setPin("");
    }
  };

  const onGrant = (request: ChildTimeRequest, grant: ChildGrant) => {
    if (request.requires_pin) {
      setPinFor({ request, grant });
      setPin("");
      setPinError(false);
    } else {
      resolve(request, grant);
    }
  };

  if (requests.length === 0) return null;

  return (
    <>
      {requests.map((r) => (
        <div key={r.id} className="child-time-banner">
          <ProfileAvatar profile={r} size={40} />
          <div className="child-time-banner-main">
            <div className="child-time-banner-title">{t("childTimeRequestTitle", { name: r.name })}</div>
            <div className="child-time-banner-actions">
              {GRANTS.map(({ grant, labelKey }) => (
                <button key={grant} className="btn" onClick={() => onGrant(r, grant)}>{t(labelKey)}</button>
              ))}
            </div>
          </div>
          <button className="icon-btn child-time-banner-close" aria-label={t("close")} onClick={() => resolve(r)}>
            <X size={16} />
          </button>
        </div>
      ))}

      {pinFor && (
        <div className="profile-pin-backdrop" onClick={() => setPinFor(null)}>
          <form
            className="profile-pin-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              if (/^\d{6}$/.test(pin)) resolve(pinFor.request, pinFor.grant, pin);
              else setPinError(true);
            }}
          >
            <button type="button" className="profile-pin-close" aria-label={t("close")} onClick={() => setPinFor(null)}>
              <X size={18} />
            </button>
            <ProfileAvatar profile={pinFor.request} size={56} />
            <div className="profile-pin-title">{t(GRANTS.find((g) => g.grant === pinFor.grant)!.labelKey)}</div>
            <div className="profile-pin-hint">{t("childApprovePinHint")}</div>
            <input
              className={`profile-pin-input${pinError ? " error" : ""}`}
              type="password"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              value={pin}
              placeholder="••••••"
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setPin(v);
                setPinError(false);
                if (v.length === 6) resolve(pinFor.request, pinFor.grant, v);
              }}
            />
            <button type="submit" className="btn primary" disabled={pin.length !== 6}>{t("childApprove")}</button>
          </form>
        </div>
      )}
    </>
  );
}
