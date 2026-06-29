import { useCallback, useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { Check, KeyRound, TriangleAlert, Trash2 } from "lucide-react";
import { api, type AuthConfig, type AuthConfigUpdate, type AuthMethod } from "../api";
import { useI18n, type I18nKey } from "../i18n";
import Popconfirm from "./Popconfirm";

const METHODS: { id: AuthMethod; label: I18nKey; desc: I18nKey }[] = [
  { id: "none", label: "authMethodNone", desc: "authMethodNoneDesc" },
  { id: "shared", label: "authMethodShared", desc: "authMethodSharedDesc" },
  { id: "per_profile", label: "authMethodPerProfile", desc: "authMethodPerProfileDesc" },
  { id: "oidc", label: "authMethodOidc", desc: "authMethodOidcDesc" },
  { id: "proxy_header", label: "authMethodProxy", desc: "authMethodProxyDesc" },
];

export default function AuthSettings({ showToast }: { showToast: (m: string) => void }) {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<AuthMethod>("none");

  // editable drafts
  const [sharedUser, setSharedUser] = useState("");
  const [sharedPw, setSharedPw] = useState("");
  const [oidc, setOidc] = useState<AuthConfig["oidc"] | null>(null);
  const [oidcSecret, setOidcSecret] = useState("");
  const [proxyHeader, setProxyHeader] = useState("");
  const [proxyLogout, setProxyLogout] = useState("");
  const [pwDraft, setPwDraft] = useState<Record<number, string>>({});
  const [mapDraft, setMapDraft] = useState<Record<number, string>>({}); // oidc_subject or proxy_match
  const [userDraft, setUserDraft] = useState<Record<number, string>>({});
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Initial load: seed every editable draft from the saved config. Runs once.
  const load = useCallback(() => {
    api
      .authConfig()
      .then((c) => {
        setCfg(c);
        setSelected(c.method);
        setSharedUser(c.shared.username);
        setOidc(c.oidc);
        setProxyHeader(c.proxy.header);
        setProxyLogout(c.proxy.logout_url);
        setUserDraft(Object.fromEntries(c.profiles.map((p) => [p.id, p.username])));
        setMapDraft(
          Object.fromEntries(
            c.profiles.map((p) => [p.id, c.method === "proxy_header" ? p.proxy_match : p.oidc_subject])
          )
        );
      })
      .catch(() => setForbidden(true));
  }, []);
  useEffect(load, [load]);

  // Refresh only the status indicators (password_set, passkeys, …) after a save —
  // without resetting the selected method, the active subtab, or the user's drafts.
  const refreshCfg = useCallback(() => {
    api.authConfig().then(setCfg).catch(() => {});
  }, []);

  // While the activation modal is open, gate the confirm button behind a 5s
  // countdown so the change can't be applied without reading the warning.
  useEffect(() => {
    if (!confirming) return;
    setCountdown(5);
    const id = setInterval(() => setCountdown((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [confirming]);

  if (forbidden) return <p className="page-hint">{t("primaryOnlyHint")}</p>;
  if (!cfg || !oidc) return null;

  const buildUpdate = (): AuthConfigUpdate => ({
    shared: { username: sharedUser, ...(sharedPw ? { password: sharedPw } : {}) },
    oidc: {
      issuer: oidc.issuer,
      client_id: oidc.client_id,
      scopes: oidc.scopes,
      mode: oidc.mode,
      claim: oidc.claim,
      autocreate: oidc.autocreate,
      logout_url: oidc.logout_url,
      groups_claim: oidc.groups_claim,
      admin_group: oidc.admin_group,
      ...(oidcSecret ? { client_secret: oidcSecret } : {}),
    },
    proxy: { header: proxyHeader, logout_url: proxyLogout },
    profiles: cfg.profiles.map((p) => ({
      id: p.id,
      username: userDraft[p.id] ?? "",
      ...(pwDraft[p.id] ? { password: pwDraft[p.id] } : {}),
      ...(selected === "oidc" ? { oidc_subject: mapDraft[p.id] ?? "" } : {}),
      ...(selected === "proxy_header" ? { proxy_match: mapDraft[p.id] ?? "" } : {}),
    })),
  });

  // Save only persists; it must not change the selected method, the tab, or any
  // other in-progress draft (only the just-saved secret inputs are cleared).
  const save = async () => {
    try {
      await api.saveAuthConfig(buildUpdate());
      setSharedPw("");
      setOidcSecret("");
      setPwDraft({});
      showToast(t("authSaved"));
      refreshCfg();
    } catch (e: any) {
      showToast(e?.message ?? t("loginError"));
    }
  };

  const runTest = async () => {
    await api.saveAuthConfig(buildUpdate());
    const r = await api.testOidc();
    setTest({ ok: r.ok, msg: r.ok ? `${t("authTestOk")} — ${r.authorization_endpoint ?? ""}` : `${t("authTestFailed")}: ${r.error ?? ""}` });
    refreshCfg();
  };

  const addSharedPasskey = async () => {
    try {
      const { options, flowId } = await api.passkeyRegisterOptions("shared");
      const resp = await startRegistration({ optionsJSON: options });
      await api.passkeyRegisterVerify(flowId, resp);
      showToast(t("authSaved"));
      refreshCfg();
    } catch {
      showToast(t("loginError"));
    }
  };

  const doActivate = async () => {
    try {
      await api.saveAuthConfig(buildUpdate());
      await api.setAuthMethod(selected);
      // The session model changes — reload so the auth gate re-evaluates.
      window.location.replace("/");
    } catch (e: any) {
      setConfirming(false);
      showToast(e?.message ?? t("loginError"));
    }
  };

  // Methods that map each profile to a per-profile identifier — every profile
  // must be filled (and unique) before the method can be activated.
  const requiresMapping =
    selected === "per_profile" || selected === "proxy_header" || (selected === "oidc" && oidc.mode === "mapped");
  const mappingIssues = (() => {
    if (!requiresMapping) return null;
    const valueOf = (id: number) =>
      (selected === "per_profile" ? userDraft[id] ?? "" : mapDraft[id] ?? "").trim();
    const missing = cfg.profiles.filter((p) => !valueOf(p.id)).map((p) => p.name);
    const seen = new Map<string, true>();
    const dups = new Set<string>();
    for (const p of cfg.profiles) {
      const v = valueOf(p.id);
      if (!v) continue;
      if (seen.has(v)) dups.add(v);
      else seen.set(v, true);
    }
    const credMissing =
      selected === "per_profile"
        ? cfg.profiles.filter((p) => !(pwDraft[p.id] ?? "").trim() && !p.has_password && !p.has_passkey).map((p) => p.name)
        : [];
    const ok = missing.length === 0 && dups.size === 0 && credMissing.length === 0;
    return { ok, missing, duplicates: [...dups], credMissing };
  })();
  const blockActivate = Boolean(mappingIssues && !mappingIssues.ok);

  return (
    <section className="settings-section auth-settings">
      <p className="hint">
        {t("authCurrentMethod")}: <strong>{t(METHODS.find((m) => m.id === cfg.method)!.label)}</strong>
      </p>

      {/* Step 1 — method cards */}
      <h3 className="auth-step-title">{t("authStep1")}</h3>
      <div className="auth-method-grid">
        {METHODS.map((m) => (
          <button
            key={m.id}
            className={`auth-method-card${selected === m.id ? " selected" : ""}`}
            onClick={() => setSelected(m.id)}
          >
            <div className="auth-method-card-head">
              <span className="auth-method-card-name">{t(m.label)}</span>
              {cfg.method === m.id && <span className="auth-method-active"><Check size={13} /> {t("authActive")}</span>}
            </div>
            <span className="auth-method-card-desc">{t(m.desc)}</span>
          </button>
        ))}
      </div>

      {selected !== "none" && selected !== cfg.method && (
        <div className="auth-lockout-warn">{t("authLockoutWarn")}</div>
      )}

      {/* Step 2 — per-method configuration */}
      {selected !== "none" && <h3 className="auth-step-title">{t("authStep2")}</h3>}

      {selected === "shared" && (
        <div className="auth-config-block">
          <label className="settings-field">
            <span>{t("authSharedUsername")}</span>
            <input value={sharedUser} onChange={(e) => setSharedUser(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>{t("authPassword")}{cfg.shared.password_set ? ` (${t("authPasswordSet")})` : ""}</span>
            <input type="password" value={sharedPw} onChange={(e) => setSharedPw(e.target.value)} autoComplete="new-password" />
          </label>
          <PasskeyList passkeys={cfg.shared.passkeys} onAdd={addSharedPasskey} onDeleted={load} showToast={showToast} />
        </div>
      )}

      {selected === "per_profile" && (
        <div className="auth-config-block">
          <table className="auth-profile-table">
            <thead><tr><th>{t("profileName")}</th><th>{t("authUsername")}</th><th>{t("authPassword")}</th></tr></thead>
            <tbody>
              {cfg.profiles.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td><input value={userDraft[p.id] ?? ""} onChange={(e) => setUserDraft({ ...userDraft, [p.id]: e.target.value })} /></td>
                  <td>
                    <input
                      type="password"
                      placeholder={p.has_password ? t("authPasswordSet") : ""}
                      value={pwDraft[p.id] ?? ""}
                      autoComplete="new-password"
                      onChange={(e) => setPwDraft({ ...pwDraft, [p.id]: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected === "oidc" && (
        <div className="auth-config-block">
          <label className="settings-field"><span>{t("authOidcIssuer")}</span>
            <input value={oidc.issuer} onChange={(e) => setOidc({ ...oidc, issuer: e.target.value })} placeholder="https://id.example.com" /></label>
          <label className="settings-field"><span>{t("authOidcClientId")}</span>
            <input value={oidc.client_id} onChange={(e) => setOidc({ ...oidc, client_id: e.target.value })} /></label>
          <label className="settings-field"><span>{t("authOidcClientSecret")}</span>
            <input type="password" value={oidcSecret} placeholder={cfg.oidc.client_secret_set ? t("authOidcSecretKeep") : ""} onChange={(e) => setOidcSecret(e.target.value)} /></label>
          <label className="settings-field"><span>{t("authOidcScopes")}</span>
            <input value={oidc.scopes} onChange={(e) => setOidc({ ...oidc, scopes: e.target.value })} /></label>
          <label className="settings-field"><span>{t("authOidcRedirectUri")}</span>
            <input readOnly value={cfg.oidc.redirect_uri} onFocus={(e) => e.target.select()} /></label>
          <label className="settings-field"><span>{t("authOidcMode")}</span>
            <select value={oidc.mode} onChange={(e) => setOidc({ ...oidc, mode: e.target.value as "mapped" | "gateway" })}>
              <option value="mapped">{t("authOidcModeMapped")}</option>
              <option value="gateway">{t("authOidcModeGateway")}</option>
            </select></label>
          {oidc.mode === "mapped" && (
            <>
              <label className="settings-field"><span>{t("authOidcClaim")}</span>
                <input value={oidc.claim} onChange={(e) => setOidc({ ...oidc, claim: e.target.value })} /></label>
              <label className="settings-checkbox">
                <input type="checkbox" checked={oidc.autocreate} onChange={(e) => setOidc({ ...oidc, autocreate: e.target.checked })} />
                <span>{t("authOidcAutocreate")}</span>
              </label>
              <MappingTable profiles={cfg.profiles} label={t("authOidcSubject")} draft={mapDraft} setDraft={setMapDraft} />
            </>
          )}
          <label className="settings-field"><span>{t("authOidcGroupsClaim")}</span>
            <input value={oidc.groups_claim} onChange={(e) => setOidc({ ...oidc, groups_claim: e.target.value })} placeholder="groups" /></label>
          <label className="settings-field"><span>{t("authOidcAdminGroup")}</span>
            <input value={oidc.admin_group} onChange={(e) => setOidc({ ...oidc, admin_group: e.target.value })} /></label>
          <p className="hint">{t("authOidcAdminGroupHint")}</p>
          <label className="settings-field"><span>{t("authOidcLogoutUrl")}</span>
            <input value={oidc.logout_url} onChange={(e) => setOidc({ ...oidc, logout_url: e.target.value })} /></label>
          <div className="form-row">
            <button className="btn" onClick={runTest}>{t("authTestConnection")}</button>
            {test && <span className={test.ok ? "auth-test-ok" : "auth-test-fail"}>{test.msg}</span>}
          </div>
        </div>
      )}

      {selected === "proxy_header" && (
        <div className="auth-config-block">
          <label className="settings-field"><span>{t("authProxyHeader")}</span>
            <input value={proxyHeader} onChange={(e) => setProxyHeader(e.target.value)} /></label>
          <p className="hint">{t("authProxyHeaderHint")}</p>
          <p className="hint">{t("authProxyCurrentValue")}: <code>{cfg.proxy.current_header_value || "—"}</code></p>
          <MappingTable profiles={cfg.profiles} label={t("authProxyMatch")} draft={mapDraft} setDraft={setMapDraft} />
          <label className="settings-field"><span>{t("authLogoutUrl")}</span>
            <input value={proxyLogout} onChange={(e) => setProxyLogout(e.target.value)} /></label>
        </div>
      )}

      {/* Step 3 — save + activate */}
      {blockActivate && mappingIssues && (
        <div className="auth-lockout-warn">
          <div>{t("authMappingIncomplete")}</div>
          <ul className="auth-mapping-issues">
            {mappingIssues.missing.length > 0 && <li>{t("authMappingMissing", { names: mappingIssues.missing.join(", ") })}</li>}
            {mappingIssues.credMissing.length > 0 && <li>{t("authMappingCredMissing", { names: mappingIssues.credMissing.join(", ") })}</li>}
            {mappingIssues.duplicates.length > 0 && <li>{t("authMappingDuplicate", { values: mappingIssues.duplicates.join(", ") })}</li>}
          </ul>
        </div>
      )}
      {selected !== "none" && (
        <div className="form-row auth-actions">
          <button className="btn" onClick={save}>{t("authSave")}</button>
          <button className="btn primary" disabled={blockActivate} onClick={() => setConfirming(true)}>{t("authActivate")}</button>
        </div>
      )}
      {selected === "none" && cfg.method !== "none" && (
        <div className="form-row auth-actions">
          <button className="btn primary" onClick={() => setConfirming(true)}>{t("authActivate")}</button>
        </div>
      )}

      {confirming && (
        <div className="auth-confirm-backdrop" onClick={() => setConfirming(false)}>
          <div className="auth-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="auth-confirm-icon"><TriangleAlert size={34} strokeWidth={2.25} /></div>
            <h3 className="auth-confirm-title">{t("authActivateConfirmTitle")}</h3>
            <p className="auth-confirm-msg">{t("authActivateConfirmMsg")}</p>
            <div className="auth-confirm-note">
              <div className="auth-confirm-note-label">{t("authActivateConfirmRecovery")}</div>
              <code className="auth-confirm-code">YTZERO_AUTH_DISABLE=1</code>
            </div>
            <div className="auth-confirm-actions">
              <button className="btn" onClick={() => setConfirming(false)}>{t("close")}</button>
              <button className="btn primary" disabled={countdown > 0} onClick={doActivate}>
                {countdown > 0 ? `${t("authActivate")} (${countdown})` : t("authActivate")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function MappingTable({
  profiles, label, draft, setDraft,
}: { profiles: AuthConfig["profiles"]; label: string; draft: Record<number, string>; setDraft: (d: Record<number, string>) => void }) {
  const { t } = useI18n();
  return (
    <table className="auth-profile-table">
      <thead><tr><th>{t("profileName")}</th><th>{label}</th></tr></thead>
      <tbody>
        {profiles.map((p) => (
          <tr key={p.id}>
            <td>{p.name}</td>
            <td><input value={draft[p.id] ?? ""} onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PasskeyList({
  passkeys, onAdd, onDeleted, showToast,
}: { passkeys: AuthConfig["shared"]["passkeys"]; onAdd: () => void; onDeleted: () => void; showToast: (m: string) => void }) {
  const { t } = useI18n();
  const del = async (id: number) => {
    try { await api.deletePasskey(id); onDeleted(); } catch { showToast(t("loginError")); }
  };
  return (
    <div className="auth-passkeys">
      <div className="auth-passkeys-head">
        <span>{t("authPasskeys")}</span>
        <button className="btn" onClick={onAdd}><KeyRound size={15} /> {t("authRegisterPasskey")}</button>
      </div>
      {passkeys.length === 0 ? (
        <p className="hint">{t("authNoPasskeys")}</p>
      ) : (
        <ul className="auth-passkey-list">
          {passkeys.map((k) => (
            <li key={k.id}>
              <KeyRound size={14} />
              <span>{k.label || `#${k.id}`}</span>
              <Popconfirm message={t("authDeletePasskeyConfirm")} onConfirm={() => del(k.id)}>
                <button className="icon-btn" aria-label={t("authDeletePasskey")}><Trash2 size={14} /></button>
              </Popconfirm>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
