import { describe, expect, test } from "bun:test";
import { hasMembersOnlyBadge, parsePublishedTimeText, parseVideoCreatorsFromInitialData, relativePublishedAt } from "./youtube";

describe("YouTube publication metadata", () => {
  test("parses relative publication labels returned by supported locales", () => {
    expect(parsePublishedTimeText("Streamed 3 weeks ago")).toEqual({ value: 3, unit: "week" });
    expect(parsePublishedTimeText("5 dni temu")).toEqual({ value: 5, unit: "day" });
    expect(parsePublishedTimeText("vor 2 Monaten")).toEqual({ value: 2, unit: "month" });
  });

  test("turns a relative label into an approximate historical date", () => {
    expect(relativePublishedAt({ value: 3, unit: "week" }, new Date("2026-07-22T12:00:00.000Z")))
      .toBe("2026-07-01T12:00:00.000Z");
    expect(relativePublishedAt({ value: 1, unit: "year" }, new Date("2026-07-22T12:00:00.000Z")))
      .toBe("2025-07-22T12:00:00.000Z");
  });

  test("recognizes current and legacy members-only badges", () => {
    expect(hasMembersOnlyBadge({ badgeViewModel: { badgeStyle: "BADGE_MEMBERS_ONLY" } })).toBe(true);
    expect(hasMembersOnlyBadge({ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_MEMBERS_ONLY" } })).toBe(true);
    expect(hasMembersOnlyBadge({ thumbnailBadgeViewModel: { text: "21:00" } })).toBe(false);
  });

  test("parses an arbitrary number of native video collaborators", () => {
    const creator = (channelId: string, title: string) => ({
      listItemViewModel: {
        title: { content: title, commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: channelId } } } }] },
        subtitle: { content: `@${title.toLowerCase()} • 10 subscribers` },
        leadingAccessory: { avatarViewModel: { image: { sources: [{ url: `${channelId}.jpg` }] } } },
      },
    });
    const data = {
      videoAttributionViewModel: {
        attributedTitle: {
          content: "Owner, Guest and Third",
        },
        onTap: { innertubeCommand: { showDialogCommand: { panelLoadingStrategy: { inlineContent: { dialogViewModel: {
          customContent: { listViewModel: { listItems: [
            creator("UCOWNER0000000000000000", "Owner"),
            creator("UCGUEST0000000000000000", "Guest"),
            creator("UCTHIRD0000000000000000", "Third"),
          ] } },
        } } } } } },
      },
    };

    expect(parseVideoCreatorsFromInitialData(data, "UCOWNER0000000000000000")).toEqual([
      { channelId: "UCOWNER0000000000000000", title: "Owner", avatar: "UCOWNER0000000000000000.jpg", handle: "@owner", isOwner: true },
      { channelId: "UCGUEST0000000000000000", title: "Guest", avatar: "UCGUEST0000000000000000.jpg", handle: "@guest", isOwner: false },
      { channelId: "UCTHIRD0000000000000000", title: "Third", avatar: "UCTHIRD0000000000000000.jpg", handle: "@third", isOwner: false },
    ]);
  });

  test("does not mistake ordinary dialogs for collaborator attribution", () => {
    const data = {
      showDialogViewModel: {
        customContent: { listViewModel: { listItems: [{
          listItemViewModel: { title: { content: "Settings" } },
        }] } },
      },
    };

    expect(parseVideoCreatorsFromInitialData(data, "UCOWNER0000000000000000")).toEqual([]);
  });

  test("ignores a channel list that does not contain the video's owner", () => {
    const creator = (channelId: string, title: string) => ({
      listItemViewModel: {
        title: { content: title, commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: channelId } } } }] },
      },
    });
    const data = {
      dialogViewModel: {
        customContent: { listViewModel: { listItems: [
          creator("UCOTHER0000000000000000", "Other"),
          creator("UCANOTHER00000000000000", "Another"),
        ] } },
      },
    };

    expect(parseVideoCreatorsFromInitialData(data, "UCOWNER0000000000000000")).toEqual([]);
  });
});
