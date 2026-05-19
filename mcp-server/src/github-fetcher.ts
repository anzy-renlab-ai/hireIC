import type { Fetcher, FetchResult, RawFile } from "./handlers.js";

export interface GithubFetcherOptions {
  owner: string;
  repo: string;
  ref?: string;
  token?: string;
  cacheTtlMs?: number;
}

interface GithubContentsEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  content?: string | null;
  encoding?: string;
}

interface CacheEntry {
  result: FetchResult;
  expiresAt: number;
}

function decodeBase64Content(b64: string): string {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(b64.replace(/\n/g, ""));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  }
  return Buffer.from(b64, "base64").toString("utf-8");
}

export function makeGithubFetcher(options: GithubFetcherOptions): Fetcher {
  const ref = options.ref ?? "main";
  const cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  const cache = new Map<string, CacheEntry>();

  return async function fetcher(path: string): Promise<FetchResult> {
    const now = Date.now();
    const cached = cache.get(path);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    const url = `https://api.github.com/repos/${options.owner}/${options.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const resp = await fetch(url, { headers });

    if (resp.status === 200) {
      const json = (await resp.json()) as GithubContentsEntry[] | unknown;
      const entries = Array.isArray(json) ? json : [];
      const files: RawFile[] = [];
      for (const entry of entries) {
        if (entry.type !== "file") continue;
        if (entry.content == null) continue;
        const content =
          entry.encoding === "base64"
            ? decodeBase64Content(entry.content)
            : entry.content;
        files.push({ name: entry.name, content });
      }
      const result: FetchResult = { status: 200, body: files };
      cache.set(path, { result, expiresAt: now + cacheTtlMs });
      return result;
    }

    if (resp.status === 403 && resp.headers.get("X-RateLimit-Remaining") === "0") {
      return { status: 429, body: null };
    }

    if (resp.status === 404) {
      return { status: 404, body: null };
    }

    if (resp.status === 429) {
      return { status: 429, body: null };
    }

    return { status: 500, body: null };
  };
}
