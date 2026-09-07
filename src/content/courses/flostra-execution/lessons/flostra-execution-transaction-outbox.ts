import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-transaction-outbox",
  courseSlug: "flostra-execution",
  title: "事务 Outbox：为什么 execution 和消息意图必须一起提交",
  summary: "把数据库提交与消息发送拆成两个阶段，用一条可恢复的数据库事实填补进程崩溃窗口。",
  minutes: 42,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一节我们故意保留了一个问题：execution 已经是 QUEUED，但 API 进程可能在 publish 前崩溃。现在不要先背 Outbox pattern 的定义，先问一个更具体的问题：进程重启后，系统凭什么知道“还有一条任务需要发”？答案必须是持久化事实，而不是某个 goroutine 里的变量，也不是日志里一句“准备发送”。",
    },
    {
      type: "heading",
      text: "Outbox 不是消息队列，它是发送意图的收据",
    },
    {
      type: "definition",
      term: "Transactional Outbox",
      definition: "把业务状态变化和一条描述外部副作用的 outbox 记录放进同一个本地数据库事务；事务提交后，由独立 dispatcher 读取 outbox 并异步发送。它保证“已提交的业务事实一定留下可恢复的发送意图”，不保证外部系统只收到一次。",
    },
    {
      type: "code",
      title: "当前 Spawn 的关键事务边界",
      language: "go",
      code: `err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
    executionID, err = s.spawnInTransaction(ctx, tx, branchID)
    return err
})

// spawnInTransaction:
// 1. 读取 branch/workflow/revision
// 2. 构造 execution(QUEUED)
// 3. 构造 outbox(PENDING)
// 4. tx.Create(execution)
// 5. tx.Create(outbox)
// 6. 一起 commit
// RabbitMQ publish 不在这个事务里`,
    },
    {
      type: "paragraph",
      text: "当前实现位于 `gback/internal/execution/service.go` 的 `Spawn` 和 `spawnInTransaction`。真正重要的不是 GORM 调用本身，而是两行数据共享同一个 `tx`：如果读取 branch、创建 execution 或创建 outbox 任意一步失败，事务整体回滚；如果事务提交成功，dispatcher 之后至少有一条可以追踪的发送意图。",
    },
    {
      type: "table",
      caption: "直接发布与事务 Outbox 的信息差",
      headers: ["问题", "直接发布", "Outbox 版本"],
      rows: [
        ["API 崩溃后是否知道要发什么", "不知道，任务可能只存在内存", "outbox.payload 保存 worker-compatible task snapshot"],
        ["业务记录与发送意图是否同时存在", "两个独立动作，可能只成功一个", "同一 SQL transaction 一起提交或一起回滚"],
        ["网络变慢是否长期占用数据库事务", "若把 publish 放入事务，会占用", "提交后才网络发送，数据库事务很短"],
        ["发送失败能否稍后恢复", "依赖调用方重试，可能丢上下文", "next_attempt_at、status、last_error 支持 dispatcher 重试"],
        ["是否 exactly-once", "不是", "仍然不是；confirm 不确定性可能产生重复投递"],
      ],
    },
    {
      type: "heading",
      text: "读懂 outbox 表：每个字段都对应一个故障问题",
    },
    {
      type: "list",
      items: [
        "execution_id：把发送意图连回用户看到的那次业务运行；当前约束是一条 execution 对应一条 outbox。",
        "payload：可发送的任务快照；当前代码刻意不把解析后的 secret 值写进数据库，dispatcher 发布前才解析。",
        "status：PENDING、PUBLISHING、RETRYING、PUBLISHED、DEAD_LETTERED、SUPERSEDED 等投递状态。",
        "attempts：outbox delivery 尝试次数，表示 dispatcher 尝试发送过几轮，不等于 workflow execution attempt_number。",
        "next_attempt_at：指数退避后下一次允许领取的时间。没有它，失败 worker 会在数据库上忙等。",
        "lease_owner 与 lease_expires_at：哪一个 dispatcher 暂时拥有这行，以及进程失联后何时可被另一个实例接管。",
        "last_error、published_at、dead_lettered_at：把操作员需要诊断的结果留在可查询的事实里。",
      ],
    },
    {
      type: "callout",
      variant: "example",
      title: "一个简单但重要的推论",
      body: "Outbox payload 是“当时准备发送的任务快照”，不是永远重新读取 branch 的指针。这样可以保证一次 execution 绑定创建时选择的 workflow revision；如果用户之后编辑 branch，旧 execution 仍然执行它自己的 revision。",
    },
    {
      type: "subheading",
      text: "为什么要在 payload 里保存快照，而不是只存 branch_id",
    },
    {
      type: "paragraph",
      text: "如果 dispatcher 失败后过几分钟再读取 branch，用户可能已经保存了新图，重试就会把另一份 workflow 派给原 execution。这会破坏“一个 execution 代表一次确定运行”的语义。当前 `spawnInTransaction` 优先读取 branch.current_revision_id 对应的 immutable revision，并把 graph 复制到 task 和 outbox payload；这也是你在执行模块里看到 RevisionID 的原因。",
    },
    {
      type: "exercise",
      title: "练习：为每个字段写出它要防的故障",
      description: "打开 gback/internal/model/models.go 的 WorkflowOutboxMessage，逐字段写一张表：如果没有这个字段，哪一种崩溃、重试、并发或运维场景会变得无法判断？至少覆盖 status、attempts、next_attempt_at、lease_expires_at、last_error 和 payload。",
      hint: "不要回答“这个字段是为了存数据”。要回答“dispatcher 在什么时刻读取它，并据此做出什么决定”。",
    },
    {
      type: "quiz",
      question: "事务 Outbox 最核心的保证是什么？",
      options: [
        "RabbitMQ 一定只收到一次消息",
        "数据库提交后，外部消息已经被 broker 确认",
        "业务状态和可恢复的发送意图在同一个本地事务中一起提交",
        "所有 worker 都能同时处理同一个 execution",
      ],
      answer: 2,
      explanation: "Outbox 把“以后要发送什么”变成数据库事实，所以 API 进程提交成功后，系统可以在进程重启或 broker 暂时不可用时继续发送。它不参与 RabbitMQ 的分布式 commit，也不消除重复投递。",
    },
    {
      type: "keypoints",
      items: [
        "Outbox 是持久化的发送意图，不是 RabbitMQ 的替代品。",
        "execution 与 outbox 必须使用同一个数据库事务，成功一起提交，失败一起回滚。",
        "payload 保存 revision 绑定的任务快照，避免重试时执行被用户后来修改的 workflow。",
        "attempts 是 outbox 投递轮数；它和稍后介绍的 execution attempt_number 不是同一个计数器。",
        "Outbox 解决的是可恢复性和原子性裂缝，不是 exactly-once。",
      ],
    },
  ],
};
