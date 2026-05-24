import { describe, it, expect } from "vitest";
import { listJobs, type Fetcher } from "./handlers.js";

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
  it("rejects an unknown schema_version with a schema_invalid error", async () => {
    const futureMd = validJobMd.replace('schema_version: "0.1"', 'schema_version: "99.0"');
    const fetcher = makeFetcher({
      "jobs": [{ name: "future.md", content: futureMd }],
    });
    const result = await listJobs({ owner: "o", repo: "r", fetcher });
    // schema_version: "99.0" is not in our enum, so it's rejected.
    // Future versions should be added to schema enum; current behavior: reject + report.
    expect(result.jobs).toEqual([]);
    expect(result.errors[0]?.kind).toBe("schema_invalid");
  });
});

describe("MCP serving — prompt-injection hardening of free-text", () => {
  const ZW = "​"; // zero-width space
  const BIDI = "‮"; // right-to-left override

  it("strips zero-width / bidi / control chars from served job free-text (anti-smuggling)", async () => {
    const evil = [
      "---",
      'schema_version: "0.1"',
      "company: Acme",
      `role_title_zh: "工程师"`,
      "cc_required: true",
      "apply_url: https://acme.com/j/1",
      "contact_value: jobs@acme.com",
      `description_zh: "hi${ZW}there${BIDI}evil"`,
      "---",
      "",
    ].join("\n");
    const fetcher = makeFetcher({ "jobs": [{ name: "acme.md", content: evil }] });
    const result = await listJobs({ owner: "o", repo: "r", fetcher });
    const c = result.jobs[0]!;
    expect(c.description_zh).toBe("hithereevil");
    // no zero-width, bidi, or C0 control chars remain
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/.test(c.description_zh ?? "")).toBe(false);
  });

  it("does not alter clean job free-text", async () => {
    const fetcher = makeFetcher({
      "jobs": [{ name: "acme.md", content: validJobMd }],
    });
    const result = await listJobs({ owner: "o", repo: "r", fetcher });
    expect(result.jobs[0]?.role_title_zh).toBe("全栈工程师 (cc-fluent)");
  });

  it("sanitizes job free-text too", async () => {
    const evilJob = [
      "---",
      'schema_version: "0.1"',
      "company: Acme",
      `role_title_zh: "工程师${ZW}"`,
      "cc_required: true",
      "apply_url: https://acme.com/j/1",
      "contact_value: jobs@acme.com",
      `description_zh: "good role${BIDI}evil"`,
      "---",
      "",
    ].join("\n");
    const fetcher = makeFetcher({ "jobs": [{ name: "acme.md", content: evilJob }] });
    const result = await listJobs({ owner: "o", repo: "r", fetcher });
    expect(result.jobs[0]?.role_title_zh).toBe("工程师");
    expect(result.jobs[0]?.description_zh).toBe("good roleevil");
  });
});
