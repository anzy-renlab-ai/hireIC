# hireIC

要求 cc 熟练度的岗位. 公开职位板. 协议优先.

LinkedIn 没法筛"招会用 Claude Code 的岗位". 这个 repo 是答案 —
一份机器可读的 schema + 一个零基础设施的公开职位板, 公司发布 *要求* cc 熟练度的职位,
任何 agent / 聚合器都能读.

<!-- counts -->
**目前 1 个职位**
<!-- /counts -->

---

## 入口

- **我招 cc 用户** → [发布职位](../../issues/new?template=job.yml)
- **我是 cc 用户, 我想投递** → 直接看职位的 `apply_url` / 联系方式, 私下带着你真实的 cc 作品 (PR / gist / repo) + GitHub 投递. 本 repo 不收候选人 profile.
- **我想知道这是啥** → [SCHEMA.md](./SCHEMA.md) · [TODOS.md](./TODOS.md)

---

## 协议优先 means what

公司在自己 GitHub repo 挂 `jobs/*.md` (frontmatter 符合 `agent-jobs.schema.json`).
任何 agent / 聚合器 / 网站可以 import. hireIC 仓库是其中一个聚合器,
不是唯一. 见 [SCHEMA.md](./SCHEMA.md).

## agent 原生使用

```bash
# 本地, 通过 stdio MCP
npx hireic-mcp

# 远程 HTTP MCP (CF Workers)
# https://hireic-mcp.<domain>/
```

Tools: `list_jobs` (read-only, schema-compliant JSON).

## 候选人怎么投

候选人没有公开 profile, 也不通过本 repo 提交. 投递是私下的: 看中某个职位,
带着你真实的 cc 作品 (一个 PR / gist / repo) + 你的 GitHub, 直接走职位的
`apply_url` / 联系方式投给招聘方. cc 熟练度的判断是"防君子不防小人" —
真实作品给出的合理信号, 不是一套不可伪造的系统, 最终由招聘方自己看。

> agent 原生投递 + 自动 cc-signal 打分是 **未来/在建** 的方向, 现在还没做.

## 价值观

零基础设施. 零自研轮子. 中文优先, 英文双轨. founder 自己是首个客户.

## License

MIT. 见 [LICENSE](./LICENSE).
