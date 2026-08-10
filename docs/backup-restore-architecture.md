# Portable backup and restore architecture

Status: design contract for issue #58. This document describes the intended
implementation and is normative for future persistent features.

## Decision summary

YT Zero should support two different backup stories and name them clearly:

1. **Portable backup** in the UI — selective, versioned, safe to inspect and
   restore into another installation. The downloaded file is a ZIP archive
   named `ytzero-backup-YYYY-MM-DD.zip`.
2. **Exact instance backup** — stop YT Zero and copy the `data/` directory. With
   SQLite this captures the database, passkeys, download cookies, cached images,
   and downloaded media exactly as stored on disk. PostgreSQL deployments must
   additionally back up the external database with operator-provided tools.

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

The admin-only `/restore` destination is named **Backup and restore** and is
linked from **Settings → Dangerous**. It contains two top-level operations:

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
- shared channel custom names, portable automatic-download overrides, and
  operator-defined publication/refresh schedules

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
The small `.ytz.json` recovery sidecars stored beside downloaded
media are machine-bound download-library metadata: they are excluded together
with downloaded media from portable backups, but enable safe reconnection after
the entire download directory is moved. Their filenames share the media base so
file managers keep each pair together; older ID-only sidecar names remain
readable. A missing sidecar is backfilled in place for a healthy completed
download whose current database path still exists; this does not re-download
the media. Legacy media without a sidecar may be reconnected only through one
unambiguous known YouTube video ID in its path. Unidentified files are never
treated as disposable application data.

## Archive format

Example layout:

