import { useEffect, useLayoutEffect } from "react";

const SIDEBAR_KEY = "sidebar_open";
export const MOBILE_SIDEBAR_QUERY = "(max-width: 760px)";

export function toggleSidebar() {
  const hidden = document.body.classList.toggle("sidebar-hidden");
  if (!window.matchMedia(MOBILE_SIDEBAR_QUERY).matches) {
    localStorage.setItem(SIDEBAR_KEY, hidden ? "0" : "1");
  }
}

export function useSidebarVisibility(pathname: string) {
  useLayoutEffect(() => {
    const media = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    const syncSidebar = () => {
      if (media.matches) document.body.classList.add("sidebar-hidden");
      else document.body.classList.toggle("sidebar-hidden", localStorage.getItem(SIDEBAR_KEY) === "0");
    };
    syncSidebar();
    media.addEventListener("change", syncSidebar);
    return () => media.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    if (window.matchMedia(MOBILE_SIDEBAR_QUERY).matches) {
      document.body.classList.add("sidebar-hidden");
    }
  }, [pathname]);
}
