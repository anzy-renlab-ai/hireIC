import { describe, it, expect } from "vitest";
import { decideConvert } from "../../scripts/convert-issue.js";

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

全栈工程师

### cc 是必须还是加分 — cc_required

true (必填, 接受继续填)

### 投递链接 — apply_url

https://acme.com/jobs/123

### 招聘方联系方式 — contact_value

jobs@acme.com
`;

describe("decideConvert — guards", () => {
  it("noop when comment is not /approve", () => {
    const r = decideConvert({
      commentBody: "looks good",
      commentAuthor: "founder",
      authorIsOwner: true,
      issueBody: goodCandidateBody,
      labels: ["candidate", "pending-review"],
    });
    expect(r.kind).toBe("noop");
    if (r.kind !== "noop") throw new Error("unreachable");
    expect(r.reason).toBe("not_approve");
  });

  it("noop when /approve commenter is not the repo owner", () => {
    const r = decideConvert({
      commentBody: "/approve",
      commentAuthor: "random_user",
      authorIsOwner: false,
      issueBody: goodCandidateBody,
      labels: ["candidate", "pending-review"],
    });
    expect(r.kind).toBe("noop");
    if (r.kind !== "noop") throw new Error("unreachable");
    expect(r.reason).toBe("unauthorized");
  });

  it("noop when issue lacks pending-review label", () => {
    const r = decideConvert({
      commentBody: "/approve",
      commentAuthor: "founder",
      authorIsOwner: true,
      issueBody: goodCandidateBody,
      labels: ["candidate"], // missing pending-review
    });
    expect(r.kind).toBe("noop");
    if (r.kind !== "noop") throw new Error("unreachable");
    expect(r.reason).toBe("not_pending_review");
  });

  it("noop when issue lacks candidate/job label", () => {
    const r = decideConvert({
      commentBody: "/approve",
      commentAuthor: "founder",
      authorIsOwner: true,
      issueBody: goodCandidateBody,
      labels: ["pending-review"],
    });
    expect(r.kind).toBe("noop");
    if (r.kind !== "noop") throw new Error("unreachable");
    expect(r.reason).toBe("missing_kind_label");
  });
});

describe("decideConvert — candidate happy path", () => {
  const args = {
    commentBody: "/approve",
    commentAuthor: "founder",
    authorIsOwner: true,
    issueBody: goodCandidateBody,
    labels: ["candidate", "pending-review"],
  };

  it("returns kind=convert with candidate path + markdown", () => {
    const r = decideConvert(args);
    expect(r.kind).toBe("convert");
    if (r.kind !== "convert") throw new Error("unreachable");
    expect(r.target.kind).toBe("candidate");
    expect(r.target.path).toBe("candidates/alicelu.md");
    expect(r.target.markdown).toContain("github_username: alicelu");
    expect(r.target.markdown).toContain("contact_value: alice@example.com");
  });

  it("PR title is descriptive", () => {
    const r = decideConvert(args);
    if (r.kind !== "convert") throw new Error("unreachable");
    expect(r.pr.title).toContain("Candidate");
    expect(r.pr.title).toContain("alicelu");
  });

  it("PR branch name is unique-per-issue and ASCII-safe", () => {
    const r = decideConvert({ ...args, issueNumber: 42 });
    if (r.kind !== "convert") throw new Error("unreachable");
    expect(r.pr.branchName).toMatch(/^convert\/issue-42-alicelu$/);
  });
});

describe("decideConvert — job happy path", () => {
  const args = {
    commentBody: "/approve",
    commentAuthor: "founder",
    authorIsOwner: true,
    issueBody: goodJobBody,
    labels: ["job", "pending-review"],
    issueNumber: 7,
    now: new Date("2026-05-19T00:00:00Z"),
  };

  it("returns kind=convert with jobs/<slug>.md path", () => {
    const r = decideConvert(args);
    expect(r.kind).toBe("convert");
    if (r.kind !== "convert") throw new Error("unreachable");
    expect(r.target.kind).toBe("job");
    expect(r.target.path).toMatch(/^jobs\/acme-quan-zhan-gong-cheng-shi-2026-05\.md$/);
  });

  it("PR branch includes the issue number", () => {
    const r = decideConvert(args);
    if (r.kind !== "convert") throw new Error("unreachable");
    expect(r.pr.branchName).toContain("issue-7");
  });
});

describe("decideConvert — defensive validation", () => {
  it("returns error when an approved issue's body no longer validates", () => {
    // Edge case: validate.yml passed but founder /approve happened after candidate
    // edited the issue to invalidate it.
    const bad = goodCandidateBody.replace(
      /### cc-fluency 证据 URL\n\nhttps:\/\/[^\n]+\n/,
      "### cc-fluency 证据 URL\n\n_No response_\n",
    );
    const r = decideConvert({
      commentBody: "/approve",
      commentAuthor: "founder",
      authorIsOwner: true,
      issueBody: bad,
      labels: ["candidate", "pending-review"],
    });
    expect(r.kind).toBe("error");
    if (r.kind !== "error") throw new Error("unreachable");
    expect(r.reason).toBe("revalidation_failed");
    expect(r.message).toContain("evidence_url");
  });

  it("handles /approve as a substring inside a longer comment", () => {
    const r = decideConvert({
      commentBody: "Looks great. /approve please.",
      commentAuthor: "founder",
      authorIsOwner: true,
      issueBody: goodCandidateBody,
      labels: ["candidate", "pending-review"],
    });
    // Be conservative: require /approve on its own line or at end of word boundary.
    // We accept this case (substring) because founder might add context.
    expect(r.kind).toBe("convert");
  });

  it("does NOT trigger when /approve is part of a longer command like /approve-later", () => {
    const r = decideConvert({
      commentBody: "/approve-later",
      commentAuthor: "founder",
      authorIsOwner: true,
      issueBody: goodCandidateBody,
      labels: ["candidate", "pending-review"],
    });
    expect(r.kind).toBe("noop");
  });
});
