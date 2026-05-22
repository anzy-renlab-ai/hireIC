#!/usr/bin/env tsx
// Entry point used by .github/workflows/validate.yml.
// Reads the issue body and labels from environment variables (set by the GH context),
// runs PII detection + payload validation, and writes:
//   - validate.outcome.txt  ("pass" | "fail")
//   - validate.comment.md   (markdown body to post as issue comment)
//   - validate.label.txt    (label name to apply if pass, or empty)
//
// The workflow then uses these artifacts to comment / label.
// We do not call the GitHub API here so the logic is fully unit-testable
// and works the same in CI runs and local `act` fixtures.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseIssueBody,
  validateCandidatePayload,
  validateJobPayload,
  detectPII,
  candidateWarnings,
  type FieldError,
  type FieldWarning,
  type CandidatePayload,
} from "./issue-parser.js";
import {
  renderValidationErrorComment,
  renderValidationSuccessComment,
  renderPIIRejectionComment,
} from "./bot-comments.js";
import { gatherNetworkWarnings } from "./signals.js";

interface RunArgs {
  body: string;
  labels: string[];
  outDir: string;
}

export interface RunResult {
  outcome: "pass" | "fail";
  commentMarkdown: string;
  applyLabel: string | null;
  reason: "validated" | "pii" | "missing_kind_label" | "field_errors";
  warnings: FieldWarning[];
}

function detectKind(labels: string[]): "candidate" | "job" | null {
  if (labels.includes("candidate")) return "candidate";
  if (labels.includes("job")) return "job";
  return null;
}

export function runValidation(
  args: Omit<RunArgs, "outDir"> & { extraWarnings?: FieldWarning[] },
): RunResult {
  const kind = detectKind(args.labels);
  if (!kind) {
    return {
      outcome: "fail",
      commentMarkdown: renderValidationErrorComment([
        {
          field: "label",
          kind: "missing",
          message:
            "Issue 缺 `candidate` 或 `job` 标签 (Issue Form 应自动加上). 你是不是手动开了 blank issue? 请用 [候选人申请](../../issues/new?template=candidate.yml) 或 [发布职位](../../issues/new?template=job.yml).",
        },
      ]),
      applyLabel: null,
      reason: "missing_kind_label",
      warnings: [],
    };
  }

  const piiHits = detectPII(args.body);
  if (piiHits.length > 0) {
    return {
      outcome: "fail",
      commentMarkdown: renderPIIRejectionComment(piiHits),
      applyLabel: null,
      reason: "pii",
      warnings: [],
    };
  }

  const parsed = parseIssueBody(args.body);
  const result =
    kind === "candidate"
      ? validateCandidatePayload(parsed)
      : validateJobPayload(parsed);

  if (!result.ok) {
    return {
      outcome: "fail",
      commentMarkdown: renderValidationErrorComment(result.errors as FieldError[]),
      applyLabel: null,
      reason: "field_errors",
      warnings: [],
    };
  }

  // Advisory only — never flips outcome. Pure (cc-months) warnings computed
  // here; network-backed warnings are injected via extraWarnings by main().
  const pureWarnings =
    kind === "candidate"
      ? candidateWarnings(result.payload as CandidatePayload)
      : [];
  const warnings = [...pureWarnings, ...(args.extraWarnings ?? [])];

  return {
    outcome: "pass",
    commentMarkdown: renderValidationSuccessComment(kind, warnings),
    applyLabel: "pending-review",
    reason: "validated",
    warnings,
  };
}

export async function writeArtifacts(outDir: string, result: RunResult): Promise<void> {
  await writeFile(resolve(outDir, "validate.outcome.txt"), result.outcome, "utf-8");
  await writeFile(resolve(outDir, "validate.comment.md"), result.commentMarkdown, "utf-8");
  await writeFile(resolve(outDir, "validate.label.txt"), result.applyLabel ?? "", "utf-8");
}

async function main(): Promise<void> {
  const body = process.env.ISSUE_BODY;
  if (body === undefined) {
    console.error("ISSUE_BODY env var not set");
    process.exit(2);
  }
  const labelsRaw = process.env.ISSUE_LABELS ?? "[]";
  let labels: string[] = [];
  try {
    const parsed = JSON.parse(labelsRaw);
    if (Array.isArray(parsed)) {
      labels = parsed
        .map((l: unknown) => (typeof l === "string" ? l : typeof l === "object" && l && "name" in l ? String((l as { name: unknown }).name) : ""))
        .filter((s) => s.length > 0);
    }
  } catch {
    // ignore, treat as no labels
  }
  const outDir = process.env.OUT_DIR ?? process.cwd();

  // First pass: pure validation (offline, deterministic).
  const dry = runValidation({ body, labels });

  // If a candidate passed, enrich with network-backed advisory signals.
  // Fail-open: any error here leaves the dry result untouched — network
  // flakiness must never block a valid submission.
  let extraWarnings: FieldWarning[] = [];
  if (dry.outcome === "pass" && detectKind(labels) === "candidate") {
    const parsed = validateCandidatePayload(parseIssueBody(body));
    if (parsed.ok) {
      try {
        extraWarnings = await gatherNetworkWarnings(
          parsed.payload,
          process.env.GITHUB_TOKEN ? { token: process.env.GITHUB_TOKEN } : {},
        );
      } catch {
        extraWarnings = [];
      }
    }
  }

  const result =
    extraWarnings.length > 0
      ? runValidation({ body, labels, extraWarnings })
      : dry;
  await writeArtifacts(outDir, result);
  console.log(`outcome=${result.outcome} reason=${result.reason} label=${result.applyLabel ?? "(none)"}`);
}

// Only run main() when invoked as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
