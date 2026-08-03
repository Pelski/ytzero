import type {
  SocialWatchParty,
  SocialWatchPartyMessage,
  SocialWatchPartyPlayback,
} from "./socialWatchPartyTypes";

type Http = <T>(
  path: string,
  init?: RequestInit,
  options?: { suppressAuthenticationNavigation?: boolean },
) => Promise<T>;

export function createSocialWatchPartyApi(http: Http) {
  return {
    createSocialWatchParty: (video_id: string, playback: { position: number; paused: boolean; playback_rate: number }) =>
      http<{ room: SocialWatchParty; self_id: number }>("/social/watch-parties", { method: "POST", body: JSON.stringify({ video_id, playback }) }),
    socialWatchParty: (id: string) =>
      http<{ room: SocialWatchParty; self_id: number }>(`/social/watch-parties/${encodeURIComponent(id)}`),
    socialWatchPartyEvents: (id: string) =>
      new EventSource(`/api/social/watch-parties/${encodeURIComponent(id)}/events`),
    updateSocialWatchPartyPlayback: (id: string, playback: { position: number; paused: boolean; playback_rate: number; expected_revision: number; client_event_id: string }) =>
      http<{ playback: SocialWatchPartyPlayback }>(`/social/watch-parties/${encodeURIComponent(id)}/playback`, { method: "PUT", body: JSON.stringify(playback) }),
    sendSocialWatchPartyMessage: (id: string, body: string) =>
      http<{ message: SocialWatchPartyMessage }>(`/social/watch-parties/${encodeURIComponent(id)}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
    closeSocialWatchParty: (id: string) =>
      http<{ ok: true }>(`/social/watch-parties/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
}
