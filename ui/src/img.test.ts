import { describe, expect, test } from "bun:test";
import { img } from "./img";

describe("image proxy URLs", () => {
  test("keeps the existing proxy URL for ordinary callers", () => {
    expect(img("https://i.ytimg.com/vi/example/hqdefault.jpg"))
      .toBe("/api/img?u=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fexample%2Fhqdefault.jpg");
  });

  test("can ask the proxy to expose a cache miss as an image error", () => {
    expect(img("https://i.ytimg.com/vi/example/oardefault.jpg", { onMiss: "error" }))
      .toBe("/api/img?u=https%3A%2F%2Fi.ytimg.com%2Fvi%2Fexample%2Foardefault.jpg&onMiss=error");
  });

  test("does not append proxy options to local image paths", () => {
    expect(img("/assets/poster.jpg", { onMiss: "error" })).toBe("/assets/poster.jpg");
  });
});
