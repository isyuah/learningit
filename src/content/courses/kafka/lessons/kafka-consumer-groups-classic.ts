/* ==================================================================
 * 课时：消费组与经典再平衡协议（kafka-consumer-groups-classic）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Apache Kafka 4.x（4.3 主线）；Go 示例以 franz-go v1.21.x 为准，
 * 默认值与 API 名称对照 franz-go v1.21.6 源码核实。本课讲经典（classic）
 * 组协议；KIP-848 新协议在下一课。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "消费组如何分配分区所有权：协调器、JoinGroup/SyncGroup/Heartbeat 生命周期，以及再平衡的正确姿势。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课把单个消费者的循环写对了：拉取一批、处理完、提交。但生产系统不会只有一个消费者——`orders.events` 在订单峰值时每秒约 2 万条事件（5000 单/秒 × 每单 3~5 个事件，推导见[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)），单进程处理不过来时，自然的想法是「多开几个实例一起读」。问题随之而来：谁读哪个分区？多开一个实例真的能加速吗？实例崩溃退出时别人怎么接手？答案是[消费组](glossary:consumer-group)——一组消费者通过**分区所有权协议**协商「每个分区同一时刻只归一个成员」，协调器负责仲裁。本课以经典（classic）组协议的视角讲透这个协议：成员生命周期、触发再平衡的条件、以及再平衡期间你必须做对的事。",
    },
    {
      type: "heading",
      text: "组 = 分区所有权协议",
    },
    {
      type: "paragraph",
      text: "消费组的核心不是「组播/负载均衡队列」，而是一份**所有权契约**：组订阅了哪些主题，这些主题的每个[分区](glossary:partition)在同一时刻**只分配给组内的一个成员**（member）。组内所有成员共同覆盖订阅主题的全部分区，每个成员只处理自己名下的分区。因为每个分区同时只有一个读者，组内消费天然保证**分区内有序**——同一订单的所有事件只会被一个成员按顺序读到，不会出现两个实例并发处理同一分区的乱序。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "组里加人 ≠ 单分区变快",
      body: "并行上限是分区数：一个 8 分区的主题，组里加到 8 个成员刚好每人一个分区；加到 9 个，第 9 个成员分不到任何分区（空闲待命）。想提高单主题的消费吞吐，先看 lag 是不是单分区热点，再决定加分区（分区数只能增不能减，见[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)）还是加成员。反过来，单个分区处理慢只拖累拥有它的那个成员，其它分区不受影响——这是分区隔离性的另一面。",
    },
    {
      type: "paragraph",
      text: "「组」还定义了位置的隔离边界：**不同组各自维护独立的已提交位移**。`orders.events.consumers` 和 `orders.events.audit` 两个组消费同一主题，互不干扰、各有各的 lag——通知服务读它的、分析服务读它的，这正是 Kafka 事件流平台「一份数据多组各取所需」的形态。本课末尾的实验会让你亲眼看到这一点。",
    },
    {
      type: "heading",
      text: "协调器与成员生命周期",
    },
    {
      type: "code",
      title: "经典协议：一个成员的完整生命周期（text 图）",
      language: "text",
      code: "消费者进程               组协调器（某 broker）              其它成员\n   │                              │                              │\n   │  FindCoordinator(组名)        │                              │\n   ├─────────────────────────────►│                              │\n   │ ◄────────── coordinator 地址  │                              │\n   │                              │                              │\n   │  JoinGroup(订阅, 支持的策略)   │                              │\n   ├─────────────────────────────►│ ◄── 所有成员同时 JoinGroup ──┤\n   │                              │  选出 leader 成员             │\n   │ ◄── leader 角色 + 全体成员元数据│                              │\n   │                              │                              │\n   │  [leader] 用分配策略算出 assignment，发回 SyncGroup         │\n   ├─────────────────────────────►│                              │\n   │ ◄── SyncGroup 下发我的分区 ──┤ ◄── SyncGroup 下发各自分区 ──┤\n   │                              │                              │\n   │  Heartbeat ... Heartbeat ... │  （周期心跳保活）             │\n   ├─────────────────────────────►│                              │\n   │                              │                              │\n   │  LeaveGroup（优雅退出）/ 心跳超时（被动移除）                 │\n   ├─────────────────────────────►│ → 触发新一轮 rebalance       │\n",
    },
    {
      type: "paragraph",
      text: "每个消费组都由集群中**恰好一个 broker** 担任它的[组协调器](glossary:coordinator)（group coordinator）：它保存组成员关系、接受位移提交、在成员变化时发起再平衡。协调器的定位规则与主题分区同源：`group.id` 哈希到内部主题 `__consumer_offsets` 的某个分区，持有该分区的 broker 就是该组的协调器——所以位移提交、成员管理天然落在同一个地方。经典协议的成员生命周期分五步：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**JoinGroup（加入组）**：成员上报自己的订阅（哪些主题）与支持的分配策略列表（如 `range`、`cooperative-sticky`），协调器从全员都支持的策略里挑第一个，并从本轮参与者里指定一个 **leader 成员**；",
        "**leader 算 assignment**：协调器把全体成员的元数据发给 leader（只有 leader 收到），leader 用双方同意的分配策略把「订阅主题 × 分区」映射到各成员，再把结果作为 SyncGroup 请求发回协调器；",
        "**SyncGroup（同步分配）**：协调器把各自的分区清单下发给每个成员——普通成员在这一步之前完全不知道自己的 assignment，这就是「协调器是所有权权威」的含义；",
        "**Heartbeat（周期心跳）**：成员周期心跳保活。franz-go 在后台 goroutine 自动发送，不需要业务代码参与；",
        "**LeaveGroup（离开）**：优雅退出时主动发 LeaveGroup，协调器立即把它的分区交给别人；进程崩溃没机会发 LeaveGroup，只能等**心跳超时**——协调器判定成员死亡后移除它。两种离开都会触发再平衡。",
      ],
    },
    {
      type: "paragraph",
      text: "生命周期里时间相关的三个旋钮（franz-go 默认值均已核实，可分别用 `kgo.SessionTimeout`、`kgo.HeartbeatInterval`、`kgo.RebalanceTimeout` 调整）：协调器以**会话超时**（session timeout，默认 45 秒）判定成员死亡——超过该时间没收到心跳就移除成员并触发再平衡；**心跳间隔**（heartbeat interval，默认 3 秒）只是客户端发心跳的周期，必须小于会话超时；**再平衡超时**（rebalance timeout，默认 60 秒）则是协调器给「一轮再平衡必须完成」的期限——所有成员完成 revoke、提交、重新加入的时间预算，对应 broker 侧的 `rebalance.timeout.ms`。broker 会校验会话超时必须在 `group.min.session.timeout.ms` 与 `group.max.session.timeout.ms` 之间。",
    },
    {
      type: "table",
      caption: "经典组协议的时间参数（franz-go v1.21.6 默认值）",
      headers: ["概念", "franz-go 选项", "默认值", "判定方"],
      rows: [
        ["会话超时 session timeout", "`kgo.SessionTimeout`", "45s", "协调器：超时未心跳 → 成员死亡、触发再平衡"],
        ["心跳间隔 heartbeat interval", "`kgo.HeartbeatInterval`", "3s", "客户端：后台 goroutine 周期发送"],
        ["再平衡超时 rebalance timeout", "`kgo.RebalanceTimeout`", "60s", "协调器：一轮再平衡（revoke+提交+重加入）的期限"],
      ],
    },
    {
      type: "paragraph",
      text: "协调器同时是**位移提交的权威**（上一课的提交就发给它）。这一设计让「所有权转移」和「进度交接」在同一个地方原子化完成：再平衡时协调器知道谁最后提交了什么，新成员据此从正确的位置接续。理解组，本质上就是理解「分区所有权 + 提交进度」这两份状态如何在一个权威节点上被维护和转移。",
    },
    {
      type: "heading",
      text: "什么会触发再平衡",
    },
    {
      type: "list",
      items: [
        "**成员加入**：新消费者启动加入组（扩容、重启、发布新版本）；",
        "**成员离开**：优雅 LeaveGroup（正常关闭）；",
        "**成员死亡**：心跳超时被协调器移除（崩溃、网络分区、长时间停顿）；",
        "**订阅变化**：成员改用别的主题集合；",
        "**分区数变化**：主题扩容后，协调器需要把新分区分配出去（leader 会重新计算并触发一轮再平衡）。",
      ],
    },
    {
      type: "paragraph",
      text: "再平衡（rebalance）就是协调器把上述任何一种变化**收敛回「每个分区恰好一个活跃成员」的稳定态**的过程。收敛需要时间，而收敛期间成员可能被要求交还分区——所以再平衡是有代价的，代价大小取决于采用哪种再平衡风格，以及你的提交姿势。",
    },
    {
      type: "heading",
      text: "eager 与 cooperative：两种再平衡风格",
    },
    {
      type: "paragraph",
      text: "经典协议内部的分配策略决定了再平衡的**行为风格**。Kafka 早期的分配策略都是 **eager（先全量让出再全量分配）**：任何一个成员变化，协调器先要求**所有成员 revoke 全部已拥有的分区**（全组 stop-the-world：消费全部暂停），等全员交还后，再由 leader 重新计算一份全新 assignment 下发。一轮 eager 再平衡里，每个成员都会经历「全部失去 → 重新获得（可能不同的分区）」，大组里任何一次成员抖动都让全组停顿一轮——这就是面试题里常说的「再平衡风暴」（rebalance storm / thundering herd：大量成员同时 JoinGroup）。",
    },
    {
      type: "paragraph",
      text: "KIP-429 引入的 **cooperative（增量让出）** 风格把「全量让出」改成两阶段：先 revoke **需要转移走的那部分**分区、同时继续消费保留下来的分区，等 revoke 完成后协调器才把新分区 assign 进来。成员变化只影响「受波及」的分区，其它分区上的消费不中断——把 stop-the-world 变成局部迁移。KIP-429 的这个思想（增量、只动受影响者）正是下一课 KIP-848 的伏笔。",
    },
    {
      type: "paragraph",
      text: "franz-go 里风格由 `kgo.Balancers(...)`（等价于 Java 的 `partition.assignment.strategies`）选择，**默认是 cooperative-sticky**（v1.21.6 默认配置核实）：",
    },
    {
      type: "code",
      title: "选择分配策略（franz-go）",
      language: "go",
      code: "cl, err := kgo.NewClient(\n\tkgo.SeedBrokers(\"localhost:9092\"),\n\tkgo.ConsumerGroup(\"orders.events.consumers\"),\n\tkgo.ConsumeTopics(\"orders.events\"),\n\t// 显式列出策略；协调器挑全体成员都支持的第一个。\n\tkgo.Balancers(\n\t\tkgo.CooperativeStickyBalancer(), // 默认值：增量让出 + 尽量保持历史分配\n\t\t// kgo.RangeBalancer(),          // eager：按主题分段连续分配\n\t\t// kgo.RoundRobinBalancer(),     // eager：轮流散列分配\n\t\t// kgo.StickyBalancer(),         // eager：尽量保持历史分配（无增量）\n\t),\n)",
    },
    {
      type: "table",
      caption: "四种分配策略一句话差异",
      headers: ["策略", "风格", "一句话差异"],
      rows: [
        ["`kgo.RangeBalancer()`", "eager", "按主题把连续的分区段分给成员；分区数不成倍数时负载最不均"],
        ["`kgo.RoundRobinBalancer()`", "eager", "所有分区轮流散给成员；负载最均匀但每次可能大搬移"],
        ["`kgo.StickyBalancer()`", "eager", "尽量保留上一轮分配、只动必要分区（KIP-54），减少搬移"],
        ["`kgo.CooperativeStickyBalancer()`", "cooperative", "sticky 的增量版（KIP-429）：先 revoke 后 assign，边消费边迁移"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "eager 与 cooperative 不能混跑",
      body: "一组内所有成员的分配风格必须一致：一个只支持 eager 的新成员加入 cooperative 组，会把全组**降级回 eager**——所有人被要求全量 revoke，已提交位置之外的已处理数据会重复消费。franz-go 文档明确警告：cooperative 组一旦降级会全量 revoke 并从已提交位移重读，可能产生大量重复，不建议在组已跑起来后混入老客户端。滚动升级时要么全员一次性切到 cooperative，要么按 KIP-429 的规范流程分两轮完成。",
    },
    {
      type: "subheading",
      text: "静态成员（KIP-345）：重启不触发再平衡",
    },
    {
      type: "paragraph",
      text: "再平衡最大的触发源其实是**成员自己**：每次发布、每次重启，消费者以新身份加入组都会引发一轮再平衡，哪怕它处理的数据完全没变。KIP-345 的静态成员（static membership）解决这个问题：给成员一个跨重启不变的**实例 ID**（`group.instance.id`），协调器把它当成「同一个成员回来了」而不是「新成员加入」，于是**不触发再平衡**，重启后直接拿回原来的分区——配合 sticky 类策略还能保持分区所有权不漂移。",
    },
    {
      type: "code",
      title: "静态成员：franz-go kgo.InstanceID",
      language: "go",
      code: "cl, err := kgo.NewClient(\n\tkgo.SeedBrokers(\"localhost:9092\"),\n\tkgo.ConsumerGroup(\"orders.events.consumers\"),\n\tkgo.ConsumeTopics(\"orders.events\"),\n\tkgo.InstanceID(\"orders-worker-1\"), // 静态成员：同一 ID 重启不触发再平衡\n)",
    },
    {
      type: "paragraph",
      text: "静态成员的代价很对称：**协调器不再相信「连接断开=成员离开」**。使用 `kgo.InstanceID` 后客户端关闭时**不会发送 LeaveGroup**（franz-go 源码文档核实），协调器要等会话超时（默认 45s）过期才把该实例 ID 的分区让给别人——如果实例真的死了，故障转移反而变慢，所以要调大会话超时覆盖「正常重启耗时」，也要在缩容/替换时用管理工具显式移除该实例 ID（franz-go 文档建议通过 `kcl` 等管理客户端发 LeaveGroup），否则它的分区会一直等超时。实例 ID 必须在组内唯一且由部署系统稳定管理（如 Pod 名），用错会互相顶替。",
    },
    {
      type: "heading",
      text: "再平衡期间的工程真相",
    },
    {
      type: "paragraph",
      text: "现在把上一课的提交时机与再平衡拼起来，看一条消息在再平衡中的完整命运：成员 A 正在处理 `orders.events` 分区 0，offset 90 已提交，本地已处理到 120，还没提交。此时成员 B 加入组触发再平衡，分区 0 被协调器判给 B。A 收到 revoke（通过 `OnPartitionsRevoked` 回调），如果 A 的代码**在回调里补提交了**，B 从 120 接续；如果 A 没提交（手动模式且没注册回调，或自动提交的 5 秒周期还没到），B 只能从 90 开始——**90~119 被 A 处理过、又被 B 处理一遍**。",
    },
    {
      type: "list",
      items: [
        "**「处理中/已处理未提交」的消息在再平衡中必然重复**：交接只认已提交位移，未提交的进度不会随成员转移。这是 at-least-once 的固有代价，不是 bug；",
        "**正确姿势 = 上一课的三件套**：处理完一批提交一批；`OnPartitionsRevoked` 里补最后一次提交；外部副作用靠幂等吸收残余重复（[投递语义](glossary:delivery-semantics)与幂等消费在第 5 章展开）；",
        "**更糟的情况是倒拨别人的提交**：A 没在 revoke 时提交，B 从 90 处理到 200 并提交；此时 A 若还活着、在 revoke 后又把自己缓存的「120」提交出去，会把组的进度**倒拨回 120**——B 白干 80 条。franz-go 在 revoke 后不再允许对已失去的分区提交（这正是 revoke 回调存在的意义），但多成员交错时仍要警惕；",
        "**被踢是另一条重复路径**：成员因会话超时被协调器移除时，它的分区被强制转交——如果它死前没提交，接手者同样从头重读。心跳超时通常不是处理慢导致的（franz-go 心跳在后台发），而是**再平衡流程等你**导致的：revoke 回调或 `BlockRebalanceOnPoll` 下的处理超过了再平衡超时（默认 60s），协调器等不起就把你踢了。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "franz-go 与 Java 的「被踢」模型不同",
      body: "Java 客户端有 `max.poll.interval.ms`：两次 poll 间隔超过它就被判定死亡。franz-go **没有这个参数**——心跳独立于 poll 在后台发送，你处理很久也不会因「没 poll」掉线；会掉线的场景是再平衡被你的用户代码阻塞（回调慢、`BlockRebalanceOnPoll` 下迟迟不 `AllowRebalance`）超过再平衡超时。所以 Go 侧的防护重点是：**回调要快、处理要能被打断或限批**（用 `PollRecords(ctx, n)` 限制单批条数），必要时用 `kgo.OnPartitionsCallbackBlocked` 在再平衡被阻塞时收到信号、赶紧收尾放行。",
    },
    {
      type: "heading",
      text: "观察：describe 一个消费组",
    },
    {
      type: "code",
      title: "查看组成员、当前位移与 lag",
      language: "bash",
      code: "# 描述组：每个分区的当前位移、日志末端、lag、以及当前持有者\nbin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\\n  --describe --group orders.events.consumers\n\n# 输出（4.x，各列含义）：\n# TOPIC          PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG     CONSUMER-ID                              HOST           CLIENT-ID\n# orders.events  0          120             4500            4380    consumer-1-029af89c-873c-...-a720cefd41a669d6  /127.0.0.1     consumer-1\n# orders.events  1          88              4490            4402    consumer-1-029af89c-873c-...-a720cefd41a669d6  /127.0.0.1     consumer-1\n\n# 只看成员与各自分到的分区数\nbin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\\n  --describe --group orders.events.consumers --members\n",
    },
    {
      type: "paragraph",
      text: "CURRENT-OFFSET 是协调器里记录的**已提交位移**，LOG-END-OFFSET 是分区日志末尾，两者之差就是[消费滞后](glossary:lag)。看 describe 的输出时请带着本课的眼光：CONSUMER-ID 列会告诉你每个分区**此刻归谁**——再平衡发生时这列会整体变化；CURRENT-OFFSET 则忠实反映「最后提交到哪」，它不会因再平衡而回退，除非接手者从更早处重读后覆盖提交。lag 持续增长的排障闭环在第 9 章监控课展开，本课只需要会用 describe 验证组行为。",
    },
    {
      type: "exercise",
      title: "实验：两个消费者，同组与不同组",
      description: "起两个完全相同的消费者进程（复用作弊少：直接复制上一课的拉取循环程序，打印每条消息的 key 与所在分区），都用组名 `orders.events.consumers`，用 console producer 持续写消息。观察 A：每条消息是否只被其中一个进程打印（分区不重叠）？describe 组的 members，确认两个 CONSUMER-ID 各占一半分区。然后把第二个进程的组名改成 `orders.events.audit` 重启，再写一批消息：这次两条消息是否被两个进程**各自打印一遍**（两个组各自读全量）？describe 两个组，对比它们各自的 CURRENT-OFFSET 是否独立前进。最后，同组实验里 kill -9 掉其中一个进程，观察另一个进程是否很快接管了它的分区（看 describe 的 CONSUMER-ID 列变化与日志中的 revoke/assign 记录）。",
      hint: "想让「分区归属」看得更清楚，写消息时把 key 轮换到多个分区；kill -9 后 coordinator 要等心跳超时（会话超时默认 45s）才判定死亡，观察会有延迟，属正常。",
    },
    {
      type: "quiz",
      question: "orders.events 分区 0 的成员 A 处理到 offset 120（已提交到 90）时触发再平衡，分区 0 转给成员 B。关于重复消费，下列哪个说法正确？",
      options: [
        "不会重复：协调器会把自己记录的 90 到 120 之间的处理进度一并转交给 B",
        "A 在 revoke 回调里补提交，B 从 120 接续；若 A 没补提交，B 从 90 重读，90–119 会被 A 与 B 各处理一遍",
        "重复只可能发生在 B 是新加入的成员时，老成员之间的交接从不重复",
        "只要 A 的进程没有崩溃，再平衡就绝不会造成任何重复",
      ],
      answer: 1,
      explanation: "再平衡只认「已提交位移」这一份进度：交接时未提交的部分（A 处理完的 90–119）会从最后提交点 90 被 B 重读，产生重复；A 在 OnPartitionsRevoked 里补一次提交可以把重复尾巴从 90 缩到 120。重复来自「处理完但未提交」的窗口与接手者的重读，与成员新旧、进程是否崩溃无关——这正是 at-least-once 语义的体现。",
    },
    {
      type: "keypoints",
      items: [
        "消费组 = 分区所有权协议：每分区同刻只归一个成员；并行上限是分区数，加人不会加速单分区",
        "经典协议生命周期：FindCoordinator → JoinGroup（leader 成员算 assignment）→ SyncGroup 下发 → 周期 Heartbeat → LeaveGroup/超时移除，状态权威是组协调器",
        "franz-go 默认：cooperative-sticky 分配（KIP-429 增量风格）、会话超时 45s、心跳 3s、再平衡超时 60s（均已核实）",
        "eager 是全组先 revoke 再分配（stop-the-world）；cooperative 先 revoke 受波及分区、边消费边迁移；eager 成员混入会把 cooperative 组降级",
        "静态成员（KIP-345）：kgo.InstanceID 固定实例身份，重启不触发再平衡，但真死时故障转移要等会话超时",
        "再平衡期间未提交的已处理数据必然被接手者重读：处理完提交 + revoke 回调补交 + 幂等兜底是标准姿势",
      ],
    },
  ],
};
