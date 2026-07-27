# YT Zero Enhance browser-extension contract

Status: version 1. This document is the hand-off contract for the browser
extension. Fields and event names are stable within a major `version`.

## Configuration discovery in the authenticated page

Do not fetch a separate configuration endpoint. After YT Zero authenticates the
viewer and loads the active profile settings, AppShell inserts this element as
a direct descendant of the application DOM inside `body` on every application
route:

```html
<script id="ytzero-enhance-configuration" type="application/json">
  {"format":"ytzero.enhance-configuration","version":1}
</script>
```

The content script should run on the configured YT Zero origin, wait for this
element with a `MutationObserver`, read `element.textContent`, and parse it with
`JSON.parse`. The element is absent until authenticated profile settings are
available, so there is no auth or cross-origin fetch to reproduce. It contains
no profile identity, auth configuration, secret, or personal video state.

Example response:

```json
{
  "format": "ytzero.enhance-configuration",
  "version": 1,
  "enabled": true,
  "player": {
    "replaceControls": true,
    "language": "pl",
    "preferredQuality": "auto",
    "defaultPlaybackRate": 1,
    "keyboardSeekSeconds": 5,
    "frameStepFps": 30,
    "autoFullscreenLandscape": false,
    "captions": {
      "enabledByDefault": false,
      "language": "pl",
      "availableLanguages": [
        { "code": "en", "label": "English" },
        { "code": "pl", "label": "Polski" },
        { "code": "de", "label": "Deutsch" }
      ],
      "style": {
        "fontSizePx": 19,
        "color": "#ffffff",
        "backgroundOpacityPercent": 75
      }
    }
  },
  "screenshots": {
    "format": "png",
    "jpegQuality": 0.92,
    "filenameTemplate": "{channel}_{title}_{timestamp_ms}",
    "templateFields": ["channel", "title", "video_id", "timestamp", "timestamp_ms"]
  },
  "sponsorBlock": {
    "enabled": true,
    "categories": ["sponsor"]
  },
  "bridge": {
    "version": 1,
    "detailEncoding": "json-string",
    "events": {
      "ready": "ytzero:enhance:ready",
      "context": "ytzero:enhance:context",
      "screenshotRequest": "ytzero:enhance:screenshot-request",
      "screenshotResult": "ytzero:enhance:screenshot-result",
      "playerEvent": "ytzero:enhance:player-event",
      "playerCommand": "ytzero:enhance:player-command"
    },
    "extensionStatus": {
      "elementId": "ytzero-enhance-extension-status",
      "attribute": "data-extension-status",
      "activeValue": "active"
    }
  }
}
```

`player.captions.availableLanguages` contains the complete YT Zero subtitle
language catalog as `{ code, label }` entries. `language` remains the active
profile's default caption language. The field is additive in configuration v1,
so older extensions may ignore it.

The extension must reject an unknown `format`, and should disable integration
with a clear diagnostic when `version` is newer than it supports. Unknown fields
within a supported version must be ignored.

## Page bridge

Events are dispatched on `document` in the top-level YT Zero watch page. All
`CustomEvent.detail` values are JSON strings, not objects, so the contract works
across Chromium/Firefox extension isolated worlds. Parse detail with
`JSON.parse(event.detail)`.

### Extension ready handshake

After installing listeners, the content script dispatches:

```js
document.dispatchEvent(new CustomEvent("ytzero:enhance:ready"));
```

YT Zero responds with `ytzero:enhance:context`. It also publishes context when
the active embedded video or relevant data changes. Context includes:

- video id, title, channel id/title and duration;
- effective playback rate (including the per-channel override);
- seek seconds and frame-step FPS;
- effective caption language/style;
- chapters and normalized SponsorBlock segments;
- screenshot format, quality and filename template.

Install the `context` listener before sending `ready`.

### Reporting that the extension is active

The topbar contains a disabled extension icon reserved for a future repository
installation link. Once the extension has initialized successfully on the YT
Zero page, turn its icon and top-right badge green using the selectors supplied
by `bridge.extensionStatus`:

```js
const status = config.bridge.extensionStatus;
const markActive = () => {
  const element = document.getElementById(status.elementId);
  if (!element) return false;
  element.setAttribute(status.attribute, status.activeValue);
  return true;
};
if (!markActive()) {
  const observer = new MutationObserver(() => {
    if (markActive()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
```

Do this only after the content script and its iframe messaging are ready. No
click behavior should be added yet; YT Zero intentionally renders this control
as disabled until the extension repository/install URL is finalized.

