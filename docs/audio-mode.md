# Audio mode

Audio mode replaces the watch-page video player with a compact audio-only
player. It is intended for music, podcasts, long-form videos, and livestreams
that should continue playing while the browser is in the background. On iOS
Safari and other supported mobile browsers, it can continue from the lock
screen and exposes system controls through the Media Session API.

## Using audio mode

Open a video and use the audio/video control near the player controls. The
current playback position is handed to the audio player when switching from a
regular video and handed back when returning to video. Audio mode participates
in the normal progress, completion, playlist, and continuous-playback flow.

The choice is stored in browser `localStorage`, namespaced by the active
profile. It remains enabled while navigating between videos, but only in that
browser and for that profile. It is not a server setting, does not follow the
profile to another device, and is not included in backups.

## Requirements and supported content

The YT Zero server must have a working [yt-dlp](https://github.com/yt-dlp/yt-dlp)
installation and Deno 2.3 or newer available on `PATH`. Deno runs yt-dlp's
JavaScript challenge solver for videos that YouTube does not expose without
that step. The official Docker image and native installer bundle both. Audio
mode is independent of the downloads plugin: it resolves and proxies audio on demand without
writing a media file to disk or requiring downloads to be enabled.

Audio mode is available for:

- regular public videos with a compatible AAC audio stream;
- active public livestreams with a compatible HLS audio stream.

It is not available for upcoming, private, members-only, or unavailable videos,
child profiles, or Watch Together sessions. An ended livestream can use the
regular-video path after YouTube publishes a compatible audio format.

## How streaming works

For regular videos, yt-dlp resolves an AAC stream in an MP4 container. YT Zero
proxies bounded byte ranges with explicit length and range headers so playback
and seeking work reliably in iOS Safari. There is no transcoding and signed
upstream media URLs are not exposed to the browser.

For active livestreams, yt-dlp resolves an HLS audio rendition. YT Zero rewrites
the rolling playlist and proxies its manifests and segments through opaque,
same-origin URLs. Redirects between allowed YouTube media hosts are followed
with every hop revalidated against the media-host allowlist.

Resolved sources and live sessions are isolated by profile because yt-dlp may
use profile-specific YouTube cookies. They are kept only as short-lived runtime
cache entries and are invalidated when their upstream source expires or fails.

## Controls and browser behavior

The audio player provides play/pause, seeking for regular videos, elapsed and
remaining time, volume and mute controls, playback speed where applicable, and
live-state presentation for broadcasts. Media Session metadata includes the
video title, channel, and thumbnail.

Background and lock-screen playback ultimately depend on browser and operating
system policy. iOS may still stop playback under memory pressure, after a
network change, or when a live playlist is temporarily unavailable.

## Errors and retrying

If no compatible source can be resolved, the player displays **Try again**.
Each retry invalidates the previous source instead of reusing a failed cache
entry and asks yt-dlp to resolve it again. After three unsuccessful attempts,
the control is disabled and the player suggests trying again later.

The backend also refreshes the video's current live status after a failed
resolution. This repairs rows imported through channel RSS without a live
marker and automatically changes between progressive and livestream audio when
YouTube reports a different current state.

Useful server log events include:

- `audio.source_attempt_failed` and `audio.source_resolution_failed`;
- `audio.upstream_failed` and `audio.upstream_redirect`;
- `audio.live_status_probe_failed`;
- `video.live_status_corrected`;
- `downloads.ytdlp_js_runtime_missing` when Deno cannot be executed.

These diagnostics contain video/profile identifiers and safe failure reasons,
but do not log signed media URLs or cookie contents.
