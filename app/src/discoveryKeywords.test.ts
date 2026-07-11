import { describe, expect, test } from "bun:test";
import { buildKeywordPlan, tokenizeDiscoveryText } from "./discoveryKeywords";

describe("Discovery keyword extraction", () => {
  test("removes URLs, social boilerplate and preserves non-English letters", () => {
    expect(tokenizeDiscoveryText("Świetny poradnik sieciowy — https://example.com Join Discord & YouTube"))
      .toEqual(["świetny", "poradnik", "sieciowy"]);
  });

  test("does not let repeated promotional text dominate keywords", () => {
    const plan = buildKeywordPlan([
      { kind: "title", weight: 4, text: "Wireshark network analysis tutorial" },
      { kind: "title", weight: 3, text: "Practical network security with Wireshark" },
      { kind: "title", weight: 2, text: "NordVPN sponsored https Instagram Discord Facebook links links links" },
      { kind: "tag", weight: 5, text: "network security" },
    ], []);

    expect(plan.terms.slice(0, 5)).toContain("network");
    expect(plan.terms.slice(0, 5)).toContain("security");
    expect(plan.terms).not.toContain("https");
    expect(plan.terms).not.toContain("discord");
    expect(plan.queries.some((query) => query.includes("network security"))).toBe(true);
  });

  test("builds each query from one coherent seed and respects blocked terms", () => {
    const plan = buildKeywordPlan([
      { kind: "title", weight: 4, text: "Docker networking explained for beginners" },
      { kind: "title", weight: 4, text: "Street photography composition guide" },
      { kind: "tag", weight: 5, text: "docker networking" },
    ], ["beginners"]);

    expect(plan.queries).toContain("docker networking");
    expect(plan.queries.every((query) => !(query.includes("docker") && query.includes("photography")))).toBe(true);
    expect(plan.terms).not.toContain("beginners");
  });

  test("allows a specific one-word user tag to become a query", () => {
    const plan = buildKeywordPlan([
      { kind: "tag", weight: 5, text: "wireshark" },
      { kind: "title", weight: 3, text: "Packet analysis basics" },
    ], []);

    expect(plan.queries).toContain("wireshark");
  });
});
