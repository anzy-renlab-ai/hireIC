import { describe, it, expect } from "vitest";
import {
  renderValidationErrorComment,
  renderValidationSuccessComment,
  renderPIIRejectionComment,
} from "../../scripts/bot-comments.js";
import type { FieldError } from "../../scripts/issue-parser.js";
import type { PIIHit } from "../../scripts/issue-parser.js";

describe("renderValidationErrorComment", () => {
  const sampleErrors: FieldError[] = [
    {
      field: "evidence_url",
      kind: "missing",
      message: "evidence_url 是必填. 给一条能证明你 cc 用得好的公开 URL.",
      example: "https://github.com/alicelu/proj/pull/42",
    },
  ];

  it("opens with transparency line so user knows it is a bot", () => {
    const md = renderValidationErrorComment(sampleErrors);
    expect(md).toContain("(自动校验, 不是 founder 本人)");
  });

  it("includes a ❌ line per error with field name", () => {
    const md = renderValidationErrorComment(sampleErrors);
    expect(md).toContain("❌");
    expect(md).toContain("evidence_url");
    expect(md).toContain("evidence_url 是必填");
  });

  it("includes the example as a concrete e.g.", () => {
    const md = renderValidationErrorComment(sampleErrors);
    expect(md).toContain("https://github.com/alicelu/proj/pull/42");
  });

  it("ends with anti-shame retry line", () => {
    const md = renderValidationErrorComment(sampleErrors);
    expect(md).toContain("不限次数");
  });

  it("includes link to SCHEMA.md for context", () => {
    const md = renderValidationErrorComment(sampleErrors);
    expect(md).toMatch(/SCHEMA\.md/);
  });

  it("renders multiple errors in stable order", () => {
    const multi: FieldError[] = [
      { field: "github_username", kind: "missing", message: "username missing" },
      { field: "evidence_url", kind: "missing", message: "evidence missing" },
    ];
    const md = renderValidationErrorComment(multi);
    const ghIdx = md.indexOf("github_username");
    const evIdx = md.indexOf("evidence_url");
    expect(ghIdx).toBeGreaterThan(-1);
    expect(evIdx).toBeGreaterThan(-1);
    expect(ghIdx).toBeLessThan(evIdx);
  });

  it("policy errors get a distinctive lead (e.g. cc_required=false on a job)", () => {
    const policy: FieldError[] = [
      {
        field: "cc_required",
        kind: "policy",
        message: "hireIC 只接受 cc 必填的职位.",
      },
    ];
    const md = renderValidationErrorComment(policy);
    expect(md).toMatch(/policy|不在 hireIC 范围|不接受/);
  });
});

describe("renderValidationSuccessComment", () => {
  it("opens with transparency line", () => {
    const md = renderValidationSuccessComment("candidate");
    expect(md).toContain("(自动校验, 不是 founder 本人)");
  });

  it("contains ✅ and mentions pending-review", () => {
    const md = renderValidationSuccessComment("candidate");
    expect(md).toContain("✅");
    expect(md).toMatch(/pending.review|founder 审/);
  });

  it("differs for candidate vs job", () => {
    const cand = renderValidationSuccessComment("candidate");
    const job = renderValidationSuccessComment("job");
    expect(cand).not.toBe(job);
  });
});

describe("renderPIIRejectionComment", () => {
  const hits: PIIHit[] = [
    { kind: "mobile_cn", match: "13812345678", index: 12 },
    { kind: "id_card_cn", match: "110101199001011234", index: 50 },
  ];

  it("opens with transparency line", () => {
    const md = renderPIIRejectionComment(hits);
    expect(md).toContain("(自动校验, 不是 founder 本人)");
  });

  it("explicitly names what PII was found WITHOUT echoing the full value", () => {
    const md = renderPIIRejectionComment(hits);
    expect(md).toContain("手机号");
    expect(md).toContain("身份证");
    // The raw 11-digit mobile number should NOT appear in the comment (we redact)
    expect(md).not.toContain("13812345678");
    expect(md).not.toContain("110101199001011234");
  });

  it("includes a masked preview (138****5678) so user can find which field they wrote it in", () => {
    const md = renderPIIRejectionComment(hits);
    expect(md).toMatch(/138.*5678/);
  });

  it("explains why and what to do next", () => {
    const md = renderPIIRejectionComment(hits);
    expect(md).toMatch(/PII|敏感|公开/);
    expect(md).toContain("修改");
  });
});
