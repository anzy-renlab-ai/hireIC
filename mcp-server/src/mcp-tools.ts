import { listJobs, type Fetcher, type HandlerError } from "./handlers.js";
import { scoreCc, type CcEvidence, type AgentProfile } from "./score.js";
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
  const lcc = n(r.localCcCommits); if (lcc !== undefined) p.localCcCommits = lcc;
  const lcr = n(r.localCcRepos); if (lcr !== undefined) p.localCcRepos = lcr;
  const lcm = n(r.localCcMonths); if (lcm !== undefined) p.localCcMonths = lcm;
  return Object.keys(p).length ? p : undefined;
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
        github: { type: "string", description: "Your GitHub username (no @)." },
        job_id: { type: "string", description: "The job id (slug) you're applying to. Required to actually reach the employer." },
        contact: { type: "string", description: "How the employer can reach you (email / wechat / @handle). Sent ONLY to that one employer." },
        profile: {
          type: "object",
          description: "Optional, agent self-reported, PRIVACY-SAFE counts/flags of your cc setup — NO file contents/names/paths/secrets. Keys: skills, mcpServers, selfAuthoredMcp, subagents, hooks, slashCommands, hasClaudeMd.",
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

          const gather =
            args.evidenceFn ?? ((g: string) => gatherCcEvidence(g, args.token ? { token: args.token } : {}));
          const cc = scoreCc(await gather(github), profile);

          // Deliver to the employer so they can reach the candidate. Needs the
          // candidate's contact + a job_id whose job has an email contact_value.
          let delivery: { delivered: boolean; reason?: string } = {
            delivered: false,
            reason: contact ? "provide job_id to deliver" : "provide contact (so the employer can reach you) + job_id to deliver",
          };
          if (contact && jobId) {
            const jobsRes = await listJobs({ owner: args.owner, repo: args.repo, fetcher: args.fetcher });
            const job = jobsRes.jobs.find((j) => j.id === jobId);
            if (!job) {
              delivery = { delivered: false, reason: `job_id '${jobId}' not found` };
            } else {
              const send = args.sendImpl ?? emailSender(process.env);
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
