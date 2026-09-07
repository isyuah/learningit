/* ==================================================================
 * 课程：Gline Server 源码精读（gline-server）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 *
 * 事实源：E:/Proj/gline-full 当前源码 + docs/guides/（每条结论带 file:line）。
 * 所有协议字段名、状态取值、错误码均以源码为准（guides 与源码冲突时以源码为准）。
 * 前置：已理解 Gline Agent 侧（WAL/checkpoint/at-least-once/幂等 心智），
 * 或至少懂「at-least-once 传输 + 幂等去重」概念。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "gline-server",
  title: "Gline Server 源码精读：把 Agent 的重传变成恰好一次入库",
  tagline: "从 HTTP 入口到 PostgreSQL，读懂一个模块化单体后端的四平面",
  description:
    "你已经理解了 Gline Agent 如何用 WAL、checkpoint 与重试做到「至少一次传输」。这一课转向接收端：Server 如何把 Agent 的重传变成「恰好一次入库」？\n\nGline Server 是一个模块化单体（一个进程、四个业务平面、共享 PostgreSQL）。课程按真实请求路径推进：HTTP 入口与 API key 认证 → 摄取协议与幂等事务 → 控制面心跳 → 受限查询 → 告警子系统（规则评估与 webhook 投递）→ 端到端故障推演 → 进程装配与后台任务。\n\n每一课都以当前源码为唯一事实源（标注 file:line），并承接你已有的 Agent 心智：你会看到 Dispatcher 收到的每个响应码、Agent 心跳上报的每个字段，在 Server 侧是由什么代码、什么表、什么事务产生的。配套要点、测验与故障推演练习，帮你从「看得懂」到「讲得清」。",
  level: "intermediate",
  hours: 14,
  learners: 0,
  coverIndex: "11",
  coverColor: "info",
  updatedAt: "2026-09",
  outcomes: [
    "建立 Server 的四平面架构地图：httpapi/auth/admission 横切层与 control/ingest/query/operations 业务平面的边界",
    "讲清 API key 认证与 scope 授权：Bearer token 如何变成 Principal，租户隔离为什么「硬」",
    "吃透摄取路径：协议校验 → 幂等三态（accepted/duplicate/conflict）→ 事务提交即 ACK 边界 → 两层幂等 SQL",
    "理解控制面心跳的服务端实现：desired status 从哪来、config_version 如何参与、Agent 侧门控如何闭环",
    "掌握查询治理：强制时间窗、keyset 游标（签名+绑定过滤）、信号量快失败",
    "理解告警子系统：规则/实例状态机（normal→pending→firing）、lease 评估调度、outbox 可靠投递",
    "能对「Agent+Server」做端到端故障推演：崩溃/断网/重复/坏数据下为什么不丢不重",
    "读得懂进程装配（bootstrap）与后台任务（maintenance/alerting worker）的生命周期",
  ],
  chapters: [
    {
      id: "landscape",
      title: "从 Agent 到 Server：架构地图",
      intro: "先建立 Server 在整条链路中的位置与内部边界，再进入细节。",
      lessons: [
        { slug: "gline-server-map", title: "Server 是什么：与 Agent 的分工", minutes: 12, kind: "reading" },
        { slug: "gline-server-four-planes", title: "四平面架构与分层纪律", minutes: 16, kind: "reading" },
      ],
    },
    {
      id: "http-auth",
      title: "HTTP 入口与身份授权",
      intro: "一个请求从网线到业务逻辑，经过哪些中间件；身份如何从 token 变成 Principal。",
      lessons: [
        { slug: "gline-server-http-entry", title: "请求入口：路由、中间件与错误信封", minutes: 16, kind: "reading" },
        { slug: "gline-server-auth-api-key", title: "API key 认证：prefix.secret 与 HMAC", minutes: 18, kind: "reading" },
        { slug: "gline-server-scope-tenant", title: "Scope 授权与租户隔离", minutes: 16, kind: "reading" },
      ],
    },
    {
      id: "ingest",
      title: "摄取路径：幂等与事务",
      intro: "Server 的心脏：一批日志如何被校验、判重、事务写入，只在提交后 ACK。",
      lessons: [
        { slug: "gline-server-ingest-protocol", title: "摄取协议：严格解码与 canonical hash", minutes: 18, kind: "reading" },
        { slug: "gline-server-ingest-accept", title: "Accept 事务：三态响应与 ACK 边界", minutes: 20, kind: "reading" },
        { slug: "gline-server-ingest-storage", title: "两层幂等：SQL 唯一约束与纵深防御", minutes: 14, kind: "reading" },
        { slug: "gline-server-ingest-admission", title: "准入限流：令牌桶与 reservation", minutes: 16, kind: "reading" },
      ],
    },
    {
      id: "control",
      title: "控制面：心跳与管道状态",
      intro: "Agent 每 30 秒心跳一次，Server 侧如何对账并返回期望状态。",
      lessons: [
        { slug: "gline-server-heartbeat", title: "心跳服务端：对账与期望状态", minutes: 18, kind: "reading" },
      ],
    },
    {
      id: "query",
      title: "查询路径：受治理的检索",
      intro: "日志只增不减，查询必须被治理：时间窗、keyset、信号量。",
      lessons: [
        { slug: "gline-server-query-governance", title: "查询治理：硬性限制与索引前提", minutes: 16, kind: "reading" },
        { slug: "gline-server-keyset-cursor", title: "Keyset 分页与签名游标", minutes: 18, kind: "reading" },
      ],
    },
    {
      id: "alerting",
      title: "告警子系统：从日志到通知",
      intro: "在已入库的日志上做周期性评估,命中阈值就把通知可靠地送进 webhook。",
      lessons: [
        { slug: "gline-server-alerting-model", title: "告警模型：规则、实例与状态机", minutes: 18, kind: "reading" },
        { slug: "gline-server-alerting-delivery", title: "评估与投递：lease、outbox 与 webhook", minutes: 20, kind: "reading" },
      ],
    },
    {
      id: "reliability",
      title: "端到端可靠性闭环",
      intro: "把 Agent 与 Server 合起来,逐条推演故障。",
      lessons: [
        { slug: "gline-server-reliability-loop", title: "端到端故障推演：为什么不丢不重", minutes: 22, kind: "reading" },
      ],
    },
    {
      id: "runtime",
      title: "装配与后台任务",
      intro: "进程如何从配置组装起来,退出时如何优雅排空。",
      lessons: [
        { slug: "gline-server-bootstrap", title: "装配根：依赖注入与生命周期", minutes: 16, kind: "reading" },
        { slug: "gline-server-operations-worker", title: "后台任务：维护 worker 与周期纪律", minutes: 16, kind: "reading" },
      ],
    },
  ],
};
