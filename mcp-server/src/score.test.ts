import { describe, it, expect } from "vitest";
import { scoreCc, type CcEvidence } from "./score.js";

const base: CcEvidence = { ccCommits: 0, ccRepos: 0, spanDays: 0, sampleUrls: [] };

describe("scoreCc — cc-signal from real public GitHub evidence (防君子不防小人)", () => {
  it("no cc-coauthored activity → score 0, band none", () => {
    const r = scoreCc(base);
    expect(r.score).toBe(0);
    expect(r.band).toBe("none");
  });

  it("a little activity → weak band, low score", () => {
    const r = scoreCc({ ...base, ccCommits: 2, ccRepos: 1, spanDays: 5 });
    expect(r.band).toBe("weak");
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(40);
  });

  it("sustained cross-repo activity → strong band, high score", () => {
    const r = scoreCc({ ...base, ccCommits: 80, ccRepos: 6, spanDays: 200, sampleUrls: ["https://github.com/x/y/commit/abc"] });
    expect(r.band).toBe("strong");
    expect(r.score).toBeGreaterThanOrEqual(70);
  });

  it("score is capped at 100", () => {
    const r = scoreCc({ ...base, ccCommits: 9999, ccRepos: 999, spanDays: 9999 });
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("more activity scores higher (monotonic)", () => {
    const lo = scoreCc({ ...base, ccCommits: 5, ccRepos: 1, spanDays: 10 });
    const hi = scoreCc({ ...base, ccCommits: 40, ccRepos: 4, spanDays: 120 });
    expect(hi.score).toBeGreaterThan(lo.score);
  });

  it("breadth (more repos) beats the same commits in one repo", () => {
    const narrow = scoreCc({ ...base, ccCommits: 20, ccRepos: 1, spanDays: 30 });
    const broad = scoreCc({ ...base, ccCommits: 20, ccRepos: 5, spanDays: 30 });
    expect(broad.score).toBeGreaterThan(narrow.score);
  });

  it("passes the evidence through + carries an honest caveat note", () => {
    const ev = { ccCommits: 3, ccRepos: 2, spanDays: 14, sampleUrls: ["https://github.com/a/b/commit/1"] };
    const r = scoreCc(ev);
    expect(r.evidence).toEqual(ev);
    expect(r.note).toMatch(/信号|signal|防君子|verify|核/i);
  });
});
