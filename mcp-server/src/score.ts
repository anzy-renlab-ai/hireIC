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
  agents?: Record<string, CcEvidence>; // internal: per non-cc code-agent footprint (codename → its own evidence), scored + labelled for the employer only, stripped from candidate output
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
  // How sharply they OPERATE cc rather than passively accept it: how often they
  // catch cc's mistakes and push back. Counted locally from their own transcripts
  // (correction-type turns following an assistant turn) over distinct active days —
  // only these two counts leave the machine, never the conversation text. Scored as
  // a RATE (corrections/active-day), small and capped: a strong signal of a real
  // operator, but keyword-inferred and easy to spam, so it's a discounted bonus.
  correctionTurns?: number; // human turns flagged as catching a cc problem (last ~90d)
  activeDays?: number; // distinct days with any human turn (the rate denominator)
}

export type CcBand = "none" | "weak" | "moderate" | "strong";

export interface CcScore {
  score: number; // 0-100
  band: CcBand;
  breakdown: { usage: number; mastery: number; localUsage: number; history: number; critique: number; recencyFactor: number };
  evidence: CcEvidence;
  profile: AgentProfile | null;
  note: string;
}

const NOTE =
  "cc 信号分 = 真实产出 (verified: 公开 commit 的量·跨仓库·跨月, 对数曲线—量越大分越高) + 自报延展 (本地 commit 足迹 + 自建 skill/MCP, 隐私安全计数, 打折). 真实产出是主轴; 一行命令能造的 config (statusline/CLAUDE.md/单个 hook) 几乎不计分. 公开 commit 是必要门槛 (非充分): 没有公开足迹, 自报再多也最多 moderate; 跨过门槛后自报会显著抬分, 所以 strong 仍要人工核实 evidence. cc 署名是信号不是证明 (commit trailer 能手动伪造) —— 防君子不防小人, 配合 evidence 链接人工核实. 隐私: 自报只含计数/布尔, 无内容/名字/路径/secret.";

const STRONG_SCORE = 60; // band threshold; the single source of truth for "strong"
const MODERATE_MAX = STRONG_SCORE - 1; // a score may only cross this with verified proof
const SELF_MAX = 34; // ceiling on the total self-reported contribution (keeps self < a band on its own)
// Strong is unlocked by a smooth RAMP on verified commit count, not a cliff: below
// PROOF_MIN_COMMITS the strong headroom is closed (casual fakes stay moderate); at
// PROOF_FULL_COMMITS verified proof is full and self-report is credited in full.
// A ramp (not a hard gate) means one extra commit never teleports a candidate
// across the band boundary that triggers employer outreach.
const PROOF_MIN_COMMITS = 8;
const PROOF_FULL_COMMITS = 40;

// Diminishing-returns curve: w*log2(1+x), clamped at cap. Reused for every
// volume/breadth/cadence axis so "more real output" keeps scoring higher without
// the early flat plateau that made 21 commits tie 5000.
function curve(x: number, weight: number, cap: number): number {
  return Math.min(cap, weight * Math.log2(1 + Math.max(0, x)));
}

function recencyFactor(daysSinceLast: number): number {
  if (daysSinceLast <= 30) return 1.0;
  if (daysSinceLast <= 90) return 0.9;
  if (daysSinceLast <= 180) return 0.72;
  if (daysSinceLast <= 365) return 0.5;
  return 0.3;
}

function bandFor(score: number): CcBand {
  // Fail CLOSED on a non-finite score: never default a garbage value to the band
  // that fires employer outreach (NaN < 60 is false, so the naive form returns "strong").
  if (!Number.isFinite(score) || score <= 0) return "none";
  if (score < 30) return "weak";
  if (score < STRONG_SCORE) return "moderate";
  return "strong";
}

// Verified public usage (the anchor, hard to fake) — log curve so real volume
// keeps separating, max ~69. Breadth and cadence are COMMIT-BACKED: spreading one
// commit across N throwaway repos (or one commit per month) buys almost nothing,
// because breadth/cadence credit is scaled by how many commits actually back it.
// This closes the "5 empty repos = instant strong" farm the old linear caps allowed.
function usagePoints(e: CcEvidence): number {
  const volume = curve(e.ccCommits, 5.2, 45);
  const breadthBacking = e.ccRepos > 0 ? Math.min(1, e.ccCommits / (3 * e.ccRepos)) : 0;
  const cadenceBacking = e.activeMonths > 0 ? Math.min(1, e.ccCommits / (2 * e.activeMonths)) : 0;
  const breadth = curve(e.ccRepos, 3.5, 14) * breadthBacking;
  const cadence = curve(e.activeMonths, 2.9, 10) * cadenceBacking;
  return volume + breadth + cadence;
}

// Self-reported config extension — DEMOTED per the founder's thesis ("real output,
// not decorative configs"). One-line-fakeable items (hasStatusline, hasClaudeMd, a
// lone hook) are worth almost nothing; the genuinely hard signals (self-authored
// MCP, many real skills) carry the weight. Raw max 35, then *0.5 (max 17.5).
function masteryPoints(p: AgentProfile | undefined): number {
  if (!p) return 0;
  const raw =
    Math.min((p.skills ?? 0) * 5, 18) +
    Math.min((p.mcpServers ?? 0) * 5, 10) +
    (p.selfAuthoredMcp ? 10 : 0) +
    Math.min((p.subagents ?? 0) * 3, 9) +
    Math.min((p.hooks ?? 0) * 1.5, 4.5) + // cheap → demoted
    Math.min((p.slashCommands ?? 0) * 1, 4) + // cheap → demoted
    Math.min((p.outputStyles ?? 0) * 2, 4) +
    (p.hasClaudeMd ? 1.5 : 0) + // one-line fake → near zero
    (p.hasStatusline ? 1 : 0); // one-line fake → near zero
  return Math.min(raw, 35) * 0.5;
}

