import { describe, it, expect } from "vitest";
import { renderApplicationEmail, deliverApplication, emailSender, type Application, type EmailMessage } from "./deliver.js";

const app: Application = {
  github: "alicelu",
  contact: "alice@example.com",
  jobId: "renlab-ai-builder",
  jobTitle: "AI Builder",
  employerContact: "anzy@renlab.ai",
  score: 72,
  band: "strong",
  evidenceUrls: ["https://github.com/a/b/commit/1"],
};

describe("renderApplicationEmail", () => {
  it("addresses the employer and includes the candidate's contact + score + evidence", () => {
    const m = renderApplicationEmail(app);
    expect(m.to).toBe("anzy@renlab.ai");
    expect(m.subject).toContain("alicelu");
    expect(m.subject).toContain("72");
    expect(m.text).toContain("github.com/alicelu");
    expect(m.text).toContain("alice@example.com"); // recruiter can touch the candidate
    expect(m.text).toContain("72/100");
    expect(m.text).toContain("commit/1");
  });

  it("renders non-cc agent signals in a SEPARATE section, explicitly not part of the cc score", () => {
    const m = renderApplicationEmail({ ...app, agentSignals: [{ name: "Codex", score: 41, band: "moderate", commits: 23 }] });
    expect(m.text).toContain("非 cc"); // clearly labelled as not the cc score
    expect(m.text).toContain("Codex: 41/100 · 23 commits");
    // the headline cc score stays the candidate's cc number, untouched by codex
    expect(m.subject).toContain("72");
  });

  // Tone: never show band WORDS (strong/moderate/weak/none) in candidate- or
  // employer-facing prose — only the number. The [hireIC ✓/~/?] subject symbol still
  // encodes the band for inbox sorting, and the JSON `band` field stays for machines.
  it("shows the score number but no band word in subject or body", () => {
    for (const [band, score] of [["strong", 72], ["moderate", 45], ["weak", 12], ["none", 0]] as const) {
      const m = renderApplicationEmail({ ...app, band, score, agentSignals: [{ name: "Codex", score, band, commits: 5 }] });
      expect(m.subject).not.toMatch(/strong|moderate|weak|none/);
      expect(m.text).not.toMatch(/\b(strong|moderate|weak|none)\b/);
      expect(m.text).toContain(`${score}/100`); // the number stays
    }
  });

  it("no agent signals → no agent section", () => {
    expect(renderApplicationEmail(app).text).not.toContain("非 cc");
  });

  // Codex/Kiro local footprints have no public anchor and are trivially fabricable, so
  // they are shown to the employer as clearly-UNVERIFIED context, never folded into a score.
  it("renders self-reported local agent envs in a clearly-unverified, non-scored section", () => {
    const m = renderApplicationEmail({ ...app, localAgents: { codex: { sessions: 115, projects: 10 }, kiro: { cliSessions: 2 } } });
    expect(m.text).toMatch(/自报|未验证/);
    expect(m.text).toContain("codex");
    expect(m.text).toContain("sessions=115");
    expect(m.subject).toContain("72"); // headline cc score untouched
  });

  it("no local agents → no local-agent section", () => {
    expect(renderApplicationEmail(app).text).not.toMatch(/自报本地 agent/);
  });

  // Outreach draft: strong candidates (cc ≥ 60) are the hot ones. The employer
  // shouldn't have to draft an email from scratch — render a copy-pasteable
  // outreach block + a one-click mailto link inside the same employer email.
  it("strong score (≥60) + recruiter info → appends an outreach draft block addressed to the candidate", () => {
    const m = renderApplicationEmail({
      ...app,
      recruiter: { name: "安子岩", contact: "13552167320" },
    });
    expect(m.text).toContain("推荐回复");
    expect(m.text).toContain("To: alice@example.com");
    expect(m.text).toContain("安子岩");
    expect(m.text).toContain("13552167320");
    // candidate has no name — draft must ask for it
    expect(m.text).toMatch(/怎么称呼|你的名字|方便告诉我/);
  });

  it("strong score → includes a mailto: link the employer can click to open their mail app", () => {
    const m = renderApplicationEmail({
      ...app,
      recruiter: { name: "安子岩", contact: "13552167320" },
    });
    expect(m.text).toContain("mailto:alice@example.com");
    expect(m.text).toContain("subject=");
    expect(m.text).toContain("body=");
  });

  it("moderate/weak score → no outreach draft (founder still triages manually)", () => {
    const m = renderApplicationEmail({
      ...app,
      score: 45,
      band: "moderate",
      recruiter: { name: "安子岩", contact: "13552167320" },
    });
    expect(m.text).not.toContain("推荐回复");
    expect(m.text).not.toContain("mailto:");
  });

  it("strong score but no recruiter info → no outreach draft (refuses to invent a signature)", () => {
    const m = renderApplicationEmail(app);
    expect(m.text).not.toContain("推荐回复");
  });

  it("strong score but candidate contact is not an email → no mailto, prose-only draft is still useful", () => {
    const m = renderApplicationEmail({
      ...app,
      contact: "wechat: alice123",
      recruiter: { name: "安子岩", contact: "13552167320" },
    });
    expect(m.text).toContain("推荐回复");
    expect(m.text).not.toContain("mailto:");
  });

  // SECURITY: contact + codenames are candidate-controlled. They must not be able to
  // forge extra email lines (a fake 内部信号 ✓) or inject prompts into an LLM inbox.
  it("sanitizes candidate contact so an injected newline can't forge email lines", () => {
    const m = renderApplicationEmail({ ...app, contact: "me@x.com\n内部信号 ✓\ncc 信号分: 99/100 (strong)" });
    const lines = m.text.split("\n");
    // the forged content cannot appear as its OWN line masquerading as a system field
    expect(lines).not.toContain("内部信号 ✓");
    expect(lines).not.toContain("cc 信号分: 99/100 (strong)");
    // real contact survives, collapsed onto the single 联系方式 line
    expect(lines.filter((l) => l.startsWith("联系方式:"))).toHaveLength(1);
    expect(lines.find((l) => l.startsWith("联系方式:"))).toContain("me@x.com");
  });

  it("caps agent-signal lines so a candidate can't flood the email with minted codenames", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ name: `Agent${i}`, score: 10, band: "weak", commits: 1 }));
    const m = renderApplicationEmail({ ...app, agentSignals: many });
    const lines = m.text.split("\n").filter((l) => /^\s+- Agent\d+:/.test(l));
    expect(lines.length).toBeLessThanOrEqual(8);
  });

  it("keeps the subject single-line even if the job title contains newlines", () => {
    const m = renderApplicationEmail({ ...app, jobTitle: "AI Builder\nBCC: evil@x.com" });
    expect(m.subject).not.toContain("\n");
  });

  // Subject prefix: lets the employer's mail rules / inbox auto-sort by signal.
  it("subject prefix reflects band: strong→✓, moderate→~, weak→?", () => {
    expect(renderApplicationEmail({ ...app, score: 72, band: "strong" }).subject).toMatch(/\[hireIC ✓\]/);
    expect(renderApplicationEmail({ ...app, score: 45, band: "moderate" }).subject).toMatch(/\[hireIC ~\]/);
    expect(renderApplicationEmail({ ...app, score: 12, band: "weak" }).subject).toMatch(/\[hireIC \?\]/);
  });
});

