// cc-signal scoring — the heart of hireIC's "verify, don't self-report (much)".
//
// Two sources, deliberately weighted differently:
//   1. VERIFIED public footprint (CcEvidence) — what hireIC pulls from GitHub on
//      its own: commits carrying the exact Claude Code co-author fingerprint,
//      across repos, across months, how recently.
//   2. AGENT self-report (AgentProfile) — the candidate's own Claude Code
//      introspects its setup and reports PRIVACY-SAFE COUNTS/FLAGS only: how many
//      custom skills, MCP servers, subagents, hooks, slash commands, a CLAUDE.md.
//      Never file contents, names, paths, or secrets. This captures the strongest
//      proficiency signal — building ON cc, not just using it — but it's
//      self-attested, so it is DISCOUNTED (a 小人 can lie; a 君子 reports true).
//
// Dimensions: usage (volume·breadth·cadence, verified) + mastery (extension,
// self-reported·discounted), the whole thing decayed by recency. Building skills/
// MCP is what lifts someone from "moderate" (heavy user) to "strong". 防君子不防
// 小人 — a SIGNAL, not certification; always shipped with evidence to eyeball.
// Pure function, no network, fully testable.

export interface CcEvidence {
  ccCommits: number;
  ccRepos: number;
  activeMonths: number;
  daysSinceLast: number;
  spanDays: number;
  sampleUrls: string[];
  density?: number; // internal sample-distribution normalization
  coAuthors?: Record<string, number>; // internal: non-primary co-author tags seen (codename → count), surfaced only to the employer, stripped from candidate output
}

// Agent self-reported, privacy-safe: COUNTS and FLAGS only — never contents,
// names, paths, or secrets. The candidate's own agent introspects its machine and
// fills this; the human never types numbers.
export interface AgentProfile {
  skills?: number; // # custom .claude/skills
  mcpServers?: number; // # configured MCP servers
  selfAuthoredMcp?: boolean; // built their own MCP server
  subagents?: number; // # custom subagents
  hooks?: number; // # configured hooks
  slashCommands?: number; // # custom slash commands
  hasClaudeMd?: boolean; // maintains a CLAUDE.md
  outputStyles?: number; // # custom output styles (sophistication)
  hasStatusline?: boolean; // configured a custom statusline (sophistication)
  // Local cc footprint the agent counts via `git log` across ALL local repos —
  // including PRIVATE / GitLab / non-GitHub work that public search can't see.
  // Counts only (no repo names/paths/content). Self-reported → discounted.
  localCcCommits?: number;
  localCcRepos?: number;
  localCcMonths?: number;
  localCcTenureMonths?: number; // months since their FIRST cc commit (cc history/experience)
}

export type CcBand = "none" | "weak" | "moderate" | "strong";

export interface CcScore {
  score: number; // 0-100
  band: CcBand;
  breakdown: { usage: number; mastery: number; localUsage: number; history: number; recencyFactor: number };
  evidence: CcEvidence;
  profile: AgentProfile | null;
  note: string;
}

const NOTE =
  "cc 信号分 = 使用 (verified: 公开 commit 的量·跨仓库·跨月) + 延展 (agent 自报: 自建 skill/MCP/subagent/hooks 的数量, 隐私安全计数, 自报打 5 折) , 再按新近度衰减. 自建 skill/MCP 是高手分水岭 (heavy user → moderate, extends cc → strong). 信号不是认证 (防君子不防小人), 配合 evidence 链接人工核实. 隐私: 自报只含计数/布尔, 无内容/名字/路径/secret.";

function recencyFactor(daysSinceLast: number): number {
  if (daysSinceLast <= 30) return 1.0;
  if (daysSinceLast <= 90) return 0.9;
  if (daysSinceLast <= 180) return 0.72;
  if (daysSinceLast <= 365) return 0.5;
  return 0.3;
}

function bandFor(score: number): CcBand {
  if (score <= 0) return "none";
  if (score < 30) return "weak";
  if (score < 60) return "moderate";
  return "strong";
}

// Verified public usage — max 55.
function usagePoints(e: CcEvidence): number {
  const volume = Math.min(e.ccCommits * 1.2, 25);
  const breadth = Math.min(e.ccRepos * 5, 15);
  const cadence = Math.min(e.activeMonths * 4, 15);
  return volume + breadth + cadence;
}

