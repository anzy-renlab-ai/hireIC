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

// Advisory signals on an *already-valid* payload. Never block submission;
// surfaced to the founder so /approve isn't blind. Machine validation only
// checks format — these flag claims that smell off (self-reported numbers,
// fabricated identity) without false-rejecting real candidates.
export type FieldWarningKind = "implausible" | "not_found" | "unreachable";

export interface FieldWarning {
  field: string;
  kind: FieldWarningKind;
  message: string;
}

// Agent-assisted coding tools (Copilot tech-preview 2021 being the earliest)
// haven't existed 5 years. A claim above this ceiling is implausible as a
// "daily driver" duration — flag for human cross-check, don't reject.
export const CC_PLAUSIBLE_CEILING_MONTHS = 60;

export interface CandidatePayload {
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

const GH_USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const CANDIDATE_FIELD_MAP: Record<string, string> = {
  "GitHub username": "github_username",
  "cc 经验 (月数 / months)": "cc_experience_months",
  "cc-fluency 证据 URL": "evidence_url",
  "联系方式公开度 — Contact mode": "contact_mode",
  "联系方式 — Contact value": "contact_value",
  "中文一句话介绍 — bio_zh (可选)": "bio_zh",
  "English bio (可选)": "bio_en",
  "状态 — looking_for (可选)": "looking_for",
  "期望薪资 (RMB, 可选)": "salary_range_rmb",
  "城市 / 远程偏好 — location (可选)": "location",
  "推荐人 GitHub — referrer_github (可选, 但有加分)": "referrer_github",
  "推荐人附的证据 PR": "referrer_evidence_pr_url",
  "主用 agent stack (可选)": "agent_stack",
  "可入职日期 — available_from (可选, YYYY-MM-DD)": "available_from",
};

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

export function validateCandidatePayload(
  parsed: Record<string, string | undefined>,
): ValidatePayloadResult<CandidatePayload> {
  const f = flatten(parsed, CANDIDATE_FIELD_MAP);
  const errors: FieldError[] = [];

  if (!f.github_username) {
    errors.push({
      field: "github_username",
      kind: "missing",
      message: "GitHub username 是必填字段, 请填你的 GitHub 登录名 (不带 @).",
      example: "alicelu",
    });
  } else if (!GH_USERNAME_RE.test(f.github_username)) {
    errors.push({
      field: "github_username",
      kind: "type",
      message: "GitHub username 格式不对. 只允许字母/数字/连字符, 不超过 39 字符, 不能以连字符开头.",
      example: "alicelu",
    });
  }

  if (!f.cc_experience_months) {
    errors.push({
      field: "cc_experience_months",
      kind: "missing",
      message: "cc 经验 (月数) 是必填. 填阿拉伯数字.",
      example: "12",
    });
  } else {
    const n = Number(f.cc_experience_months);
    if (!Number.isInteger(n) || n < 0 || n > 600) {
      errors.push({
        field: "cc_experience_months",
        kind: "type",
        message: "cc 经验需要是 0-600 之间的整数, 你填了 '" + f.cc_experience_months + "'.",
        example: "12",
      });
    }
  }

  if (!f.evidence_url) {
    errors.push({
      field: "evidence_url",
      kind: "missing",
      message: "evidence_url 是必填. 给一条能证明你 cc 用得好的公开 URL.",
      example: "https://github.com/alicelu/proj/pull/42",
    });
  } else if (!isHttpUrl(f.evidence_url)) {
    errors.push({
      field: "evidence_url",
      kind: "type",
      message: "evidence_url 必须是 http(s) 开头的 URL.",
      example: "https://github.com/alicelu/proj/pull/42",
    });
  }

  if (!f.contact_mode) {
    errors.push({
      field: "contact_mode",
      kind: "missing",
      message: "contact_mode 是必填. 选 public 或 hidden.",
    });
  } else if (f.contact_mode !== "public" && f.contact_mode !== "hidden") {
    errors.push({
      field: "contact_mode",
      kind: "value",
      message: "contact_mode 只能是 public 或 hidden, 你填了 '" + f.contact_mode + "'.",
    });
  }

  if (!f.contact_value) {
    errors.push({
      field: "contact_value",
      kind: "missing",
      message: "contact_value 是必填.",
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  // hidden mode: replace contact_value with relay-pending sentinel to prevent PII leak
  const contactMode = f.contact_mode as "public" | "hidden";
  const contactValue =
    contactMode === "hidden" && !f.contact_value!.startsWith("relay-")
      ? "relay-pending"
      : f.contact_value!;

  const payload: CandidatePayload = {
    schema_version: "0.1",
    github_username: f.github_username!,
    cc_experience_months: Number(f.cc_experience_months),
    evidence_url: f.evidence_url!,
    contact_mode: contactMode,
    contact_value: contactValue,
  };

  if (f.bio_zh) payload.bio_zh = f.bio_zh;
  if (f.bio_en) payload.bio_en = f.bio_en;
  if (f.looking_for && f.looking_for !== "(不填)") {
    payload.looking_for = f.looking_for as "full-time" | "contract" | "open-to-talk" | "not-looking";
  }
  if (f.salary_range_rmb) payload.salary_range_rmb = f.salary_range_rmb;
  if (f.location) payload.location = f.location;
  if (f.referrer_github) payload.referrer_github = f.referrer_github;
  if (f.referrer_evidence_pr_url) payload.referrer_evidence_pr_url = f.referrer_evidence_pr_url;
  if (f.agent_stack) payload.agent_stack = f.agent_stack;
  if (f.available_from) payload.available_from = f.available_from;

  return { ok: true, payload };
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

// Pure (no network) advisory checks on a validated candidate payload.
export function candidateWarnings(payload: CandidatePayload): FieldWarning[] {
  const warnings: FieldWarning[] = [];
  if (payload.cc_experience_months > CC_PLAUSIBLE_CEILING_MONTHS) {
    const years = Math.round(payload.cc_experience_months / 12);
    warnings.push({
      field: "cc_experience_months",
      kind: "implausible",
      message: `自报 ${payload.cc_experience_months} 个月 (~${years} 年). agent 辅助编码工具问世不足 5 年, 这个数字作为"日常 driver 时长"不太可能. 请对照 evidence_url 的 git 历史核实.`,
    });
  }
  return warnings;
}

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
