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

const candidateMd = `---
schema_version: "0.1"
github_username: alicelu
cc_experience_months: 12
evidence_url: https://github.com/alicelu/proj/pull/42
contact_mode: public
contact_value: alice@example.com
---
`;

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
    candidates: [{ name: "alicelu.md", content: candidateMd }],
    jobs: [{ name: "acme.md", content: jobMd }],
  });
  return { owner: "o", repo: "r", fetcher, ...overrides };
}

describe("createMcpTools", () => {
  it("declares list_jobs and list_candidates tools", () => {
    const { tools } = createMcpTools(makeArgs());
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_jobs");
    expect(names).toContain("list_candidates");
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

  describe("list_candidates handler", () => {
    it("returns candidates as MCP TextContent JSON", async () => {
      const { call } = createMcpTools(makeArgs());
      const result = await call("list_candidates", {});

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const text = result.content[0];
      if (text?.type !== "text") throw new Error("expected text content");
      const parsed = JSON.parse(text.text);
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0].github_username).toBe("alicelu");
    });

    it("reports errors in the response, does not throw", async () => {
      const fetcher: Fetcher = async () => {
        throw new Error("ECONNREFUSED");
      };
      const { call } = createMcpTools(makeArgs({ fetcher }));
      const result = await call("list_candidates", {});

      // Network error surfaces as MCP isError with structured body
      expect(result.isError).toBe(true);
      const text = result.content[0];
      if (text?.type !== "text") throw new Error("expected text content");
      expect(text.text).toContain("ECONNREFUSED");
    });
  });

  describe("list_jobs handler", () => {
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
