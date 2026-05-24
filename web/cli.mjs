#!/usr/bin/env node
// hireIC apply — run straight from the web, no install:
//   curl -fsSL https://hire.renlab.ai/cli.mjs | node - <job-id>
// It detects your GitHub, self-introspects your cc setup + local cc footprint
// (counts only — nothing but counts leaves your machine), and submits. Scoring +
// delivery happen server-side; all secrets stay on the server.

import { readdirSync, existsSync, readFileSync, createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";

const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
const API = argOf("--api") || "https://hireic-api.renlab.ai";
const jobId = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!jobId) {
  console.error("usage: curl -fsSL https://hire.renlab.ai/cli.mjs | node - <job-id> [--github X] [--contact Y]");
  process.exit(1);
}
function tryExec(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

// BEFORE — tell the candidate exactly what's about to happen + the privacy promise.
console.log(`
hireIC 投递 · ${jobId}
即将:① 认出你的 GitHub  ② 数一数你本地的 cc 使用痕迹(只数数量)  ③ 提交评估
🔒 隐私:只发送计数 + 你的公开 GitHub 用户名 + 联系方式。绝不读取代码内容、文件名、路径或密钥,不上传任何文件。脚本开源可审:https://hire.renlab.ai/cli.mjs
`);

// 1) GitHub identity — auto-detected (this is just your public login, no secret).
const github = argOf("--github") || tryExec("gh", ["api", "user", "-q", ".login"]);
if (!github) { console.error("认不出你的 GitHub — 加 --github <用户名>(或先 `gh auth login`)"); process.exit(1); }

// 2) Contact — the employer reaches you HERE, so you type it explicitly. We never
// guess a private/noreply email behind your back. --contact wins; otherwise we ask
// on /dev/tty (works even though stdin is the piped script). A git email is offered
// as a press-enter default, but you choose.
async function askContact() {
  const flag = argOf("--contact");
  if (flag && flag.trim()) return flag.trim();
  // Only prompt when a REAL terminal is attached (e.g. you ran it in your shell).
  // Inside Claude Code / CI there's no tty — we DON'T silently grab a git email
  // (it's often a private/noreply address); instead we return "" and tell you to
  // pass --contact, so the contact is always something you chose.
  if (!process.stdout.isTTY && !process.stderr.isTTY) return "";
  const raw = tryExec("git", ["config", "user.email"]);
  const guess = /@users\.noreply\.github\.com$/.test(raw) ? "" : raw;
  try {
    const input = createReadStream("/dev/tty");
    const rl = createInterface({ input, output: process.stderr });
    const ans = await new Promise((res) => rl.question(`📬 你的联系方式(邮箱/微信/手机,招聘方用它联系你)${guess ? ` [回车用 ${guess}]` : ""}: `, res));
    rl.close(); input.destroy();
    return (ans.trim() || guess).trim();
  } catch { return ""; }
}
const contact = await askContact();
if (!contact) {
  console.error([
    "",
    "✋ 还没填联系方式 —— 招聘方拿它联系你,必须有。",
    "再跑一次,把你的邮箱/微信加在末尾:",
    `  curl -fsSL https://hire.renlab.ai/cli.mjs | node - ${jobId} --contact 你的邮箱`,
    "",
  ].join("\n"));
  process.exit(1);
}

// 3) self-introspect (counts/flags only)
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

// 4) submit — show the candidate the EXACT payload first, so they can see for
// themselves that only counts + github + contact leave the machine.
const payload = { github, contact, job_id: jobId, profile };
console.log("本次发送的全部数据(就这些,全是计数/标志,无代码内容):");
console.log(JSON.stringify(payload, null, 2).split("\n").map((l) => "  " + l).join("\n"));
console.log("");

const resp = await fetch(`${API}/api/apply`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
if (!resp.ok) { console.error(`apply failed: HTTP ${resp.status}`); process.exit(1); }
const r = await resp.json();
console.log(`✓ 已投递 ${jobId} as @${github}`);
console.log(`  cc 信号分: ${r.cc_score}/100 (${r.band})`);
console.log(`  招聘方${r.delivery?.delivered ? "已收到你的申请,会直接联系你" : "投递已记录"}.`);
console.log(`🔒 完成。上面那段 JSON 就是离开你机器的全部内容 —— 没有代码、没有文件、没有隐私。`);
