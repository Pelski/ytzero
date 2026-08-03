import { useEffect, useLayoutEffect } from "react";

const SIDEBAR_KEY = "sidebar_open";
export const MOBILE_SIDEBAR_QUERY = "(max-width: 760px)";

export const resolveSidebarHidden = (isMobile: boolean, storedPreference: string | null): boolean => isMobile || storedPreference === "0";

function syncSidebarVisibility(): void {
  const isMobile = window.matchMedia(MOBILE_SIDEBAR_QUERY).matches;
  document.body.classList.toggle("sidebar-hidden", resolveSidebarHidden(isMobile, localStorage.getItem(SIDEBAR_KEY)));
}
export function restoreSidebarVisibility(): void {
  document.body.classList.remove("cinema");
  syncSidebarVisibility();
}
export function toggleSidebar() {
  const hidden = document.body.classList.toggle("sidebar-hidden");
  if (!window.matchMedia(MOBILE_SIDEBAR_QUERY).matches) localStorage.setItem(SIDEBAR_KEY, hidden ? "0" : "1");
}
export function useSidebarVisibility(pathname: string) {
  useLayoutEffect(() => {
    const media = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    syncSidebarVisibility();
    media.addEventListener("change", syncSidebarVisibility);
    return () => media.removeEventListener("change", syncSidebarVisibility);
  }, []);
  useEffect(() => {
    if (window.matchMedia(MOBILE_SIDEBAR_QUERY).matches) document.body.classList.add("sidebar-hidden");
  }, [pathname]);
}
