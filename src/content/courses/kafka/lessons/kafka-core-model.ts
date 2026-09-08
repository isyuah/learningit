/* ==================================================================
 * 课时：核心心智模型：一次消息的旅程（kafka-core-model）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "立起整门课的地图：八个组件一句话职责，以及一条消息从生产者序列化、落盘复制、确认，到消费组拉取、提交偏移量的完整旅程。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课的结论可以浓缩成一句：书舟需要的不是一个「任务分发队列」，而是一个**分布式提交日志**——事实被追加记录、保留一段时间、任何团队都可以按自己的节奏读取和回放。Kafka 就是这句结论的工程实现。但「提交日志」落到系统里由哪些部件组成？一条「订单已创建」的消息从 orders 服务出发，中间经过哪些节点、谁负责什么、最后如何被 inventory（库存）服务安全地读到？这一课把整门课的地图立起来：先看到全局，知道每个盒子装的是什么，之后每一章再打开一个盒子看内部。",
    },
    {
      type: "heading",
      text: "组件全景：八个角色，一句话职责",
    },
    {
      type: "paragraph",
      text: "Kafka 系统的角色可以分成两组：一组在**数据路径**上（生产端、存储端、消费端），另一组在**控制面**（元数据管理、消费组协调）。下表把整门课会反复出现的组件一次摆齐；每个组件的「深水区」都标注了展开它的课时——本课先认脸，不深入。",
    },
    {
      type: "table",
      caption: "Kafka 组件全景：职责一句话 + 展开课时",
      headers: ["组件", "一句话职责", "展开课时"],
      rows: [
        ["**生产者（producer）**", "业务进程里的客户端库：把业务对象序列化成字节，发送到指定主题，并按配置等待确认", "[第 3 章：生产者发送路径](/courses/kafka/lessons/kafka-producer-send-path)"],
        ["**消费者（consumer）**", "业务进程里的客户端库：从主题拉取消息、执行业务处理、提交自己的读取位置", "[第 4 章：拉取模型与提交](/courses/kafka/lessons/kafka-consumer-poll-commit)"],
        ["[Broker](glossary:broker)", "一台运行 Kafka 服务端的节点：存储分给它的分区数据并服务读写请求；多个 broker 组成一个集群", "[第 2 章：存储与保留](/courses/kafka/lessons/kafka-storage-segments-retention)、[第 9 章：集群运维](/courses/kafka/lessons/kafka-kraft-cluster-deploy)"],
        ["[主题（topic）](glossary:topic)", "同类事件的分类容器：消息按主题组织，主题之间互不干扰", "[第 2 章：主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)"],
        ["[分区（partition）](glossary:partition)", "主题内的并行与顺序单位：分区内消息有序，分区之间没有全局顺序", "[第 2 章：主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)"],
        ["[副本（replica）](glossary:replica)", "同一分区的多份拷贝，分布在不同 broker 上：一个 leader 负责服务读写，follower 持续同步；leader 失效时从 ISR 中选出新 leader", "[第 2 章：副本、ISR 与数据安全](/courses/kafka/lessons/kafka-replication-isr)"],
        ["[偏移量（offset）](glossary:offset)", "分区内每条消息的唯一递增序号：既是消息的物理位置，也是消费者记录「读到了哪」的游标", "[第 4 章：位置管理与重放](/courses/kafka/lessons/kafka-consumer-poll-commit)"],
        ["[消费组（consumer group）](glossary:consumer-group)", "一组共享订阅关系的消费者：分区在组内成员间分配，组与组之间的进度完全独立", "[第 4 章：消费组与再平衡](/courses/kafka/lessons/kafka-consumer-groups-classic)"],
        ["[控制器与 KRaft quorum](glossary:kraft)", "管元数据的角色：主题建删、分区分配、副本状态、成员变更都先写进内部元数据日志；[控制器](glossary:controller) 由投票 quorum 选出。4.0 起是唯一模式", "[第 9 章：KRaft 集群](/courses/kafka/lessons/kafka-kraft-cluster-deploy)"],
        ["[组协调器（coordinator）](glossary:coordinator)", "broker 上的组件：维护组成员关系、把分区分配给成员、接收偏移量提交、触发再平衡", "[第 4 章：消费组与再平衡](/courses/kafka/lessons/kafka-consumer-groups-classic)"],
      ],
    },
    {
      type: "heading",
      text: "一次消息的旅程：十一站",
    },
    {
      type: "paragraph",
      text: "假设 inventory 团队要实时响应「订单已创建」。一条 `orders.events` 上的消息从 orders 服务出发，到 inventory 的扣库存逻辑跑完，完整经过下面十一站。先通读一遍图，再逐段解释。",
    },
    {
      type: "code",
      title: "一次消息的旅程（示意，不含协议细节）",
      language: "text",
      code: `订单服务 orders (Go)              Kafka 集群 (brokers)                消费方 inventory (Go)
     │                                    │                                   │
 ①  序列化 OrderCreated → 字节           │                                   │
 ②  key=order_id 哈希 → 分区 3           │                                   │
     │──────────── ③ ProduceRequest ───►│                                   │
     │                                    │  ④ 分区 3 的 leader 顺序追加，      │
     │                                    │     消息获得偏移量 offset=1271      │
     │                                    │  ⑤ follower 副本同步复制            │
     │ ◄────── ⑥ 确认（由 acks 配置决定） │                                   │
     │                                    │                                   │
     │                                    │  ⑦ 组协调器早已把分区 3 分配给      │
     │                                    │     inventory-组 的成员 #2          │
     │                                    │ ◄───── ⑧ 消费者主动拉取 Fetch ───── │
     │                                    │                                   │  ⑨ 业务处理（幂等扣库存）
     │                                    │ ◄──── ⑩ 提交偏移量 offset=1271 ──── │
     │                                    │                                   │
     │                                    │  ⑪ 消息仍在日志里：analytics-组      │
     │                                    │     还停在 900，新组可从最早读起     │`,
    },
    {
      type: "heading",
      text: "写进去：序列化、路由与落盘（①—⑥）",
    },
    {
      type: "paragraph",
      text: "**① 序列化。** orders 服务把内存里的订单对象编码成字节。Kafka 只搬运字节、不关心内容，因此生产端与消费端必须约定格式——本课程里是 JSON 加少量 headers；格式本身如何定义、如何安全演进，是[序列化器（serializer）](glossary:serializer)与第 6 章 Schema Registry 的话题。**② 按 key 路由。** 这条消息的 key 是 `order_id`，值为如 `20260908-000123` 的订单号；客户端对 key 做哈希，把消息送进固定的分区。同 key 必进同分区，这是「同一订单的事件有序」的保证；不带 key 的消息则按客户端策略分散到各分区（细节见第 3 章）。",
    },
    {
      type: "paragraph",
      text: "**③ 发送给 leader。** 生产者并不把消息发给「主题」这个抽象概念，而是发给目标分区的 leader 副本所在的 broker（它从集群元数据里知道 leader 是谁）。为了吞吐，消息通常先在客户端缓冲里攒成一批再发出，而不是一条一条发。**④ 追加落盘。** leader 把这条记录追加到分区日志的尾部——一个只追加的文件序列——并分配递增编号 offset=1271。顺序追加正是 Kafka 高吞吐的物理基础：写磁盘像写日志一样连续（第 2 章展开 segment 与页缓存的细节）。",
    },
    {
      type: "paragraph",
      text: "**⑤ 副本同步。** 分区的其余[副本（replica）](glossary:replica)从 leader 拉取这条记录写入自己的日志；只有跟得上 leader 的副本才属于 ISR（In-Sync Replicas）集合，leader 失效时只有 ISR 成员能接任。**⑥ 确认。** 生产者在什么条件下认为「写成功」，由 [acks](glossary:acks) 配置决定：是 leader 一落盘就算，还是等 ISR 里的副本都落盘才算——它精确决定「写失败时可能丢多少」。acks 与副本的联动细节分别在第 3 章与第 2 章展开，这里只需要记住：确认不是「消息已送达消费者」，而是「消息已安全落盘」。",
    },
    {
      type: "heading",
      text: "读出来：协调、拉取与提交（⑦—⑩）",
    },
    {
      type: "paragraph",
      text: "**⑦ 协调器分配分区。** inventory 服务以[消费组](glossary:consumer-group)（这里叫 inventory-组）成员的身份订阅 `orders.events`。[组协调器](glossary:coordinator)负责维护组内成员，并保证：每个分区在同一时刻只被组内一个成员消费。因此分区 3 会被分配给 inventory-组的成员 #2，由它独享读取——组内再开十个实例，它们瓜分的是「不同的分区」，而不是抢同一条消息（这跟队列模型里 worker 抢任务完全不同）。成员进出导致分区重新分配的过程叫[再平衡](glossary:rebalance)，第 4 章细讲。",
    },
    {
      type: "paragraph",
      text: "**⑧ 消费者拉取。** Kafka 是**拉模型**：消费者主动发起 Fetch 请求，把分区尾部新到的一批消息取走，而不是 broker 推给它。拉让消费者自己控制节奏与批量大小，天然自带背压——这也是「慢消费者不会拖垮 broker」的结构性原因（第 4 章会讲为什么拉优于推）。**⑨ 业务处理。** 成员 #2 执行扣库存逻辑。注意：此刻消息并没有离开 broker，它只是被「复制并处理了一次」。**⑩ 提交偏移量。** 处理成功后，消费者告诉协调器「这个分区我已经读到 1271 了」，broker 记下 inventory-组的进度。提交时机（处理前还是处理后）决定崩溃时是丢消息还是重复处理，这是第 4、5 章的核心话题。",
    },
    {
      type: "paragraph",
      text: "**⑪ 消息仍在。** 走到这里，消息依然躺在分区 3 的日志里。analytics-组的偏移量可能还停在 900（它按自己的节奏慢慢算），一个全新加入的团队甚至可以选择从最早的消息开始读。数据何时消失只由保留策略决定，与「被谁读过、读到哪」毫无关系。",
    },
    {
      type: "heading",
      text: "钉子一：分区 = 顺序与并行的边界",
    },
    {
      type: "paragraph",
      text: "分区把「一个主题的日志」横切成若干条可独立推进的子日志。**分区内有序：** 同一 [分区](glossary:partition) 内的消息严格按追加顺序排列，offset 递增；因为同 key 必进同分区，所以「同一个订单的全部事件」天然有序——这是很多业务正确性的前提。**分区间并行：** 不同分区的消息互不排队，可以同时被生产、同时被不同消费者处理——5000 单/秒的吞吐靠的就是把压力分摊到多个分区。",
    },
    {
      type: "paragraph",
      text: "代价必须同时记住：**跨分区没有全局顺序**。如果业务要求「全主题严格有序」，要么牺牲并行（把主题做成单分区），要么在设计上让顺序只对单个 key 有意义。分区数同时决定了组内消费者的并行度上限——一个分区同一时刻只归组内一个成员消费，所以组内并发度不可能超过分区数。选多少个分区、key 怎么设计，是第 2 章的核心决策题；这里先把「分区是并行与顺序的唯一边界」这根钉子钉牢。",
    },
    {
      type: "heading",
      text: "钉子二：偏移量 = 消费者的书签，每个组一本",
    },
    {
      type: "paragraph",
      text: "把 [偏移量（offset）](glossary:offset) 想成书页上的页码，把消费组想成读书的人，就抓住了全部要点。页码（offset）是书自带的、固定不变的；而「我读到第几页」是每个读者自己的状态。Kafka 里，offset 是消息在分区内的固有编号；「读到哪了」则是每个消费组的私有进度，由 broker 代为记录（存在内部的偏移量提交主题里），只有消费组自己会移动它。",
    },
    {
      type: "paragraph",
      text: "两个组同时读 `orders.events` 就是两个人读同一本书：inventory-组读到 1271 并继续往前，analytics-组停在 900 慢慢算，谁也不影响谁——A 读者翻页不会让书上的字消失，也不会改变 B 读者的进度。更有用的是回放：analytics 修复了一个聚合 bug，可以把组的进度**重置**到 7 天前的某个 offset，从那里重新读一遍——消息还在日志里，重读只是把书签拨回去。这正是[提交日志（commit log）](glossary:commit-log)模型「保留 + 回放」的意义。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "队列思维 vs 日志思维：三个常见误区",
      body: "误区一：「消费」等于「把消息取走/删掉」——队列里是，Kafka 里不是；消费者只是复制并处理了一个视图，数据本体留在日志里。误区二：读同一个分区的组越多，存储占用翻倍——不会，消息只存一份，多组共享；「读的人多」与「存得久」是两件事。误区三：把 offset 当成全局消息 ID——offset 只在单个分区内唯一，不同分区之间不可比较、没有先后关系。还有一个相关误区：以为「我提交到 1271」就删掉了 1271 之前的消息——删除只由保留策略触发，见下一节。",
    },
    {
      type: "heading",
      text: "钉子三：消费不删除消息，删除只由保留策略决定",
    },
    {
      type: "paragraph",
      text: "消息真正消失的唯一途径是[保留策略（retention）](glossary:retention)按计划清理：最常见的是按时间（订单事件主题通常保留数天到数周，清理按存储段粒度分批进行，第 2 章细讲），也可以按总大小，或者对「以 key 为语义」的主题做[日志压缩](glossary:compaction)——只留每个 key 的最新值，适合 `inventory.stock`（按 sku 存当前库存）这类状态型数据。无论哪种，清理都与「是否被消费过」无关。",
    },
    {
      type: "paragraph",
      text: "这个性质带来两个反直觉的工程结论。第一，消费积压（lag 很大）不增加 broker 存储压力——积压只是「某个组的书签落后了」，消息反正要按保留期存着，[消费滞后（lag）](glossary:lag)的代价在别处：处理延迟与追赶成本（第 4、9 章）。第二，让一个组从头重读历史，不需要任何数据复制或迁移——读取只是廉价的顺序扫描，这正是「新团队补历史数据」在 Kafka 上只需新建一个组、无需上游配合的原因。",
    },
    {
      type: "heading",
      text: "集群与 KRaft：数据平面与控制面",
    },
    {
      type: "paragraph",
      text: "上面的旅程其实默认了集群的存在。生产环境里，书舟的 [Broker](glossary:broker) 不止一台：主题的分区分散在多台机器上，每份数据保留多副本，单台宕机不丢数据、不中断读写（leader 会切换）。这是「数据平面」——broker 存数据、服务 IO。另一组角色管「控制面」：主题怎么建、分区分到哪台机器、谁是某个分区的 leader、集群里有哪些成员——这些**元数据**在 4.x 里由 [KRaft](glossary:kraft) 承担：一组投票节点组成 quorum，把每次元数据变更写进内部元数据日志并达成共识，quorum 选出的活跃[控制器](glossary:controller)执行变更。ZooKeeper 时代已经是历史——Kafka 4.0 起 KRaft 是唯一模式。一句话记法：**brokers 存业务数据，controller quorum 管元数据**。副本协议与 ISR 的细节在第 2 章展开，KRaft 的部署拓扑与故障行为在第 9 章展开。",
    },
    {
      type: "heading",
      text: "自测：消费组的进度",
    },
    {
      type: "quiz",
      question: "inventory-组和 analytics-组同时在消费 `orders.events` 的分区 3。inventory-组已把偏移量提交到 1271，analytics-组还停在 900。以下哪种说法正确？",
      options: [
        "analytics-组消费得慢，会阻塞 inventory-组继续读分区 3 的新消息",
        "inventory-组提交到 1271 后，分区 3 上偏移量小于等于 1271 的消息会被 broker 删除，analytics-组只能从 1271 之后读起",
        "两个组各有独立的读取位置，互不影响；analytics-组还可以随时把位置重置到更早的偏移量，重读历史消息",
        "分区 3 同一时刻只能被一个消费组读取，inventory 与 analytics 必须合并成一个组",
      ],
      answer: 2,
      explanation: "消费组是 Kafka 多订阅能力的载体：每组各记各的偏移量，进度互不阻塞（排除 0），也互不共享（排除 3）。消息删除只由保留策略触发，与任何组的提交无关——inventory-组提交 1271 只是移动了自己的书签，不会让 900~1271 的消息消失，analytics-组仍能读到（排除 1）。既然消息还在日志里，把组的位置重置到更早的偏移量就能回放历史——这正是提交日志模型相对队列模型的核心差异。",
    },
    {
      type: "heading",
      text: "全课程地图：每个盒子将在哪里被打开",
    },
    {
      type: "paragraph",
      text: "本课立起的这张地图，就是整门课的目录。后续每一章拆开本课的某个盒子看内部构造——按顺序学下去，你会在脑中把图越画越细：",
    },
    {
      type: "list",
      items: [
        "第 1 章剩余两课先把地图变成现实：[本地运行 Kafka 4.3（KRaft）与 CLI 初体验](/courses/kafka/lessons/kafka-kraft-quickstart) 起一个真实集群，[franz-go 初体验](/courses/kafka/lessons/kafka-go-client-hello) 写出第一个生产者与消费者。",
        "第 2 章「主题、分区与存储」拆开 broker 内部：分区与 key 的决策（[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)）、日志文件与保留/压缩（[存储：Segment、保留策略与日志压缩](/courses/kafka/lessons/kafka-storage-segments-retention)）、副本与 ISR（[副本、ISR 与数据安全](/courses/kafka/lessons/kafka-replication-isr)）——回答「④⑤落盘与复制到底怎么发生的、怎么不丢」。",
        "第 3 章「生产者」拆开图的上半段：Record 与发送路径（[生产者发送路径与 Record](/courses/kafka/lessons/kafka-producer-send-path)）、批量与吞吐（[批量、压缩与吞吐调优](/courses/kafka/lessons/kafka-producer-batching-throughput)）、acks 与幂等（[可靠发布：acks、重试与幂等生产者](/courses/kafka/lessons/kafka-producer-reliability-acks)）——回答「①②③⑥的每个决定」。",
        "第 4 章「消费者与消费组」拆开图的下半段：拉取与提交时机（[拉取模型、位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)）、经典再平衡（[消费组与经典再平衡协议](/courses/kafka/lessons/kafka-consumer-groups-classic)）、新一代组协议（[KIP-848 新组协议与 4.x 演进方向](/courses/kafka/lessons/kafka-consumer-group-protocol-848)）——回答「⑦⑧⑨⑩与协调器的全部行为」。",
        "第 5 章「可靠性」回答贯穿全图的问题：端到端到底丢不丢、重不重（[投递语义](/courses/kafka/lessons/kafka-delivery-semantics)）、事务（[事务与精确一次](/courses/kafka/lessons/kafka-transactions-go)）、失败与死信（[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)）。",
        "之后各章把同一张图横向扩展：第 6 章设计「消息长什么样」（[事件建模](/courses/kafka/lessons/kafka-event-modeling)），第 7 章让数据库进出 Kafka（[Kafka Connect 架构](/courses/kafka/lessons/kafka-connect-architecture)），第 8 章对事件流做持续计算（[流处理心智模型](/courses/kafka/lessons/kafka-streaming-model)），第 9 章把它运维得长期稳定（[KRaft 集群](/courses/kafka/lessons/kafka-kraft-cluster-deploy)），第 10 章用一个 Go 订单管道串起全部（[综合项目](/courses/kafka/lessons/kafka-capstone-order-pipeline)），第 11 章用它应付面试（[面试速查](/courses/kafka/lessons/kafka-interview-core)）。",
      ],
    },
    {
      type: "paragraph",
      text: "学完本课，你应该能不看任何资料，把「一次消息的旅程」十一站从头讲到尾，并说清三个钉子：分区是顺序与并行的边界、偏移量是消费组自己的书签、消费不删除消息。地图已经立好，下一步别停留在纸面上——去 [本地运行 Kafka 4.3（KRaft）与 CLI 初体验](/courses/kafka/lessons/kafka-kraft-quickstart)，把单节点集群跑起来，用 CLI 亲眼看看主题、分区与偏移量。",
    },
    {
      type: "keypoints",
      items: [
        "全景一句话：生产者序列化并按 key 路由 → leader 分区顺序落盘获得 offset → follower 同步 → 按 acks 确认 → 组协调器分配分区 → 消费者拉取处理 → 提交自己的偏移量 → 消息仍在日志里",
        "分区是顺序与并行的唯一边界：同 key 同分区保证分区内有序；跨分区无全局序；组内并行度上限 = 分区数",
        "offset 是分区内消息的固有编号；「读到哪了」是每个消费组自己的书签，组间独立、可重置回放",
        "消费不删除消息：数据只被保留策略清理；读的人再多也不增加存储，回放只需把组的书签拨回去",
        "KRaft（4.x 唯一模式）：brokers 存业务数据，controller quorum 用内部元数据日志管集群元数据",
      ],
    },
  ],
};