```text
manifest.json
instance/settings.json
instance/channels.jsonl
profiles/index.json
profiles/<profile-uuid>/settings.json
profiles/<profile-uuid>/downloads.json
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
plugins/social/activity.json
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
  "appVersion": "2026.08.1",
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
  The configured IANA timezone is portable instance configuration; it controls
  displayed dates, scheduling, local log timestamps, daily rotation, child
  limits, and Insights/Pulse day and hour aggregation without depending on the
  host or browser timezone.
  When the machine-bound `TZ` environment variable contains a valid IANA zone,
  it overrides this portable value at runtime and the saved value remains
  dormant for a future start without `TZ`. The environment override itself is
  never exported or restored.
  The administrator-only profile permission areas are portable configuration.
  Enabling Child Lock and its PIN remain local and are never exported.
- `user_settings`: registered settings for selected profiles.
  This includes `feed_sort`, the portable per-profile choice between publication and first-seen chronology, `watch_show_comments`, the opt-in presentation preference for the on-demand comments section, and `channel_posts_tab`, the opt-in presentation preference for Community Posts on channel pages. Comment payloads remain transient; the persisted Community Post catalog and its synchronization state are rebuildable cache data. Neither is exported.
  The visibility of the child-watching shortcut is also a portable per-profile
  presentation preference. It defaults to visible; live child activity remains
  transient and is never included in a backup.
  DeArrow title and thumbnail enablement are independent portable per-profile
  presentation settings and both default to disabled. Replacements are fetched
  on demand; they do not overwrite library metadata or become portable profile data.
  The video-card action visibility mode is portable per-profile presentation
  configuration. It defaults to the historical hover behaviour and may instead
  keep actions visible over the thumbnail, show them in an always-visible bar
  below the thumbnail, require the overflow button, delay hover activation by
  three seconds, or leave actions to the video page.
  The versioned video-card action-button configuration is also portable
  per-profile presentation configuration. It stores only the ordered set of
  bounded action identifiers and their visibility; it contains no video or
  playlist identifiers. This shape is part of `profile.settings` schema v3;
  older backups remain valid, with the current value retained on merge or the
  application default used after a replace restore when the key is absent.
  Watch-later scheduling is always visible and fixed in first position. Restore
  and remove cannot be hidden but may be reordered; playlist and local-download
  actions are hidden by default.
  Context-aware continuation preferences are portable configuration: whether
  list playback is disabled, waits for confirmation, or starts automatically,
  plus whether it follows the visible list order or walks it in reverse. The
  active playback queue itself is transient router state and is never exported.
- `profile_admin_only_areas` is portable instance configuration. Its versioned document uses schema v3; restore normalizes legacy `settings` access into separate appearance, feed, navigation, and playback permissions. On a fresh instance, channel subscriptions, followed YouTube playlists, tags, feed filters, and personal playlists are delegated to every profile; changing this default never rewrites an explicitly stored policy.
  This includes the player screenshot format, quality, and filename template;
  they are portable presentation preferences and contain no captured image data.
  It also includes YT Zero Enhance enablement, replacement-control preference,
  frame-step FPS, and screenshot encoding quality. The authenticated watch page
  embeds only these safe presentation values for the browser extension and
  never includes secrets or raw profile records.
- `plugins`: enabled state for known plugins.
- `plugin_settings` and global `plugin_<id>_*` settings: only through each
  plugin's backup adapter and normal value validation.
- `download_settings`: portable configuration owned by the built-in downloads
  feature, serialized through the versioned `profile.downloads` section rather
  than through plugin adapters. The profile's enabled state, automation rules,
  and non-secret per-profile preferences are included. Administrator-owned
  shared settings use domain keys named `downloads_*` and are serialized once
  through `instance.downloads`. Download cookies, downloaded media, queue
  progress, and physical file paths remain excluded.
  Downloads' per-profile **Include Shorts** preference is portable
  configuration. It controls automatic feed and Watch later downloads; manual
  downloads remain an explicit, separate action.
  The per-profile download schedule (enabled state, selected start weekdays,
  start time, and end time) is portable configuration in
  `profile.downloads` schema v2. It uses the instance's portable IANA timezone
  at runtime. Queue membership and active download progress remain transient;
  older schema v1 archives leave an existing target schedule unchanged during
  merge, while a fresh or replace restore uses the disabled default with all
  weekdays and the `23:00`–`07:00` window.
  The per-profile **Download past live streams** preference is portable
  configuration and defaults to disabled. When enabled, completed stream
  archives may be selected by Watch later and automatic download rules;
  active and upcoming streams remain ineligible.
  The per-profile **Pre-download the next playlist video** preference is
  portable configuration in `profile.downloads` schema v3 and defaults to
  disabled. While watching either a personal playlist or a YouTube playlist,
  it queues only the immediately following video; it does not persist the
  playback queue or export download queue membership.
  The downloads domain section includes the per-profile older-device
  compatibility preference as portable configuration. It affects only future
  files, selecting H.264 video and AAC
  audio in an MP4 container; downloaded media itself remains machine-bound and
  excluded from portable backups.
  Restore remains compatible with archives that stored this payload as the
  former `plugins.downloads` profile adapter (schema v4) and used the downloads
  row in `instance.plugins` as its enabled flag.
  Social's instance adapter schema v3 stores its feature toggles and child
  access policy, including the administrator-owned Watch together toggle that
  defaults to disabled. A v2 backup has no Watch together field and therefore
  leaves the target installation's current value unchanged. The removed
  reaction allow-list is ignored when restoring v1; chosen emoji belong to the
  Social activity section instead.
  Social's profile adapter schema v3 also stores a bounded, ordered list of up
  to 6 recently used emoji and the selected emoji skin tone. Both are portable
  per-profile picker preferences, contain no post or profile identifiers, and
  are validated on restore. The recent list replaces the target profile's
  previous list; a v2 backup has no skin-tone field and therefore leaves the
  target profile's current preference unchanged (new profiles default to the
  neutral tone).
- `users`: display name, color, avatar reference, order, and child/adult role.
  Exclude usernames, hashes, OIDC subjects, proxy mappings, and PIN hashes.
- `user_channels`: subscriptions and portable per-channel playback/caption/
  members-only overrides. The per-channel Shorts main-feed opt-in is portable
  configuration in `profile.subscriptions` schema v2; older v1 archives inherit
  the profile default. The profile-wide Shorts feed mode is portable
  configuration in `profile.settings` schema v2. Its legacy `0` and `1` values
  retain their existing meanings, while `selected` enables channel opt-ins.
- `user_followed_playlists`: followed playlist ID and feed preference.
- `tags`, `channel_tags`, manual `video_tags`, `auto_tag_rules`.
- `filter_rules`.
- `user_playlists`, `user_playlist_videos`, `user_playlist_rules`.
- shared channel choices such as `custom_title` and the explicit automatic
  download threshold override.
- `download_rules`: portable per-profile automation configuration. Rules use
  stable UUIDs and stable YouTube channel/playlist identifiers. Required and
  excluded keywords are configuration; rule previews and queue decisions are
  transient. Merge restore updates matching UUIDs idempotently within the
  mapped profile.
- profile avatars after MIME, size, and image validation. Uploaded and restored
  raster images are normalized to a metadata-free 256×256 WebP asset; this is
  an implementation detail of the existing `profile.avatar` schema v1 section.
  Older PNG/JPEG/WebP archives remain accepted and are normalized during
  restore, while export continues to carry the current binary asset unchanged.
- stable `portable_uuid` values on profiles, tags, and personal playlists are
  object identity metadata and travel only through their owning domain section.

### Portable personal state (opt-in)

- `user_videos`: queue/archive state, bucket, show time, progress, watched, and
  liked state. This also includes the versioned resume-playback context: a
  source descriptor and its filters, never a captured list of video IDs.
  Portable contexts reference tags and personal playlists by stable UUID;
  restore drops a context whose referenced source cannot be mapped rather than
  broadening it to a different queue.
- `history`.
- Social activity is portable personal state in the optional, versioned
  `plugin.social.activity` domain section. It contains stable post and comment
  UUIDs, shared video identifiers, plain-text bodies, arbitrary single-grapheme
  emoji reactions, local comment likes, and resolved profile mentions. Actors and mentioned profiles
  are referenced by portable profile UUID, never local integer IDs. Export is
  limited to selected profiles and posts authored by them; restore is ordered
  (posts, comments, reactions/likes, mentions), idempotent, and skips records
  whose mapped profile or referenced video is unavailable. Merge preserves
  existing activity, while replace removes Social activity owned by mapped
  profiles before restoring it.
- `recommendation_feedback` if Discovery preferences are selected.
- `watch_time_log`, `scheduling_event_log`, `watch_tag_time_log`, and
  `sponsorblock_skip_log` if Insights/Pulse history is selected.
- minimal channel/video metadata for objects referenced by the selected state.
  This is a rehydration seed, not the entire cached feed/library.

### Rebuildable or transient — never portable by default

- full `videos`, `video_creators`, fetched channel metadata, chapters, channel
  playlist cache, and `channel_playlist_videos`, except minimal referenced
  records described above
- `channel_posts` and `channel_post_sync_state`; posts are a shared, normalized
  local catalog fetched again from YouTube, while attempt/success timestamps and
  errors are machine-local scheduler state
- `discovery_recommendations`
- derived Discovery `last_terms`
- `update_check_state`, `notifications` (including derived Social alerts), `bulk_undo`
- adaptive feed scheduler attempt timestamps, detected cadence, and failure
  counters on `channels` (operator-defined publication weekdays and refresh
  time are portable configuration instead)
- pending child time requests and one-day child time extras
- active/expired authentication sessions
- uploaded archives and analysis plans in `restore-sessions`; these are
  short-lived staging files for an in-progress portable restore
- active Social Watch together rooms, participant presence, playback
  synchronization state, and session chat messages
- in-progress download jobs, errors, output paths, and temporary playlist-name
  context used to render local filenames
- `download_owners`, which is profile-scoped runtime ownership/visibility for
  shared local files and is rebuilt by future download requests rather than
  exported as portable configuration
- image cache and other network-derived cache
- `portable_object_mappings` restore bookkeeping and automatic pre-restore
  SQLite safety snapshots (local recovery data, not portable archive content)
- `schema_migrations` database-engine migration bookkeeping and SQLite planner
  statistics (`sqlite_stat*`); both are local implementation metadata and are
  rebuilt or maintained by the active engine rather than exported

### Secrets and machine-bound data — excluded in v1

- The last active profile id stored in browser `localStorage` is a
  machine-bound presentation convenience. It is scoped to that browser and
  origin, is validated against the current profile list before use, and is
  never included in a portable or exact server-side backup.

- passwords and PIN hashes
- OIDC client secret and active authentication configuration, including the
  instance-local choice to hide other profile names in the authenticated
  profile picker
- delegated profile administrator grants; these are instance-local
  authorization policy and are never imported onto another installation
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
Downloads adapter exports validated per-profile preferences (including subtitle
languages, automatic subtitles, retention, watched-file cleanup and liked-file
protection) and that profile's automation rules. Instance storage policy
(including output paths/templates, administrator-selected sidecar files and the
physical storage cap) remains administrator-owned operational configuration.
Each profile's yt-dlp cookies are a separate machine-local secret; cookies,
paths, media, `download_owners`, queue state, previews and errors are not
exported. Downloads is presented as a
first-class application area while the automatic migration continues to read
older `plugin_downloads_*` keys and assigns legacy jobs and rules to the
primary profile. Ownership backfill is guarded by a durable one-time marker so
later restarts cannot recreate a profile/file relationship that was deliberately
removed after migration.

If a backup contains configuration for a plugin unavailable in the target
version, analysis reports it as skipped. The user can install/enable a
compatible plugin and re-run restore. Unknown plugin payloads are never applied
as opaque database values.

## Restore workflow at `/restore`

### 1. Upload

Accept `.zip`/`.ytzero-backup` archives. Keep this separate from the external
data `/import` wizard: Google Takeout and NewPipe import external YouTube data, while restore
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

`database-state.json` is machine-bound database-selection metadata. It stores
only the active engine/location fingerprint and a pending migration receipt;
it never stores a database URL or credentials and is excluded from portable
backup. `database_migration_receipts` and `schema_migrations` are engine-local
implementation metadata and are likewise excluded. PostgreSQL physical backup
and point-in-time recovery remain an operator responsibility; the portable
archive is the supported cross-engine domain backup.

SQLite restore creates a local pre-restore database snapshot after checkpointing
the WAL. PostgreSQL restore is protected by its database transaction instead;
operators should retain an independent `pg_dump`/managed snapshot before a
large replace restore.

The operator-selected channel status (`channels.manual_status`) is portable
instance organization/configuration owned by `instance.channels` schema v2.
It uses the stable channel ID, restores idempotently, and a v1 archive leaves
the target's current status unchanged because the field is absent. The update
timestamp is rebuildable audit metadata and is not exported.

The fixed channel publication schedule (`refresh_schedule_days` and
`refresh_schedule_time`) is portable shared configuration owned by
`instance.channels` schema v4. Weekdays use stable `0..6` values and refresh
times are an ordered JSON array interpreted in the app's portable IANA
timezone. A v1/v2 archive leaves an existing schedule unchanged; schema v3's
single `HH:mm` value remains accepted and is normalized to an array on restore.
A v4 archive restores or explicitly clears the complete multi-time schedule.

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
