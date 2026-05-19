// Friendly bot comments per design review: transparent (says "automated"),
// specific (names each failing field), actionable (gives examples), anti-shame
// (always closes with "不限次数 retry"). Chinese primary, English secondary.

import type { FieldError, PIIHit } from "./issue-parser.js";

const TRANSPARENCY_HEADER = "(自动校验, 不是 founder 本人)";
const RETRY_FOOTER =
  "修改完点 **Edit** 重提交, 校验会重跑. 不限次数 🙏 · Edit and re-submit, the bot will re-validate. No retry limit.";
const SCHEMA_LINK = "字段说明: [SCHEMA.md](https://github.com/baidu/hireIC/blob/main/SCHEMA.md)";

function bullet(err: FieldError): string {
  const lead =
    err.kind === "policy"
      ? `❌ **policy** \`${err.field}\` — 不在 hireIC 范围`
      : `❌ \`${err.field}\``;
  const example = err.example ? `\n   例: \`${err.example}\`` : "";
  return `${lead}\n   ${err.message}${example}`;
}

export function renderValidationErrorComment(errors: FieldError[]): string {
  const lines = errors.map(bullet).join("\n\n");
  return [
    TRANSPARENCY_HEADER,
    "",
    "嗨, 感谢提交. 还差一点点信息:",
    "",
    lines,
    "",
    SCHEMA_LINK,
    "",
    RETRY_FOOTER,
  ].join("\n");
}

export function renderValidationSuccessComment(kind: "candidate" | "job"): string {
  const subject = kind === "candidate" ? "候选人 profile" : "招聘职位";
  return [
    TRANSPARENCY_HEADER,
    "",
    `✅ 校验通过. 你的${subject}已加上 \`pending-review\` 标签, 等 founder 审 (通常 24h 内).`,
    "",
    "若 founder 评 `/approve`, 会自动生成 markdown 文件 + auto-merge.",
    "若 founder 评具体反馈, 你可以继续编辑这个 issue.",
  ].join("\n");
}

function maskMobile(s: string): string {
  if (s.length < 7) return s;
  return s.slice(0, 3) + "****" + s.slice(-4);
}

function maskIdCard(s: string): string {
  if (s.length < 8) return s;
  return s.slice(0, 4) + "**********" + s.slice(-4);
}

function maskHit(hit: PIIHit): string {
  switch (hit.kind) {
    case "mobile_cn":
      return maskMobile(hit.match);
    case "id_card_cn":
      return maskIdCard(hit.match);
    default:
      return "****";
  }
}

function describeKind(kind: PIIHit["kind"]): string {
  switch (kind) {
    case "mobile_cn":
      return "手机号";
    case "id_card_cn":
      return "身份证号";
    default:
      return "敏感信息";
  }
}

export function renderPIIRejectionComment(hits: PIIHit[]): string {
  const items = hits.map((h) => `- ${describeKind(h.kind)} (\`${maskHit(h)}\`)`).join("\n");
  return [
    TRANSPARENCY_HEADER,
    "",
    "🛑 **检测到 PII (敏感个人信息)**. 这是公开 issue, 一旦合并进 git 历史就**永久可见**, 所以我先拒绝这次提交.",
    "",
    "发现:",
    items,
    "",
    "请修改 issue 把这些信息删掉, 再重提. 联系方式用邮箱/微信 ID/Twitter handle 即可, 不要写手机号或身份证.",
    "",
    SCHEMA_LINK,
    "",
    RETRY_FOOTER,
  ].join("\n");
}
