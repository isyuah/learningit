/* ==================================================================
 * 课时：Scope 授权与租户隔离（gline-server-scope-tenant）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-scope-tenant",
  courseSlug: "gline-server",
  title: "Scope 授权与租户隔离",
  summary: "一把 key 为什么只能访问一个 project？Principal 的三个 Require 如何构成租户墙？",
  minutes: 16,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "认证回答「你是谁」，授权回答「你能做什么、碰哪些数据」。Gline 的授权模型极简但硬：一把 key 绑定恰好一个 project，scope 决定能调哪些接口。这一课拆开 Principal 与三个 Require，看租户隔离为什么「硬」。",
    },
    {
      type: "heading",
      text: "Principal：认证后的身份卡",
    },
    {
      type: "paragraph",
      text: "认证通过后，中间件把 Principal 注入 gin context（middleware.go 的 principal(c) 取出）。Principal 结构（auth/principal.go）：",
    },
    {
      type: "code",
      title: "Principal 定义",
      language: "go",
      code: "type Principal struct {\n    KeyID     domain.APIKeyID     // 哪把 key\n    ProjectID domain.ProjectID    // 租户边界（关键）\n    AgentID   *domain.AgentID     // 可选：key 是否绑定特定 agent\n    Scopes    map[domain.Scope]struct{}  // 权限集合\n}",
    },
    {
      type: "heading",
      text: "Scope：15 个权限位",
    },
    {
      type: "paragraph",
      text: "scope 是并集语义（一把 key 可勾多个），定义在 domain/status.go。三大类：数据面（ingest、query）、管理面（project:read/write、key:manage、agent:read/write、pipeline:read/write）、治理面（retention:manage、quarantine:read/replay、audit:read、alerts:manage、channels:manage）。注意没有 usage scope——用量接口由 project:read 覆盖。",
    },
    {
      type: "heading",
      text: "三个 Require：能力、租户、归属",
    },
    {
      type: "paragraph",
      text: "handler 开头调 principal.Require(scope) 做能力检查，涉及 :projectID 的接口再走 projectPrincipal()（middleware.go:178-197），它把「能力 + 租户」一次做完。Principal 的三个方法各防一类越权：",
    },
    {
      type: "table",
      caption: "三个 Require 的语义",
      headers: ["方法", "检查", "失败错误", "防什么"],
      rows: [
        ["Require(scope)", "有某权限位", "ErrScopeDenied → 403 scope_denied", "越权调接口"],
        ["RequireProject(id)", "ProjectID == 目标 project", "ErrProjectMismatch → 403 tenant_mismatch", "跨租户读写"],
        ["RequireAgent(id)", "绑定的 AgentID 匹配（未绑定=任意）", "ErrAgentMismatch → 403 tenant_mismatch", "拿 A 的 key 操作 B 的 agent"],
      ],
    },
    {
      type: "heading",
      text: "租户隔离为什么「硬」：projectPrincipal 的机关",
    },
    {
      type: "paragraph",
      text: "普通 key 的 ProjectID 在创建 key 时就锁死了——createKey handler 先经 projectPrincipal 拿到已锁定租户的 p，再以 p.ProjectID 构造 key（handlers.go:138-159）。此后任何带 :projectID 的请求,若指向别的 project,RequireProject 直接 403。",
    },
    {
      type: "callout",
      variant: "example",
      title: "bootstrap 的「借用」机制",
      body: "projectPrincipal 对 bootstrap 有特殊分支：isBootstrap(c) 时直接把 p.ProjectID 改成路径里的 projectID（middleware.go:186-190）。这就是 bootstrap 能跨项目管理的方式——不是「一把 key 多租户」，而是「每个请求临时借用目标租户」。普通 key 没有这个分支，永远锁死在自己的 project。",
    },
    {
      type: "paragraph",
      text: "除了应用层的 RequireProject，数据层还有第二道墙：所有表的主键/外键都带 project_id（如 ingest_batches 的 PK 是 (project_id, id)，log_entries 的复合外键含 project_id）。即使未来某个 handler 漏了检查，SQL 层也无法跨租户读写——纵深防御。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "一个常见的面试追问",
      body: "「为什么一把 key 不能访问多个 project？」答案是刻意设计（自托管单管理员不需要），不是缺陷。演进路径是引入 user 实体或多 project 绑定，但当前「key 绑定单 project」让租户隔离的论证变得极简单：ProjectID 在 Principal 里，Principal 来自 key，key 创建时锁定。",
    },
    {
      type: "exercise",
      title: "追踪一次跨租户攻击为什么失败",
      description:
        "假设你拿到 A 项目一把 scope=query 的 key。尝试调用 GET /api/v1/projects/B/retention（B 是另一项目）。逐层说明：哪个中间件/方法会在哪一步拒绝，返回什么 code？",
      hint: "先看 handler 是否调 projectPrincipal，再看 RequireProject 的比对。",
    },
    {
      type: "quiz",
      question: "一把 scope=query 的 API key，能调用 POST /api/v1/batches 吗？",
      options: [
        "能，因为 key 有效",
        "不能，缺少 ingest scope，返回 403 scope_denied",
        "不能，但返回 401 invalid_credential",
        "能，但只会写入自己的 project",
      ],
      answer: 1,
      explanation:
        "ingestBatch handler 会先 principal.Require(ScopeIngest)。这把 key 只有 query scope，缺 ingest，所以 Require 失败返回 ErrScopeDenied → HTTP 403 code=scope_denied。scope 是接口级门禁，与 key 是否有效无关。",
    },
    {
      type: "keypoints",
      items: [
        "Principal = KeyID + ProjectID + 可选 AgentID + Scopes。",
        "Require(scope) 管能力，RequireProject/RequireAgent 管租户与归属。",
        "普通 key 的 ProjectID 创建时锁死；bootstrap 靠每请求借用目标租户。",
        "数据层所有表带 project_id，形成第二道租户墙。",
      ],
    },
  ],
};
