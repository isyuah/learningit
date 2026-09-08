/* ==================================================================
 * 课时：事务与精确一次（Go / franz-go）（kafka-transactions-go）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 5 章第二课：上一课（kafka-delivery-semantics）的“组合 D”
 * （事务 + read_committed）在 franz-go 里的落地。API 均已对照
 * franz-go v1.21.x（pkg.go.dev / docs/transactions.md / examples/transactions）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "consume-transform-produce 为什么需要事务：TransactionalID 与 epoch 僵尸防护、事务协调器、read_committed 消费，以及 franz-go 的可运行实现与适用边界。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课我们把 exactly-once 拆成了「幂等生产者 + [事务](glossary:transaction) + read_committed」三块，并强调它只在 Kafka 内部闭环成立。这一课讲中间那块——事务——在 Go / franz-go 里到底是什么、怎么用、什么时候不该用。场景沿用书舟的支付域：`order.payments` 是支付服务与收单渠道交换「支付指令与结果」的主题（分区键 `order_id`，同一订单的指令与回调天然有序）；`payment.results` 是结算结果事件流，供账务、对账与通知下游消费。我们要实现的是其中一条典型的 consume-transform-produce（读-变换-写）管道：**消费收单结果 → 校验与结算判定 → 把结算事件写进 `payment.results`**。",
    },
    {
      type: "heading",
      text: "动机：为什么「消费提交」和「结果写入」必须是同一个动作",
    },
    {
      type: "paragraph",
      text: "这条管道有两个写入点：向 `payment.results` 写入结算事件，以及向 Kafka 提交「`order.payments` 已经读到这」的消费位点。不使用事务时，它们是两个独立动作，中间隔着一个崩溃窗口，朝哪个方向倒都会出事：",
    },
    {
      type: "list",
      items: [
        "**先写结果、后提交位点**：结算事件已可见，但位点提交前进程崩溃。重平衡后消费者从旧位点重投，同一笔收单被结算两次——下游账务多记一笔（重复）。",
        "**先提交位点、后写结果**：位点已提交，结果写入前崩溃。这条收单永远不会被结算（丢失）。",
        "**就算开了幂等生产者**也只能去掉「producer 重试造成的 Broker 重复」：幂等的作用域是单个生产者会话内的 PID+序列号，跨崩溃重启的新会话、以及「结果写入」与「位点提交」这两个动作之间的不一致，它都管不到。",
      ],
    },
    {
      type: "paragraph",
      text: "你会发现这正是上一课组合 A（at-least-once）留下的缺口：不丢靠「处理完再提交」，但「处理完」和「提交」之间崩溃就重复——默认答案是消费端幂等兜底（[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)）。事务给的则是另一个答案：把**结果写入**和**位点提交**放进同一个原子动作，两者要么一起生效、要么一起回滚，重复与丢失在 Kafka 内部同时消失。",
    },
    {
      type: "heading",
      text: "事务机制：TransactionalID、epoch 与僵尸防护",
    },
    {
      type: "paragraph",
      text: "Kafka 事务的第一个关键概念是 **TransactionalID（事务 ID）**：一个跨进程会话稳定存在的业务标识，例如 `payment-settlement-01`。普通幂等生产者由 Broker 随机分配 PID，进程重启后是新 PID，历史无从谈起；而 TransactionalID 让 Broker 认识「同一个生产者换了个实例」。官方文档的定义是：配置 TransactionalID 后，客户端保证**使用同一 ID 的旧事务在新事务开始前一定已经完结（或被作废）**——这正是「僵尸进程不能再偷偷提交」的承诺来源。",
    },
    {
      type: "paragraph",
      text: "机制上靠 **epoch（纪元）**实现：持有 TransactionalID 的生产者向事务协调器初始化时，协调器分配一个 `(producer id, epoch)`；同一 TransactionalID 再次初始化（旧实例死了、新实例接管）会让 epoch 加一。此后旧实例带着旧 epoch 发出的任何请求都会被 Broker 以 `InvalidProducerEpoch` 拒绝——它被「栅栏（fence）」住了，无法把一笔半截事务提交掉，只能看着自己过期。这就是常说的僵尸防护（zombie fencing）。顺带一提，Kafka 4.0 起服务端会在每笔事务中推进 epoch（KIP-890 的服务端防御），进一步压缩「上一笔事务残留」混进下一笔的空间。",
    },
    {
      type: "paragraph",
      text: "第二个概念是**事务协调器（transaction coordinator）**：Broker 上的一个组件，心智模型和[组协调器](glossary:coordinator)完全一致——按名字哈希到内部事务日志的一个分区，由该分区 leader 所在的 Broker 承担，负责记录每笔事务的状态并执行提交/中止。它的存在让你不用在意「谁记着这回事」：客户端向任意 Broker 发请求，请求会被路由到协调器；协调器挂了，会自动迁移到接管事务日志分区的另一个 Broker。",
    },
    {
      type: "paragraph",
      text: "一次事务的生命周期：客户端 `Begin` 后，各分区写入先照常落盘，但**打上了「属于未决事务」的标记**；`End(commit)` 时协调器协调两阶段收尾，在每个参与分区的日志末尾写入事务**标记记录（marker）**，声明 COMMIT 或 ABORT。消费端靠 marker 才知道哪些消息属于已提交事务。跨分区原子性由此而来：不是「同时落盘」，而是「所有参与分区共享同一个结局声明」，任何时刻崩溃，结局要么还没定（超时后被协调器主动 abort），要么已经由 marker 定死，不存在「一半分区提交了一半没有」。",
    },
    {
      type: "heading",
      text: "消费端的另一半：read_committed 与最后稳定位点",
    },
    {
      type: "table",
      caption: "两种消费隔离级别（Kafka 4.3 文档语义）",
      headers: ["隔离级别", "能看到什么", "代价", "典型用途"],
      rows: [
        ["read_uncommitted（默认）", "一切消息：已提交事务、未决事务、甚至已被 abort 的事务残留", "零额外限制，读到「脏」的瞬时状态", "对账/审计之外的大多数普通消费；只关心非事务消息时"],
        ["read_committed", "已提交事务的消息 + 非事务消息；abort 残留永远不可见", "进行中事务之后的消息被 LSO 截住，直到该事务结束才放行", "消费事务写入的主题，尤其是结算/账务类下游"],
      ],
    },
    {
      type: "paragraph",
      text: "read_committed 消费者的可见范围截止于**最后稳定位点（last stable offset, LSO）**——第一个未决事务的起点。它永远按 offset 顺序返回消息，所以某个分区里若有一笔进行中的事务，LSO 之后的消息（哪怕是其他非事务生产者写的）也要等这笔事务结束才能读到。推论很实际：**一笔长事务会让 read_committed 下游多等它这么久**，这是后文「别开长事务」的理由之一。",
    },
    {
      type: "heading",
      text: "franz-go 的事务 API（v1.21.x，已核对）",
    },
    {
      type: "list",
      items: [
        "装配：`kgo.TransactionalID(id)` 开启事务生产者（幂等自动随之开启，与 `DisableIdempotentWrite` 互斥）；`kgo.TransactionTimeout(d)` 覆盖默认的 40 秒。",
        "纯事务生产：`cl.BeginTransaction()`（必须先调用，否则事务内 Produce 报 `errNotInTransaction`）→ 异步 `cl.Produce(…)` 配合 `kgo.AbortingFirstErrPromise(cl)` 收集首错 → `cl.EndTransaction(ctx, kgo.TryCommit)` 提交、`kgo.EndTransaction(ctx, kgo.TryAbort)` 回滚。",
        "读-处理-写（EOS）：官方推荐 `kgo.NewGroupTransactSession(opts...)` 包装同一客户端的消费与生产，循环为 `PollFetches → Begin → 逐条变换并 Produce → End`；消费位点在 `End(commit)` 时**随事务一起提交**，这是 Kafka 事务与消息系统事务最大的不同——事务的主体是生产者，但它能把「消费者的位置」也改掉。",
        "消费侧：`kgo.FetchIsolationLevel(kgo.ReadCommitted())` 读取已提交数据（默认 `ReadUncommitted`）。",
        "与自动提交的关系：组消费 + TransactionalID 时 franz-go 会自动禁用组自动提交（位点改由事务内提交），所以不必也不能再依赖自动提交兜底；这正是官方设计文档要求的 `enable.auto.commit=false` 语义，客户端替你做了。",
      ],
    },
    {
      type: "paragraph",
      text: "再处理一下「End 之后出错怎么办」。`EndTransaction`/`End` 返回的错误里，凡是结局不确定的（传输中断、`OperationNotAttempted`、`TransactionAbortable`、`UnknownProducerID`），规则是**改用 `TryAbort` 重试**而不是盲目重试 `TryCommit`——提交结果未知时再试一次提交可能造成重复，而 abort 会让协调器 bump epoch、把服务端未决的旧事务作废，是安全的收敛方向。Kafka 4.1 起（KIP-1050）把事务错误分类标准化为 `Retriable`、`Abortable`、`ApplicationRecoverable` 等几类，客户端与应用按类别各司其职；对大多数应用，官方给出的最简恢复策略是「丢弃并重建 producer/consumer，让组重平衡回到最后提交的位点」。",
    },
    {
      type: "heading",
      text: "可运行示例一：结算管道（事务内 消费-变换-生产）",
    },
    {
      type: "paragraph",
      text: "结构对齐 franz-go 官方 `examples/transactions` 的 EOS 模式，去掉演示参数外壳。运行前需建好 `order.payments` 与 `payment.results` 两个主题，并有一个生产者往 `order.payments` 写收单结果（key 为 `order_id`）。注意 `GroupTransactSession` 的 `End`：组再平衡发生在事务提交前时会自动 abort，这是防重复的关键行为（详见代码注释与下文的坑）。",
    },
    {
      type: "code",
      title: "结算管道：消费 order.payments → 校验 → 事务写入 payment.results（franz-go）",
      language: "go",
      code: "package main\n\nimport (\n\t\"context\"\n\t\"encoding/json\"\n\t\"log\"\n\t\"time\"\n\n\t\"github.com/twmb/franz-go/pkg/kgo\"\n)\n\n// order.payments 上的收单结果消息。\ntype paymentResult struct {\n\tOrderID string `json:\"order_id\"`\n\tStatus  string `json:\"status\"` // success | failed\n\tAmount  string `json:\"amount\"`\n\tChannel string `json:\"channel\"`\n}\n\n// 写入 payment.results 的结算事件。\ntype settlement struct {\n\tOrderID      string `json:\"order_id\"`\n\tPaymentState string `json:\"payment_state\"` // settled | failed\n\tChannel      string `json:\"channel\"`\n\tAmount       string `json:\"amount\"`\n\tSettledAt    string `json:\"settled_at\"`\n}\n\nfunc settle(in paymentResult) settlement {\n\tstate := \"failed\"\n\tif in.Status == \"success\" {\n\t\tstate = \"settled\"\n\t}\n\treturn settlement{\n\t\tOrderID:      in.OrderID,\n\t\tPaymentState: state,\n\t\tChannel:      in.Channel,\n\t\tAmount:       in.Amount,\n\t\tSettledAt:    time.Now().UTC().Format(time.RFC3339),\n\t}\n}\n\nfunc main() {\n\t// 同一 client 既是消费组成员又是事务生产者；TransactionalID 必须稳定。\n\tsess, err := kgo.NewGroupTransactSession(\n\t\tkgo.SeedBrokers(\"localhost:9092\"),\n\t\tkgo.ConsumerGroup(\"payment-settlement\"),\n\t\tkgo.ConsumeTopics(\"order.payments\"),\n\t\tkgo.TransactionalID(\"payment-settlement-01\"),\n\t\tkgo.FetchIsolationLevel(kgo.ReadCommitted()),\n\t)\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tdefer sess.Close()\n\n\tctx := context.Background()\n\tfor {\n\t\tfetches := sess.PollFetches(ctx)\n\t\tif errs := fetches.Errors(); len(errs) > 0 {\n\t\t\tfor _, fe := range errs {\n\t\t\t\tlog.Printf(\"fetch error topic=%s partition=%d: %v\", fe.Topic, fe.Partition, fe.Err)\n\t\t\t}\n\t\t\tcontinue\n\t\t}\n\t\tif fetches.Empty() {\n\t\t\tcontinue\n\t\t}\n\n\t\tif err := sess.Begin(); err != nil {\n\t\t\tlog.Fatal(err)\n\t\t}\n\t\te := kgo.AbortingFirstErrPromise(sess.Client())\n\t\tok := true\n\n\t\tfetches.EachRecord(func(r *kgo.Record) {\n\t\t\tvar in paymentResult\n\t\t\tif err := json.Unmarshal(r.Value, &in); err != nil {\n\t\t\t\tok = false // 坏消息：本事务 abort，消息会重投。\n\t\t\t\treturn   // 真实工程应在这里转 DLQ 而非无限重试（见「消费失败、重试、死信与幂等消费」课）。\n\t\t\t}\n\t\t\tout, err := json.Marshal(settle(in))\n\t\t\tif err != nil {\n\t\t\t\tok = false\n\t\t\t\treturn\n\t\t\t}\n\t\t\t// key 沿用 order_id：结算事件与收单结果同分区，保证订单级顺序。\n\t\t\tsess.Produce(ctx, &kgo.Record{\n\t\t\t\tTopic: \"payment.results\",\n\t\t\t\tKey:   r.Key,\n\t\t\t\tValue: out,\n\t\t\t}, e.Promise())\n\t\t})\n\n\t\t// 全部成功才提交；提交时本批消费位点与结算事件一起原子生效。\n\t\tif ok && e.Err() == nil {\n\t\t\tif _, err := sess.End(ctx, kgo.TryCommit); err != nil {\n\t\t\t\tlog.Fatal(err)\n\t\t\t}\n\t\t\tcontinue\n\t\t}\n\t\t// 任一消息坏掉就 abort：结算事件不可见，位点也不前进（会重投）。\n\t\tif _, err := sess.End(ctx, kgo.TryAbort); err != nil {\n\t\t\tlog.Fatal(err)\n\t\t}\n\t}\n}\n",
    },
    {
      type: "paragraph",
      text: "这段代码里值得盯住的只有两行：`sess.Produce` 与 `sess.End`。结算事件与消费位点共享同一个事务结局——提交则全部可见且位点前进，abort 则全部不可见且位点留在原地。`GroupTransactSession` 在幕后还替你处理了两件容易做错的事：事务期间发生组再平衡时把本事务强制 abort（而不是带着可能被别人接管的分区去提交），以及 `End` 前强制一次成功的心跳、确保提交发生时自己仍是合法成员（Kafka ≥ 2.5 后另有 `RequireStable` 机制在 Broker 侧兜底）。",
    },
    {
      type: "heading",
      text: "可运行示例二：纯事务生产（一批支付指令，全提交或全回滚）",
    },
    {
      type: "code",
      title: "事务生产者：批量写入 order.payments（franz-go）",
      language: "go",
      code: "package main\n\nimport (\n\t\"context\"\n\t\"fmt\"\n\t\"log\"\n\n\t\"github.com/twmb/franz-go/pkg/kgo\"\n)\n\nfunc main() {\n\tcl, err := kgo.NewClient(\n\t\tkgo.SeedBrokers(\"localhost:9092\"),\n\t\tkgo.DefaultProduceTopic(\"order.payments\"),\n\t\tkgo.TransactionalID(\"payment-charge-01\"),\n\t)\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tdefer cl.Close()\n\n\tctx := context.Background()\n\tfor batch := 0; batch < 5; batch++ {\n\t\t// 事务内的 Produce 必须在 BeginTransaction 之后。\n\t\tif err := cl.BeginTransaction(); err != nil {\n\t\t\tlog.Fatal(err)\n\t\t}\n\n\t\te := kgo.AbortingFirstErrPromise(cl)\n\t\tfor i := 0; i < 10; i++ {\n\t\t\tcl.Produce(ctx, &kgo.Record{\n\t\t\t\tKey:   []byte(fmt.Sprintf(\"20260908-%06d\", batch*10+i)),\n\t\t\t\tValue: []byte(`{\"action\":\"charge\"}`),\n\t\t\t}, e.Promise())\n\t\t}\n\n\t\t// AbortingFirstErrPromise.Err() 同步等到本批全部落定并返回首个错误。\n\t\tif e.Err() != nil {\n\t\t\t// 有发送失败：整批回滚。\n\t\t\tif err := cl.EndTransaction(ctx, kgo.TryAbort); err != nil {\n\t\t\t\tlog.Fatal(err)\n\t\t\t}\n\t\t\tcontinue\n\t\t}\n\t\tif err := cl.EndTransaction(ctx, kgo.TryCommit); err != nil {\n\t\t\t// 提交结局不确定的错误（如超时）：用 TryAbort 收敛，见正文。\n\t\t\tlog.Fatal(err)\n\t\t}\n\t}\n}\n",
    },
    {
      type: "heading",
      text: "常见坑与边界：什么时候不该用事务",
    },
    {
      type: "list",
      items: [
        "**事务超时**：一笔事务从第一个分区加入起算，超过 `transaction.timeout.ms`（Kafka 生产者默认 60 秒；franz-go 客户端默认 40 秒，刻意小于组会话超时）会被协调器主动 abort。调大超时要小心 Broker 侧 `transaction.max.timeout.ms`（默认 15 分钟）是硬上限，超过它 `InitProducerId` 直接失败。长事务的另一面是延迟传导：read_committed 下游会一直等到事务结束，超长事务等于给下游放了一堵墙。",
        "**协调器故障与不确定结局**：协调器迁移期间会返回 `CoordinatorNotAvailable` 一类错误，客户端会重试；真正的难点是「提交请求发出去但没收到响应」——结局未知。不要盲目重试提交，用 abort 收敛（前面讲过），或按 KIP-1050 的错误分类 + 「重建客户端回到最后提交位点」的最简策略。",
        "**事务有成本**：每次提交都要协调器走一轮两阶段收尾并在每个参与分区写 marker，相比普通批量生产多了肉眼可见的往返与写放大；吞吐会下降，批越大摊得越薄。用之前先量化你的峰值与延迟预算，别给日志型管道也上事务。",
        "**事务管不到 Kafka 之外**：结算事件里若是要同时更新自己的数据库、调用渠道查询 API，那些副作用不在事务里——这一课的「精确一次」只覆盖 `order.payments` 读与 `payment.results` 写。外部副作用请回到上一课的结论：幂等键或 [Outbox](glossary:outbox)（第 6 章）。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "决策：这条管道该不该上事务？",
      body: "上事务的唯一理由是「读 Kafka、写 Kafka 的两处状态必须同生共死」，典型如结算落账、把消费位点与结果一起推进。以下情况**不该**上：输出主要是外部系统（数据库/API/第三方）时，事务给不了你端到端保证，反而赔上吞吐与复杂度——此时 at-least-once + 幂等消费（[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)）或 Outbox 更划算；消息价值低、丢几条无所谓的日志型管道；需要跨多个服务协作的「长业务流程」——事务边界只在一个进程内，跨服务仍要靠事件与幂等。一个粗略标尺：**账务、库存、支付结果这类「算错一次就要赔钱」的 Kafka 内闭环，值得；其余先问幂等能不能解决。**",
    },
    {
      type: "quiz",
      question: "僵尸防护：支付结算管道用 TransactionalID「payment-settlement-01」跑着，实例因网络分区与集群失联，运维另起了一个新实例（同一 TransactionalID）接管。网络恢复后旧实例「复活」，试图把自己那笔未决事务提交掉。Broker 会怎么做？",
      options: [
        "正常接受——协调器允许任何持有同一事务 ID 的旧会话把未决事务提交完，避免数据悬空",
        "拒绝——新实例初始化已使 epoch 加一，旧实例带旧 epoch 的提交请求会收到 InvalidProducerEpoch 被栅栏隔离，其未决事务只能等超时被 abort",
        "接受提交，但把新实例后续写入全部作废，保证只有一个实例在写",
        "报错说事务 ID 冲突，两个实例都被踢出并等待人工指定主实例",
      ],
      answer: 1,
      explanation:
        "epoch 栅栏是僵尸防护的核心：同一 TransactionalID 的新会话初始化会让协调器推进 epoch，旧实例的所有请求（含 EndTxn 提交）都带着旧 epoch，会被 InvalidProducerEpoch 拒绝；旧实例不可能再提交，其服务端残留事务由事务超时机制兜底 abort。选项 1 描述的「允许旧会话完结」正是 Kafka 事务要消灭的重复来源。",
    },
    {
      type: "keypoints",
      items: [
        "consume-transform-produce 的崩溃缺口 = 「结果写入」与「位点提交」两个动作之间的窗口；事务把它们变成一个原子动作",
        "TransactionalID 跨会话标识生产者；新会话 epoch+1，旧会话被栅栏拒绝——僵尸防护",
        "事务协调器按事务 ID 哈希托管内部事务日志，与组协调器同构；提交/中止由写入各参与分区的 marker 统一声明",
        "read_committed 只见已提交事务消息，可见范围截止 LSO；默认 read_uncommitted 连 abort 残留都看得到",
        "franz-go：TransactionalID + NewGroupTransactSession（PollFetches/Begin/Produce/End），位点随事务提交；End 结局不确定时用 TryAbort 收敛",
        "事务成本与边界：超时、协调器故障、吞吐开销，以及「覆盖不到外部系统」——先问幂等能不能解决，再决定要不要事务",
      ],
    },
  ],
};
