import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-map",
  courseSlug: "flostra-execution",
  title: "Execution 到底是什么：先画出一条完整时间线",
  summary: "先不读所有函数和 model，沿着一次真实任务画出控制面、消息、worker 和事件的边界。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "你现在面对的困难很典型：execution 目录里函数很多，model 又被很多模块引用，于是每打开一个文件都像从半空开始读。这一节先把阅读单位换掉。我们不问“这个函数叫什么”，而问“用户点击运行之后，哪一条事实先产生，哪一个系统拥有它，下一步又由谁推动”。当你能复述一次 execution 的生命线，后面每个函数都会有位置。",
    },
    {
      type: "definition",
      term: "Execution",
      definition: "一次工作流运行的业务事实。它对用户可见，拥有 workflow、branch、revision、当前状态和最终失败信息，但不等于某一次 RabbitMQ 投递，也不等于某个 worker 进程。",
    },
    {
      type: "heading",
      text: "先看四个边界，而不是四个目录",
    },
    {
      type: "table",
      caption: "一次 execution 中四类事实的拥有者",
      headers: ["事实", "谁拥有", "回答的问题", "代码位置"],
      rows: [
        ["业务运行", "PostgreSQL workflow_executions", "这次运行对用户现在是什么状态？", "gback/internal/model/models.go:185-195"],
        ["投递意图", "PostgreSQL workflow_outbox_messages", "任务是否已经准备好发给 broker？下次何时重试？", "gback/internal/model/models.go:204-224"],
        ["投递身份", "PostgreSQL workflow_execution_attempts", "哪一次投递、哪个 worker 还有资格写状态？", "gback/internal/model/models.go:233-251"],
        ["运行日志", "Redis stream/list/pubsub + 浏览器 SSE", "worker 产生了哪些可回放、可实时展示的事件？", "gback/internal/event/service.go:156-230"],
      ],
    },
    {
      type: "paragraph",
      text: "注意“投递意图”和“投递身份”的差别。Outbox 行可以因为网络失败重试很多次；Attempt 是其中一次被赋予 fencing token 的投递历史。execution 是产品语义，outbox 和 attempt 是可靠性语义。把这三者都叫“执行记录”，会让之后的并发问题全部混在一起。",
    },
    {
      type: "heading",
      text: "把一次运行压缩成十个事件",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "HTTP handler 收到“运行 branch”的请求，调用 execution.Service.Spawn。",
        "Spawn 在一个 PostgreSQL 事务里读取 branch、workflow 和不可变 revision 快照。",
        "事务创建一行 QUEUED 的 workflow_executions，以及一行 PENDING 的 workflow_outbox_messages。",
        "事务提交后，outbox dispatcher 周期性领取到期消息，并在短事务中取得 outbox lease。",
        "dispatcher 为这次投递创建 Attempt，写入 execution.current_attempt_id，并把 attemptId 放进 RabbitMQ task。",
        "Python worker 消费 task，发 workflow_started；控制面确认 attemptId、workerId 和 lease 后才把 execution 变成 RUNNING。",
        "worker 执行 DAG，期间发 node_started、node_completed 和 workflow_heartbeat。",
        "worker 发 workflow_completed；控制面在同一事务里关闭当前 Attempt，并把 execution 变成 SUCCEEDED、FAILED 或 CANCELLED。",
        "事件服务把已经通过 fencing 的事件写入 Redis replay list/stream，再通过 pub/sub 推给 SSE hub。",
        "如果 lease 过期或执行超过 deadline，watchdog 将当前 attempt 和 execution 置为 TIMED_OUT；迟到事件不再拥有写入资格。",
      ],
    },
    {
      type: "code",
      title: "先记住这条主链，再打开文件",
      language: "text",
      code: `HTTP
  -> execution.Spawn
  -> PostgreSQL transaction
       execution(QUEUED) + outbox(PENDING)
  -> outbox.DispatchOnce
       lease outbox -> create attempt -> publish RabbitMQ
  -> Python worker
       started -> heartbeat -> node events -> completed
  -> event.HandleWorkerEvent
       fence check -> SQL state -> Redis replay/pubsub
  -> browser SSE / execution detail`,
    },
    {
      type: "callout",
      variant: "note",
      title: "历史事实与教学拆分",
      body: "Git 历史中 Outbox 和 Attempt 出现在同一个可靠性建设提交（52cb5d9，2026-08-11）。课程把它们拆成两节，是为了先讲“消息有没有可靠留下来”，再讲“旧投递能不能继续写入”，不是声称项目作者一定按这两个独立阶段实现。",
    },
    {
      type: "subheading",
      text: "第一次代码定位：只找三个入口",
    },
    {
      type: "paragraph",
      text: "打开仓库时先只定位 `Spawn`、`DispatchOnce` 和 `HandleWorkerEvent`。它们分别代表“产生任务”“推进投递”“接收执行结果”。暂时不要追所有 private helper；当某个入口需要回答一个问题时，再沿着它调用的下一层进入。这样阅读是由运行时问题驱动，而不是被文件结构牵着走。",
    },
    {
      type: "exercise",
      title: "练习：给四个 ID 找主人",
      description: "在纸上写下 executionID、outboxID、attemptID 和 workflow revision ID。分别回答：它在哪张表里出现？是否会在重试时改变？它能否单独代表“这次运行”？最后对照 service.go 的 Spawn 和 outbox.go 的 dispatchOne 检查你的答案。",
      hint: "executionID 贯穿业务展示；outboxID 只代表一条持久投递意图；attemptID 每次新的投递身份都可能变化；revisionID 用来保证运行读取的是不可变图快照。",
    },
    {
      type: "quiz",
      question: "为什么不能只用 workflow_executions.status 判断“任务是否已经发给 RabbitMQ”？",
      options: [
        "因为 status 只能保存字符串，无法保存 UUID",
        "因为 QUEUED 只说明业务记录存在，投递可能尚未发生、正在重试或租约已失效",
        "因为 RabbitMQ 不允许数据库读取 status",
        "因为 worker 不会发送任何状态事件",
      ],
      answer: 1,
      explanation: "业务状态和传输状态是两个观察面。一个 execution 可以保持 QUEUED，但其 outbox 正在等待重试；也可以已经有过一次发布却还没被 worker 启动。outbox 与 attempt 才保存投递过程的事实。",
    },
    {
      type: "keypoints",
      items: [
        "先读一条运行时间线，再读函数；execution 是业务事实，不是一次 RabbitMQ 投递。",
        "execution、outbox message、attempt、event replay 各自拥有不同事实。",
        "入口函数只有三类：创建运行（Spawn）、推进投递（DispatchOnce）、接收结果（HandleWorkerEvent）。",
        "Outbox 和 Attempt 在历史上同一提交出现，课程按两个设计压力拆开讲。",
      ],
    },
  ],
};
