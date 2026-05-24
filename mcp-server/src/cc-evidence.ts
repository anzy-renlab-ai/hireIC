// Gather a candidate's PUBLIC Claude-Code footprint from GitHub, to feed scoreCc.
// Uses the GitHub commit-search API for commits authored by the candidate that
// carry a `Co-authored-by: Claude` trailer. Fail-open: any error → empty evidence
// (→ score 0), never throws. Injected fetch keeps it unit-testable + offline.
// SECURITY: only ever hits the fixed api.github.com host (no user-supplied URLs).

import type { CcEvidence } from "./score.js";

export interface EvidenceDeps {
  fetchImpl?: typeof fetch;
  token?: string;
}

interface SearchItem {
  html_url?: string;
  repository?: { full_name?: string };
  commit?: { author?: { date?: string } };
}

const REQUEST_TIMEOUT_MS = 8000;

export async function gatherCcEvidence(
  github: string,
  deps: EvidenceDeps = {},
): Promise<CcEvidence> {
  const empty: CcEvidence = { ccCommits: 0, ccRepos: 0, spanDays: 0, sampleUrls: [] };
  const fetchImpl = deps.fetchImpl ?? fetch;

  // Commit search: commits authored by the candidate co-authored by Claude.
  const q = `author:${github} Co-authored-by:Claude`;
  const url = `https://api.github.com/search/commits?q=${encodeURIComponent(q)}&per_page=100`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;

  try {
    const resp = await fetchImpl(url, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) return empty;
    const json = (await resp.json()) as { total_count?: number; items?: SearchItem[] };
    const items = Array.isArray(json.items) ? json.items : [];
    if (items.length === 0) return empty;

    const repos = new Set<string>();
    const dates: number[] = [];
    const sampleUrls: string[] = [];
    for (const it of items) {
      const repo = it.repository?.full_name;
      if (repo) repos.add(repo);
      const d = it.commit?.author?.date;
      if (d) {
        const t = Date.parse(d);
        if (!Number.isNaN(t)) dates.push(t);
      }
      if (it.html_url && sampleUrls.length < 3) sampleUrls.push(it.html_url);
    }
    const spanDays =
      dates.length >= 2
        ? Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000)
        : 0;

    return {
      ccCommits: typeof json.total_count === "number" ? json.total_count : items.length,
      ccRepos: repos.size,
      spanDays,
      sampleUrls,
    };
  } catch {
    return empty; // fail-open: rate-limit / timeout / network → no signal, never block
  }
}
