// Delivery: when a candidate applies through their agent, the employer gets ONE
// private email with the candidate's contact + cc-signal + evidence, so the
// recruiter can reach the candidate. Privacy: the candidate's contact goes ONLY
// to the one employer they chose to apply to (consensual — they initiated it),
// never published. Transport is injected (SendFn) so this is testable and
// provider-agnostic; the default sender is env-configured (see emailSender).

export interface Application {
  github: string;
  contact: string; // how the employer reaches the candidate (email / wechat / @handle)
  jobId: string | null;
  jobTitle: string;
  employerContact: string; // recipient — the job's contact_value
  score: number;
  band: string;
  evidenceUrls: string[];
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

export function renderApplicationEmail(app: Application): EmailMessage {
  const job = app.jobId ? `${app.jobTitle} (${app.jobId})` : app.jobTitle;
  const evidence = app.evidenceUrls.length
    ? app.evidenceUrls.map((u) => `  - ${u}`).join("\n")
    : "  (无公开 commit 证据)";
  const text = [
    `一位候选人通过 hireIC 投递了你的职位。直接联系 ta 即可。`,
    ``,
    `GitHub: https://github.com/${app.github}`,
    `联系方式: ${app.contact}`,
    `职位: ${job}`,
    ``,
    `cc 信号分: ${app.score}/100 (${app.band})`,
    `证据 (真实 cc commit):`,
    evidence,
    ``,
    `cc 信号是信号不是认证 (防君子不防小人) — 请点开 evidence 链接人工核实。`,
    `— hireIC`,
  ].join("\n");
  return {
    to: app.employerContact,
    subject: `[hireIC] ${app.github} 申请 ${app.jobTitle} · cc ${app.score}/100 (${app.band})`,
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
