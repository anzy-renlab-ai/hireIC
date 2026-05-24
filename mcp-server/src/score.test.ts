import { describe, it, expect } from "vitest";
import { scoreCc, mergeEvidence, type CcEvidence, type AgentProfile } from "./score.js";

const base: CcEvidence = {
  ccCommits: 0, ccRepos: 0, activeMonths: 0, daysSinceLast: 0, spanDays: 0, sampleUrls: [],
};
const heavyRecentUsage: CcEvidence = {
  ccCommits: 80, ccRepos: 6, activeMonths: 7, daysSinceLast: 10, spanDays: 210, sampleUrls: [],
};

describe("scoreCc — multi-dimensional cc-signal (防君子不防小人)", () => {
  it("nothing → score 0, band none", () => {
    expect(scoreCc(base).score).toBe(0);
    expect(scoreCc(base).band).toBe("none");
  });

  it("a little recent usage, no extension → weak", () => {
    const r = scoreCc({ ...base, ccCommits: 3, ccRepos: 1, activeMonths: 1, daysSinceLast: 5 });
    expect(r.band).toBe("weak");
    expect(r.score).toBeGreaterThan(0);
  });

  it("KEY: heavy USER who doesn't extend cc tops out at moderate", () => {
    const r = scoreCc(heavyRecentUsage); // no profile
    expect(r.band).toBe("moderate");
    expect(r.score).toBeLessThan(60);
  });

  it("KEY: heavy user who BUILDS skills/MCP reaches strong", () => {
    const profile: AgentProfile = { skills: 3, mcpServers: 1, hasClaudeMd: true };
    const r = scoreCc(heavyRecentUsage, profile);
    expect(r.band).toBe("strong");
    expect(r.score).toBeGreaterThan(scoreCc(heavyRecentUsage).score);
  });

  it("self-report ALONE (no verified usage) cannot reach strong — even maxed out", () => {
    // Max every self-reported dimension: mastery + local + tenure.
    const bigProfile: AgentProfile = {
      skills: 99, mcpServers: 99, selfAuthoredMcp: true, subagents: 99, hooks: 99, slashCommands: 99,
      hasClaudeMd: true, outputStyles: 99, hasStatusline: true,
      localCcCommits: 999, localCcRepos: 99, localCcMonths: 99, localCcTenureMonths: 99,
    };
    const r = scoreCc(base, bigProfile); // zero verified public footprint
    expect(r.band).not.toBe("strong");
    expect(r.score).toBeLessThan(65); // strong requires VERIFIED public usage
  });

  it("RECENCY: same footprint, stale (>1yr) scores far lower than recent", () => {
    const recent = scoreCc({ ...heavyRecentUsage, daysSinceLast: 10 });
    const stale = scoreCc({ ...heavyRecentUsage, daysSinceLast: 400 });
    expect(stale.score).toBeLessThan(recent.score * 0.6);
  });

  it("CADENCE: spread across months beats one burst", () => {
    const burst = scoreCc({ ...base, ccCommits: 24, ccRepos: 2, activeMonths: 1, daysSinceLast: 5 });
    const sustained = scoreCc({ ...base, ccCommits: 24, ccRepos: 2, activeMonths: 6, daysSinceLast: 5 });
    expect(sustained.score).toBeGreaterThan(burst.score);
  });

  it("BREADTH: more repos beats one repo", () => {
    const narrow = scoreCc({ ...base, ccCommits: 20, ccRepos: 1, activeMonths: 3, daysSinceLast: 5 });
    const broad = scoreCc({ ...base, ccCommits: 20, ccRepos: 5, activeMonths: 3, daysSinceLast: 5 });
    expect(broad.score).toBeGreaterThan(narrow.score);
  });

  it("score capped at 100; breakdown + honest note present", () => {
    const r = scoreCc(
      { ...base, ccCommits: 9999, ccRepos: 999, activeMonths: 99, daysSinceLast: 0 },
      { skills: 99, mcpServers: 99, selfAuthoredMcp: true },
    );
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.breakdown.usage).toBeGreaterThan(0);
    expect(r.breakdown.mastery).toBeGreaterThan(0);
    expect(r.note).toMatch(/信号|防君子|隐私|核/);
  });

  it("no profile → profile is null in result", () => {
    expect(scoreCc(heavyRecentUsage).profile).toBeNull();
  });
});

describe("scoreCc — private / non-GitHub work via agent local self-report", () => {
  it("a private-repo dev (no public footprint) gets real credit but cannot self-report to strong", () => {
    const profile: AgentProfile = { skills: 8, mcpServers: 2, selfAuthoredMcp: true, localCcCommits: 300, localCcRepos: 10, localCcMonths: 9 };
    const r = scoreCc(base, profile); // base = zero public evidence
    expect(r.score).toBeGreaterThan(scoreCc(base).score); // local work counts
    expect(r.band).not.toBe("strong"); // unverified self-report capped below strong
    expect(r.band).toBe("moderate");
    expect(r.breakdown.localUsage).toBeGreaterThan(0);
  });

  it("local self-report lifts the same public footprint a bit", () => {
    const noLocal = scoreCc(heavyRecentUsage);
    const withLocal = scoreCc(heavyRecentUsage, { localCcCommits: 50, localCcRepos: 4, localCcMonths: 6 });
    expect(withLocal.score).toBeGreaterThan(noLocal.score);
  });
});

describe("mergeEvidence — multiple GitHub accounts", () => {
  it("sums volume/breadth, takes most-recent recency, max months", () => {
    const a: CcEvidence = { ccCommits: 30, ccRepos: 2, activeMonths: 3, daysSinceLast: 40, spanDays: 60, sampleUrls: ["x"] };
    const b: CcEvidence = { ccCommits: 20, ccRepos: 3, activeMonths: 2, daysSinceLast: 5, spanDays: 30, sampleUrls: ["y"] };
    const m = mergeEvidence([a, b]);
    expect(m.ccCommits).toBe(50);
    expect(m.ccRepos).toBe(5);
    expect(m.activeMonths).toBe(3);
    expect(m.daysSinceLast).toBe(5);
  });
  it("single-element passthrough", () => {
    const a: CcEvidence = { ccCommits: 1, ccRepos: 1, activeMonths: 1, daysSinceLast: 1, spanDays: 1, sampleUrls: [] };
    expect(mergeEvidence([a])).toBe(a);
  });
});
