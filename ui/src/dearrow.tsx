import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type DeArrowBranding } from "./api";

interface DeArrowOptions {
  titlesEnabled: boolean;
  thumbnailsEnabled: boolean;
}

const DeArrowContext = createContext<DeArrowOptions>({ titlesEnabled: false, thumbnailsEnabled: false });
const brandingCache = new Map<string, Promise<DeArrowBranding>>();

export function DeArrowProvider({ titlesEnabled, thumbnailsEnabled, children }: DeArrowOptions & { children: ReactNode }) {
  const value = useMemo(() => ({ titlesEnabled, thumbnailsEnabled }), [titlesEnabled, thumbnailsEnabled]);
  return <DeArrowContext.Provider value={value}>{children}</DeArrowContext.Provider>;
}

export function useDeArrowBranding(videoId: string): DeArrowBranding | null {
  const { titlesEnabled, thumbnailsEnabled } = useContext(DeArrowContext);
  const [branding, setBranding] = useState<DeArrowBranding | null>(null);

  useEffect(() => {
    let active = true;
    if (!titlesEnabled && !thumbnailsEnabled) {
      setBranding(null);
      return () => { active = false; };
    }
    const cacheKey = `${videoId}:${titlesEnabled ? 1 : 0}:${thumbnailsEnabled ? 1 : 0}`;
    let request = brandingCache.get(cacheKey);
    if (!request) {
      request = api.dearrow(videoId).catch(() => ({ title: null, thumbnail: null }));
      brandingCache.set(cacheKey, request);
    }
    request.then((next) => { if (active) setBranding(next); });
    return () => { active = false; };
  }, [thumbnailsEnabled, titlesEnabled, videoId]);

  return branding;
}
