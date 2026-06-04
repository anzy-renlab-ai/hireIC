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
    expect(m.text).toContain("Codex: 41/100 (moderate) · 23 commits");
    // the headline cc score stays the candidate's cc number, untouched by codex
    expect(m.subject).toContain("72");
  });

  it("no agent signals → no agent section", () => {
    expect(renderApplicationEmail(app).text).not.toContain("非 cc");
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
