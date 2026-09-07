import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-attempt",
  courseSlug: "flostra-execution",
  title: "Attempt：一次投递为什么要有独立身份",
  summary: "从重复 Rabbit delivery 和 worker 替换的竞态出发，理解 current_attempt_id 如何成为写入栅栏。",
  minutes: 42,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "Outbox 已经能在失败后重试，但它还没有回答一个更危险的问题：如果第一条消息已经到达 worker A，A 卡住；dispatcher 认为 lease 过期，又发出第二条消息给 worker B，A 之后恢复并发送“成功”，B 也发送“失败”，谁能改 execution？只看 execution.status 或 outbox.status 都不够，因为它们无法区分消息属于哪一次投递。",
    },
    {
      type: "heading",
      text: "把 execution 和 delivery 分开",
    },
    {
      type: "table",
      caption: "三张表的职责",
      headers: ["表", "它描述的对象", "生命周期", "最重要的字段"],
      rows: [
        ["workflow_executions", "用户看到的一次工作流运行", "QUEUED → RUNNING → 终态", "status、revision_id、current_attempt_id"],
        ["workflow_outbox_messages", "一条持久化发送意图", "PENDING → PUBLISHING → PUBLISHED/RETRYING/死信", "attempts、next_attempt_at、lease_expires_at"],
        ["workflow_execution_attempts", "一次被栅栏保护的 delivery 身份", "DISPATCHING → RUNNING → 终态/失效", "id、attempt_number、worker_id、lease、deadline"],
      ],
    },
    {
      type: "definition",
      term: "Fencing token",
      definition: "一个更晚的拥有者可以用来拒绝更早拥有者写入的身份。Flostra 中 attemptId 由 dispatcher 创建，execution.current_attempt_id 指向当前身份；任何 worker 事件都必须带着匹配的 attemptId 才能继续。",
    },
    {
      type: "heading",
      text: "Attempt 的创建时机很关键",
    },
    {
      type: "paragraph",
      text: "当前代码不是在 Spawn 时就创建 Attempt，而是在 dispatcher 已经取得 outbox lease 后，`prepareAttempt` 才创建。这样 Attempt 表示“确实进入了一次投递准备”，而不是“用户曾经点击过运行”。一个还没被 dispatcher 领取的 QUEUED execution 合法地没有 current_attempt_id；查询接口会显示 NOT_ASSIGNED，而不是伪造一个不存在的 worker。",
    },
    {
      type: "code",
      title: "Attempt fencing 的最小模型",
      language: "text",
      code: `dispatcher #1: attempt=A, execution.current_attempt_id=A
dispatcher #2: lease 过期后 attempt=B, current_attempt_id=B

worker A -> event(attempt=A)
worker B -> event(attempt=B)

数据库接受写入的前提：
event.attempt_id == execution.current_attempt_id
并且 attempt.worker_id == event.worker_id
并且 attempt 仍在 active lease 内

所以 A 的迟到事件只能被拒绝，B 才是当前拥有者。`,
    },
    {
      type: "heading",
      text: "读 StartAttempt：它不是普通的状态赋值",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "锁 execution，再按 current_attempt_id 读取 attempt；模块内固定先锁 execution 再锁 attempt，避免和 watchdog/heartbeat 反向加锁造成死锁。",
        "如果 execution 已经终态，重复的同 worker 终态事件可以被当作幂等确认；其他事件不再重新打开执行。",
        "如果 attempt 已经被另一个 worker 以 RUNNING 状态占有，重复 Rabbit delivery 直接不接受。",
        "如果 attempt 的 lease 已过期，也不能重新唤醒它；watchdog 可能已经把业务状态置为 TIMED_OUT。",
        "通过条件更新写入 worker_id、lease_expires_at、last_heartbeat_at，并在 execution 仍为 QUEUED 时变成 RUNNING。",
      ],
    },
    {
      type: "code",
      title: "为什么 WHERE 条件比 if 判断更重要",
      language: "sql",
      code: `UPDATE workflow_executions
SET status = 'RUNNING'
WHERE id = :execution_id
  AND current_attempt_id = :attempt_id
  AND status = 'QUEUED';

UPDATE workflow_execution_attempts
SET lease_expires_at = :new_expiry,
    last_heartbeat_at = :now
WHERE id = :attempt_id
  AND status = 'RUNNING'
  AND worker_id = :worker_id
  AND lease_expires_at > :now;`,
    },
    {
      type: "paragraph",
      text: "在并发系统里，先 SELECT 后在内存里判断并不等于安全；另一个事务可以在两者之间改变行。Flostra 把身份、状态、worker 和时间条件放入 UPDATE 的 WHERE，最终由数据库的行更新结果决定 accepted 是否为 true。你读这种代码时，应该先读 WHERE，再读上面的 if，因为 WHERE 才是最后一道裁决。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "Attempt number 不是 outbox attempts",
      body: "outbox.attempts 每领取一轮就增加，用来安排 delivery retry；execution_attempts.attempt_number 是一条新的 fencing 身份的历史序号。前者回答“dispatcher 试了几轮”，后者回答“这是第几个可能写入 execution 的投递者”。把两个数字混用会导致错误的监控和错误的 redrive 诊断。",
    },
    {
      type: "exercise",
      title: "练习：两个 Worker 的竞态时间线",
      description: "画出 worker A 先 StartAttempt、A 停止心跳、watchdog 超时、dispatcher 创建 B、A 迟到 Complete、B 最后 Complete 的六步时间线。每一步写出 execution.status、current_attempt_id、A/B 的 attempt status，以及哪一个事件被接受。",
      hint: "一旦 current_attempt_id 从 A 变成 B，A 的事件没有“旧但也许有用”的特殊通道；它们应被视为 stale protocol data。",
    },
    {
      type: "quiz",
      question: "current_attempt_id 的主要作用是什么？",
      options: [
        "让前端显示当前 worker 的名字",
        "把 execution 的可写资格绑定到唯一的一次 delivery 身份",
        "统计一个 execution 总共发送了多少字节",
        "替代 workflow revision，保存工作流图快照",
      ],
      answer: 1,
      explanation: "current_attempt_id 是 fencing 入口。worker 事件必须匹配它，旧 attempt 即使稍后恢复，也不能覆盖新 attempt 或 watchdog 已经做出的终态决定。revision_id 解决的是执行哪个图版本，职责不同。",
    },
    {
      type: "keypoints",
      items: [
        "Outbox 说明“要发什么”，Attempt 说明“这一次发出的身份是谁”。",
        "Attempt 在 dispatcher 取得 outbox lease 后创建；没有被领取的 QUEUED execution 可以没有 attempt。",
        "current_attempt_id + worker_id + lease 条件共同构成写入栅栏。",
        "在并发代码中，数据库 UPDATE 的 WHERE 是最终裁决，不能只相信内存里的 if。",
        "attempt_number 与 outbox.attempts 是两个维度：历史身份与投递轮数。",
      ],
    },
  ],
};
