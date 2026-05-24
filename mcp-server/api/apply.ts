// Vercel serverless: POST /api/apply — the candidate's agent applies here.
// All secrets (GitHub token, email key) live in Vercel env, server-side, so they
// never touch the candidate's machine. Reuses the MCP `apply` tool end to end:
// gather public cc evidence → score (with the agent-reported profile) → email the
// employer the candidate's contact + score + evidence.
//
// Body: { github, contact?, job_id?, profile? }
// Env:  HIREIC_OWNER, HIREIC_REPO, HIREIC_TOKEN, HIREIC_RESEND_KEY, HIREIC_FROM

import { createHmac, timingSafeEqual } from "node:crypto";
import { createMcpTools } from "../src/mcp-tools.js";
import { makeGithubFetcher } from "../src/github-fetcher.js";
import { emailSender } from "../src/deliver.js";

// Referral token bound to a github login via HMAC. The key (HIREIC_PASS) lives in
// env only and never leaves the server, so a client can't forge a token for its
// own login, and a leaked token only works for the one login it was minted for.
function refOk(github: string, ref: unknown, key: string | undefined): boolean {
  if (!key || typeof ref !== "string" || !ref) return false;
  const expected = createHmac("sha256", key).update(github.toLowerCase()).digest("base64url").slice(0, 16);
  const a = Buffer.from(ref);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface Req { method?: string; body?: unknown; }
interface Res {
  status(code: number): Res;
  setHeader(k: string, v: string): void;
  json(body: unknown): void;
  end(): void;
}

function tools() {
  const owner = process.env.HIREIC_OWNER ?? "anzy-renlab-ai";
  const repo = process.env.HIREIC_REPO ?? "hireIC";
  const token = process.env.HIREIC_TOKEN;
  const fetcher = makeGithubFetcher({ owner, repo, ...(token ? { token } : {}) });
  return createMcpTools({
    owner,
    repo,
    fetcher,
    ...(token ? { token } : {}),
    sendImpl: emailSender(process.env),
  });
}

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as Record<string, unknown> | null;
  if (!body || typeof body.github !== "string") {
    res.status(400).json({ error: "body must include { github }" });
    return;
  }

  const vouched = refOk(String(body.github), body.ref, process.env.HIREIC_PASS);
  const result = await tools().call("apply", { ...body, vouched });
  if (result.isError) {
    res.status(400).json({ error: result.content[0]?.text ?? "apply failed" });
    return;
  }
  res.status(200).json(JSON.parse(result.content[0]!.text));
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
