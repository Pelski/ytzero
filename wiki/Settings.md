Settings use a two-column layout: navigation stays on the left and the selected
options appear on the right. On short screens both areas remain scrollable, and
on narrow screens the navigation collapses into a compact selector. Changes are
saved immediately unless an action explicitly shows a confirmation button.

## Navigation

The menu is grouped by purpose:

- **Library** — Channels, Followed playlists, Filters, Tags, Rules, and personal Playlists.
- **Experience** — Appearance, Feed, Navigation, Playback, Subtitles, Screenshots, and Privacy.
- **Administration** — Plugins, Profiles, Authentication, and Sharing.
- **System** — Changelog and update checks, Logs, External videos, Backup and restore, Database, other dangerous operations, and Cluster health when PostgreSQL is active.

Only sections available to the active profile are shown. Authentication remains
owner-only, while system and shared administration tools require administrator
access.

## Cluster health

On PostgreSQL installations, the primary profile gets **Cluster** as the last
item in the System group. It shows live application-process heartbeats, HTTP and
background-worker roles, versions, uptime, last contact, and selected non-secret
runtime settings. Warnings identify a missing worker, multiple workers, or mixed
application builds. The view refreshes every five seconds.

This dashboard reports application topology; it does not manage or restart
allocations. Use Nomad, Kubernetes, Docker, or your service manager to change
replica counts and deployment roles. See
[Clustered PostgreSQL deployment](Configuration#clustered-postgresql-deployment)
for the supported topology, storage requirements, failover behavior, and
maintenance procedure.

## Experience settings

- **Appearance** controls the interface language, YouTube video-title language, application identity, video-card density, and watched-video style. Video titles follow the profile language by default, or can be pinned to another supported language.
- **Feed** controls the feed age window and visibility of Shorts, live, Upcoming, and members-only content. Shorts can be hidden, shown for selected channels, or shown for every followed channel; a channel opt-in affects only the main feed.
- **Navigation** controls Shorts, top channels, and the order and visibility of sidebar destinations.
- **Playback** controls related videos, on-demand comments, list continuation, player language, quality, speed, keyboard seeking, and automatic landscape fullscreen. Download configuration also offers a default remote player: YouTube embed or a direct, no-disk MP4 stream.
- **Subtitles** controls caption defaults and presentation.
- **Screenshots** controls captures made by the local player or YT Zero Enhance.
- **Privacy** contains the optional SponsorBlock and [DeArrow](Privacy-and-License#dearrow) integrations. DeArrow titles and thumbnails are separate and both are disabled by default.

## Plugins

Built-in plugins are disabled by default and can be enabled or configured under
**Settings → Plugins**. The [YT-DLP Integration](YT-DLP-Integration) owns files
downloaded by YT Zero and has a dedicated Downloads destination. The
[TubeArchivist Integration](TubeArchivist-Integration) instead connects an
existing external archive as a headless source for the normal feed and player;
it intentionally adds no route or sidebar item. Shared plugin configuration and
connection tests require administrator access.

## Profile access

The primary profile manages access under **Settings → Profiles**. Roles define
the areas their non-administrator members may edit: channels, followed
playlists, imports, tags and rules, filters, personal playlists, appearance,
feed, navigation, playback, plugins, and profiles. Roles are created and edited
in a dedicated dialog, and one role is the default for newly created profiles.

The normal profile list assigns a role to each profile. Choosing **Custom** from
the role picker opens the full permission matrix and unlocks that profile's
granular cells; named roles keep those cells read-only. Each custom cell can
inherit the base role, explicitly allow an area, or explicitly block it. The
matrix keeps its profile and role columns pinned while the permission columns
scroll horizontally. Administrators always have full access, regardless of
stored roles or exceptions.

The standard defaults keep shared behavior and administration restricted while
leaving personal tags, rules, filters, and playlists editable. The Child Lock
PIN is a separate temporary gate: it does not grant administrator status or
change profile permissions. See [Profiles](Profiles) and [Child Lock](Child-Lock).

## Public sharing

**Settings → Sharing** contains the default-off global switch and the list of
public links. Administrators manage all links; other profiles require the
`public_sharing` permission and see only their own. A public link deliberately
bypasses login, so read the [Public Sharing](Public-Sharing) security and proxy
guide before enabling the feature or exposing `/share/*` outside the LAN.
