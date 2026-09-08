/* ==================================================================
 * 课时：容量规划与性能调优（kafka-capacity-tuning）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Apache Kafka 4.3（主线 4.3.1，KRaft-only）。
 * 配置名与默认值核对 kafka.apache.org/43 configuration/broker-configs
 * （2026-09）；JMX 指标名核对 /43/operations/monitoring。
 * 性能数字全部为「量级 + 假设」，上线前必须压测。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "把观测到的指标变成机器预算：吞吐按字节率乘副本放大、磁盘按保留窗口算、内存留给页缓存；再用三端定位法把瓶颈分到 producer/broker/consumer，识别热点 key 并做对的处置。",
  blocks: [
    {
      type: "paragraph",
      text: "前两课回答了「集群怎么搭、怎么看出问题」。这一课回答三件更靠前的事：**上线前要买多大的机器、装几块盘**（容量规划），**出问题时瓶颈到底在谁身上**（定位方法），以及 **Kafka 的吞吐到底由哪些参数决定、哪些值得调**（调优清单）。这三件事共用同一个单位——**字节**。Kafka 的磁盘、网络、页缓存、批次大小，全部由字节驱动；「每秒多少条消息」只是表象。所以先把容量模型建立在字节率上，再谈其他。",
    },
    {
      type: "heading",
      text: "容量模型：先算字节，再谈消息",
    },
    {
      type: "paragraph",
      text: "把「吞吐」翻译成三个可计算的量。设**客户端写入字节率 W**（消息条数 × 平均单条字节，压缩前口径）与**副本数 RF**：",
    },
    {
      type: "list",
      items: [
        "**写入放大**：一条消息最终落盘 RF 份（leader 1 份 + 每个 follower 各 1 份），所以集群的**磁盘写入总量 ≈ W × RF**；同时它经网络传输 RF 次（客户端上行 1 次 + leader 向每个 follower 复制各 1 次），所以**网络传输总量 ≈ W × RF**。这就是「吞吐 = 字节率 × 副本放大」的全部含义——副本既买可靠性，也买走了成倍的带宽与磁盘。",
        "**磁盘容量**：delete 保留策略下，磁盘占用最终稳定在「保留窗口内的数据量」：**容量 ≈ 平均字节率 × 保留时长 × RF**。它跟峰值无关，跟「保留期内累计写了多少」有关；压缩（compaction）类主题不适用这个公式，见下文。",
        "**内存**：broker 的 JVM 堆**不是消息仓库**——消息躺在操作系统页缓存里，堆主要放每分区/每连接的书签式元数据。所以 broker 内存预算的第一原则是「给页缓存留够」，让热数据命中页缓存而不是每次从磁盘读。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "先按「压缩前」估算，再给压缩打折",
      body: "生产者通常开启压缩（franz-go 默认 snappy，见[批量、压缩与吞吐调优](/courses/kafka/lessons/kafka-producer-batching-throughput)），而 broker 存的就是压缩后的批、按压缩后的字节计流量。所以 W 先用未压缩字节算（好测量、可复现），最后再乘一个压缩系数。JSON 文本类事件 zstd 常见能压到 1/3~1/4，但这**不是承诺**——压缩比取决于内容，必须用真实数据小样测出再入表。",
    },
    {
      type: "heading",
      text: "书舟数字推导：把公式用起来",
    },
    {
      type: "paragraph",
      text: "回到[第 2 章](/courses/kafka/lessons/kafka-topics-partitions-keys)的分区推导输入：`user.behavior` 峰值 10 万条/秒、`orders.events` 峰值约 1.5 万~2.5 万条/秒。下面补上消息大小假设，代入公式（全部假设显著标注，换掉任何一个数字结论就变）。",
    },
    {
      type: "code",
      title: "行为事件主题的容量推导（假设：平均单条约 600 B，峰值当作均值保守估算）",
      language: "text",
      code: `输入：10 万条/s × 600 B = 60 MB/s ≈ 0.5 Gbit/s（未压缩）\n保留 7 天，RF = 3\n\n磁盘容量 = 平均字节率 × 保留秒数 × RF，先分步看量级：\n\n  · 一天单副本：60 MB/s × 86 400 s ≈ 5.2 × 10^12 B ≈ 5 TB\n  · 七天单副本：60 MB/s × 604 800 s ≈ 36 TB\n  · RF=3 集群总量：≈ 109 TB（百 TB 量级）\n\n若 zstd 压缩比约 4:1（假设，需实测）→ 集群总量 ≈ 27 TB。\n按 12 台 broker 分摊、每台 ≈ 9 TB（压缩前）；\n另留 20~30% 余量给段滚动碎片与数据迁移期间的临时副本。`,
    },
    {
      type: "table",
      caption: "书舟三个主题的容量量级（假设见各行，十进制 TB 口径）",
      headers: ["主题", "流量假设", "单副本 7 天", "RF=3 集群总量", "备注"],
      rows: [
        ["user.behavior", "10 万条/s × ~600 B ≈ 60 MB/s", "≈ 36 TB", "≈ 109 TB", "大头；压缩与保留时长是主要旋钮"],
        ["orders.events", "峰值 ≈2 万条/s × ~1 KB ≈ 20 MB/s", "≈ 12 TB", "≈ 36 TB", "按峰值全天候算，属保守上界"],
        ["inventory.stock", "低频变更事件", "可忽略", "可忽略", "消息小、速率低"],
        ["user.profile", "—", "不适用", "不适用", "compacted：容量 ≈ key 数 × 平均 value 大小，与字节率无关"],
      ],
    },
    {
      type: "paragraph",
      text: "看到「百 TB」先别慌，这一课的教学目的之一就是让你对这个量级有体感并学会砍它。书舟真实日均流量远低于峰值，但容量表按保守假设做，砍法有优先级：**先压测真实消息大小与压缩比**（600 B 与 4:1 都是假设）；再确认保留时长是否真要 7 天（行为事件留 3 天够不够下游消费？）；最后才轮到加机器。另一个容易被忽略的结论藏在网络里：60 MB/s 入站看着不大，但 RF=3 时复制流量是它的两倍——全集群瞬时网络总流量约 W × (1 + 2 × (RF − 1)) = 60 × 5 = 300 MB/s（双向合计，按 12 台平均每台约 25 MB/s，但 leader 节点瞬时远高于均值）。这正是生产环境要求万兆内网、并把副本流量与客户端流量视为独立预算的原因。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "这套推导的每一步都是假设，交付物必须是压测报告",
      body: "平均消息大小、峰值是否可持续、压缩比、单分区吞吐上限，全部随业务与硬件浮动。容量表的作用是给出**量级与结构**（哪个主题是主要成本、副本翻了几倍、砍哪里最有效），不是精确预算。上线前用目标消息大小与峰值速率的 2 倍做压测，记录压缩前/后的字节率与 CPU、磁盘 IO、网络占用，再回填这张表。",
    },
    {
      type: "heading",
      text: "分区与副本：并行度是买来的，成本也是",
    },
    {
      type: "paragraph",
      text: "容量公式里已经体现了副本的成本（乘 RF）。分区数不在公式里，却通过三条路径影响容量与稳定性，这是[第 2 章](/courses/kafka/lessons/kafka-topics-partitions-keys)分区决策（书舟取 `orders.events`=12、`user.behavior`=24，按 2 年增长留余量）背后的完整理由：",
    },
    {
      type: "list",
      items: [
        "**内存与句柄**：每个[分区](glossary:partition)的每个[副本](glossary:replica)都是一组 segment 文件与索引，broker 要为它们维护元数据与文件句柄；分区总数越多，单 broker 的常驻开销越大，[controller](glossary:controller) 的元数据日志与快照也跟着涨。",
        "**故障与运维窗口**：broker 宕机/重启时，它上面每个 leader 分区都要在[ISR](glossary:isr)中重新[选举](glossary:leader-election)；副本追数据、[消费组](glossary:consumer-group)重新分配所有权也都按分区粒度进行——分区数以万计时，这些「每个分区做一遍」的收敛动作会被明显拉长。",
        "**吞吐的正反面**：分区数给足，写入与消费才能并行摊开（单分区是串行流）；但单分区的吞吐上限不由分区数决定，而由磁盘、网卡与请求处理能力决定——所以「加分区」不是通用的扩容手段（热点场景见下文）。",
      ],
    },
    {
      type: "paragraph",
      text: "副本数的权衡则简单得多：RF=3 + [min.insync.replicas](glossary:min-insync)=2 是书舟的可靠性底线（[第 2 章副本与 ISR](/courses/kafka/lessons/kafka-replication-isr)、[第 3 章可靠发布](/courses/kafka/lessons/kafka-producer-reliability-acks)讲过它的容错含义），代价就是容量表里整整齐齐的 ×3。想省副本 = 放弃「坏两台不丢」的保证，属于可靠性决策而不是容量决策——先定可靠性，再按 RF 放大容量，顺序不要反。",
    },
    {
      type: "heading",
      text: "瓶颈定位：先分端，再细查",
    },
    {
      type: "paragraph",
      text: "「Kafka 慢」这句话没有信息量。任何性能问题先回答：**慢发生在哪一端？**一条消息从业务进程到消费者落库，只经过三个可观测的环节，把指标按端归好类，问题就被限制在其中一段：",
    },
    {
      type: "code",
      title: "三端诊断路径（对应指标名见观测课与排障课）",
      language: "text",
      code: `① producer 端（发送耗时 / 缓冲 / 重试）\n   ├─ Produce 调用变慢、缓冲记录数持续上涨 → 客户端背压生效\n   │    → 瓶颈在 broker 或网络，不在你的发送代码\n   ├─ 单请求延迟高但缓冲不涨 → 网络 RTT / broker 处理慢\n   └─ 重试计数上升 → 见 ② 的磁盘/网络问题\n\n② broker 端（线程空闲率 / 磁盘 / 副本）\n   ├─ NetworkProcessorAvgIdlePercent 低 → 网络线程吃满\n   ├─ RequestHandlerAvgIdlePercent 低 → 请求处理线程吃满（CPU/磁盘 IO）\n   ├─ UnderReplicatedPartitions 持续 > 0 → follower 追不上\n   │    → 复制带宽或磁盘跟不上，IO 线程被写请求占满\n   └─ 单主题 BytesIn/BytesOut 高 → 定位是哪个主题在烧带宽\n\n③ consumer 端（lag / 处理耗时）\n   ├─ 全组 LAG 均匀上涨 → 消费总能力不足（分区并行度或单条处理慢）\n   └─ LAG 集中在个别分区 → 热点 key / 分区倾斜（见下节）`,
    },
    {
      type: "table",
      caption: "判别信号速查（指标名按 4.3 monitoring 文档核对）",
      headers: ["信号", "结论", "下一步"],
      rows: [
        ["producer 缓冲记录数持续增长", "客户端在背压，broker/网络是瓶颈", "看 ② 的 broker 指标，别先调 linger"],
        ["NetworkProcessorAvgIdlePercent / RequestHandlerAvgIdlePercent 持续低于 0.3", "网络线程 / 请求处理线程饱和", "按 idle 指标对应的线程池扩容（见参数清单）"],
        ["UnderReplicatedPartitions > 0 且 ISR 在收缩", "副本复制追不上", "查磁盘 IO 与 num.replica.fetchers，见[观测课](/courses/kafka/lessons/kafka-monitoring-lag)"],
        ["单分区 LAG 高、其余分区 LAG≈0", "消费侧热点倾斜", "走热点 key 处置流程（下节）"],
        ["全组 LAG 均匀上涨", "消费总能力不足", "加消费者实例前先确认分区数 ≥ 实例数"],
      ],
    },
    {
      type: "paragraph",
      text: "定位口诀来自[第 3 章](/courses/kafka/lessons/kafka-producer-batching-throughput)：**客户端参数决定它能把货发多快，broker 与主题决定它接不接得下**。绝大多数调优事故是没定位就动手——先调了 linger，结果瓶颈在磁盘；或先加了 broker，结果热点是一个 key。下面处理最容易误判的那一种：分区倾斜。",
    },
    {
      type: "heading",
      text: "热点 key 与分区倾斜：识别，然后做对的事",
    },
    {
      type: "paragraph",
      text: "[第 2 章](/courses/kafka/lessons/kafka-topics-partitions-keys)预告过的场景：书舟大促时某个爆款 sku 的库存变更、或某位网红用户的行为事件，占了全主题流量的大头。这些消息带着同一个 key，哈希路由把它们全部钉进**同一个分区**——于是出现「一个分区吃满、其余空闲」的倾斜。识别它要用能区分分区的观测，而不是主题总量：",
    },
    {
      type: "list",
      items: [
        "**消费侧**：`kafka-consumer-groups.sh --describe --group <组>` 输出按分区一行——LAG 长期集中在少数分区、其余为 0，就是消费端倾斜的直观证据（也能顺带排除「消费者太少」：倾斜时加实例无效，因为热点分区同一时刻只有一个消费者在消费）。",
        "**存储侧**：分区的落盘大小随流量不均而分化，可用 per-partition 指标（如 `kafka.log:type=Log,name=Size,topic=...,partition=...`）对比同一主题各分区的大小分布；broker 侧磁盘占用不均可作旁证。注意 `kafka-topics.sh --describe` 只显示副本分配，不显示数据量，别用它判断倾斜。",
        "**生产侧归因**：在客户端按 key 维度统计发送量（一行代码的事），直接回答「是不是某几个 key 贡献了大部分流量」——这是倾斜的根因，指标只能给症状。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "倾斜时「扩容分区/加 broker」为什么无效",
      body: "回想路由公式 `partition = hash(key) % 分区数`：热点 key 的哈希值不变，加分区只是换了个取模底数，**同一个热点 key 依然落进同一个分区**；新增的消费者也帮不上忙——一个分区同一时刻只归属组内一个消费者，热点分区的处理速度上限是单消费者。更糟的是扩容还改变其他 key 的映射（[第 2 章](/courses/kafka/lessons/kafka-topics-partitions-keys)的扩容警告），为救一个分区把全主题的顺序风险都打开了。所以：先确认倾斜在 key 级还是在 broker 级，两者的处置完全不同。",
    },
    {
      type: "paragraph",
      text: "**先区分两种「不均」**：key 级倾斜（流量集中在少数 key，症状见上）与 broker 级不均（leader/副本分配集中，某些 broker 磁盘或 IO 高但主题各分区流量正常）。后者是调度问题，用 `kafka-reassign-partitions.sh` 把副本/leader 摊匀即可；前者是数据模型问题，命令解决不了。key 级倾斜的处置取决于一个关键问题：**下游真的需要该 key 的跨分区顺序吗？**",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**需要顺序（如订单域，一个 order_id 的事件必须有序消费）**：key 不能拆。热点在容量上无解——单分区有物理上限，只能削峰（生产者端限流 + 缓冲）、给热点 key 所在分区留足所在 broker 的容量，或者从业务上拆热点本身（例如把「按 sku 的库存变更流」换成「按仓库的库存变更流」以缩小单 key 速率）。先把「热点是否真的超出单分区能力」用压测数字确认，很多所谓热点只是把整条链路的普通延迟误判成瓶颈。",
        "**不需要严格顺序（如行为分析，允许轻乱序或可按事件时间重排）**：生产端去掉 key 走 sticky 分摊，或给 key 加盐分片：`u_10086` → `u_10086#0`…`u_10086#7`，把一个大 key 摊到多个分区。代价必须讲清楚：同一用户的事件被拆到 8 个分区后，**该 key 的顺序保证彻底消失**，下游需要按事件时间戳自己重排或接受乱序——这是把成本从 broker 转移给了消费端，消费端不改造就别加盐。",
        "**顺序要求是「会话级」而非「用户级」**：把路由 key 从 user_id 换成 session_id 往往是行为事件的最优解——会话内顺序保留（这是产品真正要的），单个会话的流量天然很小，热点自然消失。先问产品「顺序到底保到什么粒度」，再决定 key 的设计。",
      ],
    },
    {
      type: "heading",
      text: "高频参数清单（名称与默认值按 4.3 文档核对）",
    },
    {
      type: "paragraph",
      text: "下面是 broker 侧最常被讨论的参数。默认值已按 Kafka 4.3 官方 broker configs 页核对；**要不要动取决于上一节的定位结果**——idle 指标不低就别加线程，磁盘没写满就别调 segment。客户端侧（linger、批大小、压缩、背压上限）在第 3 章已给全，这里不重复。",
    },
    {
      type: "table",
      caption: "broker 高频调优参数（默认值核对 4.3 broker configs）",
      headers: ["参数", "默认", "作用", "何时值得动"],
      rows: [
        ["num.network.threads", "3", "每个 listener 各建一套：接收请求、回响应的网络线程池", "连接数与请求数高、NetworkProcessorAvgIdlePercent 持续偏低时"],
        ["num.io.threads", "8", "处理请求（含磁盘 I/O）的线程池", "RequestHandlerAvgIdlePercent 持续偏低时；可在集群级动态调"],
        ["queued.max.requests", "500", "网络线程交给 IO 线程前的排队上限", "罕见需要；过大只会让抖动期的排队延迟更难看"],
        ["socket.request.max.bytes", "104857600（100 MiB）", "单个 socket 请求的字节上限", "大消息主题要跟 message.max.bytes 配套看"],
        ["log.segment.bytes", "1073741824（1 GiB）", "单个日志段大小；决定滚动频率与删除/压缩的清理粒度", "段数过多时调大；需要更细清理粒度时调小（机制见[存储课](/courses/kafka/lessons/kafka-storage-segments-retention)）"],
        ["log.retention.hours", "168（7 天）", "delete 保留窗口", "磁盘容量公式里的主旋钮；按下游消费窗口重新谈判"],
        ["num.replica.fetchers", "1", "每个源 broker 的副本拉取线程数", "ISR 收缩、复制追不上且磁盘未饱和时调大"],
        ["log.cleaner.threads", "1", "日志清理（含 compact）线程", "compacted 主题多、清理滞后时"],
        ["group.initial.rebalance.delay.ms", "3000", "新组首轮再平衡的等待加入窗口", "组启停频繁造成抖动时评估（消费组机制见[第 4 章](/courses/kafka/lessons/kafka-consumer-groups-classic)）"],
        ["offsets.retention.minutes", "10080（7 天）", "组变空后已提交 offset 的保留时长", "组多且反复重建的场景下关注资源占用"],
      ],
    },
    {
      type: "paragraph",
      text: "三个使用提醒。其一，参数要「按端成对看」：改了 `log.segment.bytes` 却不看磁盘 IO，改了线程数却不看 idle 指标，都是盲调。其二，配置的生效方式不同——线程池大小可在集群级动态调整，多数参数写在 `server.properties` 里、改后按官方 Update Mode 决定是否滚动重启；用 `kafka-configs.sh --entity-type brokers --entity-name <id> --alter --add-config <k>=<v>` 可以不动文件改动态项。其三，broker 参数几乎都不是「调大就快」：线程多了锁竞争与上下文切换、请求队列长了延迟抖动、segment 大了清理粒度粗——先定位，后微调，每次只动一个变量并回看指标。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "大多数「吞吐不够」的正确解法不在 broker 参数里",
      body: "回看第 3 章：吞吐的基本单位是**批**。同样的负载，linger 组批 + 压缩能减掉一个数量级的请求数与网络字节；反之批太小，broker 线程再多也只是在忙小请求。调优顺序永远先是「数据进 Kafka 的方式」（key 设计、分区数、批、压缩），再是 broker 线程与磁盘——客户端侧参数与默认值见[批量、压缩与吞吐调优](/courses/kafka/lessons/kafka-producer-batching-throughput)。",
    },
    {
      type: "keypoints",
      items: [
        "容量模型：磁盘写入与网络传输总量 ≈ W × RF；磁盘容量 ≈ 平均字节率 × 保留时长 × RF；压缩前估算、压缩比实测后回填",
        "书舟推导（假设：行为事件 10 万条/s × 600 B、7 天、RF=3）：约 60 MB/s → 集群总量 ≈ 109 TB、按 12 台 ≈ 9 TB/台——量级与结构比精确值重要，压测才是交付物",
        "分区/副本是买来的并行度与可靠性，也是内存、句柄、选举与再平衡的成本；先定可靠性再按 RF 放大容量",
        "瓶颈定位先分端：producer 缓冲上涨 → broker/网络；线程 idle 指标 < 0.3 → 对应线程池饱和；单分区 LAG 高 → 热点；全组 LAG 均匀涨 → 消费总能力",
        "热点 key：扩容分区与加实例无效（同 key 同分区、一分区一消费者）；先分 key 级与 broker 级不均，再按「是否要该 key 顺序」选择拆 key/加盐/会话级 key",
        "调优参数按 4.3 文档核对默认值，改前先定位、每次只动一个变量；客户端批与压缩是吞吐的第一杠杆",
      ],
    },
    {
      type: "quiz",
      question:
        "书舟 user.behavior 峰值 10 万条/秒、平均单条约 600 B（约 60 MB/s），主题 RF=3。理想情况下（不计压缩、协议开销与消费读取），集群每秒的磁盘写入总量与跨网络传输总量约为多少？",
      options: [
        "磁盘 ≈ 60 MB/s（只有 leader 写一份，follower 由副本协议异步同步）；网络 ≈ 60 MB/s",
        "磁盘 ≈ 180 MB/s（leader + 2 个 follower 各落盘一份）；网络 ≈ 180 MB/s（客户端上行 1 次 + leader 向两个 follower 复制各 1 次）",
        "磁盘 ≈ 60 MB/s、网络 ≈ 180 MB/s：写入只发生在 leader，复制流量额外两份",
        "磁盘 ≈ 180 MB/s、网络 ≈ 60 MB/s：follower 从本机日志复制，不走网络",
      ],
      answer: 1,
      explanation:
        "RF=3 意味着每条消息最终落盘三份（leader 与两个 follower），磁盘写入总量 = W × RF = 180 MB/s；网络上也传输三份（客户端上行 1 份到 leader，leader 再向每个 follower 复制各 1 份）。这正是「吞吐 = 字节率 × 副本放大」的含义——副本既买可靠性，也买走成倍的磁盘与带宽，容量规划必须把它乘进去。",
    },
  ],
};
