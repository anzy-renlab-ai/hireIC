import { describe, it, expect } from "vitest";
import { rebuildReadmeCounts, countMdFiles } from "../../scripts/update-counts.js";

describe("countMdFiles", () => {
  it("returns 0 for empty array", () => {
    expect(countMdFiles([])).toBe(0);
  });

  it("counts only *.md files", () => {
    expect(countMdFiles(["a.md", "b.md", ".gitkeep", "README.txt"])).toBe(2);
  });

  it("ignores dotfiles (.gitkeep, .DS_Store) even if .md-named", () => {
    expect(countMdFiles([".hidden.md", "alice.md"])).toBe(1);
  });
});

describe("rebuildReadmeCounts", () => {
  it("replaces the entire <!-- counts --> block with new counts", () => {
    const input = `# hireIC

intro line

<!-- counts -->
**目前 0 个职位 · 0 个候选人**
<!-- /counts -->

rest of readme.
`;
    const result = rebuildReadmeCounts(input, { jobs: 3 });
    expect(result).toContain("**目前 3 个职位**");
    expect(result).toContain("<!-- counts -->");
    expect(result).toContain("<!-- /counts -->");
    expect(result).not.toContain("0 个职位");
    // Surrounding content is preserved
    expect(result).toContain("# hireIC");
    expect(result).toContain("rest of readme.");
  });

  it("handles a block with extra whitespace/different content between markers", () => {
    const input = `before

<!-- counts -->
some old garbage
multiple lines
that should be replaced
<!-- /counts -->

after`;
    const result = rebuildReadmeCounts(input, { jobs: 1 });
    expect(result).toContain("**目前 1 个职位**");
    expect(result).not.toContain("garbage");
    expect(result).toContain("before");
    expect(result).toContain("after");
  });

  it("re-creates the block at top of body if markers are missing", () => {
    const input = `# hireIC

no markers here yet
`;
    const result = rebuildReadmeCounts(input, { jobs: 5 });
    expect(result).toContain("<!-- counts -->");
    expect(result).toContain("<!-- /counts -->");
    expect(result).toContain("**目前 5 个职位**");
    expect(result.indexOf("<!-- counts -->")).toBeGreaterThan(result.indexOf("# hireIC"));
  });

  it("does not push or run anything — pure function returns new content only", () => {
    const input = "x";
    const result = rebuildReadmeCounts(input, { jobs: 0 });
    expect(typeof result).toBe("string");
  });

  it("is idempotent: running twice gives the same output", () => {
    const input = `<!-- counts -->
old
<!-- /counts -->`;
    const once = rebuildReadmeCounts(input, { jobs: 4 });
    const twice = rebuildReadmeCounts(once, { jobs: 4 });
    expect(twice).toBe(once);
  });

  it("fails loud (throws) if README has malformed markers (open without close)", () => {
    const input = `<!-- counts -->
content but no closing tag
`;
    expect(() => rebuildReadmeCounts(input, { jobs: 1 })).toThrow(/malformed|missing.*\/counts/i);
  });
});
