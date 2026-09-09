# Public sharing: security and proxy deployment

Public sharing exposes intentionally unauthenticated, read-only pages below
`/share/*`. It can share one video, a personal playlist, or a followed YouTube
playlist without exposing the rest of the YT Zero interface.

> **Security warning:** enabling this feature creates a public route into your
> YT Zero installation. The token in the URL is the only credential. Anyone who
> obtains a link can open it and can forward it to somebody else. Public sharing
> is optional, disabled by default, and should be enabled and exposed only at
> the instance operator's own risk. YT Zero cannot compensate for an incorrectly
> configured reverse proxy, ingress, authentication gateway, CDN, or access log.

The public page is marked `noindex`, but that is only a request to search
engines. It is not authentication and must not be treated as access control.

## What a link exposes

A public page may expose the video's title, creators, public statistics,
description, chapters, thumbnails, and the current public contents of the
shared playlist. Playlists are live: adding or removing an item changes what the
same URL shows. Private, members-only, and unavailable videos are filtered out.
The page does not expose the profile name, comments, transcript, watch history,
playback position, likes, or profile settings, and public playback does not
write any of those values.

When **Allow local media** is disabled, playback falls back to YouTube's
privacy-enhanced embed. Visitors can therefore still connect to YouTube and be
subject to YouTube's privacy policy. When local media is enabled, anonymous
holders of the URL can stream the owner's available local media and subtitles.
This can consume server bandwidth and may expose media that was previously
reachable only after signing in. Enable it only when that is intentional.

Public requests never start downloads, synchronization, imports, yt-dlp,
transcoding, metadata refreshes, or other write jobs.

## Token handling

Each URL contains a random 256-bit bearer token. It has no expiry date and no
additional password. Treat the complete URL like a password:

- send it only through a channel you trust;
- do not paste it into tickets, screenshots, public chat, analytics, or error
  reports;
- remember that it may remain in browser history, clipboard history, chat
  history, bookmarks, proxy logs, and backups of those systems;
- rotate the link if it may have leaked, or revoke it when it is no longer
  needed.

Enabling local-media access automatically rotates the token because it expands
what the link can reveal. Disabling local media takes effect immediately without
changing the URL. Revoking or manually rotating a link invalidates the old URL
immediately.

YT Zero redacts tokens in its own request diagnostics. A reverse proxy, ingress,
CDN, WAF, external authentication service, APM agent, or load balancer sees the
request before YT Zero can redact it. Disable access logging for `/share/*`, or
replace the token path segment with a fixed value before the request URI is
written anywhere. Check both access and error logs, tracing spans, analytics,
and request breadcrumbs.

## Required routing boundary

Route `/share/*` to the same YT Zero backend as the normal application. If an
external gateway protects the installation, bypass that gateway only for paths
whose first complete segment is `/share/`. Do not use a loose string-prefix
rule: `/share-admin`, `/shared`, and similar paths must not match.

Keep `/api/*` under its existing policy. In particular, `/api/public-shares` is
the authenticated management API and must never be part of the bypass.
`/api/health` is the existing intentionally public health probe, not a sharing
endpoint. Public pages also need their read-only UI files. With the standard
build, allow unauthenticated `GET` and `HEAD` access to `/assets/*`,
`/favicon.svg`, `/manifest.webmanifest`, `/icon-maskable.svg`,
`/apple-touch-icon.png`, `/icon-192.png`, and `/icon-512.png`; keep every other
route under the normal policy unless your deployment proves another static file
is required.

If YT Zero's built-in authentication is the only authentication layer, no
special bypass rule is necessary. Simply make sure `/share/*` reaches the app.
If you use Authentik, Authelia, Cloudflare Access, an OAuth proxy, Traefik,
Caddy, Nginx, HAProxy, a Kubernetes ingress, or a provider firewall, implement
the same exact path allowlist at that layer.

## Reverse-proxy checklist

Before sending a link to anyone outside the trusted network:

