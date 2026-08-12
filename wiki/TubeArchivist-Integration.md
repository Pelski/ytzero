The **TubeArchivist Integration** plugin uses an existing
[TubeArchivist](https://www.tubearchivist.com/) archive as a local video source
inside YT Zero. It imports the archive catalog into YT Zero's shared video and
channel library, adds available archive items directly to the existing feed,
and plays the media through YT Zero's local player.

The plugin is **disabled by default** and does not add a separate page or
sidebar item. TubeArchivist becomes another source behind the existing feed,
search, channel pages, recommendations, watch page, history, and playlists.

## Requirements

- A running TubeArchivist instance reachable from the **YT Zero server or
  container**.
- A TubeArchivist API token.
- Network access from YT Zero to both the TubeArchivist API and its protected
  media paths.
- Media encoded in a format supported by the viewer's browser. YT Zero proxies
  TubeArchivist files but does not transcode them.

The browser does not need direct access to TubeArchivist. For Docker Compose,
the server URL will commonly use the TubeArchivist service name and internal
port, for example `http://tubearchivist:8000`. `localhost` refers to the YT Zero
container itself, so it normally should not be used for another container.

## Setup

1. Open **Settings → Plugins**.
2. Open **TubeArchivist → Configure**.
3. Enter the **Server URL**. Use only the TubeArchivist origin and optional base
   path; do not put credentials in the URL.
4. Enter the **API token** and save. Leaving the token field empty on a later
   save preserves the configured token.
5. Use **Test connection**. A successful response displays the TubeArchivist
   version when the server provides one.
6. Enable the plugin.
7. Use **Sync now**, or wait for the automatic refresh.

The token can be explicitly deleted with **Remove token**. Once either the URL
or token is missing, automatic synchronization and archive playback remain
inactive.

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| **Library refresh** | Every hour | Refreshes the TubeArchivist catalog every 15 minutes, every hour, every 6 hours, or daily. Synchronizations never overlap. |
| **Sync watched status** | On | Marks a TubeArchivist item watched after a profile completes it in YT Zero. |

## Catalog synchronization

YT Zero reads the paginated TubeArchivist video endpoint and imports each valid
YouTube video ID into the same `channels` and `videos` catalog used by the rest
of the application. Titles, descriptions, publication dates, download dates,
duration, views, likes, content type, thumbnail information, media location,
subtitles, and the original TubeArchivist response are retained when available.

TubeArchivist-specific ownership remains in a separate source record. Archive
files are not registered as YT-DLP Integration downloads, so YT Zero's download
retention, storage cap, deletion, and recovery jobs never manage or remove
TubeArchivist media.

Videos are deduplicated by their YouTube video ID. If an item is already known
from a followed channel, playlist, search, or YT Zero download, the user sees
one video rather than a second TubeArchivist copy. The source record simply
makes the existing item locally playable.

Each complete synchronization uses a new catalog generation. Items missing
from a successful refresh are marked unavailable only after every page has
finished. A failed or interrupted refresh therefore does not remove the last
known complete archive from the feed. Disabling the plugin aborts an active
request and prevents the next refresh from being scheduled.

### How archive items enter the feed

An available TubeArchivist item satisfies the same source check as a followed
channel or followed playlist. It can therefore appear in the normal main feed
without silently following its channel for any profile.

- **Published** sorting uses the video's original publication date.
- **Arrival** sorting uses TubeArchivist's download date when the video is first
  introduced by the archive.
- The profile's normal feed age limit, watched state, archive state, Shorts,
  live, member-content, and tag filters still apply.
- Older archive items remain available through search and channel pages. Turn
  off the feed age limit if the whole archive should be eligible for the main
  feed.
- Feed actions remain profile-owned: watching, liking, rejecting, scheduling,
  tagging, progress, history, and personal playlists do not become shared just
  because the media source is global.

No separate TubeArchivist view or source-specific inbox is created.

## Playback and source selection

The browser always asks YT Zero for the normal local stream endpoint:

```text
GET /api/videos/<youtube-id>/stream
```

YT Zero resolves the source in this order:

1. Active or upcoming live streams use YouTube.
2. A completed file owned by YT Zero's Downloads feature.
3. An available TubeArchivist media item.
4. The profile's normal wait, experimental streaming, or YouTube policy.

The viewer can still explicitly switch to YouTube. A child profile restricted
to downloaded/local videos may use an available TubeArchivist item as a local
source.

For TubeArchivist playback, YT Zero resolves the stored `media_url` against the
configured TubeArchivist origin, attaches `Authorization: Token …`, and streams
the response back to the browser:

```text
Browser
  └─ GET /api/videos/<id>/stream
       └─ YT Zero
            └─ GET <TubeArchivist origin>/<stored media_url>
               Authorization: Token <server-side token>
```

HTTP byte ranges are forwarded, and safe `Content-Type`, `Content-Length`,
`Content-Range`, and `Accept-Ranges` headers are returned. This lets the local
player seek without buffering the complete video in YT Zero memory. The API
token is never sent to the browser.

YT Zero also proxies stored TubeArchivist thumbnails and subtitle files. SRT
timestamps are converted to WebVTT when necessary so the existing local player
can display them.

## Comments and watched status

When a video belongs to the active TubeArchivist catalog, the watch page asks
TubeArchivist for its archived comments first. The response is normalized to
the same comment model used elsewhere in YT Zero, including replies, authors,
timestamps, likes, pinned state, and safe author images/links where available.
This also lets local-only child profiles read comments already present in the
archive without fetching them from YouTube.

Completing a TubeArchivist video updates the active YT Zero profile immediately
and places one video-ID entry in a durable outbound queue. A background worker
then calls TubeArchivist's watched endpoint. Failures do not roll back local
history; they are retried with increasing backoff and duplicate completions are
coalesced.

TubeArchivist watched state is global to its archive, while YT Zero watched
state remains per profile. Consequently, completion by any eligible YT Zero
profile can mark the shared TubeArchivist item watched. The current integration
is outbound-only: it does not import TubeArchivist watched state, synchronize
partial progress, or send an unwatch action when completion is undone in YT
Zero.

## Security model

- The API token is stored outside the settings database in a private file with
  mode `0600` where supported.
- Configuration responses expose only whether a token exists, never its value.
- Upstream authentication failures are translated to a TubeArchivist error and
  never returned as YT Zero session `401` responses.
- Only `http` and `https` server URLs are accepted. User information and URL
  fragments are rejected.
- Media, thumbnail, and subtitle requests use only locations obtained from a
  synchronized TubeArchivist item. There is no arbitrary URL proxy endpoint.
- Stored resources must remain on the administrator-configured origin.
  Cross-origin and other upstream redirects are rejected, preventing the token
  from being forwarded elsewhere.
- Media responses are restricted to supported video/octet-stream content
  types; thumbnails must return an image type.
- The token is excluded from status responses, errors, logs, events, and
  portable backups.

Private and loopback addresses are intentionally allowed because TubeArchivist
commonly runs on the same host or LAN. The trust boundary is the single origin
configured by an administrator.

## Disable, reset, and removal

Disabling the plugin immediately removes TubeArchivist as an eligible feed and
player source, stops comments and watched synchronization, aborts the active
catalog request, and cancels future refreshes. Cached source metadata remains
in the database so re-enabling does not require destructive cleanup.

**Reset plugin** clears the synchronized TubeArchivist source catalog, sync
status, watched outbox, and safe plugin policies. It does not delete physical
TubeArchivist media and does not delete the API token; use **Remove token** for
that. Shared channel or video rows may remain when another YT Zero feature or
profile still references them.

## Backup and restore

Portable backup includes:

- whether the plugin is enabled;
- the library-refresh interval;
- the watched-sync switch.

Portable backup excludes:

- the TubeArchivist server URL, because it is machine-bound;
- the API token, because it is a secret;
- media and thumbnail locations;
- the synchronized catalog and raw metadata;
- comments and other rebuildable cache;
- sync generations, timestamps, errors, and the watched outbox.

On a fresh installation, restoring an enabled plugin leaves it unconfigured and
performs no network request until an administrator supplies the local URL and
token. For exact disaster recovery, stop YT Zero and copy its complete data
directory in addition to backing up TubeArchivist itself. See
[Backup & Updates](Backup-and-Updates).

## Troubleshooting

### Test connection fails

- Verify that the URL is reachable from the YT Zero server/container, not only
  from the browser.
- In Docker, use a shared network and the TubeArchivist service name.
- Check that the token is current and was copied without surrounding spaces.
- Confirm that a reverse proxy permits the `/api/` and protected `/media/`
  paths.

### The connection works but no videos appear

- Make sure the plugin itself is enabled and run **Sync now**.
- Check the last synchronization error in the plugin configuration.
- Review the active profile's feed age limit and other feed filters.
- Search for an older known title or open its channel page; older archive items
  may be intentionally outside the main feed window.

### A video appears but does not play

- Confirm that TubeArchivist still reports the item as available and that its
  protected media URL is reachable from YT Zero.
- Check reverse-proxy support for HTTP Range requests.
- Try the file in the same browser. YT Zero does not transcode TubeArchivist
  media, so unsupported codecs or containers require a compatible archive
  format or future transcoding support.
- Active and upcoming live streams deliberately stay on YouTube.

### Watched state is not updated

- Ensure **Sync watched status** is enabled.
- The local YT Zero completion is saved first. TubeArchivist may update later
  if the server was offline or rate-limited; queued events retry automatically.

## Current limitations

- TubeArchivist's API does not guarantee long-term backward compatibility; a
  future TubeArchivist update may require an adapter update in YT Zero.
- There is no server-side transcoding or codec conversion.
- Watched synchronization is outbound and completion-only.
- Partial playback progress, likes, playlists, and unwatch actions are not sent
  to TubeArchivist.
- The integration uses TubeArchivist's API and protected media URLs; it does
  not scan or mount TubeArchivist's filesystem directly.
