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

describe("scoreCc — recalibrated: real output dominates gameable configs", () => {
  // The flat-cap bug: verified volume capped at ~21 commits and breadth at 3 repos,
  // so a prolific shipper scored identically to a light user. A curve must keep
  // separating real output across the FULL range, with no early plateau.
  it("OUTPUT SEPARATION (verified): more real commits keep scoring higher — no early plateau", () => {
    const s5 = scoreCc({ ...base, ccCommits: 5, ccRepos: 1, activeMonths: 1, daysSinceLast: 5 });
    const s50 = scoreCc({ ...base, ccCommits: 50, ccRepos: 5, activeMonths: 6, daysSinceLast: 5 });
    const s500 = scoreCc({ ...base, ccCommits: 500, ccRepos: 15, activeMonths: 12, daysSinceLast: 5 });
    expect(s50.score).toBeGreaterThan(s5.score + 8);
    expect(s500.score).toBeGreaterThan(s50.score + 8); // OLD code: s500 === s50 (both capped) → this is the bug
  });

  // 5330 real commits / 59 repos must outscore a modest local footprint, not tie it.
  it("OUTPUT SEPARATION (local self-report): prolific local work beats a modest local footprint", () => {
    const big = scoreCc(base, { localCcCommits: 5330, localCcRepos: 59, localCcMonths: 14 });
    const small = scoreCc(base, { localCcCommits: 50, localCcRepos: 5, localCcMonths: 6 });
    expect(big.score).toBeGreaterThan(small.score + 5); // OLD code: both === 16.5 (capped) → ties
  });

  // Cheapest-to-fake configs (statusline, CLAUDE.md, a lone hook) must barely move
  // the needle; actually building on cc (self-authored MCP, many skills) is worth more.
  it("GAMEABLE CONFIGS DEMOTED: one-line fakes contribute far less than real building", () => {
    const cheap = scoreCc(base, { hasStatusline: true, hasClaudeMd: true, hooks: 1 }).breakdown.mastery;
    const built = scoreCc(base, { selfAuthoredMcp: true, skills: 5 }).breakdown.mastery;
    expect(cheap).toBeLessThanOrEqual(3);
    expect(built).toBeGreaterThan(cheap * 3);
  });

  // The real regression we are fixing: a dev with 5330 real Claude-signed commits
  // across 59 repos scored 27/weak. Their footprint must land at least moderate.
  it("REGRESSION (wencheng): heavy real output (mostly local) lands at least moderate, not weak", () => {
    const r = scoreCc(
      { ...base, ccCommits: 40, ccRepos: 3, activeMonths: 4, daysSinceLast: 10 },
      { localCcCommits: 5330, localCcRepos: 59, localCcMonths: 14, localCcTenureMonths: 16, skills: 2, hooks: 1 },
    );
    expect(r.band).not.toBe("weak");
    expect(r.score).toBeGreaterThanOrEqual(30);
  });

  // The strong/moderate boundary gates the employer-outreach email — it must NOT
  // turn on a single farmable commit. The proof ramp makes crossing it continuous.
  it("NO CLIFF: the verified-proof ramp is smooth, not a 25-point jump at one commit", () => {
    const prof: AgentProfile = {
      skills: 20, mcpServers: 5, selfAuthoredMcp: true, subagents: 8, hooks: 10, slashCommands: 10,
      hasClaudeMd: true, outputStyles: 5, hasStatusline: true,
      localCcCommits: 9999, localCcRepos: 80, localCcMonths: 20, localCcTenureMonths: 24,
    };
    const at23 = scoreCc({ ...base, ccCommits: 23, ccRepos: 4, activeMonths: 3, daysSinceLast: 5 }, prof).score;
    const at27 = scoreCc({ ...base, ccCommits: 27, ccRepos: 4, activeMonths: 3, daysSinceLast: 5 }, prof).score;
    expect(at27 - at23).toBeLessThan(10); // OLD hard gate jumped ~24 points across the 25-commit line
  });

  // scoreCc is an exported primitive — it must fail CLOSED (never invent a strong
  // score) on garbage input, and a malformed density must not be able to inflate.
  it("FAIL-SAFE: non-finite or malformed evidence never yields a bogus strong score", () => {
    const nan = scoreCc({ ...base, ccCommits: Number.NaN });
    expect(Number.isFinite(nan.score)).toBe(true);
    expect(nan.band).not.toBe("strong");
    const clamped = { ...base, ccCommits: 50, ccRepos: 5, activeMonths: 5, daysSinceLast: 5 };
    expect(scoreCc({ ...clamped, density: 999 }).score).toBe(scoreCc({ ...clamped, density: 1 }).score);
  });

  // Anti-gaming must survive the recalibration: maxed cheap self-report + a token
  // verified footprint still cannot buy "strong".
  it("ANTI-GAMING PRESERVED: maxed configs + huge self-claimed local + token verified stays sub-strong", () => {
    const gamer = scoreCc(
      { ...base, ccCommits: 2, ccRepos: 1, activeMonths: 1, daysSinceLast: 5 },
      {
        skills: 20, mcpServers: 5, selfAuthoredMcp: true, subagents: 8, hooks: 10, slashCommands: 10,
        hasClaudeMd: true, outputStyles: 5, hasStatusline: true,
        localCcCommits: 9999, localCcRepos: 80, localCcMonths: 20, localCcTenureMonths: 24,
      },
    );
    expect(gamer.band).not.toBe("strong");
    expect(gamer.score).toBeLessThan(60);
  });
});

describe("scoreCc — critique dimension (catching cc's mistakes / day)", () => {
  it("a critique rate adds a small bonus over the same profile without it", () => {
    const p: AgentProfile = { skills: 1 };
    const withCritique = scoreCc(heavyRecentUsage, { ...p, correctionTurns: 40, activeDays: 20 }); // 2/day
    const without = scoreCc(heavyRecentUsage, p);
    expect(withCritique.score).toBeGreaterThan(without.score);
    expect(withCritique.breakdown.critique).toBeGreaterThan(0);
  });

  it("rate, not raw count, drives it: same corrections over more days scores lower", () => {
    const dense = scoreCc(heavyRecentUsage, { correctionTurns: 30, activeDays: 10 }).breakdown.critique; // 3/day
    const sparse = scoreCc(heavyRecentUsage, { correctionTurns: 30, activeDays: 90 }).breakdown.critique; // 0.33/day
    expect(dense).toBeGreaterThan(sparse);
  });

  it("is capped (a spammer typing 'wrong' all day can't run it away)", () => {
    const insane = scoreCc(heavyRecentUsage, { correctionTurns: 100000, activeDays: 1 }).breakdown.critique;
    expect(insane).toBeLessThanOrEqual(5);
  });

  it("missing / zero days → 0, no NaN", () => {
    expect(scoreCc(heavyRecentUsage, { skills: 1 }).breakdown.critique).toBe(0);
    expect(scoreCc(heavyRecentUsage, { correctionTurns: 5, activeDays: 0 }).breakdown.critique).toBe(0);
  });

  it("critique alone (no verified usage) still cannot reach strong", () => {
    const r = scoreCc(base, { correctionTurns: 99999, activeDays: 1 });
    expect(r.band).not.toBe("strong");
    expect(r.score).toBeLessThan(60);
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
