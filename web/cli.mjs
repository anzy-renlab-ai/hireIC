#!/usr/bin/env node
// hireIC apply — run straight from the web, no install:
//   curl -fsSL https://hire.renlab.ai/cli.mjs | node - <job-id>
// It detects your GitHub, self-introspects your cc setup + local cc footprint
// (counts only — nothing but counts leaves your machine), and submits. Scoring +
// delivery happen server-side; all secrets stay on the server.

import { readdirSync, existsSync, readFileSync, createReadStream, realpathSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ───────────────────────── self-introspection counters ─────────────────────
// Pure, filesystem-only, exported for tests. Everything here produces COUNTS —
// never contents, names, or paths. A miscount silently under-credits real users,
// so each counter is regression-tested (cli.test.ts).

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } };

// Is `p` — following symlinks — a skill dir (a directory holding a SKILL.md)?
// statSync follows the link; readdir's Dirent.isDirectory() does NOT, which is the
// exact bug that scored heavy users with SYMLINKED skills at 0.
function isSkillDir(p) {
  try { return statSync(p).isDirectory() && existsSync(join(p, "SKILL.md")); }
  catch { return false; }
}

// Count DISTINCT skills the candidate has, by name, across:
//   • <claude>/skills/*  — their own skills, INCLUDING symlinked ones.
//   • <claude>/plugins/**/skills/<name>/SKILL.md — installed marketplace/plugin
//     skills, deduped by name so version dirs (1.0.0/1.1.0/…) and hidden
//     .cursor/.windsurf mirror trees don't inflate the count.
export function countSkills(claudeDir) {
  const names = new Set();
  try {
    for (const e of readdirSync(join(claudeDir, "skills"))) {
      if (e.startsWith(".")) continue;
      if (isSkillDir(join(claudeDir, "skills", e))) names.add(e);
    }
  } catch { /* no skills dir */ }
  collectPluginSkills(join(claudeDir, "plugins"), 0, names);
  return names.size;
}

function collectPluginSkills(dir, depth, names) {
  if (depth > 8) return; // bound the walk
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // skip .git/.cursor/.windsurf/.claude mirrors
    const full = join(dir, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = statSync(full).isDirectory(); } catch { isDir = false; } }
    if (!isDir) continue;
    if (existsSync(join(full, "SKILL.md"))) names.add(e.name); // a skill — record, don't descend in
    else collectPluginSkills(full, depth + 1, names);
  }
}

// Count DISTINCT entries in a dir of flat .md items (commands, agents,
// output-styles) OR subdirs — following symlinks, deduped by base name. A plain
// countDirs() returned 0 here because commands/agents are .md FILES, not dirs.
export function countItems(dir) {
  const names = new Set();
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = statSync(join(dir, e.name)).isDirectory(); } catch { continue; } }
    if (isDir || e.name.endsWith(".md")) names.add(e.name.replace(/\.md$/, ""));
  }
  return names.size;
}

// Maintains written guidance? CLAUDE.md OR a rules/ folder of markdown — heavy
// users split their rules across many files instead of one CLAUDE.md.
export function hasGuidance(claudeDir) {
  if (existsSync(join(claudeDir, "CLAUDE.md"))) return true;
  for (const d of ["rules", "rule"]) {
    try { if (readdirSync(join(claudeDir, d)).some((f) => f.endsWith(".md"))) return true; }
    catch { /* no such dir */ }
  }
  return false;
}

// Count distinct MCP servers across BOTH the global block and per-project blocks of
// ~/.claude.json. Claude Code stores project-scoped servers under
// projects[<path>].mcpServers — counting only the top-level key scored a candidate
// who configures MCP per project (arguably the more sophisticated pattern) at 0.
export function countMcpServers(claudeJson) {
  const names = new Set(Object.keys(claudeJson?.mcpServers ?? {}));
  for (const p of Object.values(claudeJson?.projects ?? {})) {
    for (const k of Object.keys(p?.mcpServers ?? {})) names.add(k);
  }
  return names.size;
}

