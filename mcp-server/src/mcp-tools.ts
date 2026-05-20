import { listCandidates, listJobs, type Fetcher, type HandlerError } from "./handlers.js";

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
    name: "list_candidates",
    description:
      "Return all hireIC candidates (cc-fluent ICs open to opportunities). Each candidate follows the agent-cv schema. Hidden-mode candidates have contact_value=relay-pending or relay-* address; do NOT attempt to derive real contact info.",
    inputSchema: {
      type: "object",
      properties: {},
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
        if (name === "list_candidates") {
          const result = await listCandidates({
            owner: args.owner,
            repo: args.repo,
            fetcher: args.fetcher,
          });
          const topErr = hasTopLevelError(result.errors);
          if (topErr) return asError(`${topErr.kind}: ${topErr.message}`);
          return { content: [asText(result)] };
        }

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

        return asError(`unknown tool: ${name}`);
      } catch (err) {
        return asError(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
