/* ==================================================================
 * 课时：副本、ISR 与数据安全（kafka-replication-isr）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Apache Kafka 4.3（主线 4.3.1，KRaft-only）。
 * Go 示例以 franz-go v1.21.x（pkg/kgo）为准。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "同一分区的多份副本是 Kafka 的数据安全底座：写入只走 leader、ISR 决定谁能接任、min.insync.replicas 与 unclean 选举决定宕机时是拒绝写入还是冒险续命。",
  blocks: [
    {
      type: "paragraph",
      text: "前两课回答了「数据怎么组织、怎么落盘、怎么过期」，但还欠一个问题：磁盘会坏、机器会宕、机房会断——这些文件凭什么不丢？答案是 [副本](glossary:replica)：同一个分区在多台 broker 上各存一份，任何单点失效都不影响数据。这一课把副本协议讲清楚，重点不是命令而是三个数字的关系：副本数（replication factor）、ISR 大小、以及客户端确认级别，它们共同决定「宕机时系统宁可拒绝写入，还是冒险继续」。",
    },
    {
      type: "heading",
      text: "leader 与 follower：写入只走一条路",
    },
    {
      type: "paragraph",
      text: "Kafka 的复制单位是**分区**而不是主题：主题建了几个分区，每个分区就各自复制 `--replication-factor` 份（RF）。RF=3 意味着分区的数据同时存在 3 台 broker 上——官方运维文档的表述是：RF=3 时最多可容忍 2 台服务器失效而不失去对数据的访问（写入可用性还受 ISR 与 min.insync.replicas 约束，见后文）；RF=1 就是单副本——官方实现里「不复制」只是把复制因子设成 1，没有任何特殊待遇，磁盘一坏数据就没了。同一分区多份副本中，一台是 **leader**，其余是 **follower**：",
    },
    {
      type: "list",
      items: [
        "**所有写入都发给 leader**。客户端（生产者）向 broker 要元数据，拿到「哪个 broker 是这个分区的 leader」后直接把请求发过去；follower 不接收客户端写入。普通消费者的读取同样发往 leader。",
        "**follower 是「特殊消费者」**：它像普通消费者一样从 leader 拉取（pull）消息，按相同顺序追加到自己的日志——官方设计文档说得很直白：follower 从 leader 消费消息，就像普通 Kafka 消费者那样，这种拉取模型让 follower 天然能把日志条目批量化。",
        "follower 的日志与 leader 必须逐字节对齐（同 offset 同内容），只是任一时刻 leader 尾部可能多几条还没被拉走的消息。",
      ],
    },
    {
      type: "paragraph",
      text: "为什么不让客户端同时写多个副本？因为「写到一半、另一个副本先挂了」时，多副本同时写没法决定谁是权威。Kafka 选择 leader 定序（leader 决定每条消息的 offset 与顺序），follower 复制——这是复制协议里最简单、最快的一族，代价是 leader 本身成为单点，于是需要下面这套「谁够格接班」的机制。",
    },
    {
      type: "definition",
      term: "副本集与角色",
      definition: "一个分区在哪些 broker 上各存一份，构成它的副本集（replicas），其中恰好一个 leader、其余 follower。副本集在主题创建时按 broker 列表分配（如 Replicas: 1,2,3），同一分区的副本不允许落在同一台 broker 上——否则那台机器一挂就是双副本同时失效。",
    },
    {
      type: "heading",
      text: "ISR：谁是有资格接班的 follower",
    },
    {
      type: "paragraph",
      text: "副本不是「存在就够」，而是「跟得上才算数」。官方设计文档把 broker 存活性拆成两个条件：一是与集群保持活跃会话（KRaft 模式下周期性向 controller 心跳，超时按 `broker.session.timeout.ms` 判定下线）；二是作为 follower 持续从 leader 复制、**不能落后太多**。两个条件同时满足的副本集合叫 [ISR](glossary:isr)（In-Sync Replicas，同步副本）。leader 实时维护 ISR：follower 死亡（会话丢失）会被移出；follower 活着但拉取进度长期落后，也会被移出——落后判定的参数是 **`replica.lag.time.max.ms`（默认 30 秒）**：一个 follower 超过该时长没有发来 fetch 请求、或始终没追上 leader 的日志末端（log end offset），leader 就把它踢出 ISR。落后恢复后 follower 重新追平，会被加回 ISR。",
    },
    {
      type: "code",
      title: "ISR 收缩与恢复（示意）",
      language: "text",
      code: "RF=3，副本分布在 broker 1（leader）/2/3：\n\n正常：        ISR = {1, 2, 3}      每次写入三份都落盘\n\nbroker 3 宕机或网络分区（超过 replica.lag.time.max.ms=30s 无进展）：\n              ISR = {1, 2}        写入继续，只保证 1、2 两份落盘\n\nbroker 3 恢复并追平日志：\n              ISR = {1, 2, 3}      回到三份\n\nleader 宕机时：controller 从 ISR 里挑一个新 leader（如 broker 2），\n并在集群元数据中持久化 ISR 变化——新 leader 一定拥有全部已确认消息。",
    },
    {
      type: "paragraph",
      text: "ISR 之所以是数据安全的核心，是因为 Kafka 的提交规则围着它转：**一条消息只有复制到「当时 ISR 里的全部副本」才叫已提交（committed），已提交消息才会对消费者可见**。反过来，只要任一时刻至少有一个 ISR 副本存活，已提交的消息就不会丢（官方设计文档的原话）。把「谁在 ISR 里」持久化进元数据，保证了另一个关键性质：**只有 ISR 成员能当选新 leader**——新 leader 是从 ISR 里选的，而 ISR 里每个副本都拥有全部已提交消息，所以 [首领选举](glossary:leader-election) 不会把已确认的数据选丢。若 ISR 缩到 0（所有同步副本都失效），分区进入「无合格继任者」状态，此时可用性由 unclean 开关决定（下一节）。",
    },
    {
      type: "heading",
      text: "观察：describe 输出里的 Leader / Replicas / Isr",
    },
    {
      type: "code",
      title: "kafka-topics.sh --describe 的分区行",
      language: "text",
      code: "kcli kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic orders.events\n\nTopic: orders.events  TopicId: xxx  PartitionCount: 12  ReplicationFactor: 3  Configs:\n    Topic: orders.events  Partition: 0  Leader: 1  Replicas: 1,2,3  Isr: 1,2,3\n    Topic: orders.events  Partition: 1  Leader: 2  Replicas: 1,2,3  Isr: 1,2,3\n    ...\n\n（上例按书舟生产设计值展示：12 分区、RF=3，副本分布在节点 1/2/3）\n\n三列对照本节概念：\n  Leader    当前谁是 leader（客户端写入与读取都找它）\n  Replicas  主题创建时分配的全部副本（不会自己变，除非人工重分配）\n  Isr       此刻真正跟上 leader 的副本（会动态收缩与恢复）\n\nReplicas 是「应该有几份」，Isr 是「现在有几份够格」——\n两者不一致（如 Isr: 1,2 而 Replicas: 1,2,3）就是集群在报警的典型信号。",
    },
    {
      type: "paragraph",
      text: "对照第 1 章在本地单节点环境（[本地运行 Kafka 4.3（KRaft）与 CLI 初体验](/courses/kafka/lessons/kafka-kraft-quickstart)）里跑的 describe，你看到的是每个分区一行 `Leader: 1  Replicas: 1  Isr: 1`（数值是节点 id）：RF=1 时副本集里只有那一个 broker，ISR 就只有它——复制根本没发生，ISR 概念退化成「单点」，三列恒等。想亲眼看 ISR 收缩与 leader 切换，至少要起两个 broker 的集群（比如给同一台机器配两个 broker 进程、目录分开），然后把某个分区的 leader 所在 broker 停掉，describe 会看到 Leader 换成另一个、而 Isr 缩到只剩新 leader。",
    },
    {
      type: "heading",
      text: "数据安全组合：RF、min.insync.replicas 与 acks",
    },
    {
      type: "paragraph",
      text: "有了副本与 ISR，还要回答一个精度问题：**写入「成功」到底以什么为准？** 如果 leader 落盘就回成功，而消息还没复制到 follower，此时 leader 宕机，新 leader（从 ISR 选）并没有这条消息——写入方以为成功了，数据却没了。Kafka 把选择权交给生产者：客户端配置 [确认级别](glossary:acks)（acks=0/1/all，本课先立住 broker 侧，客户端细节下一章 [可靠发布](/courses/kafka/lessons/kafka-producer-reliability-acks) 展开）。acks 只约束「leader 等谁回执」，而 broker 侧还有一个反向保险丝：**[min.insync.replicas](glossary:min-insync)**——当 ISR 数量低于它时，`acks=all` 的写入会被直接拒绝。",
    },
    {
      type: "list",
      items: [
        "`acks=1`：leader 本地落盘即算成功——最快，但 leader 未及复制就宕机时会丢这条「已确认」消息。",
        "`acks=all`：等**当前 ISR 全部落盘**才算成功——注意是「ISR」，不是「副本集」：某个 follower 掉出 ISR 后，acks=all 不再等它。",
        "`min.insync.replicas`（broker 默认 1）：ISR 数量低于此值时，acks=all 的写入报错（NotEnoughReplicas 类错误）——宁可让写入失败，也不让「已确认」的数据只悬在一份副本上。",
      ],
    },
    {
      type: "paragraph",
      text: "三者组合出书舟的生产标准姿势：**RF=3 + min.insync.replicas=2 + acks=all**。官方文档把这称为典型场景：多数派副本必须先持久化，写入才算成功并对消费者可见。拆开读它的含义：正常情况下 ISR={1,2,3}，acks=all 要等三份都落盘（比 min.insync.replicas 更严格）；一台 broker 宕机后 ISR 缩到 {1,2}，写入继续（2 ≥ 2）；再宕一台、ISR 只剩 1 个时，acks=all 的新写入开始被拒绝——**此刻系统选择「拒绝写入」而不是「冒险把已确认消息只压在最后一份副本上」**。这就是 min.insync.replicas 的价值：它把「丢已确认数据」从可能的静默事故，变成「可见的写入失败」，让业务方知道要降级，而不是蒙在鼓里。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "单副本集群：把风险看明白再睡",
      body: "RF=1 时 ISR 永远只有一个成员，min.insync.replicas 设 2 会让所有 acks=all 写入直接失败——它保护不了任何东西。单副本意味着：磁盘损坏=该分区数据全部且永久丢失（没有第二份可追）；broker 滚动重启维护的窗口里，写入或读取会中断；机房断电恢复后还要祈祷文件系统没坏。开发环境可以 RF=1（第 1 章的单节点），生产环境请把它当成「数据没有备份」的同义词。",
    },
    {
      type: "heading",
      text: "unclean leader election：可用性还是数据安全",
    },
    {
      type: "paragraph",
      text: "最坏的情况来了：**ISR 全部失效**——三副本里两台磁盘损坏、最后一台也宕机，或整个机房断网。此时没有任何 ISR 成员可接班，分区不可写。怎么办？官方设计文档给出两条路：",
    },
    {
      type: "list",
      items: [
        "**等**：等某个 ISR 副本回来，选它当 leader——期间分区持续不可用，但如果 ISR 副本是永久损坏，分区就永久不可用；换来的是「已确认消息一条不丢」。",
        "**将就**：允许不在 ISR 里的副本（可能落后于 leader 的任意副本）先回来先当 leader——分区快速恢复可用，但那个副本缺了 leader 尾部几条消息，它一旦当上 leader，**那些「已对客户端确认过」的消息就永远消失了**：它的日志成为新的真相，落后于它的部分被截断。",
      ],
    },
    {
      type: "paragraph",
      text: "这就是 [unclean leader election](glossary:unclean-election)（不洁首领选举）开关的取舍：可用性 vs 一致性。Kafka 默认关闭它（`unclean.leader.election.enable` 默认 false，topic 级可覆盖）——从 0.11 起官方默认选择「等一致副本」，即**宁可分区不可用，也不冒丢已确认消息的险**。KRaft 模式还有一个运维细节：动态开启该配置后，unclean 选举线程按周期（默认 5 分钟）触发检查，想立刻生效可用 `kafka-leader-election.sh` 指定 unclean 选举类型手动触发。",
    },
    {
      type: "callout",
      variant: "note",
      title: "丢的是「已确认」，不是「已发送」",
      body: "unclean 选举丢掉的，是曾经对生产者确认成功、但只存在于已失效 leader 上的消息——它们没有复制到任何活着的副本。acks=1 的写入最容易处于这种状态（只等 leader 落盘）；acks=all + min.insync.replicas=2 时，任何「已确认」消息都同时存在过至少 2 个副本上，丢失窗口被大幅压缩——但它仍然不为零：如果确认过消息的那几份副本恰好全部永久损坏，而唯一幸存的副本是当时没同步到那条消息的落后副本，unclean 选举照样会截掉它。「已发送但未确认」的消息在任何方案下都可能丢，那是生产者重试的职责范围。",
    },
    {
      type: "heading",
      text: "把书舟的设定推到故障里走一遍",
    },
    {
      type: "paragraph",
      text: "书舟生产设定：**RF=3、min.insync.replicas=2、unclean.leader.election.enable=false、客户端 acks=all**。逐个场景推演会发生什么（假设同一分区的 3 个副本分别在 broker A/B/C，初始 ISR={A,B,C}）：",
    },
    {
      type: "table",
      caption: "三副本设定下的故障推演",
      headers: ["故障场景", "ISR 变化", "写入可用性", "已确认数据"],
      rows: [
        ["单台 broker 宕机（如 A，恰好是 leader）", "ISR 缩到 {B,C}；controller 从 ISR 选新 leader（优雅停机时 leader 会先让位，中断窗口更小）", "继续：ISR 大小 2 仍满足 min.insync.replicas=2", "不丢：新 leader 在 ISR 内，拥有全部已确认消息"],
        ["两台 broker 同时宕机（A、B）", "ISR 缩到 {C}（或 0，取决于 C 是否还活着）", "ISR=1 < min.insync.replicas=2：acks=all 的新写入被拒（NotEnoughReplicas）；若 C 活着可继续读", "不丢：已确认消息都至少在两份副本上，最后一份 C 还在"],
        ["磁盘损坏且不可恢复", "若坏的是 leader 或唯一在 ISR 的副本，其余副本可能都不在 ISR", "unclean=false：等待 ISR 副本恢复；若 ISR 成员永久损坏，分区永久不可用——这是「宁可不可用也不丢」的代价", "不丢（但服务不可用）；若此刻打开 unclean=true，可用性恢复，代价是可能截断丢失已确认消息"],
      ],
    },
    {
      type: "paragraph",
      text: "这张表的规律一句话：**min.insync.replicas 把「悄悄丢已确认数据」变成「可见的写入失败」，unclean=false 把「可见的写入失败」变成「等 ISR 恢复」**。两次选择都在用可用性换确定性。书舟选这套组合的理由：订单支付类数据丢了没法向客户交代，短暂的写入降级（队列积压、触发限流告警）远比静默丢单可接受。",
    },
    {
      type: "quiz",
      question: "书舟某主题配置 RF=3、min.insync.replicas=2。某时刻一台 broker 宕机后 ISR 只剩 1 个成员，此时生产者用 acks=all 写入一条新消息，会发生什么？",
      options: [
        "正常成功：acks=all 只要求 leader 落盘即可",
        "写入被拒绝并报错（NotEnoughReplicas 类错误），因为 ISR 数量低于 min.insync.replicas=2",
        "写入成功，但只记在内存里，等 ISR 恢复后再落盘",
        "broker 自动把副本数临时补到 3 再确认写入",
      ],
      answer: 1,
      explanation: "acks=all 时，ISR 必须同时满足「每个 ISR 成员都落盘」和「ISR 数量 ≥ min.insync.replicas」两个条件；ISR=1 < 2 时写入被拒绝（官方错误为 NotEnoughReplicas 或 NotEnoughReplicasAfterAppend）。这正是 min.insync.replicas 作为保险丝的行为：宁可让这次写入失败、让业务方感知降级，也不把已确认数据只压在单份副本上。",
    },
    {
      type: "keypoints",
      items: [
        "复制单位是分区：RF=N 即有 N 份；写入与客户端读取只走 leader，follower 作为特殊消费者从 leader 拉取",
        "ISR = 活跃会话 + 跟得上复制的副本；落后超 replica.lag.time.max.ms（默认 30 秒）即被踢出，追平后回归",
        "只有 ISR 成员能当选 leader；ISR 变化持久化到元数据，保证新 leader 拥有全部已确认消息",
        "RF=3 + min.insync.replicas=2 + acks=all：多数派先持久化才算成功；ISR 跌破 2 时拒绝写入，宁失败不丢已确认数据",
        "unclean leader election（默认关）：开=ISR 全灭时快速恢复但可能丢已确认消息，关=保数据但分区可能长时间不可用",
        "Replicas 是应然、Isr 是实然：describe 里两者不一致（UnderReplicated）是首要告警信号",
      ],
    },
  ],
};
