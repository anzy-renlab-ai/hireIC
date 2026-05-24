#!/usr/bin/env node
// hireic — one command to apply. No "then tell cc to apply" step: running this
// IS the application. It detects your GitHub, self-introspects your cc setup +
// local cc footprint (counts only, nothing leaves your machine but counts), and
// submits to the hireIC API. Scoring + delivery happen server-side.
//
//   npx hireic apply <job-id> [--github X] [--contact Y] [--api URL]

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const API = argOf("--api") || "https://hireic-api.renlab.ai";
const [cmd, jobId] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (cmd !== "apply" || !jobId) {
  console.error("usage: npx hireic apply <job-id> [--github X] [--contact Y]");
  process.exit(1);
}

function argOf(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function tryExec(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

// 1) who are you — detect github + contact, no typing
const github = argOf("--github") || tryExec("gh", ["api", "user", "-q", ".login"]);
const contact = argOf("--contact") || tryExec("gh", ["api", "user", "-q", ".email"]) || tryExec("git", ["config", "user.email"]);
if (!github) { console.error("can't detect your GitHub — pass --github <login> (or run `gh auth login`)"); process.exit(1); }
if (!contact) { console.error("can't detect a contact — pass --contact <email/wechat>"); process.exit(1); }

// 2) self-introspect (counts/flags only)
const home = homedir(), claude = join(home, ".claude");
const countDirs = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).length; } catch { return 0; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } };
const settings = readJson(join(claude, "settings.json"));
const months = new Set();
let localCcCommits = 0, localCcRepos = 0;
try {
  for (const d of readdirSync(join(home, "work"), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const dir = join(home, "work", d.name);
    if (!existsSync(join(dir, ".git"))) continue;
    const out = tryExec("git", ["-C", dir, "log", "--all", "-i", "-E", "--grep=co-authored-by:.*claude.*noreply@anthropic\\.com", "--pretty=%ad", "--date=format:%Y-%m"]);
    if (!out) continue;
    const lines = out.split("\n").filter(Boolean);
    localCcCommits += lines.length; localCcRepos += 1; lines.forEach((m) => months.add(m));
  }
} catch {}
const sorted = [...months].sort();
const tenure = sorted.length ? (() => { const [y, m] = sorted[0].split("-").map(Number); const n = new Date(); return Math.max(0, n.getFullYear() * 12 + n.getMonth() + 1 - (y * 12 + m)); })() : 0;
const profile = {
  skills: countDirs(join(claude, "skills")),
  mcpServers: Object.keys(readJson(join(home, ".claude.json")).mcpServers ?? {}).length,
  hooks: Object.keys(settings.hooks ?? {}).length,
  hasClaudeMd: existsSync(join(claude, "CLAUDE.md")),
  hasStatusline: Boolean(settings.statusLine),
  localCcCommits, localCcRepos, localCcMonths: months.size, localCcTenureMonths: tenure,
};

// 3) submit
const resp = await fetch(`${API}/api/apply`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ github, contact, job_id: jobId, profile }),
});
if (!resp.ok) { console.error(`apply failed: HTTP ${resp.status}`); process.exit(1); }
const r = await resp.json();
console.log(`✓ 已投递 ${jobId} as @${github}`);
console.log(`  cc 信号分: ${r.cc_score}/100 (${r.band})`);
console.log(`  招聘方${r.delivery?.delivered ? "已收到你的申请,会直接联系你" : "投递已记录"}.`);
