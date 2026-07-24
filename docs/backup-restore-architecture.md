# Portable backup and restore architecture

Status: design contract for issue #58. This document describes the intended
implementation and is normative for future persistent features.

## Decision summary

YT Zero should support two different backup stories and name them clearly:

1. **Portable backup** in the UI — selective, versioned, safe to inspect and
   restore into another installation. The downloaded file is a ZIP archive
   named `ytzero-backup-YYYY-MM-DD.zip`.
2. **Exact instance backup** — stop YT Zero and copy the `data/` directory. This
   remains the disaster-recovery path for the database, passkeys, download
   cookies, cached images, and downloaded media exactly as stored on disk.

A single JSON file is not the right container for the portable backup. JSON is
the right representation for its manifest and small sections, while large
collections should use JSON Lines and binary assets should remain files. A ZIP
container lets all of those travel as one file without coupling the portable
format to SQLite's internal schema.

The portable importer must operate on domain objects, never by dumping and
replaying database tables. Tables mix durable preferences, rebuildable cache,
runtime state, and secrets. For example, `plugin_state` contains both a real
Discovery preference (`blocked_terms`) and derived terms (`last_terms`).

## Product surface

Add an admin-only `/restore` destination named **Backup and restore**, linked
from Settings → Advanced. It contains two tabs or top-level sections:

- **Export backup** — choose a preset, profiles, and data categories, then
  download the archive.
- **Restore backup** — upload, analyze, choose profile mappings and categories,
  preview the exact changes, then commit.

Child profiles cannot access either operation. In v1, portable export and
restore are admin-only because they can expose or modify other profiles' data
and instance-wide configuration. A current-profile-only export can be added
later without changing the archive format.

## Export presets and categories

Presets are conveniences; the archive records the exact selected sections.

### Configuration only

- instance appearance and non-secret global settings
- enabled plugin list and portable plugin settings
- selected profiles' preferences

### Setup and organization (recommended)

Everything in Configuration only, plus:

- profiles and avatars
- channel subscriptions and per-channel overrides
- followed YouTube playlists
- tags, manual tag assignments, auto-tag rules, and filter rules
- personal playlists, membership, and playlist rules
- shared channel custom names and portable automatic-download overrides

### Full personal data

Everything in Setup and organization, plus:

- queue/archive state, likes, watched flags, and playback progress
- watch history
- optional Insights/Pulse history
- optional Discovery feedback

### Custom

Show the same categories grouped by **Instance** and by profile. Users select
which profiles to export and can enable or disable each category. Dependencies
are selected automatically and explained. For example, playlist membership or
watch history requires a minimal referenced-video index.

Downloaded media is never silently included. It can be many gigabytes and is
not portable across arbitrary download directory layouts. The UI should link
to the exact-instance `data/` backup documentation when the user needs it.

## Archive format

Example layout:

```text
manifest.json
instance/settings.json
instance/channels.jsonl
profiles/index.json
profiles/<profile-uuid>/settings.json
profiles/<profile-uuid>/subscriptions.jsonl
profiles/<profile-uuid>/followed-playlists.jsonl
profiles/<profile-uuid>/tags.jsonl
profiles/<profile-uuid>/rules.jsonl
profiles/<profile-uuid>/playlists.jsonl
profiles/<profile-uuid>/video-state.jsonl
profiles/<profile-uuid>/history.jsonl
profiles/<profile-uuid>/analytics/*.jsonl
plugins/<plugin-id>/global.json
plugins/<plugin-id>/profiles/<profile-uuid>.json
library/channels.jsonl
library/referenced-videos.jsonl
assets/avatars/<profile-uuid>.<ext>
```

Small bounded documents use JSON. Potentially large sequences use JSONL so the
server can stream export/import without holding the complete backup in memory.
Archive paths are fixed by the format; arbitrary paths from a manifest are not
trusted.

### Manifest

The manifest is the first and only required entry:

```json
{
  "format": "ytzero.portable-backup",
  "formatVersion": 1,
  "createdAt": "2026-07-25T10:30:00.000Z",
  "appVersion": "0.1.0",
  "sourceInstallationId": "uuid",
  "exportPreset": "setup",
  "profiles": [
    { "id": "profile-uuid", "name": "Default", "isChild": false }
  ],
  "sections": [
    {
      "id": "profile.subscriptions",
      "schemaVersion": 1,
      "profileId": "profile-uuid",
      "path": "profiles/profile-uuid/subscriptions.jsonl",
      "records": 42,
      "bytes": 12345,
      "sha256": "hex"
    }
  ]
}
```

`formatVersion` versions the container and manifest. Every section also has a
`schemaVersion` so it can migrate independently. Importers must reject a newer
unsupported container version, migrate known older section versions, and show
a warning for unknown optional sections. Checksums are integrity checks, not a
digital signature.

Do not export raw local integer primary keys as object identity. YouTube
channel/video/playlist IDs are already portable natural keys. User-created
objects need stable UUIDs (profiles, tags, personal playlists, and any future
entity whose identity must survive re-import). Existing rows receive a UUID
during the migration/backfill. Relationships inside the archive use those
UUIDs.

