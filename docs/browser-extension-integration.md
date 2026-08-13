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

- video id, title, channel id/title, duration and semantic content type;
- effective playback rate (including the per-channel override);
- seek seconds, frame-step FPS, configurable shortcut map and transport lock;
- effective caption language/style;
- chapters and normalized SponsorBlock segments;
- screenshot format, quality and filename template.

Install the `context` listener before sending `ready`.

### Content type contract

The application describes the active material with one field instead of a set
of overlapping booleans:

```ts
type ContentType = "default" | "short" | "livestream";

interface EnhanceContextVideo {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  duration: number;
  contentType: ContentType;
}
```

`contentType` belongs in `context.video`. Its values mean:

- `default` — an ordinary on-demand video, including a finished broadcast
  replay;
- `short` — a short-form, normally vertical video;
- `livestream` — a broadcast that is currently live or scheduled to start.

If several source flags could match, `livestream` has priority over `short`.
The application is the source of truth: the extension must not classify a
video as `short` from its aspect ratio and must not treat every video that was
once broadcast live as a current `livestream`.

The field is additive in bridge version 1. For compatibility with an older YT
Zero build, a missing or unknown value is normalized as follows:

1. Use `short` when the paired top page is on its `/shorts` route.
2. Use `livestream` only when the embedded player's native API or media element
   confirms active live playback.
3. Otherwise use `default`.

Once a valid context with `contentType` arrives, it overrides those fallbacks.
Apply a changed type in place without reloading the iframe, while preserving
playback position, volume, mute and caption selection.

The extension-side validator should normalize the value at the contract
boundary, not throughout the UI:

```ts
const CONTENT_TYPES = ["default", "short", "livestream"] as const;
type ContentType = typeof CONTENT_TYPES[number];

function contentType(value: unknown, legacyFallback: ContentType): ContentType {
  return CONTENT_TYPES.includes(value as ContentType)
    ? value as ContentType
    : legacyFallback;
}
```

Keep the URL/native-player compatibility fallback separate from this parser so
an invalid page payload can never force privileged or unsupported behavior.
Forward the normalized type with the already validated context from the top
frame to the matching embedded frame. The iframe controller should expose one
`setContentType(type)` operation and make that operation idempotent.

### Player presentation by content type

The three modes share typography, focus treatment, caption styling and button
icons, but not the same control density or behavior.

#### `default`

- Keep the complete horizontal control bar and ordinary on-demand timeline.
- Show play/pause, mute with expandable volume, elapsed/total time, captions,
  picture-in-picture and fullscreen.
- Support configured playback speed, number-key seeking, frame stepping,
  chapters, SponsorBlock markers and the configured seek interval.
- Keep the existing idle fade and large central play affordance.

#### `short`

- Keep the video stage visually vertical and centered. On a wide host, black
  side space belongs outside the vertical stage; controls should align to the
  stage rather than span the entire iframe.
- Use a compact bottom gradient with circular touch targets of at least 40 by
  40 CSS pixels. Keep play/pause, mute, captions and fullscreen immediately
  available.
- Hide the expanded volume slider, elapsed/total time and picture-in-picture.
  Frame capture remains available through the `S` shortcut and bridge command,
  even when it has no visible button.
- Use a thin, low-emphasis timeline. It may expand on hover/focus, but it must
  not dominate the vertical image.
- Up/Down navigate to the previous/next short through the top-page navigation
  bridge. Left/Right retain the configured seek behavior. Do not interpret
  Up/Down as volume changes in this mode.
- Keep metadata and social actions outside the media controls when the parent
  page already owns them. Do not duplicate like/channel UI inside the iframe.

#### `livestream`

- Use the live accent only for live-specific information: the played timeline,
  live dot and live-edge action. Do not tint the entire control surface red.
- Replace elapsed/total time with a `LIVE` / `Go live` control. When DVR is
  available, derive the timeline from `video.seekable`, show the delay from the
  live edge, and seek to the latest seekable point when the control is pressed.
- When no DVR window exists, keep the timeline visibly disabled and do not
  pretend that the media duration is seekable.
- Force playback rate to `1`. Disable 2× hold, frame stepping, number-key
  percentage seeking and playback-rate commands. Play/pause, mute, captions,
  fullscreen and picture-in-picture remain available.
- A `set-playback-rate`, frame-step or unavailable seek command must return a
  `command-result` explaining that the operation is unsupported for the active
  content type; it must not silently report success.
- The live dot may pulse subtly, but respect `prefers-reduced-motion` and avoid
  continuous attention-heavy animation elsewhere.

For all modes, changing controls must not hide captions, the buffering layer or
advertisement/player safety layers. A single click toggles playback and a
double-click outside the controls toggles fullscreen. Keyboard handling must
retain the editable-target guard and touch layouts must respect safe-area
insets.

Add regression coverage for all three accepted values, a missing value, an
unknown future value, precedence of a valid context over URL detection, an
in-place mode change, DVR and non-DVR livestreams, disabled livestream
commands, Shorts Up/Down routing, and `prefers-reduced-motion` styling.

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
`capture-frame`, `toggle-fullscreen`, `enter-fullscreen`, `exit-fullscreen`,
`toggle-picture-in-picture`, and
`request-state`. YT Zero rejects unclaimed commands immediately and claimed
commands without a result after five seconds.

The per-video `playback` context exposes `keyboardShortcuts`, a complete map of
stable action identifiers to normalized
`KeyboardEvent.code` chords (or `null` for disabled actions). The iframe must use
that map instead of a fixed key table, ignore shortcuts while an editable control
has focus, and emit the resolved action identifier in its `shortcut` event.

The legacy `ytzero:enhance:captions-toggle-request` event remains compatible;
new implementations may use only the general player event.

## Intentional source-site navigation

Links that deliberately open a source-site video or channel from YT Zero append
the exact `#ytNoRedirect` fragment. The extension treats this marker as a
one-navigation escape hatch and must not apply its automatic video redirect to
that URL. An explicit redirect chosen later from the extension popup may ignore
the marker because it is a new user action.

## Implementation brief for the extension agent

For configurable shortcut implementation, use the complete action/ownership and
test hand-off in [`browser-extension-keyboard-shortcuts.md`](./browser-extension-keyboard-shortcuts.md).

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
