import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-baseline",
  courseSlug: "flostra-execution",
  title: "第一版系统：直接发布为什么看起来足够好",
  summary: "用一个没有 Outbox 的最小实现制造故障，理解可靠投递真正要修复的时间窗口。",
  minutes: 28,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "复杂系统最容易学错的地方，是一上来就把最终方案当成唯一正确答案。先把时间拨回 baseline：API 创建 execution，调用 RabbitMQ publish，然后返回 executionID。这个版本并不愚蠢；在 broker 稳定、进程不崩、任务不重要时，它甚至很实用。问题在于，数据库提交和网络发送不是同一个原子动作。只要把它们放在时间线上，裂缝就会自己出现。",
    },
    {
      type: "heading",
      text: "最小实现只有两个副作用",
    },
    {
      type: "code",
      title: "教学用 baseline（不是当前实现）",
      language: "go",
      code: `func Spawn(ctx context.Context, branchID uuid.UUID) (uuid.UUID, error) {
    execution := &WorkflowExecution{
        ID: uuid.New(),
        BranchID: branchID,
        Status: "QUEUED",
    }
    if err := db.Create(execution).Error; err != nil {
        return uuid.Nil, err
    }

    task := buildTask(execution)
    if err := publisher.PublishWorkflowRun(ctx, task); err != nil {
        return execution.ID, err
    }
    return execution.ID, nil
}`,
    },
    {
      type: "paragraph",
      text: "这段代码把“记录业务事实”和“通知外部系统”串成了两个顺序动作。它还隐含了一个危险假设：只要 publish 返回错误，调用方就能知道消息到底有没有到达。现实中，连接断开、确认超时、进程在 broker 已接收后崩溃，都可能让结果变成“客户端不知道”。",
    },
    {
      type: "table",
      caption: "直接发布版本的故障窗口",
      headers: ["时间点", "数据库", "RabbitMQ", "用户看到什么", "真正的问题"],
      rows: [
        ["DB 写入前进程崩溃", "没有 execution", "没有消息", "请求失败", "通常可接受，但没有业务记录可追踪"],
        ["DB 已提交，publish 前崩溃", "QUEUED", "没有消息", "可能返回成功或超时", "出现永远 QUEUED 的孤儿 execution"],
        ["broker 已接收，客户端等待确认时崩溃", "QUEUED", "可能已有消息", "客户端认为失败并重试", "重复投递，且无法由数据库判断哪次是真实发送"],
        ["publish 失败但消息其实已被 broker 接收", "QUEUED", "可能已有消息", "dispatcher 或 API 再发一次", "外部副作用可能执行两次"],
      ],
    },
    {
      type: "subheading",
      text: "为什么“把 publish 放进数据库事务”也不行",
    },
    {
      type: "paragraph",
      text: "你可能会想到：开启一个 SQL transaction，写 execution，调用 RabbitMQ，成功就 commit，失败就 rollback。这样做只能让数据库等待网络，并不能让 PostgreSQL 和 RabbitMQ 组成一个真正的分布式事务。RabbitMQ 没有参加 SQL 的 commit 协议；网络调用变慢时，数据库锁会被长期占用；进程在 broker 成功后、SQL commit 前崩溃时，数据库回滚但消息已经存在。你只是把裂缝换了一个位置。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "先区分两个问题",
      body: "“数据库记录是否和发送意图一起留下”是原子性问题；“消息是否可能被发送多次”是至少一次投递问题。Outbox 主要修复前者，但不会神奇地把后者变成 exactly-once。后面 Attempt 和业务幂等还要继续处理重复与迟到。",
    },
    {
      type: "heading",
      text: "从 Git 历史验证 baseline，而不是凭文件名猜",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "在 gback 执行 `git show --stat 00933cc`，确认早期提交的文件范围。",
        "查看 `git show 00933cc -- internal/execution`，重点寻找 Spawn 到 publisher 的直接路径。",
        "再执行 `git show --stat 52cb5d9`，观察可靠性建设新增了哪些表、dispatcher 和 watchdog。",
        "把你看到的事实和“为什么这样演进”的推断分成两栏；后者要写成推测，不要冒充 commit 记录。",
      ],
    },
    {
      type: "exercise",
      title: "练习：不改代码，找出三个崩溃点",
      description: "对 baseline 代码画三个进程崩溃点：创建 execution 前、创建后 publish 前、publish 已被 broker 接收后。每个点写出数据库、RabbitMQ 和 HTTP 客户端三方可能观察到的结果，并说明调用方是否能够安全重试。",
      hint: "关键不是判断“成功/失败”，而是判断信息是否足够让调用方知道外部副作用已经发生。信息丢失的窗口，就是之后需要持久化投递意图的地方。",
    },
    {
      type: "quiz",
      question: "下面哪句话最准确地描述直接发布版本的核心缺陷？",
      options: [
        "Go 的 goroutine 数量太少，无法执行 workflow",
        "数据库和 RabbitMQ 的动作没有共同的持久化边界，进程崩溃后无法可靠恢复发送意图",
        "RabbitMQ 只能发送字符串，不能发送 JSON",
        "execution 状态不能使用 QUEUED",
      ],
      answer: 1,
      explanation: "真正的问题是跨资源的时间窗口：数据库已提交但消息没发，或消息已发但数据库没有可恢复的发送意图。Outbox 的价值就是把“以后要发送什么”先变成数据库事实。",
    },
    {
      type: "keypoints",
      items: [
        "直接发布版本的价值在于简单，但它把 DB commit 与网络发送串成不可恢复的时间窗口。",
        "把 RabbitMQ 调用塞进 SQL 事务不能获得真正的分布式原子性。",
        "确认超时和进程崩溃会制造不确定性，因此后续设计必须接受重复投递的可能。",
        "理解 Outbox 前，先能说出 baseline 的三个崩溃点及其后果。",
      ],
    },
  ],
};
