// Network-backed advisory signals. Kept OUT of validate-issue's pure path so
// runValidation stays deterministic + offline-testable (see validate-issue.ts).
// Every check is FAIL-OPEN: a flaky request, timeout, or 5xx yields NO warning.
// We only flag definitive negatives (404) so a real candidate is never
// rejected — or even nagged — because GitHub or an external host hiccuped.
//
// SECURITY: we ONLY ever fetch a fixed, trusted host (api.github.com). We do
// NOT fetch user-supplied URLs (e.g. evidence_url) server-side — that would be
// SSRF: an attacker could point evidence_url at internal/metadata endpoints and
// make the CI runner request them. Dead-link detection on evidence_url is not
// worth opening that surface (and wouldn't catch fabricated-but-live evidence
// anyway). The founder eyeballs evidence_url at /approve time instead.

import type { CandidatePayload, FieldWarning } from "./issue-parser.js";

export interface SignalDeps {
  fetchImpl?: typeof fetch;
  token?: string;
}

// Bound every request so a slow/hung trusted host can't stall the validation
// workflow (which is serialized per-issue via a concurrency group).
const REQUEST_TIMEOUT_MS = 5000;

export async function gatherNetworkWarnings(
  payload: CandidatePayload,
  deps: SignalDeps = {},
): Promise<FieldWarning[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const warnings: FieldWarning[] = [];

  // Does the GitHub username actually exist? Definitive 404 → flag.
  // Fixed host + regex-validated, percent-encoded username → no SSRF surface.
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (deps.token) headers.Authorization = `Bearer ${deps.token}`;
    const resp = await fetchImpl(
      `https://api.github.com/users/${encodeURIComponent(payload.github_username)}`,
      {
        headers,
        redirect: "error", // don't chase redirects off the trusted host
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (resp.status === 404) {
      warnings.push({
        field: "github_username",
        kind: "not_found",
        message: `GitHub 上查无 \`${payload.github_username}\` 这个用户名. 可能是笔误, 也可能是冒用他人/伪造. founder 请人工确认.`,
      });
    }
  } catch {
    // fail-open: rate-limit / timeout / network error → no signal
  }

  return warnings;
}
