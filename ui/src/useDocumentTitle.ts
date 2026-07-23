import { createContext, useContext, useEffect } from "react";

// The configurable app name, shared so every page can suffix its tab title with
// it. Defaults to the bundled name for surfaces rendered before config loads
// (e.g. the login screen).
export const AppNameContext = createContext("YT Zero");

/**
 * Sets the browser tab title for the current page. Pass the page-specific part
 * (a section name, channel, playlist or video title); it is combined with the
 * app name as "Title · App". Pass nothing/empty for the home feed to show just
 * the app name. Dynamic titles that arrive after a fetch update the tab live.
 */
export function useDocumentTitle(title?: string | null) {
  const appName = useContext(AppNameContext);
  useEffect(() => {
    const part = title?.trim();
    document.title = part ? `${part} · ${appName}` : appName;
  }, [title, appName]);
}
