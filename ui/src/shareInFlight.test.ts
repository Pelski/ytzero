import { expect, test } from "bun:test";
import { shareInFlight } from "./shareInFlight";

test("shares a running request but does not cache its result", async () => {
  let calls = 0;
  let resolve!: (value: number) => void;
  const load = () => {
    calls++;
    return new Promise<number>((done) => { resolve = done; });
  };

  const first = shareInFlight("shared-success", load);
  const second = shareInFlight("shared-success", load);
  expect(first).toBe(second);
  expect(calls).toBe(1);

  resolve(7);
  expect(await first).toBe(7);
  expect(await shareInFlight("shared-success", async () => ++calls)).toBe(2);
});

test("allows retrying a failed request", async () => {
  const first = shareInFlight("shared-failure", async () => { throw new Error("offline"); });
  let message = "";
  try {
    await first;
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toBe("offline");
  expect(await shareInFlight("shared-failure", async () => "recovered")).toBe("recovered");
});
