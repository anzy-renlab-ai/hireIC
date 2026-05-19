# hireIC Schema v0.1

人读的字段规范. 机器读的版本是 [`schemas/agent-cv.schema.json`](./schemas/agent-cv.schema.json)
和 [`schemas/agent-jobs.schema.json`](./schemas/agent-jobs.schema.json) (JSON Schema Draft 2020-12),
两个版本字段必须一致.

每一份 candidate / job 都是 `candidates/<github>.md` 或 `jobs/<slug>.md`,
首部是 YAML frontmatter (本文档定义的字段), 后面是 markdown body (自由文本).
Agent 和聚合器只读 frontmatter, body 给人看.

---

## agent-cv (候选人)

文件路径: `candidates/<github_username>.md`

### 必填字段 (Required)

| 字段 | 类型 | 说明 | 例 |
|---|---|---|---|
| `schema_version` | `"0.1"` (字符串字面量) | 协议版本. v0 时只接受 `"0.1"`. | `"0.1"` |
| `github_username` | string, 1-39 字符, `[A-Za-z0-9-]+` | GitHub 登录名 (不带 @), 必须真实存在. 文件名也由此而来. | `alicelu` |
| `cc_experience_months` | integer, 0-600 | 用 Claude Code (或同类 agent) 当日常 driver 多少个月. | `12` |
| `evidence_url` | URL, `http(s)://...` | 一条**公开可访问**的证据, 证明候选人 cc 用得好. 不接受 LinkedIn 资料/微博等需登录的链接. | `https://github.com/alicelu/proj/pull/42` |
| `contact_mode` | enum `public` / `hidden` | 联系方式公开度. `hidden` 用于在职大厂员工. | `public` |
| `contact_value` | string, 1-200 | `public`: 真实邮箱/微信ID/Twitter handle. `hidden`: `relay-pending` (founder 后期签发 `relay-<github>@hireic.<domain>` alias). | `alice@example.com` |

### 可选字段 (Optional)

| 字段 | 类型 | 说明 |
|---|---|---|
| `bio_zh` | string, ≤500 字符 | 中文一句话介绍. 别写营销词. |
| `bio_en` | string, ≤500 字符 | 英文版. |
| `looking_for` | enum | `full-time` / `contract` / `open-to-talk` / `not-looking`. |
| `salary_range_rmb` | string, ≤50 字符 | 自由格式, e.g. `40-60k/mo` 或 `600-900k/yr`. |
| `location` | string, ≤100 字符 | 城市 / 远程偏好. |
| `referrer_github` | string, 同 github_username 规则 | 推荐人 GitHub username. 必须搭配 `referrer_evidence_pr_url`. |
| `referrer_evidence_pr_url` | URL | 推荐人附的"我见过这人 cc 用得好"的具体 PR/repo. |
| `agent_stack` | string, ≤200 字符 | 主用工具. e.g. `cc + Cursor + 自建 MCP server`. |
| `available_from` | string (YYYY-MM-DD) | 可入职日期. |

### Hidden mode 详解

候选人选 `contact_mode: hidden` 表示**不想公开真实联系方式**, 典型是在职大厂员工不希望搜得到.

流程:
1. 候选人提交 issue, `contact_value` 填 `relay-pending` (或任何值, validator 会强制改写)
2. founder /approve → candidate 文件落 main, `contact_value: relay-pending`
3. 招聘方在 MCP / repo 看到 candidate 想联系
4. founder 手动签发 alias: 在 [CF Email Routing](https://developers.cloudflare.com/email-routing/) 配置
   `relay-<github>@hireic.<domain>` → 转发到 founder 邮箱
5. 招聘方写信到 alias → 转 founder → founder 询问候选人是否愿意公开 → 候选人同意后转
6. 候选人主动回复, 双方点对点

founder 是 hub 但只在第一次配 alias 时介入, 后续邮件自动转发, 不阻塞.

---

## agent-jobs (职位)

文件路径: `jobs/<company-slug>-<role-slug>-<YYYY-MM>.md` (slug 用 pinyin 转写, 由 `convert-to-pr` 自动生成)

### 必填字段 (Required)

| 字段 | 类型 | 说明 | 例 |
|---|---|---|---|
| `schema_version` | `"0.1"` | 同上. | `"0.1"` |
| `company` | string, 1-200 字符 | 公司名. | `Acme` |
| `role_title_zh` | string, 1-200 字符 | 中文职位名. **必填** (主受众中文). | `全栈工程师 (cc-fluent)` |
| `cc_required` | boolean | **必须 `true`**. cc 只是加分项的职位不接受 (走 LinkedIn / Boss). | `true` |
| `apply_url` | URL | 投递链接. 公司主页 / 招聘网站 / 个人邮箱皆可, 必须是 URL. | `https://acme.com/jobs/123` |
| `contact_value` | string, 1-200 字符 | 招聘方联系方式. 不走 hidden mode (招聘方默认公开). | `jobs@acme.com` |

### 可选字段 (Optional)

| 字段 | 类型 | 说明 |
|---|---|---|
| `role_title_en` | string, 1-200 | English title (用于英文受众和文件 slug 优先选这个). |
| `salary_range_rmb` | string, ≤50 | e.g. `50-80k/mo`. |
| `employment_type` | enum | `full-time` / `contract` / `internship` / `consulting`. |
| `location` | string, ≤100 | 城市. |
| `remote_policy` | enum | `onsite` / `remote-friendly` / `remote-only`. |
| `open_until` | string (YYYY-MM-DD) | 招聘截止. |
| `description_zh` | string, ≤2000 | 中文 JD 摘要. 长 JD 放 `apply_url`. |
| `description_en` | string, ≤2000 | English JD summary. |
| `status` | enum `open` / `closed` | 默认 `open`. 招满后改 `closed`, 不删. |

---

## 单一来源原则

JSON Schema (`schemas/*.schema.json`) 是 canonical. SCHEMA.md (本文档) 和 Issue Form
模板 (`.github/ISSUE_TEMPLATE/*.yml`) 都是它的衍生. 改字段时:

1. 改 `schemas/*.schema.json` + 测试
2. 改 SCHEMA.md 同步本节
3. 改 Issue Forms 同步字段顺序 + label
4. 全 `npx vitest run` 跑一遍

未来计划: 写一个 `scripts/check-schema-sync.ts`, CI 阶段对比三个来源是否一致.

---

## 版本演进

| 版本 | 状态 | 日期 | 变更 |
|---|---|---|---|
| 0.1 | **active** | 2026-05-19 | 初版 |

破坏性变更 (字段重命名, 删除, 类型变化) → bump `schema_version`. 新增可选字段 →
不需要 bump (向后兼容). MCP `list_*` 输出包含 `schema_version`, 消费者可分支处理.

---

## 给 agent 的提示 (LLM consumer guidance)

如果你是一个 agent (Claude / Cursor / 别的), 你正在读 hireIC 数据, 注意:

- `contact_mode: hidden` 的候选人, **不要**尝试从 `evidence_url` / `referrer_evidence_pr_url`
  反推真实邮箱或姓名. 这是协议合约的一部分: 联系方式只能走 relay alias.
- `cc_experience_months` 是自报数字, 不是认证. **必须配合 `evidence_url` 内容判断**.
  若 evidence 中的 git 历史跨度短于 `cc_experience_months` 月, 视为不可信.
- 推荐人字段 (`referrer_*`) 若存在, 视为 +1 信号但不替代候选人本人证据.
- 不要把 hireIC profile 字段对应到公司 ATS 系统的字段, 这是不同模型. 用 `apply_url`
  指引候选人投递, 不要尝试代投.
