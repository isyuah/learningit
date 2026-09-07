import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-watchdog-cancel",
  courseSlug: "flostra-execution",
  title: "Watchdog 与取消：谁负责结束一项失联的工作",
  summary: "用状态机和时钟理解 watchdog、worker heartbeat 与用户取消的边界，不把所有失败都叫 retry。",
  minutes: 40,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "到这里你已经知道 worker 需要 heartbeat，也知道旧 attempt 不能覆盖新 attempt。现在再问一个运维问题：如果 worker 进程彻底挂了，谁会把 execution 从 RUNNING 变成终态？如果用户点击取消，控制面应该立刻把它标成 CANCELLED，还是等待 worker 自己退出？这两个问题都涉及状态变化，但触发者、可逆性和副作用完全不同。",
    },
    {
      type: "heading",
      text: "先写出执行状态机",
    },
    {
      type: "code",
      title: "面向学习的状态图",
      language: "text",
      code: `QUEUED
  | current worker accepted
  v
RUNNING -- user cancel --> CANCEL_REQUESTED -- worker observes --> CANCELLED
  | deadline / lease expires
  v
TIMED_OUT
  |
  +-- operator redrive --> QUEUED (new attempt later)

RUNNING -- worker terminal event --> SUCCEEDED / FAILED / CANCELLED`,
    },
    {
      type: "paragraph",
      text: "这张图不是完整的状态枚举，而是阅读 execution 时的主干。`CANCEL_REQUESTED` 表示控制面已经记录了用户意图，并通过 Redis cancellation marker 通知 worker；`CANCELLED` 表示 worker 已经报告或控制面已经接受取消终态。`TIMED_OUT` 则是控制面根据时钟和 lease 做出的裁决，不代表 worker 收到了一个“请停止”的业务事件。",
    },
    {
      type: "table",
      caption: "四种恢复/结束动作的差异",
      headers: ["动作", "触发者", "判断依据", "是否重新发送", "迟到 worker 会怎样"],
      rows: [
        ["RabbitMQ 重投递", "broker/consumer", "消息未 ACK 或连接断开", "可能重新送同一 task", "Attempt fencing 决定是否还能写"],
        ["Heartbeat 续租", "当前 worker", "attempt 仍 RUNNING 且 lease 未过期", "不发送新 task", "过期后 heartbeat 被拒绝，不能复活"],
        ["Watchdog 超时", "gback 定时 sweep", "deadline 或 attempt lease 已过期", "不自动重跑", "旧 attempt 的事件变 stale"],
        ["人工 redrive", "授权操作员", "execution FAILED/TIMED_OUT 且 delivery 不活跃", "重置 outbox，等待新投递", "旧 attempt 不能继续改变新一轮状态"],
      ],
    },
    {
      type: "heading",
      text: "Watchdog 解决的是“失联”，不是所有失败",
    },
    {
      type: "paragraph",
      text: "`gback/internal/execution/watchdog.go` 的 `SweepOnce` 会扫描活跃 execution，锁住 execution 与当前 attempt，检查 attempt lease 和 execution deadline。如果仍然是当前 attempt 且状态活跃，才把 attempt 标成 TIMED_OUT、把 execution 标成 TIMED_OUT。它不会凭空创建新的 attempt，也不会假装知道 worker 进程最后做到了哪一步。这个保守选择避免同一任务在未知副作用之后被静默重跑。",
    },
    {
      type: "code",
      title: "Watchdog 的条件裁决（教学伪代码）",
      language: "go",
      code: `for each active execution:
    lock execution
    attempt := current attempt
    if attempt is not current or execution is terminal:
        skip
    if attempt.lease_expires_at <= now
       or attempt.deadline_at <= now:
        mark attempt TIMED_OUT
        update execution TIMED_OUT
        // future events carry the old attemptId and are rejected`,
    },
    {
      type: "subheading",
      text: "为什么 heartbeat 不能在过期后“补发一次”",
    },
    {
      type: "paragraph",
      text: "如果 heartbeat 到达时 lease 已经过期，watchdog 可能已经把 execution 置为 TIMED_OUT，或者 dispatcher 已经创建了新 attempt。接受这次迟到 heartbeat 就等于让旧 worker 复活并重新取得写入权。当前 `HeartbeatAttempt` 的 WHERE 明确要求 `lease_expires_at > now`，所以过期 heartbeat 返回 false；这是一个有意的不可逆边界。",
    },
    {
      type: "heading",
      text: "取消为什么要依赖 Redis，但不能依赖 Redis 保存业务真相",
    },
    {
      type: "paragraph",
      text: "取消请求首先更新 PostgreSQL 中的 execution 状态，再设置 worker 可读取的 Redis marker（键形如 `execution:<id>:cancel-requested`）。worker 每轮执行或节点间检查这个 marker，发现后发出 cancelled 终态事件。Redis 适合做快速协作信号，但 execution 是否真的取消仍由 PostgreSQL 状态和通过 fencing 的完成事件决定；Redis 丢失不能让一个健康任务凭空失败，当前 Python worker 在检查异常时会记录 warning 并继续工作。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "超时后不自动 redrive 是一个安全选择",
      body: "一个 HTTP、邮件、SQL 或外部 API 节点可能已经产生副作用，只是结果事件在网络中丢失。自动重跑可能再次发送邮件或扣款。当前项目把 TIMED_OUT 留给显式、经过授权和幂等键保护的 redrive，而不是把“看起来卡住”当成“可以安全重试”。",
    },
    {
      type: "exercise",
      title: "练习：把症状映射到责任边界",
      description: "给下面三个症状分别选择主要责任者并说明证据：A. RabbitMQ consumer 断线后同一 task 再次到达；B. worker 还活着但 20 秒没有 heartbeat；C. 用户按下取消但 worker 仍在运行。选项是 broker/consumer、watchdog、取消协作链路。",
      hint: "A 是 delivery 层重投递；B 是 lease/deadline 层超时；C 是一个持久化用户意图加一个 worker 协作信号，不能只看某个 Redis key。",
    },
    {
      type: "quiz",
      question: "为什么 Watchdog 把 execution 置为 TIMED_OUT 后，迟到 heartbeat 必须被拒绝？",
      options: [
        "因为 heartbeat payload 太大",
        "因为接受它会让一个已经失去 lease 或已被替换的 worker 重新获得写入资格",
        "因为 Redis 不支持时间字段",
        "因为 TIMED_OUT 只能由前端设置",
      ],
      answer: 1,
      explanation: "超时是一个裁决点。接受超时之后的 heartbeat 会破坏 fencing：旧 worker 可能与新 attempt 并发写入，甚至把已经终结的运行重新显示为活跃。过期事件应保持 stale。",
    },
    {
      type: "keypoints",
      items: [
        "CANCEL_REQUESTED、CANCELLED、TIMED_OUT 是不同状态，不要用一个 retry 分支解释全部。",
        "Watchdog 负责裁决失联，不自动创建新 attempt，也不证明外部副作用没有发生。",
        "Heartbeat 只能在当前 worker、当前 attempt、lease 未过期时续租。",
        "Redis cancellation marker 是协作信号，PostgreSQL execution 状态才是业务真相。",
        "超时后的自动重跑可能重复外部副作用，因此 redrive 被设计为显式操作。",
      ],
    },
  ],
};
