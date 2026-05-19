#!/usr/bin/env tsx
// Entry point for .github/workflows/convert-to-pr.yml.
// Reads GH context from env, calls decideConvert(), writes artifacts:
//   - convert.decision.json  (the full Decision object as JSON)
//   - convert.path.txt       (file path to commit, if convert)
//   - convert.markdown.md    (file body to commit, if convert)
//   - convert.branch.txt     (branch name, if convert)
//   - convert.pr-title.txt   (PR title, if convert)
//   - convert.commit-msg.txt (commit message, if convert)
//   - convert.error.txt      (error message, if error)
// The workflow inspects these and performs GH API mutations.

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decideConvert, type Decision, type DecideArgs } from "./convert-issue.js";

function parseLabels(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((l: unknown) => {
        if (typeof l === "string") return l;
        if (l && typeof l === "object" && "name" in l) {
          return String((l as { name: unknown }).name);
        }
        return "";
      })
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export async function writeDecisionArtifacts(outDir: string, decision: Decision): Promise<void> {
  await writeFile(resolve(outDir, "convert.decision.json"), JSON.stringify(decision, null, 2), "utf-8");
  if (decision.kind === "convert") {
    await writeFile(resolve(outDir, "convert.path.txt"), decision.target.path, "utf-8");
    await writeFile(resolve(outDir, "convert.markdown.md"), decision.target.markdown, "utf-8");
    await writeFile(resolve(outDir, "convert.branch.txt"), decision.pr.branchName, "utf-8");
    await writeFile(resolve(outDir, "convert.pr-title.txt"), decision.pr.title, "utf-8");
    await writeFile(resolve(outDir, "convert.commit-msg.txt"), decision.pr.commitMessage, "utf-8");
  }
  if (decision.kind === "error") {
    await writeFile(resolve(outDir, "convert.error.txt"), decision.message, "utf-8");
  }
}

async function main(): Promise<void> {
  const commentBody = process.env.COMMENT_BODY;
  const commentAuthor = process.env.COMMENT_AUTHOR;
  const authorIsOwner = process.env.AUTHOR_IS_OWNER === "true";
  const issueBody = process.env.ISSUE_BODY;
  const issueLabels = process.env.ISSUE_LABELS ?? "[]";
  const issueNumber = Number(process.env.ISSUE_NUMBER ?? "0");
  const outDir = process.env.OUT_DIR ?? process.cwd();

  if (commentBody === undefined || commentAuthor === undefined || issueBody === undefined) {
    console.error("Missing required env vars: COMMENT_BODY, COMMENT_AUTHOR, ISSUE_BODY");
    process.exit(2);
  }

  const args: DecideArgs = {
    commentBody,
    commentAuthor,
    authorIsOwner,
    issueBody,
    labels: parseLabels(issueLabels),
    issueNumber,
  };

  const decision = decideConvert(args);
  await writeDecisionArtifacts(outDir, decision);

  console.log(`kind=${decision.kind} ${decision.kind === "noop" ? "reason=" + decision.reason : ""}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
