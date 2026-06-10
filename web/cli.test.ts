// Tests for cli.mjs self-introspection counters. The candidate's cc footprint is
// counted on THEIR machine, so a miscount here silently under-credits real users.
// Regression coverage for the bugs reported by heavy users:
//   • symlinked skill dirs counted as 0 (isDirectory() is false on a symlink Dirent)
//   • plugin/marketplace skills never scanned
//   • subagents/slashCommands/outputStyles never populated
//   • guidance kept in a rules/ folder (not CLAUDE.md) read as "no guidance"
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Importing must NOT run the submit flow.
process.env.HIREIC_NO_MAIN = "1";
const { countSkills, countItems, hasGuidance, scanCorrections, findRepos, countMcpServers, countCodex, countKiroCli } = await import("./cli.mjs");

let root: string;
const skill = (dir: string) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "SKILL.md"), "x"); };

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hireic-claude-"));
  const skills = join(root, "skills");
  mkdirSync(skills, { recursive: true });
  // two normal skills
  skill(join(skills, "alpha"));
  skill(join(skills, "beta"));
  // a SYMLINKED skill dir — the reported bug: must still count
  const realTarget = join(root, "external", "gamma");
  skill(realTarget);
  symlinkSync(realTarget, join(skills, "gamma"));
  // noise that must NOT count
  mkdirSync(join(skills, "not-a-skill")); // dir without SKILL.md
  writeFileSync(join(skills, "README.md"), "x"); // stray file

  // plugin/marketplace skills, with version-dir + mirror duplicates
  const pv = (v: string, name: string) => skill(join(root, "plugins", "cache", "mk", "p", v, "skills", name));
  pv("1.0.0", "delta");
  pv("1.1.0", "delta"); // same skill, newer version — dedupe to one
  pv("1.1.0", "epsilon");
  skill(join(root, "plugins", "mk", ".cursor", "skills", "mirror")); // hidden mirror — skip
  skill(join(root, "plugins", "mk", ".windsurf", "skills", "mirror2")); // hidden mirror — skip

  // commands / agents as flat .md files (countDirs would wrongly return 0)
  const cmds = join(root, "commands"); mkdirSync(cmds);
  writeFileSync(join(cmds, "deploy.md"), "x");
  writeFileSync(join(cmds, "ship.md"), "x");
  symlinkSync(join(cmds, "deploy.md"), join(cmds, "release.md")); // symlinked command

  const agents = join(root, "agents"); mkdirSync(agents);
  writeFileSync(join(agents, "reviewer.md"), "x");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("countSkills", () => {
  it("counts normal + symlinked user skills and deduped plugin skills, skips noise/mirrors", () => {
    // alpha, beta, gamma(symlink), delta, epsilon = 5
    expect(countSkills(root)).toBe(5);
  });
  it("returns 0 on a missing .claude dir without throwing", () => {
    expect(countSkills(join(root, "nope"))).toBe(0);
  });
});

describe("countItems", () => {
  it("counts flat .md files and symlinks (deduped by name)", () => {
    // deploy, ship, release = 3
    expect(countItems(join(root, "commands"))).toBe(3);
    expect(countItems(join(root, "agents"))).toBe(1);
  });
  it("returns 0 on a missing dir", () => {
    expect(countItems(join(root, "nope"))).toBe(0);
  });
});

