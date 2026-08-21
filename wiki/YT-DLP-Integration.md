The **YT-DLP Integration** plugin downloads videos to local files with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and plays them back in YT Zero's own player instead of the embedded YouTube iframe. Downloads are shared by every profile — one file serves the whole household — and an automatic retention system keeps disk usage under control.

The plugin is **disabled by default**. An administrator enables it under
**Settings → Plugins**. Each profile then decides whether manual and automatic
downloads are allowed for that profile under **Downloads → Configuration**.

## Requirements

- **yt-dlp** and **ffmpeg** available on the server. The official Docker image bundles both and defaults to daily updates; for bare-metal installs put them on `PATH` (or point `YTDLP_PATH` at the binary). Administrators can update it immediately and choose the stable/nightly channel and schedule under **Downloads → Configuration**.
- Disk space for the downloads directory (`DOWNLOADS_DIR`, `/data/downloads` in Docker). See [Configuration](Configuration#environment-variables).

## What it does

- **Local playback** — a downloaded video plays in YT Zero's own player: instant seeking with buffered ranges, chapter markers and SponsorBlock segments drawn on the seek bar, keyboard shortcuts (Space/K, J/L, arrows, M, 0–9), picture-in-picture, Media Session integration, and the same progress tracking, auto-archive, and playback-speed behavior as the YouTube player. A **Local / YouTube** switch on the watch page lets you pick the source per video.
- **Download queue** — one download at a time, with priorities: videos a viewer is actively waiting for first, then manual requests, then scheduled videos, then fresh uploads. A priority download preempts the running job; the preempted download resumes later from its partial file.
- **Downloads tab** — a sidebar view with the active queue (collapsible), finished files, storage usage, per-item retry / pin / delete, and live progress. Removing an item from the queue rejects it permanently — automatic policies will not re-download it (a manual download request still can).
- **Thumbnail indicators** — a thin blue bar on top of a video's thumbnail shows download progress (dimmed while queued); downloaded videos get a small badge. The bar can be turned off (see settings below).
- **Automatic rules** — build profile-owned rules from all subscriptions or selected channels and followed playlists, required and excluded phrases, duration, content type, and a starting time range. A real preview shows how many items match before activation.
- **Playlist downloads** — queue every available video from a channel or personal playlist in one confirmed action.
- **Files and metadata** — choose a filename template and optionally save thumbnails, embedded metadata, `info.json`, NFO files, and selected subtitle languages.
- **Restricted content** — each profile can upload or paste its own Netscape-format `cookies.txt` for age-restricted or members-only videos. Cookie files are machine-local secrets and are never included in portable backups.
- **Smart retention** — each profile can remove files after a configurable number of days, optionally sooner once watched, or keep its downloads until manually deleted. The oldest unprotected files are still evicted when the shared storage cap is exceeded. Pinned downloads, liked videos (optional), and videos still scheduled by an unwatched profile are never auto-removed.
- **Child profiles** — a child profile can be restricted to downloaded files only; see [Child Lock](Child-Lock#child-profiles).

## Opening a video

The **Opening a video** setting decides what happens when you open a video that is not downloaded yet:

- **Play from YouTube** (default) — the embedded player starts immediately; downloads happen in the background.
- **Ask every time** — a chooser appears on the player: watch on YouTube now, or download first and watch locally.
- **Always wait for the download** — the video is queued with top priority and a progress screen is shown; playback starts automatically from the local file when the download finishes. You can always fall back to YouTube with one tap.

Choosing to wait queues the download with top priority: it preempts the currently running download, which resumes afterwards.

## Configuration

Open **Downloads → Configuration**. Most behavior is per profile, while options
marked **Administrator** affect the one physical download store shared by the
whole instance.

### Playback and quality

| Setting | Default | Description |
| --- | --- | --- |
| **Allow downloads for this profile** | off | Enables manual downloads, scheduled-video downloads, and this profile's automation rules. |
| **Video quality** | 1080p | Maximum resolution: best available, 1440p, 1080p, 720p, or 480p. Compatible H.264/AAC formats are preferred. |
| **Opening a video** | Play from YouTube | Chooses YouTube immediately, asks each time, or waits for a local download. |
| **Progress bar on thumbnails** | on | Shows queue and download progress on video cards. |
| **Download scheduled videos** | on | Automatically downloads videos placed in a watch-later bucket by this profile. |

### Download schedule

Each profile can optionally choose weekdays plus a start and end time under
**Downloads → Configuration**. Items may enter the queue at any time, but the
worker starts them only while at least one owning profile is inside its allowed
window. The schedule uses the instance timezone from **Settings → Appearance**.

Weekdays identify the day on which a window starts. For example, Monday with
`23:00`–`07:00` permits downloads from Monday 23:00 until Tuesday 07:00. Windows
that do not cross midnight work normally. A download already running when the
window closes is allowed to finish; RSS refresh, browsing, queueing, and the
rest of YT Zero remain available throughout.

### Files, storage, and access

The filename template defaults to `{playlist}/{id}`. Available tokens include
`{channel}`, `{title}`, `{id}`, `{date}`, `{year}`, `{month}`, `{day}`,
`{channel_id}`, and `{playlist}`; `/` creates subdirectories. Administrators can
also enable thumbnail files, embedded metadata, `info.json`, NFO, and subtitle
sidecars. Subtitle language and automatic-caption choices are per profile.

Retention defaults to 14 days, watched files receive a 24-hour grace period,
liked videos are protected, and the shared storage cap defaults to 25 GB. A
profile can instead keep downloads, which disables its age and watched cleanup
without protecting files from that shared cap. Pinned downloads are always
exempt from automatic cleanup. YouTube cookies are
stored separately for each profile and may be uploaded, pasted, replaced, or
removed from the same page.

### Automatic download rules

Open **Downloads → Automatic downloads** and create a rule. A rule can use all
subscriptions with channel exceptions, or selected channels and followed
playlists. It can match required phrases in the title, description, or both;
exclude phrases; include Shorts or members-only videos; enforce a minimum
duration; and start with only future videos, a recent lookback window, or all
known videos.

Rules are combined with OR: a video enters the queue when any active rule
matches. Exclusions apply only inside their own rule. Test mode saves a rule
without downloading, and the live preview uses the same matcher as the queue.
Activating a rule with a large initial result requires confirmation.

### Experimental streaming

**Stream while downloading** is off by default. It starts an HLS stream while
yt-dlp and ffmpeg continue saving the normal local copy. Seeking beyond the
downloaded region waits for the stream to catch up. It requires ffmpeg, uses
H.264, and is currently limited to roughly 1080p; keep it disabled when
reliability matters more than immediate playback.

**Reset plugin** removes the active profile's download ownership, rules, and
plugin settings. Shared files survive while another profile still owns them;
files with no remaining owner are removed. Treat it as destructive.

## How it works

- Downloads run on the server one at a time with automatic retries (3 attempts with backoff) and crash recovery on restart. Waiting viewers, manual requests, automation, and scheduled items receive different queue priorities, while per-profile download windows determine which queued item may start.
- Paths are rendered from the configured filename template inside `DOWNLOADS_DIR`; the video ID is added when necessary to keep names unique and cleanup-safe. Files use HTTP Range playback, so seeking does not restart the transfer.
- Every completed download also receives a small recovery sidecar grouped with the media file, for example `Channel - Title [videoId].ytz.json`. It records the YouTube video ID, the relative media-file name, and its size. Existing healthy downloads from versions that predate sidecars receive a missing sidecar during maintenance, without downloading the media again. When `DOWNLOADS_DIR` is moved, YT Zero scans these sidecars before cleanup and reconnects known downloads automatically; older `<videoId>.ytz.json` names remain supported and are regrouped when found. Legacy YT Zero media without a sidecar is recovered when its filename contains one unambiguous known video ID, and receives a new sidecar. Files that cannot be identified are left untouched rather than deleted.
- An item removed from the queue or the Downloads tab leaves a tombstone: automatic policies treat it as rejected and never bring it back. A manual download request clears the tombstone.
- The image cache already stores thumbnails locally, so a downloaded video plays fully offline.

## Related environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `DOWNLOADS_DIR` | `./data/downloads` (`/data/downloads` in Docker) | Where downloaded files are stored. |
| `DOWNLOAD_COOKIES_DIR` | `./data/download-cookies` (`/data/download-cookies` in Docker) | Private per-profile cookie files. |
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp binary. |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg for merged downloads and experimental streaming. |
| `YTDLP_AUTO_UPDATE` | unset (`1` in Docker) | Initial automatic-update default (`1` means daily). The Downloads UI can later select Never, 1, 3, 7, or 30 days and the stable/nightly channel. |
