# hireIC Schema v0.1

人读的字段规范. 机器读的版本是
[`schemas/agent-jobs.schema.json`](./schemas/agent-jobs.schema.json) (JSON Schema Draft 2020-12),
两个版本字段必须一致.

每一份 job 都是 `jobs/<slug>.md`, 首部是 YAML frontmatter (本文档定义的字段),
后面是 markdown body (自由文本). Agent 和聚合器只读 frontmatter, body 给人看.

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
| `contact_value` | string, 1-200 字符 | 招聘方联系方式, 默认公开. | `jobs@acme.com` |

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

- hireIC 只发布职位, 没有候选人 profile. 用 `apply_url` / `contact_value` 指引人去投递,
  投递走招聘方自己的渠道, 不要尝试代投.
- `cc_required` 恒为 `true`: 这里的职位都**要求** cc 熟练度, 不是把 cc 当加分项.
- 不要把 hireIC job 字段对应到公司 ATS 系统的字段, 这是不同模型.

### 校验只管格式, 不管真假 (advisory 层)

机器校验 (`validate.yml`) 只验**格式**: 字段齐不齐、类型对不对、有没有 PII. 它**不**判断
内容真假——`company` 可填假名、`apply_url` 可贴任意链接. 这些都会**校验通过**.
真伪的最终判断仍在 founder `/approve` 时人工过目和下游消费 agent.

**安全约束**: validator 只请求固定可信 host (`api.github.com`), **绝不**在服务端抓取
用户提供的 URL (如 `apply_url`)——那是 SSRF, 攻击者可让 CI runner 去打内网/元数据
端点. `apply_url` 的可达性由 founder 在 `/approve` 时人工过目, 不做自动抓取.
