/* ==================================================================
 * 课时：面试速查：可靠性语义问答（kafka-interview-reliability）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 11 章第二课：acks/ISR/幂等/事务/exactly-once 边界、积压与重复
 * 消费场景题的「口述回答框架」。全部来自第 2–5 章正文。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "可靠性语义类面试题的回答框架：acks 三档与丢窗口、minISR=1 意味着什么、幂等边界、事务与 exactly-once 对外边界、lag 暴增排查、重复消费的幂等设计、不丢消息的完整答法，加事故归因辨析。",
  blocks: [
    {
      type: "heading",
      text: "这一课怎么用",
    },
    {
      type: "paragraph",
      text: "上一课把[核心机制](/courses/kafka/lessons/kafka-interview-core)的口述框架过了一遍；本课专攻全课程最容易翻车的主题——**可靠性语义**。这些题有一个共同特征：答案的分数不在「背出术语」，而在**边界**——每个机制能保证什么、不能保证什么、窗口在哪里。所以本课框架大量使用「丢窗口」「重启后」「对外部系统」「默认值」这类限定词，口述时一个都不能少。老规矩：**先自答再对照**；答不严的地方点开**关联课时**重读，最后用[总复习测验](/courses/kafka/lessons/kafka-final-checkpoint)收口。答题前默念上一课的三条习惯：拆段、给默认值、主动划边界。",
    },
    {
      type: "callout",
      variant: "note",
      title: "可靠性题的通用心法：盯住「窗口」而不是「开关」",
      body: "可靠性面试题本质上都在问同一个问题：**在哪个时间窗口内、出了什么故障、会丢或重多少**。acks 问的是「成功返回后到副本追上之间 leader 挂了怎么办」；幂等问的是「PID 换了之后重发还能不能认出同一批」；提交问的是「处理完与提交之间的窗口崩溃了往哪边倒」。口述时把每个机制的答案都组织成「机制 → 窗口 → 边界」三件套，就不会答成空泛的「Kafka 很可靠」。",
    },
    {
      type: "heading",
      text: "Q1. acks=0/1/all 各自的丢数据窗口是什么",
    },
    {
      type: "paragraph",
      text: "这是可靠性第一题，标准开头是一句话定义：[acks](glossary:acks)（确认级别）回答「broker 确认到什么程度，我才算这条消息发出去了」，然后逐档给语义 + 精确的丢窗口，最后带默认值收口。判断每档的直觉工具是一句问话：**成功返回之后，还有没有可能丢？**",
    },
    {
      type: "list",
      items: [
        "**acks=0（NoAck）**：broker 不回响应，请求写出即视为完成。丢窗口：几乎一切——网络中断、broker 宕机、leader 切换，失败无从知晓，也没有确认可等。只适合「丢得起」的遥测/采样，Kafka 业务里极少用。",
        "**acks=1（LeaderAck）**：leader 把记录追加进自己的日志（页缓存）即回成功，不等任何副本。丢窗口：**leader 在其它 ISR 副本追上之前宕机或切换**——新 leader 没有这批记录，这条「已确认」消息随之消失。窗口大小 ≈ 副本复制的滞后时间。",
        "**acks=all（AllISRAcks，线值 -1）**：当前 ISR 的每个成员都追加进日志后才回成功。丢窗口收窄到两个：**整个 ISR 同时失效**（如同机房断电且日志未刷盘）；或**开了 unclean leader election** 选出缺数据的副本。",
        "**收口**：franz-go 默认就是 all（`kgo.RequiredAcks` 默认 AllISRAcks），Java 客户端默认也是 all——厂商默认选「成功 = 已按 ISR 复制」，这是 at-least-once 的生产端基础。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① acks 是「落盘复制确认」，不是「送达消费者」——说成后者整个语义链条就歪了。② acks=0 不是「异步发送」的同义词——异步是指客户端不等结果继续发，acks 是指 broker 要不要回执，两个维度别混。③ 说「acks=1 是等 leader 刷盘」要小心：broker 追加进**页缓存**即回成功，刷盘由 OS 决定——所以连「磁盘损坏未刷盘」也是 1 与 all 共有的极小窗口。④ 数字记牢：0 / 1 / -1（all）。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[可靠发布：acks、重试与幂等生产者](/courses/kafka/lessons/kafka-producer-reliability-acks)（三档表格与典型场景）。",
    },
    {
      type: "heading",
      text: "Q2. acks=all 但 min.insync.replicas=1，意味着什么",
    },
    {
      type: "paragraph",
      text: "组合推理题，考你是否真的理解两个参数的分工：**acks=all 等的是「当前 ISR 全体」；min.insync.replicas 是 broker 侧的下限保险丝——ISR 数量低于它时拒绝 acks=all 写入**。把两句话叠起来就能推出 minISR=1 的含义。",
    },
    {
      type: "list",
      items: [
        "**结论**：当 ISR 收缩到只剩 1 个成员（通常是 leader 自己）时，acks=all 的写入**依旧成功**——因为 1 ≥ minISR=1，保险丝没触发。此时「已确认」消息只存在于单份副本上。",
        "**为什么不安全**：这唯一的一份副本随后宕机或磁盘损坏，全部已确认消息永久丢失，且没有第二份可追——acks=all 的名义保证在这一刻完全落空。minISR 存在的意义就是把这种「悄悄丢」变成「显式拒绝写入」，设 1 等于把这个保险丝拆了。",
        "**边界澄清**：minISR=1 是 broker 的默认值（单节点与新手集群都是它），所以「主题 rf=3 + minISR=1 + acks=all」在多数集群里其实是默认状态——它只在 ISR 完整时安全，退化到单副本确认时系统不会拦你。",
        "**正确姿势**：生产 rf=3 配 minISR=2 + acks=all——多数派先持久化才算成功；ISR 跌破 2 时写入被拒（NotEnoughReplicas(AfterAppend)，可重试），业务方收到显式失败而知道要降级。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 凭直觉认为「acks=all 就是要所有副本都确认，所以安全」——all 的边界是当前 ISR，ISR 缩到 1 时 all 只等 1 份，minISR 若没拦住就单点确认。② 以为 minISR 默认是 2——broker 默认 1，生产姿势（2）是要**主动配置**的。③ 把 rf=1 的主题与「minISR=2」混配：ISR 永远只有 1 个成员，所有 acks=all 写入会全部被拒——保险丝救不了没有副本可等的数据。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[副本、ISR 与数据安全](/courses/kafka/lessons/kafka-replication-isr)（minISR 与 acks 联动的原理解读）、[可靠发布](/courses/kafka/lessons/kafka-producer-reliability-acks)（「all 等 ISR 全体而非副本总数」的展开）。",
    },
    {
      type: "heading",
      text: "Q3. 幂等生产者能防什么？进程重启后还成立吗",
    },
    {
      type: "paragraph",
      text: "幂等是面试高频且边界最容易被说破的题。回答顺序：机制（防什么）→ 作用域（防到哪为止）→ 重启场景推演（边界在哪）→ 与 exactly-once 的关系。",
    },
    {
      type: "list",
      items: [
        "**机制**：[幂等生产者](glossary:idempotent-producer)用 PID + 分区序列号去重：客户端首次生产时向 broker 要一个生产者 ID（PID），此后发给每个分区的批次带单调递增序列号；broker 为每个 (PID, 分区) 保留最近序列号窗口——收到重复序列号（网络重试的重发）就跳过不重复写，收到跳跃序列号就拒绝后续批次直到缺口补上。**它消除的是「网络假失败 → 客户端重试 → 同一条被写两次」**；正因为有它，客户端才敢放心重试。",
        "**前提**：幂等与重试是配套的——没有重试就没有重复可去重；franz-go 默认幂等开启且强制 acks=all（改成非 all 直接报错）。",
        "**作用域**：PID 的生命周期是**一个客户端实例/进程会话**。进程重启 = 新客户端 = 重新 InitProducerID = 新 PID，broker 的去重窗口随之重置。同一个业务事件若旧进程已写入、新进程又发一次（典型：按「没收到确认」做了重启补偿），broker 无法识别，**会重复落盘**——幂等不跨进程、不跨重启。",
        "**收口**：幂等保证的是「单生产者会话内、网络重试不产生重复」；它不是防丢手段（防丢靠 acks+副本），也不等于 exactly-once——后者 = 幂等 + [事务](glossary:transaction) + read_committed 的组合拳，跨进程/跨系统的「不重」要靠幂等键。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 说「幂等生产者保证消息不丢」——它只去重，防丢的是 acks 与副本。② 说「进程重启后重发会被 broker 去重」——不会，PID 变了窗口重置；面试官追问「那重启补偿怎么防重」的正确答案是：业务幂等键（消费端/落库去重），或事务。③ 把「关闭幂等 + 多 in-flight」说成无损调优——那是经典事故配方：重试重复写入 + 后批先到导致分区内乱序（第 3 章复盘剧本）。④ 忘了补一句 franz-go 默认即开启幂等（Java 客户端默认也开启）。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[可靠发布：acks、重试与幂等生产者](/courses/kafka/lessons/kafka-producer-reliability-acks)（PID+序列号机制与重启边界、事故复盘）。",
    },
    {
      type: "heading",
      text: "Q4. 事务与 exactly-once：为什么对外部系统只能「有效一次」",
    },
    {
      type: "paragraph",
      text: "这是全课程最容易被一句话带偏的题。完整答案要回答三个层次：exactly-once 在 Kafka 里到底指什么范围、为什么这个范围出不去、出去之后用什么替代。",
    },
    {
      type: "list",
      items: [
        "**范围**：Kafka 的[精确一次](glossary:exactly-once) = 幂等生产者 + [事务](glossary:transaction) + read_committed 消费，且只在**「从 Kafka 主题读、经处理、再写回 Kafka 主题」的内部闭环**内成立。事务解决的是两个写入点——「输出消息」与「消费位点提交」——的原子性：要么一起对 read_committed 消费者可见，要么一起回滚，重复与丢失在 Kafka 内部同时消失。",
        "**为什么出不去**：任何处理过程中的**数据库更新、外部 API 调用都发生在事务视野之外**——Kafka 事务只能原子地写 Kafka，不能原子地写你的 MySQL 或对方的 HTTP 服务。消费者在事务里写完 `payment.results` 后崩溃在「更新自己库表」之前，重投后结果会再算一遍，数据库被更新两次。跨 Kafka 与数据库做分布式事务不现实（两阶段提交的成本与可用性代价），所以系统层面不存在「事务帮你覆盖外部副作用」这回事。",
        "**替代手段（对外部只能有效一次）**：把外部操作设计成**幂等**——落库用业务表唯一键（`ON CONFLICT DO NOTHING`）、调用下游时带上业务幂等键由对方去重；或先在同一数据库事务里写业务 + 待发事件表，再让独立 relay 发布到 Kafka——[事务性 Outbox（outbox）](glossary:outbox) 模式（第 6 章）。",
        "**追问防身**：被问「事务里能调外部 API 吗」——不能：外部调用不可回滚、还拖长事务（超过 `transaction.timeout.ms` 会被协调器 abort，还卡住 read_committed 下游直到事务结束）。外部副作用请在事务提交**之后**再触发，并做成幂等。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 把「上了事务 + read_committed」说成「端到端精确一次」——漏了「只在 Kafka 内闭环」这个范围限定，这是面试里最致命的过度承诺。② 把「有效一次」（幂等键/唯一约束下外部只生效一次）与「精确一次」（Kafka 内闭环的协议级保证）混为一谈——前者是工程手段，后者是语义承诺，要分开口述。③ 以为事务能跨服务协调业务流程——事务边界只在一个进程/一个 TransactionalID 内，跨服务靠事件与幂等。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[投递语义](/courses/kafka/lessons/kafka-delivery-semantics)（exactly-once 拆解与对外边界的原文）、[事务与精确一次（Go / franz-go）](/courses/kafka/lessons/kafka-transactions-go)（TransactionalID/epoch/read_committed 与「什么时候不要用事务」）、[事务性 Outbox、CDC 与事件溯源](/courses/kafka/lessons/kafka-outbox-cdc-es)。",
    },
    {
      type: "heading",
      text: "Q5. 什么时候该上事务，什么时候 at-least-once + 幂等就够了",
    },
    {
      type: "paragraph",
      text: "决策题。面试官真正的考察点是你是否知道事务**有成本、有边界**，而不是「会用就到处用」。回答给一条判断标准 + 一份成本清单 + 一个标尺。",
    },
    {
      type: "list",
      items: [
        "**判断标准**：上事务的唯一理由是「读 Kafka、写 Kafka 的**两处状态必须同生共死**」——典型如结算管道：消费位点与结算结果事件要一起推进，任何一处单独成功都会造成重复结算或漏结算。",
        "**不该上的场景**：处理结果主要落在**外部系统**（数据库/API/第三方）——事务给不了端到端保证，反而赔上吞吐与复杂度，此时 at-least-once + 幂等消费或 Outbox 更划算；消息价值低、丢几条无所谓的日志型管道；需要多个服务协作的跨服务业务流程（事务边界在一个进程内）。",
        "**成本清单**（说明你清醒）：每次提交要走事务协调器的两阶段收尾、在每个参与分区写事务 marker——比普通批量生产多肉眼可见的往返与写放大，吞吐下降；**长事务卡 read_committed 下游**（可见范围截止最后稳定位点）；超时与不确定结局需要按「TryAbort 收敛/重建客户端」的规范处理。",
        "**收口标尺**：账务、库存、支付结果这类「算错一次就要赔钱」的 **Kafka 内闭环**，值得；其余先问一句「消费端幂等能不能解决」——能解决就别上事务。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 给纯日志/行为事件管道也上事务——为用而用，成本远大于收益。② 以为事务能替代幂等消费——即使上了事务，重投窗口（协调器故障、结局不确定、abort 后重投）仍存在，实践中事务管道外通常还要幂等键双保险。③ 把「组自动提交」与「事务提交位点」混着开——事务管道的位点随事务提交，franz-go 会自动禁用组自动提交，别自己再开一套提交逻辑。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[事务与精确一次](/courses/kafka/lessons/kafka-transactions-go)（示例、常见坑与决策 callout）、[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)。",
    },
    {
      type: "heading",
      text: "Q6. 线上 lag 突然暴增，你的排查顺序是什么",
    },
    {
      type: "paragraph",
      text: "运营题的标准答法是**先分方向、再看分布、后查健康**——最忌讳一上来就「加消费者」。因为 lag 增长的根因只有两大类：生产变快（进来了更多）或消费变慢（处理不过来了），而消费变慢又分「整体慢」与「个别分区慢」，处置手段完全不同。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**第一步 · 对齐时间与方向**：lag 是何时开始涨的？与发布、大促、下游变更的时间点对齐；同时看生产速率（活动流量/BytesIn 有没有涨）——如果生产没涨，问题就在消费端；生产涨了，先判断这是不是一次性的峰值积压（处理速率能追上，追完即平）。",
        "**第二步 · 看 lag 的分布形状**：**所有分区一起涨** → 消费者整体吞吐下降（下游依赖变慢、刚发布的代码变慢、poll 循环被阻塞、组在频繁再平衡）；**个别分区独高** → 热点 key 倾斜（某 key 流量全压一个分区，该分区同刻只有一个消费者在跑）或该分区数据异常——此时加分区/加实例都无效，要先治倾斜。",
        "**第三步 · 查消费者健康信号**：失败与重试计数（下游限流/抖动引发的瞬态风暴？）、死信计数（有永久坏消息？）、错误日志（毒消息在无限重试？队头阻塞？）、再平衡频率（成员频繁进出会让消费反复停顿）。判断口诀：lag 涨 + 重试涨 = 瞬态风暴，看下游依赖；lag 正常 + 死信涨 = 坏消息等人处理；lag 涨 + 死信不涨 + 无错误 = 消费者卡死或毒消息无限重试，去看 poll 循环与代码。",
        "**第四步 · 处置顺序**：先**止血**——恢复下游依赖/回滚刚发布的代码/把毒消息限次重试后进死信让分区前进；单分区热点靠拆 key 或改 key 设计，不是加机器；再**追赶**——积压是追赶得上的就用正常速率追（追平时注意消息仍按序处理、消费端幂等吸收可能的重复）；追不上才考虑临时扩容（多分区主题可加消费者实例）。",
        "**收口**：区分「一次性积压」（处理速率 > 生产速率，追完即平）与「结构性 lag」（处理速率持续 < 生产速率，越积越多）——后者要治吞吐根因，前者只需等待并监控追平过程。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 不提「先确认源头是生产还是消费」直接加消费者——主题只有 4 个分区时加再多实例也白搭（并行上限 = 分区数）；热点分区加实例同样无效。② 把「消费者修复后积压清空」当事故——追平是正常收敛，注意别在那期间重复处理（幂等兜底）。③ 只盯 lag 平均值不看分布——平均值掩盖「一个分区爆掉、其余空闲」的倾斜。④ 忘了 lag 的另一面：数据还在保留期内追得回；若积压超过保留期，最早的消息会被清理，重放都不行——这就是为什么 lag 告警阈值要在保留期前很远（第 9 章监控课）。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)（判读规则三连）、[观测：指标、日志与消费滞后](/courses/kafka/lessons/kafka-monitoring-lag)（lag 定义与告警分层）、[排障手册](/courses/kafka/lessons/kafka-troubleshooting)（lag 增长/消费不动的完整原因树）。",
    },
    {
      type: "heading",
      text: "Q7. 消息重复消费了，怎么办（幂等设计的回答结构）",
    },
    {
      type: "paragraph",
      text: "这道题的完整答案分三步：**接受 → 修根因 → 幂等兜底**。很多候选人只答最后一步（上唯一键），显得没想清楚重复从哪来；只答根因（改提交时机）又漏了 at-least-once 下重复永远无法根除的事实。三步都讲才完整。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**第一步 · 接受重复是常态**：在 at-least-once 语义下（默认配置），重复有三个固定来源——**提交前崩溃**（处理完未提交，重启重读）、**再平衡交接**（接手成员从最后提交点重读，revoke 时补提交只能缩小尾巴）、**人工/自动重放**（修 bug、死信重放）。这些不是 bug，是「不丢」换来的代价，只能靠幂等吸收，无法根除。",
        "**第二步 · 修根因（减少重复面）**：确认提交时机是「处理成功后再提交」而不是先提交；注册 `OnPartitionsRevoked` 在交还分区前补最后一次提交；避免激进自动提交模式（那会把重复变成丢失）。根因修好，重复窗口缩到最小，但依然不为零。",
        "**第三步 · 让处理动作幂等（吸收剩余重复）**：三种落地——① **业务表唯一键**：处理 = 插入一行时给业务键（如 `order_id`）加唯一约束，`INSERT ... ON CONFLICT DO NOTHING`，`RowsAffected()==0` 即已处理过，直接当成功；② **处理记录表 + 同库事务**：一次处理要改多张表或写入不天然幂等时，先插「已处理事件」记录再执行业务写，两者在同一数据库事务里提交——事务回滚记录也没了，重投可放心重做；③ **外部 API 幂等键**：把业务幂等键带给下游，由对方按幂等键去重。",
        "**收口句**：**幂等键选业务键（order_id/事件 ID），不要选 (topic, partition, offset)**——从死信重放时 offset 会变，只有业务键能跨重放去重。端到端「有效一次」= at-least-once 传输 + 幂等处理，这是绝大多数业务管道的真实形态。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 只答「改手动提交」就收工——提交时机只能缩小窗口，再平衡与重放造成的重复仍在，必须配幂等。② 幂等键用 Kafka 坐标——重放/换分区后失效；③ 把「数据库与 Kafka 塞进一个事务」当幂等方案——两个系统的原子性不可兼得（见可靠性课 Q4），正确做法是同库事务记处理/发 Outbox，让 relay 发 Kafka；④ 以为「上事务」就不用幂等——事务只管 Kafka 内闭环，管不到落库的重复（见 Q5）。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)（两种幂等落库实现与完整代码）、[消费组与经典再平衡协议](/courses/kafka/lessons/kafka-consumer-groups-classic)（再平衡重复窗口的机制）。",
    },
    {
      type: "heading",
      text: "Q8. 「Kafka 保证不丢消息」——这个说法为什么是错的",
    },
    {
      type: "paragraph",
      text: "追问与辨析题，考的是你能否把「保证」拆开限定。直接答「能」或「不能」都扣分；正确结构是**三段式**——拆链路归因 → 给默认配置的结论与前提 → 补 exactly-once 的范围限定。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**第一段 · 拆链路归因**（先立框架）：丢/重发生在三段，各自由不同机制决定——**生产者 → Broker** 段看 acks（0/1/all）与是否重试；**Broker 副本段**看 RF、[ISR](glossary:isr) 收缩、[min.insync.replicas](glossary:min-insync) 与 [unclean leader election](glossary:unclean-election)（默认关）；**Broker → 消费者**段看提交时机（先提交后处理会丢，处理完未提交会重）。没有单一开关横跨三段打包承诺「不丢」。",
        "**第二段 · 默认结论 + 前提**：按官方默认配置——acks=all、幂等开启、处理完再提交（或 franz-go 的安全自动提交）——Kafka 提供的是 **at-least-once**：已确认消息在「至少一个 ISR 副本存活」的前提下不丢；消费端崩溃带来重复而非丢失。注意两个前提条件要主动说出来：ISR 全部永久失效、或打开 unclean 选举选了落后副本，已确认消息依然可能丢——这正是为什么生产要 rf=3 + minISR=2 + 关 unclean。",
        "**第三段 · exactly-once 的范围**：要「不丢不重」得叠加幂等 + 事务 + read_committed，且只在 Kafka 内部读-处理-写闭环成立；对外部系统只能靠幂等键或事务性 Outbox 做到**有效一次**（见本课 Q4）。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 只背结论「是 at-least-once」不给三段归因——面试官要听的是你能把「哪一段由什么决定」讲清楚，而不是术语。② 不提前提条件（ISR 存活/unclean/刷盘），把 at-least-once 讲成绝对保证。③ 默认值说错：acks 默认 all、幂等默认开、unclean 默认关、自动提交默认开 5 秒（franz-go 提交上一轮 poll 的位置）——这些是「默认配置 = at-least-once」论证的支撑，错一个论证就塌。④ 说「Kafka 会丢消息」与「Kafka 不丢消息」都太绝对——正确姿态是「在什么配置、什么故障模型下，丢/重分别发生在哪」。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[投递语义](/courses/kafka/lessons/kafka-delivery-semantics)（三段归属表与组合表、「面试陷阱」一节即本题答案的原文出处）。",
    },
    {
      type: "heading",
      text: "Q9. 场景归因题：消息「丢了 / 重复了 / 乱序了」，是哪一段的问题",
    },
    {
      type: "paragraph",
      text: "这类题给一段事故描述，让你判断问题出在生产端、副本端还是消费端。答题前先问自己三件事：**现象是丢、重还是乱？现象发生的时间点与哪个操作窗口重合（发布、重启、故障、扩容）？配置是默认还是被改过？**然后按下表归因——注意同一现象可能有两个候选，判据（怎么验证）是答案的精华。",
    },
    {
      type: "table",
      caption: "事故现象 → 归属段 → 判据 → 处置",
      headers: ["现象", "最可能的段", "关键判据 / 怎么区分", "处置"],
      rows: [
        ["同一批消息被处理两遍（重读，offset 相同）", "消费端提交时机", "崩溃/再平衡后从旧提交点重读；日志里同一 offset 出现两次", "处理完再提交 + revoke 补提交；幂等兜底"],
        ["同一条事件出现两条（offset 不同）", "生产者重试 / 跨会话", "是否关闭过幂等？是否重启后按「未确认」做了补偿重发？", "恢复幂等默认；补偿逻辑加业务幂等键"],
        ["确认成功但消息彻底没出现（丢）", "生产者段 acks，或副本段", "查 acks 配置（0/1？）；查主题 unclean 是否被打开、是否 rf=1、磁盘是否损坏", "acks=all + rf=3 + minISR=2 + 关 unclean"],
        ["消费跳过了部分消息（没处理但位点已过）", "消费端提交过早", "提交点是否超前于实际处理点（GreedyAutoCommit / 手动先提交后处理）", "改为处理完再提交；panic 不要 recover 后继续提交"],
        ["同 key 消息乱序（先 paid 后 created）", "生产者并发 / 扩容 / 幂等关闭", "是否多实例并发发同 key？是否近期扩过分区？是否关幂等 + inflight>1？", "单实例保序靠幂等默认；跨实例由业务串行化；扩容窗口按第 2 章预案处理"],
      ],
    },
    {
      type: "paragraph",
      text: "收口要点：**「丢」要往生产端 acks 与副本端找（ISR/minISR/unclean），「重」要先看消费端提交窗口再看生产者重试，「乱」要看幂等/inflight 与分区数变更**——把现象先归到大类，排查就少走一半弯路。排障课的完整原因树与命令判据见[排障手册](/courses/kafka/lessons/kafka-troubleshooting)。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 看到「重复」就说是消费者没做幂等——先查是不是生产端关幂等多 in-flight 造成的重复写入（offset 不同的重复），两类重复的修法不同。② 看到「丢」就怪 broker——先确认生产端 acks：acks=1 时「leader 确认后宕机」窗口的丢是配置选择，不是 broker bug。③ 忽略配置审计：很多事故是有人改过默认配置（关幂等、开 unclean、minISR=1、Greedy 提交），排查第一件事是问「这段代码/配置最近改过什么」。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[可靠发布](/courses/kafka/lessons/kafka-producer-reliability-acks)（复盘：关幂等 + 多 in-flight 的顺序事故）、[投递语义](/courses/kafka/lessons/kafka-delivery-semantics)（剧本 A/B/C 三段归因）、[排障手册](/courses/kafka/lessons/kafka-troubleshooting)（重复消费风暴等症状节）。",
    },
    {
      type: "heading",
      text: "本课收束：可靠性语义自检",
    },
    {
      type: "keypoints",
      items: [
        "可靠性题通用结构：机制 → 窗口 → 边界；每答一个保证，主动说出「它保证不了什么」",
        "acks 丢窗口：0 全盲、1 丢在 leader 未及复制即宕机、all 丢在 ISR 全灭或 unclean 选举；默认 all（-1）",
        "acks=all 等当前 ISR 全体；minISR 是下限保险丝（broker 默认 1）；minISR=1 意味着 ISR 缩到 1 时写入仍成功 = 单副本确认",
        "幂等 = PID+序列号去重，作用域是单个客户端会话；进程重启 PID 重置，补偿重发要靠业务幂等键",
        "exactly-once = 幂等 + 事务 + read_committed，只在 Kafka 内闭环成立；外部系统只能「有效一次」（幂等键 / Outbox），事务里禁止调外部系统",
        "上事务的唯一理由：读 Kafka 写 Kafka 的两处状态必须同生共死；其余先问幂等能不能解决",
        "lag 暴增排查：对齐时间与方向 → 看分布（全体 vs 单分区）→ 查消费者健康 → 止血再追赶；区分一次性积压与结构性 lag",
        "重复消费三步答：接受（at-least-once 固有）→ 修根因（提交时机）→ 幂等兜底（唯一键/处理记录表同库事务/外部幂等键；用业务键不用 offset）",
        "「Kafka 不丢消息」正解三段式：分段归因 → 默认 at-least-once + 前提 → exactly-once 的范围限定",
      ],
    },
    {
      type: "quiz",
      question: "面试追问：「你们生产集群某主题 rf=3、min.insync.replicas=2，两台 broker 同时宕机后 ISR 只剩 1 个成员。此时业务方继续用 acks=all 写入会怎样？如果把 min.insync.replicas 临时改成 1 呢？」",
      options: [
        "ISR=1 低于 minISR=2，写入被拒（NotEnoughReplicas 类错误）并重试；临时改成 1 后写入恢复成功，但只等单副本确认——若那唯一副本随后损坏，这段「已确认」消息全部丢失",
        "写入一直成功，因为 acks=all 只看 leader 是否落盘，与 minISR 无关",
        "两台宕机不影响写入：acks=all 会等全部 3 个副本（含宕机的）恢复后才确认，写入只是变慢",
        "broker 会自动临时创建新副本补足 ISR=3，因此写入永远不受影响",
      ],
      answer: 0,
      explanation: "min.insync.replicas=2 时 ISR=1 触发了保险丝：acks=all 写入被拒并返回可重试错误（NotEnoughReplicas(AfterAppend)），直到 ISR 回升。临时把 minISR 改成 1 等于拆除保险丝：写入恢复，但 all 实际只等唯一存活的副本——它若随后损坏，这段期间所有「已确认」消息都会永久丢失且无副本可追。这正是「minISR 把静默丢变成显式失败」的设计意图：宁可让业务收到写入失败去降级，也不在单副本上假装安全。",
    },
  ],
};
