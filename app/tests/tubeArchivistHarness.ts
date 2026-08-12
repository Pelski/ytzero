const calls: Array<{ path: string; authorization: string | null; range: string | null; body: string | null }> = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const headers = new Headers(init?.headers);
  calls.push({ path: `${url.pathname}${url.search}`, authorization: headers.get("authorization"), range: headers.get("range"), body: typeof init?.body === "string" ? init.body : null });
  if (url.pathname === "/api/video/") return Response.json({
    data: [{
      youtube_id: "taVideo01",
      title: "Archived video",
      description: "From TubeArchivist",
      published: "2026-08-10T12:00:00Z",
      date_downloaded: "2026-08-11T08:00:00Z",
      media_url: "/media/UCarchive/taVideo01.mp4",
      vid_thumb_url: "/cache/videos/taVideo01.jpg",
      subtitles: [{ lang: "pl", media_url: "/media/UCarchive/taVideo01.pl.vtt" }],
      channel: { channel_id: "UCarchive", channel_name: "Archive channel" },
    }],
    paginate: { current_page: 1, last_page: 1, next_pages: null },
  });
  if (url.pathname.endsWith("/comment/")) return Response.json({ data: [{ comment_id: "c1", comment_text: "Archived comment", comment_author: "Viewer" }] });
  if (url.pathname === "/api/watched/") return Response.json({ ok: true });
  if (url.pathname.endsWith(".mp4")) return new Response(new Uint8Array([1, 2, 3, 4]), { status: headers.has("range") ? 206 : 200, headers: { "Content-Type": "video/mp4", "Content-Length": "4", "Accept-Ranges": "bytes", ...(headers.has("range") ? { "Content-Range": "bytes 0-3/4" } : {}) } });
  if (url.pathname.endsWith(".jpg")) return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "Content-Type": "image/jpeg" } });
  if (url.pathname.endsWith(".vtt")) return new Response("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCześć", { headers: { "Content-Type": "text/vtt" } });
  if (url.pathname === "/api/ping/") return Response.json({ version: "v0.test" });
  return new Response(null, { status: 404 });
}) as typeof fetch;

const { api } = await import("../src/routes");
const { db } = await import("../src/db");
const { pluginEnabled, setPluginEnabled } = await import("../src/plugins");
const { flushTubeArchivistWatched, saveTubeArchivistConfig, stopTubeArchivistSync, syncTubeArchivist } = await import("../src/tubeArchivist");

const enabledByDefault = pluginEnabled("tubearchivist");
const callsBeforeEnable = calls.length;
saveTubeArchivistConfig({ baseUrl: "http://ta.local:8000", token: "sentinel-secret-token" });
await setPluginEnabled("tubearchivist", true);
const synced = await syncTubeArchivist();

const request = (path: string, init?: RequestInit) => api.request(`http://localhost${path}`, { ...init, headers: { Cookie: "ytzero_profile=1", "Content-Type": "application/json", ...init?.headers } });
const feed = await (await request("/feed?limit=20")).json() as any;
const video = await (await request("/videos/taVideo01")).json() as any;
const comments = await (await request("/videos/taVideo01/comments")).json() as any;
const subtitles = await (await request("/videos/taVideo01/subtitles")).json() as any;
const streamResponse = await request("/videos/taVideo01/stream", { headers: { Range: "bytes=0-3" } });
await streamResponse.arrayBuffer();
await request("/videos/taVideo01/complete", { method: "POST", body: "{}" });
await flushTubeArchivistWatched();
const statusResponse = await request("/plugins/tubearchivist/config");
const statusText = await statusResponse.text();

await setPluginEnabled("tubearchivist", false);
const disabledFeed = await (await request("/feed?limit=20")).json() as any;
const disabledStream = await request("/videos/taVideo01/stream");
stopTubeArchivistSync();

console.log("RESULT " + JSON.stringify({
  enabledByDefault,
  callsBeforeEnable,
  synced,
  feedIds: feed.videos.map((item: any) => item.video_id),
  localMediaSource: video.video?.local_media_source ?? video.local_media_source,
  comments: comments.comments,
  subtitles: subtitles.subtitles,
  streamStatus: streamResponse.status,
  forwardedRange: calls.find((call) => call.path.endsWith(".mp4"))?.range,
  watchedCall: calls.find((call) => call.path === "/api/watched/")?.body,
  everyUpstreamCallAuthenticated: calls.every((call) => call.authorization === "Token sentinel-secret-token"),
  statusLeaksToken: statusText.includes("sentinel-secret-token"),
  disabledFeedIds: disabledFeed.videos.map((item: any) => item.video_id),
  disabledStreamStatus: disabledStream.status,
}));

globalThis.fetch = originalFetch;
db.close();
