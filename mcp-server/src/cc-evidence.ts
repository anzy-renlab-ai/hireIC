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

// Any co-author trailer, captured as (label, address). Used to note non-primary
// collaborators on a candidate's commits. The anthropic address is the primary
// fingerprint scored elsewhere, so it's excluded from this side-channel.
const COAUTHOR_RE = /co-authored-by:\s*([^<\n]+?)\s*<([^>\n]+)>/gi;

// GitHub-native agents (Codex cloud, the Copilot coding agent) sign as a GitHub
// App: `<name>[bot] <…+<name>[bot]@users.noreply.github.com>`. The literal
// `noreply@` substring never appears in that address, so the plain `noreply@` test
// (meant only to drop human privacy emails) would silently drop these real agents.
const GH_BOT_ADDR_RE = /^\d+\+[\w.-]+\[bot\]@users\.noreply\.github\.com$/;
// Reserved bot accounts that sign WITHOUT a `[bot]` segment in the address, pinned
// by their immutable numeric GitHub id (a human privacy email is
// `<theirId>+<theirLogin>@…`, never this exact pair) → codename.
const BOT_ADDR_ALLOWLIST: Record<string, string> = {
  "175728472+copilot@users.noreply.github.com": "Copilot",
};
// Non-coding GitHub Apps that also match the generic [bot] shape — never a
// code-authoring agent, so they must not surface as an "agent" footprint.
const NONCODE_BOT_RE = /^(dependabot|github-actions|renovate|greenkeeper|codecov|snyk-bot|mergify|pre-commit-ci|allcontributors|imgbot|netlify|vercel|sonarcloud|deepsource|restyled-io|stale|semantic-release-bot|web-flow)\b/;