1. Serve the public hostname through HTTPS only.
2. Route the exact `/share/` segment to YT Zero and verify that a similar path,
   such as `/share-test`, still follows the normal authentication policy.
3. Verify that `/api/public-shares` and another authenticated `/api/*` endpoint
   are not made public by the exception. `/api/health` remains the intentionally
   public deployment probe.
4. Disable or redact request-URI logging for `/share/*` at every layer.
5. Disable proxy/CDN caching for `/share/*` and honor YT Zero's
   `Cache-Control: private, no-store` response.
6. Preserve `GET`, `HEAD`, `Range`, `Content-Range`, `Accept-Ranges`,
   `Content-Length`, `429`, and `Retry-After`. Do not coalesce multipart ranges.
7. Do not redirect a public link through another host that records the complete
   source URL. Preserve the `Referrer-Policy: no-referrer` header.
8. Set the public host and scheme correctly. A link copied from Settings uses
   the browser's current origin, so open Settings through the final public HTTPS
   URL before copying it.
9. Test from a signed-out/private browser window and from a network outside the
   LAN before relying on the configuration.

### Example Nginx boundary

This is only the public exception. Keep the installation's existing protected
catch-all location around it and adapt the upstream name to the deployment:

```nginx
# The trailing slash is intentional: /share-test must not match.
location ^~ /share/ {
    # Use this only when auth_request is inherited from a parent block.
    auth_request off;

    proxy_pass http://ytzero:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_cache off;
    proxy_buffering off;
    access_log off;
}

# Hashed UI assets contain no profile data and are required to render the page.
location ^~ /assets/ {
    auth_request off;
    proxy_pass http://ytzero:3001;
}

location = /favicon.svg {
    auth_request off;
    proxy_pass http://ytzero:3001;
}

location ~ ^/(?:manifest\.webmanifest|icon-maskable\.svg|apple-touch-icon\.png|icon-192\.png|icon-512\.png)$ {
    auth_request off;
    proxy_pass http://ytzero:3001;
}
```

Do not copy the `auth_request off` line if authentication is implemented by a
different module or by an upstream product; create an equivalent path-bypass
policy there. Review the final generated proxy configuration, because control
panels can add broader rules than their UI suggests.

## Client IPs and rate limiting

YT Zero limits lightweight public traffic per IP and token to 120 requests per
minute with a short burst of 30, and allows at most four concurrent media
streams per token. Local media is served in single ranges capped at 8 MiB.
These are damage limits, not a substitute for a firewall, CDN/WAF, or provider
bandwidth controls.

The application considers `CF-Connecting-IP`, then the first value of
`X-Forwarded-For`, then `X-Real-IP`. The trusted edge must remove client-supplied
copies and set the appropriate header itself. Do not append an untrusted incoming
value: otherwise a client can spoof the first address and evade per-IP limits.
When multiple trusted proxies are chained, configure trusted-proxy handling at
every hop and confirm the address received by YT Zero is the real client address.
Do not expose the backend port directly to the internet if you rely on this
limit; force public traffic through the trusted edge that normalizes the headers.

## Application controls and revocation

An administrator enables the global switch under **Settings → Sharing**.
Administrators can manage every link. Other profiles need the
`public_sharing` permission and can manage only their own links. Create a link
from the existing share menu on a video or playlist page, then manage all links
under **Settings → Sharing**.

Every public request rechecks the global switch, the owner's permission, current
ownership/follow state, playlist membership, and public video availability.
Removing permission or unfollowing a playlist suspends the link; restoring the
condition makes it work again. Deleting the resource or revoking the link ends
it. Invalid, suspended, and revoked links all return the same generic `404`.

Use the global switch as an emergency kill switch, but still rotate or revoke a
link that has leaked. Turning the switch off suspends existing links without
deleting them.

## Backups

Tokens and the global sharing switch are instance-local security state. They
are excluded from portable YT Zero backups. A full stopped-instance/database
backup can contain them, so protect full backups as secrets. After restoring a
full instance to a different hostname or trust boundary, review or revoke all
links before exposing it.
