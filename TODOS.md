# TODOS — hireIC

Captured during /plan-ceo-review on 2026-05-18. Priority: P1 = blocks shipping, P2 = ship-day quality, P3 = next quarter.

---

## P2 — Ship-quality

### Schema versioning header
**What**: Add `schema_version: 0.1` header to `agent-cv.json` and `agent-jobs.json` from day 1.
**Why**: Once profiles exist in the wild, renaming or restructuring fields becomes a breaking change. A version header lets consumers branch logic per version without coordinating mass updates.
**Pros**: 30 min now buys frictionless schema evolution forever. Standard pattern (npm package.json, Cargo.toml, package-lock).
**Cons**: One more required field. Trivial.
**Context**: SCHEMA.md is being drafted as part of α scope. Add this BEFORE first profile lands or the first migration is a nightmare.
**Effort**: S (human 30 min / CC 5 min)
**Priority**: P2
**Depends on**: SCHEMA.md draft

### PII regex check in Action validator
**What**: Action validator greps PR diffs for Chinese mobile (`1[3-9]\d{9}`), ID card patterns, and obvious email-like-strings outside known relay address. Fail loud on match.
**Why**: PR-as-application means git history is permanent. A PII leak is unrecoverable. Better to reject the submission and ask candidate to fix than to merge and try to scrub later.
**Pros**: Cheap defense, high-value protection. Standard practice for any user-submitted-PR workflow.
**Cons**: False positives possible (e.g. example phone numbers in evidence-PR descriptions). Mitigate with allowlist comments.
**Context**: Build into `.github/workflows/validate.yml` as one of the validation steps.
**Effort**: S (human 1 hour / CC 15 min)
**Priority**: P2
**Depends on**: validate.yml exists

### MAINTAINERS.md + identify co-maintainers
**What**: Within 1 month of repo going public, write `MAINTAINERS.md` and recruit 1-2 trusted peers who can also merge PRs.
**Why**: Founder is sole reviewer is the biggest operational risk after supply-side cold start. If founder takes a vacation, channel dies.
**Pros**: Removes single-point-of-failure. Signals "this is a community thing" not "garry's side project".
**Cons**: Hard to recruit before there's traffic. Chicken-and-egg.
**Context**: Recruit from γ-track contacts (people you already talked to manually) as natural first co-maintainers.
**Effort**: S file-wise, M outreach-wise
**Priority**: P2
**Depends on**: γ track producing first 2-3 trusted broker contacts

---

## P3 — Forward debt / future quarters

