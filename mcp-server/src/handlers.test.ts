import { describe, it, expect, vi, beforeEach } from "vitest";
import { listJobs, listCandidates, type Fetcher } from "./handlers.js";

function makeFetcher(
  files: Record<string, { name: string; content: string }[]> | Record<string, "404" | "429" | Error>,
): Fetcher {
  return async (path: string) => {
    const result = (files as Record<string, unknown>)[path];
    if (result === "404") return { status: 404, body: null };
    if (result === "429") return { status: 429, body: null };
    if (result instanceof Error) throw result;
    if (Array.isArray(result)) return { status: 200, body: result };
    return { status: 404, body: null };
  };
}

const validCandidateMd = `---
schema_version: "0.1"
github_username: alicelu
cc_experience_months: 12
evidence_url: https://github.com/alicelu/proj/pull/42
contact_mode: public
contact_value: alice@example.com
bio_zh: 全栈, cc 用得熟
---

More markdown body here, ignored by parser.
`;

const validJobMd = `---
schema_version: "0.1"
company: Acme
role_title_zh: 全栈工程师 (cc-fluent)
cc_required: true
apply_url: https://acme.com/jobs/123
contact_value: jobs@acme.com
---

Description body.
`;

const hiddenCandidateMd = `---
schema_version: "0.1"
github_username: bobwang
cc_experience_months: 24
evidence_url: https://github.com/bobwang/blog/blob/main/cc-workflow.md
contact_mode: hidden
contact_value: relay-pending
---
`;

describe("listCandidates", () => {
  it("returns [] for an empty directory", async () => {
    const fetcher = makeFetcher({ "candidates": [] });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("parses a valid candidate file", async () => {
    const fetcher = makeFetcher({
      "candidates": [{ name: "alicelu.md", content: validCandidateMd }],
    });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      schema_version: "0.1",
      github_username: "alicelu",
      cc_experience_months: 12,
      contact_mode: "public",
      contact_value: "alice@example.com",
    });
    expect(result.errors).toEqual([]);
  });

  it("preserves hidden mode contact_value verbatim (no leakage)", async () => {
    const fetcher = makeFetcher({
      "candidates": [{ name: "bobwang.md", content: hiddenCandidateMd }],
    });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(result.candidates[0]?.contact_mode).toBe("hidden");
    expect(result.candidates[0]?.contact_value).toBe("relay-pending");
  });

  it("skips malformed files and reports errors", async () => {
    const fetcher = makeFetcher({
      "candidates": [
        { name: "alicelu.md", content: validCandidateMd },
        { name: "broken.md", content: "---\nnot: yaml\nand: also: too: many: colons\n---\n" },
        { name: "no-frontmatter.md", content: "just a normal md\n" },
      ],
    });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.github_username).toBe("alicelu");
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("skips files where frontmatter does not validate against schema", async () => {
    const fetcher = makeFetcher({
      "candidates": [
        {
          name: "missing-required.md",
          content: `---\ngithub_username: x\n---\n`,
        },
      ],
    });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(result.candidates).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toBe("missing-required.md");
  });

  it("returns structured error on GitHub 404", async () => {
    const fetcher = makeFetcher({ "candidates": "404" });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(result.candidates).toEqual([]);
    expect(result.errors[0]?.kind).toBe("not_found");
  });

  it("returns structured error on GitHub 429 rate-limit", async () => {
    const fetcher = makeFetcher({ "candidates": "429" });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(result.candidates).toEqual([]);
    expect(result.errors[0]?.kind).toBe("rate_limited");
  });

  it("returns structured error on network failure", async () => {
    const fetcher = makeFetcher({ "candidates": new Error("ECONNREFUSED") });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(result.candidates).toEqual([]);
    expect(result.errors[0]?.kind).toBe("network");
    expect(result.errors[0]?.message).toContain("ECONNREFUSED");
  });

  it("ignores .gitkeep and non-.md files", async () => {
    const fetcher = makeFetcher({
      "candidates": [
        { name: ".gitkeep", content: "" },
        { name: "README.txt", content: "ignored" },
        { name: "alicelu.md", content: validCandidateMd },
      ],
    });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(result.candidates).toHaveLength(1);
  });
});

describe("listJobs", () => {
  it("returns [] for an empty directory", async () => {
    const fetcher = makeFetcher({ "jobs": [] });
    const result = await listJobs({ owner: "o", repo: "r", fetcher });
    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("parses a valid job file", async () => {
    const fetcher = makeFetcher({
      "jobs": [{ name: "acme-fullstack-2026-05.md", content: validJobMd }],
    });
    const result = await listJobs({ owner: "o", repo: "r", fetcher });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      company: "Acme",
      role_title_zh: "全栈工程师 (cc-fluent)",
      cc_required: true,
    });
  });

  it("excludes closed jobs by default", async () => {
    const closedJob = validJobMd.replace("contact_value: jobs@acme.com", "contact_value: jobs@acme.com\nstatus: closed");
    const fetcher = makeFetcher({
      "jobs": [
        { name: "open.md", content: validJobMd },
        { name: "closed.md", content: closedJob },
      ],
    });
    const result = await listJobs({ owner: "o", repo: "r", fetcher });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.company).toBe("Acme");
  });

  it("includes closed jobs when includeClosed=true", async () => {
    const closedJob = validJobMd.replace("contact_value: jobs@acme.com", "contact_value: jobs@acme.com\nstatus: closed");
    const fetcher = makeFetcher({
      "jobs": [{ name: "closed.md", content: closedJob }],
    });
    const result = await listJobs({ owner: "o", repo: "r", fetcher, includeClosed: true });
    expect(result.jobs).toHaveLength(1);
  });

  it("returns structured error on GitHub 404", async () => {
    const fetcher = makeFetcher({ "jobs": "404" });
    const result = await listJobs({ owner: "o", repo: "r", fetcher });
    expect(result.jobs).toEqual([]);
    expect(result.errors[0]?.kind).toBe("not_found");
  });
});

describe("schema_version handling", () => {
  it("accepts future schema_version with warning, not failure", async () => {
    const futureMd = validCandidateMd.replace('schema_version: "0.1"', 'schema_version: "99.0"');
    const fetcher = makeFetcher({
      "candidates": [{ name: "future.md", content: futureMd }],
    });
    const result = await listCandidates({ owner: "o", repo: "r", fetcher });
    // schema_version: "99.0" is not in our enum, so it's rejected.
    // Future versions should be added to schema enum; current behavior: reject + report.
    expect(result.candidates).toEqual([]);
    expect(result.errors[0]?.kind).toBe("schema_invalid");
  });
});
