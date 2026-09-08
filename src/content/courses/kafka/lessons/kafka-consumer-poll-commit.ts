/* ==================================================================
 * 课时：拉取模型、位置管理与提交时机（kafka-consumer-poll-commit）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Apache Kafka 4.x（4.3 主线）；Go 示例以 franz-go v1.21.x 为准，
 * 文中默认值与 API 名称均对照 franz-go v1.21.6 源码与官方文档核实。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "为什么消费是拉不是推、消费位置从哪开始、offset 提交时机如何决定重复与丢失。",
  blocks: [
    {
      type: "paragraph",
      text: "第 3 章解决了「把消息可靠地写进 Kafka」：[acks](glossary:acks)、重试、幂等。但消息写进去不是目的，业务系统要把它**读回来并处理**——而读取这一侧的失败模型完全不同：消息不会因为消费者崩溃而消失，它一直躺在分区的[提交日志](glossary:commit-log)里，等你从某个位置重新读。本课回答三个问题：为什么 Kafka 让消费者自己拉（pull）而不是 broker 推（push）；消费者的「读到哪里了」由什么决定、怎么重放；以及把「处理完成」报告给 Kafka 的提交（offset commit）时机，如何精确地决定你会重复还是丢失。消费组与再平衡的完整机制是下一课的内容，本课先以一个消费者把循环写对。",
    },
    {
      type: "heading",
      text: "为什么是拉，不是推",
    },
    {
      type: "paragraph",
      text: "RabbitMQ 默认是 push：broker 把消息主动推给消费者。推送模型必须回答一个棘手问题——消费者处理不过来时怎么办？要么 broker 把消息堆积在消费者进程的内存里（慢消费者被活活压垮），要么引入复杂的流控：限制在途未确认数量（prefetch/credit）、检测消费者吞吐、把慢消费者降级。这一整套机制本质上是「broker 替消费者做调度」。Kafka 选了另一条路：broker 只负责**把消息存好并按需供应**，消费的节奏完全由客户端掌控——它自己决定什么时候来取、一次取多少。",
    },
    {
      type: "list",
      items: [
        "**慢消费者不会压垮 broker**：broker 不知道也不关心消费速度，数据落盘后消费只是顺序读，消费者不来取就没有任何压力；慢消费者只会让自己的消费滞后（lag）变大，不会拖垮集群或别的消费者。",
        "**天然支持批量**：消费者按批拉取，拉取请求本身就可以让 broker「攒够一定字节或等一小段时间再返回」，把网络往返与处理开销摊薄到一批消息上。",
        "**断线续读是免费的**：因为消息不因被读而删除，消费者崩溃后重新连接，只要知道上次读到哪，就能从那个[偏移量](glossary:offset)继续——「读游标在客户端、数据在服务端」，这正是提交日志心智模型与队列的本质区别。",
        "**代价由消费者承担**：位置管理、提交、失败重读都是客户端职责；拉空了要自己处理空转（阻塞等待而非忙等）。",
      ],
    },
    {
      type: "paragraph",
      text: "用 HTTP 打个比方：push 像服务器不停把响应塞给你，pull 像你自己轮询一个 REST 接口并指定 `?from=` 游标参数。前者在消费者能力参差不齐时很难做对，后者把「读多快」这个决定权还给了最了解自己处理能力的进程——也就是消费者自己。",
    },
    {
      type: "heading",
      text: "拉取循环：PollFetches 的结构",
    },
    {
      type: "paragraph",
      text: "franz-go 的消费入口是 `cl.PollFetches(ctx)`：它阻塞到**任一 broker 返回一批 fetch**（有数据）为止，返回 `Fetches`；如果传入的 `ctx` 被取消或客户端被关闭，它不会 panic，而是注入一条带错误的 fetch（客户端关闭时错误为 `kgo.ErrClientClosed`）让循环能退出。想限制单次返回条数、把一批工作控制在有界范围内，用 `cl.PollRecords(ctx, n)`（`PollFetches` 等价于 `PollRecords(ctx, 0)`，即不限条数）。无数据时的「空转」是挂起等待，不是忙等：fetch 请求挂在 broker 上，broker 默认最多等 5 秒（`FetchMaxWait` 的默认值）或攒够字节才返回。",
    },
    {
      type: "code",
      title: "标准拉取循环（franz-go v1.21）",
      language: "go",
      code: "package main\n\nimport (\n\t\"context\"\n\t\"log\"\n\t\"os\"\n\t\"os/signal\"\n\t\"syscall\"\n\n\t\"github.com/twmb/franz-go/pkg/kgo\"\n)\n\nfunc main() {\n\tcl, err := kgo.NewClient(\n\t\tkgo.SeedBrokers(\"localhost:9092\"),\n\t\tkgo.ConsumerGroup(\"orders.events.consumers\"),\n\t\tkgo.ConsumeTopics(\"orders.events\"),\n\t)\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tdefer cl.Close()\n\n\tctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)\n\tdefer stop()\n\n\tfor {\n\t\tfetches := cl.PollFetches(ctx)\n\t\tif fetches.IsClientClosed() {\n\t\t\treturn // 客户端关闭：正常退出循环\n\t\t}\n\n\t\t// 1. 先看这一批里有没有拉取错误（分区级错误、数据丢失检测等）\n\t\tfetches.EachError(func(topic string, partition int32, err error) {\n\t\t\tlog.Printf(\"fetch error: %s/%d: %v\", topic, partition, err)\n\t\t})\n\n\t\t// 2. 处理本批全部记录。处理完这一批，才进入下一次 poll。\n\t\tfetches.EachRecord(func(r *kgo.Record) {\n\t\t\tlog.Printf(\"order event: key=%s offset=%d\", r.Key, r.Offset)\n\t\t})\n\t}\n}\n",
    },
    {
      type: "paragraph",
      text: "几个结构要点。第一，错误与记录是分开看的：`fetches.Errors()` 返回整批的错误列表，逐条回调用 `fetches.EachError(func(topic string, partition int32, err error))`；记录迭代可以像上面用 `EachRecord`，也可以手动迭代 `iter := fetches.RecordIter()` 后 `for !iter.Done() { r := iter.Next() }`（`EachRecord` 内部就是这个迭代器）。第二，**处理完一批再 poll 下一批**是循环的铁律：处理、提交都写在循环体内，而不是另开 goroutine 无界并发处理——那样会同时踩中「消费超前于处理」「位置不知道提交到哪」两个坑。第三，`fetches.EachError` 之后仍然可能有记录，反之亦然：一个 fetch 里可以同时包含错误分区与正常分区的数据。",
    },
    {
      type: "table",
      caption: "franz-go 拉取相关默认值（v1.21.6 核实）",
      headers: ["选项", "默认值", "含义"],
      rows: [
        ["`kgo.FetchMaxWait`", "5s", "broker 端 fetch 请求最长挂起多久等新数据（低吞吐主题靠它避免空转刷请求）"],
        ["`kgo.FetchMinBytes`", "1 字节", "broker 攒够多少字节才响应；调大可提吞吐、增延迟"],
        ["`kgo.FetchMaxBytes`", "50 MiB", "单次 fetch 响应的字节上限"],
        ["`kgo.FetchMaxPartitionBytes`", "1 MiB", "单分区在单次 fetch 里的字节上限"],
        ["`kgo.MaxConcurrentFetches`", "不限制", "客户端后台可同时向多少 broker 预取（默认无界）"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "消费是「取回一批、处理一批」，不是「逐条回调」",
      body: "初看 `EachRecord` 很像回调式消费，但它的执行仍然在你自己的 poll 循环线程里同步进行，回调只是帮你遍历。真正的处理边界是「一批 fetch」：不要在 `EachRecord` 里启动 goroutine 处理后再立刻返回，也不要在一条记录上阻塞几十分钟——下一课的再平衡会惩罚这种行为。",
    },
    {
      type: "heading",
      text: "消费位置：earliest、latest 与「新组从哪开始」",
    },
    {
      type: "paragraph",
      text: "消费者对每个分区维护一个位置（position）游标。当 Kafka 上没有这个消费者的已提交位移时（全新消费组、或位移已过期），客户端必须决定从哪开始读，这就是 Java 客户端 `auto.offset.reset` 的语义，只有两个常用答案：**earliest**（earliest，从分区现存最早消息开始，能读到历史上所有还保留的数据）与 **latest**（latest，从日志末尾开始，只读之后产生的新消息）。中间量由 broker 的[保留策略](glossary:retention)决定：比 log start offset 更早的数据已被清理，earliest 实际只能从现存最早处开始。",
    },
    {
      type: "paragraph",
      text: "franz-go 从 v1.19.0 起把这件事拆成两个选项（此前合并在 `ConsumeResetOffset` 里）：`kgo.ConsumeStartOffset(offset)` 决定**第一次见到某个分区、且没有已提交位移时**从哪开始；`kgo.ConsumeResetOffset(offset)` 决定消费中遇到 `OffsetOutOfRange`（位移已越过 log start，例如数据被清理）时重置到哪。只设一个时另一个跟随。位置用 `kgo.NewOffset()` 构造：`AtStart()` 等价于 `auto.offset.reset=earliest`，`AtEnd()` 等价于 `latest`，另有 `At(具体位移)`、`AfterMilli(毫秒时间戳)`、`AtCommitted()` 等。",
    },
    {
      type: "table",
      caption: "起点语义对照（franz-go Offset ↔ Java auto.offset.reset）",
      headers: ["franz-go", "auto.offset.reset", "含义"],
      rows: [
        ["`kgo.NewOffset().AtStart()`", "`earliest`", "从分区现存最早消息开始读"],
        ["`kgo.NewOffset().AtEnd()`", "`latest`", "从日志末尾开始，只读之后新产生的消息"],
        ["`kgo.NewOffset().AtCommitted()`", "`none`", "没有已提交位移就报错/停止，不自动选择"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "franz-go 的默认是 earliest——和 Java 客户端相反",
      body: "franz-go 的 `ConsumeStartOffset` 与 `ConsumeResetOffset` **默认都是 `AtStart()`（earliest）**；而 Java 客户端 `auto.offset.reset` 的默认值是 `latest`。这意味着同一个新消费组第一次启动，Go 程序会从最早消息开始重放历史，Java 程序只读新消息——如果你在迁移或两组并存对比时没意识到这一点，会得到完全不同的消费行为。生产环境显式写明起点（通常在消费「事件流」主题时用 `AtEnd()`，在消费「画像/状态」主题回放时用 `AtStart()`），不要依赖默认值。",
    },
    {
      type: "paragraph",
      text: "**新消费组从哪开始**的完整答案是：加入组时，客户端向组协调器查询每个分区的已提交位移；有提交就从提交处继续（这是最常见的情况——组不是新的）；没有提交（全新组）才轮到上面的 start offset 生效。所以「earliest/latest」只在组第一次启动、或位移过期时起作用，之后位置完全由提交历史决定——这把我们引向本课的核心：提交。",
    },
    {
      type: "heading",
      text: "回放：把位置拨回去重新读",
    },
    {
      type: "paragraph",
      text: "因为数据不随消费消失，Kafka 的「重读」不需要 broker 配合：只要把消费者的位置改成更早的位移即可。修 bug 后想重新处理某段时间的订单事件、把漏算的数据补进仓库、或者对着一个分区做数据修复——这些「回放工具」在 Kafka 里极其常见，也正是 commit-log 模型相对队列的红利。",
    },
    {
      type: "paragraph",
      text: "注意 franz-go 没有 Java 客户端那种运行中的 `seek()` 方法：位置由三个输入决定——**已提交位移、start offset、以及你显式指定的分区与起点**，要改位置就改输入、重建消费者。最常用的回放姿势是**不加入消费组**，用 `kgo.ConsumePartitions` 直接指定分区与精确起点，自己完全掌控读到哪里（这类工具也常常不用组，因为不需要也不想要组协调器来管位置）：",
    },
    {
      type: "code",
      title: "回放：直接指定分区与起点（真实 API 片段）",
      language: "go",
      code: "// 修复工具：重读 orders.events 分区 0 从 offset 12345 起的消息\ncl, err := kgo.NewClient(\n\tkgo.SeedBrokers(\"localhost:9092\"),\n\tkgo.ConsumePartitions(map[string]map[int32]kgo.Offset{\n\t\t\"orders.events\": {\n\t\t\t0: kgo.NewOffset().At(12_345),\n\t\t\t2: kgo.NewOffset().AtStart(), // 另一个分区从头重放\n\t\t},\n\t}),\n)\n// 之后的循环与标准拉取循环相同：PollFetches → 处理。\n// 运行中想动态追加，可调 cl.AddConsumePartitions(...)；\n// 想从某个时间点开始，用 kgo.NewOffset().AfterMilli(timestampMs)。",
    },
    {
      type: "paragraph",
      text: "在消费组内部做「回退重放」则要绕一步：franz-go 组消费者的提交机制（自动提交与 `MarkCommitRecords`）**只前进、不允许回退**（文档明言 does not allow rewinds），因为组内回退会与其它成员的位置互相干扰甚至倒拨别人的提交。组内想要「每次加入时把位置整体挪一挪」，官方钩子是 `kgo.AdjustFetchOffsetsFn`（在加入组、取回已提交位移之后、开始拉取之前调整）；更常见的工程做法仍然是：对组做 `kafka-consumer-groups.sh --reset-offsets` 类运维操作，或干脆让回放走独立的 `ConsumePartitions` 客户端，把「组消费者」与「回放工具」当成两种不同的程序看待。",
    },
    {
      type: "heading",
      text: "提交时机：本章的核心",
    },
    {
      type: "definition",
      term: "提交（offset commit）",
      definition: "消费者把自己对每个分区「已处理到哪」的位移上报给组协调器并持久化（存在 broker 内部主题 `__consumer_offsets` 里）。重启或再平衡后，组从**最后提交的位移之后**继续读。提交的是「下一条要读的位移」：处理到 offset 99，就提交 100。",
    },
    {
      type: "paragraph",
      text: "提交的本质是**消费者与协调器之间的进度契约**，它回答「如果我死了，别人从哪接续」。因此提交时机直接决定崩溃后的行为：提交**早于**实际处理完成，崩溃会丢消息（这段处理白做了，下一个人从提交处跳过去）；提交**晚于**处理完成，崩溃后这段会被重读（重复处理，但至少不丢）。注意「提交」这个概念只存在于消费组语境——没有组的直接消费者没有协调器可上报，重启后只能从 start offset 重新开始，这正是回放工具自己管理位置的原因。",
    },
    {
      type: "subheading",
      text: "自动提交：默认开启，但请看清它提交的是什么",
    },
    {
      type: "paragraph",
      text: "franz-go 组消费者的默认行为是**自动提交开启**：每 5 秒（`kgo.AutoCommitInterval` 的默认值，可用 `kgo.AutoCommitInterval(d)` 调整）提交一次。但关键细节是它提交**哪一段**：为了安全，默认只提交「**上一次** poll 返回的位移」——文档原话是，第一次 poll 之后什么都还不会提交，第二次 poll 之后，第一次 poll 的那批位移才变得可提交。也就是说自动提交总是滞后一个 poll 周期。",
    },
    {
      type: "paragraph",
      text: "滞后一个 poll 带来两个不对称的窗口：**窗口 A（处理完、但还没到提交点就崩溃）**——你处理完了第 N 批，还没来得及进入下一次 poll、5 秒定时器也没触发，进程崩溃，第 N 批位移未提交，重启后重读 → **重复**；**窗口 B（提交了、但没处理完）**——在 franz-go 的默认模式下不会发生，因为当前 poll 的数据根本不会被自动提交；但 Java 客户端的默认自动提交是「每 5 秒提交已 poll 到的最高位移」，处理慢于 poll 时就会提交了尚未处理完的消息 → 崩溃即**丢失**。franz-go 想复刻 Java 这种激进语义，需要显式开启 `kgo.GreedyAutoCommit()`（文档明确警告可能导致消息丢失）。",
    },
    {
      type: "table",
      caption: "franz-go 提交模式一览（默认值均核实于 v1.21.6）",
      headers: ["模式", "配置", "提交内容", "崩溃后果"],
      rows: [
        ["安全自动提交（默认）", "无需配置，5s 间隔", "上一次 poll 的位移（滞后一轮）", "处理完未及提交的尾部会重读：at-least-once 倾向"],
        ["激进自动提交", "`kgo.GreedyAutoCommit()`", "当前已 poll 的位移（不滞后）", "可能提交未处理完的消息：at-most-once 风险"],
        ["标记后自动提交", "`kgo.AutoCommitMarks()` + `MarkCommitRecords`", "只提交被显式标记的记录", "介于两者之间，适合「处理一批标记一批」的慢批处理"],
        ["手动提交（推荐）", "`kgo.DisableAutoCommit()`", "只有你调提交函数时才提交", "由你的代码精确控制，见下文"],
      ],
    },
    {
      type: "paragraph",
      text: "自动提交的「自动」只是省了调用，并没有消除语义选择——真正决定 at-least-once / at-most-once 的是**提交相对于处理完成的顺序**。想要不丢，原则只有一条：**先处理成功，再提交**。这就是[投递语义](glossary:delivery-semantics)课的雏形：只要坚持「处理完才提交」，崩溃最多造成「已处理但未提交」的尾部被重读（**重复、不丢**，即 at-least-once），而重复要靠消费方的幂等/去重来吸收——第 5 章会把这张因果表补完整。",
    },
    {
      type: "subheading",
      text: "手动提交：处理成功后提交",
    },
    {
      type: "paragraph",
      text: "工程上最常见的可靠姿势是关掉自动提交，循环结构变成：poll 一批 → 逐条处理 → **整批成功后同步提交**。提交用 `cl.CommitUncommittedOffsets(ctx)`（把「已 poll 且未提交」的分区位移一次提交，官方文档推荐的 poll/process/commit 模式）或 `cl.CommitRecords(ctx, recs...)`（只提交你指定的那批记录之后）。同步提交会等协调器确认并自动重试可重试错误，返回值是最终错误。逐条处理逐条提交可行但没必要——每条消息一次 OffsetCommit 往返会白白放大协调器压力，按批提交、最多再在 revoke 时补一次（见下）就够了。",
    },
    {
      type: "code",
      title: "手动提交完整示例（书舟 orders.events 消费）",
      language: "go",
      code: "package main\n\nimport (\n\t\"context\"\n\t\"encoding/json\"\n\t\"log\"\n\t\"os\"\n\t\"os/signal\"\n\t\"syscall\"\n\n\t\"github.com/twmb/franz-go/pkg/kgo\"\n)\n\n// OrderEvent 是订单主题消息体的一部分（示意字段）\ntype OrderEvent struct {\n\tOrderID string `json:\"order_id\"`\n\tType    string `json:\"type\"`\n}\n\n// apply 是业务处理：真实项目里这里会更新订单库、调用下游等。\n// 只有它返回 nil，我们才会提交这批位移。\nfunc apply(rec *kgo.Record) error {\n\tvar ev OrderEvent\n\tif err := json.Unmarshal(rec.Value, &ev); err != nil {\n\t\treturn err\n\t}\n\tlog.Printf(\"apply %s: order %s (offset %d)\", ev.Type, ev.OrderID, rec.Offset)\n\treturn nil\n}\n\nfunc main() {\n\tcl, err := kgo.NewClient(\n\t\tkgo.SeedBrokers(\"localhost:9092\"),\n\t\tkgo.ConsumerGroup(\"orders.events.consumers\"),\n\t\tkgo.ConsumeTopics(\"orders.events\"),\n\t\tkgo.DisableAutoCommit(), // 提交时机完全由我们掌控\n\t\tkgo.OnPartitionsRevoked(func(ctx context.Context, cl *kgo.Client, _ map[string][]int32) {\n\t\t\t// 再平衡交还分区前，把已处理完的位移尽量交出去，\n\t\t\t// 减少接手成员从旧位置重读的量（机制详见下一课）。\n\t\t\tif err := cl.CommitUncommittedOffsets(ctx); err != nil {\n\t\t\t\tlog.Printf(\"commit on revoke failed: %v\", err)\n\t\t\t}\n\t\t}),\n\t)\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tdefer cl.Close()\n\n\tctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)\n\tdefer stop()\n\n\tfor {\n\t\tfetches := cl.PollFetches(ctx)\n\t\tif fetches.IsClientClosed() {\n\t\t\treturn\n\t\t}\n\t\tfetches.EachError(func(topic string, partition int32, err error) {\n\t\t\tlog.Printf(\"fetch error: %s/%d: %v\", topic, partition, err)\n\t\t})\n\n\t\t// 1. 先处理完这一整批\n\t\tvar batchErr error\n\t\tfetches.EachRecord(func(r *kgo.Record) {\n\t\t\tif batchErr != nil {\n\t\t\t\treturn // 已有失败，跳过剩余（记录在案，交由失败处理）\n\t\t\t}\n\t\t\tif err := apply(r); err != nil {\n\t\t\t\tbatchErr = err\n\t\t\t}\n\t\t})\n\t\tif batchErr != nil {\n\t\t\t// 2. 处理失败：不提交，让进程退出 → 组会重新分配分区，\n\t\t\t//    未提交的这批会被重读。失败分类与重试/死信见第 5 章。\n\t\t\tlog.Fatalf(\"processing failed, not committing: %v\", batchErr)\n\t\t}\n\n\t\t// 3. 整批成功 → 提交这批最后一条的下一个位移\n\t\tif err := cl.CommitUncommittedOffsets(ctx); err != nil {\n\t\t\tlog.Printf(\"commit failed: %v\", err)\n\t\t}\n\t}\n}\n",
    },
    {
      type: "paragraph",
      text: "这段代码里有三个值得记住的工程惯例。其一，**处理与提交之间不放任何可能拖慢的步骤**，尽量缩小「已处理未提交」的尾巴。其二，进程优雅退出前补一次同步提交（`cl.Close()` 之前提交，或依赖上面的 revoke 回调——franz-go 文档建议：关闭前做最后一次同步提交，因为不会再 poll、也不会等自动提交了）。其三，`OnPartitionsRevoked` 里再补一次提交：它在交还分区时被调用，把已经处理完但还没轮到提交周期的位移交出去——回调本身要快，不能在里面做重活（这正是下一课再平衡代价的一部分）。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "提交前 panic：两种死法，语义完全不同",
      body: "处理函数里 panic 且**不 recover** → 进程退出 → 位移未提交 → 重启后该批重读（at-least-once，重复但安全）。处理函数里 panic 被 **recover 吞掉**、循环继续、照常提交 → 这条消息从未被正确处理，位移却越过了它 → **静默丢失**。所以手动提交模式下：要么处理函数对错误负责（返回错误走失败路径），要么让 panic 直接杀死进程；永远不要在「可能没处理完」的情况下继续提交。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "长处理任务与 poll 节奏",
      body: "如果一个业务处理要跑很久（调用外部服务、批处理几万条），「处理完一批再 poll」会让单次 poll 周期变得很长。franz-go 的心跳由后台 goroutine 自动发送，单纯处理慢不会直接掉线；真正的问题出现在**再平衡需要你配合**时（revoke 回调要等你、或 `BlockRebalanceOnPoll` 下你迟迟不 poll），超过再平衡超时会被判定死亡。对策是用 `PollRecords(ctx, n)` 限制单批条数、把大任务拆小，让 poll 保持活跃——[消费组与经典再平衡协议](/courses/kafka/lessons/kafka-consumer-groups-classic)会详细讲这条时间线。",
    },
    {
      type: "exercise",
      title: "练习：亲手制造「重复消费窗口」",
      description: "对 orders.events 用 console producer 连续写 20 条消息。起一个手动提交消费者（上面示例），在 apply 里统计并打印 offset；处理完第 5 条后立刻 `os.Exit(1)`（模拟崩溃，别用优雅退出）。重启消费者观察：它从哪个 offset 继续？那 5 条是否被重读？再把 os.Exit 移到提交之后，重启观察是否还会重读。最后把 `kgo.DisableAutoCommit()` 去掉、回到默认自动提交，重复两次崩溃实验，对比重启后继续的位置，体会「滞后一轮 poll 的自动提交」与手动提交的差别。",
      hint: "关注日志里 offset 的连续性：重读意味着同一 offset 出现两次。os.Exit 前 flush 日志，避免输出丢失误导判断。",
    },
    {
      type: "keypoints",
      items: [
        "Kafka 是拉模型：消费节奏由客户端掌控，慢消费者只产生自己的 lag，不压垮 broker；断线续读靠分区上的位置游标",
        "PollFetches 阻塞到有数据；错误用 EachError 看、记录用 EachRecord/RecordIter 遍历；处理完一批再 poll 下一批",
        "起点语义：franz-go 的 ConsumeStartOffset/ConsumeResetOffset 默认都是 earliest（AtStart），与 Java 默认 latest 相反，生产要显式声明",
        "重放 = 改位置：回放工具用 ConsumePartitions 指定分区与精确 offset；组内提交只前进不回退",
        "提交时机决定语义：默认自动提交每 5s 一次、只提交上一轮 poll 的位移（安全）；GreedyAutoCommit 才有丢失窗口",
        "可靠姿势：DisableAutoCommit + 处理成功整批提交 + OnPartitionsRevoked 补交；提交前 panic 要让进程死，不要吞掉后继续提交",
      ],
    },
  ],
};
