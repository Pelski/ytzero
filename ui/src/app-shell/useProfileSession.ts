import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, type ChildStatus } from "../api";
import { isIncognitoMode, setIncognitoAllowed, setIncognitoMode } from "../incognitoMode";
import { subscribeServerEvent } from "../serverEvents";

export function useProfileSession() {
  const location = useLocation();
  const navigate = useNavigate();
  const [childStatus, setChildStatus] = useState<ChildStatus | null>(null);
  const [incognito, setIncognito] = useState(isIncognitoMode);
  const [ready, setReady] = useState(false);

  const changeIncognito = useCallback((next: boolean) => {
    const allowed = childStatus?.is_child !== true;
    setIncognitoAllowed(allowed);
    setIncognitoMode(allowed && next);
    setIncognito(allowed && next);
  }, [childStatus?.is_child]);

  useEffect(() => {
    document.body.classList.toggle("incognito-mode", incognito);
    return () => document.body.classList.remove("incognito-mode");
  }, [incognito]);

  useEffect(() => {
    const load = () => {
      api.childStatus().then((status) => {
        setIncognitoAllowed(!status.is_child);
        setChildStatus(status);
        setIncognito(isIncognitoMode());
      }).catch(() => {}).finally(() => setReady(true));
    };
    load();
  }, []);

  useEffect(() => {
    if (!childStatus?.is_child) return;
    if (incognito) changeIncognito(false);
    const load = () => { api.childStatus().then(setChildStatus).catch(() => {}); };
    return subscribeServerEvent("child-status", load);
  }, [childStatus?.is_child, incognito, changeIncognito]);

  useEffect(() => {
    if (childStatus?.locked && (location.pathname.startsWith("/watch/") || location.pathname.startsWith("/shorts"))) {
      navigate("/", { replace: true });
    }
  }, [childStatus?.locked, location.pathname, navigate]);

  useEffect(() => {
    if (childStatus?.hide_live && location.pathname === "/live") navigate("/", { replace: true });
  }, [childStatus?.hide_live, location.pathname, navigate]);

  useEffect(() => {
    if (childStatus?.hide_shorts && location.pathname.startsWith("/shorts")) navigate("/", { replace: true });
  }, [childStatus?.hide_shorts, location.pathname, navigate]);

  useEffect(() => {
    if (childStatus?.is_child && location.pathname === "/insights") navigate("/", { replace: true });
  }, [childStatus?.is_child, location.pathname, navigate]);

  return { changeIncognito, childStatus, incognito, ready };
}
