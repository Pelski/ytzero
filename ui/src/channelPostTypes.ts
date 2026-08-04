import type { Video } from "./apiTypes";

export interface ChannelPostImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface ChannelPostAttachment {
  type: "video" | "playlist" | "poll";
  id: string | null;
  title: string;
  thumbnail: string | null;
  choices?: Array<{ text: string; votes: string | null }>;
}

export interface ChannelPost {
  id: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  publishedAt: string | null;
  publishedText: string;
  likeCount: string;
  replyCount: string;
  images: ChannelPostImage[];
  attachment: ChannelPostAttachment | null;
  localVideo: Video | null;
  url: string;
}
