/* ==================================================================
 * 课时：批量、压缩与吞吐调优（kafka-producer-batching-throughput）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Kafka 4.x；Go 客户端 franz-go v1.21.x（pkg/kgo）。
 * 默认值均核对 franz-go v1.21.6 源码（pkg/kgo/config.go defaultCfg）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "Kafka 的吞吐来自批：组批参数与触发时机、压缩权衡、乱序风险、背压与内存，以及先调客户端还是先查 broker。",
  blocks: [
    {
      type: "paragraph",
      text: "大促压测时，「书舟书店」发现一个奇怪现象：orders 的下单事件 5000 条/s 发得轻松，而 analytics 的 `user.behavior` 主题压到 10 万条/s 时，producer 进程的 CPU 先顶不住了，broker 却还游刃有余。同样都是「发消息」，为什么差这么多？答案在上一课[生产者发送路径与 Record](/courses/kafka/lessons/kafka-producer-send-path)埋下的伏笔里：行为事件平均每条只有几百字节，而 Kafka 的性能基本单位从来不是「一条消息」，而是「一批消息」。",
    },
    {
      type: "heading",
      text: "吞吐从哪来：批是摊销的容器",
    },
    {
      type: "paragraph",
      text: "把 Kafka 想成[提交日志](glossary:commit-log)：broker 侧的成本大头是每个 Produce 请求的固定开销——网络往返与解析、leader 日志的追加与索引更新、acks 语义下等待副本确认的协议往返。注意一个常见误解：Kafka 并不逐条 fsync，刷盘由 broker 的刷盘策略合并进行（这正是它快的原因之一，存储细节见 [kafka-storage-segments-retention](/courses/kafka/lessons/kafka-storage-segments-retention)），所以「批摊薄磁盘同步」的说法并不准确——**批摊薄的是请求级固定开销**：同样 1000 条消息，逐条发是 1000 个请求、1000 次网络往返、1000 份协议头与确认，组进少数几个批次后只剩几十个请求。消息越小，固定开销占比越高，批的收益越大——这正是行为事件场景的命门。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "批的另一层含义：压缩的粒度",
      body: "Kafka 的压缩发生在批次级别而不是单条级别：一条 RecordBatch 整体用一个 codec 压缩，解压也整批进行。批越大、内容越相似，压缩率越好。所以「压缩省带宽」和「组批省请求」是同一件事的两面——小批上压缩的收益很有限，先组批再谈压缩。",
    },
    {
      type: "heading",
      text: "三个旋钮与触发时机",
    },
    {
      type: "table",
      caption: "franz-go 批量相关选项与默认值（v1.21.6，核对自源码 defaultCfg）",
      headers: ["选项", "默认", "作用"],
      rows: [
        ["kgo.ProducerLinger(d)", "10ms", "单个 topic-partition 的缓冲等待窗口：linger 到点就把该分区可发的批打出去（linger=0 则每来一条立即发，等于放弃组批）"],
        ["kgo.ProducerBatchMaxBytes(n)", "1,000,012 B", "单个 record batch（一个 topic-partition 的批）的字节上限，镜像 Kafka 的 max.message.bytes；单条编码后超过它会在客户端直接失败（MessageTooLarge）"],
        ["kgo.MaxBufferedRecords(n)", "10,000 条", "全客户端缓冲记录数上限：到顶后 Produce 阻塞（背压），见下文"],
        ["kgo.MaxBufferedBytes(n)", "无上限", "缓冲字节数上限；单条超过它会立即以 kerr.MessageTooLarge 失败"],
      ],
    },
    {
      type: "paragraph",
      text: "Franz-go 的组批以 topic-partition 为单元（每个分区一个缓冲队列），但 Produce 请求按 broker 聚合：某个分区触发发送时，同一请求会捎带其它分区已就绪的批，并重置它们的 linger 计时。批在四种情况下不再等待、立即发出：",
    },
    {
      type: "list",
      items: [
        "**linger 到点**：默认 10ms 一到，该分区缓冲里的批就绪发出。linger 同时是「延迟上限」和「批大小期望」的旋钮：期望批大小 ≈ 该分区每秒记录数 × linger。",
        "**批满即发**：一个批累积到 ProducerBatchMaxBytes（约 1 MiB）后封口，下一条记录开新批，同时旧批立即发出——不等 linger。",
        "**缓冲压力触发**：缓冲记录数逼近 MaxBufferedRecords 时，客户端会取消 linger 提前冲刷（源码中的 unlinger 逻辑），宁可多几个请求也别把内存打爆。",
        "**显式冲刷**：`Flush(ctx)`、`ProduceSync` 都会停止 linger 并立即 drain；上一课的退出流程靠的就是它。",
      ],
    },
    {
      type: "paragraph",
      text: "一个对齐细节：客户端批上限默认 1,000,012 B，broker/topic 的 `message.max.bytes` 默认 1,048,588 B（Kafka 4.3 官方文档），出厂即安全对齐。谁改都记得两侧同改：单条记录或单批超过 broker 上限时，broker 会回 `MESSAGE_TOO_LARGE`——即便客户端放行了，broker 照样拒收。",
    },
    {
      type: "code",
      title: "按目标延迟设定批量参数（示意配置）",
      language: "go",
      code: `cl, err := kgo.NewClient(
	kgo.SeedBrokers("127.0.0.1:9092"),
	// 行为事件：可接受 ~50ms 端到端延迟，把每分区批做大
	kgo.ProducerLinger(50*time.Millisecond),
	// 批上限对齐 broker 的 message.max.bytes（默认 1048588 B，见 Kafka 4.3 文档），
	// 显式写出来避免将来 broker 侧调小后产生 MessageTooLarge
	kgo.ProducerBatchMaxBytes(1_000_000),
	// 压缩喜好顺序：首选 zstd，broker 不支持则回退 snappy、再不济不压缩
	kgo.ProducerBatchCompression(
		kgo.ZstdCompression(),
		kgo.SnappyCompression(),
		kgo.NoCompression(),
	),
)`,
    },
    {
      type: "paragraph",
      text: "这里有个容易忽略的事实：**franz-go 默认就开压缩**——默认喜好是 `[snappy, none]`，即默认用 snappy。很多教程里「忘了配压缩」的担心在 franz-go 里不存在；你需要决策的是「要不要换成 zstd/gzip 换更高压缩比」，而不是「要不要压缩」。",
    },
    {
      type: "heading",
      text: "压缩算法：CPU 换带宽的菜单",
    },
    {
      type: "table",
      caption: "四种 codec 的定性权衡（franz-go 均内置；不要当 benchmark 用）",
      headers: ["codec", "CPU 开销", "压缩比", "延迟影响", "注意"],
      rows: [
        ["snappy（默认）", "低", "中低", "很小", "0.8 起支持，兼容面最广"],
        ["lz4", "低", "中", "很小", "追求低 CPU 时的另一选项"],
        ["zstd", "中", "高", "小", "Kafka 2.1+ 才支持；需 broker ≥ 2.1 且全部消费端能解"],
        ["gzip", "高", "高", "明显", "压缩比好但 CPU 贵，高吞吐下慎用"],
      ],
    },
    {
      type: "paragraph",
      text: "选型原则是「数据说了算」：JSON 文本类事件 zstd 通常最划算；已压缩格式（图片、gzip 过的日志）再压收益为负。生产上先小样压测比较 snappy 与 zstd 的吞吐/CPU/带宽三角，别背别人家的数字。压缩比再高，也救不了「每批只有 1 条」的发送模式——上一节的 callout 已经强调：压缩单位是整批。",
    },
    {
      type: "heading",
      text: "顺序、乱序与 in-flight",
    },
    {
      type: "paragraph",
      text: "顺序保证的第一条来自分区：同 key 同 [分区](glossary:partition)（[kafka-topics-partitions-keys](/courses/kafka/lessons/kafka-topics-partitions-keys)），跨分区无全局序——这条边界在 producer 侧同样成立。第二条来自客户端：franz-go 对同一分区的记录按序缓冲、按序 drain，成功路径严格保持 Produce 的调用顺序。真正的风险在「重试」：一个批次发出后网络失败，客户端重发它——如果此时后一个批次已经先发先成功，重发成功的旧批就落到了后面，乱序诞生；如果第一次其实已写入、只是响应丢了，重发还会产生**重复**。",
    },
    {
      type: "paragraph",
      text: "这就是[幂等生产者](glossary:idempotent-producer)存在的意义（机制细节下一课）：幂等开启时，每个批次带 (PID, 分区序列号)，broker 见到重复序列号直接返回成功不重复写，见到跳跃的序列号会拒绝后续批次直到缺口补上——于是「重试」从机制上既不会重复、也不会乱序。**默认开启幂等的 franz-go 里，批的乱序窗口被协议封死**；真正要担心的是有人手贱关掉幂等。",
    },
    {
      type: "paragraph",
      text: "in-flight 的含义：已经发出、尚未收到响应的 Produce 请求数。它决定单条链路上能同时「在路上」多少个请求，越多越能掩盖网络 RTT，但代价是 broker 必须容忍乱序到达的请求。Kafka 的约束是：幂等开启时每 broker 最多 5 个在途 Produce 请求（Kafka 1.0+），由客户端内部管理；`MaxProduceRequestsInflightPerBroker` 这个选项**只在关闭幂等时生效**——默认值 1，调大即打开乱序与重复的风险之门。关幂等 + 调大 inflight 的经典事故，下一课用书舟场景完整复盘。",
    },
    {
      type: "heading",
      text: "背压与内存：缓冲满了怎么办",
    },
    {
      type: "paragraph",
      text: "组批意味着消息要在进程里「等一会儿」，这批等待中的消息就是客户端缓冲。franz-go 用 `MaxBufferedRecords`（默认 10,000 条）做总闸：**缓冲达到上限后，`Produce` 会阻塞**，直到有空间——这就是背压，它把「broker 或网络跟不上」的压力反向传导给调用方，而不是让内存无限膨胀。等得不耐烦可以用 ctx 取消这次等待；不想阻塞的路径用 `TryProduce`，缓冲满时它立即以 `ErrMaxBuffered` 失败。客户端还提供 `BufferedProduceRecords()` / `BufferedProduceBytes()` 两个仪表，随时可看肚子里积了多少货——这是判断「producer 是否跟得上」的第一指标。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "内存上限要按最坏情况估算",
      body: "MaxBufferedRecords 管的是条数不是字节。极端情况下 10,000 条 × 每条接近 1 MB = 理论近 10 GB——所以生产上通常补一个 `MaxBufferedBytes` 做字节级保险（默认无上限，需显式设）。估算逻辑：进程内该 Client 的缓冲内存 ≈ min(缓冲条数, 达到上限前的实际值) × 平均消息大小 + 批编码/压缩的临时缓冲；要留出 2–3 倍余量。调大缓冲能扛住更久的 broker 抖动，代价是内存与故障恢复时的积压；调小则背压更早出现、调用方延迟更高。没有免费午餐，压测里找平衡。",
    },
    {
      type: "heading",
      text: "性能上不去：先调客户端，还是先查 broker？",
    },
    {
      type: "list",
      items: [
        "producer 进程 CPU 高、broker 空闲 → 查压缩 codec 与序列化开销（zstd/gzip 的 CPU、JSON 编解码是否在热点路径）",
        "延迟曲线呈「周期性台阶」且每批很小 → 查每分区吞吐与 linger：分区多而每分区速率低时，默认 10ms 只攒得出几 KB 的批",
        "Produce 调用耗时上升或 BufferedProduceRecords 持续增长 → 客户端缓冲到顶，背压生效：瓶颈在 broker 处理能力或网络，不是组批参数",
        "broker 侧 CPU/磁盘/网络先满 → 问题在 broker/主题设计（分区数、副本放大、页缓存），调客户端参数没用",
        "单分区的 key 热点（一个爆款 SKU 的库存事件全挤一区）→ 分区/键设计问题，见第 2 章",
      ],
    },
    {
      type: "paragraph",
      text: "判断口诀：**客户端参数决定「它能多快把货发出去」，broker 与主题决定「它接不接得下」**。先用 `BufferedProduceRecords` + broker 端指标把瓶颈定位到某一侧，再动手调——凭感觉先调 broker 或先调 linger，是调优最常见的空转。指标体系的完整讲法在第 9 章的观测课里。",
    },
    {
      type: "heading",
      text: "书舟行为事件：10 万条/s 的批量设定",
    },
    {
      type: "paragraph",
      text: "把上面的逻辑落到 `user.behavior`：假设单条事件压缩前约 600 B（浏览/加购的 JSON 估算值），那么 10 万条/s 的未压缩写带宽约 60 MB/s，压缩后（文本型事件，zstd）可能降到 15–20 MB/s——带宽不是问题。真正的约束是**批的大小由每分区的速率决定**。若主题按第 2 章方法估出 24 个分区（`user.behavior` 的设计值，见[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)），每分区约 4,167 条/s：默认 linger 10ms 下，每分区每批平均约 42 条、约 25 KB——这个量级下压缩收益还不明显，请求数却已经不少。把 linger 提到 50ms，每批约 208 条、约 125 KB；提到 100ms 则约 417 条、约 250 KB（接近默认批上限 1 MB 的四分之一）。",
    },
    {
      type: "code",
      title: "估算公式（示意：以压测为准）",
      language: "text",
      code: `每分区每秒记录数 = 主题总速率 / 分区数
期望批大小(未压缩) ≈ 每分区每秒记录数 × 平均单条字节 × linger
  例：4,167 条/s × 600 B × 0.05s ≈ 125 KB/批   （linger = 50ms 时）

目标：把每分区批做到几十 KB 以上（压缩才有肉、请求数才少），
同时接受"linger = 该批的最坏等待时间"这个延迟代价。
最终取值必须压测：真实数据压缩比、broker 规格、延迟预算都不一样。`,
    },
    {
      type: "paragraph",
      text: "书舟的推荐起点：行为事件可接受约 100ms 的延迟预算，所以 `ProducerLinger(20–50ms)` + zstd 优先 + 保留默认 1 MB 批上限；orders 关键事件要求低延迟，维持默认 10ms 或更低即可，因为单量（5000/s）本身不大。另注意：`ProduceSync` 会绕过 linger 立即发送，只适合低频关键路径，10 万条/s 的行为事件必须走异步 `Produce` + 背压 + 回调计数（[发送路径课](/courses/kafka/lessons/kafka-producer-send-path)示例的形态）。所有参数在压测环境跑出「延迟分位数、客户端 CPU、broker 负载」三条曲线后再定稿，别把估算当结论。",
    },
    {
      type: "paragraph",
      text: "批与压缩解决的是「快」，下一课解决「稳」：acks 决定确认到哪一步算成功，重试与幂等决定失败时会发生什么——吞吐调优的所有参数最终都要在可靠性约束下取值，也就是 [kafka-producer-reliability-acks](/courses/kafka/lessons/kafka-producer-reliability-acks) 的内容。",
    },
    {
      type: "keypoints",
      items: [
        "Kafka 的性能基本单位是批：批摊薄的是请求级固定开销（网络往返、协议、副本确认），Kafka 并不逐条 fsync",
        "组批参数：ProducerLinger 默认 10ms（延迟/批大小旋钮）、ProducerBatchMaxBytes 默认 1,000,012 B、MaxBufferedRecords 默认 10,000；批满、linger 到点、缓冲压力、显式冲刷四种时机立即发",
        "franz-go 默认就开 snappy 压缩；压缩作用于整批而非单条，codec 选择用数据压测说话",
        "同分区有序 + 幂等默认开启 ⇒ 重试既不重复也不乱序；关幂等后 inflight 默认降到 1，调大即开风险门",
        "MaxBufferedRecords 到顶时 Produce 阻塞形成背压；内存按条数×大小最坏情况估算，并补 MaxBufferedBytes 保险",
        "调优先定位：客户端缓冲上涨 = producer/网络瓶颈；broker 资源先满 = 主题/broker 问题——别凭感觉乱调",
      ],
    },
  ],
};
