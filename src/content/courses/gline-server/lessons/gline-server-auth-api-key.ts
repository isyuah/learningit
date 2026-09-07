/* ==================================================================
 * 课时：API key 认证：prefix.secret 与 HMAC（gline-server-auth-api-key）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-auth-api-key",
  courseSlug: "gline-server",
  title: "API key 认证：prefix.secret 与 HMAC",
  summary: "一把 key 为什么是 prefix.secret？库里为什么只存 HMAC？认证的每一步在防什么？",
  minutes: 18,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "Gline 没有用户表、没有密码。人、Agent、查询程序统一用 API key（或安装期 bootstrap token）说话。这一课拆解一把 key 从创建到认证通过的完整生命周期，以及每个设计决策对应的威胁。",
    },
    {
      type: "heading",
      text: "为什么是 prefix.secret 两段式",
    },
    {
      type: "paragraph",
      text: "API key 的格式是 prefix.secret（代码在 internal/server/auth/authenticator.go 的 ParseKey）。prefix 是「可查询的索引」，secret 是「真正的机密」。创建时（control/service.go:210 附近）：prefix = \"glk_\" + uuid 前 12 位，secret = 随机 32 字节的 base64url，**secret 只在创建响应里出现一次**（dto.go 有专门测试断言列表/详情不序列化 Secret）。",
    },
    {
      type: "list",
      items: [
        "prefix：4-128 字符，字符集 [A-Za-z0-9_-]，用于在数据库里快速定位候选 key。",
        "secret：16-512 字符，真正的口令，服务端不可逆存储。",
        "为什么分开：认证时先用 prefix 查库（走索引），缩小到几个候选，再对候选做机密比对——避免全表扫描所有 key 做 HMAC。",
      ],
    },
    {
      type: "heading",
      text: "认证流程：ParseKey → 查候选 → 常量时间比对",
    },
    {
      type: "paragraph",
      text: "authenticate() 中间件拿到 Bearer token 后，若不是 bootstrap，就调 Authenticator.Authenticate（authenticator.go:100-131）。完整步骤：",
    },
    {
      type: "code",
      title: "Authenticate 的实现骨架",
      language: "go",
      code: "func (a *Authenticator) Authenticate(ctx, raw string) (Principal, error) {\n    prefix, secret, err := ParseKey(raw)          // 格式校验\n    candidates, err := a.keys.FindActiveByPrefix(ctx, prefix, now)\n        // SQL: WHERE prefix=$1 AND status='active' AND 未过期\n\n    want := HashSecret(secret, a.pepper)          // HMAC-SHA256(pepper, secret)\n    for i := range candidates {\n        matched := subtle.ConstantTimeCompare(want[:], candidate.SecretHash)\n        usable  := subtle.ConstantTimeByteEq(byte(boolInt(candidate.UsableAt(now))), 1)\n        if matched&usable == 1 {\n            if match >= 0 {\n                return ErrInvalidCredential       // 多候选命中 => 拒绝（防多租户身份）\n            }\n            match = i\n        }\n    }\n    ...\n}",
    },
    {
      type: "callout",
      variant: "warning",
      title: "两个安全细节",
      body: "第一，库里不存 secret 明文或简单哈希，只存 HMAC-SHA256(pepper, secret)——pepper（GLINE_API_KEY_PEPPER）是独立于数据库的密钥，DB 泄露不足以反推 key。第二，所有比对用 subtle.ConstantTimeCompare（常量时间），长度异常的候选也做 dummy 比较，防时序侧信道。",
    },
    {
      type: "heading",
      text: "bootstrap token：第二身份",
    },
    {
      type: "paragraph",
      text: "除 API key 外还有 bootstrap token（安装期管理员，来自 .env 的 GLINE_BOOTSTRAP_TOKEN）。它走 middleware 里的 secureEqual 常量时间字符串比对，不查库；Principal 是代码直接构造的（bootstrapPrincipal），持有全部 scope，但 project 是占位 UUID（middleware.go 的 bootstrapProjectID）。关键限制：bootstrap **不能 ingest**（ingestBatch handler 显式拒绝，handlers.go:370），创建项目时必须显式带 project_id。",
    },
    {
      type: "table",
      caption: "两种身份凭证对比",
      headers: ["维度", "API key", "Bootstrap token"],
      rows: [
        ["持有者", "Agent、查询程序、控制台", "安装期管理员"],
        ["认证", "查 api_keys 表 + HMAC 常量时间比对", "常量时间字符串比对（不查库）"],
        ["归属", "恰好一个 project", "所有 project（跨租户）"],
        ["能力", "看 scope", "全部 scope"],
        ["限制", "无", "不能 ingest；建项目须显式带 project_id"],
      ],
    },
    {
      type: "heading",
      text: "生命周期与吊销",
    },
    {
      type: "paragraph",
      text: "key 状态机：active →（吊销）revoked /（到期）expired（domain/status.go）。吊销是软删 UPDATE status='revoked'，并在同一事务写审计事件。UsableAt(now) = status=active 且未过期；没有独立 activation 字段——创建即生效。",
    },
    {
      type: "quiz",
      question: "认证时为什么先用 prefix 查库、再对候选做 HMAC 比对，而不是对库里所有 key 做 HMAC？",
      options: [
        "因为 prefix 是唯一的，查出来只有一个候选",
        "为了用索引缩小候选集，避免全表做 HMAC 比对",
        "因为 HMAC 只能对 prefix 计算，不能对 secret 计算",
        "为了支持一把 key 同时属于多个项目",
      ],
      answer: 1,
      explanation:
        "prefix 是数据库索引列。先用 prefix 查出少量候选（FindActiveByPrefix），再对候选逐个做常量时间 HMAC 比对。如果对全表所有 key 做 HMAC，每次认证都是全表扫描，成本不可接受。注意 prefix 不唯一（所以返回候选数组），但高度选择。",
    },
    {
      type: "keypoints",
      items: [
        "key = prefix.secret；prefix 可查、secret 机密且只显示一次。",
        "库中只存 HMAC-SHA256(pepper, secret)，pepper 独立于 DB。",
        "比对全部常量时间；多候选命中即拒绝。",
        "bootstrap token 是第二身份：全 scope、跨租户、不能 ingest。",
      ],
    },
  ],
};
