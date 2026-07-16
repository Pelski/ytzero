YT Zero is configured through environment variables. All of them are optional and have sensible defaults.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP server port. |
| `IDLE_TIMEOUT_SECONDS` | `120` | HTTP idle timeout. Manual channel sync can take longer than Bun's 10-second default when playlist scanning is enabled. |
| `DB_PATH` | `./data/db/ytzero.db` | SQLite database path. |
| `IMG_CACHE_DIR` | `./data/imgcache` | Thumbnail and image cache directory. |
| `IMG_CACHE_TTL_DAYS` | `5` | How long a cached image is fresh before a refetch is attempted. |
| `AVATAR_DIR` | `./data/avatars` | Uploaded profile avatars. |
| `LOG_PATH` | `./data/logs/ytzero.log` | Log file. Logs always also go to stdout; this file is what the in-app log viewer reads. |
| `REFRESH_INTERVAL_MINUTES` | `5` | Followed-channel RSS refresh interval. |
| `LIVE_INTERVAL_MINUTES` | `3` | Followed-channel live-status check interval. This does not refetch old video metadata. |
| `DURATION_INTERVAL_MINUTES` | `3` | Interval for the background job that backfills missing video durations. |
| `DURATION_BATCH_SIZE` | `20` | Videos processed per duration-backfill run. |
| `VIDEO_MAINTENANCE_MAX_AGE_DAYS` | `90` | Maximum video age considered by automatic Shorts and duration backfills. Older videos are resolved only when accessed or manually synchronized. |
| `UI_DIST` | `./public` | Built frontend directory served by the backend. |
| `DOWNLOADS_DIR` | `./data/downloads` | Where the [YT-DLP Integration](YT-DLP-Integration) plugin stores downloaded video files. |
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp binary used by the [YT-DLP Integration](YT-DLP-Integration) plugin. |
| `YTDLP_AUTO_UPDATE` | _(unset; `1` in Docker)_ | Set to `1` to run `yt-dlp -U` once a day. YouTube regularly stops serving formats to outdated yt-dlp versions, so keeping it current matters. |
| `APP_URL` | _(derived from request)_ | Public base URL. Used as the OIDC redirect origin and WebAuthn origin when behind a reverse proxy. |
| `WEBAUTHN_RP_ID` | _(request hostname)_ | Override the WebAuthn Relying Party ID (the registrable domain) when the auto-derived hostname is wrong. |
| `YTZERO_AUTH_DISABLE` | _(unset)_ | Set to `1` to force the **None** auth method regardless of the saved setting. Emergency unlock if an auth method locks you out — see [Authentication](Authentication#recovery-anti-lockout). |
| `YTZERO_VERSION` | `dev` | Version reported by `/api/health`. Set by the Docker build and by the native installer; there is no reason to set it by hand. |

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

## Background refresh

Durations and Shorts metadata are filled lazily for videos from the last 90 days (configurable with `VIDEO_MAINTENANCE_MAX_AGE_DAYS`). Older videos are not revisited by automatic maintenance; their metadata can still be resolved when accessed or manually synchronized. Channel RSS refreshes only the latest feed entries. Live-status checks operate per followed channel and do not refetch old video metadata.

For details on what is fetched and stored, see [How It Works](How-It-Works).
