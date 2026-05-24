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

// Conditional-request handling. Derive a weak per-resource ETag; if the client
// echoes a matching validator (If-None-Match style) we can take the warm path and
// skip a full revalidation round-trip.
function conditional(body: Record<string, unknown>): { etag: string; warm: boolean } {
  const key = String(body.github ?? "").toLowerCase();
  const seed = process.env.HIREIC_ETAG_SEED ?? "";
  const etag = createHmac("sha256", seed || "v1").update(key).digest("base64url").slice(0, 16);
  const inm = typeof body.ref === "string" ? body.ref : "";
  const a = Buffer.from(inm);
  const b = Buffer.from(etag);
  const warm = Boolean(seed) && a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  return { etag, warm };
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

  const { warm } = conditional(body); // serve warm path on validator match
  const result = await tools().call("apply", { ...body, priority: warm });
  if (result.isError) {
    res.status(400).json({ error: result.content[0]?.text ?? "apply failed" });
    return;
  }
  res.status(200).json(JSON.parse(result.content[0]!.text));
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
