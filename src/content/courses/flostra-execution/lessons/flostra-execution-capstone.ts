import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-capstone",
  courseSlug: "flostra-execution",
  title: "综合练习：从一个故障反推出整条链路",
  summary: "面对发布确认丢失、worker 失联和迟到完成事件，画出三张表的变化并给出安全处置方案。",
  minutes: 50,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "这是课程的最后一节。请先不要回看前面的答案，把它当成一次面试白板题和一次真实排障题：一个用户看到 execution 一直卡住，日志显示 dispatcher 曾经 publish，但 RabbitMQ 连接在 confirm 返回前断开；几分钟后 watchdog 把运行置为 TIMED_OUT；又过了一会儿，旧 worker 发来 workflow_completed(success)。你要解释发生了什么、系统应该如何处理、操作员是否可以 redrive。",
    },
    {
      type: "heading",
      text: "故障剧本",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "t0：Spawn 在同一事务中创建 execution E=QUEUED 和 outbox O=PENDING。",
        "t1：dispatcher D1 claim O，O=PUBLISHING，attempt A 被创建，E.current_attempt_id=A。",
        "t2：RabbitMQ 可能已经接收 task(A)，但 D1 在收到 confirm 前进程崩溃。",
        "t3：O 的 lease 过期，D2 重新领取并可能创建 attempt B；B 成为 E.current_attempt_id。",
        "t4：A 所属 worker 没有继续 heartbeat，watchdog 发现 lease/deadline 过期并把 E 置为 TIMED_OUT。",
        "t5：worker A 恢复，发送带 attemptId=A 的 workflow_completed(success)。",
        "t6：管理员考虑使用 Idempotency-Key=K 发起 redrive。",
      ],
    },
    {
      type: "exercise",
      title: "任务 1：画三张表",
      description: "为 t0 到 t6 每个时刻写出 workflow_executions、workflow_outbox_messages、workflow_execution_attempts 的关键字段：status、current_attempt_id、outbox attempts、lease、attempt A/B status。允许存在“实现依赖的细节”，但必须标出你能从代码确定的部分和需要查看日志/数据库才能确定的部分。",
      hint: "最重要的事实是 A 的 task 是否真的到过 broker 无法从 confirm 丢失中确定；但无论它是否到达，A 的迟到 completion 都必须经过 current_attempt_id/worker/lease fencing。",
    },
    {
      type: "exercise",
      title: "任务 2：给出控制面裁决",
      description: "回答四个问题：A 的 success 事件是否会把 E 改回 SUCCEEDED？D2 是否可以在 O lease 过期后接管？watchdog 是否应该自动 redrive？管理员的 redrive 请求需要满足哪些条件？每个答案至少引用一个状态条件或代码入口。",
      hint: "把“delivery 重试”“超时裁决”“业务重跑”分开。旧 attempt 的事件、活跃 delivery、外部副作用不确定性，分别决定三个答案。",
    },
    {
      type: "exercise",
      title: "任务 3：写一个安全的面试回答",
      description: "用 90 秒向面试官解释：为什么项目有三张 execution 相关表？Outbox 与 Attempt 分别解决什么？如果 confirm 丢失，能否保证只执行一次？你会如何诚实地说明边界？",
      hint: "推荐句式：先给业务问题，再给机制，再给失败路径，最后说保证和不保证什么。不要用“分布式事务”“exactly-once”作为没有证据的口号。",
    },
    {
      type: "heading",
      text: "参考推理（完成后再看）",
    },
    {
      type: "paragraph",
      text: "t2 的真实 broker 结果是不确定的，所以系统只能按照 at-least-once 设计：D2 可以在 O lease 过期后接管，重复 task 的可能性由 Attempt fencing 和 worker/业务幂等共同承担。t4 的 TIMED_OUT 是 watchdog 的终态裁决；t5 的 A 事件因为 attemptId 已不是 current_attempt_id，或者 lease 已过期，会被识别为 stale，不得写 execution，也不得进入 Redis 回放。它不应被无限 requeue。",
    },
    {
      type: "paragraph",
      text: "redrive 不是 watchdog 的自动后续动作。管理员必须确认 E 是 FAILED 或 TIMED_OUT、outbox 不在活跃发布、当前 attempt 不活跃、RabbitMQ 与 Redis 依赖可用，并提供合法的 Idempotency-Key。通过后，系统在事务中追加 audit、把 E 重置为 QUEUED、清空 current_attempt_id，并把 O 重置为 PENDING；之后由 dispatcher 创建新的 Attempt。这个动作仍不能证明外部 HTTP、邮件或数据库副作用没有在 A 中发生。",
    },
    {
      type: "table",
      caption: "最终复盘：每个机制负责哪一个问题",
      headers: ["设计机制", "它解决的问题", "它没有解决的问题"],
      rows: [
        ["事务 Outbox", "业务提交后，发送意图可恢复", "broker 只收到一次；外部副作用幂等"],
        ["outbox lease + SKIP LOCKED", "多 dispatcher 并行领取，崩溃后可接管", "确认丢失时的重复发送"],
        ["Attempt fencing", "旧 worker/旧 delivery 不能覆盖当前状态", "已经发生的外部副作用回滚"],
        ["Heartbeat + Watchdog", "发现失联并把执行裁决为超时", "知道 worker 最后一个副作用是否完成"],
        ["Redrive + audit + idempotency", "让人工重跑可授权、可追踪、可重复请求收敛", "业务动作 exactly-once"],
        ["Worker ACK/NACK", "终态事件未送达时保留恢复机会", "控制面和外部系统的分布式原子性"],
      ],
    },
    {
      type: "quiz",
      question: "在 capstone 剧本中，最诚实的结论是什么？",
      options: [
        "confirm 丢失后可以证明 task 一定没有执行",
        "watchdog 会自动安全地再执行一次",
        "系统接受 at-least-once；Attempt 防止旧事件污染状态，外部副作用仍需要业务幂等与人工判断",
        "只要 Redis 里没有日志，就说明 worker 没有执行",
      ],
      answer: 2,
      explanation: "confirm 丢失只说明控制面不知道 broker 的最终结果。Outbox 可以恢复发送，Attempt 可以拒绝旧身份的结果，但无法撤销或证明外部副作用。安全的系统必须诚实承认这个边界，并把 redrive 变成显式、审计和幂等保护的操作。",
    },
    {
      type: "keypoints",
      items: [
        "遇到复杂故障时按时间线写 t0、t1、t2，而不是跳到某个 helper 猜答案。",
        "confirm 丢失意味着结果不确定；at-least-once 是可验证的现实边界。",
        "Attempt fencing 保护控制面状态，不能回滚已经发生的外部副作用。",
        "Watchdog 负责失联裁决，redrive 负责显式业务重跑，两者不能合并。",
        "一个好的项目回答始终包含：问题、机制、失败路径、测试证据、诚实局限。",
      ],
    },
  ],
};
