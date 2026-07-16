YT Zero has two parental-control layers that work together:

- **Child lock (settings PIN)** — an app-wide PIN that protects household and administrative settings.
- **Child profiles** — per-profile restrictions for watch time, content sources, Shorts, and live streams.

## Child lock (settings PIN)

You can enable **Child lock** in **Settings → Profiles** and set a 6-digit PIN. When it is enabled, protected settings are locked until the PIN is entered. While settings are unlocked, a red banner above the settings tabs provides a quick **Lock settings now** action.

This is useful for children when you want YouTube access limited to selected channels only. You still manage the setup yourself: add only the channels you want available, keep filters and followed channels configured correctly, and make sure the app is the YouTube surface the child actually uses.

### What the settings PIN protects

When child lock is closed, it continues to protect channel management, filters, display settings, plugins, advanced tools, profiles, and authentication.

Two areas deliberately remain personal and editable without the household PIN:

- **Tags and tag rules**
- **Local playlists and playlist rules**

Each profile owns its own tags and playlists, so children can organize their library without unlocking administrative settings. A child may add a channel only while settings are unlocked with the child lock PIN. Subscription imports remain unavailable to child profiles.

## Child profiles

Any non-primary profile can be marked as a **child profile** in **Settings → Profiles** (only the [primary profile](Profiles#the-primary-profile) can toggle this). A child profile gets its own set of restrictions, all managed by the primary profile:

- **Daily watch-time limit** — minutes of actual playback per day, counted server-side. When the time runs out, the screen locks.
- **Subscribed content only** (default on) — hides YouTube search results and Discovery, and blocks watching videos outside the local library. All of this is enforced by the server, not just hidden in the UI.
- **Hide Shorts** — removes the Shorts tab from the profile.
- **Disable live streams** — removes the Live tab, filters live and Upcoming entries from the feed, and blocks opening them directly by URL.

Child profiles also get a reduced Settings view. They can access Channels, Tags & Rules, and Playlists, but do not see Display, Plugins, Advanced, Profiles, or Authentication. Protected channel changes still require the child lock PIN; tags and playlists remain available as described above.

On the watch page, YT Zero hides its own **YouTube** link for child profiles. The embedded YouTube player is cross-origin and may still contain YouTube-provided links; reliably blocking those requires device-, browser-, or network-level domain controls.

### The child lock PIN and child profiles

The app-wide **child lock PIN** (the same one that locks settings) also guards the child-profile boundaries:

- **Leaving the child profile** — switching from a child profile to any other profile asks for the child lock PIN. If the target profile has its own PIN, that PIN is asked as well.
- **Approving more watch time** — a parent confirms extensions with the child lock PIN, so the child cannot approve their own request from an unattended screen.

Without the child lock enabled these gates are open, and the child-profile settings show a warning. A child profile's *own* PIN is unrelated to any of this — like on every profile, it only protects *entering* the profile.

Entering the child lock PIN incorrectly **3 times** locks the child profile: the child sees a lock screen and cannot watch. The lock clears after 30 minutes, or immediately when the primary profile unlocks it in **Settings → Profiles**.

### When the time runs out

The child sees a full-screen lock with a friendly message and two options:

- **Ask for more time** — parents then see a banner on their home feed for one hour, with one-click grants: **15 minutes**, **1 hour**, **until the video ends**, or **no limit today** (each confirmed with the child lock PIN), or they can simply dismiss it.
- **Switch profile** — gated by the child lock PIN as described above.

A granted extension unlocks the screen automatically within a few seconds. Grants mean "this much time from now" — they are not eaten by any overshoot of the limit.

### Parent activity panel

Adult profiles have a small floating panel in the lower-left corner. It starts collapsed and remains visible even when nobody is watching:

- collapsed state shows child avatars and a grey or active status indicator
- expanded state shows every idle child's remaining daily time
- active children show their name, remaining time, video thumbnail, title, and channel
- clicking the video opens it on the adult profile
- **Stop watching now** immediately locks that child profile
- locked profiles can be unlocked directly from the panel

The panel is not shown while a child profile is active.

## Child lock vs. authentication

Child lock and [Authentication](Authentication) are independent layers:

- **Child lock** gates *changing protected settings* and *child-profile boundaries* with the app-wide household PIN. It is owned by the primary profile.
- **Authentication** gates *who can use the app at all*. When an authentication method is active, the per-profile sign-in replaces per-profile PINs; profiles protected by their own login are switched by signing in as them, and the app-wide settings PIN keeps working as described here.