## Data classification

The following is the current source-of-truth classification. A feature that
adds persistent data must update this list and the backup registry described
below.

### Portable configuration and organization

- `settings`: only registered, non-secret global settings. Exclude Child Lock
  hashes and every authentication secret or activation setting.
- `user_settings`: registered settings for selected profiles.
- `plugins`: enabled state for known plugins.
- `plugin_settings` and global `plugin_<id>_*` settings: only through each
  plugin's backup adapter and normal value validation.
- `users`: display name, color, avatar reference, order, and child/adult role.
  Exclude usernames, hashes, OIDC subjects, proxy mappings, and PIN hashes.
- `user_channels`: subscriptions and portable per-channel playback/caption/
  members-only overrides.
- `user_followed_playlists`: followed playlist ID and feed preference.
- `tags`, `channel_tags`, manual `video_tags`, `auto_tag_rules`.
- `filter_rules`.
- `user_playlists`, `user_playlist_videos`, `user_playlist_rules`.
- shared channel choices such as `custom_title` and the explicit automatic
  download threshold override.
- profile avatars after MIME, size, and image validation.
- stable `portable_uuid` values on profiles, tags, and personal playlists are
  object identity metadata and travel only through their owning domain section.

### Portable personal state (opt-in)

- `user_videos`: queue/archive state, bucket, show time, progress, watched, and
  liked state.
- `history`.
- `recommendation_feedback` if Discovery preferences are selected.
- `watch_time_log`, `scheduling_event_log`, `watch_tag_time_log`, and
  `sponsorblock_skip_log` if Insights/Pulse history is selected.
- minimal channel/video metadata for objects referenced by the selected state.
  This is a rehydration seed, not the entire cached feed/library.

### Rebuildable or transient — never portable by default

- full `videos`, `video_creators`, fetched channel metadata, chapters, channel
  playlist cache, and `channel_playlist_videos`, except minimal referenced
  records described above
- `discovery_recommendations`
- derived Discovery `last_terms`
- `update_check_state`, `notifications`, `bulk_undo`
- pending child time requests and one-day child time extras
- active/expired authentication sessions
- in-progress download jobs and errors
- image cache and other network-derived cache
- `portable_object_mappings` restore bookkeeping and automatic pre-restore
  SQLite safety snapshots (local recovery data, not portable archive content)

### Secrets and machine-bound data — excluded in v1

- passwords and PIN hashes
- OIDC client secret and active authentication configuration
- profile identity mappings, proxy matches, and usernames
- WebAuthn/passkey credentials
- Child Lock secret
- yt-dlp cookies
- downloaded media paths and files

Portable restore must leave authentication disabled/unmodified and must never
activate an imported auth method. This avoids both credential leakage and a
restore-induced lockout. The analyze screen explicitly lists exclusions. A
future encrypted-secret extension requires a separate threat model and
passphrase-based encryption; it must not be slipped into normal JSON sections.

## Plugin contract

Core backup code must not dump plugin tables. Each plugin registers a namespaced
adapter containing:

```ts
interface BackupSectionDefinition {
  id: string;
  schemaVersion: number;
  scope: "instance" | "profile";
  sensitivity: "normal" | "personal" | "secret";
  dependencies: string[];
  export(context: BackupExportContext): AsyncIterable<unknown> | Promise<unknown>;
  analyze(input: BackupSectionInput): Promise<BackupSectionSummary>;
  restore(context: BackupRestoreContext): Promise<BackupSectionResult>;
}
```

The Discovery adapter exports validated settings, `blocked_terms`, and optional
feedback; it does not export generated recommendations or `last_terms`. The
Downloads adapter exports validated configuration and explicit channel
overrides; it does not export cookies, paths, media, queue state, or errors.

If a backup contains configuration for a plugin unavailable in the target
version, analysis reports it as skipped. The user can install/enable a
compatible plugin and re-run restore. Unknown plugin payloads are never applied
as opaque database values.

## Restore workflow at `/restore`

### 1. Upload

Accept `.zip`/`.ytzero-backup` archives. Keep this separate from the Google
Takeout `/import` wizard: Takeout imports external YouTube data, while restore
applies trusted YT Zero domain state and has different permissions and conflict
rules.

Uploads are staged under a server-owned temporary directory with a TTL. A full
backup must not be kept only in an in-memory Map. Enforce compressed size,
uncompressed size, entry count, per-entry size, record count, and parse-time
limits. Reject symlinks, absolute paths, `..`, duplicate entries, malformed
UTF-8/JSON/JSONL, unexpected files, and checksum mismatches.

### 2. Analyze (no writes)

Show:

- creation time, source/app/format versions, archive size, and integrity status
- profiles and section counts
- secrets/media intentionally excluded from the archive
- unsupported, skipped, or migrated sections
- conflicts with the destination installation
- whether this appears to be a re-import from the same source

Analysis returns an opaque, expiring restore session ID bound to the uploading
admin. It does not mutate application data.

