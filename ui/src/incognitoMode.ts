const INCOGNITO_MODE_KEY = "ytzero_incognito_mode";

export function isIncognitoMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(INCOGNITO_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setIncognitoMode(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.sessionStorage.setItem(INCOGNITO_MODE_KEY, "1");
    else window.sessionStorage.removeItem(INCOGNITO_MODE_KEY);
  } catch {
    // A sandboxed browser context may deny session storage. Incognito then
    // remains off rather than breaking the application shell.
  }
}
