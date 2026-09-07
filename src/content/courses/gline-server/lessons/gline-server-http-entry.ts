/* ==================================================================
 * 课时：请求入口：路由、中间件与错误信封（gline-server-http-entry）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-http-entry",
  courseSlug: "gline-server",
  title: "请求入口：路由、中间件与错误信封",
  summary: "一个请求从网线到 handler 之间发生了什么？错误如何被统一成带 code 的信封？",
  minutes: 16,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "这一课看 HTTP 层本身：路由怎么组织、中间件按什么顺序执行、错误怎么被统一序列化。它是后面所有业务课的共同入口——无论摄取、心跳还是查询，请求都先过同一道闸。",
    },
    {
      type: "heading",
      text: "路由装配：三组路径，三种保护",
    },
    {
      type: "paragraph",
      text: "路由在 httpapi/router.go 的 Router() 中装配。gin.New() 后先挂三个全局中间件：requestID（给每个请求一个 ID）、recovery（panic 恢复）、cors。然后是健康检查路径 /healthz、/livez、/readyz（不需认证）。业务路径全部挂在 /api/v1 组下，并统一挂上 authenticate() 中间件（router.go:59-66）。",
    },
    {
      type: "code",
      title: "路由分组结构（router.go）",
      language: "text",
      code: "gin.New()\n  .Use(requestID, recovery, cors)\n  GET /healthz | /livez | /readyz        # 无认证\n\n  /api/v1 group\n    .Use(authenticate)                    # 所有业务请求先认证\n    POST /batches                         # ingest\n    GET  /entries                         # query\n    GET  /projects ...                    # control\n    POST /agents/:agentID/heartbeat       # control\n    ...",
    },
    {
      type: "heading",
      text: "中间件顺序：requestID → recovery → cors → authenticate",
    },
    {
      type: "list",
      items: [
        "requestID：生成或透传 X-Request-ID，放进 context，错误响应里带回（方便日志关联）。",
        "recovery：捕获 handler panic，记日志并返回 500，不让进程崩溃。",
        "cors：按配置的白名单 origin 放行（开发时 Console 同源反代，几乎用不到）。",
        "authenticate：解析 Bearer token → Principal 注入 context；后续 handler 用 principal(c) 取身份。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么错误响应总带 request_id",
      body: "writeError 统一输出 {\"error\":{\"code\":...,\"message\":...,\"request_id\":...}}。这个 request_id 与访问日志里的是同一个——排障时拿着用户报错里的 request_id 就能在服务端日志定位到那次请求。",
    },
    {
      type: "heading",
      text: "错误信封：mapError 与稳定契约",
    },
    {
      type: "paragraph",
      text: "httpapi/errors.go 的 mapError 把各种 sentinel error 映射成「HTTP 状态码 + 业务 code」的稳定契约。这对 Agent 极其重要——Agent 的 transport.go 正是靠这些 code 分类（accepted/duplicate/retryable/quarantine/terminal）。一个错误码表节选：",
    },
    {
      type: "table",
      caption: "错误映射核心条目（errors.go:79-119）",
      headers: ["错误", "HTTP", "code", "Agent 侧含义"],
      rows: [
        ["ErrInvalidCredential", "401", "invalid_credential", "terminal（配置错）"],
        ["ErrScopeDenied", "403", "scope_denied", "terminal"],
        ["ValidationError", "422", "invalid_batch", "quarantine（批坏了）"],
        ["ErrIdempotencyConflict", "409", "idempotency_conflict", "terminal（客户端 bug）"],
        ["ErrProjectDisabled / ErrDisabled / ErrAgentDisabled / ErrPipelineUnavailable", "409", "resource_unavailable", "blocked（暂停，稍后重试）"],
        ["ErrBodyTooLarge", "413", "body_too_large", "quarantine"],
        ["admission.ErrLimited", "429", "rate_limited", "retryable（带 Retry-After）"],
        ["query.ErrCapacityLimited", "429", "query_capacity_limited", "retryable"],
        ["query.ErrExecutionTimeout", "504", "query_timeout", "retryable"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "一个错误码，两个 HTTP 状态——409 的分叉",
      body: "同为 409 Conflict，code 可能是 idempotency_conflict（批内容与已存的不同，属于客户端 bug）也可能是 resource_unavailable（项目/Agent/管道被禁用，属于资源状态）。Agent 侧据此分叉：前者是 terminal（停止），后者是 blocked（保留重试）。所以判断错误「看 code 不看状态码」是这个系统的铁律。",
    },
    {
      type: "heading",
      text: "writeError 的 Retry-After 逻辑",
    },
    {
      type: "paragraph",
      text: "限流错误（admission.LimitError 或 query.ErrCapacityLimited）会在写错误体之前设置 Retry-After 响应头（errors.go:31-37）。Agent 的 Dispatcher 读到这个头会用服务器建议的时间覆盖本地退避——这正是两端退避协作的接口。",
    },
    {
      type: "quiz",
      question: "Agent 收到 HTTP 409 + code=resource_unavailable，应该怎么处理？",
      options: [
        "当作批内容损坏，移入本地隔离区",
        "当作系统配置错误，停止整个 Agent",
        "保留该批，退避后重试（blocked）",
        "忽略该错误继续发下一批",
      ],
      answer: 2,
      explanation:
        "resource_unavailable 表示资源被禁用（项目/Agent/管道），不是批的问题也不是配置错误。正确语义是 blocked：批保留、退避重试，等资源恢复。Agent 侧 transport.go 对 409+resource_unavailable 的分类正是 ResultBlocked。",
    },
    {
      type: "keypoints",
      items: [
        "路由三组：健康检查（无认证）、/api/v1（authenticate 中间件）、/metrics。",
        "中间件顺序：requestID → recovery → cors → authenticate。",
        "错误信封统一带 code + request_id；判断错误看 code 不看状态码。",
        "限流错误会写 Retry-After 头，Agent 据此协作退避。",
      ],
    },
  ],
};
