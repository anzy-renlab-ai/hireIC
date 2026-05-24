// cc-signal scoring — the heart of hireIC's "verify, don't self-report".
//
// We do NOT claim this is unfakeable (防君子不防小人): the input is a candidate's
// PUBLIC GitHub footprint of real Claude Code usage (commits trailed with
// `Co-authored-by: Claude`, across repos, over time). A determined faker can add
// trailers; an honest cc user can't easily inflate breadth + sustained history.
// So the score is a *signal*, always shipped WITH its evidence (commit URLs) so a
// human can eyeball. Pure function — no network, fully testable. The MCP `apply`
// tool gathers the evidence (network) and feeds it here.

export interface CcEvidence {
  ccCommits: number; // commits authored by the candidate carrying a Claude co-author trailer
  ccRepos: number; // distinct repos those commits span
  spanDays: number; // days between the first and last such commit
  sampleUrls: string[]; // a few real commit URLs, attached as evidence
}

export type CcBand = "none" | "weak" | "moderate" | "strong";

export interface CcScore {
  score: number; // 0-100
  band: CcBand;
  evidence: CcEvidence;
  note: string;
}

const NOTE =
  "cc 信号分: 基于候选人公开的 Claude Code 使用痕迹 (带 Co-authored-by: Claude 的 commit), 越分散、越持续分越高. 这是信号不是认证——防君子不防小人, 请配合 evidence 里的 commit 链接人工核实.";

function bandFor(score: number): CcBand {
  if (score <= 0) return "none";
  if (score < 40) return "weak";
  if (score < 70) return "moderate";
  return "strong";
}

export function scoreCc(evidence: CcEvidence): CcScore {
  const commitPts = Math.min(evidence.ccCommits * 1.2, 50); // volume, capped
  const repoPts = Math.min(evidence.ccRepos * 6, 30); // breadth across repos
  const spanPts = Math.min(evidence.spanDays / 10, 20); // sustained over time
  const score = Math.min(100, Math.round(commitPts + repoPts + spanPts));
  return { score, band: bandFor(score), evidence, note: NOTE };
}