### 3. Choose destination and scope

Map each source profile to one of:

- create a new profile
- merge into a selected existing profile
- skip

Then select available categories per profile and instance-wide categories.
Dependencies are automatic. Import choices can be narrower than the original
export, which is why the archive must remain sectioned.

### 4. Choose conflict strategy

Default to **Merge safely**. Offer **Replace selected category** only with a
clear destructive warning and only for categories fully represented in the
archive.

Merge rules:

- channels/videos/public YouTube playlists match by YouTube ID
- profiles/tags/personal playlists match by stable portable UUID when known
- on first import, tags may fall back to normalized name within the mapped
  profile; ambiguous playlist names require an explicit choice or are imported
  with a non-destructive renamed copy
- rules deduplicate by normalized semantic content
- history deduplicates by target profile + video + timestamp
- settings apply only known keys, pass through current validators, and let the
  selected archive value win for that key
- plugin values pass through the current plugin definitions; removed or invalid
  values fall back with a warning
- no imported row may refer to a source database integer ID

Repeated restore of the same archive must be idempotent. Persist source
installation/object mappings or stable portable UUIDs so it does not duplicate
profiles, tags, playlists, history, or analytics events.

### 5. Dry-run review

Before enabling Restore, show a summary such as:

```text
Create 1 profile
Update 2 profiles
Add 42 subscriptions; keep 3 existing subscriptions
Create 7 tags and 4 playlists
Restore 1,820 history entries; skip 36 duplicates
Skip authentication, 2 unsupported settings, and downloaded media
```

The dry run and commit use the same parsed plan. Do not independently recompute
user choices in two implementations.

### 6. Commit

- acquire an application-wide restore/maintenance lock
- pause or gate refresh, Discovery, and download workers
- create an automatic pre-restore SQLite safety snapshot
- apply database changes in one transaction where possible
- stage avatar files and atomically rename them only after database success
- roll back database and staged files on any failure
- invalidate in-memory caches and reload settings/plugins after success
- return per-section created/updated/skipped/warning counts

Replacing categories is never implemented as a blind database replacement.
Deletion is scoped to the mapped target profile/category and happens inside the
same transaction as restore. A full instance wipe is not part of v1; an empty
installation restored with Merge safely already produces the expected result.

## API shape

Proposed endpoints:

```text
GET  /api/backup/options
POST /api/backup/export
POST /api/restore/analyze
POST /api/restore/plan
POST /api/restore/commit
DELETE /api/restore/session/:id
```

`/backup/export` receives selected profile UUIDs, category IDs, and the preset
label, then streams the archive as a download. `/restore/analyze` is multipart.
`/restore/plan` records mappings, selected sections, and conflict strategies and
returns the dry-run summary. `/restore/commit` accepts only the restore session
and plan revision, preventing the client from injecting un-analyzed records.

All endpoints require admin authority. Export endpoints must set private/no-store
cache headers. Restore mutations also participate in the Settings/Child Lock
protection layer.

## Compatibility rules for future features

Every feature that creates or changes persistent state must answer all of these
before merge:

1. Is the state configuration, personal state, cache, transient state, secret,
   machine-bound data, or some combination?
2. Which portable backup section owns it?
3. Does its section schema version or migrator need to change?
4. What are its dependencies and stable portable identifiers?
5. How does merge, replace, duplicate detection, and repeated restore behave?
6. Does export selection leak the state when its category is disabled?
7. Are old backups still accepted, with a default or migration for the new
   field?

Adding a column to a portable domain without updating its adapter is a bug.
Adding cache/transient/secret data does not require exporting it, but does
require an explicit classification here so it cannot be included accidentally
by a future generic exporter.

## Required tests

- round trip: export a multi-profile fixture, restore into a blank database,
  and compare a normalized domain snapshot
- every preset/category exports only its declared data (especially secrets)
- profile mapping: create, merge, and skip
- merge and replace semantics for each section
- importing the same archive twice is idempotent
- restore from every supported older container/section version
- newer required version is rejected; unknown optional section is warned/skipped
- missing dependencies, corrupt checksums, malformed JSONL, and invalid values
- ZIP traversal, symlink, duplicate-entry, zip-bomb, and size-limit cases
- failure halfway through commit leaves database/assets unchanged
- plugin unavailable, setting removed, and plugin section migration cases
- background workers cannot observe or mutate half-restored state
- authentication, passkeys, cookies, sessions, and media never appear in a v1
  portable archive

## Implementation order

1. Add stable portable UUIDs and a section registry with classification tests.
2. Implement streaming export plus manifest/checksums.
3. Implement analyze/session storage and archive security limits.
4. Build `/restore` export and analyze UI with shared settings primitives.
5. Implement profile mapping, plan/dry-run, and merge-only commit.
6. Add automatic safety snapshot and carefully scoped replace strategies.
7. Add optional personal state and analytics sections after configuration/setup
   round-trip tests are stable.

This order intentionally ships a safe, useful configuration/setup backup before
the higher-volume and more destructive restore modes.
