// cc-signal scoring — the heart of hireIC's "verify, don't self-report (much)".
//
// Two sources, deliberately weighted differently:
//   1. VERIFIED public footprint (CcEvidence) — what hireIC pulls from GitHub on
//      its own: commits carrying the exact Claude Code co-author fingerprint,
//      across repos, across months, how recently. Can't be faked casually.
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
}

// Agent self-reported, privacy-safe: COUNTS and FLAGS only — never contents,
// names, paths, or secrets.
export interface AgentProfile {
  skills?: number; // # custom .claude/skills
  mcpServers?: number; // # configured MCP servers
  selfAuthoredMcp?: boolean; // built their own MCP server
  subagents?: number; // # custom subagents
  hooks?: number; // # configured hooks
  slashCommands?: number; // # custom slash commands
  hasClaudeMd?: boolean; // maintains a CLAUDE.md
}

export type CcBand = "none" | "weak" | "moderate" | "strong";

export interface CcScore {
  score: number; // 0-100
  band: CcBand;
  breakdown: { usage: number; mastery: number; recencyFactor: number };
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
    (p.hasClaudeMd ? 5 : 0);
  return Math.min(raw, 60) * 0.5;
}

export function scoreCc(evidence: CcEvidence, profile?: AgentProfile): CcScore {
  const usage = usagePoints(evidence);
  const mastery = masteryPoints(profile);
  const recency = evidence.ccCommits > 0 ? recencyFactor(evidence.daysSinceLast) : 1;
  const base = Math.min(100, usage + mastery);
  const score = Math.round(base * recency);
  return {
    score,
    band: bandFor(score),
    breakdown: { usage: Math.round(usage), mastery: Math.round(mastery), recencyFactor: recency },
    evidence,
    profile: profile ?? null,
    note: NOTE,
  };
}
