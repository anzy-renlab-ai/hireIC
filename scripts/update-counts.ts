// Pure functions for the update-counts workflow. The workflow itself reads
// the filesystem and calls these. Keeping pure means full unit-testability.

const COUNTS_OPEN = "<!-- counts -->";
const COUNTS_CLOSE = "<!-- /counts -->";

export interface Counts {
  jobs: number;
}

export function countMdFiles(filenames: string[]): number {
  return filenames.filter((f) => !f.startsWith(".") && f.endsWith(".md")).length;
}

function renderBlock(counts: Counts): string {
  return `${COUNTS_OPEN}\n**目前 ${counts.jobs} 个职位**\n${COUNTS_CLOSE}`;
}

export function rebuildReadmeCounts(readme: string, counts: Counts): string {
  const openIdx = readme.indexOf(COUNTS_OPEN);
  const closeIdx = readme.indexOf(COUNTS_CLOSE);

  // No markers at all: insert after the first heading (or at top if no heading).
  if (openIdx === -1 && closeIdx === -1) {
    const block = renderBlock(counts);
    const firstHeadingMatch = readme.match(/^#\s.+$/m);
    if (firstHeadingMatch && firstHeadingMatch.index !== undefined) {
      const after = firstHeadingMatch.index + firstHeadingMatch[0].length;
      return `${readme.slice(0, after)}\n\n${block}\n${readme.slice(after)}`;
    }
    return `${block}\n\n${readme}`;
  }

  // Malformed: open without close, or close without open.
  if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) {
    throw new Error(
      `update-counts: malformed README counter block (missing matching ${closeIdx === -1 ? COUNTS_CLOSE : COUNTS_OPEN}). Refusing to write — manual fix required.`,
    );
  }

  const before = readme.slice(0, openIdx);
  const after = readme.slice(closeIdx + COUNTS_CLOSE.length);
  return `${before}${renderBlock(counts)}${after}`;
}