### Taking a raw embedded-player screenshot

The S shortcut and YT Zero screenshot button dispatch a cancelable
`ytzero:enhance:screenshot-request` event. The payload includes video metadata,
current time and screenshot settings. If the extension can capture the YouTube
frame, its listener must synchronously call `event.preventDefault()`; otherwise
YT Zero falls back to capturing the outer embedded-player container.

After an intercepted request finishes, report UI feedback to YT Zero:

```js
document.dispatchEvent(new CustomEvent("ytzero:enhance:screenshot-result", {
  detail: JSON.stringify({ version: 1, status: "saved" })
}));
```

Use `status: "error"` on failure. The extension owns filename-template
expansion for an intercepted screenshot. Sanitize path separators and Windows
reserved filename characters; append the selected extension automatically.

## Player state and command bridge

The enhanced iframe emits `ytzero:enhance:player-event` on the top-level YT Zero
document. YT Zero sends commands through `ytzero:enhance:player-command`. Both
events always use a JSON string in `CustomEvent.detail` and schema `version: 1`.

Player events contain `videoId`, `type`, and `payload`. Supported types are
`ready`, `state`, `shortcut`, `captions-toggle-request`, `ended`, and
`command-result`. `ready` and `state` carry this state:

```ts
interface PlayerState {
  paused: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  captionSize: number;
  captionsEnabled: boolean;
  fullscreen: boolean;
  pictureInPicture: boolean;
}
```

Commands contain `requestId`, `videoId`, `command`, and `payload`. The iframe
must synchronously claim a supported command with `preventDefault()` and later
emit a matching `command-result`. Supported commands are `play`, `pause`,
`toggle-play`, `seek-by`, `seek-to`, `set-volume`, `set-muted`, `toggle-muted`,
`set-playback-rate`, `set-captions`, `toggle-captions`, `set-caption-size`,
`capture-frame`, `toggle-fullscreen`, `enter-fullscreen`, `exit-fullscreen`, and
`request-state`. YT Zero rejects unclaimed commands immediately and claimed
commands without a result after five seconds.

The legacy `ytzero:enhance:captions-toggle-request` event remains compatible;
new implementations may use only the general player event.

## Intentional source-site navigation

Links that deliberately open a source-site video or channel from YT Zero append
the exact `#ytNoRedirect` fragment. The extension treats this marker as a
one-navigation escape hatch and must not apply its automatic video redirect to
that URL. An explicit redirect chosen later from the extension popup may ignore
the marker because it is a new user action.

## Implementation brief for the extension agent

1. Add a user-editable YT Zero instance URL and request host permission for that
   origin plus `https://www.youtube.com/*`.
2. On any authenticated YT Zero application page, observe `body` until
   `#ytzero-enhance-configuration` exists, parse its `textContent`, and validate
   `format` and `version`. Re-read it when the node's text changes; retain the
   last valid value only as a resilience cache.
3. Do nothing when `enabled` is false. When true, inject the YT Zero look and
   keyboard behavior into YouTube embeds. Hide/replace YouTube controls only
   when `player.replaceControls` is true; provide a `YT` control that temporarily
   reveals the original controls for quality, captions and YouTube-only actions.
   After successful initialization, set the topbar extension-status attribute
   described above so its green availability badge becomes visible.
4. Implement Left/Right seek from `keyboardSeekSeconds`; comma/period frame
   stepping as `1 / frameStepFps`; configured default rate, quality and caption
   defaults; and the caption style values. Never steal shortcuts while an input,
   textarea, select or editable element has focus.
5. On YT Zero pages, install top-document bridge listeners before dispatching
   `ytzero:enhance:ready`. Use `context` for per-video chapters, SponsorBlock
   markers, channel playback-rate overrides and effective caption settings.
6. Intercept `screenshotRequest`, synchronously call `preventDefault()`, capture
   the raw video frame with extension privileges, encode PNG/JPEG/WebP using the
   requested quality, expand the filename fields, download it, then emit
   `screenshotResult`.
7. Keep page-world and iframe-world communication internal to the extension
   (content-script messaging is suitable). Do not expose privileged extension
   APIs to arbitrary page messages; validate event version, video id, value
   ranges and the configured YT Zero origin.
8. Add tests for configuration validation/fallback, shortcut focus guards,
   frame-step math, filename expansion/sanitization, ready/context ordering,
   cancelable screenshot ownership, and the disabled/reveal-original-controls
   states.
