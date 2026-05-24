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

  it("HIDDEN anti-spoof: drops own-repo trailer commits backdated before cc existed, or future-dated", async () => {
    const fakes = { items: [
      // real trailer, own repo, but dated 2024 (before Claude Code) → fabricated, dropped
      { html_url: "u1", author: { login: "alicelu" }, repository: { full_name: "alicelu/old" }, commit: { message: "x" + TRAILER, author: { date: "2024-06-01T00:00:00Z" } } },
      // future-dated → dropped
      { html_url: "u2", author: { login: "alicelu" }, repository: { full_name: "alicelu/fut" }, commit: { message: "y" + TRAILER, author: { date: "2030-01-01T00:00:00Z" } } },
      // one legit, in-era
      { html_url: "u3", author: { login: "alicelu" }, repository: { full_name: "alicelu/ok" }, commit: { message: "z" + TRAILER, author: { date: "2026-02-10T00:00:00Z" } } },
    ] };
    const ev = await gatherCcEvidence("alicelu", { fetchImpl: stubFetch({ body: fakes }), now: NOW });
    expect(ev.ccCommits).toBe(1); // only the in-era commit counts
  });

  it("only hits api.github.com, queries author + a co-author trailer, no redirect chasing", async () => {
    const cap: { url?: string; init?: RequestInit | undefined } = {};
    await gatherCcEvidence("alice-lu", { fetchImpl: stubFetch({ body, capture: cap }), now: NOW });
    expect(cap.url!.startsWith("https://api.github.com/search/commits")).toBe(true);
    const decoded = decodeURIComponent(cap.url!);
    expect(decoded).toContain("author:alice-lu");
    expect(decoded).toContain("Co-authored-by");
    expect(decoded).toContain("noreply");
    expect(cap.init?.redirect).toBe("error");
  });

  it("carries non-cc code-agent codenames (e.g. Codex) without counting them as cc; ignores human privacy emails", async () => {
    const mixed = { items: [
      // legit cc commit → scored
      { html_url: "c1", author: { login: "bob" }, repository: { full_name: "bob/app" }, commit: { message: "feat" + TRAILER, author: { date: "2026-03-01T00:00:00Z" } } },
      // codex-co-authored commit in own repo → codename carried, NOT scored as cc
      { html_url: "c2", author: { login: "bob" }, repository: { full_name: "bob/app" }, commit: { message: "fix\n\nCo-authored-by: Codex <noreply@openai.com>", author: { date: "2026-03-02T00:00:00Z" } } },
      // GitHub human privacy email → must be ignored (not an agent)
      { html_url: "c3", author: { login: "bob" }, repository: { full_name: "bob/app" }, commit: { message: "wip\n\nCo-authored-by: pat <1234+pat@users.noreply.github.com>", author: { date: "2026-03-03T00:00:00Z" } } },
    ] };
    const ev = await gatherCcEvidence("bob", { fetchImpl: stubFetch({ body: mixed }), now: NOW });
    expect(ev.ccCommits).toBe(1); // only the anthropic-signed commit is scored
    expect(ev.coAuthors).toEqual({ Codex: 1 }); // codex codename carried; human co-author dropped
  });

  it("pure non-cc agent user (zero cc) still surfaces the codename for the employer", async () => {
    const codexOnly = { items: [
      { html_url: "x1", author: { login: "cara" }, repository: { full_name: "cara/svc" }, commit: { message: "build\n\nCo-authored-by: Codex <noreply@openai.com>", author: { date: "2026-03-10T00:00:00Z" } } },
    ] };
    const ev = await gatherCcEvidence("cara", { fetchImpl: stubFetch({ body: codexOnly }), now: NOW });
    expect(ev.ccCommits).toBe(0); // no cc footprint → score 0
    expect(ev.coAuthors).toEqual({ Codex: 1 }); // but the employer still learns the tool
  });
});
