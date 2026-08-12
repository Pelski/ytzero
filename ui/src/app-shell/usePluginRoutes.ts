import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { subscribe } from "../events";

export function usePluginRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  const [enabledPluginRoutes, setEnabledPluginRoutes] = useState<Set<string> | null>(null);
  const [knownPluginRoutes, setKnownPluginRoutes] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  const loadPlugins = useCallback(() => {
    api.plugins()
      .then((result) => {
        setKnownPluginRoutes(new Set(result.plugins.flatMap((plugin) => plugin.route ? [plugin.route] : [])));
        setEnabledPluginRoutes(new Set(result.plugins.filter((plugin) => plugin.enabled).flatMap((plugin) => plugin.route ? [plugin.route] : [])));
        api.downloadConfig()
          .then((config) => {
            document.documentElement.dataset.dlThumbProgress = config.enabled
              ? String(config.settings.thumb_progress ?? 1)
              : "0";
          })
          .catch(() => { document.documentElement.dataset.dlThumbProgress = "0"; });
      })
      .catch(() => {
        setKnownPluginRoutes(new Set(["/recommendations", "/social"]));
        setEnabledPluginRoutes(new Set());
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(loadPlugins, [loadPlugins]);
  useEffect(() => subscribe("plugins-changed", loadPlugins), [loadPlugins]);
  useEffect(() => {
    if (!enabledPluginRoutes) return;
    if (knownPluginRoutes.has(location.pathname) && !enabledPluginRoutes.has(location.pathname)) {
      navigate("/", { replace: true });
    }
  }, [enabledPluginRoutes, knownPluginRoutes, location.pathname, navigate]);

  return { enabledPluginRoutes, knownPluginRoutes, ready };
}
