// Network-backed advisory signals. Kept OUT of validate-issue's pure path so
// runValidation stays deterministic + offline-testable (see validate-issue.ts).
// Every check is FAIL-OPEN: a flaky request, timeout, or 5xx yields NO warning.
// We only flag definitive negatives (404) so a real candidate is never
// rejected — or even nagged — because GitHub or an external host hiccuped.

import type { CandidatePayload, FieldWarning } from "./issue-parser.js";

export interface SignalDeps {
  fetchImpl?: typeof fetch;
  token?: string;
}

const GONE_STATUSES = new Set([404, 410]);

export async function gatherNetworkWarnings(
  payload: CandidatePayload,
  deps: SignalDeps = {},
): Promise<FieldWarning[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const warnings: FieldWarning[] = [];

  // 1. Does the GitHub username actually exist? Definitive 404 → flag.
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (deps.token) headers.Authorization = `Bearer ${deps.token}`;
    const resp = await fetchImpl(
      `https://api.github.com/users/${encodeURIComponent(payload.github_username)}`,
      { headers },
    );
    if (resp.status === 404) {
      warnings.push({
        field: "github_username",
        kind: "not_found",
        message: `GitHub 上查无 \`${payload.github_username}\` 这个用户名. 可能是笔误, 也可能是冒用他人/伪造. founder 请人工确认.`,
      });
    }
  } catch {
    // fail-open: rate-limit / network error → no signal
  }

  // 2. Is the evidence URL a dead link? Only 404/410 (definitely gone) → flag.
  //    5xx, timeouts, throws are treated as transient → silent.
  try {
    const resp = await fetchImpl(payload.evidence_url, { method: "HEAD" });
    if (GONE_STATUSES.has(resp.status)) {
      warnings.push({
        field: "evidence_url",
        kind: "unreachable",
        message: `evidence_url 打不开 (HTTP ${resp.status}). 证据链接是死链, founder 无法核验 cc-fluency.`,
      });
    }
  } catch {
    // fail-open
  }

  return warnings;
}
