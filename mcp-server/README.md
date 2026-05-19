# hireic-mcp

MCP server for [hireIC](https://github.com/baidu/hireIC). Exposes `list_jobs`
and `list_candidates` from any hireIC-compatible GitHub repository.

## Install / Run

```bash
# Direct invocation (no install)
npx hireic-mcp --owner baidu --repo hireIC

# Or via env vars
HIREIC_OWNER=baidu HIREIC_REPO=hireIC npx hireic-mcp
```

Add to your Claude Desktop / Cursor / other MCP-aware editor:

```json
{
  "mcpServers": {
    "hireic": {
      "command": "npx",
      "args": ["hireic-mcp", "--owner", "baidu", "--repo", "hireIC"]
    }
  }
}
```

For a custom hireIC-compatible registry, point at your own repo:

```bash
npx hireic-mcp --owner your-org --repo your-hireIC-fork --ref main
```

## Tools

- `list_jobs(include_closed?: boolean)` — return all open jobs (or all if
  `include_closed: true`).
- `list_candidates()` — return all candidates. Hidden-mode candidates have
  `contact_value: "relay-pending"` or `relay-<github>@hireic.<domain>`;
  do not attempt to derive real contact info.

Output is JSON conforming to [agent-jobs.schema.json](https://github.com/baidu/hireIC/blob/main/schemas/agent-jobs.schema.json)
and [agent-cv.schema.json](https://github.com/baidu/hireIC/blob/main/schemas/agent-cv.schema.json)
respectively.

## Auth

Default: anonymous GitHub API (60 req/hr/IP limit). Sufficient for
sporadic use, hits the limit if used heavily.

For higher limits, supply a token:

```bash
npx hireic-mcp --owner baidu --repo hireIC --token ghp_xxx
# or
HIREIC_TOKEN=ghp_xxx npx hireic-mcp ...
```

PAT only needs `public_repo` read scope (no write).

## Cache

The server keeps a 5-minute in-memory cache of the GitHub Contents API
response, separated per path (`jobs/` and `candidates/` cache
independently). Restart the server to invalidate sooner.

## License

MIT.
