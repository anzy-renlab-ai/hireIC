# hireIC

cc-fluent IC. 用 agent 干活. 招聘. 协议优先.

LinkedIn 没法筛"会用 Claude Code 的人". 这个 repo 是答案 —
一份机器可读的 schema + 一个零基础设施的中心注册表, 让公司发现真正用 agent
干活的 IC, 让 IC 用一份 profile 在多个聚合器之间通用.

<!-- counts -->
**目前 1 个职位 · 0 个候选人**
<!-- /counts -->

---

## 入口

- **我是 cc 用户, 我想被发现** → [候选人申请](../../issues/new?template=candidate.yml)
- **我招 cc 用户** → [发布职位](../../issues/new?template=job.yml)
- **我想知道这是啥** → [SCHEMA.md](./SCHEMA.md) · [TODOS.md](./TODOS.md)

---

## 协议优先 means what

公司在自己 GitHub repo 挂 `jobs/*.md` (frontmatter 符合 `agent-jobs.schema.json`).
候选人挂 `candidates/<github>.md` (符合 `agent-cv.schema.json`).
任何 agent / 聚合器 / 网站可以 import. hireIC 仓库是其中一个聚合器,
不是唯一. 见 [SCHEMA.md](./SCHEMA.md).

## agent 原生使用

```bash
# 本地, 通过 stdio MCP
npx hireic-mcp

# 远程 HTTP MCP (CF Workers)
# https://hireic-mcp.<domain>/
```

Tools: `list_jobs` · `list_candidates` (read-only, schema-compliant JSON).

## 价值观

零基础设施. 零自研轮子. 中文优先, 英文双轨. 候选人验证靠 evidence URL, 不靠自报.
founder 自己是首个客户.

## License

MIT. 见 [LICENSE](./LICENSE).
