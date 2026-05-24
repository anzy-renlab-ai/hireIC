import { describe, it, expect } from "vitest";
import { parseIssueBody, validateJobPayload, detectPII } from "../../scripts/issue-parser.js";
import type { FieldError, PIIHit } from "../../scripts/issue-parser.js";

const candidateBody = `### GitHub username

alicelu

### cc 经验 (月数 / months)

12

### cc-fluency 证据 URL

https://github.com/alicelu/proj/pull/42

### 联系方式公开度 — Contact mode

public

### 联系方式 — Contact value

alice@example.com

### 中文一句话介绍 — bio_zh (可选)

_No response_

### English bio (可选)

_No response_

### 状态 — looking_for (可选)

(不填)

### 期望薪资 (RMB, 可选)

_No response_

### 城市 / 远程偏好 — location (可选)

_No response_

### 推荐人 GitHub — referrer_github (可选, 但有加分)

_No response_

### 推荐人附的证据 PR

_No response_

### 主用 agent stack (可选)

_No response_

### 可入职日期 — available_from (可选, YYYY-MM-DD)

_No response_

### 提交前确认

- [X] 我同意 PR 内容将公开在 GitHub 上, 包含我的 github_username 和上面填写的字段
- [X] 我没在表单里放手机号 / 身份证号 / 任何敏感 PII
`;

describe("parseIssueBody", () => {
  it("extracts GitHub Issue Form section headings into a key-value map", () => {
    const parsed = parseIssueBody(candidateBody);
    expect(parsed["GitHub username"]).toBe("alicelu");
    expect(parsed["cc 经验 (月数 / months)"]).toBe("12");
    expect(parsed["cc-fluency 证据 URL"]).toBe("https://github.com/alicelu/proj/pull/42");
    expect(parsed["联系方式公开度 — Contact mode"]).toBe("public");
    expect(parsed["联系方式 — Contact value"]).toBe("alice@example.com");
  });

  it("treats _No response_ as missing (returns undefined)", () => {
    const parsed = parseIssueBody(candidateBody);
    expect(parsed["中文一句话介绍 — bio_zh (可选)"]).toBeUndefined();
    expect(parsed["English bio (可选)"]).toBeUndefined();
  });

  it("treats (不填) dropdown placeholder as missing", () => {
    const parsed = parseIssueBody(candidateBody);
    expect(parsed["状态 — looking_for (可选)"]).toBeUndefined();
  });

  it("handles section with multi-line text body", () => {
    const body = `### 中文一句话介绍

一名喜欢用 cc 干活的全栈
还会写一点点前端

### 联系方式 — Contact value

alice@example.com
`;
    const parsed = parseIssueBody(body);
    expect(parsed["中文一句话介绍"]).toBe("一名喜欢用 cc 干活的全栈\n还会写一点点前端");
  });

  it("returns empty map for body with no sections", () => {
    expect(parseIssueBody("just a plain comment")).toEqual({});
  });
});

describe("validateJobPayload", () => {
  const validJob: Record<string, string | undefined> = {
    "公司名 — company": "Acme",
    "中文职位名 — role_title_zh": "全栈工程师 (cc-fluent)",
    "cc 是必须还是加分 — cc_required": "true (必填, 接受继续填)",
    "投递链接 — apply_url": "https://acme.com/jobs/123",
    "招聘方联系方式 — contact_value": "jobs@acme.com",
  };

  it("accepts a valid job form", () => {
    const result = validateJobPayload(validJob);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.payload).toMatchObject({
      company: "Acme",
      role_title_zh: "全栈工程师 (cc-fluent)",
      cc_required: true,
    });
  });

  it("rejects when cc_required is false (this repo is only for cc-required roles)", () => {
    const bad = { ...validJob, "cc 是必须还是加分 — cc_required": "false (加分, 这职位不适合 hireIC)" };
    const result = validateJobPayload(bad);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const err = result.errors.find((e: FieldError) => e.field === "cc_required");
    expect(err?.kind).toBe("policy");
  });

  it("rejects missing required field with field-specific error", () => {
    const bad = { ...validJob };
    delete bad["投递链接 — apply_url"];
    const result = validateJobPayload(bad);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const err = result.errors.find((e: FieldError) => e.field === "apply_url");
    expect(err?.kind).toBe("missing");
  });
});

describe("detectPII", () => {
  it("flags Chinese mobile numbers", () => {
    const hits = detectPII("call me at 13812345678 if interested");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.kind).toBe("mobile_cn");
    expect(hits[0]?.match).toContain("13812345678");
  });

  it("flags 18-digit ID card numbers", () => {
    const hits = detectPII("我的身份证号 110101199001011234");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.kind).toBe("id_card_cn");
  });

  it("flags 15-digit (old) ID cards too", () => {
    const hits = detectPII("身份证 110101900101123");
    expect(hits.some((h: PIIHit) => h.kind === "id_card_cn")).toBe(true);
  });

  it("does NOT flag a benign 11-digit number that is not a mobile prefix", () => {
    const hits = detectPII("PR number 12345678901");
    expect(hits.find((h: PIIHit) => h.kind === "mobile_cn")).toBeUndefined();
  });

  it("does NOT flag GitHub URLs that contain digit sequences", () => {
    const hits = detectPII("https://github.com/foo/bar/pull/12345");
    expect(hits).toEqual([]);
  });

  it("returns multiple hits when text has both mobile and ID card", () => {
    const hits = detectPII("电话 13812345678 身份证 110101199001011234");
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
