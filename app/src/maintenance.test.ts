import { afterEach, describe, expect, test } from "bun:test";
import { acquireMaintenance, beginMutation, maintenanceActive, maintenanceStatus } from "./maintenance";

let releaseMaintenance: (() => void) | null = null;

afterEach(() => {
  releaseMaintenance?.();
  releaseMaintenance = null;
});

describe("maintenance write lease", () => {
  test("rejects new mutations while maintenance is active", async () => {
    releaseMaintenance = await acquireMaintenance("test");
    expect(maintenanceActive()).toBe(true);
    expect(beginMutation()).toBeNull();
    expect(maintenanceStatus().reason).toBe("test");
  });

  test("waits for an existing mutation to finish", async () => {
    const releaseMutation = beginMutation();
    expect(releaseMutation).not.toBeNull();

    let acquired = false;
    const pending = acquireMaintenance("test").then((release) => {
      acquired = true;
      releaseMaintenance = release;
    });
    await Promise.resolve();
    expect(acquired).toBe(false);
    expect(beginMutation()).toBeNull();

    releaseMutation!();
    await pending;
    expect(acquired).toBe(true);
  });
});
