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
  pageSize?: number; // injectable page size for tests (default 100)
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

// Hidden anti-spoof — NOT advertised in the API/docs. git author-dates are
// forgeable, so a faker backdates "Claude-co-authored" commits to inflate tenure
// /cadence. But Claude Code didn't exist before early 2025: any such commit dated
// before this floor (or in the future) is fabricated → silently dropped. Honest
// users (real cc commits are 2025+) are unaffected; we never tell the candidate.
const CC_EPOCH = Date.parse("2025-02-01T00:00:00Z");
function plausibleCcDate(dateStr: string | undefined, now: number): boolean {
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return false;
  return t >= CC_EPOCH && t <= now + 86_400_000; // not pre-cc-era, not future-dated
}

export async function gatherCcEvidence(
  github: string,
  deps: EvidenceDeps = {},
): Promise<CcEvidence> {
  const empty: CcEvidence = {
    ccCommits: 0, ccRepos: 0, activeMonths: 0, daysSinceLast: Infinity, spanDays: 0, sampleUrls: [],
  };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now();

  // Search commits authored by the candidate mentioning the anthropic noreply
  // address (the Claude Code co-author fingerprint), newest-first. Anti-spoof +
  // precision: git authorship is forgeable, so keep only commits whose REPO is
  // OWNED by the candidate (can't push without access) AND whose message carries
  // the exact trailer. (Misses cc work shipped as PRs to others' repos — a
  // deliberate trade for trust; future PR-verified addition.)
  const login = github.toLowerCase();
  const q = `author:${github} Co-authored-by Claude noreply@anthropic.com`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;

  const perPage = deps.pageSize ?? 100;
  const MAX_PAGES = 2; // ≤100 commits → 1 request; only heavy users trigger a 2nd. Don't over-fetch.
  const kept: SearchItem[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/search/commits?q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}&sort=author-date&order=desc`;
    let rawLen = 0;
    try {
      const resp = await fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!resp.ok) break;
      const json = (await resp.json()) as { items?: SearchItem[] };
      const all = Array.isArray(json.items) ? json.items : [];
      rawLen = all.length;
      for (const it of all) {
        const owner = (it.repository?.full_name ?? "").split("/")[0]?.toLowerCase();
        if (
          owner === login &&
          CLAUDE_TRAILER_RE.test(it.commit?.message ?? "") &&
          plausibleCcDate(it.commit?.author?.date, now) // hidden: drop pre-cc-era / future-dated fakes
        ) {
          kept.push(it);
        }
      }
    } catch {
      break; // fail-open: keep whatever we already collected
    }
    if (rawLen < perPage) break; // last page reached
  }
  if (kept.length === 0) return empty;

  const repos = new Set<string>();
  const months = new Set<string>(); // YYYY-MM buckets → cadence
  const dates: number[] = [];
  const sampleUrls: string[] = [];
  for (const it of kept) {
    const repo = it.repository?.full_name;
    if (repo) repos.add(repo);
    const d = it.commit?.author?.date;
    if (d) {
      const t = Date.parse(d);
      if (!Number.isNaN(t)) {
        dates.push(t);
        months.add(d.slice(0, 7));
      }
    }
    if (it.html_url && sampleUrls.length < 3) sampleUrls.push(it.html_url);
  }
  const spanDays = dates.length >= 2 ? Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000) : 0;
  const daysSinceLast = dates.length > 0 ? Math.max(0, Math.round((now - Math.max(...dates)) / 86_400_000)) : Infinity;

  return { ccCommits: kept.length, ccRepos: repos.size, activeMonths: months.size, daysSinceLast, spanDays, sampleUrls };
}
