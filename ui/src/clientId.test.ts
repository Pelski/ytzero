import { describe, expect, test } from "bun:test";
import { createClientId } from "./clientId";

describe("browser client IDs", () => {
  test("uses native randomUUID when available", () => {
    expect(createClientId({ randomUUID: () => "native-id" })).toBe("native-id");
  });

  test("builds an ID with getRandomValues on an insecure origin", () => {
    const id = createClientId({
      getRandomValues: (bytes) => {
        bytes[0] = 123;
        bytes[1] = 456;
        return bytes;
      },
    });
    expect(id).toBe("123-456");
  });

  test("still produces distinct IDs without either crypto API", () => {
    const first = createClientId(null);
    const second = createClientId(null);
    expect(first === second).toBe(false);
  });
});
