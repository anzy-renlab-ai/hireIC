<!-- 招聘 / 应聘者: 不要直接开 PR. 走 Issue Forms:
     - 候选人申请: https://github.com/baidu/hireIC/issues/new?template=candidate.yml
     - 发布职位:   https://github.com/baidu/hireIC/issues/new?template=job.yml
     这个 PR 模板是给改 schema / scripts / workflows 的 contributor 用的. -->

## 改了什么

<!-- 一段话概括. -->

## 影响范围

- [ ] schema (`schemas/*.json` 或 `SCHEMA.md`)
- [ ] MCP server (`mcp-server/`)
- [ ] GitHub Actions / workflows (`.github/workflows/*`, `scripts/*`)
- [ ] 文档 (`README.md`, `CONTRIBUTING.md`, `MAINTAINERS.md`, `TODOS.md`)
- [ ] 测试 only

## TDD 自检

- [ ] 失败测试已先写, 跑过 red
- [ ] 实现让它转绿
- [ ] `npx vitest run` 全绿
- [ ] `npx tsc --noEmit` 干净

## 破坏性变更?

- [ ] 否
- [ ] 是: bump 了 `schema_version` 并在 SCHEMA.md 加 migration note

## Schema 三处同步 (仅当改 schema)

- [ ] `schemas/*.schema.json` 改了
- [ ] `SCHEMA.md` 同步了
- [ ] `.github/ISSUE_TEMPLATE/*.yml` 同步了
- [ ] `scripts/issue-parser.ts` 同步了 (字段 map + types)

## Workflow security (仅当改 .github/workflows/)

- [ ] `permissions:` 块仍是显式最小集
- [ ] 写 main 的 workflow 有 `concurrency:`
- [ ] 业务逻辑在 `scripts/*.ts` 里有对应单测, YAML 只做 wiring
