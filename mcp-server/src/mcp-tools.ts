import { listJobs, type Fetcher, type HandlerError } from "./handlers.js";
import { scoreCc, mergeEvidence, type CcEvidence, type AgentProfile } from "./score.js";
import { gatherCcEvidence } from "./cc-evidence.js";
import { deliverApplication, emailSender, type SendFn } from "./deliver.js";

const TOP_LEVEL_ERROR_KINDS = new Set<HandlerError["kind"]>([
  "network",
  "not_found",
  "rate_limited",
  "unauthorized",
  "unknown",
]);

function hasTopLevelError(errors: HandlerError[]): HandlerError | undefined {
  return errors.find((e) => TOP_LEVEL_ERROR_KINDS.has(e.kind) && !e.file);
}

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

export interface CreateMcpToolsArgs {
  owner: string;
  repo: string;
  fetcher: Fetcher;
  token?: string;
  // Injectable for tests; default to the real GitHub gatherer / env email sender.
  evidenceFn?: (github: string) => Promise<CcEvidence>;
  sendImpl?: SendFn;
  // Trusted insider-priority decision, injected server-side ONLY (the HTTP /api/apply
  // path supplies an HMAC-backed verdict). Candidates run the stdio server themselves,
  // so the priority flag must NEVER be read from client tool-args — see callArgs below.
  priorityFn?: (callArgs: Record<string, unknown>) => boolean;
}

// Privacy filter: accept ONLY known count/flag fields from the agent's self-report.
// Anything else (contents, names, paths) is silently dropped — privacy by construction.
function parseProfile(raw: unknown): AgentProfile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
  const b = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  const p: AgentProfile = {};
  const skills = n(r.skills); if (skills !== undefined) p.skills = skills;
  const mcp = n(r.mcpServers); if (mcp !== undefined) p.mcpServers = mcp;
  const sa = b(r.selfAuthoredMcp); if (sa !== undefined) p.selfAuthoredMcp = sa;
  const sub = n(r.subagents); if (sub !== undefined) p.subagents = sub;
  const hk = n(r.hooks); if (hk !== undefined) p.hooks = hk;
  const sc = n(r.slashCommands); if (sc !== undefined) p.slashCommands = sc;
  const cm = b(r.hasClaudeMd); if (cm !== undefined) p.hasClaudeMd = cm;
  const os = n(r.outputStyles); if (os !== undefined) p.outputStyles = os;
  const sl = b(r.hasStatusline); if (sl !== undefined) p.hasStatusline = sl;
  const lcc = n(r.localCcCommits); if (lcc !== undefined) p.localCcCommits = lcc;
  const lcr = n(r.localCcRepos); if (lcr !== undefined) p.localCcRepos = lcr;
  const lcm = n(r.localCcMonths); if (lcm !== undefined) p.localCcMonths = lcm;
  const lct = n(r.localCcTenureMonths); if (lct !== undefined) p.localCcTenureMonths = lct;
  const ct = n(r.correctionTurns); if (ct !== undefined) p.correctionTurns = ct;
  const ad = n(r.activeDays); if (ad !== undefined) p.activeDays = ad;
  return Object.keys(p).length ? p : undefined;
}