// cc history / experience: how long they've been using cc. Self-reported (from
// local first-commit date). Log-curved, max 6. Early adopters edge out newcomers.
function historyPoints(p: AgentProfile | undefined): number {
  if (!p) return 0;
  return curve(p.localCcTenureMonths ?? 0, 1.5, 6);
}

// Operator signal: how often the candidate CATCHES cc's mistakes per active day —
// pushing back / correcting / reverting rather than rubber-stamping slop. A RATE
// (corrections ÷ active-days), not a raw count, so a long history doesn't inflate
// it and a one-day binge can't either. Log-curved and hard-capped at 5: a real
// differentiator between an operator and a passive user, but keyword-inferred and
// trivially spammable ("wrong" × 1000), so it stays a small bonus folded into the
// discounted self-report bucket (SELF_MAX), never enough to move a band alone.
function critiquePoints(p: AgentProfile | undefined): number {
  if (!p) return 0;
  const days = p.activeDays ?? 0;
  const turns = p.correctionTurns ?? 0;
  if (days <= 0 || turns <= 0) return 0;
  return curve(turns / days, 3.2, 5);
}

// Self-reported local cc footprint (private / non-GitHub work) — same log curves as
// verified usage but discounted (0.38), so an honest private-repo dev gets REAL
// credit for prolific local output (the founder's main complaint: 5330 local
// commits must count) while staying unable to reach "strong" without public proof
// (enforced by the STRONG_MIN_COMMITS gate, not by crushing this contribution).
function localUsagePoints(p: AgentProfile | undefined): number {
  if (!p) return 0;
  const raw =
    curve(p.localCcCommits ?? 0, 2.4, 24) +
    curve(p.localCcRepos ?? 0, 2, 12) +
    curve(p.localCcMonths ?? 0, 2.6, 10);
  return raw * 0.38;
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
  const agentBuckets: Record<string, CcEvidence[]> = {};
  for (const e of evs) {
    m.ccCommits += e.ccCommits;
    m.ccRepos += e.ccRepos;
    m.activeMonths = Math.max(m.activeMonths, e.activeMonths);
    m.daysSinceLast = Math.min(m.daysSinceLast, e.daysSinceLast);
    m.spanDays = Math.max(m.spanDays, e.spanDays);
    if (e.density != null) density = Math.min(density, e.density);
    for (const [k, v] of Object.entries(e.agents ?? {})) (agentBuckets[k] ??= []).push(v);
    urls.push(...e.sampleUrls);
  }
  m.sampleUrls = urls.slice(0, 3);
  m.density = density;
  // Same codename across multiple GitHub accounts → merge that agent's footprint too.
  const agents: Record<string, CcEvidence> = {};
  for (const [k, list] of Object.entries(agentBuckets)) agents[k] = mergeEvidence(list);
  if (Object.keys(agents).length) m.agents = agents;
  return m;
}

export function scoreCc(evidence: CcEvidence, profile?: AgentProfile): CcScore {
  const usage = usagePoints(evidence);
  const mastery = masteryPoints(profile);
  const localUsage = localUsagePoints(profile);
  const history = historyPoints(profile);
  const critique = critiquePoints(profile);
  // Recency only decays the VERIFIED footprint; self-reported parts aren't dated.
  const recency = evidence.ccCommits > 0 ? recencyFactor(evidence.daysSinceLast) : 1;
  // normalize the verified component for sample distribution. Clamp to [0,1] at the
  // read site so a malformed/injected density can't inflate (or negate) the score,
  // regardless of where the evidence object came from.
  const d = evidence.density;
  const k = typeof d === "number" && Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : 1;
  const verified = usage * recency * k;
  // Self-report is a bounded ADD-ON, never the bulk of a band: capped at SELF_MAX.
  const self = Math.min(mastery + localUsage + history + critique, SELF_MAX);
  // Below MODERATE_MAX the score is ungated (honest private devs reach moderate on
  // self-report alone). The headroom ABOVE moderate is unlocked SMOOTHLY by verified
  // commit count: proof ramps 0→1 over [PROOF_MIN_COMMITS, PROOF_FULL_COMMITS], so
  // crossing into "strong" requires real public output and never jumps on one commit.
  const raw = verified + self;
  const proof = Math.max(0, Math.min(1, (evidence.ccCommits - PROOF_MIN_COMMITS) / (PROOF_FULL_COMMITS - PROOF_MIN_COMMITS)));
  const gated = raw <= MODERATE_MAX ? raw : MODERATE_MAX + (raw - MODERATE_MAX) * proof;
  const base = Math.min(100, gated);
  const score = Number.isFinite(base) ? Math.round(base) : 0;
  const { density: _d, agents: _a, ...publicEvidence } = evidence;
  return {
    score,
    band: bandFor(score),
    breakdown: {
      usage: Math.round(usage),
      mastery: Math.round(mastery),
      localUsage: Math.round(localUsage),
      history: Math.round(history),
      critique: Math.round(critique),
      recencyFactor: recency,
    },
    evidence: publicEvidence,
    profile: profile ?? null,
    note: NOTE,
  };
}
