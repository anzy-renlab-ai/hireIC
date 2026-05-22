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

// Build a fetch stub keyed by URL substring → Response-ish.
function stubFetch(routes: Array<{ match: string; status?: number; throws?: boolean }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    if (route.throws) throw new Error("network down");
    return { status: route.status ?? 200, ok: (route.status ?? 200) < 400 } as Response;
  }) as typeof fetch;
}

describe("gatherNetworkWarnings — advisory, fail-open, never blocks", () => {
  it("no warnings when github user exists and evidence is reachable", async () => {
    const fetchImpl = stubFetch([
      { match: "api.github.com/users/alicelu", status: 200 },
      { match: "github.com/alicelu/proj/pull/42", status: 200 },
    ]);
    expect(await gatherNetworkWarnings(base, { fetchImpl })).toEqual([]);
  });

  it("warns when github username does not exist (404)", async () => {
    const fetchImpl = stubFetch([
      { match: "api.github.com/users/", status: 404 },
      { match: "github.com/alicelu", status: 200 },
    ]);
    const w = await gatherNetworkWarnings(base, { fetchImpl });
    expect(w.some((x) => x.field === "github_username" && x.kind === "not_found")).toBe(true);
  });

  it("warns when evidence URL is unreachable (404)", async () => {
    const fetchImpl = stubFetch([
      { match: "api.github.com/users/", status: 200 },
      { match: "github.com/alicelu/proj/pull/42", status: 404 },
    ]);
    const w = await gatherNetworkWarnings(base, { fetchImpl });
    expect(w.some((x) => x.field === "evidence_url" && x.kind === "unreachable")).toBe(true);
  });

  it("fails open: network throw produces NO warning (never punish on infra hiccup)", async () => {
    const fetchImpl = stubFetch([
      { match: "api.github.com/users/", throws: true },
      { match: "github.com/alicelu/proj/pull/42", throws: true },
    ]);
    expect(await gatherNetworkWarnings(base, { fetchImpl })).toEqual([]);
  });

  it("does not check reachability for non-github evidence over HEAD failure leniently", async () => {
    // 5xx on evidence is treated as transient → no warning (fail-open)
    const fetchImpl = stubFetch([
      { match: "api.github.com/users/", status: 200 },
      { match: "github.com/alicelu/proj/pull/42", status: 503 },
    ]);
    expect(await gatherNetworkWarnings(base, { fetchImpl })).toEqual([]);
  });
});
