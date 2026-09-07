import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-outbox-dispatcher",
  courseSlug: "flostra-execution",
  title: "Dispatcher：lease、SKIP LOCKED、确认与重试",
  summary: "逐行理解 DispatchOnce 如何领取一批 outbox、避免多实例重复抢占，并在不确定性下保持可恢复。",
  minutes: 45,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一节只证明了“发送意图存在”。但如果有三个 gback 实例同时扫描 outbox，它们会不会把同一条消息发三次？如果某个实例领取后死掉，消息会不会永远卡在 PUBLISHING？这一节的主线是 dispatcher 的生命周期：claim、lease、prepare、publish、mark result。先跟一条消息走完，再看每个 helper。",
    },
    {
      type: "heading",
      text: "DispatchOnce 是一个有边界的循环",
    },
    {
      type: "code",
      title: "当前 dispatcher 的外层结构",
      language: "go",
      code: `func (d *OutboxDispatcher) DispatchOnce(ctx context.Context) error {
    messages, err := d.claimDue(ctx) // 短事务：选行 + 写 lease
    if err != nil { return err }

    for _, message := range messages {
        if err := d.dispatchOne(ctx, message); err != nil {
            rememberFirstError(err)
        }
    }
    return firstError
}

func (d *OutboxDispatcher) Run(ctx context.Context) {
    ticker := time.NewTicker(d.pollInterval)
    for { DispatchOnce(ctx); wait ticker or ctx.Done() }
}`,
    },
    {
      type: "paragraph",
      text: "`DispatchOnce` 被导出并不是因为它是 HTTP API，而是为了让集成测试和未来管理工具可以一次推进一批，且 broker 慢时不会让一个长事务垄断数据库连接。你读代码时可以把它当作一个小型状态机驱动器，而不是“一个函数调用了很多 helper”。",
    },
    {
      type: "heading",
      text: "第一步：claim 不是发送，它只是暂时取得处理权",
    },
    {
      type: "code",
      title: "claimDue 的关键 SQL 条件",
      language: "go",
      code: `tx.Clauses(clause.Locking{
    Strength: "UPDATE",
    Options: "SKIP LOCKED",
}).Where(
    "(status IN ? AND next_attempt_at <= ?) OR " +
    "(status = ? AND lease_expires_at <= ?)",
    []string{"PENDING", "RETRYING"}, now,
    "PUBLISHING", now,
).Order("created_at ASC").Limit(batchSize).Find(&messages)

// commit 后才调用 RabbitMQ
UPDATE workflow_outbox_messages
SET status = 'PUBLISHING',
    attempts = attempts + 1,
    lease_owner = dispatcherID,
    lease_expires_at = now + leaseDuration
WHERE id IN (...);`,
    },
    {
      type: "paragraph",
      text: "`FOR UPDATE SKIP LOCKED` 的教学模型是“排队取号”：已经被另一个 dispatcher 锁住的行直接跳过，其他实例继续处理后面的行。更重要的是，选行和写 lease 在一个很短的事务里提交，网络 publish 在事务外执行。这样 broker 慢只会让这条消息持有应用层 lease，不会让数据库事务一直开着。",
    },
    {
      type: "table",
      caption: "三种“锁/租约”不要混淆",
      headers: ["机制", "持续时间", "保护什么", "失效后怎么办"],
      rows: [
        ["SQL row lock", "claim 事务内", "多个 dispatcher 不同时修改同一行", "事务结束自动释放"],
        ["outbox lease", "publish 期间", "dispatcher 进程崩溃后让别人接管", "lease_expires_at 到期可重新领取"],
        ["execution attempt lease", "worker 执行期间", "旧 worker 的心跳/结果是否仍有资格", "watchdog 超时并拒绝迟到事件"],
      ],
    },
    {
      type: "heading",
      text: "第二步：dispatchOne 为什么先 prepareAttempt 再 publish",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "检查 outbox lease 仍属于当前 dispatcher；如果失租，当前循环必须停止外部调用。",
        "锁住 execution，确认它还没有进入终态；终态 execution 的 outbox 应标记为 SUPERSEDED。",
        "创建一个新的 workflow_execution_attempt，并把 execution.current_attempt_id 指向它。",
        "从 payload 恢复 task，解析当前需要的 secrets，把 attemptId 注入消息。",
        "在 publishTimeout 内调用 RabbitMQ publisher；这一步在 SQL 事务外。",
        "成功后用带 owner/lease/attempt 条件的更新标记 PUBLISHED；失败则记录 RETRYING 或 DEAD_LETTERED。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "publish 返回错误不等于“broker 一定没收到”",
      body: "网络断开可能发生在 broker 接收消息之后、客户端收到 confirm 之前。于是 markFailed 后的重试可能造成重复消息。当前设计接受 at-least-once，并通过 Attempt fencing 让旧投递的结果不能覆盖当前状态；真正的外部副作用仍需要 worker 任务本身具备幂等策略。",
    },
    {
      type: "subheading",
      text: "失败分类：不是所有错误都值得重试",
    },
    {
      type: "table",
      caption: "dispatchOne 的错误决策",
      headers: ["错误", "典型原因", "动作", "为什么"],
      rows: [
        ["errOutboxLeaseLost", "另一个实例已接管", "当前循环 no-op", "不能让失去所有权的实例继续发消息"],
        ["executionAlreadyTerminal", "worker 已经完成或 watchdog 已超时", "SUPERSEDED", "旧发送意图已经不应再唤醒业务运行"],
        ["invalid payload", "数据库中的 JSON 不符合 task 契约", "永久失败/死信", "重复重试不会修复坏数据"],
        ["publisher unavailable / publish failed", "broker 暂时不可用或连接失败", "RETRYING + backoff", "基础设施故障有机会恢复"],
      ],
    },
    {
      type: "exercise",
      title: "练习：推演 dispatcher 崩溃",
      description: "假设 dispatcher 已把 outbox 改成 PUBLISHING 并提交，随后在三种时刻崩溃：调用 RabbitMQ 前、broker 已收消息但 confirm 未返回、confirm 返回后 markPublished 前。对每种情况写出下次 DispatchOnce 会看到什么，以及为什么可能重复。",
      hint: "关键字段是 lease_expires_at、status、attempts 和 published_at。不要把数据库状态当成 broker 的全局真相；确认丢失时，系统只能选择重试或放弃，而不能证明“绝对没发”。",
    },
    {
      type: "quiz",
      question: "为什么 claim 后不能一直持有 SQL transaction，直到 RabbitMQ publish 完成？",
      options: [
        "因为 GORM 不允许在事务里调用任何 Go 函数",
        "因为网络延迟会让数据库锁长期占用，降低并发并放大故障影响",
        "因为 RabbitMQ 只能从另一个进程访问",
        "因为 SKIP LOCKED 只能用于 SELECT COUNT",
      ],
      answer: 1,
      explanation: "Outbox 的边界是本地数据库事务；外部网络调用放在提交后，并用应用层 lease 表示处理权。这样数据库锁快速释放，网络故障不会拖住一整个事务。",
    },
    {
      type: "keypoints",
      items: [
        "claim 只是领取处理权；真正的 broker 调用发生在短事务之外。",
        "SKIP LOCKED 让多个 dispatcher 可以并行推进，lease 让崩溃后的行可恢复。",
        "失租实例不能继续调用外部 broker；终态 execution 的旧 outbox 应被 supersede。",
        "confirm 不确定性意味着 at-least-once；不要把 PUBLISHED 误读成业务只执行一次。",
        "读 dispatcher 时按 claim → attempt → hydrate → publish → mark result 五步切片。",
      ],
    },
  ],
};