// Canonicalize a trailer label to ONE stable codename, so a single agent that
// signs under several formats (Codex CLI `Codex` + Codex cloud
// `chatgpt-codex-connector[bot]`) or mixed case collapses into one footprint
// instead of splitting. Unknown agents are sanitized + length-capped so a forged
// trailer can't smuggle control bytes / newlines into the employer email.
function canonicalAgentName(label: string): string {
  const l = label.toLowerCase();
  if (/\bcodex\b/.test(l) || l.includes("chatgpt-codex-connector")) return "Codex";
  if (/\bcopilot\b/.test(l)) return "Copilot";
  if (/\bkiro\b/.test(l) || l.startsWith("kiro-")) return "Kiro";
  if (/\bgemini\b/.test(l)) return "Gemini";
  if (/\bcursor\b/.test(l)) return "Cursor";
  if (/\bdevin\b/.test(l)) return "Devin";
  if (/\baider\b/.test(l)) return "Aider";
  const safe = label.replace(/[^\w .\/[\]-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return safe || "agent";
}

// Is this co-author an automated code agent (vs a human collaborator)? Keep if the
// address is a vendor `noreply@<domain>` (e.g. noreply@openai.com, noreply@kiro.dev),
// a GitHub-App bot, or a pinned reserved bot — but never the anthropic address
// (primary cc fingerprint, scored separately) and never a human privacy email.
function isAgentAddress(addr: string): boolean {
  if (addr.includes("anthropic.com")) return false;
  if (addr.includes("noreply@")) return true;
  if (GH_BOT_ADDR_RE.test(addr)) return true;
  if (addr in BOT_ADDR_ALLOWLIST) return true;
  return false;
}

// Distinct non-primary code-agent codenames on a commit (normalized + deduped).
function agentCodenames(message: string): string[] {
  const names: string[] = [];
  for (const m of message.matchAll(COAUTHOR_RE)) {
    const label = (m[1] ?? "").trim();
    const addr = (m[2] ?? "").trim().toLowerCase();
    if (!label || !isAgentAddress(addr)) continue;
    if (NONCODE_BOT_RE.test(label.toLowerCase())) continue;
    names.push(BOT_ADDR_ALLOWLIST[addr] ?? canonicalAgentName(label));
  }
  return [...new Set(names)];
}

// Only count commits within the plausible window (cc-era to now). Commits dated
// outside it are ignored as noise.
const CC_EPOCH = Date.parse("2025-02-01T00:00:00Z");
function plausibleCcDate(dateStr: string | undefined, now: number): boolean {
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return false;
  return t >= CC_EPOCH && t <= now + 86_400_000;
}

// Normalize for skewed samples: a large batch dominated by near-identical commit
// messages or collapsed into a single day carries less signal per commit than
// diverse work spread over time. Returns a 0.4–1 weight.
function sampleDensity(items: SearchItem[]): number {
  const n = items.length;
  if (n < 8) return 1;
  const firsts = items.map((i) => (i.commit?.message ?? "").split("\n", 1)[0]!.trim().toLowerCase());
  const uniqRatio = new Set(firsts).size / n;
  const days = new Set(items.map((i) => (i.commit?.author?.date ?? "").slice(0, 10))).size;
  let k = 1;
  if (uniqRatio < 0.4) k *= 0.6;
  if (days <= 1) k *= 0.6;
  return Math.max(0.4, k);
}

// Turn a set of owner-scoped, in-era commits into a footprint: volume, breadth
// (distinct repos), cadence (distinct YYYY-MM), recency, span, sample links, and
// the distribution-normalization weight. Reused for the primary cc fingerprint and
// for each non-cc agent's own footprint.
function buildEvidence(items: SearchItem[], now: number): CcEvidence {
  const repos = new Set<string>();
  const months = new Set<string>();
  const dates: number[] = [];
  const sampleUrls: string[] = [];
  for (const it of items) {
    const repo = it.repository?.full_name;
    if (repo) repos.add(repo);
    const d = it.commit?.author?.date;
    if (d) {
      const t = Date.parse(d);
      if (!Number.isNaN(t)) { dates.push(t); months.add(d.slice(0, 7)); }
    }
    if (it.html_url && sampleUrls.length < 3) sampleUrls.push(it.html_url);
  }
  const spanDays = dates.length >= 2 ? Math.round((Math.max(...dates) - Math.min(...dates)) / 86_400_000) : 0;
  const daysSinceLast = dates.length > 0 ? Math.max(0, Math.round((now - Math.max(...dates)) / 86_400_000)) : Infinity;
  return { ccCommits: items.length, ccRepos: repos.size, activeMonths: months.size, daysSinceLast, spanDays, sampleUrls, density: sampleDensity(items) };
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
  // address (the Claude Code co-author fingerprint), newest-first. Keep only
  // commits whose repo is owned by the candidate and whose message carries the
  // exact trailer. (PR contributions to others' repos are a future addition.)
  const login = github.toLowerCase();
  // Broadened to any co-author trailer (all agent trailers contain "noreply"); we
  // classify each result in code — anthropic-signed → scored, others → codename only.
  const q = `author:${github} Co-authored-by noreply`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;

  const perPage = deps.pageSize ?? 100;
  const MAX_PAGES = 2; // ≤100 commits → 1 request; only heavy users trigger a 2nd. Don't over-fetch.
  const kept: SearchItem[] = []; // anthropic-signed → scored as the cc footprint
  const agentItems: Record<string, SearchItem[]> = {}; // codename → that agent's commits
  let incomplete = false; // a fetch failed/threw → the footprint below is a lower bound, not a confirmed 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/search/commits?q=${encodeURIComponent(q)}&per_page=${perPage}&page=${page}&sort=author-date&order=desc`;
    let rawLen = 0;
    try {
      const resp = await fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!resp.ok) { incomplete = true; break; } // 403/429/5xx — distinguish from a real empty result
      const json = (await resp.json()) as { items?: SearchItem[] };
      const all = Array.isArray(json.items) ? json.items : [];
      rawLen = all.length;
      for (const it of all) {
        const owner = (it.repository?.full_name ?? "").split("/")[0]?.toLowerCase();
        if (owner !== login || !plausibleCcDate(it.commit?.author?.date, now)) continue;
        const message = it.commit?.message ?? "";
        if (CLAUDE_TRAILER_RE.test(message)) kept.push(it);
        for (const name of agentCodenames(message)) (agentItems[name] ??= []).push(it);
      }
    } catch {
      incomplete = true; // network/timeout — fail-open but mark the result as partial
      break;
    }
    if (rawLen < perPage) break; // last page reached
  }

  // Per-agent footprints (non-cc), scored separately + clearly labelled downstream.
  const agents: Record<string, CcEvidence> = {};
  for (const [name, items] of Object.entries(agentItems)) agents[name] = buildEvidence(items, now);
  const agentsOut = Object.keys(agents).length ? agents : undefined;
  const flag = incomplete ? { incomplete: true } : {};

  if (kept.length === 0) return { ...empty, ...flag, ...(agentsOut ? { agents: agentsOut } : {}) };
  const ev = buildEvidence(kept, now);
  return { ...ev, ...flag, ...(agentsOut ? { agents: agentsOut } : {}) };
}