// Local cc-footprint repo discovery. Walk dev roots for git repos. Two correctness
// rules the naive walk missed:
//   • follow SYMLINKED project dirs — Dirent.isDirectory() is false on a symlink, so
//     a symlinked project root was silently skipped (same bug class as the skills scan).
//   • bound by a visited-realpath set so a symlink cycle/diamond terminates and a repo
//     reached two ways isn't scanned twice.
const SCAN_MAX_DEPTH = 4;
const SCAN_SKIP = new Set(["node_modules", "Library", ".cache", ".npm", "vendor", "dist", "build", "target", ".Trash"]);
export function findRepos(root, depth, out, visited = new Set()) {
  if (depth > SCAN_MAX_DEPTH) return;
  let real;
  try { real = realpathSync(root); } catch { return; } // missing / unreadable → skip
  if (visited.has(real)) return; // cycle or already-seen path
  visited.add(real);
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  if (entries.some((e) => e.name === ".git")) { out.push(root); return; } // repo boundary — don't descend in
  for (const e of entries) {
    if (e.name.startsWith(".") || SCAN_SKIP.has(e.name)) continue;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) { try { isDir = statSync(join(root, e.name)).isDirectory(); } catch { isDir = false; } }
    if (!isDir) continue;
    findRepos(join(root, e.name), depth + 1, out, visited);
  }
}

function monthsSince(ymd) {
  const [y, m] = ymd.split("-").map(Number);
  const n = new Date();
  return Math.max(0, n.getFullYear() * 12 + n.getMonth() + 1 - (y * 12 + m));
}

// ── non-cc agent environments (Codex, Kiro CLI) — DISPLAY-ONLY ──────────────────
// Counts-only introspection of OTHER code-agent CLIs the candidate runs. Unlike cc
// (anchored by a public GitHub trailer), these have NO server-verifiable anchor and
// the files are trivially fabricable, so the server treats them as DISPLAY-ONLY
// context for the employer — never folded into the cc score. Privacy unchanged: only
// counts leave (session/day/project counts), never any path, prompt, or file content.

// OpenAI Codex CLI: ~/.codex/{config.toml, sessions/**/rollout-<date>T….jsonl}. The
// session date lives in the FILENAME, so day/tenure counts read zero file contents.
export function countCodex(codexDir) {
  if (!existsSync(join(codexDir, "config.toml")) && !existsSync(join(codexDir, "sessions"))) return null;
  let projects = 0;
  try { projects = (readFileSync(join(codexDir, "config.toml"), "utf8").match(/^\[projects\./gm) || []).length; }
  catch { /* no config.toml */ }
  const days = new Set();
  let sessions = 0, earliest = null;
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) { walk(join(dir, e.name), depth + 1); continue; }
      const m = /^rollout-(\d{4}-\d{2}-\d{2})T.*\.jsonl$/.exec(e.name);
      if (m) { sessions++; days.add(m[1]); if (!earliest || m[1] < earliest) earliest = m[1]; }
    }
  };
  walk(join(codexDir, "sessions"), 0);
  if (!sessions && !projects) return null;
  return { sessions, activeDays: days.size, projects, tenureMonths: earliest ? monthsSince(earliest) : 0 };
}

// AWS Kiro CLI: ~/.kiro is SHARED with the Kiro IDE. Only sessions/cli/*.json +
// settings/cli.json indicate CLI agent USAGE; argv.json/extensions are IDE-install
// only and must NOT count. steering/ and skills/ exist EMPTY at install, so counting
// their contents (0 when empty) naturally avoids crediting a fresh install as signal.
export function countKiroCli(kiroDir) {
  let cliSessions = 0;
  try { for (const f of readdirSync(join(kiroDir, "sessions", "cli"))) if (f.endsWith(".json") && !f.endsWith(".example")) cliSessions++; }
  catch { /* no CLI sessions */ }
  if (!cliSessions) return null; // IDE install without CLI usage → no signal
  let steeringDocs = 0;
  try { steeringDocs = readdirSync(join(kiroDir, "steering")).filter((f) => f.endsWith(".md")).length; } catch { /* none */ }
  let mcpServers = 0;
  try { mcpServers = Object.keys(readJson(join(kiroDir, "settings", "mcp.json")).mcpServers ?? {}).length; } catch { /* none */ }
  return { cliSessions, steeringDocs, mcpServers };
}

