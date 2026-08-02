import { useEffect, useState } from "react";
import { api, type AuthStatus } from "./api";
import AppBootstrap from "./app-shell/AppBootstrap";
import AppShell from "./app-shell/AppShell";
import LoginPage from "./pages/LoginPage";

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  useEffect(() => {
    api.authStatus().then(setAuth).catch(() => setAuth({
      method: "none",
      authenticated: true,
      can_switch: true,
      hide_other_profiles: false,
      can_manage_administrators: false,
      admin_delegation_available: false,
    }));
  }, []);

  if (!auth) return <AppBootstrap />;
  if (!auth.authenticated) return <LoginPage status={auth} />;
  return <AppShell isAdmin={Boolean(auth.is_admin)} />;
}
