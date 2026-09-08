/* ==================================================================
 * 课时：存储：Segment、保留策略与日志压缩（kafka-storage-segments-retention）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Apache Kafka 4.3（主线 4.3.1，KRaft-only）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "分区在磁盘上是一串按 offset 命名的 segment 文件：顺序写加页缓存换吞吐，delete 按段整删、compact 按 key 留新。保留策略的每个字都影响存储成本与状态正确性。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课我们定了主题的分区数与 key 路由，但那还是在「逻辑层」谈数据：分区里的消息到底以什么形态存在磁盘上？为什么 Kafka 敢把「保留一周、随时回放」当默认能力？[保留策略](glossary:retention) 和 [日志压缩](glossary:compaction) 又是怎么工作的？这一课把存储层讲透——它是磁盘告警、成本估算、状态主题设计这些日常工作的共同底座。",
    },
    {
      type: "heading",
      text: "分区日志的落盘形态",
    },
    {
      type: "paragraph",
      text: "Kafka 里每个 [分区](glossary:partition) 对应 broker 数据目录（配置 `log.dirs`，broker 默认值来自 `log.dir = /tmp/kafka-logs`；Docker 等发行版常改为容器内其它目录，以实际配置为准）下的一个目录，命名 `<主题名>-<分区号>`。目录里不是一个大文件，而是一串**segment（段）文件**，文件名是「段内第一条消息的 [offset](glossary:offset)」，固定 20 位补零。",
    },
    {
      type: "code",
      title: "一个分区目录的典型内容",
      language: "text",
      code: "/tmp/kafka-logs/orders.events-0/\n├── 00000000000000000000.log        # 段 1：起始 offset 0\n├── 00000000000000000000.index      # 段 1：offset → 文件字节位置（稀疏索引）\n├── 00000000000000000000.timeindex  # 段 1：时间戳 → offset（稀疏索引）\n├── 00000000000000384613.log        # 段 2：起始 offset 384613（滚动产生）\n├── 00000000000000384613.index\n├── 00000000000000384613.timeindex\n└── leader-epoch-checkpoint 等分区级辅助文件\n\n.log 存消息本体；.index 帮「按 offset 读」快速定位文件内位置；\n.timeindex 帮「按时间戳找 offset」（消费端 seek 到某时间点用）。",
    },
    {
      type: "paragraph",
      text: "消息只追加到当前活跃段（active segment）的尾部，写入是**纯顺序 IO**。官方设计文档那篇经典的「别怕文件系统」解释过为什么这是吞吐的关键：机械盘线性读写的吞吐比随机读写高出几个数量级（文档举例 6 块 7200 转盘的阵列顺序写约 600 MB/s、随机写仅约 100 kB/s——数字只为建立量级直觉）；而现代操作系统会把空闲内存全部用于页缓存，Kafka 把数据写进日志后并不着急刷盘，先落在页缓存里就能响应，热数据消费直接命中页缓存——**追上进度的消费者在磁盘上几乎没有读活动**；网络发送还有零拷贝（sendfile）路径，数据从页缓存直接进网卡。所以 Kafka 的性能哲学是「把随机 IO 转成顺序 IO、把缓存交给 OS」，而不是在 broker 进程里维护一份自己的内存缓存。",
    },
    {
      type: "heading",
      text: "segment 滚动：什么时候开新段",
    },
    {
      type: "paragraph",
      text: "活跃段是「正在写入、还不能动」的段。滚动（roll）就是开一个以新 offset 开头的新段、让旧段退役。触发条件有两个（topic 级配置，继承自 broker 默认）：**大小**——达到 `segment.bytes`（默认 1 GiB，broker 侧 `log.segment.bytes`）就滚动；**时间**——即使没满，`segment.ms`（默认 7 天，broker 侧 `log.roll.ms`，未设时回退 `log.roll.hours`）到点也强制滚动，官方文档点明这是「为了确保保留策略能把旧数据删掉/压缩掉」——因为**清理永远以段为单位**，一个永不滚动的巨大活跃段会变成清理的死角。`segment.jitter.ms` 给滚动时间加随机抖动，避免整个集群在同一时刻集体滚动（thundering herd）。辅助配置：`segment.index.bytes` 限制索引文件大小（默认 10 MiB），`index.interval.bytes` 控制约每 4 KiB 数据写一条索引。",
    },
    {
      type: "callout",
      variant: "note",
      title: "段大小是保留粒度的刻度尺",
      body: "官方文档原话：保留与清理永远一次处理一个文件，所以段越大文件越少、但保留控制的粒度越粗。段大小默认 1 GiB 对大多数主题合适；吞吐高、磁盘贵的主题可以考虑调小段（如 256–512 MiB）换取更细的删除粒度，但代价是文件数与索引开销上升。",
    },
    {
      type: "heading",
      text: "delete 保留策略：按时间、按大小，整段删除",
    },
    {
      type: "paragraph",
      text: "默认 `cleanup.policy = delete` 下，broker 用两把尺子找「可删的段」，命中任意一把即删（官方：both policies enabled 时，任一策略判定可删就删）：",
    },
    {
      type: "list",
      items: [
        "**时间**：`retention.ms`——规则不是逐条消息计时，而是**看段内消息的最大时间戳**：一个段里最新消息超过 `retention.ms`（默认 7 天 = 604800000）后，整个段才可删；设 `-1` 表示不设时间上限。",
        "**大小**：`retention.bytes`——分区整体超过该字节数时，从最老的段开始删直到回到限制内；默认 `-1` 表示不限大小。注意它是**按分区**计的：主题可保留总量 ≈ retention.bytes × 分区数。",
        "两者都满足其一即可删；时间到了但段还是活跃段时，broker 会先把段滚动掉，让旧数据可被清理。",
      ],
    },
    {
      type: "paragraph",
      text: "于是就有了「到点不立即删」的直觉，原因有三层：**第一**，删除检查是异步的——日志清理线程按 `log.retention.check.interval.ms`（默认 5 分钟）周期扫描；**第二**，正在写入的活跃段不参与删除，得等它先滚动；**第三**，即使段被判定可删，还要过 `file.delete.delay.ms`（默认 60 秒）才真正从文件系统移除。所以 `retention.ms` 的准确语义是「**最早可删时间**」而不是「到点即消失」——过期消息多存活几分钟甚至更久都属正常。",
    },
    {
      type: "code",
      title: "观察：主题保留配置与数据目录（4.3 CLI）",
      language: "bash",
      code: "# 主题描述：第一行汇总分区/副本，Configs 列给出 topic 级配置\nbin/kafka-topics.sh --bootstrap-server localhost:9092 \\\n  --describe --topic orders.events\n# 输出形如：Topic: orders.events  PartitionCount: 12 ... Configs: retention.ms=604800000\n\n# 精确查看某主题的配置（含 override 与默认来源）\nbin/kafka-configs.sh --bootstrap-server localhost:9092 \\\n  --entity-type topics --entity-name orders.events --describe\n\n# 列出某分区目录下的 segment 文件（log.dirs 按你的部署定位）\nls -lh /tmp/kafka-logs/orders.events-0/",
    },
    {
      type: "paragraph",
      text: "把上面三个命令跑一遍（单节点学习环境即可），你会同时看到「配置里的 7 天」和「磁盘上一个 1 GiB 的 .log 文件」——保留策略和文件系统之间隔着的正是 segment 这道关卡。",
    },
    {
      type: "heading",
      text: "compaction：按 key 保留「最新值」",
    },
    {
      type: "paragraph",
      text: "delete 策略有个结构性的盲区：它对**每条消息独立有意义**的数据（订单事件、点击流、审计日志）很合适，但对「keyed 的当前状态」很浪费——`user.profile` 里 `u_10086` 改 100 次昵称就产生 100 条消息，可下游要的只是最后那条；`inventory.stock` 同理，`978-7-xxx` 库存从 100 改到 98 再改到 95，谁关心中间值？按时间删：留短了下游重建状态时缺数据，留长了全是垃圾副本。[日志压缩](glossary:compaction) 就是为此设计的第三种保留语义：**只保证每个 key 的最新值还在，旧值被后台回收**——把日志从「完整事件流」变成「可重放的最终状态」。",
    },
    {
      type: "code",
      title: "user.profile 的压缩效果（示意）",
      language: "text",
      code: "写入序列（key=user_id）：\n  u_10086 @offset 0   {\"city\":\"北京\"}\n  u_10087 @offset 1   {\"city\":\"深圳\"}\n  u_10086 @offset 2   {\"city\":\"上海\"}\n  u_10086 @offset 3   {\"city\":\"杭州\"}   ← 最新值，一定保留\n\n压缩之后，日志仍保持写入顺序，但被覆盖的旧值被清掉：\n  u_10087 @offset 1   {\"city\":\"深圳\"}\n  u_10086 @offset 3   {\"city\":\"杭州\"}\n\n注意 offset 2 的位置变成了空洞：offset 永不改变、顺序永不重排，\n从空洞处读取等价于读到下一个仍存在的消息（这里是 offset 3）。",
    },
    {
      type: "paragraph",
      text: "压缩由 broker 上的**日志清理器（log cleaner）**执行：一组后台线程（`log.cleaner.threads` 默认 1，`log.cleaner.enable` 默认开启）周期扫描，把日志分为「头部（head，保留全部新消息）」与「尾部（tail，可压缩）」，重写段文件时丢弃那些「在日志更靠后位置还有同 key 新版本」的旧消息，新段就位后原子替换旧段。这是纯后台动作：不阻塞读写，可限速，磁盘占用峰值只多一个段的量。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "压缩的语义边界：删除时机从不保证",
      body: "请把「每条消息写入后多久被清掉」这个问题从脑子里删掉——它没有答案。压缩是**尽力而为的后台回收**：默认要等脏数据（被覆盖的旧值）占日志比例达到 `min.cleanable.dirty.ratio`（默认 0.5，即一半是垃圾才动手）才有一次清扫，且活跃段永不参与压缩（官方原话：`The active segment will not be compacted even if all of its messages are older than the minimum compaction time lag`）；`min.compaction.lag.ms` 可设消息至少保留多久不被压缩，`max.compaction.lag.ms` 可强制「低写入速率主题」最多拖延多久必须清扫一次（默认无上限）。因此消费者可能仍读到旧值（旧值还没被清）、也可能读到最新值——能依赖的只有两条硬保证：① 每个 key 的最新值一定在；② 从 0 开始重放的消费者至少能看到每个 key 的最终状态（在 tombstone 保留期内，见下）。",
    },
    {
      type: "paragraph",
      text: "压缩还支持**删除语义**：写入一条 key 非空、value 为 null 的消息，就是删除标记（tombstone）——它会把该 key 的所有旧值清掉，适合表达「这个实体不存在了」：`user.profile` 里用户注销、`inventory.stock` 里某 ISBN 下架。tombstone 本身不会立刻消失，topic 配置 `delete.retention.ms`（默认 86400000，即 24 小时；broker 侧 `log.cleaner.delete.retention.ms`）决定它保留多久、之后连同它自己一起被清理：这个窗口同时也是「从 0 重放能拿到完整删除信息」的期限——落后超过 24 小时才从头读的消费者可能漏看删除标记。",
    },
    {
      type: "table",
      caption: "delete 与 compact 两种清理策略对照",
      headers: ["维度", "cleanup.policy=delete", "cleanup.policy=compact"],
      rows: [
        ["清理对象", "过期的整个 segment 文件", "每个 key 的旧值消息（散落在可压缩段中）"],
        ["判定依据", "时间（retention.ms）或大小（retention.bytes），段整体过期", "日志更靠后位置是否已有同 key 的更新版本"],
        ["何时真正执行", "异步：检查周期默认 5 分钟 + 文件删除延迟 60 秒 + 活跃段不动", "后台 cleaner 线程，默认脏数据比例 ≥ 0.5 或受 max.compaction.lag.ms 约束"],
        ["对消费者的保证", "超过保留期的消息整段消失", "每个 key 的最新值一定在；从 0 重放至少看到最终状态；offset 与相对顺序不变"],
        ["适用场景", "事件流/日志/审计——每条消息独立有意义", "keyed 状态/画像/引用数据——只关心最新值（user.profile、inventory.stock）"],
      ],
    },
    {
      type: "paragraph",
      text: "两套策略还能叠加：`cleanup.policy=delete,compact` 表示「先按时间/大小淘汰老段，再对留下的段做压缩」。对只想留近 30 天状态的画像主题是个常见组合，但要清醒：时间淘汰仍然可能把某个 key 的最新值整段删掉，所以凡是承诺「可随时重建完整当前状态」的主题，不要给时间维度过短的 delete。",
    },
    {
      type: "quiz",
      question: "书舟要为 inventory.stock 定清理策略。该主题 key=sku（ISBN），每条消息是「该 sku 当前可售库存」的新值；下游随时需要重建所有 sku 的当前库存快照，历史变更值没有保留价值。应选哪种配置？",
      options: [
        "cleanup.policy=delete，retention.ms=7 天——7 天后重建快照会缺早已停售、长尾 sku 的最新值",
        "cleanup.policy=compact——压缩保证每个 sku 至少保留最新值，从头重放恰好能重建完整快照",
        "cleanup.policy=compact 同时把 retention.ms 设成 1 小时，让旧值更快被清掉",
        "不设 cleanup.policy，只靠 retention.bytes 把主题总量限制在 1 GB",
      ],
      answer: 1,
      explanation: "这是典型的状态主题：下游要的是「每个 key 的最终值」，compact 正是为此设计——保留最新值、后台回收旧值，从头读至少看到最终状态。delete 会按时间/大小把段整段删掉，可能连最新值一起删，快照将无法完整重建；delete,compact 叠加时时间淘汰同样可能删掉最新值。",
    },
    {
      type: "heading",
      text: "tiered storage：本地热、远端冷（现状一句话）",
    },
    {
      type: "paragraph",
      text: "Kafka 4.3 官方文档已把分层存储（[KIP-405](https://cwiki.apache.org/confluence/display/KAFKA/KIP-405%3A+Kafka+Tiered+Storage)）作为 GA 特性单列运维章节：热数据留在 broker 本地盘，已滚动的段可上传到远端对象存储（S3/HDFS 类），本地只按 `local.retention.ms/bytes` 保留近期数据，远端按主题 `retention.ms/bytes` 整体保留——本地磁盘容量不再决定「能留多久」。但写进架构方案前要认清三件事：需要外挂 `RemoteStorageManager` 实现（Apache 发行版不内置，官方只提供接口与测试实现）；compacted 主题不支持分层；按主题用 `remote.storage.enable` 开启。一句话结论：分层存储解决「日志长留存 vs 本地磁盘有限」的冲突，选型与成本账留给第 9 章 [容量规划](/courses/kafka/lessons/kafka-capacity-tuning)。",
    },
    {
      type: "exercise",
      title: "动手：观察 segment、保留配置与压缩",
      description: "在第 1 章的单节点环境（[本地运行 Kafka 4.3（KRaft）与 CLI 初体验](/courses/kafka/lessons/kafka-kraft-quickstart)）里做三件事：① 对 orders.events 跑 kafka-topics.sh --describe 与 kafka-configs.sh --describe，读第一行 Configs 里的 retention.ms/segment.bytes 值；② 定位 broker 数据目录（log.dirs），ls 出 orders.events-0 下的 segment 文件，确认 .log/.index/.timeindex 三件套与 20 位补零命名，发一批消息后再次 ls，观察活跃段字节数增长；③ 创建 compacted 主题 user.profile（cleanup.policy=compact），对同一个 user_id 连续写 5~10 个不同值，反复 describe 或用 kafka-dump-log 观察段文件，体会「写入后旧值并不会立刻消失」。",
      hint: "压缩触发需要脏数据占比达到 min.cleanable.dirty.ratio（默认 0.5），所以要多写几轮同 key 消息再等待；想看单段内容可用 kcli kafka-dump-log.sh --files <段.log> 打印每条消息的 offset 与 key。",
    },
    {
      type: "keypoints",
      items: [
        "每个分区 = 一个 <topic>-<partition> 目录，内含一串 segment：.log 存消息，.index/.timeindex 提供定位；文件名 = 段内起始 offset（20 位补零）",
        "性能来自顺序写 + OS 页缓存 + 零拷贝：热数据消费几乎不碰磁盘；Kafka 不在进程内自建缓存",
        "滚动条件：segment.bytes（默认 1 GiB）或 segment.ms（默认 7 天）到点即滚——清理永远以「非活跃段」为单位",
        "delete 策略：retention.ms（默认 7 天，-1 不限）看段内最大时间戳、retention.bytes（默认 -1）按分区算；删除异步（5 分钟检查 + 60 秒延迟 + 活跃段不动），所以「到点不立即删」",
        "compact 策略：后台 cleaner 只保证每个 key 最新值在；删除时机不保证（默认脏数据占 50% 才清）；tombstone（value=null）表达删除，delete.retention.ms 默认 24 小时",
        "分层存储（KIP-405）在 4.3 已列 GA：本地热 + 远端冷，需自备 RemoteStorageManager，不支持 compacted 主题",
      ],
    },
  ],
};