// Self-reported local agent-CLI footprints (Codex/Kiro). Counts-only by construction:
// keep only non-negative finite numbers, drop everything else. DISPLAY-ONLY — never
// fed to scoreCc (no public anchor, trivially fabricable), only shown to the employer.
function parseLocalAgents(raw: unknown): Record<string, Record<string, number>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const [agent, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const name = String(agent).replace(/[^\w-]/g, "").slice(0, 20);
    if (!name) continue;
    const counts: Record<string, number> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "number" && Number.isFinite(val) && val >= 0) counts[k] = Math.floor(val);
    }
    if (Object.keys(counts).length) out[name] = counts;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface McpTools {
  tools: McpToolDescriptor[];
  call(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

const TOOL_DESCRIPTORS: McpToolDescriptor[] = [
  {
    name: "list_jobs",
    description:
      "Return all open hireIC jobs (companies looking for cc-fluent ICs). Each job follows the agent-jobs schema with bilingual fields. Optionally include closed jobs.",
    inputSchema: {
      type: "object",
      properties: {
        include_closed: {
          type: "boolean",
          description: "Whether to include jobs with status=closed. Defaults to false.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "apply",
    description:
      "Apply to a hireIC job as a candidate. Pass your GitHub username; hireIC computes a cc-signal score from your PUBLIC Claude Code footprint (commits co-authored by Claude, across repos, over time) and returns it WITH evidence (commit URLs). Signal, not certification (防君子不防小人) — no public candidate profile is stored. To actually be considered, also send your GitHub + a real cc work link to the role's apply_url / contact.",
    inputSchema: {
      type: "object",
      properties: {
        github: { type: "string", description: "Your primary GitHub username (no @)." },
        githubs: { type: "array", items: { type: "string" }, description: "Optional: additional GitHub usernames (personal + work) to aggregate." },
        commit_emails: { type: "array", items: { type: "string" }, description: "Optional: your git author email(s). GitHub's author: search only matches emails LINKED to your account; pass these so commits made with an unlinked email are still found (recall, not score). Public info — they're already in your commit history." },
        job_id: { type: "string", description: "The job id (slug) you're applying to. Required to actually reach the employer." },
        contact: { type: "string", description: "How the employer can reach you (email / wechat / @handle). Sent ONLY to that one employer." },
        profile: {
          type: "object",
          description: "Optional, agent self-reported, PRIVACY-SAFE counts/flags of your cc setup — NO file contents/names/paths/secrets. Keys: skills, mcpServers, selfAuthoredMcp, subagents, hooks, slashCommands, hasClaudeMd, correctionTurns, activeDays.",
          additionalProperties: true,
        },
        localAgents: {
          type: "object",
          description: "Optional, self-reported COUNTS-ONLY footprint of OTHER agent CLIs you run (e.g. codex, kiro). Map of agent → {counterName: count}. DISPLAY-ONLY context for the employer — never scored (no public anchor). No paths/contents.",
          additionalProperties: true,
        },
      },
      required: ["github"],
      additionalProperties: false,
    },
  },
];

function asText(payload: unknown): McpTextContent {
  return { type: "text", text: JSON.stringify(payload, null, 2) };
}

function asError(message: string): McpToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function createMcpTools(args: CreateMcpToolsArgs): McpTools {
  return {
    tools: TOOL_DESCRIPTORS,
    async call(name: string, callArgs: Record<string, unknown>): Promise<McpToolResult> {
      try {
        if (name === "list_jobs") {
          const includeClosed = callArgs.include_closed;
          if (includeClosed !== undefined && typeof includeClosed !== "boolean") {
            return asError(`invalid argument: include_closed must be boolean, got ${typeof includeClosed}`);
          }
          const result = await listJobs({
            owner: args.owner,
            repo: args.repo,
            fetcher: args.fetcher,
            ...(includeClosed === true ? { includeClosed: true } : {}),
          });
          const topErr = hasTopLevelError(result.errors);
          if (topErr) return asError(`${topErr.kind}: ${topErr.message}`);
          return { content: [asText(result)] };
        }

        if (name === "apply") {
          const github = callArgs.github;
          if (typeof github !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(github)) {
            return asError("invalid argument: github must be a valid GitHub username (no @)");
          }
          const jobId = typeof callArgs.job_id === "string" ? callArgs.job_id : null;
          const contact = typeof callArgs.contact === "string" ? callArgs.contact.trim() : "";
          const profile = parseProfile(callArgs.profile);
          const localAgents = parseLocalAgents(callArgs.localAgents); // display-only, never scored

          // Candidate git author emails → extra author-email: queries (recall for commits
          // whose email isn't linked to the GitHub account). Validated + capped.
          const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          const commitEmails = Array.isArray(callArgs.commit_emails)
            ? (callArgs.commit_emails as unknown[]).filter((e): e is string => typeof e === "string" && emailRe.test(e)).slice(0, 3)
            : [];
          const gather =
            args.evidenceFn ?? ((g: string) => gatherCcEvidence(g, { ...(args.token ? { token: args.token } : {}), ...(commitEmails.length ? { emails: commitEmails } : {}) }));
          // A candidate may list extra GitHub accounts (personal + work) — gather
          // each and merge so multi-account footprints aren't undercounted.
          const ghRe = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
          const extra = Array.isArray(callArgs.githubs)
            ? (callArgs.githubs as unknown[]).filter((g): g is string => typeof g === "string" && ghRe.test(g))
            : [];
          const logins = [...new Set([github, ...extra].map((s) => s.toLowerCase()))].slice(0, 5);
          const evs = await Promise.all(logins.map((g) => gather(g)));
          const merged = mergeEvidence(evs);
          const cc = scoreCc(merged, profile);
          // Big local footprint but ~nothing public usually means the candidate commits
          // with an email not linked to their GitHub account — public search can't see it.
          // Tell them how to fix the RECALL (this changes what's found, not the score).
          const hint = (profile?.localCcCommits ?? 0) >= 20 && merged.ccCommits <= 2 && !merged.incomplete
            ? "本地 cc 提交很多但公开搜索几乎为零 —— 你的 commit 邮箱可能没关联到 GitHub 账号。去 github.com/settings/emails 添加该邮箱(或重投时带上 commit_emails),公开足迹就能被检索到(影响召回,不影响评分)。"
            : undefined;
          // Non-cc code agents (Codex, etc.): score each from its OWN commit
          // footprint (usage only — no cc self-report), clearly separate from cc.
          const agentSignals = merged.agents
            ? Object.entries(merged.agents)
                .map(([name, ev]) => { const s = scoreCc(ev); return { name, score: s.score, band: s.band, commits: ev.ccCommits }; })
                .sort((a, b) => b.score - a.score)
            : [];

          // Deliver to the employer so they can reach the candidate. Needs the
          // candidate's contact + a job_id whose job has an email contact_value.
          let delivery: { delivered: boolean; reason?: string } = {
            delivered: false,
            reason: contact ? "provide job_id to deliver" : "provide contact (so the employer can reach you) + job_id to deliver",
          };
          // A rate-limited / failed GitHub fetch returns 0 commits — indistinguishable
          // from a real empty footprint. Don't email the employer a false "0/100 (none)";
          // hold and tell the candidate to retry. (If real commits came back despite the
          // partial fetch, deliver normally — the score is a valid lower bound.)
          const evidenceIncomplete = merged.incomplete === true;
          if (contact && jobId && evidenceIncomplete && merged.ccCommits === 0) {
            delivery = { delivered: false, reason: "GitHub 取证未完成(可能被限流)— 稍后用同样命令重试即可" };
          } else if (contact && jobId) {
            const jobsRes = await listJobs({ owner: args.owner, repo: args.repo, fetcher: args.fetcher });
            const job = jobsRes.jobs.find((j) => j.id === jobId);
            if (!job) {
              delivery = { delivered: false, reason: `job_id '${jobId}' not found` };
            } else {
              const send = args.sendImpl ?? emailSender(process.env);
              const recruiterName = process.env.HIREIC_RECRUITER_NAME;
              const recruiterContact = process.env.HIREIC_RECRUITER_CONTACT;
              const recruiter = recruiterName && recruiterContact
                ? { name: recruiterName, contact: recruiterContact }
                : undefined;
              delivery = await deliverApplication(
                {
                  github,
                  contact,
                  jobId,
                  jobTitle: job.role_title_zh,
                  employerContact: job.contact_value,
                  score: cc.score,
                  band: cc.band,
                  evidenceUrls: cc.evidence.sampleUrls,
                  // Trusted server-side decision only; client args can't forge it.
                  priority: args.priorityFn ? args.priorityFn(callArgs) : false,
                  ...(agentSignals.length ? { agentSignals } : {}),
                  ...(localAgents ? { localAgents } : {}),
                  ...(recruiter ? { recruiter } : {}),
                },
                send,
              );
            }
          }

          return {
            content: [
              asText({
                github,
                job_id: jobId,
                cc_score: cc.score,
                band: cc.band,
                breakdown: cc.breakdown,
                evidence: cc.evidence,
                delivery,
                ...(evidenceIncomplete ? { evidence_incomplete: true } : {}),
                ...(hint ? { hint } : {}),
                note: cc.note,
              }),
            ],
          };
        }

        return asError(`unknown tool: ${name}`);
      } catch (err) {
        return asError(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
