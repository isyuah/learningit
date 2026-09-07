import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-stale-events",
  courseSlug: "flostra-execution",
  title: "事件与 fencing：如何让迟到事件变成无害的 no-op",
  summary: "从 worker 事件进入控制面开始，理解严格协议校验、Attempt 验证和 Redis 持久化之间的先后关系。",
  minutes: 40,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "Attempt 只有在所有写入口都检查它时才有意义。如果 `workflow_started` 会校验 attempt，但 `node_completed` 可以绕过校验直接写 Redis，那么旧 worker 仍然能把已经 TIMED_OUT 的运行伪装成“刚刚完成了一个节点”。所以这一节不只看状态更新，而是跟一条事件穿过 `HandleWorkerEvent` 的完整路径：解析、协议检查、状态 fencing、回放存储、实时广播。",
    },
    {
      type: "heading",
      text: "事件处理的顺序就是安全边界",
    },
    {
      type: "code",
      title: "gback/internal/event/service.go 的教学版流程",
      language: "text",
      code: `payload
  -> JSON decode
  -> 必填字段 / event allowlist / 1 MiB 大小检查
  -> applyWorkerState
       workflow_started  -> StartAttempt
       workflow_heartbeat -> HeartbeatAttempt
       workflow_completed -> CompleteAttempt
       node_*             -> ValidateAttempt
  -> 只有 accepted 才写 Redis replay stream/list
  -> Redis Pub/Sub
  -> SSE Hub -> 浏览器`,
    },
    {
      type: "paragraph",
      text: "当前实现明确先调用 `applyWorkerState`，再写 Redis。这样如果 `ValidateAttempt` 发现 attempt 已经被替换，事件不会进入 replay list，也不会通过 pub/sub 到达浏览器。注释里专门说明了这个顺序：数据库状态即使正确 fencing，若 stale event 先进入回放，详情页仍可能显示一个已经超时的执行在继续工作。",
    },
    {
      type: "table",
      caption: "不同事件的裁决方式",
      headers: ["事件", "Go 调用", "改变什么", "拒绝时的含义"],
      rows: [
        ["workflow_started", "StartAttempt", "attempt RUNNING；QUEUED execution → RUNNING", "worker 没有赢得当前 attempt"],
        ["workflow_heartbeat", "HeartbeatAttempt", "更新 lease_expires_at 与 last_heartbeat_at", "不能复活过期 lease 或替换后的 worker"],
        ["node_started / node_completed / node_skipped", "ValidateAttempt", "不改变业务状态，但允许事件进入日志", "不允许 stale worker 污染回放与实时视图"],
        ["workflow_completed", "CompleteAttempt", "关闭 attempt，并原子更新 execution 终态", "旧 worker 不能覆盖新 attempt 或 watchdog 结果"],
      ],
    },
    {
      type: "heading",
      text: "为什么 stale event 是协议数据，不是基础设施故障",
    },
    {
      type: "paragraph",
      text: "`ErrStaleWorkerEvent` 的处理方式很值得学习：它记录指标并返回“stale_attempt”，但不会让 RabbitMQ 无限 requeue。同一条迟到事件无论重投多少次都不会变新；继续重试只会制造噪声。因此 worker 消费端应把这类永久无效的协议数据 ACK 掉，而把数据库暂时不可用、Redis 暂时不可用等真正的基础设施故障区分出来。",
    },
    {
      type: "callout",
      variant: "example",
      title: "严格 allowlist 也是教学重点",
      body: "事件服务只接受 workflow_started、workflow_heartbeat、workflow_completed、node_started、node_completed、node_skipped 六类事件，并限制单个 payload 不超过 1 MiB。未知事件和过大事件在写入任何状态或 Redis 前就被拒绝。协议的“未知字段能不能先存下来”不是便利问题，而是控制面是否愿意承认一个它不会解释的状态变化。",
    },
    {
      type: "subheading",
      text: "AttemptID 缺失时为什么还有 legacy 分支",
    },
    {
      type: "paragraph",
      text: "`applyWorkerState` 对没有 attemptId 的旧事件走 `applyLegacyWorkerState`，只支持有限的 started/completed 状态更新。这是兼容迁移的边界，不是新协议的推荐格式。新事件一旦携带 attemptId，就必须同时携带非空 workerId；两者缺一都被视为 invalid。阅读兼容代码时要问：它保护的是历史数据，还是应该继续扩展的新路径？",
    },
    {
      type: "exercise",
      title: "练习：判断三种事件是否会进入浏览器",
      description: "假设当前 execution 的 attemptId=B：事件 1 是来自 B 的 node_completed；事件 2 是来自 A 的 node_completed；事件 3 是来自 B 但 payload 超过 1 MiB。分别判断它们是否会写 replay list、是否会发布 Redis Pub/Sub，以及消费端是否应 ACK。",
      hint: "顺序是协议校验 → fencing → Redis。事件 2 在 fencing 处变 stale，事件 3 在大小检查处 invalid；两者都不应污染回放。",
    },
    {
      type: "quiz",
      question: "为什么 ApplyWorkerState 必须发生在 Redis replay 写入之前？",
      options: [
        "因为 Redis 不能存 JSON",
        "因为只有通过当前 attempt fencing 的事件才应成为用户可见历史",
        "因为 PostgreSQL 写入总是比 Redis 快",
        "因为 SSE 只能接收终态事件",
      ],
      answer: 1,
      explanation: "事件回放和实时广播都属于用户可见事实。如果旧 attempt 的事件先写 Redis，数据库虽然拒绝了状态更新，浏览器仍会看到错误时间线。先 fencing，再持久化和广播，才能让 stale event 真正变成 no-op。",
    },
    {
      type: "keypoints",
      items: [
        "所有 worker 事件都必须经过同一个顺序：协议校验 → Attempt fencing → Redis 回放 → Pub/Sub/SSE。",
        "node 事件不改 execution 状态，但同样必须 ValidateAttempt，避免污染用户可见日志。",
        "stale event 是永久无效的协议数据，应 ACK 而不是无限重投；基础设施故障才值得重试。",
        "legacy 无 attemptId 路径是迁移兼容，不是新事件的设计目标。",
      ],
    },
  ],
};
