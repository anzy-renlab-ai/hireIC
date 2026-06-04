// Tests for cli.mjs self-introspection counters. The candidate's cc footprint is
// counted on THEIR machine, so a miscount here silently under-credits real users.
// Regression coverage for the bugs reported by heavy users:
//   • symlinked skill dirs counted as 0 (isDirectory() is false on a symlink Dirent)
//   • plugin/marketplace skills never scanned
//   • subagents/slashCommands/outputStyles never populated
//   • guidance kept in a rules/ folder (not CLAUDE.md) read as "no guidance"
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Importing must NOT run the submit flow.
process.env.HIREIC_NO_MAIN = "1";
const { countSkills, countItems, hasGuidance, scanCorrections } = await import("./cli.mjs");

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
