// Pure decision function for convert-to-pr.yml.
// Given the trigger context (comment, author, labels, issue body), returns
// either { kind: "noop", reason } / { kind: "convert", target, pr } /
// { kind: "error", reason, message }. The workflow then performs GH API calls
// based on this decision. Keeping the logic pure makes it fully testable.

import { parseIssueBody, validateJobPayload } from "./issue-parser.js";
import { generateJobMarkdown, jobFilename } from "./md-generator.js";

export interface DecideArgs {
  commentBody: string;
  commentAuthor: string;
  authorIsOwner: boolean;
  issueBody: string;
  labels: string[];
  issueNumber?: number;
  now?: Date;
}

export type Decision =
  | { kind: "noop"; reason: NoopReason }
  | { kind: "convert"; target: ConvertTarget; pr: PRSpec }
  | { kind: "error"; reason: ErrorReason; message: string };

export type NoopReason =
  | "not_approve"
  | "unauthorized"
  | "not_pending_review"
  | "missing_kind_label";

export type ErrorReason = "revalidation_failed" | "unknown_kind";

export interface ConvertTarget {
  kind: "job";
  path: string;
  markdown: string;
}

export interface PRSpec {
  title: string;
  branchName: string;
  commitMessage: string;
}

const APPROVE_RE = /(^|\s)\/approve(?!-|\w)/;

function isApprove(comment: string): boolean {
  return APPROVE_RE.test(comment);
}

function detectKind(labels: string[]): "job" | null {
  if (labels.includes("job")) return "job";
  return null;
}

function asciiSlug(s: string, max = 30): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export function decideConvert(args: DecideArgs): Decision {
  if (!isApprove(args.commentBody)) {
    return { kind: "noop", reason: "not_approve" };
  }
  if (!args.authorIsOwner) {
    return { kind: "noop", reason: "unauthorized" };
  }
  if (!args.labels.includes("pending-review")) {
    return { kind: "noop", reason: "not_pending_review" };
  }
  const kind = detectKind(args.labels);
  if (!kind) {
    return { kind: "noop", reason: "missing_kind_label" };
  }

  const parsed = parseIssueBody(args.issueBody);

  if (kind === "job") {
    const result = validateJobPayload(parsed);
    if (!result.ok) {
      return {
        kind: "error",
        reason: "revalidation_failed",
        message: result.errors.map((e) => `${e.field}: ${e.message}`).join("\n"),
      };
    }
    const now = args.now ?? new Date();
    const filename = jobFilename(result.payload, now);
    const markdown = generateJobMarkdown(result.payload);
    const slug = asciiSlug(result.payload.company);
    return {
      kind: "convert",
      target: {
        kind: "job",
        path: `jobs/${filename}`,
        markdown,
      },
      pr: {
        title: `Job: ${result.payload.company} — ${result.payload.role_title_zh}`,
        branchName: `convert/issue-${args.issueNumber ?? 0}-${slug}`,
        commitMessage: `Add job: ${result.payload.company} — ${result.payload.role_title_zh}\n\nResolves issue #${args.issueNumber ?? "?"}.`,
      },
    };
  }

  return { kind: "error", reason: "unknown_kind", message: `unknown kind: ${kind}` };
}
