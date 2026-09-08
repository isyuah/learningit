/* ==================================================================
 * 课时：投递语义：从 at-most-once 到 exactly-once（kafka-delivery-semantics）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 5 章第一课：把第 3 章（acks/重试/幂等）与第 4 章（提交时机/消费组）
 * 的“局部机制”组合成端到端的投递语义图景。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "at-most-once / at-least-once / exactly-once 的精确定义、丢失与重复的三段归属，以及 acks × ISR × 提交时机 × 幂等的组合推理。",
  blocks: [
    {
      type: "paragraph",
      text: "第 3 章我们解决了「消息怎么可靠地送进 Kafka」——`acks`、重试、幂等生产者；第 4 章解决了「消费端怎么可靠地读」——拉取、提交时机、消费组。但这两套机制在真实系统里是**串在一起**的：生产者写完，Broker 存着，消费者再读。单看任何一段都很可靠，串起来之后，丢和重仍然可能发生，只是发生的位置变了。这一课把两端组合起来，给你一张「谁在什么配置下保证什么」的完整地图——这是[投递语义](glossary:delivery-semantics)这个术语的全部含义。",
    },
    {
      type: "paragraph",
      text: "先固定一个词：一条消息是**已提交（committed）**的，指它已经写入分区日志、并按你的配置复制到了足够多的副本上——用 `acks=all` 生产时，就是全部 [ISR](glossary:isr) 都已落盘。下面的所有讨论都以「已提交」为基准点。",
    },
    {
      type: "heading",
      text: "三种语义：字面定义与成立条件",
    },
    {
      type: "list",
      items: [
        "**at-most-once（至多一次）**：消息可能丢，但绝不会被重复处理。成立条件通常是二选一——生产者「发送前就放弃」（如 `acks=0` 不确认，或失败后不重试）；或者消费端「先提交位点、后处理消息」，处理到一半崩溃，重启后从已提交位点继续，中间没处理完的消息被跳过。",
        "**at-least-once（至少一次）**：消息不会丢，但可能被重复处理。这是 Kafka 生产环境的**默认形态**：生产者用 `acks=all`（配合 [min.insync.replicas](glossary:min-insync) 保险丝）+ 失败重试，保证已确认消息不丢；消费端「处理完成后再提交位点」，处理完但没提交就崩溃，重平衡后同一批消息会被重投，于是重复。",
        "**exactly-once（精确一次）**：每条消息只被处理一次。必须立刻追问一句：**在什么范围内**？Kafka 自己能保证的，是「从 Kafka 主题读到、经处理再写回 Kafka 主题」这个闭环——幂等生产者 + 事务 + `read_committed` 消费（本课后半段拆解，下一课给 Go 实现）。一旦处理过程碰到 Kafka 之外的数据库或下游 API，Kafka 就管不到了，只能靠幂等设计做到「有效一次」。",
      ],
    },
    {
      type: "paragraph",
      text: "注意上面三条的措辞：丢和重都发生在**具体的一段链路上**，而不是笼统的「Kafka 保证/不保证」。这也是为什么很多介绍只说「消费端提交时机决定语义」——那只是三分之一。生产端会丢、Broker 会丢、消费端会丢；生产端会重、Broker 基本不主动重（重复来自重试）、消费端会因为提交时机而重。下一节把它们逐段摆开。",
    },
    {
      type: "heading",
      text: "丢失与重复的三段归属",
    },
    {
      type: "table",
      caption: "丢/重消息的三段归属（机制与后果）",
      headers: ["链路段", "决定它可靠性的机制", "会造成的坏结果", "书舟对应剧本"],
      rows: [
        ["生产者 → Broker", "acks（0/1/all）、是否重试、幂等是否开启", "acks < all 或放弃重试：消息没真正落盘却被当成成功（丢）；开重试但没幂等：Broker 落了两份（重）", "剧本 A"],
        ["Broker 内部（副本）", "replication.factor、ISR 收缩、min.insync.replicas、[unclean leader election](glossary:unclean-election)", "ISR 跌破 minISR 时 `acks=all` 写入被拒（宁可失败也不丢，代价是可用性）；unclean 选举开启后落后副本可能当选，已确认消息丢失（丢）", "剧本 B"],
        ["Broker → 消费者", "提交时机（处理前/处理后）、自动提交窗口、重平衡", "先提交后处理：崩溃跳消息（丢）；处理完未提交：崩溃后重投（重）", "剧本 C"],
      ],
    },
    {
      type: "paragraph",
      text: "读这张表的正确姿势是：**把「丢」和「重」分别归因**。生产者与 Broker 段主要决定丢不丢；消费段同时决定丢（提交太早）与重（提交太晚）。所以一个系统最终表现成哪种语义，是三个旋钮各自位置的乘积，不是某一个开关决定的。",
    },
    {
      type: "subheading",
      text: "三个事故剧本（书舟书店）",
    },
    {
      type: "paragraph",
      text: "**剧本 A · 生产段（丢）：** web 网关向 `user.behavior` 发行为事件时为了压延迟用了 `acks=1`（只等 leader 落盘）。某一刻 leader 所在 Broker 在确认后、follower 复制完成前宕机，且短时间无法恢复——官方文档对这个窗口的描述是「leader 确认后立刻失效、follower 还没来得及复制，这条消息就丢了」。用户那次加购行为从埋点里消失，推荐位冷启动缺了一条信号。这类日志型主题可以接受，但你要知道代价是按这个窗口在丢。",
    },
    {
      type: "paragraph",
      text: "**剧本 B · Broker 副本段（丢）：** `orders.events` 按生产设定 `replication.factor=3`、`min.insync.replicas=2`、`acks=all`，双机房网络分区后 ISR 只剩单机房两个副本，写入继续成功。但若某位管理员把 `unclean.leader.election.enable` 打开，分区断连时一个**不在 ISR 里**的落后副本可能当选 leader——它没有最近一批已被确认的消息，订单创建事件静默消失，`notify` 永远收不到。对照：保持 unclean 关闭（官方默认 `false`），Broker 宁可让分区暂时不可写、返回错误让生产者知道失败，也不悄悄丢已确认数据。这正是 minISR + acks=all 的完整语义：ISR 数量低于 `min.insync.replicas` 时写入直接报错（`NotEnoughReplicas` 一类），把「丢」显式变成「失败」。",
    },
    {
      type: "paragraph",
      text: "**剧本 C · 消费段（丢与重）：** `notify` 服务消费 `orders.events` 发通知。先看「丢」的姿势——**提交先于处理**：某些客户端配置会把「取回一批消息」与「把这一批的位点提交掉」绑在一起（显式先 `commit` 再处理、或即时提交型自动提交，如 franz-go 的 `GreedyAutoCommit`；Java 客户端默认自动提交虽在两次 poll 之间，但处理被异步化/缓冲化后同样会踩中这个窗口）。notify 取回 10 条、位点已提交，却只处理了 3 条就崩溃——重启后从提交点继续，剩下 7 条通知永久缺失（丢）。再看「重」的姿势——**处理完未提交**：notify 改成手动提交且顺序是「先发通知、后提交位点」，同一时刻崩溃，这批消息没有提交，重平衡后重新投给另一个实例，用户收到两条一模一样的新订单通知（重）。两个方向你都看到了：**提交时机决定的是「崩溃的瞬间，把损失记在丢账上还是重账上」**。franz-go 默认的自动提交只提交「上一轮 poll 已处理完」的位置（详见[位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)），把「处理完未提交→重读」留作默认，把「提交先于处理→丢」变成需要显式选择的姿势——这是 at-least-once 被选为默认的原因。",
    },
    {
      type: "heading",
      text: "组合推理：四个旋钮决定端到端语义",
    },
    {
      type: "paragraph",
      text: "把上面三段压成一张组合表。为便于对照，先记住官方默认值（Kafka 4.3 文档）：生产者 `acks` 默认 `all`、幂等默认开启、重试次数默认极大（由 `delivery.timeout.ms` 兜底）；Java 消费者默认 `enable.auto.commit=true`、间隔 5 秒；franz-go 的组消费者默认也是每 5 秒自动提交，但只提交「上一轮已 poll 过」的位置（更窄的窗口，详见[位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)一课）。默认组合落在 at-least-once，这是厂商替你选好的安全起点。",
    },
    {
      type: "table",
      caption: "典型组合 → 得到的语义（生产端配置 × 消费端提交）",
      headers: ["组合", "生产端", "消费端", "得到的语义", "工程含义"],
      rows: [
        ["A（生产标配）", "acks=all + 有限重试 + 幂等开启", "处理成功后提交（或安全自动提交）", "at-least-once：Kafka 侧不丢，只可能重", "绝大多数业务的默认选择；副作用必须幂等，见[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)"],
        ["B（激进）", "同 A", "先提交后处理，或 Greedy 自动提交后崩溃", "at-most-once：崩溃窗口内的消息被跳过", "只在「消息丢了也无所谓」的场景用，如统计日志；业务系统慎用"],
        ["C（防御失效）", "acks=0/1；或 ISR 跌破 minISR 仍被绕过；或开启 unclean 选举", "无论怎么提交", "生产/Broker 段可丢；若还开着无幂等重试则「又丢又重」", "不是一种选择，而是配置事故——把故障演练打在测试环境验证你的防御"],
        ["D（内闭环）", "A + 事务（同一 transactional id 内多分区原子写）", "read_committed 消费，位点随事务提交", "exactly-once（仅限 Kafka 内部读写闭环）", "见下一课[事务与精确一次（Go / franz-go）](/courses/kafka/lessons/kafka-transactions-go)"],
      ],
    },
    {
      type: "paragraph",
      text: "组合 D 值得再抠一层：它只对「从 Kafka 主题读、处理、再写回 Kafka 主题」成立。为什么？因为事务能同时覆盖的只有「输出消息」和「消费位点」这两个 Kafka 内的写入。任何处理过程中的数据库更新、外部 API 调用，都发生在事务的视野之外——这一条边界是整门课最容易在面试和架构评审里翻车的点，下一节展开。",
    },
    {
      type: "heading",
      text: "exactly-once 拆解：幂等、事务与 read_committed 各管什么",
    },
    {
      type: "list",
      items: [
        "**幂等生产者**（第 3 章已讲，[可靠发布：acks、重试与幂等生产者](/courses/kafka/lessons/kafka-producer-reliability-acks)）：PID + 序列号让「网络重试」在 Broker 上不会落成两份。它消除的是**同一生产者会话内**由重试造成的重复，管不到跨会话、管不到消费端。",
        "**事务**：给一批跨分区的写入一个共同的结局——要么全部对 read_committed 消费者可见，要么全部不可见；并且消费位点（offset 提交）也作为这笔事务的一部分原子提交。它把「写结果」与「记进度」合并成一个动作，这正是组合 A 里互相打架的两个时刻。",
        "**read_committed 消费**：消费者把 `isolation.level` 设为 `read_committed`（默认是 `read_uncommitted`），只读到已提交事务的消息；被 abort 的事务留下的中间写入会按事务标记被过滤掉，未结束的进行中事务之后的消息还会被「最后稳定位点（LSO）」暂时压住，保证你永远不会看到半截事务。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "边界：事务只覆盖 Kafka 内部，覆盖不了你的数据库和下游 API",
      body: "常见误读是「上了事务 + read_committed，我的支付管道就端到端精确一次了」。错：结算逻辑里每写一次自己的数据库、每调一次下游 API，都是一次事务外的副作用。消费者 A 在事务里写了 `payment.results` 并提交，随后崩溃在「更新自己库表」之前——重投后这条结果会再算一遍，数据库被更新两次。Kafka 事务只保证 Kafka 内的两处写入同生共死。要让「外部世界」也只生效一次，唯一通用手段是把外部操作设计成**幂等**（幂等键/唯一约束，[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)给实现），或者先落库再异步发事件——事务性 [Outbox](glossary:outbox) 模式，第 6 章[事务性 Outbox、CDC 与事件溯源](/courses/kafka/lessons/kafka-outbox-cdc-es)专门讲。记住：Kafka 的[精确一次](glossary:exactly-once)是「读 Kafka 写 Kafka」语境内的承诺，出了这个圈，只能谈「有效一次」。",
    },
    {
      type: "heading",
      text: "面试陷阱：别再说「Kafka 保证不丢消息」",
    },
    {
      type: "callout",
      variant: "tip",
      title: "正确的回答结构（三段式）",
      body: "面试官问「Kafka 能保证不丢消息吗」，直接答「能」或「不能」都扣分。标准结构：第一段，拆链路——生产端丢不丢看 acks（0/1/all）与重试；Broker 段看 ISR、min.insync.replicas 与 unclean leader election 是否关闭；消费端丢不丢看提交时机（先提交后处理会丢，处理完未提交会重）。第二段，给默认结论——按官方默认配置（acks=all、幂等开、处理后提交/安全自动提交），Kafka 提供的是 at-least-once：已确认消息在「至少一个 ISR 存活」的前提下不丢，但消费端崩溃会带来重复。第三段，补 exactly-once 的边界——只在 Kafka 内读-处理-写闭环内，由幂等生产者 + 事务 + read_committed 保证；对外部系统只能靠幂等键或 Outbox 做到有效一次。这样答，三段归属、默认值、范围限定全有了。",
    },
    {
      type: "quiz",
      question: "面试官问：「听说 Kafka 保证消息不丢，是真的吗？」以下哪个回答框架最准确？",
      options: [
        "是真的——Kafka 靠多副本机制保证任何已确认消息都不会丢失，这是它和 RabbitMQ 的本质区别",
        "默认就能保证：只要生产者配了 acks=all，从生产到消费整条链路就不丢消息了",
        "不能一概而论：丢/重分别发生在生产者（acks/重试）、Broker（ISR/minISR/unclean 选举）、消费者（提交时机）三段，默认配置（acks=all + 幂等 + 处理后提交）给出的是 at-least-once；exactly-once 只在 Kafka 内部读-处理-写闭环成立，外部系统要靠幂等键或 Outbox",
        "能保证，前提是消费者全部改为手动提交，否则自动提交一定会丢消息",
      ],
      answer: 2,
      explanation:
        "三种语义是「分段配置的乘积」而不是某个单一开关：生产端和 Broker 端决定丢不丢（acks、ISR、minISR、unclean），消费端提交时机同时决定丢（提交太早）与重（提交太晚）。默认组合是 at-least-once；exactly-once 是幂等生产者 + 事务 + read_committed 组合拳，且只对 Kafka 内部闭环成立——选项 3 完整覆盖了这三个层次。",
    },
    {
      type: "keypoints",
      items: [
        "三种语义是相对「某条链路」的承诺：丢与重分别归因到生产者→Broker、Broker 副本、Broker→消费者三段",
        "at-most-once 的两个来源：生产者发送前放弃（acks=0/不重试），或消费端先提交后处理",
        "at-least-once = acks=all（+minISR 保险丝）+ 重试 + 处理完再提交；是官方默认与生产标配",
        "min.insync.replicas 被击穿时写入报错而不是悄悄丢；unclean 选举默认关闭，开它等于用已确认数据换可用性",
        "exactly-once = 幂等生产者 + 事务 + read_committed，且只在 Kafka 内闭环成立；外部副作用只能靠幂等键或 Outbox 做到「有效一次」",
        "面试回答三段式：分段归因 → 默认 at-least-once → exactly-once 的范围限定",
      ],
    },
  ],
};
