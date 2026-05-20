import { describe, it, expect } from "vitest";
import { listCandidates, type Fetcher } from "../../mcp-server/src/handlers.js";
import { createMcpTools } from "../../mcp-server/src/mcp-tools.js";

// Round-5 QA: 401 path + malformed file resilience + extreme inputs.

describe("R5 — 401 unauthorized surfaces as clear error", () => {
  const fetcher401: Fetcher = async () => ({ status: 401, body: null });

  it("listCandidates returns kind=unauthorized with helpful message", async () => {
    const r = await listCandidates({ owner: "o", repo: "r", fetcher: fetcher401 });
    expect(r.candidates).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.kind).toBe("unauthorized");
    expect(r.errors[0]?.message).toMatch(/token|PAT|scope/i);
  });

  it("MCP tool surfaces isError=true on 401 (not silent or 500)", async () => {
    const { call } = createMcpTools({ owner: "o", repo: "r", fetcher: fetcher401 });
    const result = await call("list_candidates", {});
    expect(result.isError).toBe(true);
    if (result.content[0]?.type !== "text") throw new Error("expected text");
    expect(result.content[0].text).toContain("unauthorized");
    expect(result.content[0].text).toMatch(/token|PAT/i);
  });
});

describe("R5 — malformed files don't crash listing", () => {
  it("good file passes, malformed files reported individually", async () => {
    const fetcher: Fetcher = async (path) => {
      if (path !== "candidates") return { status: 404, body: null };
      return {
        status: 200,
        body: [
          {
            name: "good.md",
            content:
              `---\nschema_version: "0.1"\ngithub_username: alice\ncc_experience_months: 12\nevidence_url: https://github.com/a/b/pull/1\ncontact_mode: public\ncontact_value: a@b.com\n---\n`,
          },
          { name: "missing-required.md", content: `---\ngithub_username: bob\n---\n` },
          { name: "no-frontmatter.md", content: `just text` },
        ],
      };
    };
    const r = await listCandidates({ owner: "o", repo: "r", fetcher });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]?.github_username).toBe("alice");
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
    expect(r.errors.some((e) => e.kind === "schema_invalid")).toBe(true);
    expect(r.errors.some((e) => e.kind === "parse")).toBe(true);
  });
});
