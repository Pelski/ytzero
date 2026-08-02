import { Link } from "react-router-dom";
import { markYouTubeUrl } from "../../youtubeUrl";

/** Render plain text with URLs turned into clickable links. */
function rewriteYouTubeUrl(url: string, base: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    if (h === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      if (id) return `${base}/watch/${id}`;
    }
    if (h === "youtube.com") {
      if (u.pathname.startsWith("/shorts/")) {
        const id = u.pathname.split("/")[2];
        if (id) return `${base}/watch/${id}`;
      }
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        if (id) return `${base}/watch/${id}`;
      }
      if (u.pathname.startsWith("/channel/")) {
        const id = u.pathname.split("/")[2];
        if (id) return `${base}/channel/${id}`;
      }
    }
  } catch {}
  return null;
}

// YouTube glues a truncation marker straight onto long links in descriptions
// (e.g. "https://makerworld.com...​" with a trailing ellipsis + zero-width
// space). Peel that — plus stray trailing punctuation — off the URL so the href
// isn't broken and the leftover renders as plain text, the way YouTube shows it.
function splitTrailingJunk(url: string): [string, string] {
  let u = url;
  let trailing = "";
  const junk = /(\.\.\.|[​‌‍﻿…)\].,;:!?'"»」]+)$/;
  let m: RegExpMatchArray | null;
  while ((m = u.match(junk)) && m[0].length && u.length - m[0].length > "https://".length) {
    trailing = m[0] + trailing;
    u = u.slice(0, u.length - m[0].length);
  }
  return [u, trailing];
}

function MentionText({ text, channelHandles }: { text: string; channelHandles: Map<string, string> }) {
  const parts = text.split(/(@[\p{L}\p{N}._-]+)/gu);
  return parts.map((part, index) => {
    const channelId = part.startsWith("@") ? channelHandles.get(part.toLocaleLowerCase()) : undefined;
    return channelId ? (
      <Link key={index} to={`/channel/${channelId}`} className="desc-link" onClick={(event) => event.stopPropagation()}>
        {part}
      </Link>
    ) : part;
  });
}

export default function Linkify({ text, baseUrl, channelHandles = new Map() }: { text: string; baseUrl: string; channelHandles?: Map<string, string> }) {
  const base = baseUrl || window.location.origin;
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!/^https?:\/\//.test(p)) return <MentionText key={i} text={p} channelHandles={channelHandles} />;
        const [url, trailing] = splitTrailingJunk(p);
        const local = rewriteYouTubeUrl(url, base);
        return (
          <span key={i}>
            {local ? (
              <a href={local} className="desc-link" onClick={(e) => e.stopPropagation()}>
                {url}
              </a>
            ) : (
              <a href={markYouTubeUrl(url)} target="_blank" rel="noreferrer" className="desc-link" onClick={(e) => e.stopPropagation()}>
                {url}
              </a>
            )}
            {trailing}
          </span>
        );
      })}
    </>
  );
}

