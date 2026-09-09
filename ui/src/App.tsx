import AppBootstrap from "./app-shell/AppBootstrap";
import AppShell from "./app-shell/AppShell";
import LoginPage from "./pages/LoginPage";
import PublicSharePage from "./pages/PublicSharePage";
import { isPublicSharePath } from "./publicSharePath";
import { useAuthBootstrap } from "./useAuthBootstrap";

function AuthenticatedApp() {
  const auth = useAuthBootstrap();

  if (!auth) return <AppBootstrap />;
  if (!auth.authenticated) return <LoginPage status={auth} />;
  return <AppShell isAdmin={Boolean(auth.is_admin)} />;
}

export default function App() {
  if (isPublicSharePath(window.location.pathname)) return <PublicSharePage />;
  return <AuthenticatedApp />;
}
