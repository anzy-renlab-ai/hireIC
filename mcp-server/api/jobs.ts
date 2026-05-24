// Vercel serverless: GET /api/jobs — public job listings (so a candidate's agent
// can discover open roles + their id before applying). Read-only, no secrets
// strictly required (a token just lifts the GitHub rate limit).

import { createMcpTools } from "../src/mcp-tools.js";
import { makeGithubFetcher } from "../src/github-fetcher.js";

interface Req { method?: string; query?: Record<string, string | string[] | undefined>; }
interface Res {
  status(code: number): Res;
  setHeader(k: string, v: string): void;
  json(body: unknown): void;
  end(): void;
}

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=120, s-maxage=300");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const owner = process.env.HIREIC_OWNER ?? "anzy-renlab-ai";
  const repo = process.env.HIREIC_REPO ?? "hireIC";
  const token = process.env.HIREIC_TOKEN;
  const fetcher = makeGithubFetcher({ owner, repo, ...(token ? { token } : {}) });
  const t = createMcpTools({ owner, repo, fetcher, ...(token ? { token } : {}) });

  const includeClosed = req.query?.include_closed === "true";
  const result = await t.call("list_jobs", includeClosed ? { include_closed: true } : {});
  if (result.isError) {
    res.status(502).json({ error: result.content[0]?.text ?? "list_jobs failed" });
    return;
  }
  res.status(200).json(JSON.parse(result.content[0]!.text));
}
