// GitHub Issue Form parser + payload validator + PII detector.
// Used by .github/workflows/validate.yml (via tsx) to validate submissions
// and by .github/workflows/convert-to-pr.yml to generate the final MD file.

const SECTION_RE = /^###\s+(.+?)\s*$/gm;
const NO_RESPONSE_VALUES = new Set(["_No response_", "(不填)", ""]);

export function parseIssueBody(body: string): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  const matches = [...body.matchAll(SECTION_RE)];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    if (!current) continue;
    const heading = current[1]?.trim();
    if (!heading) continue;
    const start = current.index! + current[0].length;
    const end = next ? next.index! : body.length;
    const raw = body.slice(start, end).trim();
    if (NO_RESPONSE_VALUES.has(raw)) {
      result[heading] = undefined;
      continue;
    }
    result[heading] = raw;
  }
  return result;
}

export type FieldErrorKind = "missing" | "type" | "policy" | "value";

export interface FieldError {
  field: string;
  kind: FieldErrorKind;
  message: string;
  example?: string;
}

export type ValidatePayloadResult<T> =
  | { ok: true; payload: T }
  | { ok: false; errors: FieldError[] };

export interface JobPayload {
  schema_version: "0.1";
  company: string;
  role_title_zh: string;
  role_title_en?: string;
  cc_required: true;
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

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const JOB_FIELD_MAP: Record<string, string> = {
  "公司名 — company": "company",
  "中文职位名 — role_title_zh": "role_title_zh",
  "English title (可选)": "role_title_en",
  "cc 是必须还是加分 — cc_required": "cc_required",
  "投递链接 — apply_url": "apply_url",
  "招聘方联系方式 — contact_value": "contact_value",
  "薪资范围 (RMB, 可选)": "salary_range_rmb",
  "雇佣类型 — employment_type (可选)": "employment_type",
  "城市 — location (可选)": "location",
  "远程政策 — remote_policy (可选)": "remote_policy",
  "招聘截止日期 — open_until (可选, YYYY-MM-DD)": "open_until",
  "中文 JD — description_zh (可选)": "description_zh",
  "English JD — description_en (optional)": "description_en",
};

function flatten(
  parsed: Record<string, string | undefined>,
  map: Record<string, string>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [heading, key] of Object.entries(map)) {
    out[key] = parsed[heading];
  }
  return out;
}

export function validateJobPayload(
  parsed: Record<string, string | undefined>,
): ValidatePayloadResult<JobPayload> {
  const f = flatten(parsed, JOB_FIELD_MAP);
  const errors: FieldError[] = [];

  if (!f.company) {
    errors.push({ field: "company", kind: "missing", message: "公司名是必填." });
  }
  if (!f.role_title_zh) {
    errors.push({
      field: "role_title_zh",
      kind: "missing",
      message: "中文职位名是必填.",
    });
  }
  if (!f.cc_required) {
    errors.push({
      field: "cc_required",
      kind: "missing",
      message: "cc_required 是必填.",
    });
  } else {
    const isTrue = f.cc_required.startsWith("true");
    if (!isTrue) {
      errors.push({
        field: "cc_required",
        kind: "policy",
        message: "hireIC 只接受 cc 必填 (cc_required: true) 的职位. 若只是加分项, 请走 LinkedIn / Boss 直聘.",
      });
    }
  }
  if (!f.apply_url) {
    errors.push({
      field: "apply_url",
      kind: "missing",
      message: "投递链接 (apply_url) 是必填. 必须是 http(s) URL.",
      example: "https://acme.com/jobs/123",
    });
  } else if (!isHttpUrl(f.apply_url)) {
    errors.push({
      field: "apply_url",
      kind: "type",
      message: "apply_url 必须是 http(s) URL.",
      example: "https://acme.com/jobs/123",
    });
  }
  if (!f.contact_value) {
    errors.push({
      field: "contact_value",
      kind: "missing",
      message: "招聘方联系方式是必填.",
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const payload: JobPayload = {
    schema_version: "0.1",
    company: f.company!,
    role_title_zh: f.role_title_zh!,
    cc_required: true,
    apply_url: f.apply_url!,
    contact_value: f.contact_value!,
  };
  if (f.role_title_en) payload.role_title_en = f.role_title_en;
  if (f.salary_range_rmb) payload.salary_range_rmb = f.salary_range_rmb;
  if (f.employment_type && f.employment_type !== "(不填)") {
    payload.employment_type = f.employment_type as "full-time" | "contract" | "internship" | "consulting";
  }
  if (f.location) payload.location = f.location;
  if (f.remote_policy && f.remote_policy !== "(不填)") {
    payload.remote_policy = f.remote_policy as "onsite" | "remote-friendly" | "remote-only";
  }
  if (f.open_until) payload.open_until = f.open_until;
  if (f.description_zh) payload.description_zh = f.description_zh;
  if (f.description_en) payload.description_en = f.description_en;

  return { ok: true, payload };
}

// PII detection — keeps PR git history free of sensitive personal data.
// Conservative: false-negative > false-positive. Catches what GitHub repo
// owners should never see committed.

export type PIIKind = "mobile_cn" | "id_card_cn";

export interface PIIHit {
  kind: PIIKind;
  match: string;
  index: number;
}

// Mobile CN: prefixes 13-19, 11 digits, must NOT be inside a URL path.
const MOBILE_CN_RE = /(?<![\w/?=&-])1[3-9]\d{9}(?![\w/?=&-])/g;

// 18-digit ID card (with optional check digit X). 15-digit (old) format also covered.
// Must not match inside a URL.
const ID_CARD_18_RE = /(?<![\w/?=&-])\d{17}[\dXx](?![\w/?=&-])/g;
const ID_CARD_15_RE = /(?<![\w/?=&-])\d{15}(?![\w/?=&-])/g;

export function detectPII(text: string): PIIHit[] {
  const hits: PIIHit[] = [];

  // Strip URLs first to avoid false positives.
  const urlRanges: Array<[number, number]> = [];
  const urlRe = /https?:\/\/\S+/g;
  for (const m of text.matchAll(urlRe)) {
    if (m.index !== undefined) urlRanges.push([m.index, m.index + m[0].length]);
  }
  const inUrl = (idx: number): boolean =>
    urlRanges.some(([s, e]) => idx >= s && idx < e);

  for (const m of text.matchAll(MOBILE_CN_RE)) {
    if (m.index === undefined || inUrl(m.index)) continue;
    hits.push({ kind: "mobile_cn", match: m[0], index: m.index });
  }
  for (const m of text.matchAll(ID_CARD_18_RE)) {
    if (m.index === undefined || inUrl(m.index)) continue;
    hits.push({ kind: "id_card_cn", match: m[0], index: m.index });
  }
  // 15-digit is suspicious only when prefixed by 身份证 keyword; otherwise too noisy
  for (const m of text.matchAll(ID_CARD_15_RE)) {
    if (m.index === undefined || inUrl(m.index)) continue;
    const before = text.slice(Math.max(0, m.index - 10), m.index);
    if (/身份证/.test(before)) {
      hits.push({ kind: "id_card_cn", match: m[0], index: m.index });
    }
  }

  return hits;
}
