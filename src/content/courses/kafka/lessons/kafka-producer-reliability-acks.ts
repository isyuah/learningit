/* ==================================================================
 * 课时：可靠发布：acks、重试与幂等生产者（kafka-producer-reliability-acks）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Kafka 4.x（broker 默认值核对 kafka.apache.org/43 文档）；
 * Go 客户端 franz-go v1.21.x（默认值核对 v1.21.6 源码 pkg/kgo/config.go）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "acks 三档各自的丢数据窗口、重试与交付时限、幂等生产者的机制与边界，附常见错误处置与生产发布清单。",
  blocks: [
    {
      type: "paragraph",
      text: "复盘一次真实的「书舟」线上事故：凌晨某 broker 因磁盘告警抖动，orders 服务到 Kafka 的网络出现约 30 秒的间歇中断。事后对账发现三件事：一部分订单的 `order.cancelled` 事件比 `order.created` 先被消费方处理；个别订单的 `created` 事件出现了两条；还有一小批订单事件彻底没进主题。三件事三个根因：乱序与重复出在「幂等被关 + 多个 in-flight」，丢失出在「交付无上限、失败后没有补偿」。要讲清它们，正好需要这节课的三个主题：acks 确认语义（成功标准）、重试与交付时限、幂等生产者——这也是为什么第 2 章只讲了 [ISR](glossary:isr) 的机制，把「生产者视角的精确结论」留到今天。",
    },
    {
      type: "heading",
      text: "acks 三档：成功定义决定丢数据窗口",
    },
    {
      type: "paragraph",
      text: "[acks](glossary:acks)（确认级别）是生产者对 broker 提出的一个问题：「你要确认到什么程度，我才算这条消息发出去了？」franz-go 用 `kgo.RequiredAcks(kgo.NoAck() | kgo.LeaderAck() | kgo.AllISRAcks())` 表达，线值分别是 0 / 1 / -1。**默认是 `AllISRAcks`（all）**。判断哪档适合你，只需盯住一句话：成功返回之后，还有没有可能丢？",
    },
    {
      type: "table",
      caption: "acks 三档的语义与丢数据窗口（franz-go v1.21 常量）",
      headers: ["acks", "broker 何时算成功", "成功返回后仍可能丢的窗口", "典型场景"],
      rows: [
        ["NoAck / 0", "broker 不回响应；请求写出即视为完成", "几乎一切：网络中断、broker 宕机、leader 选举——失败无从知晓，无确认可等", "丢得起的外部遥测、采样埋点；Kafka 业务里极少用"],
        ["LeaderAck / 1", "leader 把记录追加进自己的日志（页缓存）即回成功，不等任何副本", "leader 在其它 ISR 副本追上之前宕机或切换：新 leader 没有这批记录，已确认消息随之丢失", "日志、可重算的统计；不少团队的非关键业务默认"],
        ["AllISRAcks / -1", "当前 ISR 的每个成员都追加进日志后才回成功", "整个 ISR 同时失效（如同机房断电且日志未刷盘）、或开了 unclean leader election 选出缺数据的副本", "订单/支付/库存：书舟的 orders.events、inventory.stock、order.payments 必须此档"],
      ],
    },
    {
      type: "heading",
      text: "acks=all 的边界是当前 ISR，不是 replication.factor",
    },
    {
      type: "paragraph",
      text: "这是最容易被误解的一点。「all」等的是**当前 ISR 全体**，而不是「全部副本数」：如果主题 rf=3 但一台 broker 宕机导致 ISR 收缩到 2，acks=all 的写入仍成功——它等的是幸存的 2 个 ISR 成员，哪怕 [min.insync.replicas](glossary:min-insync) 只配了 1。反过来，[min.insync.replicas](glossary:min-insync) 是 broker 侧的保险丝：当 ISR 数量**低于**它时，acks=all 的写入会被拒绝，返回 `NotEnoughReplicas`（19，记录未写入）或 `NotEnoughReplicasAfterAppend`（20，写入后确认不足）——两个错误都可重试，客户端退避后重发，ISR 恢复即补写成功；这就是第 2 章 [kafka-replication-isr](/courses/kafka/lessons/kafka-replication-isr) 里「宁可失败也不丢」的完整闭环。两个参数合起来是：**min.insync.replicas 设的是下限阈值，acks=all 等的是当前 ISR 全体**。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "把「all 的边界」算清楚，几个结论立刻成立",
      body: "单节点开发环境（ISR 只有 leader，minISR 默认 1）里 acks=all 实际只等 1 个副本——和第 2 章单机演示一致，别拿它代表生产语义。生产 rf=3 + minISR=2 时：ISR=3，all 等 3 个（不是 2 个，minISR 只是下限）；ISR=2，all 等 2 个，写入继续；ISR=1，低于 minISR，写入被拒并重试。最后一道裂缝：acks=all 也挡不住「ISR 全体同时没了」和「unclean leader election」——前者靠机房级冗余，后者靠把 [unclean leader election](glossary:unclean-election) 关掉（第 2 章讲过取舍）。",
    },
    {
      type: "heading",
      text: "重试：发生在你看不见的地方",
    },
    {
      type: "paragraph",
      text: "可重试错误由客户端内部消化。franz-go 把 broker 错误按 `kerr.Error.Retriable` 分类：网络瞬断（`kerr.NetworkException`）、请求超时（`kerr.RequestTimedOut`）、leader 选举中（`kerr.LeaderNotAvailable`）、发错节点（`kerr.NotLeaderForPartition`）、ISR 不足（`kerr.NotEnoughReplicas` 等）——这类会自动退避重发，最终失败才回调给你；`kerr.MessageTooLarge`、权限类、`InvalidRequiredAcks` 等不可重试错误则直接回调。上一课[生产者发送路径与 Record](/courses/kafka/lessons/kafka-producer-send-path)的回调纪律在这里兑现：你看到的 err 要么是「重试到极限的放弃」，要么是「重试没意义的拒绝」。",
    },
    {
      type: "table",
      caption: "franz-go 重试相关选项与默认值（v1.21.6）",
      headers: ["选项", "默认", "含义"],
      rows: [
        ["kgo.RecordRetries(n)", "无上限", "记录级重试次数；幂等开启时只在「安全点」强制生效（详见下节）。到达上限会把同分区后续缓冲记录一并失败，保证无空洞"],
        ["kgo.RetryBackoffFn(fn)", "250ms 起、指数增长、上限 5s、带抖动", "每次重试前的等待（可换自定义策略）"],
        ["kgo.ProduceRequestTimeout(d)", "10s", "写入 Produce 请求的 TimeoutMillis：broker 超时未决即回 RequestTimedOut，可重试"],
        ["kgo.UnknownTopicRetries(n)", "4", "UnknownTopicOrPartition 的专门次数：主题不存在时连续重试 4 次元数据查询仍失败就放弃（记录失败），避免对不存在的主题无限重发"],
        ["kgo.RecordDeliveryTimeout(d)", "无上限", "记录的交付时限，约等于 Java 客户端的 delivery.timeout.ms：超过即失败，不再无谓重试"],
      ],
    },
    {
      type: "paragraph",
      text: "franz-go 与 Java 客户端不同：**没有单独的 retries 上限时默认是无限重试**——这意味着「broker 挂了很久」时，消息不会自动超时失败，而是留在缓冲里反复重试，直到 ctx 取消、`RecordDeliveryTimeout` 到期、或缓冲满把背压传导给调用方。所以生产配置几乎总是显式给出交付上限：要么给每条 Produce 的 ctx 设时限，要么设 `RecordDeliveryTimeout`（例如 60s），二选一或都用——没有上限的重试不是「可靠」，是「无限期占用缓冲的故障放大器」。重试太少则相反：一次 5 秒的 broker 抖动就能让一批消息最终失败，逼你走补偿通道。原则是：**让重试窗口覆盖常见的瞬态故障（秒级到分钟级），让交付时限暴露真正的故障（broker 宕机、配置错误）**。",
    },
    {
      type: "heading",
      text: "幂等生产者：PID + 序列号去重",
    },
    {
      type: "paragraph",
      text: "[幂等生产者](glossary:idempotent-producer)解决的是重试的两个副作用：重复与乱序。机制分三层：客户端首次生产时向 broker 要一个生产者 ID（PID，含 epoch）；此后发给每个分区的批次都带一个**单调递增的序列号**；broker 为每个 (PID, 分区) 保留最近序列号窗口——收到重复序列号（重发）就跳过并返回成功，不重复写；收到跳跃序列号（前一批还没到）就回 `OutOfOrderSequenceNumber`，拒绝后续批次，直到缺口补上。于是「重发同一批」变成幂等操作，「后批先到」被协议挡在门外。",
    },
    {
      type: "paragraph",
      text: "为什么幂等必须与「重试」配合才成立：序列号的价值正在于重试时能识别「同一批」——没有重试就没有重复可去；而有了幂等，客户端才敢放心重试而不必担心副作用。franz-go 的默认配置正是这套组合拳：**幂等默认开启，且强制 acks=all**（若显式把 acks 改成非 all，NewClient 会直接报错「idempotency requires acks=all」）；幂等开启时 in-flight 请求上限由协议定为每 broker 5 个（Kafka 1.0+），客户端内部按序管理，无需你操心。要关闭只能用 `kgo.DisableIdempotentWrite()`，此时每 broker in-flight 默认降回 1，你才能调大 `MaxProduceRequestsInflightPerBroker`——上一课和本课开头的事故，就是这两步一起走的后果。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "幂等的边界：它不跨进程，更不等于 exactly-once",
      body: "PID 的生命周期是「一个客户端实例」。进程重启 = 新客户端 = 重新 InitProducerID = 新 PID，broker 的去重窗口随之重置——同一个业务事件若旧进程已写入而新进程又发一次（比如你按「未收到确认」重试逻辑重启补偿），broker 无法识别，会重复落盘。幂等保证的是**单生产者会话内、网络重试不产生重复**；端到端不丢不重是 [exactly-once](glossary:exactly-once) 的组合拳（幂等 + 事务 + read_committed），跨进程或跨系统只能靠幂等键做到「有效一次」——这两部分分别在第 5 章的 [kafka-delivery-semantics](/courses/kafka/lessons/kafka-delivery-semantics) 与 [kafka-transactions-go](/courses/kafka/lessons/kafka-transactions-go) 展开。事务与幂等的关系一句话：事务 = 幂等生产者 + TransactionalID 的 fencing 与原子提交，幂等是它的地基。",
    },
    {
      type: "heading",
      text: "常见错误：症状、含义与处置",
    },
    {
      type: "table",
      caption: "生产者高频错误速查（错误名与可重试性核对自 franz-go pkg/kerr）",
      headers: ["错误", "含义", "处置"],
      rows: [
        ["kerr.MessageTooLarge（不可重试）", "单条/单批超过上限：客户端侧超 ProducerBatchMaxBytes 会立刻失败；即便放行，超过 broker/topic 的 message.max.bytes 也会被拒", "先查是不是把大字段塞进了消息（图片/日志原文）；再统一调大主题 max.message.bytes 与 ProducerBatchMaxBytes；消息设计有问题就改消息，不是改上限"],
        ["kerr.UnknownTopicOrPartition（可重试，另有 4 次专门上限）", "主题不存在或尚未加载", "确认主题已创建（自动创建用默认分区数=1 是常见坑）；真不存在就别发了，修配置而不是等重试"],
        ["kerr.LeaderNotAvailable / NotLeaderForPartition（可重试）", "leader 选举中 / 请求发到了旧 leader", "客户端自动重试并刷新元数据；持续出现查 broker 健康与 ISR"],
        ["kerr.NotEnoughReplicas(AfterAppend)（可重试）", "ISR 低于 min.insync.replicas，acks=all 写入被拒", "恢复副本/网络让 ISR 回升；长期出现说明冗余设计不达标（第 2 章）"],
        ["kerr.RequestTimedOut / NetworkException（可重试）", "请求超时或连接中断", "网络抖动常见，客户端会退避重试；注意「假失败」要靠幂等去重兜底"],
        ["回调收到 context.Canceled / DeadlineExceeded", "你在重试窗口内取消了 ctx 或 RecordDeliveryTimeout 到期", "按最终失败处理：进补偿通道并告警"],
        ["ErrClientClosed", "调用了 Close 后还有记录未发出", "代码顺序错误：必须先 Flush 再 Close（见[发送路径课](/courses/kafka/lessons/kafka-producer-send-path)）"],
      ],
    },
    {
      type: "heading",
      text: "复盘：关幂等 + 多 in-flight 的顺序事故",
    },
    {
      type: "paragraph",
      text: "回到开头的事故。orders 服务向 `orders.events` 发同一订单的 `created` 与 `cancelled`（key 都是 `order_id`，必然同分区），某次「性能优化」中有人关了幂等并把 inflight 调到 5，理由是「减少等待」。broker 抖动那 30 秒里：`created` 批次 A 的连接中断（无法确定是否已写入），进入重试队列；同分区的 `cancelled` 批次 B、C 从其它 in-flight 槽位正常发出并成功。结果按 offset 顺序：B、C 先落盘，A 重试成功后排到后面。消费方（通知/库存）先处理了 `cancelled`——订单还不存在，按防御逻辑忽略；随后 A 到达，`created` 被处理，订单「复活」并触发第二次通知；而若 A 第一次其实已写入、重试又写一次，消费者还会看到两条 `created`。三种症状：乱序、重复、外加个别彻底失败的丢失。",
    },
    {
      type: "list",
      items: [
        "根因一：关幂等 → 网络「假失败」的重试会重复写入，broker 无法去重；",
        "根因二：inflight=5 → 后发的批先成功，重试的旧批落后面，分区内乱序；",
        "根因三：没设交付上限 → 卡住的批长期占缓冲，失败来临时（事故里就是调用方 ctx 到期）连着同分区后续记录一起陪葬（franz-go 保证无空洞的连带失败语义）——开头那批「彻底没进主题」的订单，正是被放弃后应用又没有补偿通道的记录；",
        "修复：恢复默认（幂等 + acks=all）——序列号缺口会让 broker 拒绝 B、C 直到 A 落定，重试既不重复也不乱序；真需要放弃幂等保序，就保持 inflight=1；",
        "边界提醒：同 key 的严格顺序只存在于「同一客户端实例」内；同一订单的事件若由多个进程实例并发发（比如双活的 orders），跨实例顺序仍需业务层自行串行化。",
      ],
    },
    {
      type: "heading",
      text: "生产发布 checklist",
    },
    {
      type: "list",
      items: [
        "主题已按第 2 章定稿分区数与 key 策略，而不是依赖自动创建（自动建主题默认 num.partitions=1）",
        "生产主题 rf=3、min.insync.replicas=2，客户端保持 acks=all（franz-go 默认）——三者是配套的一套语义",
        "幂等保持默认开启；任何「关闭幂等」的改动必须写评审记录，并同步确认 inflight 上限的取舍",
        "显式给出交付上限：RecordDeliveryTimeout 或 Produce 的 ctx 时限，别留无限重试",
        "单条消息大小有审计：接近 1 MiB 的事件要有预案（ProducerBatchMaxBytes 与主题 max.message.bytes 对齐）",
        "回调错误全处理：结构化日志 + 指标 + 告警；不可丢事件有补偿通道（本地待发表/Outbox，第 6 章）",
        "监控背压信号：BufferedProduceRecords、Produce 耗时、失败计数；配 MaxBufferedBytes 内存保险",
        "优雅退出先 Flush 再 Close；滚动发布留足排空时间",
        "上线冒烟：用控制台消费者看新主题 offset 增长与消息体，确认端到端真实流转",
      ],
    },
    {
      type: "quiz",
      question: "书舟生产集群：orders.events 的 rf=3、min.insync.replicas=2。某台 broker 宕机后 ISR 收缩为 2（恰好等于 minISR）。此时生产者用 acks=all 发送，会发生什么？",
      options: [
        "写入被拒绝，返回 NotEnoughReplicas，客户端重试直到 ISR 恢复",
        "写入成功，但只等 leader 一个副本确认即可返回",
        "写入成功，等当前 ISR 的 2 个副本都确认后返回",
        "写入成功，但要等全部 3 个副本（含宕机的那台）确认，因此一直阻塞",
      ],
      answer: 2,
      explanation: "acks=all 等的是「当前 ISR 全体」，不是 replication.factor：ISR=2 且不低于 minISR=2，所以写入不被拒，两个 ISR 成员都确认后才算成功。若 ISR 再降到 1（低于 minISR），才会被拒绝并返回 NotEnoughReplicas(AfterAppend)，由客户端重试等待 ISR 恢复。",
    },
    {
      type: "quiz",
      question: "orders 服务进程在发布 order.paid 时网络抖动：broker 已写入但确认包丢失，客户端重试后成功。之后服务因发布新版本而重启。关于幂等生产者的保障，下列说法正确的是？",
      options: [
        "重启后新进程对同一条 order.paid 的重发会被 broker 去重，因为幂等跨进程生效",
        "幂等只保证单客户端会话内重试不重复；重启后 PID 变化，去重窗口重置，重复风险回到应用层",
        "幂等生产者配合 acks=all 就能提供端到端 exactly-once",
        "只要主题是 compacted 的，重复事件就会被日志压缩自动消除",
      ],
      answer: 1,
      explanation: "幂等去重的键是 (PID, 分区序列号)，PID 随进程重启而重新分配，broker 的序列号窗口随之重置——旧进程已写入的记录无法被新进程识别，重发即重复。幂等只保证「单生产者会话内、网络重试不重复」，端到端 exactly-once 需要事务与消费端配合（第 5 章）；compaction 按 key 保留最新值，与「同一事件重复」是两回事。",
    },
    {
      type: "paragraph",
      text: "acks、重试、幂等三件套讲完，「把消息可靠送进 Kafka」的生产者侧就闭环了：acks 决定成功标准，重试与交付时限决定失败行为，幂等让重试没有副作用。下一章把镜头转向对岸——消费者如何正确地读，以及提交时机如何决定消费侧的丢/重语义：[kafka-consumer-poll-commit](/courses/kafka/lessons/kafka-consumer-poll-commit)。",
    },
    {
      type: "keypoints",
      items: [
        "acks 三档的丢数据窗口：0 无确认全盲、1 丢在 leader 宕机且副本未追上、all 丢在 ISR 全体失效或 unclean 选举——franz-go 默认 all",
        "acks=all 等的是当前 ISR 全体而非副本总数；min.insync.replicas 是下限保险丝，跌破即 NotEnoughReplicas(AfterAppend)，可重试",
        "默认重试无上限 + 退避 250ms→5s 抖动指数；生产必须配交付上限（RecordDeliveryTimeout 或 ctx），让瞬态故障被重试覆盖、真故障被时限暴露",
        "幂等 = PID + 分区序列号，broker 侧去重并拒绝乱序缺口；franz-go 默认开启且强制 acks=all",
        "幂等边界：单客户端会话内生效，进程重启窗口重置；≠ exactly-once，跨进程靠事务/幂等键（第 5 章）",
        "经典事故配方：关幂等 + inflight>1 + 无交付上限 = 重复、乱序、连带失败；默认配置就是防它的",
      ],
    },
  ],
};
