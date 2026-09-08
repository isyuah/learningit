/* ==================================================================
 * 课时：消费失败、重试、死信与幂等消费（kafka-failure-patterns-dlq）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 5 章第三课：把 at-least-once 的“重复”与“失败”变成可观测、
 * 可收敛的工程流程（失败分类 → 有限重试 → 死信 → 幂等消费）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "消费失败的分类、进程内退避与重试主题的边界、死信模式与毒消息隔离，以及 at-least-once 下幂等消费的落地（唯一键 / 状态表）。",
  blocks: [
    {
      type: "paragraph",
      text: "前两课把「语义」讲清楚了：默认组合是 at-least-once（不丢但可能重）；事务能给你 Kafka 内闭环的精确一次，但代价不小、边界在 Kafka 之外。于是绝大多数书舟管道（包括[事务与精确一次（Go / franz-go）](/courses/kafka/lessons/kafka-transactions-go)那条结算管道）的真实工程形态是：**at-least-once + 幂等消费兜底 + 一套把「处理失败」收敛成可观测流程的机制**。本课把这套机制讲透：失败先分类、重试要有边界、救不回来的进[死信](glossary:dead-letter)、毒消息要隔离、消费端必须幂等——最后用指标把整条链路闭合成一个环。",
    },
    {
      type: "heading",
      text: "第一步：失败分类——瞬态可重试，永久不可重试",
    },
    {
      type: "paragraph",
      text: "处理一条消息失败时，先别急着重试，问一个问题：**再试一次会好吗？**答案把失败分成两类，两类命运完全不同。回到[事务与精确一次](/courses/kafka/lessons/kafka-transactions-go)课的结算管道：消费者从 `order.payments` 收到收单回调后要查库、对金额、必要时回调渠道确认。此刻常见的失败有三种：连数据库的瞬间超时（再试一次可能就好）；调渠道查单接口被限流返回 429（几秒后就好）；以及回调里 `status` 字段根本不存在、金额是负数——这种消息重试一万次也过不了，属于坏数据。把第三种和第一种混在一个「失败就重试」的循环里，是消费端最常见的死法。",
    },
    {
      type: "table",
      caption: "失败分类与处置（书舟结算/通知管道）",
      headers: ["类别", "书舟例子", "重试有意义吗", "处置"],
      rows: [
        ["瞬态（可重试）", "数据库连接池抖动/超时、渠道限流 429 与 5xx、依赖服务重启中、Kafka 协调器短暂不可用", "有，但必须有限次 + 退避", "指数退避重试若干次；仍失败则转重试主题或死信"],
        ["永久（不可重试）", "JSON 解析失败、必填字段缺失、金额非法、业务规则拒绝（订单已关闭不允许结算）、版本过期", "没有，重试只会重复浪费", "直接进死信并告警，把「修数据」留给人工或补偿流程"],
        ["重复投递（不是错误）", "同一收单回调因提交前崩溃被重投；已处理过", "不适用", "幂等消费吸收（本课第 5 节）：当成成功，别再折腾"],
      ],
    },
    {
      type: "heading",
      text: "重试策略：进程内退避的边界",
    },
    {
      type: "paragraph",
      text: "进程内重试最简单：处理函数里 `for` 循环，瞬态错误就退避后重来（franz-go 官方 `examples/dlq` 就是这么演示的）。但你要看清它的边界——同一分区的消息是按 offset 顺序串行处理的，**一条消息卡在退避里，它后面的所有消息都排着队**：这一单的结算多退避 10 秒，同分区后一千单的结算都晚 10 秒，lag 随之上涨。另外，退避期间的循环阻塞在业务代码里；franz-go 的心跳由独立后台循环负责，不会因为你不 poll 就直接被踢出组，但已拉取未提交的消息占着内存、再平衡时的位点回退也照常发生。所以进程内退避的正确用法是：**次数少（个位数）、单次上限小（秒级）、只用于「马上就好」的抖动**。需要更长或更稳的延迟，就要把失败消息从主分区里挪出去——这就是重试主题。",
    },
    {
      type: "heading",
      text: "Kafka 没有原生延迟消息：重试主题与延迟消费",
    },
    {
      type: "paragraph",
      text: "RabbitMQ 有死信重投、延时插件，Kafka 没有「N 秒后再投一次」的原语——日志只往前写。社区通用做法是把「等待」从主消费流里拆出去：失败消息投到一个专门的**重试主题**，由独立的消费者组按自己的节奏处理（睡够延迟 → 重新放回主主题或投往下一级），这样主分区的消费进度不被拖住。常见形态：多级重试主题（如 `orders.events-retry-1m`、`orders.events-retry-10m`，名称没有官方标准、按团队约定即可）；或用外部调度器（Redis 有序集合、定时任务表）到期再塞回 Kafka。下表是权衡。",
    },
    {
      type: "table",
      caption: "延迟重试三种方案对比",
      headers: ["方案", "延迟精度", "复杂度", "适用"],
      rows: [
        ["进程内有限退避", "即时、抖动小", "最低", "秒级以内的瞬态抖动；单分区吞吐压力小"],
        ["多级重试主题 + 独立消费组", "分钟级（每级一个档位）", "中：多主题 + 重放逻辑", "需要把坏消息移出主分区、又不想引入 Kafka 外组件"],
        ["外部调度（Redis/任务表）", "任意精度", "高：多一个可靠组件", "重试量大、需要精确延迟/动态退避的团队"],
      ],
    },
    {
      type: "code",
      title: "多级重试主题的延迟消费者（示意骨架，社区通用模式）",
      language: "go",
      code: "// 示意骨架：监听一级重试主题，到点把消息放回主主题。\n// 睡眠式延迟只用于讲清结构；生产实现应把“到期再投”交给调度\n// 或分级主题（多档延迟各配一个消费者），并做好重试计数与幂等。\nfunc retryWorker(ctx context.Context, retryCl *kgo.Client, delay time.Duration) {\n\tfor {\n\t\tfetches := retryCl.PollFetches(ctx)\n\t\tfetches.EachError(func(_ string, _ int32, err error) {\n\t\t\tlog.Printf(\"retry worker fetch error: %v\", err)\n\t\t})\n\t\tfetches.EachRecord(func(r *kgo.Record) {\n\t\t\tselect {\n\t\t\tcase <-time.After(delay): // 示意：到点再处理\n\t\t\tcase <-ctx.Done():\n\t\t\t\treturn\n\t\t\t}\n\t\t\t// 重新投回主主题；由主消费者按正常路径处理。\n\t\t\t// 注意：重试次数要用 header 带上，供主消费者决定“下次进哪一级/进死信”。\n\t\t\tres := retryCl.ProduceSync(ctx, &kgo.Record{\n\t\t\t\tTopic:   \"orders.events\", // 示意：写回主主题；分级重试按 header 决定投回或升下一级\n\t\t\t\tKey:     r.Key,\n\t\t\t\tValue:   r.Value,\n\t\t\t\tHeaders: r.Headers,\n\t\t\t})\n\t\t\tif res.FirstErr() != nil {\n\t\t\t\tlog.Printf(\"requeue failed: %v\", res.FirstErr())\n\t\t\t}\n\t\t})\n\t}\n}"
    },
    {
      type: "paragraph",
      text: "重试主题必须由**独立的消费组**消费，这是它的全部意义：重试中的消息不占主消费组的位点，主分区继续前进；重试级联时记得用 header 记录已尝试次数，超过阈值就转死信而不是无限升级。",
    },
    {
      type: "heading",
      text: "死信模式：救不回来的消息去哪",
    },
    {
      type: "paragraph",
      text: "有限次重试后仍失败（或一开始就是永久失败）的消息，投递到**死信主题**：命名规范 `dlq.<原主题>`——书舟主题集里预置的 `dlq.orders.events` 就是订单事件流（原主题 `orders.events`）按这条规则建的演示死信；结算管道若以 `order.payments` 为源，其死信就是 `dlq.order.payments`。再次强调：Kafka 核心没有任何内置死信机制，这是纯客户端模式，Broker 不关心、不代投——「投死信」是你的消费者代码里一个普通的 Produce 调用。",
    },
    {
      type: "paragraph",
      text: "死信消息必须携带**足够现场**：原始消息的 key/value、来源主题/分区/offset、时间、失败原因与已尝试次数。franz-go 官方 `examples/dlq` 的结构可参考：处理失败若干次后，把原始记录包成一个 JSON（内含 topic/key/value/offset/partition 等元数据）写入死信主题，并把错误信息放进 header（如 `status: review`、`error: <原因>`）供后续审计。下面是一段更贴近书舟的完整示例：notify 服务消费 `orders.events` 发通知，瞬态错误退避重试有限次，仍失败则带现场投递 `dlq.orders.events`，无论成功还是转死信都提交位点。",
    },
    {
      type: "code",
      title: "有限重试 + 死信投递 + 位点提交（franz-go，参考官方 examples/dlq 结构）",
      language: "go",
      code: "package main\n\nimport (\n\t\"context\"\n\t\"encoding/json\"\n\t\"errors\"\n\t\"fmt\"\n\t\"log\"\n\t\"time\"\n\n\t\"github.com/twmb/franz-go/pkg/kgo\"\n)\n\nconst (\n\tgroup       = \"notify-order\"\n\tmainTopic   = \"orders.events\"\n\tdlqTopic    = \"dlq.orders.events\"\n\tmaxAttempts = 3\n)\n\nvar errTransient = errors.New(\"transient\")\n\n// 死信信封：带足原始消息与失败现场。\ntype dlqEnvelope struct {\n\tSourceTopic string    `json:\"source_topic\"`\n\tPartition   int32     `json:\"partition\"`\n\tOffset      int64     `json:\"offset\"`\n\tKey         []byte    `json:\"key\"`\n\tValue       []byte    `json:\"value\"`\n\tFailedAt    time.Time `json:\"failed_at\"`\n}\n\nfunc main() {\n\tcl, err := kgo.NewClient(\n\t\tkgo.SeedBrokers(\"localhost:9092\"),\n\t\tkgo.ConsumerGroup(group),\n\t\tkgo.ConsumeTopics(mainTopic),\n\t\tkgo.DisableAutoCommit(), // 手动提交，位点与处理结果对齐\n\t)\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tdefer cl.Close()\n\n\tdlq, err := kgo.NewClient(kgo.SeedBrokers(\"localhost:9092\"))\n\tif err != nil {\n\t\tlog.Fatal(err)\n\t}\n\tdefer dlq.Close()\n\n\tctx := context.Background()\n\tfor {\n\t\tfetches := cl.PollFetches(ctx)\n\t\tfetches.EachError(func(_ string, _ int32, err error) {\n\t\t\tlog.Printf(\"fetch error: %v\", err)\n\t\t})\n\t\tfetches.EachRecord(func(r *kgo.Record) {\n\t\t\terr := handleWithRetry(ctx, r)\n\t\t\tif err != nil {\n\t\t\t\ttoDLQ(ctx, dlq, r, err)\n\t\t\t}\n\t\t\t// 无论成功还是转死信，本消息都已“处理完毕”，提交位点。\n\t\t\t// 崩溃窗口（DLQ 已投、offset 未提交）只会造成死信重复，可接受。\n\t\t\tif err := cl.CommitRecords(ctx, r); err != nil {\n\t\t\t\tlog.Printf(\"commit failed: %v\", err)\n\t\t\t}\n\t\t})\n\t}\n}\n\n// handleWithRetry：只对瞬态错误做有限次退避重试。\nfunc handleWithRetry(ctx context.Context, r *kgo.Record) error {\n\tbackoff := 200 * time.Millisecond\n\tvar lastErr error\n\tfor attempt := 1; attempt <= maxAttempts; attempt++ {\n\t\tlastErr = handle(ctx, r)\n\t\tif lastErr == nil {\n\t\t\treturn nil\n\t\t}\n\t\tif !errors.Is(lastErr, errTransient) {\n\t\t\treturn lastErr // 永久错误：重试无意义，直接进死信\n\t\t}\n\t\ttime.Sleep(backoff)\n\t\tbackoff *= 2\n\t}\n\treturn lastErr\n}\n\n// handle 是业务处理；这里把“数据库抖动”与“消息坏掉”用哨兵错误区分开。\nfunc handle(_ context.Context, r *kgo.Record) error {\n\tvar ev struct {\n\t\tOrderID string `json:\"order_id\"`\n\t\tEvent   string `json:\"event\"`\n\t}\n\tif err := json.Unmarshal(r.Value, &ev); err != nil {\n\t\treturn fmt.Errorf(\"bad message: %w\", err) // 结构坏：永久\n\t}\n\tif ev.OrderID == \"\" {\n\t\treturn errors.New(\"bad message: order_id empty\") // 缺业务键：永久\n\t}\n\tif ev.Event == \"order.created\" {\n\t\treturn fmt.Errorf(\"%w: sms provider busy\", errTransient) // 瞬态示例\n\t}\n\treturn nil\n}\n\nfunc toDLQ(ctx context.Context, dlq *kgo.Client, r *kgo.Record, cause error) {\n\tenv, _ := json.Marshal(dlqEnvelope{\n\t\tSourceTopic: r.Topic,\n\t\tPartition:   r.Partition,\n\t\tOffset:      r.Offset,\n\t\tKey:         r.Key,\n\t\tValue:       r.Value,\n\t\tFailedAt:    time.Now().UTC(),\n\t})\n\tres := dlq.ProduceSync(ctx, &kgo.Record{\n\t\tTopic: dlqTopic,\n\t\tKey:   r.Key, // 保留原 key：重放去重与按订单聚合都靠它\n\t\tValue: env,\n\t\tHeaders: []kgo.RecordHeader{\n\t\t\t{Key: \"error\", Value: []byte(cause.Error())},\n\t\t\t{Key: \"status\", Value: []byte(\"review\")},\n\t\t},\n\t})\n\tif res.FirstErr() != nil {\n\t\tlog.Printf(\"dlq produce failed: %v\", res.FirstErr())\n\t}\n}\n",
    },
    {
      type: "paragraph",
      text: "谁来消费死信？三条路线各有用处：**人工兜底**——值班人员看 `dlq.orders.events`，修好数据（补字段、订正业务状态）后把消息重放回原主题，靠幂等吸收已处理的部分；**自动补偿**——定时任务批量重放，成功即移出，连续失败自动停下并告警，防止补偿器自己变成打不死的小强；**统计与审计**——死信即「处理不了的数据清单」，按错误原因聚合能反向暴露上游的数据质量问题。无论哪条路线，死信主题都建议保留较长周期、且**一有消息就要有人看**——死信增长本身就是一个告警信号。",
    },
    {
      type: "heading",
      text: "毒消息：识别与隔离",
    },
    {
      type: "paragraph",
      text: "毒消息（poison message）是「反复失败、每次失败方式一样」的消息——典型如结构永远解析不了的坏 JSON。它的危险不在自身，而在**队头阻塞**：单分区顺序消费下，一条毒消息卡在重试循环里，它后面整个分区的消息全部延迟，lag 只涨不消，日志被同样的错误刷屏，而你误以为系统在「努力重试」。识别毒消息靠统计而非感觉：把失败按错误类型聚合，发现同一消息/同一原因快速、重复失败，而不是偶发抖动。隔离手段就是前两节的机制——**给重试设上限（如 3 次），到顶直接进死信并提交位点**，让分区继续前进；永远不要「不重试也不死信」地跳过，那等于静默丢消息。隔离后那个 offset 的位置空洞是正常的：后续消息已按新位点继续，业务状态靠幂等与状态机收敛，不依赖逐条回放。",
    },
    {
      type: "heading",
      text: "幂等消费：at-least-once 的必修课",
    },
    {
      type: "paragraph",
      text: "[投递语义](/courses/kafka/lessons/kafka-delivery-semantics)的组合 A 告诉我们：默认配置下消息可能重复投递——提交前崩溃、重平衡、从死信重放，都会让同一条消息再次进入处理函数。既然重复不可避免，就让**处理动作本身对重复免疫**：同一消息处理两次与处理一次效果相同，这就是幂等消费。它是书舟大多数管道「端到端有效一次」的真正主力——[事务](glossary:transaction)只在 Kafka 内闭环可用且成本高，幂等却覆盖一切外部副作用（数据库、API）。下面两种是落库型消费最常见的实现。",
    },
    {
      type: "subheading",
      text: "方法一：业务表唯一键（重复插入被拒）",
    },
    {
      type: "paragraph",
      text: "当「处理」就是往业务表插一行时，给业务键加唯一约束，重复消息的插入会撞唯一键——把它当成「已经处理过」即可。书舟结算表以 `order_id` 为唯一键：同一笔收单回调不管重投几次，`payment_settlements` 里只有一行。",
    },
    {
      type: "code",
      title: "结算幂等落库：唯一约束 + ON CONFLICT（PostgreSQL 语法）",
      language: "sql",
      code: "CREATE TABLE payment_settlements (\n    order_id    TEXT PRIMARY KEY,      -- 业务键即幂等键\n    state       TEXT NOT NULL,        -- settled / failed\n    amount      NUMERIC(10, 2) NOT NULL,\n    channel     TEXT NOT NULL,\n    settled_at  TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n\n-- 处理消息时执行；重复投递会命中冲突并被 DO NOTHING 吸收。\nINSERT INTO payment_settlements (order_id, state, amount, channel)\nVALUES ($1, $2, $3, $4)\nON CONFLICT (order_id) DO NOTHING;\n",
    },
    {
      type: "paragraph",
      text: "配合 Go：`RowsAffected()` 返回 0 说明冲突命中、这笔早已结算过，直接当成功提交位点；返回 1 说明本次是新处理。用**业务键**（`order_id`）而不是 Kafka 的 `(topic, partition, offset)` 当幂等键还有个现实理由：从死信重放时消息换了 offset，只有业务键能跨重放去重。",
    },
    {
      type: "subheading",
      text: "方法二：状态表/处理记录表（处理与记账同事务）",
    },
    {
      type: "paragraph",
      text: "当一次处理要改多张表、或写入本身不天然幂等（如累加余额）时，单独建一张**处理记录表**（以事件业务键或 `(topic, partition, offset)` 为唯一键），并且「先插记录 + 执行业务写」必须在**同一个数据库事务**里：事务提交，说明这笔处理已记账；事务回滚，记录也没了，重投后可以放心重做。这个「记录结果与业务写入由数据库事务保证原子」的手法，和第 6 章[事务性 Outbox、CDC 与事件溯源](/courses/kafka/lessons/kafka-outbox-cdc-es)里的 [Outbox](glossary:outbox) 是同一套思想——区别只是这里记的是「处理过」，Outbox 记的是「待发布」。",
    },
    {
      type: "code",
      title: "处理记录表 + 业务写，同一事务（database/sql + PostgreSQL 语义）",
      language: "go",
      code: "func applySettlementOnce(ctx context.Context, db *sql.DB, ev settlementEvent) error {\n\ttx, err := db.BeginTx(ctx, nil)\n\tif err != nil {\n\t\treturn err\n\t}\n\tdefer tx.Rollback() // 提交成功后 Rollback 是 no-op\n\n\t// 1) 先占位：同一事件(或同一 order_id)重复投递时唯一冲突 → 直接幂等返回\n\tres, err := tx.ExecContext(ctx, `\n\t\tINSERT INTO processed_events (event_key, order_id, processed_at)\n\t\tVALUES ($1, $2, now()) ON CONFLICT (event_key) DO NOTHING`, ev.Key, ev.OrderID)\n\tif err != nil {\n\t\treturn err\n\t}\n\tif n, _ := res.RowsAffected(); n == 0 {\n\t\treturn nil // 已经处理过：幂等命中，视为成功\n\t}\n\n\t// 2) 业务写（此处以余额结算为例；失败则整个事务回滚，记录一并撤销）\n\tif _, err := tx.ExecContext(ctx, `UPDATE accounts SET balance = balance + $1 WHERE id = $2`,\n\t\tev.Amount, ev.AccountID); err != nil {\n\t\treturn err\n\t}\n\n\t// 3) 同一事务提交：记录与业务写要么都生效，要么都不生效\n\treturn tx.Commit()\n}\n",
    },
    {
      type: "callout",
      variant: "tip",
      title: "别把两个系统塞进一个事务",
      body: "上面的两种方法都要求「处理与记录」落在**同一个数据库事务**里，因为只有数据库能给你跨表原子性。如果你试图在同一个流程里既写数据库又写 Kafka，还指望它们原子——Kafka 事务覆盖不到数据库，数据库事务覆盖不到 Kafka，两个系统的原子性不可兼得。这时正确的分层是：数据库事务内只做业务与记录（含 Outbox 表），由独立 relay 把事件发到 Kafka；或者接受 at-least-once + 消费侧幂等。把「跨系统原子」的幻想写进代码，是分布式系统事故的头号来源。",
    },
    {
      type: "heading",
      text: "观测闭环：失败、重试、死信与 lag 一起看",
    },
    {
      type: "paragraph",
      text: "把机制接好之后，最后一步是让它在指标里可见：为每个消费管道埋几个计数器——处理总数、失败数（按错误类别分）、重试次数、投递死信数，标签至少带上 `consumer_group` 与 `topic`——然后和[消费滞后](glossary:lag)放在同一张看板上读（指标细节与告警分层在第 9 章[观测：指标、日志与消费滞后](/courses/kafka/lessons/kafka-monitoring-lag)展开）。三条最常用的判读规则：lag 涨 + 重试计数涨 = 瞬态风暴，看下游依赖；lag 正常 + 死信计数涨 = 有永久坏消息在等人处理；lag 涨 + 死信不涨 + 无错误日志 = 消费者卡死或毒消息在无限重试，去看 poll 循环。机制再完备，没有这些数字兜底，你仍然是在黑箱里运维。",
    },
    {
      type: "quiz",
      question:
        "结算消费者按单分区顺序消费，某条支付回调的 JSON 结构损坏，每次处理都在解析处报错。若代码「失败就无限重试、不设上限」，最可能出现的结果是什么？正确的工程处置是什么？",
      options: [
        "消息最终会被 Kafka 自动跳过，消费继续——无需处理，重平衡会自动隔离坏消息",
        "该消息会一直重试直到成功，系统只是多花些 CPU，无其他影响",
        "该分区被毒消息队头阻塞：后续订单全部延迟、lag 只涨不消、错误日志刷屏；正确做法是限次退避重试后投递死信（带错误信息与原始消息）并提交位点，让分区继续",
        "Broker 检测到坏消息后会把该分区标记为只读，自动迁移到其他分区继续消费",
      ],
      answer: 2,
      explanation:
        "毒消息的危险是队头阻塞：单分区串行消费下，卡死的消息挡住同分区所有后续消息。重试上限 + 死信隔离是标准处置——永久失败不浪费重试，死信保留现场供人工修复后重放（重放靠业务键幂等去重）。Kafka 本身不检测、不跳过任何消息内容，选项 1/4 是常见误解。",
    },
    {
      type: "keypoints",
      items: [
        "失败先分类：瞬态（限流/抖动）才有重试价值；永久（坏数据/规则拒绝）直接死信；重复投递不是错误，用幂等吸收",
        "进程内退避只适合秒级抖动：同分区串行，一条卡住全分区排队；更长的延迟用独立重试主题或外部调度",
        "Kafka 无内置死信机制，也没有延迟消息原语——两者都是客户端模式；死信主题按 dlq.<原主题> 命名并带原始消息 + 错误现场",
        "毒消息靠失败计数识别、靠重试上限隔离：限次重试后进死信并提交位点，宁要空洞不要卡死",
        "幂等消费是 at-least-once 的必修课：业务表唯一键（ON CONFLICT）或处理记录表与业务写同库事务；用业务键而非 offset 才能跨重放去重",
        "失败/重试/DLQ 计数与 lag 同看板：lag 涨查瞬态，DLQ 涨查坏消息，两者都不动先查 poll 循环",
      ],
    },
  ],
};
