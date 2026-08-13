# Browser extension hand-off: configurable keyboard shortcuts

Status: application side complete, extension side pending. This is the implementation
brief for the agent working in the YT Zero Enhance browser-extension repository.
The general transport and security contract remains in
[`browser-extension-integration.md`](./browser-extension-integration.md).

Canonical application references are `ui/src/keyboardShortcuts.ts` (action IDs,
defaults and chord semantics), `ui/src/enhanceBridge.ts` (event parser), and the
`ytzero:enhance:context` publisher/consumer in
`ui/src/pages/useWatchPageController.tsx`. If prose and runtime ever diverge,
those bounded validators and emitted payloads are authoritative.

## Required corrections to the previous extension task

Treat this as a delta that must be applied even if the earlier shortcut task is
already implemented:

1. Fix `speedDown` and `speedUp` so every keydown advances from the result of the
   preceding shortcut. Keep an extension-owned current rate and update it
   synchronously before invoking any asynchronous player/bridge operation. Never
   calculate the next step from a fresh `video.playbackRate`, YT player getter, or
   command response on every press: those may still contain the previous value.
   Required sequence from 1× is `1.25 → 1.5 → 1.75 → 2`; decreasing must be
   equally cumulative. Clamp to 0.25–2 and emit that exact owned result as
   `payload.value`. Initialize the owned value from the effective context rate
   when attaching to a video. A successful external `set-playback-rate` command
   must update it too. Temporary 2× boost must not overwrite it and must restore
   it on keyup. Reset it for a new video/context, and keep it fixed at 1× for live.
2. `togglePictureInPicture` (`KeyI` by default) means native browser PiP only.
   Use the active `HTMLVideoElement` with `requestPictureInPicture()` and
   `document.exitPictureInPicture()`. Remove any custom mini-player, floating
   iframe, resized-player mode, or invented fallback. If native PiP is
   unavailable, no-op or return an unsupported command result.
3. Remove spherical-video shortcuts and behavior completely. They are not part
   of the action registry or settings contract and must not remain as hidden
   fixed mappings.
4. Replace fixed iframe key mappings with the complete effective map received in
   `playback.keyboardShortcuts`. Rebinding must disable the old chord immediately;
   `null` disables the action. Do not retain a second legacy listener.
5. Emit only the camelCase action IDs listed below. Navigation, theater and close
   are parent-owned requests; native player operations remain iframe-owned as
   specified in the ownership table.

The app-side implementation and parser are already ready for this corrected
contract. Do not change bridge version 1.

## Source of truth and delivery

The top-level YT Zero watch page publishes the effective, per-profile shortcut map
in every `ytzero:enhance:context` event:

```json
{
  "version": 1,
  "active": true,
  "video": { "id": "dQw4w9WgXcQ" },
  "playback": {
    "keyboardSeekSeconds": 5,
    "frameStepFps": 30,
    "transportLocked": false,
    "keyboardShortcuts": {
      "togglePlay": "KeyK",
      "temporaryBoost": "Space",
      "seekBack10": "KeyJ",
      "seekForward10": "KeyL",
      "previousVideo": "Shift+KeyP",
      "nextVideo": "Shift+KeyN",
      "previousFrame": "Comma",
      "nextFrame": "Period",
      "speedDown": "Shift+Comma",
      "speedUp": "Shift+Period",
      "seekPercent": "Digit0-9",
      "previousChapter": "Alt+ArrowLeft",
      "nextChapter": "Alt+ArrowRight",
      "seekBack": "ArrowLeft",
      "seekForward": "ArrowRight",
      "volumeUp": "ArrowUp",
      "volumeDown": "ArrowDown",
      "toggleCaptions": "KeyC",
      "subtitleLarger": "Shift+Equal",
      "subtitleSmaller": "Minus",
      "toggleFullscreen": "KeyF",
      "toggleTheater": "KeyT",
      "togglePictureInPicture": "KeyI",
      "close": "Escape",
      "toggleMute": "KeyM",
      "screenshot": "KeyS"
    }
  }
}
```

