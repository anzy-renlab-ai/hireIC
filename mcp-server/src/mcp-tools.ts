import { listJobs, type Fetcher, type HandlerError } from "./handlers.js";
import { scoreCc, type CcEvidence } from "./score.js";
import { gatherCcEvidence } from "./cc-evidence.js";

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
  // Injectable for tests; defaults to the real GitHub commit-search gatherer.
  evidenceFn?: (github: string) => Promise<CcEvidence>;
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
        job_id: { type: "string", description: "Optional: the job slug you're applying to." },
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
          const gather =
            args.evidenceFn ?? ((g: string) => gatherCcEvidence(g, args.token ? { token: args.token } : {}));
          const evidence = await gather(github);
          const cc = scoreCc(evidence);
          return {
            content: [asText({ github, job_id: jobId, cc_score: cc.score, band: cc.band, evidence: cc.evidence, note: cc.note })],
          };
        }

        return asError(`unknown tool: ${name}`);
      } catch (err) {
        return asError(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
