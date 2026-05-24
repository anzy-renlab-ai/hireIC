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
