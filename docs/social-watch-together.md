# Social Watch together

## Product contract

- Watch together is an administrator-owned Social feature flag and defaults to
  disabled. Disabling it closes every active room.
- A profile with Social access can start a room from a Social post or the watch
  page. The room UUID in `/watch/:videoId?room=:roomId` is the invitation token.
- Private, members-only, live, and upcoming videos cannot be used for a room.
- The host controls play, pause, seek, and playback rate. Guests retain local
  non-transport controls and are corrected to the latest host checkpoint.
- Chat uses the same compact message presentation as Social comment previews.
  On desktop it sits beside the player, including theater mode; narrower
  layouts stack it below the player.

## Realtime model

Rooms live in one bounded in-memory store. HTTP creates and reads a snapshot,
publishes a complete playback checkpoint, posts a chat message, or closes a
room. Each participant then holds one authenticated, room-specific SSE stream
for `snapshot`, `playback`, `message`, `presence`, and `closed` events.

Playback checkpoints have a monotonically increasing revision and an
idempotency key. Updates require the previous revision and the full playback
state, so concurrent host tabs cannot silently overwrite newer state. Clients
anchor an incoming checkpoint to their local receipt time rather than comparing
the server epoch with the device clock. The host publishes state changes quickly
and a sparse checkpoint during steady playback; guests correct only meaningful
drift. A newly loaded or reconnected host must first apply and then observe the
current server checkpoint before it may publish. Buffering pauses the shared
timeline; only a confirmed playing state advances it. If browser autoplay policy
blocks a guest, the locked player exposes a local gesture that retries the
authoritative room state without granting host controls.

The SSE heartbeat revalidates both the authenticated request identity and the
current Social/Watch together access policy. Reconnects receive a fresh bounded
snapshot before incremental events.

## Lifecycle and limits

- Rooms expire after 6 hours of inactivity.
- A disconnected host has 30 seconds to reconnect. The oldest connected guest
  becomes host afterward; the room closes if nobody is connected.
- The store allows at most 64 rooms globally, 3 rooms per creator, 32 profiles
  per room, and 5 simultaneous room streams per profile.
- A room retains the newest 100 chat messages. Messages are limited to 500
  characters and 5 sends per 10 seconds per profile.
- Host playback updates are limited to 20 per 5 seconds. Idempotent retries do
  not consume the limit.

## Persistence and privacy

Only the global opt-in setting is portable configuration. Room membership,
chat, playback, idempotency receipts, and rate-limit state are transient: they
are never written to the database, logs, or portable backups and disappear on
restart. Snapshot and SSE responses are explicitly non-cacheable.
