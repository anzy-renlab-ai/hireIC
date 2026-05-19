import { describe, it, expect } from "vitest";
import matter from "gray-matter";
import {
  generateCandidateMarkdown,
  generateJobMarkdown,
  candidateFilename,
  jobFilename,
} from "../../scripts/md-generator.js";
import type { CandidatePayload, JobPayload } from "../../scripts/issue-parser.js";

describe("candidateFilename", () => {
  it("uses github_username.md", () => {
    expect(candidateFilename({ github_username: "alicelu" } as CandidatePayload)).toBe("alicelu.md");
  });

  it("lowercases github_username for filesystem consistency", () => {
    expect(candidateFilename({ github_username: "AliceLu" } as CandidatePayload)).toBe("alicelu.md");
  });
});

describe("jobFilename", () => {
  const base: JobPayload = {
    schema_version: "0.1",
    company: "Acme",
    role_title_zh: "全栈工程师",
    cc_required: true,
    apply_url: "https://acme.com/jobs",
    contact_value: "jobs@acme.com",
  };

  it("slugs company + role + uses provided date in YYYY-MM", () => {
    expect(jobFilename(base, new Date("2026-05-19T10:00:00Z"))).toBe("acme-quan-zhan-gong-cheng-shi-2026-05.md");
  });

  it("handles role_title_en when present (preferred for slug)", () => {
    const job: JobPayload = { ...base, role_title_en: "Fullstack Engineer" };
    expect(jobFilename(job, new Date("2026-05-19T00:00:00Z"))).toBe("acme-fullstack-engineer-2026-05.md");
  });

  it("strips special chars and collapses dashes", () => {
    const job: JobPayload = { ...base, company: "Acme Corp.,Ltd!", role_title_en: "Sr. Engineer (Backend)" };
    expect(jobFilename(job, new Date("2026-05-19T00:00:00Z"))).toBe("acme-corp-ltd-sr-engineer-backend-2026-05.md");
  });

  it("truncates very long slugs to keep filenames reasonable", () => {
    const job: JobPayload = {
      ...base,
      role_title_en: "a".repeat(100),
    };
    const name = jobFilename(job, new Date("2026-05-19T00:00:00Z"));
    expect(name.length).toBeLessThan(100);
  });
});

describe("generateCandidateMarkdown", () => {
  const minimal: CandidatePayload = {
    schema_version: "0.1",
    github_username: "alicelu",
    cc_experience_months: 12,
    evidence_url: "https://github.com/alicelu/proj/pull/42",
    contact_mode: "public",
    contact_value: "alice@example.com",
  };

  it("starts with --- yaml frontmatter --- block", () => {
    const md = generateCandidateMarkdown(minimal);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toMatch(/\n---\n/);
  });

  it("includes every required field in frontmatter", () => {
    const md = generateCandidateMarkdown(minimal);
    expect(md).toContain("schema_version:");
    expect(md).toContain("github_username: alicelu");
    expect(md).toContain("cc_experience_months: 12");
    expect(md).toContain("evidence_url: https://github.com/alicelu/proj/pull/42");
    expect(md).toContain("contact_mode: public");
    expect(md).toContain("contact_value: alice@example.com");
  });

  it("omits optional fields when not set", () => {
    const md = generateCandidateMarkdown(minimal);
    expect(md).not.toContain("bio_zh:");
    expect(md).not.toContain("looking_for:");
    expect(md).not.toContain("referrer_github:");
  });

  it("includes optional fields when set", () => {
    const md = generateCandidateMarkdown({
      ...minimal,
      bio_zh: "全栈, cc 用得熟",
      looking_for: "open-to-talk",
      referrer_github: "bob",
    });
    expect(md).toContain("bio_zh: 全栈, cc 用得熟");
    expect(md).toContain("looking_for: open-to-talk");
    expect(md).toContain("referrer_github: bob");
  });

  it("YAML-quotes schema_version since 0.1 is ambiguous", () => {
    const md = generateCandidateMarkdown(minimal);
    expect(md).toMatch(/schema_version:\s*"0\.1"/);
  });

  it("includes a body section after frontmatter with auto-generated note", () => {
    const md = generateCandidateMarkdown(minimal);
    const bodyStart = md.indexOf("\n---\n", 5) + 5;
    const body = md.slice(bodyStart);
    expect(body.trim().length).toBeGreaterThan(0);
    expect(body).toContain("自动生成");
  });

  it("preserves hidden mode contact_value (relay-pending or relay-*)", () => {
    const hidden: CandidatePayload = {
      ...minimal,
      contact_mode: "hidden",
      contact_value: "relay-pending",
    };
    const md = generateCandidateMarkdown(hidden);
    expect(md).toContain("contact_mode: hidden");
    expect(md).toContain("contact_value: relay-pending");
  });

  it("escapes strings that contain colons or special yaml chars", () => {
    const md = generateCandidateMarkdown({
      ...minimal,
      bio_zh: "I love: coding! And: shipping.",
    });
    // The bio should be wrapped in quotes since it contains a colon
    expect(md).toMatch(/bio_zh:\s*["'].*coding.*["']/);
  });
});

describe("generateJobMarkdown", () => {
  const minimal: JobPayload = {
    schema_version: "0.1",
    company: "Acme",
    role_title_zh: "全栈工程师 (cc-fluent)",
    cc_required: true,
    apply_url: "https://acme.com/jobs/123",
    contact_value: "jobs@acme.com",
  };

  it("starts with --- yaml frontmatter --- block", () => {
    const md = generateJobMarkdown(minimal);
    expect(md.startsWith("---\n")).toBe(true);
  });

  it("includes every required field in frontmatter", () => {
    const md = generateJobMarkdown(minimal);
    expect(md).toContain("company: Acme");
    expect(md).toContain("role_title_zh:");
    expect(md).toContain("cc_required: true");
    expect(md).toContain("apply_url: https://acme.com/jobs/123");
    expect(md).toContain("contact_value: jobs@acme.com");
  });

  it("round-trips: gray-matter can parse the generated frontmatter back to the same payload", () => {
    const md = generateJobMarkdown(minimal);
    const parsed = matter(md);
    expect(parsed.data.role_title_zh).toBe("全栈工程师 (cc-fluent)");
    expect(parsed.data.company).toBe("Acme");
    expect(parsed.data.cc_required).toBe(true);
  });

  it("sets status to open by default", () => {
    const md = generateJobMarkdown(minimal);
    expect(md).toContain("status: open");
  });

  it("respects an explicit closed status if provided", () => {
    const md = generateJobMarkdown({ ...minimal, status: "closed" });
    expect(md).toContain("status: closed");
  });
});
