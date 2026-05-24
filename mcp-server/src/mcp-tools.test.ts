import { describe, it, expect, vi } from "vitest";
import { createMcpTools, type CreateMcpToolsArgs } from "./mcp-tools.js";
import type { Fetcher } from "./handlers.js";

function fetcherFrom(map: Record<string, Array<{ name: string; content: string }>>): Fetcher {
  return async (path: string) => {
    const files = map[path];
    if (!files) return { status: 404, body: null };
    return { status: 200, body: files };
  };
}

const jobMd = `---
schema_version: "0.1"
company: Acme
role_title_zh: 全栈
cc_required: true
apply_url: https://acme.com/jobs
contact_value: jobs@acme.com
---
`;

function makeArgs(overrides: Partial<CreateMcpToolsArgs> = {}): CreateMcpToolsArgs {
  const fetcher = fetcherFrom({
    jobs: [{ name: "acme.md", content: jobMd }],
  });
  return { owner: "o", repo: "r", fetcher, ...overrides };
}

describe("createMcpTools", () => {
  it("declares the list_jobs tool", () => {
    const { tools } = createMcpTools(makeArgs());
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_jobs");
  });

  it("every tool has a non-empty description (agent discoverability)", () => {
    const { tools } = createMcpTools(makeArgs());
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it("every tool has a JSON Schema inputSchema", () => {
    const { tools } = createMcpTools(makeArgs());
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect(t.inputSchema.type).toBe("object");
    }
  });

  describe("list_jobs handler", () => {
    it("reports errors in the response, does not throw", async () => {
      const fetcher: Fetcher = async () => {
        throw new Error("ECONNREFUSED");
      };
      const { call } = createMcpTools(makeArgs({ fetcher }));
      const result = await call("list_jobs", {});

      // Network error surfaces as MCP isError with structured body
      expect(result.isError).toBe(true);
      const text = result.content[0];
      if (text?.type !== "text") throw new Error("expected text content");
      expect(text.text).toContain("ECONNREFUSED");
    });

    it("returns jobs as MCP TextContent JSON, excluding closed by default", async () => {
      const { call } = createMcpTools(makeArgs());
      const result = await call("list_jobs", {});

      expect(result.isError).toBeFalsy();
      const text = result.content[0];
      if (text?.type !== "text") throw new Error("expected text content");
      const parsed = JSON.parse(text.text);
      expect(parsed.jobs).toHaveLength(1);
      expect(parsed.jobs[0].company).toBe("Acme");
    });

    it("accepts include_closed: true", async () => {
      const closedJob = jobMd.replace(
        "contact_value: jobs@acme.com",
        "contact_value: jobs@acme.com\nstatus: closed",
      );
      const fetcher = fetcherFrom({
        candidates: [],
        jobs: [
          { name: "open.md", content: jobMd },
          { name: "closed.md", content: closedJob },
        ],
      });
      const { call } = createMcpTools(makeArgs({ fetcher }));

      const without = await call("list_jobs", {});
      const withoutText = without.content[0];
      if (withoutText?.type !== "text") throw new Error("expected text");
      expect(JSON.parse(withoutText.text).jobs).toHaveLength(1);

      const withClosed = await call("list_jobs", { include_closed: true });
      const withText = withClosed.content[0];
      if (withText?.type !== "text") throw new Error("expected text");
      expect(JSON.parse(withText.text).jobs).toHaveLength(2);
    });

    it("rejects include_closed of wrong type with isError", async () => {
      const { call } = createMcpTools(makeArgs());
      const result = await call("list_jobs", { include_closed: "yes" });
      expect(result.isError).toBe(true);
    });
  });

  describe("unknown tool", () => {
    it("returns isError for unknown tool name", async () => {
      const { call } = createMcpTools(makeArgs());
      const result = await call("delete_everything", {});
      expect(result.isError).toBe(true);
      const text = result.content[0];
      if (text?.type !== "text") throw new Error("expected text");
      expect(text.text).toContain("unknown tool");
    });
  });
});

describe("apply tool — cc-signal scoring + delivery to the employer", () => {
  const heavyEvidence = { ccCommits: 80, ccRepos: 6, activeMonths: 7, daysSinceLast: 10, spanDays: 210, sampleUrls: ["https://github.com/a/b/commit/1"] };
  const evidenceFn = async () => heavyEvidence;

  it("declares apply requiring github", () => {
    const { tools } = createMcpTools(makeArgs({ evidenceFn }));
    const apply = tools.find((t) => t.name === "apply");
    expect(apply).toBeDefined();
    expect(apply!.inputSchema.required).toContain("github");
  });

  it("heavy user + extension profile → strong; emails the employer the candidate's contact", async () => {
    let sent: { to: string; text: string } | null = null;
    const { call } = createMcpTools(makeArgs({ evidenceFn, sendImpl: async (m) => { sent = m; return { delivered: true }; } }));
    const res = await call("apply", { github: "alicelu", job_id: "acme", contact: "alice@example.com", profile: { skills: 3, mcpServers: 1, hasClaudeMd: true } });
    const p = JSON.parse(res.content[0]!.text);
    expect(p.band).toBe("strong");
    expect(p.cc_score).toBeGreaterThanOrEqual(60);
    expect(p.delivery.delivered).toBe(true);
    expect(sent!.to).toBe("jobs@acme.com");           // the employer
    expect(sent!.text).toContain("alice@example.com"); // so the recruiter can touch the candidate
  });

  it("privacy: junk fields in profile are dropped, never leak into output or email", async () => {
    let sent: { text: string } | null = null;
    const { call } = createMcpTools(makeArgs({ evidenceFn, sendImpl: async (m) => { sent = m; return { delivered: true }; } }));
    const res = await call("apply", { github: "x", job_id: "acme", contact: "x@y.com", profile: { skills: 2, secretFile: "/Users/me/.env", repoName: "private-thing" } });
    const p = JSON.parse(res.content[0]!.text);
    expect(JSON.stringify(p)).not.toContain("secretFile");
    expect(JSON.stringify(p)).not.toContain("private-thing");
    expect(sent!.text).not.toContain("private-thing");
  });

  it("no contact/job_id → returns the score but does not deliver", async () => {
    const { call } = createMcpTools(makeArgs({ evidenceFn }));
    const res = await call("apply", { github: "alicelu" });
    const p = JSON.parse(res.content[0]!.text);
    expect(p.cc_score).toBeGreaterThan(0);
    expect(p.delivery.delivered).toBe(false);
  });

  it("rejects invalid or missing github", async () => {
    const { call } = createMcpTools(makeArgs({ evidenceFn }));
    expect((await call("apply", { github: "not a name!" })).isError).toBe(true);
    expect((await call("apply", {})).isError).toBe(true);
  });
});
