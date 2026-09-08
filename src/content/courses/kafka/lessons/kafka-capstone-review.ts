/* ==================================================================
 * 课时：项目复盘：架构决策与评审清单（kafka-capstone-review）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 10 章第二课（reading，30min）：把综合项目里的每个决策逐条对照
 * 课程原理，提炼成可复用的评审清单与可口述的面试叙事。承接
 * kafka-capstone-order-pipeline；不重复第 11 章面试速查的问答清单。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "把订单管道项目里每个「当时觉得顺理成章」的决策逐条对照原理：分区与保留、at-least-once+幂等 vs 事务、DLQ 边界、为什么不用 Streams；再沉淀成通用评审清单与 30 秒/3 分钟面试叙事。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课 90 分钟的项目做完后，你会有一堆「当时觉得顺理成章、但说不清为什么」的决策：为什么主题要那样分、为什么消费者重启会重复又为什么数据库不重复、为什么失败消息要带个信封进死信、为什么这套东西不用事务也不用 Kafka Streams。这一课把这些决策逐条回放成原理——**项目只是把整门课的结论组装了一遍，复盘才是把结论变回判断力**。学完你手上会多三样东西：一张「决策 → 原理」对照表、一份任何系统都适用的评审清单、以及一个能讲进面试的项目故事。",
    },
    {
      type: "heading",
      text: "决策回放：我们其实一直在做原理题",
    },
    {
      type: "paragraph",
      text: "下表把[综合项目](/courses/kafka/lessons/kafka-capstone-order-pipeline)里你亲手做出的决策与课程原理一一对应。读法是先遮住「原理」列自己讲一遍，讲不出再放开——能讲出原理的决策才是你的。",
    },
    {
      type: "table",
      caption: "项目决策 → 课程原理对照",
      headers: ["你在项目里的决策", "背后的原理（一句话）", "回炉课时"],
      rows: [
        ["把领域拆成三个主题：事件流 `orders.events`、状态 `inventory.stock`、死信 `dlq.orders.events`", "[主题](glossary:topic)是存储语义的载体：事件流每条记录独立有意义，状态流只关心每个 key 的最新值，失败流需要保留现场等人处理——三种语义不能用同一套保留策略伺候", "[存储：Segment、保留策略与日志压缩](/courses/kafka/lessons/kafka-storage-segments-retention)、[事件建模与兼容性思维](/courses/kafka/lessons/kafka-event-modeling)"],
        ["`orders.events` 取 12 分区、key=`order_id`，并写成设计表", "分区数 = max(峰值吞吐 ÷ 单分区吞吐, 消费并行度) 再按 2 年峰值留余量；key 决定同订单事件进同一[分区](glossary:partition)获得分区内顺序——订单状态机最怕的就是「先看见 paid 后看见 created」", "[主题、分区与键：并行与顺序的边界](/courses/kafka/lessons/kafka-topics-partitions-keys)"],
        ["`orders.events` 保留 7 天（delete），不设 compact", "事件流按时间整段淘汰（[保留策略](glossary:retention)默认即 7 天）；compaction 会按 key 丢中间值，而审计与回放需要全部事件", "[存储：Segment、保留策略与日志压缩](/courses/kafka/lessons/kafka-storage-segments-retention)"],
        ["`inventory.stock` 用 cleanup.policy=compact，key=`sku`", "[日志压缩](glossary:compaction)只保证每个 key 的最新值在、删除时机不保证——恰是「当前库存快照」的语义；它与 Kafka Streams 里 KTable 的 changelog 是同一思想（第 8 章）", "[存储：Segment、保留策略与日志压缩](/courses/kafka/lessons/kafka-storage-segments-retention)、[拓扑、KStream/KTable、状态与窗口](/courses/kafka/lessons/kafka-streams-dsl-topology)"],
        ["生产者保持默认：acks=all + 幂等 + 同步发送逐条确认", "[acks](glossary:acks)=all 等当前 [ISR](glossary:isr) 全体落盘才算成功；[幂等生产者](glossary:idempotent-producer)让网络重试不会落成两份——本地单节点上 ISR 只有自己，和生产 rf=3 的语义差别要心里有数", "[可靠发布：acks、重试与幂等生产者](/courses/kafka/lessons/kafka-producer-reliability-acks)"],
        ["消费端手动提交：整批处理成功才提交，再平衡交还分区时补交一次", "提交时机决定语义：处理完再提交 = 崩溃最多重读尾部（at-least-once）而不是跳过；提交粒度决定重复窗口大小（本项目 = 一批 50 条）", "[拉取模型、位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)"],
        ["幂等落库用了两种 SQL：`order_state` 用 `ON CONFLICT DO UPDATE`（投影要支持状态流转），`payment_settlements` 用 `ON CONFLICT DO NOTHING`（防重标记）", "重复投递是 at-least-once 的常态而非事故；幂等键用业务键（`order_id`）而不是 (topic, partition, offset)——从死信重放时 offset 会变，业务键跨重放稳定", "[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)"],
        ["调渠道带幂等键 `X-Idempotency-Key: order_id`，渠道侧对同单重复请求只收一次款", "Kafka 的[精确一次](glossary:exactly-once)只在 Kafka 内闭环成立；对外部系统（HTTP/DB）只能靠幂等设计做到「有效一次」——幂等键是这条边界上的唯一通用工具", "[投递语义：从 at-most-once 到 exactly-once](/courses/kafka/lessons/kafka-delivery-semantics)"],
        ["失败先分类：解析错误直接进死信；渠道 5xx 退避重试 3 次，仍失败进死信；死信信封带原始消息 + 来源坐标 + error/status/attempts 头", "永久失败重试一万次也不会好，瞬态失败才值得重试；死信 = 带现场的隔离区，不是丢弃箱也不是重试器；[死信](glossary:dead-letter)自己也是 at-least-once 的一段，重放工具必须幂等", "[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)"],
        ["事件先定 JSON 契约（本课沿用第 1–5 章扁平演示体 orderId/event/at/amount/items，与第 6 章信封的映射见项目课；生产按信封+SR），字段类型、单位（分）、时区写清楚", "事件的字段是跨服务契约：命名与结构约定、加字段的兼容纪律是事件建模的职责（第 6 章）；单团队 + 单消费者时手工 JSON + 评审够用，跨团队再上 Schema Registry", "[事件建模与兼容性思维](/courses/kafka/lessons/kafka-event-modeling)、[Schema Registry 实战](/courses/kafka/lessons/kafka-schema-registry-go)"],
      ],
    },
    {
      type: "heading",
      text: "深挖一：为什么 at-least-once + 幂等，而不是事务",
    },
    {
      type: "paragraph",
      text: "这是复盘时最容易被追问、也最能区分「背过概念」和「真做过」的一道题。先给结论：**本项目选 at-least-once + 幂等，不是因为事务不好，而是因为事务保护的范围不是本项目需要原子性的范围**。拆开讲有四条：",
    },
    {
      type: "list",
      items: [
        "**事务只覆盖 Kafka 内闭环**。[事务](glossary:transaction)能把「写给 Kafka 的结果」和「消费位点提交」合并成一个原子动作，前提是副作用都发生在 Kafka 里（第 5 章示例：消费 `order.payments`、写 `payment.results`）。而本项目每条消息的副作用在**自己的数据库**（upsert）和**外部 HTTP 渠道**（收款）——这两个系统根本不在 Kafka 事务协调器的视野里，事务保护不到它们。",
        "**跨系统原子性不存在**。渠道调用是外部系统、数据库是另一个系统，「调渠道 + 写库」无论包在哪层事务里都不可能同时生效或同时回滚。与其假装有原子性，不如让每一步都幂等：渠道认幂等键、库表认唯一键，重复执行与执行一次效果相同——这正是「有效一次」的工程含义。",
        "**事务有实打实的成本**。每笔事务都要经事务协调器做两阶段收尾、在每个参与分区写 marker，吞吐下降；还有 `transaction.timeout.ms`、协调器故障、epoch 栅栏这些运维复杂度（第 5 章事务课列了完整清单）。日志型、只读型、外部副作用型的管道不值得付这个钱。",
        "**跨服务无法共享事务**。真实结算链路跨 orders/payment/账务多个服务，事务边界只在一个进程内；跨服务协作唯一可靠的粘合剂就是事件 + 幂等。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "什么时候才轮到事务出场",
      body: "判据一句话：**当「读 Kafka → 算 → 写 Kafka」两处状态必须同生共死、且中间没有外部副作用时**——典型是账务/结算这类 Kafka 内闭环管道（第 5 章 `order.payments → payment.results` 就是）。凡是副作用在外部的，先问幂等能不能解决；能，就别上事务。这个判据本身就是面试时最值钱的一句话。",
    },
    {
      type: "heading",
      text: "深挖二：DLQ 的边界——什么该进，什么不该",
    },
    {
      type: "paragraph",
      text: "项目里三种失败走了三条路，值得回放一遍：**JSON 解析失败**（永久）不重试直接进死信；**渠道 503** 被当成瞬态，退避重试 3 次；**一直 503 的订单**（模拟永久渠道故障）在重试耗尽后进死信。这个分类不是拍脑袋，它对应一句话：**重试要有意义才重试**——再试一次会好的（瞬态）才值得试，永不可能好的（坏数据、规则拒绝、对方明确拒绝）试了只是浪费下游资源和延迟后面的消息。",
    },
    {
      type: "paragraph",
      text: "死信真正的语义边界是：**它是「需要人的注意力」的隔离缓冲区，不是终点**。项目验收里你会发现三件事——死信信封必须带足现场（原消息 + 来源 topic/partition/offset + 失败原因 + 尝试次数），否则人工修复无从下手；死信主题自己也是 at-least-once 的一段管道，同一失败订单的重复事件会产生多条死信记录，所以**重放工具要幂等**（重放前查唯一键或先清结算表）；死信要有人看、要能告警——`dlq.orders.events` 只增不减本身就是事故信号。把「进死信」当成「消息死了不用管」是这条链路上最危险的理解。",
    },
    {
      type: "heading",
      text: "深挖三：为什么不用 Kafka Streams 处理订单状态机",
    },
    {
      type: "paragraph",
      text: "项目里最像「流处理任务」的其实是 `order_state` 投影：按 `order_id` 聚合成最新状态。为什么没有用 [Kafka Streams](glossary:kafka-streams)（或 [ksqlDB](glossary:ksqldb)）来做？三个理由，每个都是边界判断而不是能力否定：",
    },
    {
      type: "list",
      items: [
        "**状态权威在哪里**。订单状态要支撑业务查询、要和其他表做事务、要被运营系统读——它的家是关系数据库，不是流引擎的本地状态存储。Streams 的状态存储（RocksDB + changelog）是为「状态只活在流应用里、由流应用自己查询」设计的；我们已经有权威存储，消费端投影只是「把 Kafka 事件变成 DB 写入」，不需要在流引擎里再造一份状态。",
        "**处理是简单无状态的**。upsert 一条记录不需要窗口、join、聚合这些流引擎的看家本领；引入 Streams 意味着引入 JVM 进程、内部主题（changelog/repartition）与再平衡恢复机制，为一条 SQL 能写完的 upsert 付这个复杂度不划算。",
        "**Go 生态的现实**。Kafka Streams 只有 Java/Scala API，Go 团队没有官方库；Go 侧的三条替代路径（自管消费者 + 外部状态、ksqlDB、非 Go 流服务）在[第 8 章选型课](/courses/kafka/lessons/kafka-streaming-model)里逐一对比过——本项目走的就是第一条，它恰好是「有外部权威状态」时最合适的形态。真出现需要窗口聚合的场景（实时营收、会话分析），再评估 ksqlDB 或 Streams，见[流处理心智模型与引擎选型](/courses/kafka/lessons/kafka-streaming-model)。",
      ],
    },
    {
      type: "heading",
      text: "通用评审清单：10 条，两个视角",
    },
    {
      type: "paragraph",
      text: "把上面的决策反向提成问题，就得到一份可以拿去评审**任何** Kafka 系统的清单。前 5 条在设计评审时问，后 5 条在上线前问。每条都是「一个问题 + 一个检查动作」，答不上来的项就是风险项。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**主题划分是否语义单一、事件契约是否显式？**——每个主题应该只承载一种语义（事件流 / 状态 / 死信）；事件名是否为过去时事实、字段类型与单位是否有文档、谁在生产谁在消费是否写清。",
        "**分区数与 key 是否写明理由？**——能否说清「吞吐 ÷ 单分区、消费并行度、2 年增长余量」三者的推导？同 key 的顺序依赖落在哪个消费端？扩分区预案（只增不减、同 key 可能断裂）是否存在？",
        "**每段链路的投递语义与重复后果是否明确？**——at-least-once 下重复的窗口多大、幂等键在哪个系统、重复最坏的后果是什么（多扣一次钱？多插一行？）？别让「Kafka 保证不丢」代替逐段分析。",
        "**失败路径是否完整？**——重试边界（几次、退避多久）、哪些失败算永久、死信信封带什么现场、毒消息怎么隔离、死信谁看、重放流程是否幂等？",
        "**状态存储选型是否自洽？**——状态权威在 DB 还是流引擎？谁查询状态？「消费投影 + 幂等落库」「Streams 本地状态」「ksqlDB」是按场景选的，不是按喜好选的。",
        "**数据安全配置与消息价值匹配？**——rf / min.insync.replicas / acks 组合是否写明，开发与生产的差异（单节点 ISR=自己）是否有人心里有数？宁可失败也不丢的保险丝是否只在「真不能丢」的主题上？",
        "**提交时机与消费参数实测过吗？**——手动/自动提交的重复窗口量化过没有？做过 kill -9 与再平衡演练吗？处理耗时与 session/rebalance 超时（默认 45s/60s）匹配吗？",
        "**可观测三件套有人看吗？**——lag、失败计数（按类别）、死信增长是否进了看板并配了告警？告警触发后有动作流程吗？（指标清单见[观测课](/courses/kafka/lessons/kafka-monitoring-lag)）",
        "**保留与容量跟得上增长吗？**——磁盘 ≈ 保留时长 × 写入速率 × 副本数是否按 2 年峰值算过？分区数是不是「只能增不能减」之前就定够？",
        "**回放与灾难恢复可操作吗？**——全量重放、位点重置、DLQ 重放都演练过吗？重放时幂等能承接吗？（排障手册见[症状 → 诊断 → 处置](/courses/kafka/lessons/kafka-troubleshooting)）",
      ],
    },
    {
      type: "heading",
      text: "把项目讲成面试叙事",
    },
    {
      type: "paragraph",
      text: "面试官对项目的兴趣不在业务本身，而在「你能不能把决策讲成原理、把坑讲成理解」。下面给你两个版本的结构与示范文本，都是按第 10 章项目的真实形态写的，替换成你实际改过的数字即可。",
    },
    {
      type: "subheading",
      text: "30 秒版：一句话场景 + 一个决策 + 一个验证",
    },
    {
      type: "callout",
      variant: "example",
      title: "可背的 30 秒版",
      body: "「我用 Go 和 franz-go 做了一个订单事件管道：订单服务把 order.created / order.paid 发布到 Kafka，库存消费者幂等投影到数据库，支付结算消费端调外部渠道、失败走有限重试和死信。最关键的设计是**at-least-once 加幂等，而不是事务**——因为我的副作用在数据库和外部 HTTP，Kafka 事务覆盖不到，我用库表唯一键和渠道幂等键让重复执行等于执行一次。我 kill -9 演练量化过重复窗口，正好一个批次 50 条，数据库没有一行重复。」",
    },
    {
      type: "paragraph",
      text: "结构拆开只有四句：**做了什么**（服务 + 主题一句话）→ **关键决策**（语义选择 + 一句话原理）→ **怎么验证的**（kill -9、重复窗口、DB 不重复）→ 停。30 秒版不需要架构图，只需要让面试官记住你的决策和验证方式——这两样才是你区别于「看过教程的人」的地方。",
    },
    {
      type: "subheading",
      text: "3 分钟版：五段结构",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**背景与目标**（30s）：书舟书店订单平台的演示管道，要解决「订单事件怎么可靠流到下游」。一句话说清领域即可，别讲平台业务史。",
        "**架构与设计**（60s）：三个主题各归其位——事件流 `orders.events`（12 分区、key=order_id、保留 7 天）、状态主题 `inventory.stock`（compacted、key=sku）、死信 `dlq.orders.events`；每个数字都带一句理由，展示你做过推导而不是背过结论。",
        "**可靠性决策**（60s）：手动提交 + 幂等落库（唯一键、用业务键不用 offset）+ 渠道幂等键 + 失败分类与死信信封。这里主动讲「为什么不用事务」和「死信自己也会重复」，比等面试官问更有说服力。",
        "**验证与踩坑**（60s）：kill -9 消费者观察重复窗口与提交行为；停 broker 观察 producer 阻塞重试、恢复后补齐；把「一开始以为自动提交就行、实测发现重复窗口不可控」这种真实转变讲出来——坑是最好的记忆点。",
        "**边界与演进**（30s）：诚实交代没做的——集群（rf=3）、安全、Schema Registry、容量压测——并补一句「我知道差距在哪、怎么补」。主动收尾比被问倒体面得多。",
      ],
    },
    {
      type: "heading",
      text: "被追问点：把踩过的坑变成弹药",
    },
    {
      type: "paragraph",
      text: "追问不可怕，可怕的是没做过实验只能背概念。下表是围绕本项目最高频的追问，应答要点全部来自你上一课的亲手观察——这正是「自己踩过的坑 = 最好的追问材料」的意思。",
    },
    {
      type: "table",
      caption: "高频追问 → 应答要点（来自项目实测）",
      headers: ["追问", "应答要点（亲手观察过的才说）", "回炉课时"],
      rows: [
        ["消费者重启为什么会有重复？重复多少？", "提交时机决定窗口：手动提交时重复范围 = 最近一次提交后 poll 到的一批（本项目 PollRecords 50 条）；kill -9 后协调器要等会话超时（默认 45s）才把分区判给别人，重启后从最后提交位点续读，日志里同一 offset 出现两次而数据库没有重复行——幂等把重复吸收在落库层", "[拉取模型、位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)、[消费组与经典再平衡协议](/courses/kafka/lessons/kafka-consumer-groups-classic)"],
        ["幂等键为什么不用 (topic, partition, offset)？", "重放（从死信、重置位点）会让同一业务消息换 offset；只有业务键 `order_id` 跨重放稳定。我观察过死信重放后 offset 全变、库表仍不重复", "[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)"],
        ["渠道调用失败重试安全吗？", "安全的前提是幂等：渠道认 `X-Idempotency-Key`，重复请求只收一次款（mock 里返回 already_charged）；本地库有唯一键兜底。重试只对瞬态失败（5xx/超时）做，解析错误这类永久失败不重试直接死信", "[投递语义：从 at-most-once 到 exactly-once](/courses/kafka/lessons/kafka-delivery-semantics)"],
        ["死信里的消息最后怎么处理？", "信封带原始消息与来源坐标，人工/自动修复后重放回原主题；重放工具幂等（先查唯一键）。我实测过死信主题自己也会因重复事件产生多条记录——所以重放前要去重或接受幂等", "[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)"],
        ["停掉 broker 时你看到了什么？", "单节点 rf=1：producer 的同步发送阻塞在重试（未确认的消息在客户端手里，不丢）；消费者拉不到数据；broker 恢复后 producer 自动补齐。诚实说明：这是单点，真数据安全要 rf=3 + min.insync.replicas=2 的集群，已 ack 消息才有多副本兜底", "[可靠发布：acks、重试与幂等生产者](/courses/kafka/lessons/kafka-producer-reliability-acks)、[KRaft 集群：架构、部署与升级](/courses/kafka/lessons/kafka-kraft-cluster-deploy)"],
        ["订单量涨 10 倍怎么办？", "先别急着扩分区：分区数只增不减且扩容会改变 hash(key) % N，同订单新旧事件可能分居两区。正确顺序是压测单分区吞吐、查热点 key 是否倾斜、再按峰值×余量扩分区或拆主题（链接容量课）", "[容量规划与性能调优](/courses/kafka/lessons/kafka-capacity-tuning)"],
        ["为什么不用事务 / Streams / Schema Registry？", "各一句边界判断：事务只覆盖 Kafka 内闭环，我的副作用在外部系统，幂等更划算；Streams 没有 Go 官方库且状态权威已在 DB，投影用不上它的窗口聚合；单团队手工 JSON 契约够用，跨团队契约演进再上 Schema Registry", "[事务与精确一次](/courses/kafka/lessons/kafka-transactions-go)、[流处理心智模型与引擎选型](/courses/kafka/lessons/kafka-streaming-model)、[Schema Registry 实战](/courses/kafka/lessons/kafka-schema-registry-go)"],
      ],
    },
    {
      type: "heading",
      text: "诚实边界：没做的，和为什么",
    },
    {
      type: "paragraph",
      text: "一个单节点、无安全、无 Schema 管理的演示管道，距离生产还有一长串清单。面试和评审里主动交代边界，比被戳穿高明——重点是每一条都能接一句「怎么补」。",
    },
    {
      type: "table",
      caption: "项目边界 → 差距 → 补课路径",
      headers: ["没做的", "差距是什么", "怎么补（对应课时）"],
      rows: [
        ["多节点集群与副本冗余", "本地 rf=1 单点：broker 挂了全停；生产 rf=3 + min.insync.replicas=2 才兑现「已 ack 不丢」", "[KRaft 集群：架构、部署与升级](/courses/kafka/lessons/kafka-kraft-cluster-deploy)"],
        ["安全：TLS / SASL / ACL", "演示管道全明文无认证；生产要 listener 分离、传输加密、认证授权", "[安全：TLS、认证、授权与配额](/courses/kafka/lessons/kafka-security)"],
        ["Schema Registry", "手工 JSON 契约在单团队内够用；字段演进一旦跨团队就会失控", "[Schema Registry 实战（Go / pkg/sr）](/courses/kafka/lessons/kafka-schema-registry-go)"],
        ["事务性 Outbox / CDC", "orders 服务是单写点（只写 Kafka），没有 DB 双写问题；一旦业务库与事件要原子一致，Outbox 出场", "[事务性 Outbox、CDC 与事件溯源](/courses/kafka/lessons/kafka-outbox-cdc-es)"],
        ["窗口聚合类流处理", "本项目只有按 key 投影，没有窗口/join；实时营收、会话分析这类需求交给 ksqlDB / Streams", "[ksqlDB：用 SQL 做流处理](/courses/kafka/lessons/kafka-ksqldb-streaming-sql)"],
        ["Kafka Connect / Debezium CDC", "管道里没有需要接入的外部系统（库存库由消费者直写）；一旦要从 MySQL/Postgres 把变更接进 Kafka，就该上 Connect 而不是再写一个轮询程序", "[Connect 架构与第一个连接器](/courses/kafka/lessons/kafka-connect-architecture)、[Debezium CDC：数据库变更变成事件](/courses/kafka/lessons/kafka-connect-cdc-practice)"],
        ["容量压测与生产监控告警", "只观察了 lag 与日志，没有压测单分区吞吐、没有告警闭环", "[容量规划与性能调优](/courses/kafka/lessons/kafka-capacity-tuning)、[观测：指标、日志与消费滞后](/courses/kafka/lessons/kafka-monitoring-lag)"],
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "面试表达纪律",
      body: "三条：① 只讲做过且能讲出原理的，讲不出原理的决策说明你还没消化，回去补课而不是背话术；② 被问到没做过的，模板是「没做，因为当时场景不需要（原因）；如果要做，方案是 X（链接到你知道的机制）」，绝不编造；③ 数字（分区数、重复窗口、超时）是你观察过的就大胆说，没观察过的就用「默认值 X，需按官方文档核对」的措辞——面试官更信会限定自己知识边界的人。",
    },
    {
      type: "quiz",
      question:
        "评审同事的方案：「消费端先调支付渠道、后写本地库，进程在两步之间崩溃时重投会重复调渠道——用 Kafka 事务把『调渠道 + 写库 + 提交位点』包起来就能解决。」你的判断是？",
      options: [
        "对——事务能把跨系统的多个动作变成原子操作",
        "错——Kafka 事务只覆盖 Kafka 内部的读写（结果写入与位点提交）；渠道调用和数据库写入在事务视野之外，正确做法是渠道幂等键 + 本地唯一键，接受 at-least-once",
        "错——单节点环境不支持事务，需要至少三个 broker",
        "对了一半——事务虽然管不到渠道，但能保证数据库写入和位点提交原子，这样重复只会发生在渠道一次",
      ],
      answer: 1,
      explanation:
        "Kafka 事务的原子范围是「写给 Kafka 的输出 + 消费位点」，外部 HTTP 调用与数据库写入不参与事务协调。跨系统要「有效一次」，唯一通用手段是让每个外部动作自身幂等（渠道幂等键、库表唯一键）。把外部副作用幻想进 Kafka 事务，是投递语义里最经典的误解；本项目的核心决策正是用 at-least-once + 幂等替代这个幻想。",
    },
    {
      type: "heading",
      text: "本课小结",
    },
    {
      type: "keypoints",
      items: [
        "项目决策 = 原理的组装：主题语义三分（事件流/状态/死信）、分区数三约束、key 决定顺序、保留策略选型，都能回放到第 2/5/6 章的具体课时",
        "at-least-once + 幂等 vs 事务的判据：副作用在 Kafka 内闭环才值得事务；在外部系统就靠幂等键 + 唯一键做到「有效一次」",
        "DLQ 是「需要人的注意力」的隔离区：带现场、有人看、重放幂等；它自己也是 at-least-once 的一段，可能重复",
        "不用 Kafka Streams 的三个理由：状态权威在 DB、处理无状态、Go 无官方库——选型看场景不是看名气",
        "10 条评审清单 = 设计 5 问（主题/分区/语义/失败路径/状态）+ 上线前 5 问（安全配置/提交实测/可观测/容量/回放）",
        "面试叙事 = 决策 + 原理 + 亲手验证；坑（kill -9、停 broker、死信重复）是最好的弹药；诚实边界 + 补课链接是最后的体面",
      ],
    },
    {
      type: "paragraph",
      text: "到这里，第 10 章收官，整门课的知识主线（心智模型 → 主题存储 → 生产者 → 消费组 → 可靠性与事务 → 事件建模 → Connect → 流处理 → 集群运维 → 综合实战）也走完了。想让这套知识在面试里「随取随用」，下一章的三节速查是按主题压好的复习地图——[核心机制问答](/courses/kafka/lessons/kafka-interview-core)、[可靠性语义问答](/courses/kafka/lessons/kafka-interview-reliability)、[集群运维与设计题](/courses/kafka/lessons/kafka-interview-architecture)，最后用[总复习测验](/courses/kafka/lessons/kafka-final-checkpoint)检验一遍。",
    },
  ],
};
