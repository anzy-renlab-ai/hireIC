// Generate canonical markdown files from validated payloads.
// Produces YAML frontmatter that round-trips with gray-matter, and a body
// note explaining the file is auto-generated. Filenames are pinyin-slugged
// so CJK titles still produce ASCII-friendly paths.

import { stringify as yamlStringify } from "yaml";
import { pinyin } from "pinyin-pro";
import type { JobPayload } from "./issue-parser.js";

const MAX_FILENAME_LEN = 80;

function slugify(input: string): string {
  // Convert CJK chars to pinyin (no tones, lowercase). ASCII passes through.
  const py = pinyin(input, { toneType: "none", type: "string", nonZh: "consecutive" });
  return py
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function ymPart(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function jobFilename(payload: JobPayload, now: Date = new Date()): string {
  const companySlug = slugify(payload.company);
  const titleSource = payload.role_title_en ?? payload.role_title_zh;
  const titleSlug = slugify(titleSource);
  const yyyy_mm = ymPart(now);
  const combined = `${companySlug}-${titleSlug}-${yyyy_mm}`;
  const truncated = combined.length > MAX_FILENAME_LEN ? combined.slice(0, MAX_FILENAME_LEN) : combined;
  return `${truncated}.md`;
}

function buildFrontmatter(data: Record<string, unknown>): string {
  // yaml lib quotes values with special chars automatically and preserves order.
  const body = yamlStringify(data, {
    lineWidth: 0, // disable line wrapping
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
  return `---\n${body}---\n`;
}

const AUTO_GENERATED_NOTE_JOB = `> 这份职位由 hireIC 自动生成. 字段定义见 [SCHEMA.md](../SCHEMA.md). 投递走 \`apply_url\`, 不要在此 repo issue 投简历.`;

export function generateJobMarkdown(payload: JobPayload): string {
  const data: Record<string, unknown> = {
    schema_version: payload.schema_version,
    company: payload.company,
    role_title_zh: payload.role_title_zh,
  };
  if (payload.role_title_en) data.role_title_en = payload.role_title_en;
  data.cc_required = payload.cc_required;
  data.apply_url = payload.apply_url;
  data.contact_value = payload.contact_value;

  const optionalKeys: Array<keyof JobPayload> = [
    "salary_range_rmb",
    "employment_type",
    "location",
    "remote_policy",
    "open_until",
    "description_zh",
    "description_en",
  ];
  for (const k of optionalKeys) {
    const v = payload[k];
    if (v !== undefined && v !== "") data[k] = v;
  }
  data.status = payload.status ?? "open";

  return `${buildFrontmatter(data)}\n${AUTO_GENERATED_NOTE_JOB}\n`;
}
