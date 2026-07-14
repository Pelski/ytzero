import { describe, expect, test } from "bun:test";
import { decodeHtmlEntities } from "./htmlEntities";

describe("decodeHtmlEntities", () => {
  test("decodes named and numeric title entities", () => {
    expect(decodeHtmlEntities("I&#39;m annoyed &amp; it&#x27;s great &quot;really&quot;"))
      .toBe(`I'm annoyed & it's great "really"`);
  });

  test("decodes double-escaped entities without changing normal text", () => {
    expect(decodeHtmlEntities("I&amp;#39;m fine")).toBe("I'm fine");
    expect(decodeHtmlEntities("Rock & Roll")).toBe("Rock & Roll");
  });
});