// Self-reported extension — raw max 60, then *0.5 discount (max 30 contribution).
function masteryPoints(p: AgentProfile | undefined): number {
  if (!p) return 0;
  const raw =
    Math.min((p.skills ?? 0) * 6, 24) +
    Math.min((p.mcpServers ?? 0) * 8, 16) +
    (p.selfAuthoredMcp ? 12 : 0) +
    Math.min((p.subagents ?? 0) * 4, 12) +
    Math.min((p.hooks ?? 0) * 3, 9) +
    Math.min((p.slashCommands ?? 0) * 2, 8) +
    (p.hasClaudeMd ? 5 : 0) +
    Math.min((p.outputStyles ?? 0) * 4, 8) +
    (p.hasStatusline ? 4 : 0);
  return Math.min(raw, 70) * 0.5;
}

// cc history / experience: how long they've been using cc. Self-reported
// (from local first-commit date), discounted. An early adopter with years of cc
// scores higher than someone who started last week. Max ~6.
function historyPoints(p: AgentProfile | undefined): number {
  if (!p) return 0;
  return Math.min((p.localCcTenureMonths ?? 0) * 1.2, 12) * 0.5;
}

// Self-reported local cc footprint (private / non-GitHub work) — same shape as
// verified usage but DISCOUNTED harder (0.4), so an honest private-repo dev gets
// real credit yet can't self-report their way to "strong" without public proof.
function localUsagePoints(p: AgentProfile | undefined): number {
  if (!p) return 0;
  const raw =
    Math.min((p.localCcCommits ?? 0) * 1.2, 25) +
    Math.min((p.localCcRepos ?? 0) * 5, 15) +
    Math.min((p.localCcMonths ?? 0) * 4, 15);
  return raw * 0.3; // harder discount: even maxed self-report stays < strong without verified usage
}

// A candidate may have several GitHub accounts (personal + work). Merge their
// per-account public footprints into one: sum volume/breadth, take the most-recent
// recency, keep the cross-month max (months overlap across accounts, so don't
// double-count), the most conservative density, and a few sample URLs.
export function mergeEvidence(evs: CcEvidence[]): CcEvidence {
  if (evs.length <= 1) return evs[0] ?? { ccCommits: 0, ccRepos: 0, activeMonths: 0, daysSinceLast: Infinity, spanDays: 0, sampleUrls: [] };
  const m: CcEvidence = { ccCommits: 0, ccRepos: 0, activeMonths: 0, daysSinceLast: Infinity, spanDays: 0, sampleUrls: [] };
  let density = 1;
  const urls: string[] = [];
  const coAuthors: Record<string, number> = {};
  for (const e of evs) {
    m.ccCommits += e.ccCommits;
    m.ccRepos += e.ccRepos;
    m.activeMonths = Math.max(m.activeMonths, e.activeMonths);
    m.daysSinceLast = Math.min(m.daysSinceLast, e.daysSinceLast);
    m.spanDays = Math.max(m.spanDays, e.spanDays);
    if (e.density != null) density = Math.min(density, e.density);
    for (const [k, v] of Object.entries(e.coAuthors ?? {})) coAuthors[k] = (coAuthors[k] ?? 0) + v;
    urls.push(...e.sampleUrls);
  }
  m.sampleUrls = urls.slice(0, 3);
  m.density = density;
  if (Object.keys(coAuthors).length) m.coAuthors = coAuthors;
  return m;
}

export function scoreCc(evidence: CcEvidence, profile?: AgentProfile): CcScore {
  const usage = usagePoints(evidence);
  const mastery = masteryPoints(profile);
  const localUsage = localUsagePoints(profile);
  const history = historyPoints(profile);
  // Recency only decays the VERIFIED footprint; self-reported parts aren't dated.
  const recency = evidence.ccCommits > 0 ? recencyFactor(evidence.daysSinceLast) : 1;
  // normalize the verified component for sample distribution
  const k = evidence.density ?? 1;
  const base = Math.min(100, usage * recency * k + mastery + localUsage + history);
  const score = Math.round(base);
  const { density: _d, coAuthors: _c, ...publicEvidence } = evidence;
  return {
    score,
    band: bandFor(score),
    breakdown: {
      usage: Math.round(usage),
      mastery: Math.round(mastery),
      localUsage: Math.round(localUsage),
      history: Math.round(history),
      recencyFactor: recency,
    },
    evidence: publicEvidence,
    profile: profile ?? null,
    note: NOTE,
  };
}