The map is complete: every currently supported action is present and its value is
either a normalized chord or `null`. A `null` value disables that action. Apply a
new context atomically without reloading the iframe. The ready/context handshake
described in the main contract guarantees that a late-loading content script can
request the current map.

Do not read `keyboard_shortcuts` from the API or from the static configuration
element. The context is already authenticated, profile-aware, default-expanded,
and tied to the active watch page.

For compatibility with an older YT Zero build that omits `keyboardShortcuts`, use
the defaults from the example above. Ignore unknown future action identifiers and
unknown fields. If a known action has an invalid chord, disable only that action
and log one diagnostic; do not discard the rest of the context.

## Chord grammar and matching

Chords use physical `KeyboardEvent.code`, not localized `event.key`:

```ts
type Modifier = "Ctrl" | "Alt" | "Shift" | "Meta";
type ShortcutChord = `${string}` | null;
```

Modifiers, when present, are ordered `Ctrl`, `Alt`, `Shift`, `Meta`, followed by
the code. Matching is exact: `Shift+Comma` must not also match `Comma`, and an
unlisted modifier prevents a match. `Digit0-9` is the only family chord; it
matches `Digit0` through `Digit9` with the same configured modifiers and the
digit value determines the target tenth of the duration.

Use `code` so bindings remain stable across keyboard layouts. Display labels are
owned by YT Zero settings; the extension does not need to localize chords.

Before matching, reject events whose target or composed path contains an
`input`, `textarea`, `select`, or `[contenteditable]` element. Ignore modifier-only
keydowns. Call `preventDefault()` and `stopPropagation()` only after a configured,
enabled action matches. Suppress repeated keydowns for toggles and parent-owned
actions. Continuous volume/seek behavior may accept repeats. `temporaryBoost`
needs both keydown and keyup state: a short press toggles playback, a hold of at
least 220 ms temporarily sets 2×, and keyup restores the effective saved rate.

## Action ownership

An iframe-focused key never reaches the top document. The extension therefore
matches and owns iframe key events, then reports the resolved camelCase action in
a `shortcut` player event. Never emit the configured chord as the action.

| Action | Extension behavior | Parent behavior after event |
| --- | --- | --- |
| `togglePlay`, `temporaryBoost` | Perform playback behavior | Feedback/state only |
| `seekBack10`, `seekForward10` | Seek exactly 10 seconds | Seek feedback |
| `seekBack`, `seekForward` | Seek by `keyboardSeekSeconds` | Seek feedback |
| `previousFrame`, `nextFrame` | Only while paused, seek by `1 / frameStepFps` | None |
| `speedDown`, `speedUp` | Step by 0.25× from the last shortcut result, clamp to 0.25–2×; update the owned current-rate value synchronously before applying the player command so rapid consecutive presses accumulate | Speed state/feedback |
| `seekPercent` | Seek `DigitN` to `N / 10` of finite duration | None |
| `previousChapter`, `nextChapter` | Use context chapters; previous uses a 1-second hysteresis | None |
| `volumeUp`, `volumeDown` | Step by 5 percentage points | Volume feedback |
| `toggleCaptions` | Toggle the active caption module/track | Caption state |
| `subtitleLarger`, `subtitleSmaller` | Step font size by 1 px, clamp 12–48 px | Caption state |
| `toggleFullscreen` | Toggle iframe/player fullscreen | State only |
| `togglePictureInPicture` | Toggle native Picture-in-Picture with `HTMLVideoElement.requestPictureInPicture()` / `document.exitPictureInPicture()` | PiP state only |
| `toggleMute` | Toggle mute | Mute feedback |
| `screenshot` | Run the existing privileged raw-frame capture flow | Saved/error feedback |
| `previousVideo`, `nextVideo` | **Do not navigate in the iframe**; emit request | Parent navigates playlist/queue when allowed |
| `toggleTheater` | **Do not alter iframe layout**; emit request | Parent toggles theater mode |
| `close` | **Do not close the iframe**; emit request | Parent closes dialog/fullscreen/PiP/theater in priority order |

For every matched keydown, emit after successfully applying the action, or
immediately for a parent-owned request:

