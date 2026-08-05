import { api } from "./api";

let request: ReturnType<typeof api.live> | null = null;

/** Sidebar and Live page share one profile-specific snapshot request. */
export function loadLiveVideos() {
  if (request) return request;
  request = api.live().finally(() => { request = null; });
  return request;
}
