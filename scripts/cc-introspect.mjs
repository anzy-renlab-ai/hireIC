#!/usr/bin/env node
// hireIC — agent-run cc profile introspection.
//
// The CANDIDATE'S OWN Claude Code runs this to build a privacy-safe AgentProfile
// for `apply`. The human types NOTHING — the agent gathers it. Output is COUNTS
// and FLAGS only: never repo names, paths, file contents, secrets, or commit
// messages. It captures cc work in PRIVATE / non-GitHub repos that public search
// can't see (via local `git log`), so employed candidates aren't invisible.
//
// Usage:  node cc-introspect.mjs [scanRoot]      (scanRoot defaults to ~/ , one level deep)
// Output: a single JSON line — the profile — to stdout.

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();
const claude = join(home, ".claude");

function countDirs(p) {
  try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).length; }
  catch { return 0; }
}
function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// --- .claude setup (mastery) ---
const skills = countDirs(join(claude, "skills"));
const settings = readJson(join(claude, "settings.json")) ?? {};
const dotClaude = readJson(join(home, ".claude.json")) ?? {};
const mcpServers = Object.keys(dotClaude.mcpServers ?? {}).length;
const hooks = Object.keys(settings.hooks ?? {}).length;
let slashCommands = 0;
try { slashCommands = readdirSync(join(claude, "commands")).filter((f) => f.endsWith(".md")).length; } catch {}
const hasClaudeMd = existsSync(join(claude, "CLAUDE.md"));
const subagents = countDirs(join(claude, "agents"));

// --- local cc footprint across git repos (private / non-GitHub work) ---
// Scan one level under scanRoot for git repos; aggregate commits whose message
// carries the exact Claude Code trailer. Counts only — repo identities discarded.
const scanRoot = process.argv[2] || home;
// ERE matching the Claude Code trailer regardless of model name in between, e.g.
// "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>".
const GREP = "co-authored-by:.*claude.*noreply@anthropic\\.com";
let localCcCommits = 0;
let localCcRepos = 0;
const months = new Set();
let entries = [];
try { entries = readdirSync(scanRoot, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
for (const d of entries) {
  const dir = join(scanRoot, d.name);
  if (!existsSync(join(dir, ".git"))) continue;
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "log", "--all", "-i", "-E", `--grep=${GREP}`, "--pretty=%ad", "--date=format:%Y-%m"],
      { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!out) continue;
    const lines = out.split("\n").filter(Boolean);
    localCcCommits += lines.length;
    localCcRepos += 1;
    for (const m of lines) months.add(m);
  } catch {
    // not a git repo / git missing / timeout → skip silently
  }
}

const profile = {
  skills,
  mcpServers,
  subagents,
  hooks,
  slashCommands,
  hasClaudeMd,
  localCcCommits,
  localCcRepos,
  localCcMonths: months.size,
};
process.stdout.write(JSON.stringify(profile) + "\n");
