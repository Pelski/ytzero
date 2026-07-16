YT Zero supports multiple **profiles** — separate, isolated views of the app for different people on the same install. Channels and videos are stored once and shared, but each profile keeps its own state.

## What is per-profile

Each profile has its own:

- followed channels (subscriptions)
- video state — inbox / queued / archived, watch-later buckets, progress, likes
- tags and automatic tag rules
- filter rules
- local playlists and playlist rules
- watch history
- display, player, and language settings
- whether live and Upcoming streams appear in the main feed

Channels and videos themselves are **global** — a channel followed by several profiles is still fetched only once, which keeps background work and storage efficient.

## The primary profile

The **primary profile** is the first profile (the original "Default"). It is special:

- It owns app-wide settings: app name, icon color, [Child Lock](Child-Lock), and the [Authentication](Authentication) method.
- It is the only profile that sees the **Authentication** tab.
- It cannot be deleted.
- It can edit other profiles' names, colors, and avatars, and reset their PINs — but never sees or sets another profile's PIN.
- It can mark a profile as a **[child profile](Child-Lock#child-profiles)** and manage its watch-time limit and content restrictions; leaving a child profile and granting more time are confirmed with the app-wide child lock PIN.

Every other profile manages only its own data.

Child profiles have a deliberately smaller Settings navigation. They do not see Display, Plugins, Advanced, Profiles, or Authentication. See [Child Lock](Child-Lock#child-profiles) for their available controls and server-enforced restrictions.

## Managing profiles

Open the profile menu (top right) or go to **Settings → Profiles** to:

- add a profile (name, color, avatar, optional PIN)
- edit a profile's name, color, or avatar
- set or remove your own 6-digit PIN
- delete a non-primary profile (from within that profile)

## Switching profiles

How switching works depends on the active [authentication method](Authentication):

- **None** — pick any profile from the menu; PIN-protected profiles ask for their PIN.
- **Shared login** / **OIDC gateway** — switch freely after signing in (PINs are not used).
- **Login per profile** / **OIDC mapped** / **Proxy header** — switching requires signing out and back in as the other profile.

When an authentication method is active, the per-profile PINs are replaced by the login and are hidden.

## Monitoring child profiles

Adult profiles see a floating child-activity panel in the lower-left corner. It shows whether children are currently watching, their remaining daily time, and the active video. A parent can open the same video, stop further watching immediately, or unlock a locked child profile. The panel starts collapsed and remains present when children are idle.