describe("scanCorrections", () => {
  // Build a transcript dir: projects/<proj>/<session>.jsonl, one JSON per line.
  const NOW = Date.parse("2026-06-04T00:00:00Z");
  const day = (n: number) => new Date(NOW - n * 86400000).toISOString();
  function writeSession(projects: string, proj: string, lines: object[]) {
    const dir = join(projects, proj);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  }
  const asst = (ts: string) => ({ type: "assistant", timestamp: ts, message: { role: "assistant", content: "ok" } });
  const human = (ts: string, text: string) => ({ type: "user", timestamp: ts, message: { role: "user", content: text } });

  it("counts correction turns that follow an assistant turn, and distinct active days", () => {
    const root = mkdtempSync(join(tmpdir(), "hireic-tx-"));
    const projects = join(root, "projects");
    writeSession(projects, "p1", [
      human(day(1), "build me a parser"),       // not a correction (no prior assistant)
      asst(day(1)),
      human(day(1), "不对，这里回滚一下"),        // correction (zh) — day1
      asst(day(1)),
      human(day(1), "this is wrong, revert"),    // correction (en) — same day1
      asst(day(0)),
      human(day(0), "looks good, ship it"),      // not a correction — day0
    ]);
    writeSession(projects, "p2", [
      asst(day(2)),
      human(day(2), "you broke the test, undo"), // correction — day2
    ]);
    const r = scanCorrections(projects, NOW);
    expect(r.correctionTurns).toBe(3);
    expect(r.activeDays).toBe(3); // day0, day1, day2
  });

  it("ignores tool-results, meta turns, system-injected (<...>) and out-of-window turns", () => {
    const root = mkdtempSync(join(tmpdir(), "hireic-tx2-"));
    const projects = join(root, "projects");
    writeSession(projects, "p", [
      asst(day(1)),
      { type: "user", timestamp: day(1), isMeta: true, message: { role: "user", content: "不对" } }, // meta — skip
      { type: "user", timestamp: day(1), message: { role: "user", content: "<local-command-caveat>不对</local-command-caveat>" } }, // injected — skip
      { type: "user", timestamp: day(1), message: { role: "user", content: [{ type: "tool_result", content: "wrong" }] } }, // tool result — skip
      asst(day(400)),
      human(day(400), "不对 revert"), // older than 90d window — skip
    ]);
    const r = scanCorrections(projects, NOW);
    expect(r.correctionTurns).toBe(0);
    expect(r.activeDays).toBe(0);
  });

  it("returns zeros on a missing projects dir without throwing", () => {
    expect(scanCorrections(join(tmpdir(), "nope-hireic"), NOW)).toEqual({ correctionTurns: 0, activeDays: 0 });
  });
});

describe("findRepos", () => {
  it("finds a git repo reached through a symlinked directory (the Dirent.isDirectory() bug class)", () => {
    const base = mkdtempSync(join(tmpdir(), "hireic-repos-"));
    mkdirSync(join(base, "real", "proj", ".git"), { recursive: true });
    const scanRoot = join(base, "scan"); mkdirSync(scanRoot, { recursive: true });
    symlinkSync(join(base, "real"), join(scanRoot, "link")); // symlinked dir-of-projects
    const out: string[] = [];
    findRepos(scanRoot, 0, out);
    expect(out.length).toBe(1);
    expect(realpathSync(out[0])).toBe(realpathSync(join(base, "real", "proj")));
    rmSync(base, { recursive: true, force: true });
  });

  it("terminates on a symlink cycle and does not duplicate the repo", () => {
    const base = mkdtempSync(join(tmpdir(), "hireic-cycle-"));
    mkdirSync(join(base, "a", "repo", ".git"), { recursive: true });
    symlinkSync(base, join(base, "a", "loop")); // cycle back to root
    const out: string[] = [];
    expect(() => findRepos(base, 0, out)).not.toThrow();
    const real = realpathSync(join(base, "a", "repo"));
    expect(out.filter((d) => realpathSync(d) === real)).toHaveLength(1);
    rmSync(base, { recursive: true, force: true });
  });
});

describe("countMcpServers", () => {
  it("unions global + project-scoped servers, deduped by name", () => {
    const cj = {
      mcpServers: { a: {}, b: {} },
      projects: { "/x": { mcpServers: { b: {}, c: {} } }, "/y": { mcpServers: { d: {} } } },
    };
    expect(countMcpServers(cj)).toBe(4); // a, b, c, d
  });
  it("handles missing / null fields without throwing", () => {
    expect(countMcpServers({})).toBe(0);
    expect(countMcpServers(null)).toBe(0);
  });
});

