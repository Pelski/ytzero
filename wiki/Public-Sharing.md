# Public sharing

YT Zero can create public, read-only links for an individual video, a personal
playlist, or a followed YouTube playlist. Public pages use a dedicated
`/share/*` surface and do not require a YT Zero login.

> **Use this feature at your own risk.** A public link deliberately bypasses
> normal sign-in. The token in its URL is the only credential, and anyone who
> receives it can open it or forward it. The feature is disabled by default.
> Enable it only if you understand the exposure and have correctly configured
> every reverse proxy, ingress, authentication gateway, CDN, and logging layer
> in front of YT Zero.

`noindex` headers discourage search indexing, but they are not authentication
and do not make a leaked URL private.

## What viewers can see

The public watch page can show the video's title, creators, public statistics,
description, chapters, thumbnail, and the current public contents of the shared
playlist. A shared playlist is live, so its public page changes when its items
change. Private, members-only, and unavailable videos are excluded.

The page does not reveal the owner's profile name, comments, transcript, watch
history, playback position, likes, or settings. Viewing a public link does not
update those values and does not start synchronization, imports, downloads,
yt-dlp, transcoding, or metadata refreshes.

Without local-media access, playback uses YouTube's privacy-enhanced embed, so
the visitor still connects to YouTube. With **Allow local media** enabled, anyone
holding the link can stream the owner's available local media and subtitles.
That may consume significant server bandwidth and makes the media reachable
without sign-in. Enable it only when this is intended.

## Create and manage a link

1. An administrator enables **Settings → Sharing → Enable public sharing**.
2. For a non-administrator profile, an administrator also grants the
   `public_sharing` permission through its profile access role.
3. Open a video or playlist and choose **Public link** from its existing share
   menu.
4. Copy the link and test it in a signed-out/private browser window.
5. Manage, rotate, or revoke links under **Settings → Sharing**.

Administrators can manage all links. Other permitted profiles can manage only
their own links.

Links do not expire and do not have an additional password. Rotating a link
invalidates its old URL immediately. Revoking it removes access. Enabling local
media expands access and therefore rotates the token automatically; disabling
local media takes effect immediately without changing the URL.

Every request rechecks the global switch, owner permission, current ownership or
follow state, playlist membership, and public video status. Removing permission
or unfollowing a playlist suspends its link; restoring the condition reactivates
it. Deleting the resource or revoking its link ends access.

## Treat the URL like a password

The URL contains a random 256-bit bearer token. Do not publish it, include it in
screenshots or tickets, send it through untrusted chat, or submit it to analytics
and error-reporting tools. It can remain in browser history, clipboard history,
bookmarks, chat history, and infrastructure logs. Rotate the link if it may have
leaked.

YT Zero redacts the token in its own diagnostics, but infrastructure in front of
the app sees the URL first. Disable access logging for `/share/*`, or redact the
token path segment in reverse-proxy, ingress, CDN, WAF, authentication-service,
load-balancer, APM, and tracing logs.

## Reverse proxy and external authentication

If YT Zero's built-in authentication is the only login layer, simply route
`/share/*` to the same application. If Authentik, Authelia, Cloudflare Access,
an OAuth proxy, Nginx, Caddy, Traefik, HAProxy, a Kubernetes ingress, or another
gateway protects the whole host, add a narrowly scoped public exception:

- bypass external sign-in only when the first complete path segment is
  `/share/`; a loose prefix rule must not also match `/share-admin` or `/shared`;
- keep authenticated `/api/*` paths protected, especially
  `/api/public-shares`; `/api/health` remains the intentionally public health
  probe;
- allow unauthenticated `GET` and `HEAD` for `/assets/*`, `/favicon.svg`, the
  web manifest, and the standard application icons, which the public page needs
  to render cleanly;
- disable caching for `/share/*` and preserve YT Zero's
  `Cache-Control: private, no-store` header;
- preserve `HEAD`, `Range`, `Content-Range`, `Accept-Ranges`, `Content-Length`,
  `429`, and `Retry-After` for media playback;
- preserve `Referrer-Policy: no-referrer` and do not redirect through a service
  that records the complete source URL;
- serve the public hostname through HTTPS.

A copied link uses the browser's current origin. Open YT Zero through its final
public HTTPS hostname before copying the URL; otherwise it may contain an
internal hostname or development port.

YT Zero rate-limits public traffic by client IP plus token. The trusted edge
must replace client-supplied `CF-Connecting-IP`, `X-Forwarded-For`, and
`X-Real-IP` values instead of blindly forwarding or appending them. Otherwise a
caller can spoof the first address and evade per-IP limits.
Do not expose the backend port directly to the internet if you rely on this
limit; force public traffic through the trusted edge that normalizes the headers.

Before sharing externally, test all of the following from a signed-out browser
and a network outside the LAN:

- the intended `/share/<token>` URL opens;
- a similar path such as `/share-test` still requires normal authentication;
- ordinary `/api/*` requests remain protected;
- rotating and revoking invalidate the old URL;
- the token is absent from every infrastructure log;
- seeking and playback work through range requests;
- rate-limited responses reach the browser unchanged.

The global switch is an emergency kill switch: disabling it suspends all links
without deleting them. Still rotate or revoke any URL that may have leaked.

## Backups

Public tokens and the global switch are not included in portable YT Zero
backups. A full stopped-instance or database backup can contain the plaintext
tokens and must be protected as a secret. Review or revoke all public links after
restoring a full instance into a different hostname or security boundary.

Repository operators can find a concrete Nginx example and a longer deployment
checklist in the
[public-sharing security notes](https://github.com/Pelski/ytzero/blob/main/docs/public-sharing.md).
