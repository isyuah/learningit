/* ==================================================================
 * 课时：四平面架构与分层纪律（gline-server-four-planes）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-four-planes",
  courseSlug: "gline-server",
  title: "四平面架构与分层纪律",
  summary: "请求从 HTTP 到 PostgreSQL 会穿过哪些层？为什么 handler 里看不到 SQL、storage 里看不到鉴权？",
  minutes: 16,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课建立了 Server 的整体定位。这一课把「四平面」落实成一张可以走进去的代码地图：一个 HTTP 请求从进进程到返回，会穿过哪些层；每个层能做什么、不能做什么。学完你应该能回答后端面试第一个高频问题：「一个请求从进进程到返回，经过哪些层？」",
    },
    {
      type: "heading",
      text: "请求的纵向切面：httpapi → service → storage",
    },
    {
      type: "paragraph",
      text: "不管哪个平面，请求都走同一个纵向分层。以摄取为例（internal/server/httpapi/handlers.go 的 ingestBatch，L369-393）：",
    },
    {
      type: "code",
      title: "一次 POST /api/v1/batches 的层间调用",
      language: "text",
      code: "HTTP 请求\n  -> gin Router + authenticate() 中间件（middleware.go）\n       Bearer token -> Principal（auth.Authenticator）\n  -> handler.ingestBatch（httpapi/handlers.go:369）\n       拒绝 bootstrap -> ingestv1.Decode + Normalize（协议层）\n  -> ingest.Service.Accept（ingest/service.go:110）\n       scope/agent 校验 -> admission.AllowIngest（限流）\n  -> withinTx(...)（bootstrap/transactions.go）\n       项目/Agent/Pipeline 状态检查 -> InsertBatch -> InsertEntries\n       -> 事务 Commit —— 此刻才返回 200 accepted",
    },
    {
      type: "callout",
      variant: "tip",
      title: "「服务层不拥有事务」的微妙设计",
      body: "ingest.Service 自己不开事务，它依赖一个注入的 WithinTx 回调（ingest/service.go:24 注释原文：\u201cWithinTx must commit only after fn returns nil... This callback is the service's ACK boundary.\u201d）。事务的真正载体在 bootstrap/transactions.go——这让 service 可以脱离真实数据库做单元测试（传一个假的 WithinTx），也让「事务提交即 ACK 边界」这个不变量集中在装配根声明。",
    },
    {
      type: "heading",
      text: "四个平面的横向切分",
    },
    {
      type: "paragraph",
      text: "四平面的边界不只是目录，而是「每个平面有自己的 service 与 repository 接口」。看 ingest 包，它不依赖 control 包，只依赖自己定义的几个小接口（ProjectRepository.Get、AgentRepository.Get、PipelineRepository.Get、BatchRepository、UsageRepository，ingest/service.go:5-31）。真正的实现由装配根在启动时注入。",
    },
    {
      type: "list",
      items: [
        "control：项目/凭据/Agent/管道生命周期，写审计事件（control/service.go）",
        "ingest：批校验、幂等、事务写入（ingest/service.go）",
        "query：受治理检索、游标分页（query/service.go）",
        "operations：隔离重放、用量、保留（operations/service.go）",
      ],
    },
    {
      type: "heading",
      text: "接口隔离：依赖倒置的实践",
    },
    {
      type: "paragraph",
      text: "每个 service 依赖的是「自己需要的窄接口」，而不是整个 store。例如 ingest.Service 只需要 Projects.Get（判断项目能否摄取），不需要 Projects.Create。这样做的直接收益：测试里可以传入只实现这几个方法的 fake，几行代码就能构造出「项目已禁用」「Agent 已禁用」等场景（ingest/service_test.go 就是这么做的）。",
    },
    {
      type: "heading",
      text: "分层纪律的两个可观察检验",
    },
    {
      type: "table",
      caption: "纪律如何被代码结构保证",
      headers: ["纪律", "代码证据", "违反时会怎样"],
      rows: [
        ["HTTP 层无 SQL", "httpapi/ 下没有任何 database/sql 导入", "handler 里出现 SQL 即破坏可测试性"],
        ["存储层无鉴权", "storage/postgres/ 无 scope 判断", "仓储可被非授权路径直接调用"],
        ["服务层不拥有事务载体", "service 依赖注入的 WithinTx", "无法替换事务边界做测试"],
        ["协议层被两端共享", "internal/protocol/ingestv1 同时被 agent/reliable 与 server/ingest 引用", "两端协议漂移会被编译器发现"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "读代码时的常见误区",
      body: "不要按目录树背模块名。真正的边界是「依赖方向」：httpapi 依赖 service 接口，service 依赖仓储接口，仓储实现依赖 SQL。你在读任何一层时，问两个问题：这一层能直接碰数据库吗？这一层能看到调用者的身份吗？两个答案都应该是「不能」。",
    },
    {
      type: "exercise",
      title: "画出一次心跳请求的层间调用",
      description:
        "打开 internal/server/httpapi/handlers.go 的 heartbeat handler 与 control/service.go 的 Heartbeat，画出从 HTTP 到仓储的完整调用链，标出每一层「能做什么、不能做什么」。",
      hint: "先找 handler 调了 service 的哪个方法，再看 service 的 withinTx 回调里调了哪些仓储方法。",
    },
    {
      type: "keypoints",
      items: [
        "统一纵向分层：httpapi（适配）→ service（领域）→ repository 接口 → postgres 实现。",
        "service 依赖注入的窄接口 + WithinTx，不自己开事务。",
        "四平面共享同一 PostgreSQL，但各有 service/repository 边界。",
        "纪律检验：handler 无 SQL、storage 无鉴权。",
      ],
    },
  ],
};
