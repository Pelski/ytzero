import AppBootstrap from "./app-shell/AppBootstrap";
import AppShell from "./app-shell/AppShell";
import LoginPage from "./pages/LoginPage";
import { useAuthBootstrap } from "./useAuthBootstrap";

export default function App() {
  const auth = useAuthBootstrap();

  if (!auth) return <AppBootstrap />;
  if (!auth.authenticated) return <LoginPage status={auth} />;
  return <AppShell isAdmin={Boolean(auth.is_admin)} />;
}
