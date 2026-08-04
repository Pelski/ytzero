import { describe, expect, test } from "bun:test";
import { linkifyText } from "./linkifyText";

describe("linkifyText", () => {
  test("recognizes HTTP and www links while preserving surrounding text", () => {
    expect(JSON.stringify(linkifyText("See https://example.com/a?q=1 and www.example.org/test."))).toBe(JSON.stringify([
      { type: "text", value: "See " },
      { type: "link", value: "https://example.com/a?q=1", href: "https://example.com/a?q=1" },
      { type: "text", value: " and " },
      { type: "link", value: "www.example.org/test", href: "https://www.example.org/test" },
      { type: "text", value: "." },
    ]));
  });

  test("keeps balanced URL parentheses and removes sentence punctuation", () => {
    expect(JSON.stringify(linkifyText("(https://example.com/wiki/Test_(page))."))).toBe(JSON.stringify([
      { type: "text", value: "(" },
      { type: "link", value: "https://example.com/wiki/Test_(page)", href: "https://example.com/wiki/Test_(page)" },
      { type: "text", value: ")." },
    ]));
  });
});
