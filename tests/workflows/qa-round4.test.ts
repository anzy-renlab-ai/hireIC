import { describe, it, expect } from "vitest";
import { detectPII } from "../../scripts/issue-parser.js";

// Round-4 QA: PII detection boundary checks — a focused adversarial pass to
// confirm no new gaps after the QA-round changes.

describe("R4 — PII detection does not chase URL fragments", () => {
  it("does not flag mobile-shaped digits inside a github PR URL", () => {
    const hits = detectPII("https://github.com/u/p/pull/13812345678");
    expect(hits.filter(h => h.kind === "mobile_cn")).toEqual([]);
  });

  it("does flag a bare mobile number in free text", () => {
    const hits = detectPII("contact me at 13812345678 please");
    expect(hits.some(h => h.kind === "mobile_cn")).toBe(true);
  });
});
