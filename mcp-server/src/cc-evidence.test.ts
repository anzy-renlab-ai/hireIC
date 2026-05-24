import { describe, it, expect } from "vitest";
import { gatherCcEvidence } from "./cc-evidence.js";

function stubFetch(opts: {
  status?: number;
  throws?: boolean;
  body?: unknown;
  capture?: { url?: string; init?: RequestInit | undefined };
}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (opts.capture) {
      opts.capture.url = typeof input === "string" ? input : input.toString();
      opts.capture.init = init;
    }
    if (opts.throws) throw new Error("network down");
    const status = opts.status ?? 200;
    return {
      status,
      ok: status < 400,
      json: async () => opts.body ?? {},
    } as Response;
  }) as typeof fetch;
}

describe("gatherCcEvidence — public cc footprint from GitHub commit search", () => {
  const searchBody = {
    total_count: 42,
    items: [
      { html_url: "https://github.com/a/x/commit/1", repository: { full_name: "a/x" }, commit: { author: { date: "2026-01-01T00:00:00Z" } } },
      { html_url: "https://github.com/a/y/commit/2", repository: { full_name: "a/y" }, commit: { author: { date: "2026-03-01T00:00:00Z" } } },
      { html_url: "https://github.com/a/x/commit/3", repository: { full_name: "a/x" }, commit: { author: { date: "2026-02-01T00:00:00Z" } } },
    ],
  };

  it("parses commits → ccCommits (total), distinct ccRepos, spanDays, capped sampleUrls", async () => {
    const ev = await gatherCcEvidence("alicelu", { fetchImpl: stubFetch({ body: searchBody }) });
    expect(ev.ccCommits).toBe(42);
    expect(ev.ccRepos).toBe(2); // a/x, a/y
    expect(ev.spanDays).toBe(59); // Jan 1 → Mar 1
    expect(ev.sampleUrls.length).toBeLessThanOrEqual(3);
    expect(ev.sampleUrls[0]).toContain("github.com/a/x/commit/1");
  });

  it("empty results → empty evidence (score 0)", async () => {
    const ev = await gatherCcEvidence("nobody", { fetchImpl: stubFetch({ body: { total_count: 0, items: [] } }) });
    expect(ev).toEqual({ ccCommits: 0, ccRepos: 0, spanDays: 0, sampleUrls: [] });
  });

  it("fail-open: non-ok status → empty evidence", async () => {
    const ev = await gatherCcEvidence("x", { fetchImpl: stubFetch({ status: 403 }) });
    expect(ev.ccCommits).toBe(0);
  });

  it("fail-open: fetch throws → empty evidence, never rejects", async () => {
    const ev = await gatherCcEvidence("x", { fetchImpl: stubFetch({ throws: true }) });
    expect(ev.ccCommits).toBe(0);
  });

  it("only hits api.github.com, queries author + Co-authored-by, no redirect chasing", async () => {
    const cap: { url?: string; init?: RequestInit | undefined } = {};
    await gatherCcEvidence("alice-lu", { fetchImpl: stubFetch({ body: searchBody, capture: cap }) });
    expect(cap.url!.startsWith("https://api.github.com/search/commits")).toBe(true);
    expect(decodeURIComponent(cap.url!)).toContain("author:alice-lu");
    expect(decodeURIComponent(cap.url!)).toContain("Co-authored-by:Claude");
    expect(cap.init?.redirect).toBe("error");
  });
});
