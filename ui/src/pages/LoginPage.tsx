import { FormEvent, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { KeyRound, LogIn, Play, ShieldAlert } from "lucide-react";
import { api, type AuthStatus } from "../api";
import { useI18n } from "../i18n";
import { useDocumentTitle } from "../useDocumentTitle";
import { Button, ButtonAnchor, Input } from "../components/ui";

/**
 * Full-screen sign-in shown when `auth/status` reports the request is not
 * authenticated. The rendered controls depend on the active method's `login`
 * capabilities (password / passkey / oidc) or, for proxy_header, an error hint.
 */
export default function LoginPage({ status }: { status: AuthStatus }) {
  const { t } = useI18n();
  useDocumentTitle(t("loginTitle"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = status.login ?? { password: false, passkey: false, oidc: false };
  const showUsername = Boolean(status.username_field);

  const done = () => window.location.replace("/");

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.passwordLogin(username, password);
      done();
    } catch {
      setError(t("loginInvalid"));
      setBusy(false);
    }
  };

  const loginPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const { options, flowId } = await api.passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: options });
      await api.passkeyLoginVerify(flowId, response);
      done();
    } catch {
      setError(t("loginError"));
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <span className="logo-mark login-logo">
          <Play fill="currentColor" />
        </span>
        <h1 className="login-title">{t("loginTitle")}</h1>

        {status.method === "proxy_header" && (
          <div className="login-proxy-error">
            <ShieldAlert size={20} />
            <p>{t("loginProxyMissing")}</p>
          </div>
        )}

        {login.password && (
          <form className="login-form" onSubmit={submitPassword}>
            {showUsername && (
              <Input
                className="login-input"
                placeholder={t("authUsername")}
                value={username}
                autoFocus
                onChange={(e) => setUsername(e.target.value)}
              />
            )}
            <Input
              className="login-input"
              type="password"
              placeholder={t("authPassword")}
              value={password}
              autoFocus={!showUsername}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button className="login-btn" variant="primary" type="submit" disabled={busy || !password} leadingIcon={<LogIn size={18} />}>{t("loginSignIn")}</Button>
          </form>
        )}

        {login.passkey && (
          <Button className="login-btn" onClick={loginPasskey} disabled={busy} leadingIcon={<KeyRound size={18} />}>{t("loginWithPasskey")}</Button>
        )}

        {login.oidc && (
          <ButtonAnchor className="login-btn" variant="primary" href="/api/auth/oidc/login" leadingIcon={<LogIn size={18} />}>{t("loginWithSso")}</ButtonAnchor>
        )}

        {error && <div className="login-error">{error}</div>}
      </div>
    </div>
  );
}
