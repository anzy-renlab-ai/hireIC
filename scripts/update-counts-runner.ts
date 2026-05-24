#!/usr/bin/env tsx
// Entry point for .github/workflows/update-counts.yml.
// Reads jobs/ on disk, regenerates the README counter block.
// Exits with code 0 if README changed, 1 if no change (so workflow can skip commit).
// Exits with code 2 if README is malformed (so workflow fails loud).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { rebuildReadmeCounts, countMdFiles } from "./update-counts.js";

const repoRoot = process.env.REPO_ROOT ?? process.cwd();
const readmePath = resolve(repoRoot, "README.md");

const jobsDir = resolve(repoRoot, "jobs");

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

const jobsCount = countMdFiles(safeReaddir(jobsDir));

const before = readFileSync(readmePath, "utf-8");
let after: string;
try {
  after = rebuildReadmeCounts(before, { jobs: jobsCount });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}

if (before === after) {
  console.log(`No README change. jobs=${jobsCount}`);
  process.exit(1);
}

writeFileSync(readmePath, after, "utf-8");
console.log(`README updated. jobs=${jobsCount}`);
process.exit(0);
