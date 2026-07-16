The **YT-DLP Integration** plugin downloads videos to local files with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and plays them back in YT Zero's own player instead of the embedded YouTube iframe. Downloads are shared by every profile — one file serves the whole household — and an automatic retention system keeps disk usage under control.

The plugin is **disabled by default**. Enable it in **Settings → Plugins → YT-DLP Integration**.

## Requirements

- **yt-dlp** and **ffmpeg** available on the server. The official Docker image bundles both and self-updates yt-dlp daily; for bare-metal installs put them on `PATH` (or point `YTDLP_PATH` at the binary) and keep yt-dlp current — YouTube regularly stops serving formats to outdated versions.
- Disk space for the downloads directory (`DOWNLOADS_DIR`, `/data/downloads` in Docker). See [Configuration](Configuration#environment-variables).

## What it does

- **Local playback** — a downloaded video plays in YT Zero's own player: instant seeking with buffered ranges, chapter markers and SponsorBlock segments drawn on the seek bar, keyboard shortcuts (Space/K, J/L, arrows, M, 0–9), picture-in-picture, Media Session integration, and the same progress tracking, auto-archive, and playback-speed behavior as the YouTube player. A **Local / YouTube** switch on the watch page lets you pick the source per video.
- **Download queue** — one download at a time, with priorities: videos a viewer is actively waiting for first, then manual requests, then scheduled videos, then fresh uploads. A priority download preempts the running job; the preempted download resumes later from its partial file.
- **Downloads tab** — a sidebar view with the active queue (collapsible), finished files, storage usage, per-item retry / pin / delete, and live progress. Removing an item from the queue rejects it permanently — automatic policies will not re-download it (a manual download request still can).
- **Thumbnail indicators** — a thin blue bar on top of a video's thumbnail shows download progress (dimmed while queued); downloaded videos get a small badge. The bar can be turned off (see settings below).
- **Smart retention** — files are removed after a configurable number of days, optionally sooner once watched, and the oldest unprotected files are evicted when the storage cap is exceeded. Pinned downloads, liked videos (optional), and videos still scheduled by an unwatched profile are never auto-removed.
- **Child profiles** — a child profile can be restricted to downloaded files only; see [Child Lock](Child-Lock#child-profiles).

## Opening a video

The **Opening a video** setting decides what happens when you open a video that is not downloaded yet:

- **Play from YouTube** (default) — the embedded player starts immediately; downloads happen in the background.
- **Ask every time** — a chooser appears on the player: watch on YouTube now, or download first and watch locally.
- **Always wait for the download** — the video is queued with top priority and a progress screen is shown; playback starts automatically from the local file when the download finishes. You can always fall back to YouTube with one tap.

Choosing to wait queues the download with top priority: it preempts the currently running download, which resumes afterwards.

## Settings reference

All plugin settings are app-wide (one downloads directory serves every profile) and live in **Settings → Plugins → YT-DLP Integration → Configure**.

### Downloading

| Setting | Default | Description |
| --- | --- | --- |
| **Video quality** | 1080p | Maximum resolution to download (best / 1440p / 1080p / 720p / 480p). Prefers h264+AAC so the resulting MP4 plays natively in every browser. |
| **Opening a video** | Play from YouTube | Behavior for videos that are not downloaded yet — see above. |
| **Progress bar on thumbnails** | on | Shows the thin download-progress bar on top of video thumbnails; turn off to hide it app-wide. |
| **Download scheduled videos** | on | Videos placed on a watch-later bucket by any profile are fetched automatically (only items scheduled within the last 30 days, so enabling the plugin doesn't crawl years of backlog). |
| **Download new uploads** | off | Fresh videos from followed channels are fetched as they appear. |
| **New upload window (hours)** | 48 | Only uploads younger than this are auto-downloaded from the feed. |
| **Include Shorts** | off | Also auto-download Shorts from the feed. Explicitly scheduled Shorts download regardless. |

### Retention & storage

| Setting | Default | Description |
| --- | --- | --- |
| **Keep files for (days)** | 14 | Downloads are removed this many days after they finished. |
| **Remove after watching** | on | Once watched, the file is removed after the grace period below. |
| **Watched grace period (hours)** | 24 | How long a watched file sticks around before removal. |
| **Protect liked videos** | on | Liked videos are never auto-removed by retention or the storage cap. |
| **Storage cap (GB)** | 25 | Above this, the oldest unprotected downloads are removed first. |

Pinned downloads (the pin button in the Downloads tab) are exempt from all automatic cleanup.

**Reset plugin** removes every downloaded file, clears the queue and history, and restores default settings.

## How it works

- Downloads run on the server with `yt-dlp -S res:<height>,vcodec:h264,acodec:m4a --merge-output-format mp4`, one at a time, with automatic retries (3 attempts with backoff) and crash recovery on restart.
- Files are stored as `<video_id>.mp4` in `DOWNLOADS_DIR` and streamed to the player with HTTP Range support, so seeking never re-downloads.
- An item removed from the queue or the Downloads tab leaves a tombstone: automatic policies treat it as rejected and never bring it back. A manual download request clears the tombstone.
- The image cache already stores thumbnails locally, so a downloaded video plays fully offline.

## Related environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DOWNLOADS_DIR` | `./data/downloads` (`/data/downloads` in Docker) | Where downloaded files are stored. |
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp binary. |
| `YTDLP_AUTO_UPDATE` | unset (`1` in Docker) | Set to `1` to run `yt-dlp -U` daily. |
