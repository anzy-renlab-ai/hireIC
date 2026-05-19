# Maintainers

hireIC 当前是单一 founder 项目, 但目标是有 2-3 个可信 co-maintainer
(eng-review F3 / Vision Risk #3: founder SPOF).

## 当前

| GitHub | 角色 | 范围 |
|---|---|---|
| (待填: founder) | founder | 所有 |

## 招募节奏

- 月 1-2: 仅 founder. 验证流程, 收前 5-10 个 candidate PRs.
- 月 3+: 从 γ 路线 (人肉 broker) 接触过的 2 个可信开发者中邀请 co-maintainer.
- co-maintainer 加入门槛:
  - 自己已是 hireIC 候选人或已用过 hireIC 招过人
  - 同意 [CONTRIBUTING.md](./CONTRIBUTING.md) TDD 纪律
  - 通过 1 个真实 PR 审批 (我审他, 看判断力)

## Co-maintainer 权限

- 可 `/approve` issue → 触发 convert-to-pr workflow
- 可 merge schema / scripts / workflows 的非破坏性 PR
- 不可改 `schemas/*.schema.json` 破坏性内容 (bump schema_version) 不经 founder 同意
- 不可改 `.github/workflows/*.yml` 的 `permissions:` 块 (security guardrail)

## 卸任 / 替换

founder 退出时, 把 repo 转给最早的 co-maintainer 或选定的承继人, 维护 SCHEMA.md
版本注释. 协议本身设计成去中心: 即使 founder 消失, 任何人能 fork 仓库 + 重启 registry,
schema 不绑定 hireIC 仓库地址.
