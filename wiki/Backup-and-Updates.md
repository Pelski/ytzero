All persistent Docker data lives in `./data`.

## Portable backup

Administrators can open **Settings → Advanced → Backup and restore** to export
a selective, versioned ZIP archive. The recommended preset includes profiles,
preferences, subscriptions, followed playlists, tags, rules, and personal
playlists. Personal viewing state and Insights history are opt-in.

Before restoring, YT Zero verifies the archive, lets you map source profiles to
new or existing profiles, and shows an exact dry-run summary. Restore defaults
to a non-destructive merge. Replace is scoped to the selected profile and
category, and an automatic SQLite safety snapshot is created before commit.

Portable archives intentionally exclude passwords, authentication setup,
passkeys, sessions, download cookies, local paths, cached images, and downloaded
media.

## Exact instance backup

To back up a Docker install, stop the container and copy the data directory:

```bash
docker compose down
cp -R data data.backup
docker compose up -d
```

For local installs, the default database and image cache are under:

```text
data/db/ytzero.db
data/imgcache
```

## Updates

Update a Docker install that uses the published GHCR image:

```bash
docker compose pull
docker compose up -d
```

Update a Docker install that builds locally after pulling new code:

```bash
docker compose -f docker-compose.dev.yml up --build -d
```

Schema changes are applied automatically on startup, so updates do not require manual migration steps. Back up `./data` first if you want a safety net.
