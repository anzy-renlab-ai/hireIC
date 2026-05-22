import { describe, it, expect } from "vitest";
import { gatherNetworkWarnings } from "../../scripts/signals.js";
import type { CandidatePayload } from "../../scripts/issue-parser.js";

const base: CandidatePayload = {
  schema_version: "0.1",
  github_username: "alicelu",
  cc_experience_months: 12,
  evidence_url: "https://github.com/alicelu/proj/pull/42",
  contact_mode: "public",
  contact_value: "alice@example.com",
};

function stubFetch(routes: Array<{ match: string; status?: number; throws?: boolean }>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    if (route.throws) throw new Error("network down");
    return { status: route.status ?? 200, ok: (route.status ?? 200) < 400 } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("gatherNetworkWarnings — advisory, fail-open, never blocks", () => {
  it("no warnings when github user exists (200)", async () => {
    const { fetchImpl } = stubFetch([{ match: "api.github.com/users/alicelu", status: 200 }]);
    expect(await gatherNetworkWarnings(base, { fetchImpl })).toEqual([]);
  });

  it("warns when github username does not exist (404)", async () => {
    const { fetchImpl } = stubFetch([{ match: "api.github.com/users/", status: 404 }]);
    const w = await gatherNetworkWarnings(base, { fetchImpl });
    expect(w.some((x) => x.field === "github_username" && x.kind === "not_found")).toBe(true);
  });

  it("fails open: network throw produces NO warning (never punish on infra hiccup)", async () => {
    const { fetchImpl } = stubFetch([{ match: "api.github.com/users/", throws: true }]);
    expect(await gatherNetworkWarnings(base, { fetchImpl })).toEqual([]);
  });

  it("5xx on github API is treated as transient → no warning (fail-open)", async () => {
    const { fetchImpl } = stubFetch([{ match: "api.github.com/users/", status: 503 }]);
    expect(await gatherNetworkWarnings(base, { fetchImpl })).toEqual([]);
  });

  it("SSRF guard: NEVER fetches the user-supplied evidence_url", async () => {
    const evil = {
      ...base,
      evidence_url: "http://169.254.169.254/latest/meta-data/",
    };
    const { fetchImpl, calls } = stubFetch([{ match: "api.github.com/users/", status: 200 }]);
    await gatherNetworkWarnings(evil, { fetchImpl });
    // Only the fixed trusted host is ever contacted.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.startsWith("https://api.github.com/")).toBe(true);
    expect(calls.some((c) => c.url.includes("169.254.169.254"))).toBe(false);
  });

  it("hardens the github request: timeout signal + no redirect chasing", async () => {
    const { fetchImpl, calls } = stubFetch([{ match: "api.github.com/users/", status: 200 }]);
    await gatherNetworkWarnings(base, { fetchImpl });
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]!.init?.redirect).toBe("error");
  });

  it("percent-encodes the username into the path (no injection)", async () => {
    const { fetchImpl, calls } = stubFetch([{ match: "api.github.com/users/", status: 200 }]);
    await gatherNetworkWarnings({ ...base, github_username: "a-b" }, { fetchImpl });
    expect(calls[0]!.url).toBe("https://api.github.com/users/a-b");
  });
});
