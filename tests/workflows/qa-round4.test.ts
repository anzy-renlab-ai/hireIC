import { describe, it, expect } from "vitest";
import { validateCandidatePayload, detectPII } from "../../scripts/issue-parser.js";

// Round-4 QA: github_username regex edge cases + emoji/XSS/SQL injection sanity.
// (Already covered by issue-parser.test.ts at unit level — this file is a focused
// adversarial pass to confirm no new gaps after the QA-round changes.)

const base = {
  "GitHub username": "alicelu",
  "cc 经验 (月数 / months)": "12",
  "cc-fluency 证据 URL": "https://github.com/alicelu/x/pull/1",
  "联系方式公开度 — Contact mode": "public",
  "联系方式 — Contact value": "alice@example.com",
};

describe("R4 — github_username regex edge cases", () => {
  it.each([
    ["alicelu", true],
    ["Alice-Lu", true],
    ["A1", true],
    ["a", true],
  ])("accepts %s = %s", (u, ok) => {
    const r = validateCandidatePayload({ ...base, "GitHub username": u });
    expect(r.ok).toBe(ok);
  });

  it.each([
    ["alice_underscore", false],
    ["-leadinghyphen", false],
    ["with space", false],
    ["🦄emoji", false],
    ["a".repeat(40), false],
    ["", false],
  ])("rejects %s", (u) => {
    const r = validateCandidatePayload({ ...base, "GitHub username": u });
    expect(r.ok).toBe(false);
  });
});

describe("R4 — XSS / injection text fields treated as data", () => {
  it("accepts but does not execute <script> in bio_zh", () => {
    const r = validateCandidatePayload({ ...base, "中文一句话介绍 — bio_zh (可选)": "<script>alert(1)</script>" });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.payload.bio_zh).toContain("<script>");
    // Real safety: md-generator + render must escape on output. Page itself uses escapeHtml() in JS.
  });

  it("accepts SQL-like injection in contact_value (no DB, schema is plain text)", () => {
    const r = validateCandidatePayload({ ...base, "联系方式 — Contact value": "'; DROP TABLE--" });
    expect(r.ok).toBe(true);
  });
});

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
