#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { makeGithubFetcher, type GithubFetcherOptions } from "./github-fetcher.js";
import { createMcpTools } from "./mcp-tools.js";

function readArg(flag: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  const envKey = flag.replace(/^--/, "").replace(/-/g, "_").toUpperCase();
  return process.env[`HIREIC_${envKey}`] ?? fallback;
}

const owner = readArg("--owner");
const repo = readArg("--repo");
const ref = readArg("--ref", "main");
const token = readArg("--token");

if (!owner || !repo) {
  console.error(
    "Usage: hireic-mcp --owner <gh-username-or-org> --repo <repo>\n" +
      "       hireic-mcp --owner foo --repo hireIC [--ref main] [--token ghp_...]\n" +
      "Env vars: HIREIC_OWNER, HIREIC_REPO, HIREIC_REF, HIREIC_TOKEN",
  );
  process.exit(1);
}

const fetcherOpts: GithubFetcherOptions = { owner, repo };
if (ref) fetcherOpts.ref = ref;
if (token) fetcherOpts.token = token;

const fetcher = makeGithubFetcher(fetcherOpts);
const mcpTools = createMcpTools({ owner, repo, fetcher, ...(token ? { token } : {}) });

const server = new Server(
  {
    name: "hireic-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: mcpTools.tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const toolArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
  const result = await mcpTools.call(toolName, toolArgs);
  // MCP SDK 1.29 has a "task" branch in its ServerResult union; our synchronous
  // tool call matches the simple CallToolResult branch (content + isError),
  // so we cast to escape the union narrowing.
  return result as unknown as { content: typeof result.content; isError?: boolean };
});

const transport = new StdioServerTransport();
await server.connect(transport);
