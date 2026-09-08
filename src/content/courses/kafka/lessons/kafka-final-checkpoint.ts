/* ==================================================================
 * 课时：总复习测验（kafka-final-checkpoint）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 覆盖第 1–11 章的心智模型与场景推理题；每题 explanation 指回原理
 * 与对应课时，做错时按链接回去重读那一课。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "十道覆盖全书心智模型的场景推理题：从「为什么用 Kafka」到集群排障，每题解释都指回对应课时，是交付前的最终自检。",
  blocks: [
    {
      type: "paragraph",
      text: "这是全课程的最终自检：10 道题覆盖第 1–11 章的心智模型与场景推理，**没有一道是记忆题**——每题都要求你像排查线上问题一样做判断。先独立作答，再看解释；做错的题，跟着解释里的课时链接回去把那一课的关键段落重读一遍，比直接看答案有效得多。",
    },
    {
      type: "quiz",
      question:
        "「书舟书店」的风控团队三个月后才上线一套需要**重算过去全部订单事件**的特征逻辑。假设订单事件目前只进过一个 RabbitMQ 风格的队列、被各下游 ack 即删。为什么这套需求在 Kafka（提交日志模型）里是默认能力、在队列模型里却要专门求人？",
      options: [
        "因为 Kafka 的消息天然带时间戳，队列消息没有时间字段",
        "因为提交日志按保留策略留存数据、允许新消费者从头按序重放，而队列 ack 即删、没有回放位置",
        "因为 Kafka 每个主题只能有一个消费者组，重算不会影响线上消费",
        "因为 RabbitMQ 无法削峰填谷，只有 Kafka 能缓冲高峰流量",
      ],
      answer: 1,
      explanation:
        "提交日志模型的核心是「消费不删除数据」：消息按保留策略留存，任何（现在或未来的）读者都能从任意位置开始重放，位置是每个组自己的进度。队列模型默认「投递 → 确认 → 删除」，历史数据在 ack 时就没了。这正是[为什么需要事件流平台](/courses/kafka/lessons/kafka-why-event-streaming)全课的动机链，术语见[提交日志](glossary:commit-log)。",
    },
    {
      type: "quiz",
      question:
        "orders.events 有 12 个分区，消费组 orders-processor 现在有 3 个实例，每实例单分区处理能力约为每分区事件速率的 2 倍，但 lag 仍在缓慢增长。最可能的原因是什么？",
      options: [
        "分区数太少：组里 3 个实例 × 2 倍能力 = 6 倍余量，但 12 个分区只被 3 个实例分摊，说明瓶颈不在数量",
        "某个（些）分区成了热点：个别 key 流量大导致该分区成为单点瓶颈，其它分区空闲，加实例也救不了",
        "acks 配置太低导致消息在 broker 端丢失，lag 因此看起来在涨",
        "消费组没有开启自动提交，位置没记录导致每次重启从头消费",
      ],
      answer: 1,
      explanation:
        "并行上限 = 分区数，而**单个分区同一时刻只归一个成员**：如果某分区的事件速率超过单实例处理能力（热点 key 倾斜），无论组里加多少实例，那个分区都只有一个消费者在扛，lag 只涨不消——加实例救不了热点分区。选项 3 的 acks 只影响生产端确认、不会造成 lag 增长；选项 4 与 lag 增长无关。回顾[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)的「热点 key」一节与[消费组与经典再平衡协议](/courses/kafka/lessons/kafka-consumer-groups-classic)。",
    },
    {
      type: "quiz",
      question:
        "你要给「每个用户的最新画像」建一个 Kafka 主题（key=user_id，值随用户资料更新覆盖），并希望存储只保留最新值。关于这个主题的清理策略，哪句是对的？",
      options: [
        "用 delete 策略 + 很短 retention.ms，让旧值尽快被删掉",
        "用 compact 策略：broker 后台异步清理，只保留每个 key 的最新值，但删除时机不保证、旧值可能在一段时间内仍可读到",
        "用 compact 策略可以保证：消息一写入，该 key 的旧值立即从日志中消失",
        "消息格式带 tombstone 就能让 delete 策略按 key 清理",
      ],
      answer: 1,
      explanation:
        "compaction 正是「每个 key 只留最新值」的保留策略，但它是后台异步的（脏数据比例达标才触发、活跃段不参与），**删除时机不保证**——消费者可能仍读到旧值，这是它与「立即删除」的队列思维最大的区别。tombstone 是 compacted 主题里表示「该 key 已删除」的标记，不是 delete 策略的开关。重读[存储：Segment、保留策略与日志压缩](/courses/kafka/lessons/kafka-storage-segments-retention)与[日志压缩](glossary:compaction)词条。",
    },
    {
      type: "quiz",
      question:
        "书舟生产主题 orders.events 配置为 replication.factor=3、min.insync.replicas=2，生产端 acks=all。某台 broker 磁盘损坏后 ISR 缩到只剩 1 个副本。此时生产端写入会发生什么？",
      options: [
        "照常成功：acks=all 会等剩余那个 ISR 副本落盘后确认",
        "写入被 broker 拒绝并返回 NotEnoughReplicas 一类错误：ISR(1) < min.insync.replicas(2)，宁可失败也不把已确认数据只压在一份副本上",
        "写入成功但消息不再对消费者可见，直到 ISR 恢复",
        "broker 自动把 replication.factor 降到 1 以维持可用",
      ],
      answer: 1,
      explanation:
        "acks=all 等的是**当前 ISR 全体**落盘，而 min.insync.replicas 是保险丝：ISR 数量低于它时 acks=all 写入直接被拒（NotEnoughReplicas 类错误），把「悄悄丢已确认数据」变成「显式写入失败」。这正是[副本、ISR 与数据安全](/courses/kafka/lessons/kafka-replication-isr)与[可靠发布](/courses/kafka/lessons/kafka-producer-reliability-acks)里「三副本两台宕机」推演的结论。",
    },
    {
      type: "quiz",
      question:
        "notify 服务消费 orders.events 发短信：代码是「先发短信，成功后手动提交位点」。实例在处理一批消息的途中崩溃（短信已发出、位点未提交）。重平衡后这条消息被另一个实例重新消费。用户会怎样？",
      options: [
        "收不到短信：位点已提交，消息不会再投",
        "收到两条短信：处理成功但位点没提交，消息被重投——这是 at-least-once 的重复窗口",
        "恰好收到一条：Kafka 保证崩溃场景不重不丢",
        "收到一条但内容可能残缺：消息在崩溃时被截断",
      ],
      answer: 1,
      explanation:
        "「处理完（短信已发）→ 提交前崩溃」= 位点没推进 = 消息重投 = 重复副作用；「提交先于处理」才会丢。投递语义由提交时机决定，at-least-once 默认把损失记在「重复账」上，因此消费端必须幂等。重读[拉取模型、位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)的提交窗口与[投递语义](/courses/kafka/lessons/kafka-delivery-semantics)的剧本 C。",
    },
    {
      type: "quiz",
      question:
        "Kafka 4.x 里，消费组从「经典协议（classic）」切换到「新协议（KIP-848）」后，分区分配（assignment）这件事最大的变化是什么？",
      options: [
        "客户端不再需要心跳，彻底消除了成员掉线问题",
        "分配计算从「组内某个客户端成员（leader）做」移到「服务端组协调器做」，配合 member epoch 实现更快、更稳的再平衡",
        "新协议下每个分区可以同时分给组内多个成员，组内并行度翻倍",
        "新协议要求所有消费者必须使用同一台 broker 作为协调器",
      ],
      answer: 1,
      explanation:
        "KIP-848 把 assignment 的计算权从客户端 leader 收归服务端协调器，用 member epoch 管理成员代际，避免全组 stop-the-world 的再平衡风暴；组内「一区一成员」的模型不变（选项 3 错）。4.x 双协议共存、classic 已进入弃用路线（5.0 移除），Go 侧 franz-go 默认仍是 classic。重读[KIP-848 新组协议与 4.x 演进方向](/courses/kafka/lessons/kafka-consumer-group-protocol-848)。",
    },
    {
      type: "quiz",
      question:
        "结算消费者用「读 Kafka（order.payments）→ 更新自己的 PostgreSQL → 写 Kafka（payment.results）」处理一笔支付。它给 Kafka 生产者开了事务，期望「要么全成要么全无」。这套事务能覆盖数据库更新吗？",
      options: [
        "能：事务开启后，Kafka 会与数据库做两阶段提交",
        "不能：Kafka 事务只覆盖 Kafka 内的写入（结果主题 + 消费位点），数据库更新在事务视野之外，仍需靠幂等或 Outbox 保证有效一次",
        "能，但必须把 isolation.level 设为 read_uncommitted",
        "不能，除非把事务超时调到 15 分钟以上",
      ],
      answer: 1,
      explanation:
        "Kafka 事务的原子范围是「Kafka 内写入」：结果消息与消费位点同生共死；**数据库与外部 API 是事务外的副作用**，崩溃重投仍可能重复执行。跨出 Kafka 只能谈「有效一次」——靠唯一键幂等或事务性 Outbox。这是[事务与精确一次](/courses/kafka/lessons/kafka-transactions-go)与[投递语义](/courses/kafka/lessons/kafka-delivery-semantics)里反复强调的边界，也是第 10 章实战选「at-least-once + 幂等」而不是事务的根本原因。",
    },
    {
      type: "quiz",
      question:
        "书舟给 orders.events 的 value 注册了 Schema Registry（兼容策略 BACKWARD，当前 v1 已上线、全部消费者已升级到 v1）。现在要给事件加一个**没有默认值的新必填字段**并注册为 v2。会发生什么？",
      options: [
        "注册成功：BACKWARD 允许新增任何字段",
        "注册被拒（兼容性错误）：v2（新 schema）读 v1（旧数据）时缺字段且无默认值可填，违反 BACKWARD「新读旧」承诺",
        "注册成功但旧数据会全部丢失",
        "注册被拒，因为 v2 必须先由消费者发起升级才能注册",
      ],
      answer: 1,
      explanation:
        "BACKWARD = 用新 schema 的消费者必须能读旧 schema 写的数据。旧数据里没有这个必填字段、schema 又没给默认值，新消费者解码必崩——所以注册被拒，直到你给它默认值或改用 FORWARD/FULL 策略再评估。这正是[事件建模与兼容性思维](/courses/kafka/lessons/kafka-event-modeling)的「加字段要给默认」纪律与[Schema Registry 实战](/courses/kafka/lessons/kafka-schema-registry-go)中 409 兼容性错误的来源。",
    },
    {
      type: "quiz",
      question:
        "书舟要新增一个「MySQL 订单库里的每一行变更（包括 DBA 直接改的数据）都进入 Kafka，供数仓与搜索同步」的管道。选型判断正确的是？",
      options: [
        "用事务性 Outbox：应用代码里同一事务写业务+事件，最可靠",
        "用 Debezium CDC：从 binlog 捕获变更，改库就捕获、与应用代码无关；但事件是「数据行变更」而非「领域事件」，语义化仍要靠下游或 Outbox 层",
        "用 Kafka Streams 消费 binlog 再投影",
        "直接让数仓服务轮询 MySQL 表并自行 diff",
      ],
      answer: 1,
      explanation:
        "「别人直接改库也要被捕获」是 CDC 的主场：binlog 级捕获与应用代码无关；代价是它给出的是行级数据变更（before/after/op），不是领域事件。成熟的形态是两层共存：CDC 捕捉数据事实，业务层消费后再用 Outbox 表达领域事件。Outbox 解决的是「应用双写原子性」，覆盖不了绕过应用的直改。重读[事务性 Outbox、CDC 与事件溯源](/courses/kafka/lessons/kafka-outbox-cdc-es)与[Debezium CDC](/courses/kafka/lessons/kafka-connect-cdc-practice)。",
    },
    {
      type: "quiz",
      question:
        "凌晨三点，监控显示 analytics 组在 user.behavior（24 分区）上的总 lag 从几百条涨到几十万条且仍在增长。以下哪个是**正确的第一步排查动作**？",
      options: [
        "直接给 analytics 组加 20 个消费者实例，尽快把 lag 压下去",
        "先分端定位：对比生产端写入速率（LOG-END-OFFSET 增长斜率）与消费端处理速率（CURRENT-OFFSET 是否还在前进），并确认是否所有分区 lag 均匀增长——再决定是峰值、热点还是消费停滞",
        "马上把主题扩容到 48 分区，提升并行度",
        "重启全部 analytics 消费者，让组重新再平衡",
      ],
      answer: 1,
      explanation:
        "排障的第一原则是**先定位再动手**：lag 增长可能是生产峰值（消费正常但跟不上）、单个热点分区倾斜（加实例无效）、或消费端停滞（处理慢/再平衡风暴/被踢）。均匀 vs 单分区、端 offset 斜率、current offset 是否前进，这三组数据先区分原因；盲目加实例或重启只会掩盖问题或触发再平衡风暴。方法见[排障手册](/courses/kafka/lessons/kafka-troubleshooting)与[观测：指标、日志与消费滞后](/courses/kafka/lessons/kafka-monitoring-lag)。",
    },
    {
      type: "paragraph",
      text: "十题做完，如果超过两题需要看解释才「恍然大悟」，建议别急着进面试章——按错题对应的课时把那一章的关键段落重读一遍，再回到这里重测。[面试速查](/courses/kafka/lessons/kafka-interview-core)三课是压缩版复习地图，本测验是它的体检报告：两者配合，就能判断自己是「知道」还是「能讲清」。",
    },
  ],
};