```js
const shortcutValue = action === "speedDown" || action === "speedUp"
  ? nextRate // synchronously updated extension-owned result
  : undefined;

document.dispatchEvent(new CustomEvent("ytzero:enhance:player-event", {
  detail: JSON.stringify({
    version: 1,
    videoId,
    type: "shortcut",
    payload: {
      action: "seekBack10",
      key: event.key,
      code: event.code,
      repeat: event.repeat,
      // Required for speedDown/speedUp so the parent can render exact feedback.
      // Do not read the player here: it may still report the previous rate.
      value: shortcutValue,
      modifiers: {
        alt: event.altKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey
      }
    }
  })
}));
```

The top page temporarily accepts the old action names `cinema-mode`, `seek-back`,
`seek-forward`, `seek-back-10`, `seek-forward-10`, `volume-up`, `volume-down`, and
`toggle-muted`. New extension code must emit only the camelCase identifiers above.

## Content-type and transport constraints

- In `livestream`, keep rate at 1× and do not execute `temporaryBoost`, frame
  stepping, rate stepping, or percentage seeking. A matching disabled operation
  should be consumed but should not claim success or mutate playback.
- In Watch Together follower mode, the top page remains authoritative. The
  extension must honor `playback.transportLocked` from the context and
  must not locally play, pause, seek, change rate, or navigate.
- In `short`, preserve the existing Up/Down short-navigation behavior only when
  those physical chords are not assigned to another enabled action. Configured
  bindings win over legacy fixed mappings.
- Chapter actions no-op when there is no matching chapter. Previous chapter seeks
  to zero when already in the first chapter; next chapter no-ops after the last.
- Do not install a second fixed shortcut listener alongside the configurable one.
  Replace the old lookup table so rebinding genuinely removes the old chord.

## Suggested extension structure

Keep parsing/matching independent from DOM/player code so it can be unit tested:

```text
src/shortcuts/contract.ts       action IDs, defaults, chord validator
src/shortcuts/matcher.ts        exact KeyboardEvent.code matching
src/shortcuts/controller.ts     keydown/keyup state and action dispatch
src/bridge/context.ts           validates and atomically installs context map
src/player/actions.ts           iframe-owned player operations
src/bridge/shortcutEvents.ts    reports actions and parent-owned requests
```

Do not copy settings UI, persistence, translations, or conflict detection into
the extension. Those remain owned by YT Zero.

## Required verification

Unit tests:

1. Exact modifier matching, physical `code`, null bindings, unknown actions, and
   `Digit0-9` expansion.
2. Context replacement removes old chords and installs new chords atomically.
3. Editable targets and modifier-only events are ignored.
4. Toggle actions reject repeat; seek/volume repeat policy is intentional.
5. Short Space press toggles playback; hold enters 2× once; keyup restores the
   configured effective rate even after context changes.
6. Frame step uses configured FPS and only works while paused.
7. Every consecutive speed press builds on the preceding result (for example
   `1 → 1.25 → 1.5 → 1.75`) and clamps to 0.25–2 even if the underlying player
   reports its previous rate while an asynchronous command is still pending.
8. Parent-owned actions emit one camelCase request and perform no iframe action.
9. Livestream and Watch Together locks block the restricted operations.
10. Missing map uses defaults; malformed entries disable only themselves.

Integration tests/manual smoke:

1. Rebind `togglePlay` from K to X in YT Zero, focus the iframe, verify K stops
   working and X toggles exactly once without reload.
2. Disable mute, focus the iframe, verify M is untouched by the extension.
3. Rebind a modifier chord and verify it on at least one non-US keyboard layout.
4. Verify Shift+N/P navigation, T theater, native PiP under I and Escape close are
   executed by the top page while focus remains inside the iframe.
5. Verify captions, subtitle size, screenshot, fullscreen, chapters, frame step,
   percentage seek, volume, seek interval and speed feedback.
6. Switch profiles with different maps and verify no binding leaks between them.
7. Verify Chrome and Firefox isolated-world event transport with JSON-string
   `CustomEvent.detail`.

Completion means all fixed mappings in the iframe have been replaced, every
action in the table is either executed or delegated as specified, and the tests
above pass without changing bridge version 1.
