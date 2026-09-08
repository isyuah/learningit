/* ==================================================================
 * 课时：排障手册：症状 → 诊断 → 处置（kafka-troubleshooting）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 事实核对（2026-09-08）：
 * - 命令与输出：kafka-topics / kafka-consumer-groups / kafka-metadata-quorum /
 *   kafka-log-dirs / kafka-storage 的形态按 4.3.1 实测或官方文档核对。
 * - 「投票者只剩 1/3 时：建主题卡住、--list 正常、既有分区生产正常」等
 *   现象来自 4.3.1 动态 quorum 三 controller 集群的真实故障实验。
 * - offsets.retention.minutes 默认 10080（官方 broker 配置文档）。
 * - 与第 4/5 章提交语义、幂等、DLQ 口径一致；指标名同观测课（9.2）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "症状驱动的排障手册：先隔离端（producer/broker/consumer），再按统一的判据→原因树→处置→预防结构处理 9 类高频故障。",
  blocks: [
    {
      type: "paragraph",
      text: "第 9 章前四课依次解决了「怎么建、怎么盯、怎么算容量、怎么上锁」；这一课处理最后也是最难的部分——**出事时怎么办**。Kafka 的故障有个特点：同一症状有多个原因，同一原因有多种表现（lag 涨可能是消费者慢、热点 key、再平衡频繁或生产者峰值，处置完全不同）。所以本课不讲「症状对照表」，讲**怎么区分原因**：9 个高频故障，每个都按固定的「症状 → 判据 → 原因树 → 处置 → 预防」结构走，命令与指标都沿用前几课核对过的写法。",
    },
    {
      type: "heading",
      text: "方法论：先隔离端，再读时间线",
    },
    {
      type: "paragraph",
      text: "一条消息从生产到消费经过三个可观测的端：**producer 进程 → broker/集群 → consumer 进程**（外加中间的消费组协调）。排障第一步永远是把症状归到某一端：producer 侧看发送错误与耗时，broker 侧看指标与日志，consumer 侧看 lag、提交与处理日志。归错端是所有错误处置的共同起点——在 consumer 加实例，治不了 producer 峰值造成的 lag，更治不了分区不可用。",
    },
    {
      type: "table",
      caption: "症状速查：先看哪一端、第一条命令是什么（对应下文九节）",
      headers: ["症状", "先隔离的端", "第一判据"],
      rows: [
        ["分区不可用（写入/读取报 leader 相关错误）", "broker/集群", "`kafka-topics.sh --describe` 看该分区 Leader/Isr 列"],
        ["lag 持续增长", "consumer vs producer", "`kafka-consumer-groups.sh --describe` 看逐分区 lag 曲线"],
        ["消费完全不动", "consumer", "组状态与成员（`--describe --state`）+ 消费者日志"],
        ["积压突然清空", "consumer/操作记录", "CURRENT-OFFSET 是否出现与消费无关的跳变"],
        ["磁盘满", "broker/磁盘", "`df -h` 数据盘 + `kafka-log-dirs.sh --describe`"],
        ["网络分区/多数派丢失", "集群内部链路", "`kafka-metadata-quorum.sh describe --status` + 副本指标"],
        ["重复消费风暴", "consumer 提交", "处理日志里的 offset 重复区间与再平衡时间点对照"],
        ["broker 起不来", "broker 进程", "`logs/server.log` 尾部错误行（启动即退出）"],
        ["单 broker 假死", "broker 进程内部", "请求线程空闲率 + 本机 GC/IO + 其它节点视角"],
      ],
    },
    {
      type: "paragraph",
      text: "两条贯穿全课的纪律：**对照实验**——拿官方 CLI（console producer/consumer）与出问题的客户端跑同一路径，能立刻把「客户端问题」与「集群问题」分开；**对时间线**——指标曲线、日志、发布/操作记录三份时间线对齐，大多数事故在「某次变更之后」这个事实面前会自动现形。",
    },

    /* ============ 症状一 ============ */
    {
      type: "heading",
      text: "症状一：分区不可用（OfflinePartitions、ISR 归零、leader 选举失败）",
    },
    {
      type: "paragraph",
      text: "表现：生产者/消费者在某个主题上持续收到 leader 相关错误（协议层的 NOT_LEADER_OR_FOLLOWER、LEADER_NOT_AVAILABLE 一类）或请求超时重试；该主题整体或个别分区完全读不到新数据。",
    },
    {
      type: "subheading",
      text: "判据",
    },
    {
      type: "list",
      items: [
        "`kafka-topics.sh --describe --topic <主题>`：故障分区的 **Leader 列失去有效节点编号、Isr 列变空**，与健康分区形成对照",
        "指标：`OfflinePartitionsCount` > 0（controller 视角，名称见[观测课](/courses/kafka/lessons/kafka-monitoring-lag)）；`UnderReplicatedPartitions`、`UnderMinIsrPartitionCount` 同步上升",
        "`logs/controller.log`：选主相关 ERROR/异常；`logs/state-change.log`：该分区最后一次 leader 变更",
      ],
    },
    {
      type: "subheading",
      text: "原因树（按可能性与检查成本排序）",
    },
    {
      type: "list",
      items: [
        "**副本所在的 broker 全挂了或不可达**：RF=1 的主题只在一台 broker 上，它一挂该分区就没有候选；RF=3 但三台同时失联（机架断电、网络分区）同理",
        "**ISR 已空且不允许 unclean 选举**：[unclean leader election](glossary:unclean-election)（默认 false）不允许 [ISR](glossary:isr) 之外的副本接任，ISR 内成员全失联就无人可上台——这是「宁可不可用也不丢已确认消息」的开关，取舍见[副本与 ISR](/courses/kafka/lessons/kafka-replication-isr)",
        "**controller quorum 失去多数派**：投票 controller 挂了 2/3，元数据无法提交、选举无法进行（症状六展开）",
        "**磁盘故障**：broker 的某块数据盘坏掉 → `OfflineLogDirectoryCount` > 0，其上分区全部下线",
      ],
    },
    {
      type: "subheading",
      text: "处置",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "按原因树定位：describe 先看哪台 broker 失联 → 再查 quorum 状态（`kafka-metadata-quorum.sh describe --status`）→ 再看磁盘指标",
        "能等则等：若是 broker 宕机，重启/恢复 broker 后 ISR 会自动扩张、leader 自动选回——不要急着人为干预",
        "确需立即恢复可用且可接受风险时（例如只剩一台带数据的副本在 ISR 外）：临时允许该主题的 unclean 选举，或在副本恢复后手动触发选举（`kafka-leader-election.sh`）——动手前必须确认你理解「可能丢已确认消息」的代价",
        "RF=1 的主题：先恢复 broker，长期方案是提高副本数（书舟生产统一 RF=3 + [min.insync.replicas](glossary:min-insync)=2）",
      ],
    },
    {
      type: "subheading",
      text: "预防",
    },
    {
      type: "list",
      items: [
        "RF≥3 并跨机架/可用区放置副本（`broker.rack`，见[KRaft 部署课](/courses/kafka/lessons/kafka-kraft-cluster-deploy)）；RF=1 主题只允许出现在开发环境",
        "监控 OfflinePartitionsCount / UnderReplicatedPartitions，阈值思路见观测课 L1/L2 层",
        "controller 保持 3 台（或 5 台）且跨故障域——多数派是「能选举」的底线",
      ],
    },

    /* ============ 症状二 ============ */
    {
      type: "heading",
      text: "症状二：lag 持续增长——先分清四种原因再动手",
    },
    {
      type: "paragraph",
      text: "表现：[消费滞后](glossary:lag) 曲线持续向上、不回落的，比瞬时尖峰危险得多。本课把这一节当教学重点，因为**处置完全取决于原因**，而原因有四种典型形态，判据各不相同：",
    },
    {
      type: "table",
      caption: "lag 持续增长的四种原因怎么区分",
      headers: ["原因", "特征判据", "确认动作", "正确处置"],
      rows: [
        ["消费者处理慢", "各分区 lag 齐涨齐跌；消费者侧单条处理耗时/失败率上升；CPU 或外部依赖吃紧", "看消费者日志与处理耗时指标；对照实验：CLI 同主题消费是否飞快", "优化处理路径、横向加实例（分区富余时）、减少每条消息的同步外部调用"],
        ["热点 key / 分区倾斜", "**个别分区** lag 独高、其余接近 0；该分区消息都带同一 key", "describe 按分区看（总 lag 会掩盖它）；确认热点 key（书舟的秒杀 sku、网红 user_id）", "扩容消费者无效（并行度上限 = 分区数）；拆 key/加盐或改设计，见[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)"],
        ["再平衡频繁", "lag 呈锯齿（涨一下、回一点）；`--describe --members`/`--state` 显示成员频繁进出、state 反复 Rebalancing；消费者日志有心跳超时/被踢", "查处理耗时是否超过会话窗口（处理慢会被判定死亡），见[消费组与经典再平衡协议](/courses/kafka/lessons/kafka-consumer-groups-classic)", "稳住成员：处理耗时压进会话窗口、必要时静态成员、避免频繁启停实例"],
        ["生产者峰值", "lag 增长时段与生产速率峰值对齐；broker 吞吐指标（BytesInPerSec）同步抬升；峰值过后 lag 开始回落", "把生产速率曲线与 lag 曲线叠在一张图上看", "峰值则等它自然追平并观察净追平速率；长期超卖才谈扩容（[容量课](/courses/kafka/lessons/kafka-capacity-tuning)给模型）"],
      ],
    },
    {
      type: "subheading",
      text: "判据",
    },
    {
      type: "list",
      items: [
        "`kafka-consumer-groups.sh --describe --group <组>`：看**逐分区** LAG 与 CONSUMER-ID；多轮采样看走向（单点值无意义，见观测课）",
        "组状态：`--describe --state`（Stable/Rebalancing/Empty）与 `--describe --members` 看成员是否稳定",
        "区分「没拉到」与「拉到了处理不完」：已提交位移不涨但消费进程在跑，多半是处理卡壳；位移在涨但跟不上末端，才是吞吐不足",
      ],
    },
    {
      type: "subheading",
      text: "原因树",
    },
    {
      type: "list",
      items: [
        "全分区齐涨 → 消费者整体慢（处理慢 / 实例数不足 / 退避卡壳）或生产峰值",
        "单分区独涨 → 热点 key（同 key 全进同一分区）或该分区 leader 所在 broker 出问题（叠加症状一/九）",
        "锯齿状涨落 + 成员进出 → 再平衡风暴",
        "涨到某值后进入平台期 → 消费完全停止（症状三，另一种病）",
      ],
    },
    {
      type: "subheading",
      text: "处置",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "先按上表定性：看分区分布、看成员稳定性、叠生产速率曲线——这步做对，后面全是常规动作",
        "热点 key：不要加实例；确认 key 分布并设计拆 key；确需临时提速可让专门进程单独消费该热点分区（注意与组内其它成员的提交语义隔离）",
        "再平衡风暴：稳住处理耗时与心跳；确因参数不匹配导致的心跳超时，按第 4 章调整会话窗口",
        "生产者峰值：追平时间 ≈ 积压量 ÷ 净处理速率（消费速率 − 生产速率，量级估算），设观察窗口，别在峰值中段慌着改代码",
      ],
    },
    {
      type: "subheading",
      text: "预防",
    },
    {
      type: "list",
      items: [
        "lag 按 (组, 分区) 长期记录并建立基线告警（增长斜率 + 保鲜 SLA 倒推，见观测课）",
        "消费管道三件套（处理计数/失败/死信）与 lag 同看板——第 5 章判读规则在这里救场",
      ],
    },

    /* ============ 症状三 ============ */
    {
      type: "heading",
      text: "症状三：消费完全不动（lag 恒定、成员异常）",
    },
    {
      type: "paragraph",
      text: "表现：lag 稳定在一个大值不再变化，也没有新消息被处理——注意这与「lag 增长」是两种病：增长说明消费在跑但跟不上，恒定不动说明**消费根本没在跑**。",
    },
    {
      type: "subheading",
      text: "判据",
    },
    {
      type: "list",
      items: [
        "`kafka-consumer-groups.sh --describe`：CURRENT-OFFSET 多轮采样完全不变；`--describe --state` 看组状态（成员在不在、是不是已 Dead/Empty 而进程还以为自己在消费）",
        "消费者进程日志：poll 循环是否还在输出、有没有异常后静默退出、是否在无限重试某个错误",
        "对照实验：用 console consumer 以同一组名（或独立组）跑同一主题——能立刻读出 = 集群与数据面正常，问题在你的消费者",
      ],
    },
    {
      type: "subheading",
      text: "原因树",
    },
    {
      type: "list",
      items: [
        "**组成员已死但进程还在**：心跳超时被判定死亡（处理阻塞超过会话窗口、GC 长停顿），组内分区被转走，进程自己还在空转",
        "**poll 循环死了**：panic 被吞、死锁、channel 阻塞——进程活着但不 poll（franz-go 的 poll 通常是主循环，查它是否被业务代码卡住）",
        "**coordinator 迁移中**：组的协调器随 broker 重启/故障转移，客户端重连期间拉取与提交暂停",
        "**订阅的分区不可用**：leader 没了（症状一）→ fetch 一直失败重试",
        "**持续错误**：offset 越界且 reset 策略不匹配、ACL/认证拒绝等（后者见[安全课](/courses/kafka/lessons/kafka-security)）",
      ],
    },
    {
      type: "subheading",
      text: "处置",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "先回答「组认为自己在消费吗」：看 state 与成员——成员在而位移不动 → 消费者内部问题（poll/处理循环）；成员不在 → 消费者被踢或已死",
        "用 CLI 对照确认数据面健康，把范围收敛到消费者代码与配置",
        "修复处理循环后恢复进程；确需人工干预位移时用 `kafka-consumer-groups.sh --reset-offsets`（注意症状四的警示：这本身就是一次「位移变更」）",
      ],
    },
    {
      type: "subheading",
      text: "预防",
    },
    {
      type: "list",
      items: [
        "为「lag 高位恒定」设独立告警（与「增长」分开）：lag 涨 + 死信不涨 + 无重试 = 静默卡死（观测课场景 C）",
        "消费者进程要有存活与健康检查——它活着 ≠ 它在消费",
      ],
    },

    /* ============ 症状四 ============ */
    {
      type: "heading",
      text: "症状四：积压突然清空——先分清「追平」与「跳过」",
    },
    {
      type: "paragraph",
      text: "表现：一个大 lag 突然归零或大幅下降。两种可能，性质相反：**消费者修复后追平**（正常）；**位移被跳过或重置**（数据被无声跳过，要马上处理）。",
    },
    {
      type: "subheading",
      text: "判据",
    },
    {
      type: "list",
      items: [
        "追平：CURRENT-OFFSET 连续单调推进，推进速率与消费者处理速率一致；期间处理日志显示高负荷运行",
        "跳过：CURRENT-OFFSET 出现**一次跳变**（如 100 → 5100），与消费速率曲线对不上——位移不是「读过去的」，是「被改掉的」",
        "查操作记录与告警：谁执行过 `--reset-offsets`？组是否被删除重建？主题是否被删除重建（TopicId 变化，旧位移失效）？",
        "查空组位移是否过期：组长期无成员时，位移在 `offsets.retention.minutes`（broker 默认 **10080 分钟 = 7 天**，官方配置文档）后会被清理；组重新活跃时按 `auto.offset.reset` 定起点（默认 latest = 跳到最后）——书舟 7 天保留的 `orders.events` 正好踩这个边界",
      ],
    },
    {
      type: "subheading",
      text: "原因树",
    },
    {
      type: "list",
      items: [
        "人工/脚本执行了位移重置（`--reset-offsets --to-latest` / `--to-offset`）——最常见，查操作记录",
        "组被删除后重建：旧位移随组删除而清除，新组从 latest/earliest 重新开始",
        "空组位移过期（`offsets.retention.minutes`，默认 7 天）后组重新活跃",
        "主题被删除重建：分区数据已不在，位移无从谈起",
      ],
    },
    {
      type: "subheading",
      text: "处置",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "确认是「跳过」后先冻结或记录现场，评估被跳过的时间窗口内丢了多少数据、影响哪些下游",
        "数据仍在保留期内：用 `--reset-offsets` 把组位移拨回跳变前的位置重放；重放会产生重复，靠消费侧幂等吸收（业务键去重，见[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)）——第 5 章「幂等消费是 at-least-once 的必修课」在这一刻兑现",
        "追平（正常情形）也值得看一眼：多实例追平期间若发生再平衡，个别分区可能短暂乱序——确认下游对顺序的依赖是否被破坏",
      ],
    },
    {
      type: "subheading",
      text: "预防",
    },
    {
      type: "list",
      items: [
        "位移重置/组删除纳入变更管理（审批 + 记录）；给「CURRENT-OFFSET 突跳」设检测告警",
        "空组与数据保鲜统一规划：管道可能停摆超过 7 天时，提前调大 `offsets.retention.minutes`（broker 级，全集群生效）或保留最小成员",
      ],
    },

    /* ============ 症状五 ============ */
    {
      type: "heading",
      text: "症状五：磁盘满——按顺序处置，别乱删文件",
    },
    {
      type: "paragraph",
      text: "表现：broker 写入报错、副本陆续下线；指标 `OfflineLogDirectoryCount` 上升；系统层 `df` 显示数据盘打满。Kafka 数据按 segment（段文件）追加落盘，盘满会让活跃 segment 写不进去，进而拖垮该盘上所有分区。",
    },
    {
      type: "subheading",
      text: "判据",
    },
    {
      type: "list",
      items: [
        "`df -h` 看 `log.dirs` 各数据盘水位；`logs/server.log` 有磁盘/目录相关 ERROR",
        "`kafka-log-dirs.sh --describe --bootstrap-server <broker>`：从 broker 视角看每个 `logDir` 与其下各分区的 size（输出为 JSON，含每分区字节数）——定位是哪个目录、哪个主题撑爆的",
        "指标 `OfflineLogDirectoryCount` > 0 说明已有目录被判离线（比打满更严重，盘可能已只读/损坏）",
      ],
    },
    {
      type: "subheading",
      text: "原因树",
    },
    {
      type: "list",
      items: [
        "**retention 未按预期生效**：按时间保留只在滚动删除**过期 segment**（时间粒度到 segment，不是精确到消息）；retention 很长的主题（如 7 天 `orders.events`）+ 高写入量 = 盘被撑满，语义见[存储：Segment、保留策略与日志压缩](/courses/kafka/lessons/kafka-storage-segments-retention)",
        "**单主题爆炸**：某个 topic 写入量异常（未限流的上游、测试灌数据、有人把 Kafka 当数据库）",
        "**日志目录配置问题**：多块盘只配了一块（`log.dirs` 用逗号列多目录才会分摊）；或某块盘容量远小于其它盘",
        "**清理线程停摆**：log cleaner/删除任务异常，segment 只增不减",
      ],
    },
    {
      type: "subheading",
      text: "处置（按顺序，先止血再根治）",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "止血：立即定位大头并**优先用 Kafka 自己的机制清腾**——调短主题的 `retention.ms`/`retention.bytes`（动态生效，等待下一次 segment 滚动删除）；确属废弃数据可删除主题（`kafka-topics.sh --delete`）；只想删部分历史用 `kafka-delete-records.sh`（按 offset 删 segment）",
        "绝对不要直接 `rm` 数据目录里的 .log/.index 文件——Kafka 的 segment 与索引要成组维护，手工删会留下不一致状态，比磁盘满更难收拾",
        "扩容：给 `log.dirs` 增加数据盘目录并迁移部分副本（reassign），让容量分布到多块盘——[容量规划与性能调优](/courses/kafka/lessons/kafka-capacity-tuning)给模型",
        "恢复与观察：确认盘水位下降、OfflineLogDirectoryCount 归零、ISR 扩张回满（症状一/九的收尾动作一样）",
      ],
    },
    {
      type: "subheading",
      text: "预防",
    },
    {
      type: "list",
      items: [
        "磁盘水位监控（80%/90% 分档）+ 按目录聚合的 `kafka-log-dirs.sh` 定期巡检",
        "容量估算时把「保留时长 × 写入速率 × 副本数」的放大算进去（容量课）；retention 按 topic 显式声明，别依赖默认",
        "数据盘多目录分散 + 单盘故障不拖全 broker（`log.dirs` 多目录 + 监控 OfflineLogDirectoryCount）",
      ],
    },

    /* ============ 症状六 ============ */
    {
      type: "heading",
      text: "症状六：网络分区——副本追不上与 quorum 失联是两回事",
    },
    {
      type: "paragraph",
      text: "表现分两种，别混：**broker 之间网络抖动**（副本同步断断续续）与 **controller quorum 失联**（多数派拿不到，元数据层停摆）。前者影响冗余完整性，后者影响整个集群的元数据能力——严重程度完全不同。",
    },
    {
      type: "subheading",
      text: "判据",
    },
    {
      type: "list",
      items: [
        "broker 间问题：`UnderReplicatedPartitions` > 0 持续、`IsrShrinksPerSec` 出现与网络事件时间线对齐的尖峰；`logs/server.log` 里副本拉取线程报连接/超时错误",
        "quorum 问题：`kafka-metadata-quorum.sh describe --status` 长时间无响应/超时、LeaderId 异常或频繁变化；`describe --replication` 里投票者/观察者 Lag 涨不落；controller 指标 `TimedOutBrokerHeartbeatCount`、`FencedBrokerCount` 上升",
        "实测观察（4.3.1，3 投票者只剩 1 台时）：**建主题/加分区这类元数据操作长时间卡住不返回；`kafka-topics.sh --list` 这类读缓存的操作仍正常；已存在分区的生产与消费仍正常**——这个「能读能写老数据、但一切元数据变更停滞」的组合是 quorum 失联的指纹",
      ],
    },
    {
      type: "subheading",
      text: "原因树",
    },
    {
      type: "list",
      items: [
        "交换机/防火墙/跨机房链路抖动：broker 之间、controller 之间、controller↔broker 三种链路各自独立故障",
        "controller 之间网络差：3 台投票者跨机房、延迟高或丢包——Raft 每笔元数据提交都要多数派确认，网络质量直接决定元数据延迟",
        "资源耗尽型假分区：某台机器 CPU/磁盘卡死，表现为「包能通但没人应答」（与症状九互为表里）",
      ],
    },
    {
      type: "subheading",
      text: "处置",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "先按上面判据确定断的是哪条链路：副本同步（broker 间）还是 quorum（controller 间）还是心跳（controller↔broker）",
        "副本追不上：通常是暂时的，链路恢复后 ISR 自动扩张；持续不恢复再看是否有 broker 假死叠加",
        "quorum 失联：等多数派恢复即自愈（元数据日志会追平）；期间**不要**对集群做任何结构性操作（建主题、加分区、重平衡），它们只会堆积超时",
        "从网络层根治：控制器同域低延迟部署（部署课建议）、防火墙规则审计、交换机链路冗余",
      ],
    },
    {
      type: "subheading",
      text: "预防",
    },
    {
      type: "list",
      items: [
        "controller 放同机房/同可用区的高可靠网络；broker 跨机房时明确「数据面容忍跨机房延迟、元数据面不」的拓扑边界",
        "监控：raft 选举/提交延迟、副本 MaxLag、`describe --replication` 定期快照",
      ],
    },

    /* ============ 症状七 ============ */
    {
      type: "heading",
      text: "症状七：重复消费风暴——提交时机与再平衡的联合演出",
    },
    {
      type: "paragraph",
      text: "表现：业务侧观察到同一消息被处理多次（重复通知、重复扣减尝试）；消费端日志里同一 offset 出现两次以上。它与症状四方向相反：症状四是**跳过**（少处理），这是**重读**（多处理）。",
    },
    {
      type: "subheading",
      text: "判据",
    },
    {
      type: "list",
      items: [
        "处理日志里 offset 序列出现重复区间；对照重复发生的时间点与再平衡事件（成员进出、state 变化）",
        "消费端「处理完成但未提交」的窗口与崩溃/重启时间点对齐——自动提交每 5 秒一次且滞后一轮（franz-go 默认），崩溃发生在窗口内必然重读尾部，语义细节见[拉取模型、位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)",
        "再平衡场景：处理耗时超过会话窗口 → 成员被判定死亡踢出 → 分区转给他人，他人从**最后提交点**重新读——处理中未提交的那批全部重读",
      ],
    },
    {
      type: "subheading",
      text: "原因树",
    },
    {
      type: "list",
      items: [
        "**崩溃在提交窗口内**：处理完 → 崩溃（在 5s 提交节拍或下一次 poll 之前）→ 重启从旧提交点重读尾部（at-least-once 的本性，见[投递语义](/courses/kafka/lessons/kafka-delivery-semantics)）",
        "**处理中被再平衡**：处理超过会话窗口/心跳超时被踢，或主动停机触发 rebalance，未提交批次转交他人重读",
        "**误用激进自动提交的反向**：提交了但没处理完也会造成问题（丢），这里不展开；重复风暴的主因永远是「提交点落后于处理点太多」",
      ],
    },
    {
      type: "subheading",
      text: "处置",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "确认重复窗口：从日志还原「崩溃/再平衡时刻 − 最后提交时刻」之间的 offset 区间，评估影响面",
        "消费侧幂等兜底：业务表唯一键 / 处理记录与业务写同库事务（第 5 章给了完整代码）——重复风暴的**最终防线**，因为只要用 at-least-once，重复就只能被吸收不能根除",
        "修正提交语义：处理完再提交（`MarkCommitRecords`/手动提交，别让提交点离处理点太远）；把处理耗时压回会话窗口内避免被踢",
      ],
    },
    {
      type: "subheading",
      text: "预防",
    },
    {
      type: "list",
      items: [
        "提交时机与幂等设计放进每次「新增消费者」的评审 checklist（第 5 章），比事后排障便宜一个量级",
        "观测幂等冲突计数（唯一键冲突 = 重复的真实证据），与 lag 同看板",
      ],
    },

    /* ============ 症状八 ============ */
    {
      type: "heading",
      text: "症状八：broker 起不来——启动失败原因清单",
    },
    {
      type: "paragraph",
      text: "表现：`kafka-server-start.sh` 启动后很快退出，或反复重启失败。KRaft 时代的启动失败原因高度集中，按下面的清单从高频到低频排查（每条都会在 `logs/server.log` 尾部留下直接证据）：",
    },
    {
      type: "subheading",
      text: "判据与原因清单（对应日志表现）",
    },
    {
      type: "list",
      items: [
        "**没格式化 / 目录不是这个集群的**：KRaft 取消自动格式化后，未 format 的 `log.dirs` 直接启动会失败（找不到已格式化的元数据目录 / 无 cluster id）；目录里是**别的集群**的 UUID 也会注册失败——先执行 `kafka-storage.sh format`（同集群 UUID），细节见[KRaft 部署课](/courses/kafka/lessons/kafka-kraft-cluster-deploy)",
        "**配置组合非法**：`process.roles` 与 listener 声明不匹配（combined 必须在 `listeners` 里带上 CONTROLLER listener；纯 controller 不能只配 broker listener）、缺 `controller.listener.names`（KRaft 必需）、`node.id` 重复或与已格式化目录里的身份冲突",
        "**端口被占**：`Address already in use`（上一实例没停干净、或与别的进程撞端口）——第 1 章 quickstart 排障表同款",
        "**环境问题**：缺 JDK 17+ / `JAVA_HOME` 不对；堆设置与机器内存不匹配（启动脚本默认 `-Xmx1G`，机器内存小的容器里可能起不来）；`log.dirs` 目录不存在且无权限创建",
        "**数据目录状态**：磁盘满或只读导致元数据日志/segment 恢复失败（与症状五联动）",
        "**时钟/身份错乱**：机器间时钟偏差过大影响凭证与日志时间线（多数场景只是难排障，不直接拒启）；节点间 `node.id` 混乱会让注册互相覆盖",
      ],
    },
    {
      type: "subheading",
      text: "处置",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "看日志尾部：`grep -A20 -E \"ERROR|Caused by\" logs/server.log | tail -40`——启动失败必有第一行根因，别靠猜",
        "按清单逐项核对：format 状态（`cat <log.dirs>/meta.properties` 看 cluster.id/node.id）→ 配置（角色/listener/node.id）→ 端口（`netstat`/`ss`）→ 环境（java、权限、磁盘）",
        "改完配置或清空目录后重新走「format → start」；注意同目录重复 format 会拒绝，需先清空或加 `--ignore-formatted`",
        "多节点先后启动时区分「起不来」与「起而不注册」：后者日志里有重试连接 quorum 的信息，等 controller 就绪即可（不是错误）",
      ],
    },
    {
      type: "subheading",
      text: "预防",
    },
    {
      type: "list",
      items: [
        "配置模板化 + 启动前脚本检查（format 状态、端口占用、目录权限），把上面清单自动化",
        "给 broker 配 systemd/容器健康检查：就绪判据用日志里的 `Kafka Server started`，而不是进程存活",
      ],
    },

    /* ============ 症状九 ============ */
    {
      type: "heading",
      text: "症状九：单 broker 假死——进程活着，服务死了",
    },
    {
      type: "paragraph",
      text: "表现：进程在（端口在、`ps` 看得到），但它持有的分区集体超时；或它作为 follower 长期追不上 leader。假死比真死难排：健康检查（进程存活）全绿，而流量已经受损。",
    },
    {
      type: "subheading",
      text: "判据",
    },
    {
      type: "list",
      items: [
        "本机视角：`RequestHandlerAvgIdlePercent` / `NetworkProcessorAvgIdlePercent` 贴 0（请求线程全忙或全卡）、`RequestQueueSize` 堆积；`top`/`iostat` 看 CPU 与磁盘 IO 是否异常（IO 等待拉满、CPU 全在 GC）",
        "GC 视角：堆使用率接近上限、GC 日志（启动脚本默认写入日志目录，文件名含 gc）出现长停顿——长 GC 会让心跳与请求双双断供，被集群判死",
        "其它节点视角：本 broker 上的分区 leader 被移走（state-change.log）、ISR 收缩（症状一/六的指标）、controller 侧心跳超时指标上升——「别人眼中的你」比「你眼中的自己」更能证明假死",
        "对照实验：直接对这台 broker 发起请求（CLI/客户端指定它）观察响应；对比其它 broker 是否正常",
      ],
    },
    {
      type: "subheading",
      text: "原因树",
    },
    {
      type: "list",
      items: [
        "**长 GC 停顿**：堆太小或分区/请求对象太多（`KAFKA_HEAP_OPTS` 默认 1G，生产按容量课调）；Full GC 期间线程全停",
        "**磁盘 IO 卡死**：数据盘硬件故障/掉速/坏道重试，写路径全部阻塞——同时是症状五（磁盘满）的近亲",
        "**线程池饥饿**：某个请求类型占满 IO 线程（如超大消息解压、大量分区恢复）",
        "**主机资源被抢**：同机其它进程（监控 agent、同机的其它 broker/controller）吃满 CPU",
      ],
    },
    {
      type: "subheading",
      text: "处置",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "快速定性：看 GC 日志停顿与 IO 等待时间线——是卡在 CPU（GC）还是卡在盘（IO）",
        "若确认僵死且短时间无法恢复：**果断 kill**（graceful shutdown 依赖进程还能响应，僵死时等它自己优雅退出只会拖长故障）——RF≥2 时分区由其它副本接管，这与症状一/六的恢复路径一致",
        "保留现场再重启：GC 日志、堆 dump（如果来得及）、`dmesg`/系统日志，避免「重启就好了但不知道为什么」",
        "恢复后按原因治理：堆与 GC 参数（容量课）、坏盘更换、同机资源隔离",
      ],
    },
    {
      type: "subheading",
      text: "预防",
    },
    {
      type: "list",
      items: [
        "监控要能区分「进程死」与「进程僵」：请求线程空闲率、GC 停顿时长、副本同步滞后都要有告警，只盯进程存活会漏掉假死",
        "broker 与 controller 不混部（部署课）、数据盘独立、同机资源配额（systemd/cgroup）",
      ],
    },

    /* ============ 收尾 ============ */
    {
      type: "heading",
      text: "复盘：每个事故都是一条缺失的监控",
    },
    {
      type: "paragraph",
      text: "九个症状走完，最值得带走的是那个反复出现的模式——**每个「查了很久才发现」的事故，都是因为判据表里少了某一行**。所以事故处理完别急着宣布结束，做三件事：把根因写回对应判据（下次先查它）；为这次事故补一条监控或告警（观测课的三层框架里它属于哪层？）；更新 runbook（处置动作是否有人能照做）。第 10 章的[综合实战](/courses/kafka/lessons/kafka-capstone-order-pipeline)里你会亲手杀一次 broker 演练其中的一半流程，而[面试速查](/courses/kafka/lessons/kafka-interview-architecture)把这些场景压缩成了可以被追问的问题。",
    },
    {
      type: "quiz",
      question:
        "结算消费者（组 payment-settle）的 lag 曲线一直平稳，某天 15:02 突然从 8000 归零。查 describe 发现 CURRENT-OFFSET 从 12000 一次性跳到 20000，而消费端日志显示 15:02 前后处理速率没有任何变化。最可能的结论与正确处置是？",
      options: [
        "消费者追平了积压，一切正常，无需处理——lag 归零就是健康信号",
        "lag 归零说明消息被自动压缩掉了，Kafka 会保证不丢数据，静观其变即可",
        "位移被人为重置或组被重建（CURRENT-OFFSET 跳变与消费速率无关）：可能有 8000 条消息被跳过；若数据仍在保留期内，应把位移拨回跳变前重放，并靠消费侧幂等吸收重复",
        "说明协调器故障，需要重启所有消费者让位移重新同步",
      ],
      answer: 2,
      explanation:
        "lag 下降必须区分「读过去的」（追平）与「被改掉的」（重置/跳过）：追平时 CURRENT-OFFSET 与消费速率同步单调推进，跳变则是位移本身被改动。处置 = 定位谁动了位移（操作记录/组删除/过期），保留期内拨回重放，并依赖幂等消费吸收重放重复。Kafka 不会自动压缩或跳过消息内容（选项 2 是常见误解），协调器故障也不会自己改位移。",
    },
    {
      type: "keypoints",
      items: [
        "方法论：先隔离端（producer/broker/consumer/协调器），用 CLI 对照实验切分客户端与集群问题，指标/日志/操作记录三线对时间",
        "分区不可用四因：副本全挂 / ISR 空且禁 unclean / quorum 丢多数派 / 磁盘故障——describe 看 Leader/Isr、指标看 OfflinePartitionsCount",
        "lag 增长四因：处理慢（齐涨）/ 热点 key（单分区独涨，加实例无效）/ 再平衡风暴（锯齿+成员进出）/ 生产峰值（与速率曲线对齐）——定性后再处置",
        "消费不动看组状态与成员；lag 高位恒定 ≠ 增长，单设告警",
        "积压突降分清追平（位移随消费推进）与跳过（位移跳变：被 reset/组重建/7 天空组位移过期）——跳过要拨回重放，靠幂等吸收重复",
        "磁盘满用 Kafka 机制清腾（retention/delete topic/delete-records），严禁手工 rm segment；处置顺序 = 止血→定位→根治→观察",
        "网络分区分两种：broker 间副本追不上 vs quorum 失联（元数据操作卡住、读写老数据正常）——后者等多数派恢复即自愈，期间别做结构性操作",
        "重复消费风暴的根在提交时机与再平衡窗口：幂等是 at-least-once 的最终防线（第 5 章）；broker 起不来按「日志根因→format→配置→端口→环境」清单查；假死靠 GC/IO 判据 + 果断 kill 触发快速接管",
      ],
    },
  ],
};
