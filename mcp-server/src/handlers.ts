import matter from "gray-matter";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Schemas live at the repo root. In a published package, they'd be bundled into dist/.
// For now we read them from disk relative to this file (works in tests + dev).
const cvSchema = JSON.parse(
  readFileSync(resolve(__dirname, "../../schemas/agent-cv.schema.json"), "utf-8"),
);
const jobsSchema = JSON.parse(
  readFileSync(resolve(__dirname, "../../schemas/agent-jobs.schema.json"), "utf-8"),
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateCv: ValidateFunction = ajv.compile(cvSchema);
const validateJob: ValidateFunction = ajv.compile(jobsSchema);

export interface RawFile {
  name: string;
  content: string;
}

export interface FetchSuccess {
  status: 200;
  body: RawFile[];
}

export interface FetchFailure {
  status: 401 | 404 | 429 | 500;
  body: null;
}

export type FetchResult = FetchSuccess | FetchFailure;

export type Fetcher = (path: string) => Promise<FetchResult>;

export type ErrorKind = "not_found" | "rate_limited" | "unauthorized" | "network" | "parse" | "schema_invalid" | "unknown";

export interface HandlerError {
  kind: ErrorKind;
  file?: string;
  message: string;
}

export interface AgentCv {
  schema_version: "0.1";
  github_username: string;
  cc_experience_months: number;
  evidence_url: string;
  contact_mode: "public" | "hidden";
  contact_value: string;
  bio_zh?: string;
  bio_en?: string;
  looking_for?: "full-time" | "contract" | "open-to-talk" | "not-looking";
  salary_range_rmb?: string;
  location?: string;
  referrer_github?: string;
  referrer_evidence_pr_url?: string;
  agent_stack?: string;
  available_from?: string;
}

export interface AgentJob {
  schema_version: "0.1";
  company: string;
  role_title_zh: string;
  role_title_en?: string;
  cc_required: boolean;
  apply_url: string;
  contact_value: string;
  salary_range_rmb?: string;
  employment_type?: "full-time" | "contract" | "internship" | "consulting";
  location?: string;
  remote_policy?: "onsite" | "remote-friendly" | "remote-only";
  open_until?: string;
  description_zh?: string;
  description_en?: string;
  status?: "open" | "closed";
}

export interface ListCandidatesArgs {
  owner: string;
  repo: string;
  fetcher: Fetcher;
}

export interface ListCandidatesResult {
  candidates: AgentCv[];
  errors: HandlerError[];
}

export interface ListJobsArgs {
  owner: string;
  repo: string;
  fetcher: Fetcher;
  includeClosed?: boolean;
}

export interface ListJobsResult {
  jobs: AgentJob[];
  errors: HandlerError[];
}

function isMarkdownFile(name: string): boolean {
  return name.endsWith(".md") && !name.startsWith(".");
}

// Prompt-injection hardening: candidate/job free-text is served verbatim to a
// recruiter's LLM agent. Strip characters that have no legitimate use in this
// data but are used to smuggle hidden instructions past human review —
// C0 control chars (except \t \n \r), DEL, zero-width, bidi overrides, BOM.
// Visible content is preserved; this only removes invisible/control codepoints.
// eslint-disable-next-line no-control-regex
const SMUGGLING_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

function sanitizeFreeText(value: string): string {
  return value.replace(SMUGGLING_CHARS_RE, "");
}

// Shallow-sanitize every string field of a served record. Schema-constrained
// fields (usernames, URLs, enums) contain no control chars so this is a no-op
// for them; free-text fields get cleaned.
function sanitizeRecord<T extends Record<string, unknown>>(data: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = typeof v === "string" ? sanitizeFreeText(v) : v;
  }
  return out as T;
}

function parseFrontmatter(
  file: RawFile,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: HandlerError } {
  try {
    const parsed = matter(file.content);
    if (!parsed.data || typeof parsed.data !== "object" || Object.keys(parsed.data).length === 0) {
      return {
        ok: false,
        error: { kind: "parse", file: file.name, message: "no frontmatter detected" },
      };
    }
    return { ok: true, data: parsed.data as Record<string, unknown> };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "parse",
        file: file.name,
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

async function safeFetch(
  fetcher: Fetcher,
  path: string,
): Promise<{ ok: true; files: RawFile[] } | { ok: false; error: HandlerError }> {
  try {
    const result = await fetcher(path);
    if (result.status === 200) {
      return { ok: true, files: result.body };
    }
    if (result.status === 401) {
      return { ok: false, error: { kind: "unauthorized", message: "GitHub rejected the token. Check --token / HIREIC_TOKEN (PAT needs `public_repo` scope)." } };
    }
    if (result.status === 404) {
      return { ok: false, error: { kind: "not_found", message: `${path} not found` } };
    }
    if (result.status === 429) {
      return { ok: false, error: { kind: "rate_limited", message: "GitHub rate limit hit" } };
    }
    return { ok: false, error: { kind: "unknown", message: `unexpected status ${result.status}` } };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "network",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export async function listCandidates(args: ListCandidatesArgs): Promise<ListCandidatesResult> {
  const fetched = await safeFetch(args.fetcher, "candidates");
  if (!fetched.ok) return { candidates: [], errors: [fetched.error] };

  const candidates: AgentCv[] = [];
  const errors: HandlerError[] = [];

  for (const file of fetched.files) {
    if (!isMarkdownFile(file.name)) continue;

    const parsed = parseFrontmatter(file);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }

    if (!validateCv(parsed.data)) {
      errors.push({
        kind: "schema_invalid",
        file: file.name,
        message: ajv.errorsText(validateCv.errors),
      });
      continue;
    }
    candidates.push(sanitizeRecord(parsed.data) as unknown as AgentCv);
  }

  return { candidates, errors };
}

export async function listJobs(args: ListJobsArgs): Promise<ListJobsResult> {
  const fetched = await safeFetch(args.fetcher, "jobs");
  if (!fetched.ok) return { jobs: [], errors: [fetched.error] };

  const jobs: AgentJob[] = [];
  const errors: HandlerError[] = [];

  for (const file of fetched.files) {
    if (!isMarkdownFile(file.name)) continue;

    const parsed = parseFrontmatter(file);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }

    if (!validateJob(parsed.data)) {
      errors.push({
        kind: "schema_invalid",
        file: file.name,
        message: ajv.errorsText(validateJob.errors),
      });
      continue;
    }

    const job = sanitizeRecord(parsed.data) as unknown as AgentJob;
    if (!args.includeClosed && job.status === "closed") continue;
    jobs.push(job);
  }

  return { jobs, errors };
}
