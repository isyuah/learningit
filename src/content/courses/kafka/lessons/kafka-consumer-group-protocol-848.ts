/* ==================================================================
 * 课时：KIP-848 新组协议与 4.x 演进方向（kafka-consumer-group-protocol-848）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Apache Kafka 4.x（主线 4.3.1，2026-09）；Go 客户端 franz-go v1.21.x。
 * 协议现状按 kafka.apache.org 4.3 官方文档与 franz-go CHANGELOG/源码核实。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "经典再平衡协议的瓶颈、KIP-848 服务端协调的新协议设计，以及 4.x 双协议共存与 Go 项目的现实选择。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课讲透了经典（classic）组协议：客户端 JoinGroup、leader 成员算 assignment、SyncGroup 下发、协调器仲裁所有权。这套协议从 Kafka 0.9 服务至今，但它的「全体成员同步参与每一轮再平衡」的骨架，在大规模场景下开始吃力。本课讲它的继任者——KIP-848 新消费者组协议（consumer rebalance protocol）：动机、设计、4.x 的双协议共存与弃用路线，以及 Go/franz-go 项目现在该怎么选。协议细节不展开到 wire 层，重点是判断与迁移的框架。",
    },
    {
      type: "heading",
      text: "经典协议的问题：再平衡为什么是风暴",
    },
    {
      type: "paragraph",
      text: "经典协议把再平衡设计成**全组的同步屏障**（global synchronization barrier）：任何成员加入、离开或失联，协调器都要让全体成员经历「revoke → 重新 JoinGroup → leader 算 assignment → SyncGroup」的完整一轮，期间相关消费停顿。三个问题随之放大：",
    },
    {
      type: "list",
      items: [
        "**风暴与抖动放大**：成员越多，单位时间内发生成员变化的概率越高；大组里一次滚动发布（几十个实例先后重启）会引发一连串全组再平衡，每次都是全员参与——上一课提过这被称为 rebalance storm / thundering herd；",
        "**大组收敛慢**：leader 要收集全体成员状态、计算分配、再逐一分发，组规模越大、订阅主题越多，一轮 SyncGroup 的收敛时间越长；",
        "**客户端算分配的一致性风险**：assignment 由**某个成员（leader）**用自己掌握的元数据计算。成员间的元数据视图可能不一致（不同时刻的 Metadata 响应），leader 的陈旧视图会算出让其它成员不满意的分配；分配逻辑分散在各客户端实现里，升级、bug、自定义策略都可能让同组成员「谈不拢」。",
      ],
    },
    {
      type: "paragraph",
      text: "此前两代改进都是在经典协议**内部**打补丁：KIP-345 静态成员减少无谓的成员变化，KIP-429 cooperative 让 revoke 只波及受影响分区。但补丁没有改变「分配由客户端算、再平衡是全组事件」这两个骨架问题——KIP-848 换掉的就是骨架。",
    },
    {
      type: "heading",
      text: "KIP-848 设计要点：把分配搬上服务端",
    },
    {
      type: "paragraph",
      text: "KIP-848（The Next Generation of the Consumer Rebalance Protocol，常被称为 consumer protocol / next-gen rebalancer）从根上重排了职责：**assignment 的计算从成员 leader 移到 broker 的组协调器**。协调器本来就持有全体成员与所有提交状态，是所有权与进度的天然权威，让它直接算分配，省掉了「收集元数据 → 发给 leader → 等 leader 算完 → 广播」的往返，也消除了成员间视图不一致的问题。",
    },
    {
      type: "list",
      items: [
        "**member epoch（成员纪元）**：每个成员持有 `(memberID, memberEpoch)`。组内任何成员变化或分配调整都让相关成员的 epoch 递增；成员带着 epoch 发心跳、提交位移，携带过期 epoch 的请求会被拒（fenced）——这跟事务里用 epoch 栅栏僵尸生产者是同一族「代际令牌」思想；",
        "**再平衡不再是全局事件**：成员变化后，协调器只对**受影响的分区/成员**做增量协调（增量 reconciliation），其它成员几乎无感——官方文档的说法是设计上「不再依赖全局同步屏障」；新成员通过周期心跳的响应直接拿到新 assignment，无需全员 JoinGroup/SyncGroup；",
        "**心跳与超时由服务端掌控**：consumer 协议组的心跳间隔与会话超时由 broker 配置 `group.consumer.heartbeat.interval.ms`、`group.consumer.session.timeout.ms` 控制，分配策略由 `group.consumer.assignors` 控制——客户端不再各自为政；",
        "**服务端分配器**：4.x 内置 `uniform`（默认）与 `range` 两种服务端分配器：Java 的 `CooperativeStickyAssignor`/`StickyAssignor`/`RoundRobinAssignor` 都映射到 `uniform`，`RangeAssignor` 映射到 `range`；客户端可用 `group.remote.assignor` 选择其一，或实现服务端接口注册自定义分配器。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "演进关系：KIP-345 → KIP-429 → KIP-848",
      body: "三条 KIP 是一条连续的线：KIP-345 让「重启」不再是组事件；KIP-429 让「再平衡」只动受影响分区；KIP-848 把最后剩下的「协调」也收进服务端并去掉全局屏障。学到这里值得停下来对比：上一课 classic 协议里那些你必须亲手处理的坑（revoke 回调补提交、eager 降级、leader 计算不一致）——在新协议里 leader 角色消失了、全组同步 revoke 也没有了，但「已处理未提交的位移在交接时仍会重读」这条 at-least-once 定律**一条都没变**，它由提交时机决定，与协议无关。",
    },
    {
      type: "heading",
      text: "4.x 现状：双协议共存与弃用路线",
    },
    {
      type: "paragraph",
      text: "Kafka 4.0 起 KIP-848 正式 GA（production-ready），服务端**默认同时支持** classic 与 consumer 两种协议的组，经典协议继续为存量客户端服务；同名的内部机制上，consumer 协议的启用/关闭随 `group.version` 特性开关走，早先用于切换协议的 broker 配置 `group.coordinator.rebalance.protocols` 在 4.3 被弃用（KIP-1237，计划 5.0 移除）。客户端侧，**Java 的 `KafkaConsumer` 至今默认仍用 classic**，要切新协议需显式设置 `group.protocol=consumer`（4.3 文档核实：默认值 `classic`，合法值 `classic`/`consumer`）；切换到 consumer 协议后，`heartbeat.interval.ms`、`session.timeout.ms`、`partition.assignment.strategy` 等客户端参数不再适用（改由服务端配置统管）。",
    },
    {
      type: "paragraph",
      text: "两组协议间的升级有官方路径：**空组**可以在 classic 与 consumer 之间自动转换（停掉全部消费者、用新协议重启即可）；**在线滚动升级**也支持——第一个用 consumer 协议的成员加入时，协调器把整组从 classic 转换过去，前提是原 classic 组的分配器不携带自定义元数据。官方给出的弃用时间线（KIP-1274）为：4.3 起 Java 客户端开始对 classic 协议打弃用提示（Phase 1）；**5.0 起 `KafkaConsumer` 默认使用 consumer 协议**（仍支持 classic）；6.0 起客户端只支持 consumer 协议，broker 仍保留 classic 兼容。",
    },
    {
      type: "table",
      caption: "consumer 再平衡协议演进时间线（KIP-1274 / 官方 4.3 文档）",
      headers: ["版本", "服务端", "Java KafkaConsumer"],
      rows: [
        ["3.7", "consumer 协议 Early Access", "可选用（实验）"],
        ["4.0", "GA；默认启用，classic 并存", "支持但默认仍 classic（`group.protocol=consumer` 切换）"],
        ["4.3", "弃用 `group.coordinator.rebalance.protocols`（KIP-1237）", "开始打印 classic 弃用提示（KIP-1274 Phase 1）"],
        ["5.0", "classic 仍可用（计划）", "默认切到 consumer 协议（计划）"],
        ["6.0", "classic 仅作向后兼容保留（计划）", "仅支持 consumer 协议（计划）"],
      ],
    },
    {
      type: "subheading",
      text: "franz-go 的现状：默认 classic，新协议隐藏可 opt-in",
    },
    {
      type: "paragraph",
      text: "franz-go v1.21.x（README 声明支持 Kafka 0.8.0–4.2+）**默认使用 classic 组协议**，与上一课描述的生命周期一致。KIP-848 的实现从 v1.19.0 起就存在，但**默认隐藏**：v1.19.0 release notes 写明必须通过 `WithContext` 传入一个携带特殊字符串键的 context 才能启用（键名为 `opt_in_kafka_next_gen_balancer_beta`）；作者在 v1.21.0 的 CHANGELOG 里进一步说明：仍在观察 broker 端实现的稳定性，**不打算默认开启**，要等 Kafka 4.3 的 KIP-1251 落地后才提供正式的 option 化开关。对照 v1.21.6 源码，启用还需同时满足：broker 支持 KIP-848 v1（Kafka 4.0+）、且使用的分配器是 range 或 (cooperative-)sticky（默认的 cooperative-sticky 符合）。",
    },
    {
      type: "code",
      title: "KIP-848 beta 期 opt-in 机制（示意，勿用于生产）",
      language: "go",
      code: "// franz-go v1.19.0–v1.21.x：新组协议默认隐藏。官方 CHANGELOG 给出的\n// opt-in 方式是在 context 里放一个特殊键（beta 期约定，后续版本可能变化）：\n// 示意——正式启用方式请以当时 franz-go CHANGELOG/pkg.go.dev 为准。\nctx := context.WithValue(\n\tcontext.Background(),\n\t\"opt_in_kafka_next_gen_balancer_beta\", // CHANGELOG 中列出的特殊键\n\tstruct{}{},\n)\ncl, err := kgo.NewClient(\n\tkgo.WithContext(ctx),\n\tkgo.SeedBrokers(\"localhost:9092\"),\n\tkgo.ConsumerGroup(\"orders.events.consumers\"),\n\tkgo.ConsumeTopics(\"orders.events\"),\n)",
    },
    {
      type: "callout",
      variant: "warning",
      title: "Go 项目此刻的现实建议",
      body: "franz-go 在 v1.21.x 里**不需要你做任何事**：默认 classic 协议在 4.3 broker 上完全受支持，broker 对 classic 的兼容承诺到 5.x 之后才收紧。别为了「新协议」而新协议——beta 期 opt-in 键随时可能变、客户端侧还要满足额外条件，生产抢跑得不偿失。值得切换的信号是：组非常大（成员上百）且你能观测到再平衡风暴成为真实瓶颈（指标与告警见第 9 章监控课）——到那时再评估 franz-go 的正式开关与官方迁移文档。另一个现实约束：新协议下 rack-aware 分配（KIP-881）官方尚未完全支持，而 franz-go 的 classic 路径自 v1.21.0 起已支持 KIP-881——跨机房就近消费的 Go 项目现阶段更应留在 classic。",
    },
    {
      type: "heading",
      text: "迁移视角：什么值得、什么不变",
    },
    {
      type: "list",
      items: [
        "**值得切换的典型场景**：超大组与频繁伸缩（实例按流量弹性扩缩、每天多次全组抖动）、对再平衡停顿敏感的业务——新协议的增量协调把这些从「全组事件」降为「局部事件」；",
        "**不必急着切换的场景**：成员数量稳定的小组（几到几十个成员）、cooperative-sticky 已能压住抖动、以及强依赖客户端自定义分配逻辑的场景（新协议暂不支持客户端侧自定义分配器）；",
        "**语义不变的底线**：投递语义仍由提交时机决定；`OnPartitionsRevoked` 补提交、幂等消费兜底这些工程惯例在 consumer 协议下依然成立；位移存储与协调器权威的位置没有变（仍在 `__consumer_offsets` 的协调器上）；",
        "**混跑注意**：同组的 Java 成员若以 `group.protocol=consumer` 加入，可能触发整组从 classic 在线转换——滚动切换前先看官方升级文档对分配器与版本的要求，并准备空组转换作为回退手段。",
      ],
    },
    {
      type: "paragraph",
      text: "最后划清一个容易混淆的概念：KIP-848 与 Kafka 4.1 起进入 preview 的 **Share 组（KIP-932 Queues for Kafka）**是两条独立的线。[Share 组](glossary:share-group)不是「下一代再平衡」——它是**队列式工作分发**：组内一条消息可被任一成员领取、独立确认、按需重投，牺牲了分区顺序约束换工作负载的公平分发。它的回答的问题是「怎么把任务分给工人」，而消费组协议回答的是「谁拥有哪个分区的顺序流」。Go 侧注意：franz-go v1.21.0 起已完整支持 Share 组消费，若只想用 Kafka 当队列，那是另一套 API（`kgo.ShareGroup`），别与 `ConsumerGroup` 的再平衡混为一谈。",
    },
    {
      type: "quiz",
      question: "关于经典组协议与 KIP-848 新协议的核心差异，下列哪个说法正确？",
      options: [
        "新协议把 assignment 计算从成员 leader 移到 broker 协调器，用 member epoch 做增量协调，成员变化不再需要全组同步再平衡",
        "新协议只是把心跳间隔从 3 秒调成 1 秒，分配仍然由成员 leader 计算",
        "新协议要求所有客户端必须改用 Java 实现，Go 客户端无法参与",
        "新协议取消了位移提交，消费者不再需要维护任何进度状态",
      ],
      answer: 0,
      explanation: "KIP-848 的核心是职责迁移与去屏障：服务端协调器算分配（内置 uniform/range 分配器）、member epoch 栅栏过期成员、只对受影响成员做增量协调——经典协议里 leader 计算分配与全组同步 JoinGroup/SyncGroup 的骨架被移除。心跳频率不是差异点；协议与语言无关；位移提交依然存在（提交时机决定投递语义的定律不变）。",
    },
    {
      type: "keypoints",
      items: [
        "经典协议的瓶颈：全组同步屏障、大组收敛慢、leader 用可能陈旧的客户端元数据算分配；KIP-345/KIP-429 是在协议内部打补丁",
        "KIP-848：assignment 移上服务端协调器（内置 uniform/range 分配器）、member epoch 栅栏、增量协调去掉全局 stop-the-world",
        "4.x 双协议共存：服务端 4.0 起默认启用 consumer 协议；Java 客户端默认仍 classic（group.protocol=consumer 切换）；KIP-1274 时间线指向 5.0 默认翻转、6.0 客户端仅 consumer",
        "4.3 弃用公告：KIP-1237 弃用 broker 配置 group.coordinator.rebalance.protocols（5.0 移除）；classic 客户端开始打弃用提示",
        "franz-go v1.21.x 默认 classic：KIP-848 自 v1.19.0 实现但默认隐藏，opt-in 靠特殊 context 键（beta 机制，以 CHANGELOG 为准）；Go 项目现阶段通常无需切换",
        "Share 组（KIP-932）是队列式工作分发，与消费组再平衡协议是两条独立的路",
      ],
    },
  ],
};