// Operator signal: how often the candidate CATCHES cc's mistakes — pushes back,
// corrects, reverts — rather than rubber-stamping. Read LOCALLY from their own cc
// transcripts (~/.claude/projects/*/*.jsonl); ONLY two counts leave the machine
// (correction turns + active days), never any conversation text. A human turn
// counts as "catching a problem" when it follows an assistant turn AND carries a
// correction marker (不对/错了/回滚/revert/undo/broke/…). Heuristic + spammable, so
// server scores it as a small capped RATE (corrections/active-day), not a band-mover.
const CORRECTION_RE =
  /不对|错了|搞错|弄错|写错|回滚|撤销|还原|重来|不是这样|不应该|有问题|你错|改回|别这么|\brevert\b|\bundo\b|\bwrong\b|\bbroke(?:n)?\b|regression|mistake|not right|that'?s not/i;

// Real human-typed text from a transcript line, or "" for tool-results / non-text.
function humanText(d) {
  const c = d.message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) return c.filter((b) => b && b.type === "text").map((b) => b.text || "").join(" ").trim();
  return "";
}

export function scanCorrections(projectsDir, nowMs = Date.now(), windowDays = 90) {
  const cutoff = nowMs - windowDays * 86400000;
  // Collect recent transcript files, newest first, then cap COUNT and total BYTES so
  // this stays a few seconds even with thousands of sessions (a candidate machine,
  // run via curl|node — it must not feel hung). The rate is per-day, so reading the
  // most-recent slice is representative; numerator and denominator are sampled
  // together, so corrections/active-day stays unbiased.
  const FILE_CAP = 600, BYTE_CAP = 120 * 1024 * 1024;
  const candidates = [];
  let projDirs;
  try { projDirs = readdirSync(projectsDir, { withFileTypes: true }); } catch { return { correctionTurns: 0, activeDays: 0 }; }
  for (const pd of projDirs) {
    if (!pd.isDirectory()) continue;
    const pdir = join(projectsDir, pd.name);
    let files;
    try { files = readdirSync(pdir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = join(pdir, f);
      let st;
      try { st = statSync(fp); } catch { continue; }
      if (st.mtimeMs < cutoff || st.size > 16 * 1024 * 1024) continue; // too old / too big
      candidates.push({ fp, mtime: st.mtimeMs, size: st.size });
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  const days = new Set();
  let corrections = 0, bytes = 0, budget = 120000; // hard bounds on work
  for (const c of candidates.slice(0, FILE_CAP)) {
    if ((bytes += c.size) > BYTE_CAP) break;
    let content;
    try { content = readFileSync(c.fp, "utf8"); } catch { continue; }
    let prevAssistant = false;
    for (const line of content.split("\n")) {
      if (!line) continue;
      // Cheap pre-filter: assistant/tool lines are huge — never JSON.parse them.
      if (!line.includes('"type":"user"')) { if (line.includes('"type":"assistant"')) prevAssistant = true; continue; }
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (d.type !== "user" || d.isMeta || d.isSidechain) continue;
      const text = humanText(d);
      if (!text || text[0] === "<") continue; // empty / tool-result / system-injected
      const ts = Date.parse(d.timestamp || "");
      if (!Number.isFinite(ts) || ts < cutoff) { prevAssistant = false; continue; }
      if (budget-- <= 0) return { correctionTurns: corrections, activeDays: days.size };
      const dt = new Date(ts);
      days.add(`${dt.getUTCFullYear()}-${dt.getUTCMonth()}-${dt.getUTCDate()}`);
      if (prevAssistant && CORRECTION_RE.test(text)) corrections++;
      prevAssistant = false;
    }
  }
  return { correctionTurns: corrections, activeDays: days.size };
}

function tryExec(cmd, args) {
  // Bounded so this script (run via curl|node on a stranger's machine) can't hang or
  // OOM: timeout survives a stale NFS mount / stuck index.lock; maxBuffer survives a
  // monorepo with tens of thousands of matching commits (default 1MB would throw
  // ENOBUFS and silently drop the whole repo → a heavy candidate scored as empty).
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 }).trim(); }
  catch { return ""; }
}

