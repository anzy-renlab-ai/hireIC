#!/usr/bin/env node
// Vercel build-time data generator.
// Reads ../jobs/*.md and ../candidates/*.md, writes web/data.json with
// counts + minimal job/candidate metadata. The landing page fetches
// /data.json first (same-origin, no rate limit) and only hits the GitHub
// API as a secondary refresh.
//
// Zero deps: plain Node, simple frontmatter parser.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function listMd(dir) {
  const abs = resolve(repoRoot, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => !f.startsWith(".") && f.endsWith(".md"))
    .map((name) => ({ name, abs: join(abs, name) }));
}

function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    else if (v === "true") v = true;
    else if (v === "false") v = false;
    else if (/^-?\d+$/.test(v)) v = Number(v);
    out[kv[1]] = v;
  }
  return out;
}

function loadDir(dir) {
  return listMd(dir).map(({ name, abs }) => {
    const text = readFileSync(abs, "utf-8");
    const fm = parseFrontmatter(text);
    return { name, frontmatter: fm };
  });
}

const jobsAll = loadDir("jobs");
const candidatesAll = loadDir("candidates");

// Exclude closed jobs from the public count, mirror handlers.ts behavior.
const jobs = jobsAll.filter((j) => j.frontmatter.status !== "closed");

const data = {
  generated_at: new Date().toISOString(),
  repo: "anzy-renlab-ai/hireIC",
  schema_version: "0.1",
  counts: {
    jobs: jobs.length,
    candidates: candidatesAll.length,
    jobs_closed: jobsAll.length - jobs.length,
  },
  jobs: jobs.map((j, i) => ({
    name: j.name,
    idx: String(i + 1).padStart(2, "0"),
    company: j.frontmatter.company || "—",
    role_title_zh: j.frontmatter.role_title_zh || "—",
    role_title_en: j.frontmatter.role_title_en || null,
    description_zh: j.frontmatter.description_zh || null,
    description_en: j.frontmatter.description_en || null,
    location: j.frontmatter.location || (j.frontmatter.remote_policy === "remote-only" ? "Remote" : "—"),
    remote_policy: j.frontmatter.remote_policy || null,
    salary_range_rmb: j.frontmatter.salary_range_rmb || "—",
    employment_type: j.frontmatter.employment_type || "—",
    apply_url: j.frontmatter.apply_url || `https://github.com/anzy-renlab-ai/hireIC/blob/main/jobs/${j.name}`,
  })),
  candidates: candidatesAll.map((c, i) => ({
    name: c.name,
    idx: String(i + 1).padStart(2, "0"),
    github_username: c.frontmatter.github_username || c.name.replace(/\.md$/, ""),
    cc_experience_months: c.frontmatter.cc_experience_months || null,
    evidence_url: c.frontmatter.evidence_url || null,
    contact_mode: c.frontmatter.contact_mode || "public",
    contact_value: c.frontmatter.contact_value || null,
    bio_zh: c.frontmatter.bio_zh || null,
    bio_en: c.frontmatter.bio_en || null,
    looking_for: c.frontmatter.looking_for || null,
    salary_range_rmb: c.frontmatter.salary_range_rmb || null,
    location: c.frontmatter.location || null,
    agent_stack: c.frontmatter.agent_stack || null,
    referrer_github: c.frontmatter.referrer_github || null,
    referrer_evidence_pr_url: c.frontmatter.referrer_evidence_pr_url || null,
    available_from: c.frontmatter.available_from || null,
    profile_url: `https://github.com/anzy-renlab-ai/hireIC/blob/main/candidates/${c.name}`,
  })),
};

const outPath = resolve(__dirname, "data.json");
writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log(`data.json generated: jobs=${data.counts.jobs} candidates=${data.counts.candidates} (closed=${data.counts.jobs_closed})`);
