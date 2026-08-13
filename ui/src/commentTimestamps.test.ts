import { describe, expect, test } from "bun:test";
import { parseCommentText } from "./commentTimestamps";

describe("comment timestamps", () => {
  test("recognizes minute and hour timestamps", () => {
    expect(JSON.stringify(parseCommentText("See 12:33 and 1:02:03"))).toBe(JSON.stringify([
      { type: "text", value: "See " },
      { type: "timestamp", value: "12:33", seconds: 753 },
      { type: "text", value: " and " },
      { type: "timestamp", value: "1:02:03", seconds: 3_723 },
    ]));
  });

  test("does not turn invalid timestamps or URL fragments into seek actions", () => {
    expect(JSON.stringify(parseCommentText("Bad 1:99 https://example.com/watch?t=12:33"))).toBe(JSON.stringify([
      { type: "text", value: "Bad " },
      { type: "text", value: "1:99" },
      { type: "text", value: " " },
      { type: "url", value: "https://example.com/watch?t=12:33" },
    ]));
  });

  test("marks handles without treating email addresses or URLs as mentions", () => {
    expect(parseCommentText("Thanks @creator.name, mail me@example.com or visit https://example.com/@channel"))
      .toEqual([
        { type: "text", value: "Thanks " },
        { type: "mention", value: "@creator.name" },
        { type: "text", value: ", mail me@example.com or visit " },
        { type: "url", value: "https://example.com/@channel" },
      ]);
  });
});
