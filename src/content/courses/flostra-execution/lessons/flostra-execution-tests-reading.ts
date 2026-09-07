import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-tests-reading",
  courseSlug: "flostra-execution",
  title: "测试是证据：用行为而不是函数数量学习 execution",
  summary: "把测试当成可执行规范，学会从失败场景、数据库条件和并发结果反推模块真正承诺的行为。",
  minutes: 35,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "当一个模块有几十个 public/private 函数时，最差的学习方式是给每个函数写一句“它做了什么”。更好的问题是：项目真正害怕哪种回归？execution 测试已经替你挑出了答案——过期 lease 是否会被恢复、stale completion 是否会被拒绝、redrive 是否重复、终态是否会被旧事件重新打开。你要学的是这些行为契约，而不是函数清单。",
    },
    {
      type: "heading",
      text: "先从测试名建立行为索引",
    },
    {
      type: "table",
      caption: "Flostra execution 测试的阅读入口",
      headers: ["测试位置", "测试名/主题", "它保护的行为", "阅读后追哪个实现"],
      rows: [
        ["internal/execution/attempt_test.go", "TestWatchdogTimesOutLeaseAndRejectsLateCompletion", "超时后旧 attempt 的完成事件不能改变终态", "watchdog.SweepOnce → CompleteAttempt"],
        ["internal/execution/outbox_test.go", "expired lease recovery", "PUBLISHING 租约过期后可以重新领取；终态 execution 的消息被跳过", "claimDue → dispatchOne"],
        ["internal/execution/redrive_test.go", "redrive idempotency / active attempt", "同一幂等键只 redrive 一次；活跃 delivery 不可重跑", "Redrive 的锁和二次检查"],
        ["internal/event/*_test.go", "invalid/stale worker event", "未知协议或旧 attempt 不进入状态与回放", "HandleWorkerEvent → applyWorkerState"],
        ["backend/tests/*", "worker ACK/NACK 与 workflow engine", "终态投递失败可恢复；节点 retry 有上限", "mq_worker.py → workflow_engine.py"],
      ],
    },
    {
      type: "heading",
      text: "用“安排—动作—断言”读一个测试",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "安排（Arrange）：数据库里预先放什么 execution、outbox、attempt？时间是否被注入为可控值？",
        "动作（Act）：调用 SweepOnce、HeartbeatAttempt、CompleteAttempt、Redrive 或 HandleWorkerEvent 中的哪个公开入口？",
        "断言（Assert）：检查的是返回值、数据库状态、事件是否持久化，还是“不应该发生”的副作用？",
        "反事实（Counterfactual）：如果去掉 current_attempt_id 条件、lease 条件或幂等唯一索引，测试是否会失败？",
      ],
    },
    {
      type: "code",
      title: "行为测试比调用顺序测试更有价值",
      language: "text",
      code: `行为契约：
  “watchdog 超时后，迟到 completion 不得把 TIMED_OUT 改回 SUCCEEDED”

不要把测试写成：
  “SweepOnce 必须调用 helperA，然后 helperB 一次”

更稳定的断言是：
  1. execution.status == TIMED_OUT
  2. current_attempt 的 status == TIMED_OUT
  3. 迟到 CompleteAttempt 返回 accepted == false
  4. failure/终态没有被旧 worker 覆盖`,
    },
    {
      type: "paragraph",
      text: "这种读法会直接告诉你哪些 private helper 可以安全重构。只要最终行为不变，`loadCurrentAttemptForUpdate` 里面拆成几个函数、SQL 是 GORM 链式写法还是另一个 repository，都不应该让测试失去意义。相反，状态转移、锁顺序、协议错误分类和竞态结果是必须保留的稳定契约。",
    },
    {
      type: "heading",
      text: "四类测试分别回答什么",
    },
    {
      type: "table",
      headers: ["测试层", "适合证明", "不适合证明"],
      rows: [
        ["execution 单元/集成测试", "状态机、事务边界、lease、fencing、redrive 资格", "RabbitMQ 集群真的能承受生产流量"],
        ["event 测试", "协议 allowlist、stale 事件不会污染 Redis、完成状态映射", "浏览器 CSS 或 SSE 网络质量"],
        ["backend pytest", "ACK/NACK、事件序列、节点 retry、DAG 分支", "PostgreSQL 行锁与 Go 控制面事务"],
        ["race / integration", "并发访问和真实依赖组合下的回归", "业务副作用天然 exactly-once"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "测试通过也有边界",
      body: "当前仓库的 Go race、Go vet、Python pytest 和 frontend build 可以证明很多代码行为，但不能据此宣称生产环境已经具备 exactly-once、跨租户隔离或任意代码沙箱。测试结论必须和它实际覆盖的边界一致。",
    },
    {
      type: "subheading",
      text: "建议的阅读命令",
    },
    {
      type: "code",
      language: "powershell",
      code: `Set-Location E:\Proj\Flostra\gback
go test ./internal/execution -run 'TestWatchdog|TestOutbox|TestRedrive' -v
go test -race ./internal/execution ./internal/event
Set-Location E:\Proj\Flostra\backend
uv run pytest -q`,
    },
    {
      type: "exercise",
      title: "练习：从一个测试反推不变量",
      description: "任选 TestWatchdogTimesOutLeaseAndRejectsLateCompletion 或 outbox 的 expired lease 测试，写出三条不变量：前置状态、动作后的数据库状态、被拒绝的迟到动作。然后指出每条不变量由哪一个 SQL WHERE 或唯一索引保护。",
      hint: "不要只抄断言。问自己：如果删掉 current_attempt_id、lease_expires_at 或 idempotency unique index，哪个断言最先失效？",
    },
    {
      type: "quiz",
      question: "学习 execution 时，下面哪种测试断言最值得长期保留？",
      options: [
        "dispatchOne 一定调用 prepareAttempt 恰好一次",
        "日志必须按照某个 private helper 的名字输出",
        "超时后的迟到 completion 不得改变用户可见终态",
        "GORM 链式调用必须保持当前行顺序",
      ],
      answer: 2,
      explanation: "迟到 completion 被拒绝是可靠性和安全边界，属于稳定行为契约。其他选项绑定了当前实现、日志或调用顺序，合理重构后不应成为回归阻碍。",
    },
    {
      type: "keypoints",
      items: [
        "先从测试名建立行为索引，再沿公开入口追实现；不要从函数数量开始。",
        "按 Arrange → Act → Assert → Counterfactual 阅读测试，可以找到真正的不变量。",
        "状态转移、fencing、lease、协议错误和 redrive 幂等是高价值稳定契约。",
        "测试通过只证明覆盖范围内的行为，不足以宣称 exactly-once 或生产级隔离。",
      ],
    },
  ],
};