describe("countCodex (display-only Codex CLI footprint)", () => {
  it("counts rollout sessions + distinct days from FILENAMES (no content read) + [projects.] entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireic-codex-"));
    writeFileSync(join(dir, "config.toml"), `model = "x"\n[projects."/a"]\ntrust_level = "trusted"\n[projects."/b"]\ntrust = "t"\n[mcp_servers.foo]\n`);
    const s = join(dir, "sessions", "2026", "03", "16"); mkdirSync(s, { recursive: true });
    writeFileSync(join(s, "rollout-2026-03-16T09-00-00-uuid.jsonl"), "{}");
    writeFileSync(join(s, "rollout-2026-03-16T10-00-00-uuid.jsonl"), "{}"); // same day
    const s2 = join(dir, "sessions", "2026", "04", "01"); mkdirSync(s2, { recursive: true });
    writeFileSync(join(s2, "rollout-2026-04-01T08-00-00-uuid.jsonl"), "{}");
    const c = countCodex(dir);
    expect(c.sessions).toBe(3);
    expect(c.activeDays).toBe(2); // 2026-03-16, 2026-04-01
    expect(c.projects).toBe(2);
    expect(c.tenureMonths).toBeGreaterThanOrEqual(0);
    rmSync(dir, { recursive: true, force: true });
  });
  it("returns null when ~/.codex is absent", () => {
    expect(countCodex(join(tmpdir(), "nope-codex-xyz"))).toBeNull();
  });
});

describe("countKiroCli (display-only Kiro CLI footprint; IDE-shared dir)", () => {
  it("counts CLI sessions, steering docs, mcp servers; ignores transcripts/.lock/.example", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireic-kiro-"));
    const cli = join(dir, "sessions", "cli"); mkdirSync(cli, { recursive: true });
    writeFileSync(join(cli, "a.json"), "{}");
    writeFileSync(join(cli, "b.json"), "{}");
    writeFileSync(join(cli, "a.jsonl"), "x");   // transcript, not a session
    writeFileSync(join(cli, "a.lock"), "x");    // lock, not a session
    const steering = join(dir, "steering"); mkdirSync(steering);
    writeFileSync(join(steering, "product.md"), "x");
    const settings = join(dir, "settings"); mkdirSync(settings);
    writeFileSync(join(settings, "mcp.json"), JSON.stringify({ mcpServers: { x: {}, y: {} } }));
    mkdirSync(join(dir, "agents"));
    writeFileSync(join(dir, "agents", "agent_config.json.example"), "{}"); // install default — never counts
    const k = countKiroCli(dir);
    expect(k.cliSessions).toBe(2);
    expect(k.steeringDocs).toBe(1);
    expect(k.mcpServers).toBe(2);
    rmSync(dir, { recursive: true, force: true });
  });
  it("returns null for an IDE-only install (no sessions/cli) — install ≠ CLI usage", () => {
    const dir = mkdtempSync(join(tmpdir(), "hireic-kiro-ide-"));
    writeFileSync(join(dir, "argv.json"), "{}");
    mkdirSync(join(dir, "extensions"));
    mkdirSync(join(dir, "steering")); // exists empty at install
    expect(countKiroCli(dir)).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("hasGuidance", () => {
  it("true when a rules/ folder holds markdown even with no CLAUDE.md", () => {
    const r = mkdtempSync(join(tmpdir(), "hireic-rules-"));
    mkdirSync(join(r, "rules"));
    writeFileSync(join(r, "rules", "style.md"), "x");
    expect(hasGuidance(r)).toBe(true);
    rmSync(r, { recursive: true, force: true });
  });
  it("true when CLAUDE.md exists", () => {
    const r = mkdtempSync(join(tmpdir(), "hireic-md-"));
    writeFileSync(join(r, "CLAUDE.md"), "x");
    expect(hasGuidance(r)).toBe(true);
    rmSync(r, { recursive: true, force: true });
  });
  it("false when neither exists", () => {
    const r = mkdtempSync(join(tmpdir(), "hireic-none-"));
    expect(hasGuidance(r)).toBe(false);
    rmSync(r, { recursive: true, force: true });
  });
});
