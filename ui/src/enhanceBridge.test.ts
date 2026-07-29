import { describe, expect, test } from "bun:test";
import { createEnhanceConfiguration, ENHANCE_BRIDGE_EVENTS, ENHANCE_CONFIGURATION_FORMAT, parseEnhancePlayerEvent, resolveEnhanceContentType, serializeEnhanceConfiguration } from "./enhanceBridge";

describe("YT Zero Enhance configuration", () => {
  test("maps watch-page video metadata to the embedded-player content type", () => {
    expect(resolveEnhanceContentType({ live_status: "none", is_short: 0 })).toBe("default");
    expect(resolveEnhanceContentType({ live_status: "was_live", is_short: 0 })).toBe("default");
    expect(resolveEnhanceContentType({ live_status: "none", is_short: 1 })).toBe("short");
    expect(resolveEnhanceContentType({ live_status: "live", is_short: 0 })).toBe("livestream");
    expect(resolveEnhanceContentType({ live_status: "upcoming", is_short: 1 })).toBe("livestream");
  });

  test("serializes authenticated profile settings with native JSON types", () => {
    const config = createEnhanceConfiguration({
      enhance_enabled: "1",
      enhance_replace_controls: "0",
      player_speed: "1.5",
      player_cc: "1",
      player_cc_lang: "pl",
      player_screenshot_format: "png",
      player_screenshot_quality: "0.85",
      sponsorblock_enabled: "1",
      sponsorblock_categories: '["sponsor","intro"]',
    });

    expect(config.format).toBe(ENHANCE_CONFIGURATION_FORMAT);
    expect(config.enabled).toBe(true);
    expect(config.player.replaceControls).toBe(false);
    expect(config.player.frameStepFps).toBe(30);
    expect(config.player.defaultPlaybackRate).toBe(1.5);
    expect(config.player.captions.enabledByDefault).toBe(true);
    expect(config.player.captions.language).toBe("pl");
    expect(config.player.captions.availableLanguages.some((language) => language.code === "pl" && language.label === "Polski")).toBe(true);
    expect(config.player.captions.availableLanguages.some((language) => language.code === "zh-Hans")).toBe(true);
    expect(config.screenshots.format).toBe("png");
    expect(config.screenshots.jpegQuality).toBe(0.85);
    expect(JSON.stringify(config.sponsorBlock.categories)).toBe(JSON.stringify(["sponsor", "intro"]));
    expect(JSON.stringify(config.bridge.events)).toBe(JSON.stringify(ENHANCE_BRIDGE_EVENTS));
    expect(config.bridge.extensionStatus.elementId).toBe("ytzero-enhance-extension-status");
    expect(config.bridge.extensionStatus.attribute).toBe("data-extension-status");
    expect(config.bridge.extensionStatus.activeValue).toBe("active");
  });

  test("clamps values and ignores unrelated secrets", () => {
    const input = {
      player_screenshot_quality: "invalid",
      sponsorblock_categories: "not-json",
      auth_oidc_client_secret: "DO-NOT-EXPOSE",
    };
    const config = createEnhanceConfiguration(input);
    const serialized = JSON.stringify(config);

    expect(config.player.frameStepFps).toBe(30);
    expect(config.screenshots.jpegQuality).toBe(0.92);
    expect(JSON.stringify(config.sponsorBlock.categories)).toBe(JSON.stringify(["sponsor"]));
    expect(serialized.includes("DO-NOT-EXPOSE")).toBe(false);
  });

  test("escapes markup while remaining valid JSON", () => {
    const serialized = serializeEnhanceConfiguration({ player_screenshot_filename: "</script><script>alert(1)</script>" });

    expect(serialized.includes("</script>")).toBe(false);
    expect(JSON.parse(serialized).screenshots.filenameTemplate).toBe("</script><script>alert(1)</script>");
  });

  test("parses versioned enhanced-player events with JSON-string details", () => {
    const state = {
      paused: false, ended: false, currentTime: 12, duration: 120, volume: 0.8, muted: false,
      playbackRate: 1.5, captionSize: 19, captionsEnabled: true, fullscreen: false, pictureInPicture: false,
    };
    const event = new CustomEvent(ENHANCE_BRIDGE_EVENTS.playerEvent, {
      detail: JSON.stringify({ version: 1, videoId: "abcdefghijk", type: "state", payload: { state } }),
    });

    const parsed = parseEnhancePlayerEvent(event);
    expect(parsed?.type).toBe("state");
    if (parsed?.type === "state") expect(parsed.payload.state.currentTime).toBe(12);
  });

  test("rejects malformed and unsupported enhanced-player events", () => {
    expect(parseEnhancePlayerEvent(new CustomEvent(ENHANCE_BRIDGE_EVENTS.playerEvent, { detail: "not-json" }))).toBe(null);
    expect(parseEnhancePlayerEvent(new CustomEvent(ENHANCE_BRIDGE_EVENTS.playerEvent, {
      detail: JSON.stringify({ version: 2, videoId: "abcdefghijk", type: "ended", payload: {} }),
    }))).toBe(null);
  });
});
