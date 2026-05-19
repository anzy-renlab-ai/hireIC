import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeGithubFetcher, type GithubFetcherOptions } from "./github-fetcher.js";

const FAKE_NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FAKE_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce(
      new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

function makeOpts(overrides: Partial<GithubFetcherOptions> = {}): GithubFetcherOptions {
  return {
    owner: "o",
    repo: "r",
    ref: "main",
    cacheTtlMs: 5 * 60 * 1000,
    ...overrides,
  };
}

describe("github-fetcher", () => {
  it("calls GitHub Contents API for the requested path", async () => {
    const fetchMock = mockFetch([{ status: 200, body: [] }]);
    const fetcher = makeGithubFetcher(makeOpts());
    await fetcher("candidates");

    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain("api.github.com/repos/o/r/contents/candidates");
    expect(url).toContain("ref=main");
  });

  it("returns 200 with file list when GitHub returns an array", async () => {
    mockFetch([
      {
        status: 200,
        body: [
          { name: "alice.md", type: "file", content: btoa("hello"), encoding: "base64" },
          { name: ".gitkeep", type: "file", content: "", encoding: "base64" },
        ],
      },
    ]);
    const fetcher = makeGithubFetcher(makeOpts());
    const result = await fetcher("candidates");

    expect(result.status).toBe(200);
    if (result.status !== 200) throw new Error("unreachable");
    expect(result.body).toHaveLength(2);
    expect(result.body[0]).toEqual({ name: "alice.md", content: "hello" });
  });

  it("returns 404 when GitHub returns 404", async () => {
    mockFetch([{ status: 404, body: { message: "Not Found" } }]);
    const fetcher = makeGithubFetcher(makeOpts());
    const result = await fetcher("candidates");
    expect(result.status).toBe(404);
    expect(result.body).toBeNull();
  });

  it("returns 429 when GitHub rate-limits", async () => {
    mockFetch([{ status: 429, body: { message: "rate limit" } }]);
    const fetcher = makeGithubFetcher(makeOpts());
    const result = await fetcher("candidates");
    expect(result.status).toBe(429);
  });

  it("translates 403 with X-RateLimit-Remaining: 0 into 429", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response("{}", {
        status: 403,
        headers: { "X-RateLimit-Remaining": "0" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fetcher = makeGithubFetcher(makeOpts());
    const result = await fetcher("candidates");
    expect(result.status).toBe(429);
  });

  it("throws network errors instead of swallowing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );
    const fetcher = makeGithubFetcher(makeOpts());
    await expect(fetcher("candidates")).rejects.toThrow("ECONNREFUSED");
  });

  describe("in-memory cache", () => {
    it("caches a successful fetch for cacheTtlMs", async () => {
      const fetchMock = mockFetch([{ status: 200, body: [] }]);
      const fetcher = makeGithubFetcher(makeOpts({ cacheTtlMs: 5 * 60 * 1000 }));

      await fetcher("candidates");
      await fetcher("candidates");
      await fetcher("candidates");

      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("re-fetches after cacheTtlMs elapses", async () => {
      const fetchMock = mockFetch([
        { status: 200, body: [] },
        { status: 200, body: [{ name: "fresh.md", type: "file", content: btoa("new"), encoding: "base64" }] },
      ]);
      const fetcher = makeGithubFetcher(makeOpts({ cacheTtlMs: 1000 }));

      await fetcher("candidates");
      vi.setSystemTime(FAKE_NOW + 1001);
      const second = await fetcher("candidates");

      expect(fetchMock).toHaveBeenCalledTimes(2);
      if (second.status !== 200) throw new Error("unreachable");
      expect(second.body[0]?.name).toBe("fresh.md");
    });

    it("does NOT cache 404 responses (cheap to retry, may have been created)", async () => {
      const fetchMock = mockFetch([
        { status: 404, body: {} },
        { status: 200, body: [] },
      ]);
      const fetcher = makeGithubFetcher(makeOpts());

      const first = await fetcher("candidates");
      const second = await fetcher("candidates");

      expect(first.status).toBe(404);
      expect(second.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does NOT cache 429 responses (retry after backoff)", async () => {
      const fetchMock = mockFetch([
        { status: 429, body: {} },
        { status: 200, body: [] },
      ]);
      const fetcher = makeGithubFetcher(makeOpts());

      await fetcher("candidates");
      await fetcher("candidates");

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("caches separately per path", async () => {
      const fetchMock = mockFetch([
        { status: 200, body: [{ name: "a.md", type: "file", content: btoa("a"), encoding: "base64" }] },
        { status: 200, body: [{ name: "b.md", type: "file", content: btoa("b"), encoding: "base64" }] },
      ]);
      const fetcher = makeGithubFetcher(makeOpts());

      await fetcher("candidates");
      await fetcher("jobs");
      await fetcher("candidates");
      await fetcher("jobs");

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("auth header", () => {
    it("does not send Authorization when no token configured", async () => {
      const fetchMock = mockFetch([{ status: 200, body: [] }]);
      const fetcher = makeGithubFetcher(makeOpts());
      await fetcher("candidates");

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const headers = new Headers(init?.headers);
      expect(headers.has("Authorization")).toBe(false);
    });

    it("sends Authorization Bearer when token configured", async () => {
      const fetchMock = mockFetch([{ status: 200, body: [] }]);
      const fetcher = makeGithubFetcher(makeOpts({ token: "ghp_xxx" }));
      await fetcher("candidates");

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer ghp_xxx");
    });
  });

  describe("non-file entries are ignored", () => {
    it("skips type=dir entries", async () => {
      mockFetch([
        {
          status: 200,
          body: [
            { name: "alice.md", type: "file", content: btoa("ok"), encoding: "base64" },
            { name: "subdir", type: "dir" },
          ],
        },
      ]);
      const fetcher = makeGithubFetcher(makeOpts());
      const result = await fetcher("candidates");
      if (result.status !== 200) throw new Error("unreachable");
      expect(result.body).toHaveLength(1);
      expect(result.body[0]?.name).toBe("alice.md");
    });

    it("handles files with content=null (large files) by skipping them", async () => {
      mockFetch([
        {
          status: 200,
          body: [
            { name: "small.md", type: "file", content: btoa("ok"), encoding: "base64" },
            { name: "huge.md", type: "file", content: null, encoding: "base64" },
          ],
        },
      ]);
      const fetcher = makeGithubFetcher(makeOpts());
      const result = await fetcher("candidates");
      if (result.status !== 200) throw new Error("unreachable");
      expect(result.body).toHaveLength(1);
      expect(result.body[0]?.name).toBe("small.md");
    });
  });
});
