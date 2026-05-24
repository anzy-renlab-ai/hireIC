// Gather a candidate's PUBLIC Claude-Code footprint from GitHub, to feed scoreCc.
// Uses the GitHub commit-search API for commits authored by the candidate that
// carry a `Co-authored-by: Claude` trailer. Fail-open: any error → empty evidence
// (→ score 0), never throws. Injected fetch keeps it unit-testable + offline.
// SECURITY: only ever hits the fixed api.github.com host (no user-supplied URLs).

import type { CcEvidence } from "./score.js";

export interface EvidenceDeps {
  fetchImpl?: typeof fetch;
  token?: string;
  now?: number; // injectable clock for deterministic recency in tests
}

interface SearchItem {
  html_url?: string;
  author?: { login?: string }; // the GitHub user who authored the commit
  repository?: { full_name?: string };
  commit?: { author?: { date?: string }; message?: string };
}

const REQUEST_TIMEOUT_MS = 8000;

// The exact Claude Code co-author fingerprint. Searching/filtering on the
// anthropic noreply address (not just "Claude") cuts false matches — e.g. a
// human collaborator literally named Claude, or fuzzy commit-search hits.
const CLAUDE_TRAILER_RE = /co-authored-by:\s*claude[^\n>]*<noreply@anthropic\.com>/i;

export async function gatherCcEvidence(
  github: string,
  deps: EvidenceDeps = {},
): Promise<CcEvidence> {
  const empty: CcEvidence = {
    ccCommits: 0, ccRepos: 0, activeMonths: 0, daysSinceLast: Infinity, spanDays: 0, sampleUrls: [],
  };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now();

  // Search commits authored by the candidate that mention the anthropic noreply
  // address (the Claude Code co-author fingerprint). The server-side query
  // narrows; we then filter each item's message by the exact trailer regex to
  // drop fuzzy hits (e.g. a human collaborator literally named "Claude").
  const q = `author:${github} Co-authored-by Claude noreply@anthropic.com`;
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
    const json = (await resp.json()) as { items?: SearchItem[] };
    const all = Array.isArray(json.items) ? json.items : [];
    // Precision + anti-spoof. Git commit authorship is forgeable (anyone can set
    // author name/email/login locally), so GitHub commit search returns commits
    // "by" the candidate that actually live in strangers' repos. The hard-to-fake
    // signal is a commit in a repo the candidate OWNS (you can't push there without
    // access). So keep only: (1) repo owner === candidate, AND (2) the exact Claude
    // Code trailer in the message. (Misses cc work shipped as PRs to others' repos —
    // a deliberate trade for trust; that's a future, PR-verified addition.)
    const login = github.toLowerCase();
    const items = all.filter((it) => {
      const owner = (it.repository?.full_name ?? "").split("/")[0]?.toLowerCase();
      return owner === login && CLAUDE_TRAILER_RE.test(it.commit?.message ?? "");
    });
    if (items.length === 0) return empty;

    const repos = new Set<string>();
    const months = new Set<string>(); // YYYY-MM buckets → cadence
    const dates: number[] = [];
    const sampleUrls: string[] = [];
    for (const it of items) {
      const repo = it.repository?.full_name;
      if (repo) repos.add(repo);
      const d = it.commit?.author?.date;
      if (d) {
        const t = Date.parse(d);
        if (!Number.isNaN(t)) {
          dates.push(t);
          months.add(d.slice(0, 7)); // "YYYY-MM"
        }
      }
      if (it.html_url && sampleUrls.length < 3) sampleUrls.push(it.html_url);
    }
    const spanDays =
      dates.length >= 2 ? Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000) : 0;
    const daysSinceLast =
      dates.length > 0 ? Math.max(0, Math.round((now - Math.max(...dates)) / 86_400_000)) : Infinity;

    return {
      ccCommits: items.length,
      ccRepos: repos.size,
      activeMonths: months.size,
      daysSinceLast,
      spanDays,
      sampleUrls,
    };
  } catch {
    return empty; // fail-open: rate-limit / timeout / network → no signal, never block
  }
}
