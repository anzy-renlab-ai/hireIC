# Contributing to hireIC

hireIC 是协议优先项目. 大多数"contribution"是发职位 (通过
[Issue Forms](../../issues/new/choose)), 不是 PR.

本文档面向想动 schema / scripts / workflows 的人.

---

## 项目结构

```
hireIC/
├── README.md
├── SCHEMA.md                          # 人读 schema 规范
├── schemas/                           # JSON Schema (canonical)
│   └── agent-jobs.schema.json
├── mcp-server/                        # MCP server (npx + 未来 Workers)
│   ├── src/handlers.ts                # 核心读 markdown 逻辑
│   ├── src/github-fetcher.ts          # GitHub Contents API + 5min cache
│   ├── src/mcp-tools.ts               # MCP tool 描述符 + dispatcher
│   └── src/local.ts                   # stdio MCP entry (npx hireic-mcp)
├── scripts/                           # GitHub Actions helper scripts
│   ├── issue-parser.ts                # GH Issue Form 解析 + payload 校验 + PII 检测
│   ├── bot-comments.ts                # 友好报错 / 成功 / PII 拒绝评论模板
│   ├── validate-issue.ts              # validate.yml 调用
│   ├── md-generator.ts                # 生成 jobs/<x>.md
│   ├── convert-issue.ts               # /approve 判定逻辑
│   ├── convert-runner.ts              # convert-to-pr.yml 调用
│   ├── update-counts.ts               # README counter 重建逻辑
│   └── update-counts-runner.ts        # update-counts.yml 调用
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── job.yml
│   │   └── config.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/
│       ├── validate.yml               # Issue 提交 → 校验 + bot 评论
│       ├── convert-to-pr.yml          # /approve → 转成 markdown 文件 + auto-merge
│       └── update-counts.yml          # main 合并 → README counter 重算
├── jobs/                              # 真实职位 (自动维护)
└── tests/                             # 单元 + 集成测试
    ├── schema/
    └── workflows/
```

---

## TDD 是硬性纪律

**所有代码改动必须先写失败测试**. 不接受"我先实现再补测试".

流程:

```bash
# 1. 写一个 .test.ts 描述你想要的行为
# 2. 跑 npx vitest, 看红
# 3. 写最小实现让它转绿
# 4. 重构 (可选), 仍然绿
# 5. PR
```

如果你的改动**没有可测试的行为** (e.g. 改文案, 改 README), 那 PR 描述里说明
"非行为变更, 无测试".

测试入口:
- 全跑: `npx vitest run`
- 仅 schema: `npx vitest run tests/schema`
- 仅 MCP: `npx vitest run mcp-server/src`
- 仅 workflows: `npx vitest run tests/workflows`

类型: `npx tsc --noEmit` 必须干净.

---

## 改 schema 的特殊纪律

schema 是 hireIC 的 IP. 改动:

1. 改 `schemas/agent-jobs.schema.json`
2. 同步 `SCHEMA.md`
3. 同步 `.github/ISSUE_TEMPLATE/job.yml`
4. 同步 `scripts/issue-parser.ts` 的字段 map + TypeScript types
5. 同步 `mcp-server/src/handlers.ts` 的 TypeScript types
6. 全 `npx vitest run` 跑一遍, 必须全绿
7. 破坏性变更 (rename / delete / type change) → bump `schema_version` 数字, 添加 migration 说明到 `SCHEMA.md`

---

## 改 workflow 的特殊纪律

GitHub Actions YAML 文件改动:

1. 业务逻辑写在 `scripts/*.ts` 里, 不写在 YAML 里. YAML 只做 wiring.
2. workflow 必须显式声明 `permissions:` 块, 最小集. 不要继承默认.
3. 任何写 `main` 分支的 workflow 必须有 `concurrency: group: <name>, cancel-in-progress: false`,
   避免并发推送 race.
4. workflow 调用的脚本必须有对应的 `.test.ts` (entry point 不强制, 但被调用的纯函数强制).

---

## Commit 风格

不强制 conventional commits 但鼓励. 至少:
- `feat: ...` — 新功能
- `fix: ...` — bug 修复
- `chore: ...` — 维护类 (deps, config)
- `docs: ...` — 文档
- `refactor: ...` — 非功能性结构变更

机器人提交 (e.g. update-counts) 一律 `chore: update README counts`.

---

## 性格 / Voice

hireIC 文档语气**直接, 不浮夸**. 不写"赋能", "全方位", "next-gen". 不堆 emoji.
中文优先, 英文双轨. 友好但不谄媚.

bot 评论一律开头 `(自动校验, 不是 founder 本人)`. 不要把 bot 写得像 founder 在回话.
