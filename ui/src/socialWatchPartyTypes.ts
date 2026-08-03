import type { SocialProfileRef } from "./apiTypes";

export interface SocialWatchPartyPlayback {
  revision: number;
  position: number;
  paused: boolean;
  playback_rate: number;
  /** Server event timestamp for diagnostics; clients project from local receipt time. */
  updated_at: number;
}

export interface SocialWatchPartyMessage {
  id: string;
  sequence: number;
  body: string;
  created_at: string;
  author: SocialProfileRef;
}

export interface SocialWatchParty {
  id: string;
  video_id: string;
  host: SocialProfileRef;
  participants: SocialProfileRef[];
  messages: SocialWatchPartyMessage[];
  playback: SocialWatchPartyPlayback;
  created_at: string;
}

export type SocialWatchPartyEvent =
  | { type: "snapshot"; room: SocialWatchParty; self_id: number }
  | { type: "playback"; playback: SocialWatchPartyPlayback }
  | { type: "message"; message: SocialWatchPartyMessage }
  | { type: "presence"; host: SocialProfileRef; participants: SocialProfileRef[] }
  | { type: "closed"; reason?: string };
