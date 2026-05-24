import { describe, it, expect } from "vitest";
import matter from "gray-matter";
import {
  generateJobMarkdown,
  jobFilename,
} from "../../scripts/md-generator.js";
import type { JobPayload } from "../../scripts/issue-parser.js";

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