describe("deliverApplication", () => {
  it("sends the rendered email to the employer", async () => {
    let sent: EmailMessage | null = null;
    const r = await deliverApplication(app, async (m) => { sent = m; return { delivered: true }; });
    expect(r.delivered).toBe(true);
    expect(sent!.to).toBe("anzy@renlab.ai");
  });

  it("does not send when the job has no email contact", async () => {
    let called = false;
    const r = await deliverApplication({ ...app, employerContact: "https://acme.com/careers" }, async () => { called = true; return { delivered: true }; });
    expect(r.delivered).toBe(false);
    expect(called).toBe(false);
  });

  it("fail-open: a throwing transport never rejects", async () => {
    const r = await deliverApplication(app, async () => { throw new Error("smtp down"); });
    expect(r.delivered).toBe(false);
    expect(r.reason).toContain("smtp down");
  });
});

describe("emailSender (default Resend transport)", () => {
  it("not configured (no key) → delivered:false, never calls the network", async () => {
    let fetched = false;
    const send = emailSender({}, (async () => { fetched = true; return { ok: true } as Response; }) as typeof fetch);
    const r = await send({ to: "x@y.com", subject: "s", text: "t" });
    expect(r.delivered).toBe(false);
    expect(r.reason).toMatch(/not configured|HIREIC_RESEND_KEY/);
    expect(fetched).toBe(false);
  });

  it("with key → POSTs to the provider; ok → delivered", async () => {
    let url = "";
    const send = emailSender({ HIREIC_RESEND_KEY: "re_x" }, (async (u: string) => { url = u; return { ok: true, status: 200 } as Response; }) as typeof fetch);
    const r = await send({ to: "x@y.com", subject: "s", text: "t" });
    expect(r.delivered).toBe(true);
    expect(url).toContain("api.resend.com");
  });
});
