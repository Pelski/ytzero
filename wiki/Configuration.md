YT Zero is configured through environment variables. All of them are optional and have sensible defaults.

The application timezone is configured inside **Settings → Appearance → Timezone**
using an IANA name such as `Europe/London`. It controls dates and times across
the UI, scheduling, logs, Insights/Pulse, backups, imports, cleanup boundaries,
and child daily limits. It does not depend on the browser timezone or the
container's `TZ` environment variable.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP server port. |
| `IDLE_TIMEOUT_SECONDS` | `120` | HTTP idle timeout. Manual channel sync can take longer than Bun's 10-second default when playlist scanning is enabled. |
| `DB_PATH` | `./data/db/ytzero.db` | SQLite database path. |
| `SQLITE_BUSY_TIMEOUT_MS` | `5000` | How long SQLite waits for another process to release a database lock before returning `SQLITE_BUSY` (`0`–`60000`). |
| `SQLITE_OPTIMIZE_INTERVAL_HOURS` | `24` | Interval for bounded planner-statistics maintenance on a long-lived SQLite connection (`1`–`168`). |
| `IMG_CACHE_DIR` | `./data/imgcache` | Thumbnail and image cache directory. |
| `IMG_CACHE_TTL_DAYS` | `5` | How long a cached image is fresh before a refetch is attempted. |
| `AVATAR_DIR` | `./data/avatars` | Uploaded profile avatars. |
| `LOG_PATH` | `./data/logs/ytzero.log` | Active log file. Logs also go to stdout and rotate daily in the timezone selected in Settings, to dated files such as `ytzero-2026-07-26.log`; archives are retained. The in-app viewer reads the active file. |
| `REFRESH_INTERVAL_MINUTES` | `5` | Followed-channel RSS refresh interval. |
| `ADAPTIVE_REFRESH_MIN_MINUTES` | `10` | Minimum automatic interval for one channel feed. This is the hard cooldown that prevents frequent uploaders from being polled continuously. |
| `ADAPTIVE_REFRESH_MAX_MINUTES` | `720` | Maximum automatic interval for one channel feed. This guarantees that infrequent channels remain in the refresh rotation. |
| `ADAPTIVE_REFRESH_UNKNOWN_MINUTES` | `120` | Automatic interval used until a channel has at least three known publication dates. |
| `ADAPTIVE_REFRESH_INACTIVE_MAX_MINUTES` | `4320` | Maximum adaptive interval for channels without recent uploads (up to three days). |
| `FULL_SYNC_INTERVAL_MINUTES` | `15` | Interval between full, rotating channel scans. One subscribed channel is scanned per run, using the same process as the manual channel sync button. |
| `PLAYLIST_SYNC_INTERVAL_MINUTES` | `15` | Interval between followed-playlist refreshes. One playlist is synchronized per run. |
| `LIVE_INTERVAL_MINUTES` | `3` | Followed-channel live-status check interval. This does not refetch old video metadata. |
| `AVATAR_REFRESH_INTERVAL_MINUTES` | `60` | Interval for refreshing stale channel avatars. |
| `AVATAR_REFRESH_BATCH_SIZE` | `4` | Maximum channel avatars refreshed in one maintenance pass. |
| `DURATION_INTERVAL_MINUTES` | `3` | Interval for the background job that backfills missing video durations. |
| `DURATION_BATCH_SIZE` | `20` | Videos processed per duration-backfill run. |
| `IMPORT_ENRICH_INTERVAL_MINUTES` | `2` | Interval for the background job that fills in real metadata for videos brought in by a [Takeout import](Importing-from-Google-Takeout). |
| `IMPORT_ENRICH_BATCH_SIZE` | `15` | Videos processed per import-enrichment run. Together with the interval, this sets the pace shown in the import wizard's time estimate. |
| `VIDEO_MAINTENANCE_MAX_AGE_DAYS` | `90` | Maximum video age considered by automatic Shorts and duration backfills. Older videos are resolved only when accessed or manually synchronized. |
| `UI_DIST` | `./public` | Built frontend directory served by the backend. |
| `DOWNLOADS_DIR` | `./data/downloads` | Where the [YT-DLP Integration](YT-DLP-Integration) plugin stores downloaded video files and their `<videoId>.ytz.json` recovery sidecars. Move each sidecar with its media file. |
| `DOWNLOAD_COOKIES_DIR` | `./data/download-cookies` | Machine-local directory for per-profile YouTube cookie files. Keep it private and inside persistent storage. |
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp binary used by the [YT-DLP Integration](YT-DLP-Integration) plugin. |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg, used for merged downloads and experimental stream-while-downloading playback. |
| `YTDLP_AUTO_UPDATE` | _(unset; `1` in Docker)_ | Set to `1` to run `yt-dlp -U` once a day. YouTube regularly stops serving formats to outdated yt-dlp versions, so keeping it current matters. |
| `APP_URL` | _(derived from request)_ | Public base URL. Used as the OIDC redirect origin and WebAuthn origin when behind a reverse proxy. |
| `WEBAUTHN_RP_ID` | _(request hostname)_ | Override the WebAuthn Relying Party ID (the registrable domain) when the auto-derived hostname is wrong. |
| `YTZERO_AUTH_DISABLE` | _(unset)_ | Set to `1` to force the **None** auth method regardless of the saved setting. Emergency unlock if an auth method locks you out — see [Authentication](Authentication#recovery-anti-lockout). |
| `YTZERO_VERSION` | `dev` | Version reported by `/api/health`. Set by the Docker build and by the native installer; there is no reason to set it by hand. |
| `DATABASE_URL` | _(unset)_ | PostgreSQL connection URL. When unset, YT Zero uses SQLite at `DB_PATH`. Migrate from Dangerous settings before enabling this value. |
| `DATABASE_STATE_PATH` | next to the data directory | Machine-local marker used to detect an unexpected engine/location change. It contains fingerprints and migration receipt IDs, never credentials. |
| `RESTORE_SESSION_DIR` | `./data/restore-sessions` | Temporary staging directory for validated portable-restore sessions. |

The path defaults above are relative to the source tree, not to the working
directory: unset, they resolve to a `data/` directory next to `app/`. Docker and
the native installer both set every path explicitly, so this only matters when
you run YT Zero straight from a checkout.

## Method-specific configuration

### Docker and Docker Compose

Set variables in the Compose service's `environment` block, then recreate the
container:

```yaml
environment:
  APP_URL: https://ytzero.example.com
  REFRESH_INTERVAL_MINUTES: 10
```

```bash
docker compose up -d
```

Keep all state under the mounted `/data` path. When changing a path variable in
Docker, point it somewhere below `/data` or add another persistent mount.

### Native Debian/Ubuntu and Proxmox LXC

The installer writes `/etc/ytzero/ytzero.env`. It is retained during updates,
so edit it directly and restart the service:

```bash
sudoedit /etc/ytzero/ytzero.env
systemctl restart ytzero
systemctl status ytzero
```

For a Proxmox-managed container, enter it first with `pct enter <CTID>`, or run
the restart from the host with:

```bash
pct exec <CTID> -- systemctl restart ytzero
```

The installer sets database, cache, download, avatar, log, frontend and yt-dlp
paths explicitly. If you move `YTZERO_DATA` after installation, update the path
variables and the systemd unit's `ReadWritePaths`, then run `systemctl
daemon-reload`. Using the install-time `YTZERO_DATA` knob for a new install is
less error-prone.

### Unraid

Choose **Docker → YT Zero → Edit** and add or change variables in the template.
Applying the change recreates the container without touching the host data path.
Keep `/data` mapped to `/mnt/user/appdata/ytzero` (or another persistent share).
For OIDC or passkeys behind a reverse proxy, add `APP_URL` with the complete
external HTTPS URL.

## Health check

`GET /api/health` needs no authentication and returns `200` with
`{"status":"ok","version":"…","uptime":…}`, or `503` if the database cannot be
reached. The Docker image has a `HEALTHCHECK` wired to it; use it for reverse
proxy probes, Unraid, or uptime monitoring.

## Docker Compose

The bundled Compose file sets:

```yaml
DB_PATH=/data/db/ytzero.db
IMG_CACHE_DIR=/data/imgcache
DOWNLOADS_DIR=/data/downloads
YTDLP_AUTO_UPDATE=1
IDLE_TIMEOUT_SECONDS=120
REFRESH_INTERVAL_MINUTES=5
```

The image bundles **yt-dlp** and **ffmpeg** for the [YT-DLP Integration](YT-DLP-Integration) plugin; downloaded videos land in the mounted `./data/downloads`.

and mounts:

```text
./data:/data
```

### Moving from SQLite to PostgreSQL

1. Create an empty PostgreSQL database. Do not point YT Zero at it yet.
2. Open **Settings → Dangerous → Database**, paste the PostgreSQL URL, and run the migration. YT Zero pauses new mutations, copies a consistent SQLite snapshot in batches, recreates constraints, and verifies row counts plus primary-key checksums. The source SQLite file is not modified.
3. Set `DATABASE_URL` to the same URL and restart YT Zero.
4. Return to **Settings → Dangerous → Database**. The app verifies the migration receipt stored in PostgreSQL before it lets you confirm the new active database.

The connection URL is accepted only for the migration request and is not saved in application state or logs. Keep it in your secret-management mechanism. The target must be empty; a partial or existing schema is rejected.

For Docker Compose, the optional override can be used with the main file:

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
```

Back up PostgreSQL with the tools supplied by your PostgreSQL operator (for example `pg_dump` plus tested restore procedures). Portable YT Zero backups remain engine-independent, but they intentionally exclude secrets, downloads, caches, and database implementation metadata.

On a brand-new installation you may set `DATABASE_URL` from the first start. YT Zero initializes an empty PostgreSQL database from its pristine schema. If the local SQLite file already contains channels, videos, history, or per-video state, automatic initialization is refused and the explicit Settings migration above is required.

## Background refresh

Durations and Shorts metadata are filled lazily for videos from the last 90 days (configurable with `VIDEO_MAINTENANCE_MAX_AGE_DAYS`). Older videos are not revisited by automatic maintenance; their metadata can still be resolved when accessed or manually synchronized.

Channel RSS refresh is adaptive. YT Zero estimates each channel's upload cadence from the median gap between its latest publication dates, prioritises feeds that are overdue relative to that cadence, and reserves two places in every ten-channel batch for oldest-first rotation. Repeated failures receive exponential backoff, and an HTTP 429 stops the rest of the current batch. The three `ADAPTIVE_REFRESH_*` variables set the per-channel bounds without increasing the ten-request batch budget. A manual refresh bypasses the automatic cooldown.

Channel RSS refreshes only the latest feed entries. Live-status checks operate per followed channel and do not refetch old video metadata.

For details on what is fetched and stored, see [How It Works](How-It-Works).
