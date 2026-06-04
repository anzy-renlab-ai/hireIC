// Delivery: when a candidate applies through their agent, the employer gets ONE
// private email with the candidate's contact + cc-signal + evidence, so the
// recruiter can reach the candidate. Privacy: the candidate's contact goes ONLY
// to the one employer they chose to apply to (consensual — they initiated it),
// never published. Transport is injected (SendFn) so this is testable and
// provider-agnostic; the default sender is env-configured (see emailSender).

import type { CcBand } from "./score.js";

export interface Application {
  github: string;
  contact: string; // how the employer reaches the candidate (email / wechat / @handle)
  jobId: string | null;
  jobTitle: string;
  employerContact: string; // recipient — the job's contact_value
  score: number;
  band: CcBand;
  evidenceUrls: string[];
  priority?: boolean; // priority-routed applicant
  // Non-cc code agents this candidate drives (Codex, etc.), each scored from its OWN
  // commit footprint — reported SEPARATELY from the cc score, never folded into it.
  agentSignals?: { name: string; score: number; band: string; commits: number }[];
  // When set + band is "strong", the email appends a copy-pasteable outreach
  // draft (and a mailto: link if contact is an email) so the employer can reach
  // the candidate in one click instead of writing from scratch.
  recruiter?: { name: string; contact: string };
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  delivered: boolean;
  reason?: string;
}

export type SendFn = (msg: EmailMessage) => Promise<SendResult>;

// Inbox-sort prefix: lets the employer's mail rules auto-route by signal
// strength without parsing the score.
function bandPrefix(band: CcBand): string {
  if (band === "strong") return "[hireIC ✓]";
  if (band === "moderate") return "[hireIC ~]";
  return "[hireIC ?]";
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

// Outreach draft for strong candidates. Hand-rolled (no LLM yet) — fact-only
// fields, asks for the candidate's name (we don't have it), embeds the
// recruiter's signature. Skipped unless the candidate is "strong" AND recruiter
// info is configured, so we never invent a signature. Keying off the band (not a
// raw score cutoff) keeps the "strong" threshold owned solely by score.ts.
function outreachBlock(app: Application): string[] {
  if (app.band !== "strong" || !app.recruiter) return [];
  const subject = `${app.jobTitle} · 想跟你聊聊`;
  const body = [
    `你好,`,
    ``,
    `我是 ${app.recruiter.name},看到你通过 hireIC 投了 ${app.jobTitle}。`,
    `投递只带了 GitHub (${app.github}),方便回信时告诉我怎么称呼你吗?`,
    ``,
    `你的 cc 信号是 ${app.score}/100 (${app.band})——公开 commit 里 cc 真的在 daily driver 位上跑,这是我们的硬门槛。`,
    ``,
    `想约个 30 分钟聊聊。方便就直接回邮件,或加微信/电话 ${app.recruiter.contact}。`,
    ``,
    `— ${app.recruiter.name}`,
  ].join("\n");
  const lines = [
    ``,
    `─── 推荐回复 (strong 候选人,可直接复制发出) ───`,
    `To: ${app.contact}`,
    `Subject: ${subject}`,
    ``,
    body,
    ``,
  ];
  if (isEmail(app.contact)) {
    const mailto = `mailto:${app.contact}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    lines.push(`一键打开邮件 app: ${mailto}`);
  }
  lines.push(`─────────────────────────────────────────`);
  return lines;
}

export function renderApplicationEmail(app: Application): EmailMessage {
  const job = app.jobId ? `${app.jobTitle} (${app.jobId})` : app.jobTitle;
  const evidence = app.evidenceUrls.length
    ? app.evidenceUrls.map((u) => `  - ${u}`).join("\n")
    : "  (无公开 commit 证据)";
  // Non-Claude-Code agents the candidate drives, each scored from its own commit
  // footprint — reported SEPARATELY, explicitly NOT part of the cc 信号分.
  const agentLines = (app.agentSignals ?? []).length
    ? [
        ``,
        `其他 code agent 信号(非 cc,独立计分,供参考):`,
        ...app.agentSignals!.map((a) => `  - ${a.name}: ${a.score}/100 (${a.band}) · ${a.commits} commits`),
      ]
    : [];
  const text = [
    `一位候选人通过 hireIC 投递了你的职位。直接联系 ta 即可。`,
    ...(app.priority ? [`内部信号 ✓`] : []),
    ``,
    `GitHub: https://github.com/${app.github}`,
    `联系方式: ${app.contact}`,
    `职位: ${job}`,
    ``,
    `cc 信号分: ${app.score}/100 (${app.band})`,
    `证据 (真实 cc commit):`,
    evidence,
    ...agentLines,
    ...outreachBlock(app),
    ``,
    `cc 信号是信号不是认证 (防君子不防小人) — 请点开 evidence 链接人工核实。`,
    `— hireIC`,
  ].join("\n");
  return {
    to: app.employerContact,
    subject: `${bandPrefix(app.band)} ${app.github} 申请 ${app.jobTitle} · cc ${app.score}/100 (${app.band})`,
    text,
  };
}

export async function deliverApplication(app: Application, send: SendFn): Promise<SendResult> {
  if (!app.employerContact || !app.employerContact.includes("@")) {
    return { delivered: false, reason: "no employer email on this job (contact_value is not an email)" };
  }
  try {
    return await send(renderApplicationEmail(app));
  } catch (err) {
    return { delivered: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// Default transport: Resend (https://resend.com) via a single env key. If no key
// is set, returns delivered:false with a clear reason (never throws) so apply
// still returns the score. The founder sets HIREIC_RESEND_KEY + HIREIC_FROM to
// go live; swap this for any provider by passing a custom SendFn.
export function emailSender(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): SendFn {
  const key = env.HIREIC_RESEND_KEY;
  const from = env.HIREIC_FROM ?? "hireIC <onboarding@resend.dev>";
  return async (msg: EmailMessage): Promise<SendResult> => {
    if (!key) return { delivered: false, reason: "email not configured (set HIREIC_RESEND_KEY)" };
    const resp = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text }),
    });
    if (resp.ok) return { delivered: true };
    return { delivered: false, reason: `email provider returned HTTP ${resp.status}` };
  };
}
