import { describe, it, expect } from "vitest";
import { runValidation } from "../../scripts/validate-issue.js";

const goodCandidateBody = `### GitHub username

alicelu

### cc 经验 (月数 / months)

12

### cc-fluency 证据 URL

https://github.com/alicelu/proj/pull/42

### 联系方式公开度 — Contact mode

public

### 联系方式 — Contact value

alice@example.com
`;

const goodJobBody = `### 公司名 — company

Acme

### 中文职位名 — role_title_zh

全栈工程师 (cc-fluent)

### cc 是必须还是加分 — cc_required

true (必填, 接受继续填)

### 投递链接 — apply_url

https://acme.com/jobs/123

### 招聘方联系方式 — contact_value

jobs@acme.com
`;

describe("runValidation — candidate flow", () => {
  it("passes a valid candidate and applies pending-review label", () => {
    const r = runValidation({ body: goodCandidateBody, labels: ["candidate"] });
    expect(r.outcome).toBe("pass");
    expect(r.applyLabel).toBe("pending-review");
    expect(r.reason).toBe("validated");
    expect(r.commentMarkdown).toContain("✅");
    expect(r.commentMarkdown).toContain("候选人 profile");
  });

  it("fails when a required field is missing", () => {
    const noEvidence = goodCandidateBody.replace(
      /### cc-fluency 证据 URL\n\nhttps:\/\/[^\n]+\n/,
      "### cc-fluency 证据 URL\n\n_No response_\n",
    );
    const r = runValidation({ body: noEvidence, labels: ["candidate"] });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("field_errors");
    expect(r.applyLabel).toBeNull();
    expect(r.commentMarkdown).toContain("evidence_url");
    expect(r.commentMarkdown).toContain("❌");
  });

  it("rejects PII before validating fields (PII has higher priority)", () => {
    const piiBody = goodCandidateBody.replace(
      "alice@example.com",
      "alice@example.com 13812345678",
    );
    const r = runValidation({ body: piiBody, labels: ["candidate"] });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("pii");
    expect(r.commentMarkdown).toContain("PII");
    expect(r.commentMarkdown).not.toContain("13812345678"); // redacted
    expect(r.commentMarkdown).toMatch(/138.*5678/);        // masked preview
  });
});

describe("runValidation — job flow", () => {
  it("passes a valid job and applies pending-review label", () => {
    const r = runValidation({ body: goodJobBody, labels: ["job"] });
    expect(r.outcome).toBe("pass");
    expect(r.applyLabel).toBe("pending-review");
    expect(r.commentMarkdown).toContain("招聘职位");
  });

  it("rejects job when cc_required is false (policy)", () => {
    const bad = goodJobBody.replace(
      "true (必填, 接受继续填)",
      "false (加分, 这职位不适合 hireIC)",
    );
    const r = runValidation({ body: bad, labels: ["job"] });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("field_errors");
    expect(r.commentMarkdown).toContain("cc_required");
    expect(r.commentMarkdown).toContain("不在 hireIC 范围");
  });
});

describe("runValidation — label routing", () => {
  it("fails fast when issue lacks candidate/job label", () => {
    const r = runValidation({ body: goodCandidateBody, labels: ["bug", "wontfix"] });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("missing_kind_label");
    expect(r.applyLabel).toBeNull();
    expect(r.commentMarkdown).toContain("Issue Form");
  });

  it("uses the candidate label even if other labels present", () => {
    const r = runValidation({
      body: goodCandidateBody,
      labels: ["candidate", "pending-validation", "good-first-issue"],
    });
    expect(r.outcome).toBe("pass");
  });
});

describe("runValidation — hidden mode does not leak", () => {
  it("normalizes hidden contact_value even if user put a real email", () => {
    const hiddenBody = goodCandidateBody.replace("public", "hidden");
    const r = runValidation({ body: hiddenBody, labels: ["candidate"] });
    expect(r.outcome).toBe("pass");
    // The success comment does not echo the contact_value
    expect(r.commentMarkdown).not.toContain("alice@example.com");
  });
});
