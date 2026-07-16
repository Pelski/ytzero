Run YT Zero with Docker (recommended), natively on Debian/Ubuntu, in a Proxmox LXC, or locally with Bun.

## Requirements

### Docker

- Docker
- Docker Compose

### Native (Debian/Ubuntu, LXC, VM, bare metal)

- Debian 12+ or Ubuntu 22.04+, with systemd
- x86_64 or aarch64 (Bun ships builds for those two only)
- root access

### Proxmox

- Proxmox VE 8.4 or newer

### Local

- Bun 1.3 or newer

## Docker

Use the published GHCR image:

```yaml
services:
  ytzero:
    image: ghcr.io/pelski/ytzero:latest
    container_name: ytzero
    ports:
      - "3001:3001"
    volumes:
      - ./data:/data
    environment:
      - IDLE_TIMEOUT_SECONDS=120
      - REFRESH_INTERVAL_MINUTES=5
      - VIDEO_MAINTENANCE_MAX_AGE_DAYS=90
      - DB_PATH=/data/db/ytzero.db
      - IMG_CACHE_DIR=/data/imgcache
    restart: unless-stopped
```

Start it:

```bash
docker compose up -d
```

Or build locally from the repository:

```bash
docker compose -f docker-compose.dev.yml up --build -d
```

Open <http://localhost:3001>. Data is stored under `./data`.

See [Configuration](Configuration) for all environment variables.

## Proxmox VE

Run this **on the Proxmox host** (not inside a container). It creates an
unprivileged Debian LXC and installs YT Zero natively inside it — no Docker
layer:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/scripts/proxmox-lxc.sh)"
```

The script prints the container's address when it finishes. Defaults: 2 cores,
2 GB RAM, 8 GB disk, DHCP on `vmbr0`, next free container id. Override with
environment variables:

```bash
CTID=150 CT_HOSTNAME=ytzero RAM_MB=4096 DISK_GB=16 STORAGE=local-lvm \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/scripts/proxmox-lxc.sh)"
```

| Variable | Default | Description |
| --- | --- | --- |
| `CTID` | next free id | Container id. |
| `CT_HOSTNAME` | `ytzero` | Container hostname. |
| `CORES` | `2` | CPU cores. |
| `RAM_MB` | `2048` | Memory in MB. |
| `DISK_GB` | `8` | Root disk size. Raise it if you plan to download videos. |
| `BRIDGE` | `vmbr0` | Network bridge. |
| `STORAGE` | `local-lvm` | Storage for the container's disk. |
| `TEMPLATE_STORAGE` | `local` | Storage holding the Debian template. |
| `YTZERO_VERSION` | latest | Release tag to install. |

Useful afterwards:

```bash
pct enter <CTID>                        # shell inside the container
pct exec <CTID> -- journalctl -u ytzero -f
pct exec <CTID> -- systemctl restart ytzero
```

Configuration lives at `/etc/ytzero/ytzero.env` inside the container. Edit it
with `pct enter <CTID>`, then restart the service. To update, rerun the native
installer inside the container:

```bash
pct exec <CTID> -- bash -c "\$(curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/scripts/install.sh)"
```

## Native install (Debian/Ubuntu)

Works in an LXC, a VM, or on bare metal. Run as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/scripts/install.sh)"
```

It installs Bun, ffmpeg and yt-dlp, downloads the release tarball with the
prebuilt frontend, creates a system user `ytzero`, and starts a systemd service.

| Path | What |
| --- | --- |
| `/opt/ytzero` | Application. |
| `/opt/ytzero/data` | Database, caches, avatars, logs, downloads. **Back this up.** |
| `/etc/ytzero/ytzero.env` | Configuration — see [Configuration](Configuration). |
| `/etc/systemd/system/ytzero.service` | The service. |

```bash
systemctl status ytzero
systemctl restart ytzero      # after editing the env file
journalctl -u ytzero -f
```

Install knobs: `YTZERO_VERSION` (default: latest release), `YTZERO_PORT`
(`3001`), `YTZERO_DIR` (`/opt/ytzero`), `YTZERO_DATA` (`$YTZERO_DIR/data`).
The directory and port knobs initialize a new installation; updates preserve
the existing `/etc/ytzero/ytzero.env`.

> **Release requirement:** the native and Proxmox installers need a GitHub
> release containing `ytzero-vX.Y.Z.tar.gz` and its checksum. Tags created
> before these release assets were introduced cannot be installed this way.

### Updating

Re-run the same command. The release is replaced; `/opt/ytzero/data` and your
`/etc/ytzero/ytzero.env` are left untouched.

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/scripts/install.sh)"
```

## Unraid

YT Zero ships a Community Applications template
([`templates/ytzero.xml`](https://github.com/Pelski/ytzero/blob/main/templates/ytzero.xml))
and repository metadata in `ca_profile.xml`, following Unraid's official
Community Apps repository layout.
Once it is listed, install it from **Apps** by searching for “YT Zero”. Until
then, use either of these methods:

### Manual container (recommended until the template is listed)

In **Docker → Add Container**, switch to advanced view if necessary and set:

| Field | Value |
| --- | --- |
| Name | `ytzero` |
| Repository | `ghcr.io/pelski/ytzero:latest` |
| Network Type | `bridge` |
| WebUI | `http://[IP]:[PORT:3001]/` |
| Port | container `3001`, host `3001` |
| Path | container `/data`, host `/mnt/user/appdata/ytzero`, read/write |

Add optional environment variables with **Add another Path, Port, Variable,
Label or Device → Variable**. The most useful ones are listed under
[Configuration](Configuration#method-specific-configuration).

### Load the bundled XML manually

From an Unraid terminal, download the template into DockerMan's user-template
directory, then reload the Docker page:

```bash
curl -fsSL https://raw.githubusercontent.com/Pelski/ytzero/main/templates/ytzero.xml \
  -o /boot/config/plugins/dockerMan/templates-user/my-ytzero.xml
```

Open **Docker → Add Container**, select `ytzero` from the template dropdown,
review the data path and port, then apply it. The template uses the blue play
icon from `docs/assets/icon.png`.

To update the container, use Unraid's **Check for Updates** action. App data is
kept in `/mnt/user/appdata/ytzero`; back up that directory before major updates.

## Local development

Install dependencies:

```bash
bun run setup
```

Start backend and frontend:

```bash
bun run dev
```

Development URLs:

```text
UI:  http://localhost:5173
API: http://localhost:3001
```

## Local production-like start

```bash
bun run start
```

This builds `ui/dist` if needed and starts the backend serving the built frontend at <http://localhost:3001>.

## Scripts

| Command | Description |
| --- | --- |
| `bun run setup` | Install backend and frontend dependencies. |
| `bun run dev` | Start backend watcher and Vite dev server. |
| `bun run dev:app` | Start only the backend watcher. |
| `bun run dev:ui` | Start only the Vite dev server. |
| `bun run build` | Build the frontend. |
| `bun run start` | Serve the production frontend through the backend. |

## First run

After the first start you get a local YouTube subscriptions app at <http://localhost:3001>.

The initial app is intentionally empty: no Google login, no imported account data, and no recommendations. From **Settings → Channels** you add channels manually or import an OPML / Google Takeout subscriptions file (see [Importing Subscriptions](Importing-Subscriptions)). Once channels are added, YT Zero starts filling a local SQLite database with their public RSS videos and background metadata.
