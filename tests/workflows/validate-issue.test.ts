import { describe, it, expect } from "vitest";
import { runValidation } from "../../scripts/validate-issue.js";

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

  it("rejects PII before validating fields (PII has higher priority)", () => {
    const piiBody = goodJobBody.replace(
      "jobs@acme.com",
      "jobs@acme.com 13812345678",
    );
    const r = runValidation({ body: piiBody, labels: ["job"] });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("pii");
    expect(r.commentMarkdown).toContain("PII");
    expect(r.commentMarkdown).not.toContain("13812345678"); // redacted
    expect(r.commentMarkdown).toMatch(/138.*5678/);        // masked preview
  });
});

describe("runValidation — label routing", () => {
  it("fails fast when issue lacks the job label", () => {
    const r = runValidation({ body: goodJobBody, labels: ["bug", "wontfix"] });
    expect(r.outcome).toBe("fail");
    expect(r.reason).toBe("missing_kind_label");
    expect(r.applyLabel).toBeNull();
    expect(r.commentMarkdown).toContain("Issue Form");
  });

  it("uses the job label even if other labels present", () => {
    const r = runValidation({
      body: goodJobBody,
      labels: ["job", "pending-validation", "good-first-issue"],
    });
    expect(r.outcome).toBe("pass");
  });
});