// ───────────────────────────────── submit flow ─────────────────────────────
async function main() {
  const argOf = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
  const API = argOf("--api") || "https://hireic-api.renlab.ai";
  const jobId = process.argv.slice(2).find((a) => !a.startsWith("--"));

  if (!jobId) {
    console.error("usage: curl -fsSL https://hire.renlab.ai/cli.mjs | node - <job-id> [--github X] [--contact Y]");
    process.exit(1);
  }

  // BEFORE — tell the candidate exactly what's about to happen + the privacy promise.
  console.log(`
hireIC 投递 · ${jobId}
即将:① 认出你的 GitHub  ② 在本地数一数你的 cc 使用痕迹 + 对话里纠正 cc 的次数,以及你用 Codex/Kiro 的痕迹(只在你机器上数,只发数量)  ③ 提交评估
🔒 隐私:只发送计数 + 你的公开 GitHub 用户名 + 联系方式 + 你的 git 提交邮箱(已公开在 commit 里,用于检索你的公开足迹)。代码与对话内容只在本地参与计数,绝不发送内容、文件名、路径或密钥,不上传任何文件。脚本开源可审:https://hire.renlab.ai/cli.mjs
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
  const settings = readJson(join(claude, "settings.json"));
  // Local cc footprint. Walk the candidate's dev roots for git repos whose history
  // carries the Claude co-author trailer. Two correctness rules the old ~/work-only
  // scan missed:
  //   • Roots are not hardcoded: code lives in ~/projects, ~/code, ~/dev, … too, and
  //     is overridable via HIREIC_SCAN_ROOTS, so a real footprint isn't judged zero.
  //   • Commits are de-duped by SHA (and repos by their shared git dir), so multiple
  //     git WORKTREES of one repo — which share history — don't inflate the count.
  const progress = (m) => { try { process.stderr.write(m + "\n"); } catch { /* ignore */ } };
  const scanRoots = process.env.HIREIC_SCAN_ROOTS
    ? process.env.HIREIC_SCAN_ROOTS.split(":").filter(Boolean)
    : ["work", "projects", "code", "dev", "src", "repos", "git", "go/src", "Documents", "Developer", "Desktop", "workspace"].map((d) => join(home, d));
  progress("② 扫描本地仓库…");
  const repoDirs = [];
  for (const r of scanRoots) findRepos(r, 0, repoDirs);
  progress(`  找到 ${repoDirs.length} 个仓库,统计 cc 提交…`);

  // Only credit the CANDIDATE's own commits. Without an --author filter, `git log
  // --all` also counts trailer commits authored by OTHERS — upstream history of cloned
  // OSS repos, teammates in shared repos — inflating the footprint (one old cloned
  // commit could even set tenure decades back). Identify the candidate per-repo
  // (per-repo user.email, falling back to the global one), escaped for git's -E regex.
  const globalEmail = tryExec("git", ["config", "--global", "user.email"]);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const DEADLINE = Date.now() + 60_000; // whole local scan is a lower bound — never hang a candidate's terminal
  const months = new Set();
  const ccShas = new Set();   // de-dupe commits across worktrees / roots
  const ccRepos = new Set();  // de-dupe repos by their shared git common dir
  const ccEmails = new Set(); // candidate emails on cc-authoring repos → server recall (author-email:)
  let scanned = 0;
  for (const dir of repoDirs) {
    if (Date.now() > DEADLINE) { progress("  ⏱ 仓库扫描超时,用已得计数(下界)"); break; }
    if (++scanned % 25 === 0) progress(`  …已扫描 ${scanned}/${repoDirs.length}`);
    const email = tryExec("git", ["-C", dir, "config", "user.email"]) || globalEmail;
    const authorArgs = email ? [`--author=${reEsc(email)}`] : [];
    const out = tryExec("git", ["-C", dir, "log", "--all", "-i", "-E", ...authorArgs, "--grep=co-authored-by:.*claude.*noreply@anthropic\\.com", "--pretty=%H|%ad", "--date=format:%Y-%m"]);
    if (!out) continue;
    // Repo identity = its shared git dir (worktrees of one repo share it), resolved to
    // an absolute, symlink-canonical path in Node — NOT via `--path-format=absolute`,
    // which is unrecognized on git <2.31 and would collapse every repo to one id.
    const commonDir = tryExec("git", ["-C", dir, "rev-parse", "--git-common-dir"]);
    let repoId = dir;
    if (commonDir) { try { repoId = realpathSync(resolve(dir, commonDir)); } catch { repoId = resolve(dir, commonDir); } }
    let matched = false;
    for (const line of out.split("\n")) {
      const [sha, m] = line.split("|");
      if (!sha || ccShas.has(sha)) continue;
      ccShas.add(sha);
      if (m) months.add(m);
      matched = true;
    }
    if (matched) { ccRepos.add(repoId); if (email) ccEmails.add(email); }
  }
  // Git emails the candidate actually authors cc commits under. A `…@users.noreply.github.com`
  // address is GitHub-linked by definition (author:login already finds it), so only NON-noreply
  // emails add recall; send up to 3 so the server can author-email: them.
  const commitEmails = [...ccEmails]
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && !/noreply/i.test(e))
    .slice(0, 3);
  const localCcCommits = ccShas.size, localCcRepos = ccRepos.size;
  const sorted = [...months].sort();
  const tenure = sorted.length ? (() => { const [y, m] = sorted[0].split("-").map(Number); const n = new Date(); return Math.max(0, n.getFullYear() * 12 + n.getMonth() + 1 - (y * 12 + m)); })() : 0;
  // Operator signal — counted locally; only the two counts leave (see scanCorrections).
  progress("  读取本地 cc 对话(只数次数)…");
  const { correctionTurns, activeDays } = scanCorrections(join(claude, "projects"));
  const profile = {
    skills: countSkills(claude),
    mcpServers: countMcpServers(readJson(join(home, ".claude.json"))),
    subagents: countItems(join(claude, "agents")),
    hooks: Object.keys(settings.hooks ?? {}).length,
    slashCommands: countItems(join(claude, "commands")),
    outputStyles: countItems(join(claude, "output-styles")),
    hasClaudeMd: hasGuidance(claude),
    hasStatusline: Boolean(settings.statusLine),
    localCcCommits, localCcRepos, localCcMonths: months.size, localCcTenureMonths: tenure,
    correctionTurns, activeDays,
  };

  // Other agent CLIs the candidate runs (Codex/Kiro) — counts-only, DISPLAY-ONLY on the
  // server (never scored), surfaced to the employer as context. Absent agents → omitted.
  const localAgents = {};
  const codex = countCodex(join(home, ".codex")); if (codex) localAgents.codex = codex;
  const kiro = countKiroCli(join(home, ".kiro")); if (kiro) localAgents.kiro = kiro;

  // 4) submit — show the candidate the EXACT payload first, so they can see for
  // themselves that only counts + github + contact (+ public git emails) leave the machine.
  const payload = {
    github, contact, job_id: jobId, profile,
    ...(commitEmails.length ? { commit_emails: commitEmails } : {}),
    ...(Object.keys(localAgents).length ? { localAgents } : {}),
  };
  console.log("本次发送的全部数据(就这些,全是计数/标志,无代码内容):");
  console.log(JSON.stringify(payload, null, 2).split("\n").map((l) => "  " + l).join("\n"));
  console.log("");

  process.stderr.write("③ 提交…\n");
  const resp = await fetch(`${API}/api/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) { console.error(`apply failed: HTTP ${resp.status}`); process.exit(1); }
  const r = await resp.json();
  console.log(`✓ 已投递 ${jobId} as @${github}`);
  console.log(`  cc 信号分: ${r.cc_score}/100 (${r.band})`);
  if (r.hint) console.log(`  ⓘ ${r.hint}`);
  console.log(`  招聘方${r.delivery?.delivered ? "已收到你的申请,会直接联系你" : (r.delivery?.reason || "投递已记录")}.`);
  console.log(`🔒 完成。上面那段 JSON 就是离开你机器的全部内容 —— 没有代码、没有文件、没有隐私。`);
}

// Run the submit flow unless imported for testing (cli.test.ts sets HIREIC_NO_MAIN).
if (!process.env.HIREIC_NO_MAIN) main().catch((e) => { console.error(e?.message || e); process.exit(1); });
