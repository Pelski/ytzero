With the default SQLite setup, all persistent Docker data lives in `./data`.
When `DATABASE_URL` points to PostgreSQL, database contents live in that
external service and must be backed up separately.

## Portable backup

Administrators can open **Settings → Dangerous → Backup and restore** to export
a selective, versioned ZIP archive. The recommended preset includes profiles,
preferences, subscriptions, followed playlists, tags, rules, and personal
playlists. Personal viewing state and Insights history are opt-in.

Before restoring, YT Zero verifies the archive, lets you map source profiles to
new or existing profiles, and shows an exact dry-run summary. Restore defaults
to a non-destructive merge. Replace is scoped to the selected profile and
category. On SQLite, an automatic safety snapshot is created before commit.

Portable archives intentionally exclude passwords, authentication setup,
passkeys, sessions, download cookies, local paths, cached images, and downloaded
media.

The two DeArrow switches—clickbait-free titles and clickbait-free thumbnails—are
included as portable preferences for each selected profile. Community branding
responses and the in-memory lookup cache are not exported. Restoring these
preferences does not replace titles or thumbnails stored in the local library.

Portable profile settings also include validated per-profile plugin preferences
and automatic download rules. Downloaded media, queue state, generated plugin
caches, YouTube cookie files, machine-wide download paths, and physical-store
download settings are excluded.

For TubeArchivist, portable backup includes only the enabled state, refresh
interval, and watched-sync switch. The server URL, API token, protected media
locations, synchronized catalog, sync errors, and watched outbox are excluded.
After restore to a new host, configure the local TubeArchivist connection again;
see [TubeArchivist Integration](TubeArchivist-Integration#backup-and-restore).

## Exact instance backup

To back up a Docker install, stop the container and copy the data directory:

```bash
docker compose down
cp -R data data.backup
docker compose up -d
```

For local installs, the default database, image cache, avatars, downloads, and
per-profile download cookies are under:

```text
data/db/ytzero.db
data/imgcache
data/avatars
data/downloads
data/download-cookies
```

If the active database is PostgreSQL, use the backup and restore tools provided
by your PostgreSQL operator (for example, `pg_dump` and a tested restore
procedure) in addition to copying the local data directory. A portable YT Zero
archive is database-engine independent, but intentionally excludes secrets,
caches, and downloaded media, so it is not a complete instance backup.

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
