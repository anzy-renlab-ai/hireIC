import { describe, it, expect } from "vitest";
import { gatherCcEvidence } from "./cc-evidence.js";

const TRAILER = "\n\nCo-authored-by: Claude <noreply@anthropic.com>";
const NOW = Date.parse("2026-04-01T00:00:00Z");

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
    return { status, ok: status < 400, json: async () => opts.body ?? {} } as Response;
  }) as typeof fetch;
}

describe("gatherCcEvidence — verified public cc footprint", () => {
  const body = {
    total_count: 99,
    items: [
      { html_url: "https://github.com/a/x/commit/1", author: { login: "alicelu" }, repository: { full_name: "alicelu/x" }, commit: { message: "feat: thing" + TRAILER, author: { date: "2026-01-10T00:00:00Z" } } },
      { html_url: "https://github.com/a/y/commit/2", author: { login: "alicelu" }, repository: { full_name: "alicelu/y" }, commit: { message: "fix: bug" + TRAILER, author: { date: "2026-03-05T00:00:00Z" } } },
      { html_url: "https://github.com/a/x/commit/3", author: { login: "alicelu" }, repository: { full_name: "alicelu/x" }, commit: { message: "chore" + TRAILER, author: { date: "2026-02-02T00:00:00Z" } } },
      // NOISE: a human collaborator literally named Claude, NOT Claude Code → must be filtered out
      { html_url: "https://github.com/a/z/commit/4", author: { login: "alicelu" }, repository: { full_name: "alicelu/z" }, commit: { message: "doc\n\nCo-authored-by: Claude Monet <claude@example.com>", author: { date: "2026-03-20T00:00:00Z" } } },
      // FOREIGN REPO: real trailer but in someone else's repo (spoofable author) → must be excluded
      { html_url: "https://github.com/b/q/commit/9", author: { login: "someoneelse" }, repository: { full_name: "b/q" }, commit: { message: "x" + TRAILER, author: { date: "2026-03-25T00:00:00Z" } } },
    ],
  };

  it("filters by exact trailer; counts real commits, distinct repos, active months, recency", async () => {
    const ev = await gatherCcEvidence("alicelu", { fetchImpl: stubFetch({ body }), now: NOW });
    expect(ev.ccCommits).toBe(3); // noise item excluded (no anthropic fingerprint)
    expect(ev.ccRepos).toBe(2); // a/x, a/y (a/z was noise)
    expect(ev.activeMonths).toBe(3); // 2026-01, -02, -03
    expect(ev.spanDays).toBe(54); // Jan 10 → Mar 5
    expect(ev.daysSinceLast).toBe(27); // Mar 5 → Apr 1
    expect(ev.sampleUrls.length).toBeLessThanOrEqual(3);
  });

  it("empty results → empty evidence", async () => {
    const ev = await gatherCcEvidence("nobody", { fetchImpl: stubFetch({ body: { items: [] } }), now: NOW });
    expect(ev.ccCommits).toBe(0);
    expect(ev.activeMonths).toBe(0);
  });

  it("all noise (no real fingerprint) → empty evidence", async () => {
    const noise = { items: [{ html_url: "u", repository: { full_name: "alicelu/z" }, commit: { message: "Co-authored-by: Claude Monet <claude@example.com>", author: { date: "2026-03-20T00:00:00Z" } } }] };
    const ev = await gatherCcEvidence("x", { fetchImpl: stubFetch({ body: noise }), now: NOW });
    expect(ev.ccCommits).toBe(0);
  });

  it("fail-open: non-ok status → empty", async () => {
    const ev = await gatherCcEvidence("x", { fetchImpl: stubFetch({ status: 403 }) });
    expect(ev.ccCommits).toBe(0);
  });

  it("fail-open: fetch throws → empty, never rejects", async () => {
    const ev = await gatherCcEvidence("x", { fetchImpl: stubFetch({ throws: true }) });
    expect(ev.ccCommits).toBe(0);
  });

  it("only hits api.github.com, queries author + the anthropic fingerprint, no redirect chasing", async () => {
    const cap: { url?: string; init?: RequestInit | undefined } = {};
    await gatherCcEvidence("alice-lu", { fetchImpl: stubFetch({ body, capture: cap }), now: NOW });
    expect(cap.url!.startsWith("https://api.github.com/search/commits")).toBe(true);
    const decoded = decodeURIComponent(cap.url!);
    expect(decoded).toContain("author:alice-lu");
    expect(decoded).toContain("noreply@anthropic.com");
    expect(cap.init?.redirect).toBe("error");
  });
});
