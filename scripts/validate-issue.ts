#!/usr/bin/env tsx
// Entry point used by .github/workflows/validate.yml.
// Reads the issue body and labels from env vars, runs PII detection + job
// payload validation, and writes:
//   - validate.outcome.txt  ("pass" | "fail")
//   - validate.comment.md   (markdown body to post as issue comment)
//   - validate.label.txt    (label name to apply if pass, or empty)
//
// No network/API calls here — the logic is fully unit-testable and behaves the
// same in CI runs and local fixtures. hireIC only accepts job submissions;
// candidates apply privately to a role's contact, not via a public issue.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseIssueBody,
  validateJobPayload,
  detectPII,
  type FieldError,
} from "./issue-parser.js";
import {
  renderValidationErrorComment,
  renderValidationSuccessComment,
  renderPIIRejectionComment,
} from "./bot-comments.js";

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
}

function isJob(labels: string[]): boolean {
  return labels.includes("job");
}

export function runValidation(args: Omit<RunArgs, "outDir">): RunResult {
  if (!isJob(args.labels)) {
    return {
      outcome: "fail",
      commentMarkdown: renderValidationErrorComment([
        {
          field: "label",
          kind: "missing",
          message:
            "Issue 缺 `job` 标签 (Issue Form 应自动加上). 你是不是手动开了 blank issue? 请用 [发布职位](../../issues/new?template=job.yml).",
        },
      ]),
      applyLabel: null,
      reason: "missing_kind_label",
    };
  }

  const piiHits = detectPII(args.body);
  if (piiHits.length > 0) {
    return {
      outcome: "fail",
      commentMarkdown: renderPIIRejectionComment(piiHits),
      applyLabel: null,
      reason: "pii",
    };
  }

  const result = validateJobPayload(parseIssueBody(args.body));
  if (!result.ok) {
    return {
      outcome: "fail",
      commentMarkdown: renderValidationErrorComment(result.errors as FieldError[]),
      applyLabel: null,
      reason: "field_errors",
    };
  }

  return {
    outcome: "pass",
    commentMarkdown: renderValidationSuccessComment("job"),
    applyLabel: "pending-review",
    reason: "validated",
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

  const result = runValidation({ body, labels });
  await writeArtifacts(outDir, result);
  console.log(`outcome=${result.outcome} reason=${result.reason} label=${result.applyLabel ?? "(none)"}`);
}

// Only run main() when invoked as a script, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