### Weekly cron stats email
**What**: A GitHub Actions cron (every Sunday 18:00 Asia/Shanghai) that counts repo stars, candidate-PR-count, job-PR-count, computes deltas vs last week, emails to founder.
**Why**: Without metrics you cannot tell if channel is growing, dying, or flat. Email beats dashboard for solo-founder usage (no need to log in to see).
**Pros**: 1 file, 1 cron, gmail SMTP via Action secret. Forces weekly self-check.
**Cons**: Could be replaced by GitHub Insights manually. But automation reduces friction.
**Context**: Defer until first 2 candidate PRs exist (don't email "0 of everything" for weeks).
**Effort**: S (human 2 hours / CC 30 min)
**Priority**: P3

### `[stale]` auto-label for old candidate PRs
**What**: Action that labels candidate PRs older than 12 months with `[stale]` if not refreshed.
**Why**: Profiles age. A 2-year-old cc-fluency claim is meaningless. Stale label signals "this person may not be active here anymore" without deleting their data.
**Pros**: Cheap signal hygiene. Helps recruiters skip dead profiles.
**Cons**: Premature. Don't ship until repo has 6+ months of data.
**Context**: Re-evaluate at month 12.
**Effort**: S
**Priority**: P3

### cc-fluency scoring algorithm design
**What**: Design a rubric that scores cc-fluency from public artifacts (PR co-authored-by trail, commit cadence, cc session transcripts, PR description quality). Defer building until ≥5 real candidate PRs exist as ground truth.
**Why**: This is the eventual core IP — the thing that makes hireIC more than a repo. But designing it without real data is speculation.
**Pros**: Unlocks Approach β (scoring SaaS), Approach C (Chrome extension), and bulk-API monetization.
**Cons**: High research cost. Risk of building "correct" rubric that nobody believes. Needs candidate validation.
**Context**: Trigger condition: 5+ candidate PRs merged and at least 1 actual interview from the channel.
**Effort**: M (research + prototype)
**Priority**: P3
**Depends on**: First 5 candidate PRs

### Payment rail design (¥2-5k per verified hire)
**What**: Choose escrow mechanism (manual invoice → Stripe → Paddle → 支付宝 商家). Decide trigger (job posted vs hire confirmed).
**Why**: γ track will produce first hire conversation soon. Need to decide WHEN payment happens before promising it to anyone.
**Pros**: Converts goodwill into sustainable revenue. Validates pricing.
**Cons**: Premature optimization. First hire might happen as a favor (no payment) and that's fine.
**Context**: Trigger: first manual γ-track hire conversation. Until then, defer.
**Effort**: M (legal + processor setup)
**Priority**: P3
**Depends on**: First γ-track hire conversation

---

## Scaffold Implementation deferrals (2026-05-19)

### MCP server Cloudflare Worker (Step 5 from eng-review test plan)
**What**: Remote HTTP MCP server on Cloudflare Workers. Lets any agent across the web hit `https://hireic-mcp.<domain>/` without `npx`.
**Why deferred**: 0 candidates at MVP launch means worker serves air. Local `npx hireic-mcp` covers the hiring-this-week need. Worker becomes valuable once external aggregators want to import (likely month 2-3).
**Effort**: M (2-3h CC, needs wrangler + KV cache + HTTP MCP transport from scratch since SDK is stdio-focused).
**Priority**: P3
**Trigger condition**: First non-founder publishes a `.well-known/agent-cv.json` and asks how to discover others. Until then, defer.

## Design Review additions (2026-05-18)

### `update-counts.yml` workflow
**What**: New GitHub Action that triggers on PR merge to main, regenerates `<!-- counts -->` block in README with current job/candidate counts.
**Why**: README displays "目前 X 个职位 · Y 个候选人" per design review. Manual updates rot. Action must run on every merge.
**Effort**: S (human 1h / CC 15 min)
**Priority**: P2 (ship with first job/candidate merge)

### Schema versioning header (already in TODOs above)
Now P1: SCHEMA.md MUST carry `schema_version: 0.1` before first profile lands.

### Friendly Action error message templates
**What**: Author 5 canned error templates in `.github/workflows/validate.yml` for the most common rejection reasons (missing required field, wrong type, PII found, evidence_url unreachable, malformed contact_mode).
**Why**: Design review committed to friendly+specific+actionable error tone. Templates ensure consistency across all bot responses.
**Effort**: S (human 1h / CC 20 min)
**Priority**: P2

### Hidden mode relay alias issuance flow
**What**: When candidate selects `contact_mode: hidden`, document the founder workflow for issuing a one-time relay alias (e.g., manual mailto setup at `~/.gstack/projects/hireIC/relays.md` or similar private log).
**Why**: Hidden mode is a first-class scope item (C3). Issuance flow must be repeatable, not improvised case-by-case.
**Effort**: S
**Priority**: P2 (need before first hidden candidate lands)

## Notes

- TODOs P2 items have specific trigger conditions, not deadlines. Don't context-switch unless triggered.
- This file is committed to the repo so co-maintainers (when they exist) can see what's deferred.
- Items get GitHub Issues when they become P1 (actively worked on).

## CF Email Routing for hidden mode (deferred — needs DNS decision)

**Blocker**: renlab.ai apex MX → Aliyun (mx1.qiye.aliyun.com, currently delivering
anzy@renlab.ai). Enabling Cloudflare Email Routing on the apex would conflict
with the existing Aliyun mailbox.

**Options**:
1. Move Aliyun mail to a sub: `anzy@mail.renlab.ai`, use apex for CF routing.
   Risky — touches a live mailbox.
2. Use a new dedicated subdomain like `hireic.renlab.ai` with its own MX records
   pointing at Cloudflare. Requires a Cloudflare zone delegation or NS subdomain
   approach. Lower risk to existing mail; cleaner separation.
3. Use ImprovMX (free, 25 aliases) on a subdomain like `relay.renlab.ai`.
4. Manual relay for v1: founder reads the candidate issue, contacts the candidate
   directly when a recruiter expresses interest. Zero infra.

**Recommendation**: option 2 (`hireic.renlab.ai` subdomain) when the first
hidden-mode candidate lands. Until then, candidates set `contact_value:
relay-pending` and the founder handles introductions manually.
