/* ==================================================================
 * 课时：拓扑、KStream/KTable、状态与窗口（Java DSL 示意）（kafka-streams-dsl-topology）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 事实核对（2026-09-08）：Kafka 4.3.1。概念与 API 形态按
 * kafka.apache.org/43/streams/core-concepts、architecture、config-streams、
 * developer-guide/dsl-api 核对（2026-06/05 版文档）；窗口类拼写
 * TimeWindows.ofSizeAndGrace / SlidingWindows.ofTimeDifferenceAndGrace /
 * SessionWindows.ofInactivityGapWithNoGrace 均出自该文档示例。
 * 重要：Kafka Streams 仅提供 Java/Scala API（4.3 起 scala 封装弃用，
 * 5.0 移除）；本文 Java 片段全部是「机制示意」，标注不可直接运行。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Kafka Streams 的发动机拆解：source→processor→sink 拓扑心智、KStream/KTable/GlobalKTable 的流表二象、四类窗口、RocksDB 状态与 changelog 容错；Java DSL 片段均显著标注为“示意”，因为官方没有 Go API。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课[流处理心智模型与引擎选型](/courses/kafka/lessons/kafka-streaming-model)把引擎版图和 Go 生态现实讲清了。这一课假设你（或团队里的 JVM 同事）选了 **Kafka Streams 这条最主流的路线**，把它的机制层一次看透：[拓扑（topology）](glossary:topology)、KStream/KTable、[窗口](glossary:window)、RocksDB 状态与 changelog 容错。必须先把丑话说在前面：**Kafka Streams 只提供 Java/Scala API，没有 Go 版**（`kafka-streams-scala` 封装自 4.3 起被弃用、5.0 移除，官方只剩 Java DSL）。所以本课的代码全部是**教学示意**——拼写已对照 4.3 官方文档核对，但为了聚焦机制省略了 Serde/JSON 解析等工程细节，不可直接编译运行。你作为 Go 工程师读它的目的不是学 Java，而是：ksqlDB 的 SQL 最终编译成同样的拓扑，Flink 的状态/窗口思想也同源——**这套概念值得用任何一种语言的角度理解一遍**。",
    },
    {
      type: "heading",
      text: "Topology 心智模型：一张有向处理图",
    },
    {
      type: "paragraph",
      text: "Kafka Streams 把一次流计算表达成一张 **processor topology（处理器拓扑）**——一个有向图，节点是处理器，边是数据流。官方对节点的分类只有四种，记住它们，整门流处理的地图就有了：",
    },
    {
      type: "code",
      title: "拓扑的四个角色（text 图：书舟营收管道）",
      language: "text",
      code: `source processor（源）：消费输入主题，把记录推进图里
   └─ orders.events ─┐
                     ▼
          processor（处理器）：map/filter/groupBy……逐条加工
                     ▼
          state store（状态存储）：聚合/窗口/join 的中间状态（RocksDB）
                     ▼
sink processor（汇）：把结果写回输出主题
   └─ metrics.order.revenue ─┐

拓扑图例（简化）：
orders.events ──[filter: event=order.paid]──>[按 sku 分组]──>[5 分钟窗口 SUM]
                                                              │
                                                              ▼
                                                 metrics.order.revenue（sink 主题）`,
    },
    {
      type: "list",
      items: [
        "**source**：没有上游的入口节点，用消费者从主题拉记录；它背后就是第 4 章那套消费组机制——多个应用实例会自动瓜分输入主题的分区",
        "**processor**：加工节点。DSL 的每个算子（map/filter/aggregate……）都会被编译成若干个底层处理器",
        "**state store**：有状态算子的本地存储（默认 RocksDB），每个任务实例一份，见本课后半",
        "**sink**：没有下游的出口节点，把结果写回主题（等价于一个生产者）",
      ],
    },
    {
      type: "paragraph",
      text: "工程上的两个推论先记住：**① 一个应用可以包含多个拓扑/子拓扑**，节点按输入分区数复制成多个并行任务（stream task）执行——**应用最大并行度 = 输入主题分区数**，加实例/加线程（`num.stream.threads`）都是在已有任务间搬运工作，这与第 4 章「消费组并行度上限=分区数」是同一件事；**② 拓扑的容错单位是任务**：某实例崩溃，它的任务连同本地状态会迁移到别的实例（详见「状态存储」一节）。",
    },
    {
      type: "heading",
      text: "DSL 概览：先把“手”认全",
    },
    {
      type: "paragraph",
      text: "DSL 算子分两类。**无状态类**处理每条记录时不需要看历史：`map`/`mapValues`（一进一出、可换键/值）、`filter`/`filterNot`（按谓词保留/丢弃）、`split()`（按谓词把一个流分支成多个，老教程常叫 branch，4.3 文档主推 `split().branch(...).defaultBranch(...)` 形态）、`merge`（合并两个流）、`peek`（旁路观察不改变流）、`foreach`（终端的副作用动作）。有一条贯穿全章的规则：**改了 key 的算子（`map`、`selectKey`、`groupBy`）会给流打上“需要重分区”标记**——因为「同 key 同分区」是后续聚合/join 正确性的前提，Streams 会在内部用重分区主题（repartition topic）按新 key 重新分布；只想改 value 就永远优先用 `mapValues` 避开重分区。",
    },
    {
      type: "code",
      title: "示意：无状态算子链（Java DSL；机制示意，非完整工程）",
      language: "java",
      code: `// 示意——Kafka Streams 仅提供 Java/Scala API；省略了 JSON Serde 等细节
StreamsBuilder builder = new StreamsBuilder();

// source：orders.events，key=order_id(String)，value=事件 JSON(String)
KStream<String, String> orders =
    builder.stream("orders.events", Consumed.with(Serdes.String(), Serdes.String()));

// 只留已支付事件；mapValues 不改 key，不触发重分区
KStream<String, String> paid =
    orders.filter((orderId, json) -> parseEventType(json).equals("order.paid"))
          .mapValues(json -> json); // 真实工程这里通常是 JSON→对象→JSON 的转换

// 把两个主题的事件合流（各自分区内顺序保留，跨流无顺序承诺）
KStream<String, String> combined = paid.merge(otherSource);`,
    },
    {
      type: "heading",
      text: "有状态第一步：groupBy + 聚合",
    },
    {
      type: "paragraph",
      text: "聚合是「把多条记录归并成一条」，必须有状态记住进行中的值。DSL 的路径固定为三步：`groupByKey`/`groupBy` 得到 `KGroupedStream` →（可选）`windowedBy` 加窗口 → `count`/`reduce`/`aggregate` 产出 `KTable`。`groupByKey` 用现有 key（不重分区，除非流已被标记）；`groupBy` 换新 key（**总是触发重分区**）。书舟例子：`orders.events` 的 key 是 `order_id`，想按事件类型计数就得 `groupBy((k, v) -> 事件类型)`——新 key 是事件类型，Streams 自动用重分区主题把「同类型的事件」聚到同一分区，之后的计数才正确。",
    },
    {
      type: "code",
      title: "示意：groupBy + count（Java DSL；机制示意）",
      language: "java",
      code: `// 示意——groupBy 换 key 会触发一次内部重分区（repartition topic）
KGroupedStream<String, String> byType =
    orders.groupBy((orderId, json) -> parseEventType(json),
                   Grouped.with(Serdes.String(), Serdes.String()));

KTable<String, Long> typeCounts = byType.count(); // 每类事件至今的总数`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "为什么聚合的输出是 KTable 而不是 KStream？",
      body: "因为聚合值会被**持续修正**：新事件到达，同一 key 的累计值更新（如 out-of-order 事件迟到，旧值还要再改一次）。「每个 key 当前的最新累计值」正是表的语义（同 key 覆盖），所以官方文档明确：DSL 聚合的产出永远是 KTable。这也是「流与表二象」的第一个实例。",
    },
    {
      type: "heading",
      text: "KStream vs KTable vs GlobalKTable：流与表的二象性",
    },
    {
      type: "paragraph",
      text: "DSL 的核心抽象是把[第 1 章「提交日志」心智](glossary:commit-log)用类型显式化：**KStream（流）= 每条记录都是 INSERT**——它对应 append-only 主题（如 `orders.events`、`user.behavior`），同 key 的两条记录不会被合并，sum(alice:1, alice:3) = 4；**KTable（表）= 每条记录都是对同 key 旧值的 UPSERT**——它对应 changelog/compacted 主题（如 `inventory.stock`、`user.profile`），同 key 的新记录覆盖旧值，sum(alice:1, alice:3) = 3，且 **value 为 null 的记录是删除该 key 的 tombstone**。官方文档对二者有一句很准的话：把 KTable 存进主题时你应该开[日志压缩](glossary:compaction)，而 KStream 绝不能开——压缩会删掉 `(alice, 1)` 那条历史，流的语义就坏了。",
    },
    {
      type: "code",
      title: "示意：把 compacted 主题读成 KTable（Java DSL；机制示意）",
      language: "java",
      code: `// inventory.stock 是 compacted 主题，key=sku；这里假设 value 可直接反序列化为余量
// （真实工程若 value 是 JSON，则配一个 JSON Serde 再 mapValues 成数值）
KTable<String, Long> stock =
    builder.table("inventory.stock",
                  Consumed.with(Serdes.String(), Serdes.Long()),
                  Materialized.as("stock-current")); // 给状态存储起名，供查询/恢复使用`,
    },
    {
      type: "paragraph",
      text: "**GlobalKTable** 是 KTable 的特殊变体：每个应用实例都载入**主题全部分区**的完整副本（普通 KTable 每个实例只载入分给它那部分）。代价是本地存储与网络放大（全量数据 × 实例数），换来两个能力：join 时**不需要 co-partition**，还能按**记录 value 里的字段**（外键）查表——适合把小字典广播到每个实例做「星型 join」富化。书舟例：把「sku → 商品资料/类目」读成 GlobalKTable（数据量小、全量无压力），订单流按 value 里的 sku 现场补上商品信息。",
    },
    {
      type: "table",
      caption: "三种抽象一句话对照（用库存/画像主题举例）",
      headers: ["抽象", "记录语义", "实例持有的数据", "典型来源主题", "典型用途"],
      rows: [
        ["KStream", "INSERT：每条独立事实，永不合并", "输入主题的部分分区", "orders.events / user.behavior（append-only）", "过滤、转换、作为 join 的“事件侧”"],
        ["KTable", "UPSERT：同 key 覆盖；null value=删除", "输入主题的部分分区", "inventory.stock / user.profile（compacted）", "维护每个 key 的最新状态，作 lookup 侧"],
        ["GlobalKTable", "UPSERT，同 KTable", "输入主题的**全部分区**（每实例一份全量）", "sku 商品字典等小表", "广播字典 + 免 co-partition / 按 value 外键 join"],
      ],
    },
    {
      type: "heading",
      text: "join 族：把两股数据对起来",
    },
    {
      type: "paragraph",
      text: "DSL 的 join 按「两侧是什么」区分，规则很简单：**KStream-KStream** join 永远是**带窗口**的（无界流不设时间窗，缓存会无限增长）；**KStream-KTable** join 是流到表的**非窗口点查**（来一条流记录，查表当前值，如用最新用户画像富化行为流）；**KTable-KTable** join 是两个 changelog 的按 key 合并；**KStream-GlobalKTable** join 是点查全量表（支持按 value 字段查）。关键前提（co-partition）：除 GlobalKTable 外，join 两侧的输入**必须同分区数、同分区策略**——`orders.events`(key=order_id) 与 `payment.results`(key=order_id) 分区数相同就能 join；而 `user.behavior`(key=user_id) 与按 sku 键的表 join 前必须先把流重分区成 sku 键。这条约束呼应第 2 章：**主题的分区数/键设计在创建时就要想好未来要不要 join**（[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)）。",
    },
    {
      type: "code",
      title: "示意：KStream-KTable 富化 join（Java DSL；机制示意）",
      language: "java",
      code: `// user.behavior 与 user.profile 都以 user_id 为 key 且分区数相同 → 满足 co-partition
// 左侧流：行为事件；右侧表：该用户的最新画像
KTable<String, Profile> profiles = builder.table("user.profile", /* …serde… */);
KStream<String, Behavior> behaviors = builder.stream("user.behavior", /* …serde… */);

// 每条行为事件到达时，查出该用户当前画像拼进结果；查不到则左值保留（leftJoin）
KStream<String, Enriched> enriched =
    behaviors.leftJoin(profiles, (behavior, profile) -> enrich(behavior, profile));`,
    },
    {
      type: "heading",
      text: "窗口：把无界流切成有界片段",
    },
    {
      type: "paragraph",
      text: "「每 5 分钟营收」要求引擎把无界流按时间切成片段再聚合，这就是[窗口](glossary:window)。窗口按**记录的时间戳**推进：默认取 Kafka 消息自带的时间戳（主题 `message.timestamp.type` 为 `CreateTime` 时即生产方写入的事件时间；也可用 `TimestampExtractor` 按消息里的字段重定义），所以**乱序事件会回到它该属的窗口**——引擎用 **grace period（宽限期）** 控制等乱序多久：窗口结束后宽限期内到达的迟到记录仍被纳入；超过宽限期就被丢弃。Kafka Streams 提供四类窗口，各自语义与书舟用例：",
    },
    {
      type: "table",
      caption: "四类窗口：定义 + 书舟用例（Kafka Streams 4.3）",
      headers: ["窗口", "语义", "书舟用例"],
      rows: [
        ["Tumbling（滚动）", "固定大小、不重叠、无空隙；一个记录只属一个窗口；与 epoch 对齐，左闭右开（如 5 分钟窗边界 [10:00, 10:05)）", "每 5 分钟的订单营收/各事件类型计数看板"],
        ["Hopping（跳跃）", "固定大小、可重叠：size + advance（hop）；记录可属多个窗口；与 epoch 对齐", "「过去 30 分钟销售额」每 5 分钟刷新一次——用 size 30min、advance 5min，产生重叠的滑动视野（注意：Kafka Streams 术语里 hopping=重叠时间窗，sliding 另有其义）"],
        ["Sliding（滑动）", "大小固定但按记录时间对齐的“连续滑窗”：两条记录同窗当且仅当时间差 ≤ 窗长；用于 KStream-KStream join（`JoinWindows`）与滑动聚合（`SlidingWindows`）", "「下单后 5 分钟内完成支付」：order.created 与 payment.results 做 5 分钟窗口 join"],
        ["Session（会话）", "按 key 独立、大小不固定：以不活动间隙（inactivity gap）切分，间隙内的活动合并进同一会话", "把 user.behavior 切成“一次逛店”：同一用户相邻事件间隔 > 30 分钟就算新会话，统计每次会话浏览页数与时长"],
      ],
    },
    {
      type: "code",
      title: "示意：滚动窗口计数 + 会话窗口（Java DSL；拼写对照 4.3 文档）",
      language: "java",
      code: `// 5 分钟滚动窗口，宽限期 1 分钟（等乱序的迟到事件）
KTable<Windowed<String>, Long> per5min = byType
    .windowedBy(TimeWindows.ofSizeAndGrace(Duration.ofMinutes(5), Duration.ofMinutes(1)))
    .count(Materialized.as("orders-by-type-5min"));

// 会话窗口：同一 key 相邻事件间隙 > 30 分钟则开新会话（user.behavior 会话化）
KTable<Windowed<String>, Long> sessions = behaviorByUser
    .windowedBy(SessionWindows.ofInactivityGapWithNoGrace(Duration.ofMinutes(30)))
    .count(Materialized.as("user-sessions"));

// 窗口化结果要写主题时，通常把 Windowed 键还原成业务键（窗口边界在键里，也可显式取出）
per5min.toStream((windowedKey, count) -> windowedKey.key())
       .to("metrics.order.type.5min", Produced.with(Serdes.String(), Serdes.Long()));`,
    },
    {
      type: "callout",
      variant: "note",
      title: "窗口聚合的“更新”语义：同一窗口会被反复输出",
      body: "窗口化聚合默认是**持续更新**的：窗口内每来一条事件，就会向下游再发一次该窗口的当前值（窗口关闭后、宽限期内也还可能被迟到事件修正）。所以下游看到的是「同一 (key, 窗口) 的多条覆盖更新」，消费方要么按 key 覆盖展示（看板场景正合适），要么只取最终值——需要「窗口关闭才输出」的最终结果时，Streams 有专门机制（官方 DSL 文档 “Window Final Results” 一节；ksqlDB 里的对应物是 `EMIT FINAL`，下一课出现）。这是流式聚合与 SQL `GROUP BY` 最反直觉的一点，务必记住。",
    },
    {
      type: "heading",
      text: "状态存储：RocksDB 本地状态 + changelog 容错",
    },
    {
      type: "paragraph",
      text: "聚合/窗口/join 的中间结果放哪？Kafka Streams 的答案是**每个任务实例一块本地状态存储（state store）**，默认实现是内嵌 **RocksDB**（持久化 KV，落盘在 `state.dir` 目录；官方配置里 DSL 默认存储供应商就是 RocksDB），另有内存实现可选。**本地状态本身不是高可用的**——它的容错靠一条配套的 **changelog 内部主题**：每次状态更新都会作为记录追加到 changelog（主题开[日志压缩](glossary:compaction)以便安全清理旧值），当任务因故障或[再平衡（rebalance）](glossary:rebalance)迁移到别的实例时，新实例先**重放 changelog 把状态恢复到崩溃前**，再恢复处理（官方架构文档原话：完全恢复所有状态存储后才会继续处理）。想缩短恢复时间，可配 `num.standby.replicas`（默认 0）让别的实例预热一份备用副本，任务迁移时直接接管。",
    },
    {
      type: "paragraph",
      text: "这套设计与第 4、5 章的知识严丝合缝：实例协调 = 消费组协议（`application.id` 就是组 id）；changelog 写入 = 引擎内部的生产者；启用 `processing.guarantee=exactly_once_v2` 后，**位点提交、状态更新、结果输出在同一个事务里原子完成**——崩溃后既不会丢状态也不会输出重复结果（闭环内）。你甚至可以像看普通主题一样用 `kafka-topics.sh` 观察到这些内部主题：",
    },
    {
      type: "code",
      title: "观察 Streams 的内部主题（4.3 CLI；kcli 是 Docker 方式的前缀函数）",
      language: "bash",
      code: `# 假设应用 application.id=bookboat-revenue，输入主题 orders.events(12 分区)
# 列出以应用名开头的内部主题
kcli kafka-topics.sh --bootstrap-server localhost:9092 --list | grep bookboat-revenue

# 典型输出（示意）：
# bookboat-revenue-orders-by-type-5min-changelog   ← 状态存储的 changelog（compacted）
# bookboat-revenue-KSTREAM-AGGREGATE-xxx-repartition ← 换 key 触发的重分区主题（名称含自动生成片段）

# 查看应用消费组（Streams 应用就是一个消费组，组 id = application.id）
kcli kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\
    --describe --group bookboat-revenue`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "内部主题命名：前缀是 application.id，自动名会变（4.1+ 有解）",
      body: "内部主题名以 `application.id` 为前缀，changelog 形如 `<application.id>-<状态存储名>-changelog`；重分区主题等**自动生成的名称里包含算子序号等派生片段**——拓扑一改（哪怕只是加一个 filter），自动名就可能变化，历史内部主题变孤儿。Kafka 4.1 引入配置 `ensure.explicit.internal.resource.naming`（默认 `false`）配合 KIP-1111：开启后要求所有内部资源显式命名（DSL 里用 `Named.as(...)`/`Repartitioned.as(...)` 等给算子起名），名字变得可预测，**改动拓扑也能保住既有内部主题与状态**。4.1 官方发布说明的原话：它让内部主题名可预测，允许调整拓扑后仍复用已有主题。生产 Streams 应用建议了解该配置。",
    },
    {
      type: "heading",
      text: "一个完整的 Java DSL 示例（示意）",
    },
    {
      type: "paragraph",
      text: "把上面的零件拼成一个书舟小应用：消费 `orders.events`，只统计已支付事件，按 sku（假设事件值里带该字段，真实字段以第 6 章契约为准）开 5 分钟滚动窗口算营收。代码每处都加了「示意」注记：**它不可直接运行**——真实工程还需配 JSON Serde、给窗口化键配序列化器、处理反序列化异常等，这些与机制无关的细节正是本课裁剪掉的。",
    },
    {
      type: "code",
      title: "示意——Kafka Streams 仅 Java/Scala（4.3 起 Scala 封装弃用）；Go 项目请按「流处理心智模型与引擎选型」课选型",
      language: "java",
      code: `// 注意：示意代码——拼写对照 kafka.apache.org/43 文档，但省略 Serde 等工程细节，不可直接编译运行
import java.time.Duration;
import java.util.Properties;
import org.apache.kafka.common.serialization.Serdes;
import org.apache.kafka.streams.*;
import org.apache.kafka.streams.kstream.*;

public class RevenueApp {
    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(StreamsConfig.APPLICATION_ID_CONFIG, "bookboat-revenue"); // 组 id + 内部主题前缀
        props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass().getName());
        props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass().getName());
        // 需要「读-处理-写」闭环精确一次时（见「流处理心智模型与引擎选型」课的语义讨论）：
        // props.put(StreamsConfig.PROCESSING_GUARANTEE_CONFIG, StreamsConfig.EXACTLY_ONCE_V2);

        StreamsBuilder builder = new StreamsBuilder();

        // ① source：订单事件（key=order_id，value=JSON，示意按字符串处理）
        KStream<String, String> orders =
            builder.stream("orders.events", Consumed.with(Serdes.String(), Serdes.String()));

        // ② 无状态加工：只留已支付事件；把 key 换成 sku（groupBy 会触发内部重分区）
        KStream<String, String> paid = orders.filter((id, json) -> parsePaid(json));
        KGroupedStream<String, String> bySku = paid.groupBy(
            (orderId, json) -> parseSku(json), Grouped.with(Serdes.String(), Serdes.String()));

        // ③ 5 分钟滚动窗口求和（金额单位：分）；窗口化聚合产物是 KTable（持续更新）
        KTable<Windowed<String>, Long> revenue = bySku.windowedBy(
                TimeWindows.ofSizeAndGrace(Duration.ofMinutes(5), Duration.ofMinutes(1)))
            .aggregate(
                () -> 0L,                                   // 初始值
                (sku, json, agg) -> agg + parseAmount(json), // 累加器
                Materialized.as("revenue-5min"));

        // ④ sink：写回输出主题，key 还原为 sku
        revenue.toStream((wk, sum) -> wk.key())
               .to("metrics.order.revenue.5min", Produced.with(Serdes.String(), Serdes.Long()));

        // ⑤ 启动（常驻运行；同 application.id 多实例自动分摊输入分区）
        KafkaStreams streams = new KafkaStreams(builder.build(), props);
        streams.start();
        Runtime.getRuntime().addShutdownHook(new Thread(streams::close));
    }

    // —— 以下为示意用的占位解析（真实工程换成 JSON Serde + 事件对象）——
    static boolean parsePaid(String json)    { return json.contains("\\"order.paid\\""); }
    static String parseSku(String json)      { return "sku-parse-placeholder"; }
    static long parseAmount(String json)     { return 0L; }
}`,
    },
    {
      type: "quiz",
      question:
        "书舟要为「每次逛店」生成行为特征：把同一用户在 user.behavior 上相邻间隔不超过 30 分钟的活动合并为一次会话，统计会话内浏览页数与时长。应选哪种窗口？",
      options: [
        "Tumbling 窗口：固定 30 分钟切片，简单且与 epoch 对齐",
        "Hopping 窗口：size 30 分钟、advance 5 分钟，保证会话不重叠",
        "Sliding 窗口：按记录时间差判同窗，天然支持任意时长会话",
        "Session 窗口：按不活动间隙切分，会话长短由数据决定、按 key 独立",
      ],
      answer: 3,
      explanation:
        "会话的特征是「长度未知、由间隙决定、按 key 独立」——这正是 Session 窗口的语义（正确选项）。Tumbling/Hopping 是固定时长且与 epoch 对齐，会把跨整点边界的真实会话拦腰切开；Sliding 面向 join 时间窗与固定时间差的聚合，不按间隙动态合并。识别标志：需求语言里有「N 分钟无操作视为结束」→ session。",
    },
    {
      type: "keypoints",
      items: [
        "拓扑四角色：source（消费主题）→ processor（加工）→ state store（本地状态）→ sink（写回主题）；最大并行度=输入分区数，实例靠消费组协议协调（组 id=application.id）",
        "无状态算子：map/mapValues/filter/split/merge；改 key 的算子触发内部重分区，只改 value 用 mapValues 避开",
        "聚合路径：groupByKey/groupBy → (windowedBy) → count/reduce/aggregate → 产物永远是 KTable（值会被持续修正）",
        "流表二象：KStream=INSERT（append-only 主题）；KTable=UPSERT（compacted 主题，null value=删除）；GlobalKTable=每实例全量副本，免 co-partition、支持按 value 外键查",
        "join 族：KStream-KStream 必带窗口；KStream-KTable 是点查富化；KTable-KTable 按 key 合并；GlobalKTable join 免 co-partition——除 GlobalKTable 外都要求两侧同分区数同分区策略",
        "窗口四型：Tumbling（固定不重叠）/Hopping（固定可重叠）/Sliding（时间差同窗，join 用 JoinWindows）/Session（间隙切分、按 key 独立）；grace period 决定等乱序多久",
        "状态容错：RocksDB 本地状态 + compacted changelog 主题；任务迁移时重放 changelog 恢复（num.standby.replicas 可预热）；processing.guarantee=exactly_once_v2 时位点/状态/输出原子提交",
        "内部主题以 `application.id` 为前缀（changelog 形如 `<application.id>-<store>-changelog`）；4.1+ 的 `ensure.explicit.internal.resource.naming` 强制显式命名，让拓扑可演化而状态可保留",
        "再次强调：Kafka Streams 仅 Java/Scala（scala 封装 4.3 起弃用）；本课 Java 片段全部是机制示意，Go 团队选型回看[流处理心智模型与引擎选型](/courses/kafka/lessons/kafka-streaming-model)",
      ],
    },
    {
      type: "paragraph",
      text: "这一课的机制在下一课会以另一种面目重逢：**[ksqlDB：用 SQL 做流处理](/courses/kafka/lessons/kafka-ksqldb-streaming-sql)** 把 Streams 的拓扑/窗口/状态封装成 SQL 关键字——`GROUP BY` 对聚合、`WINDOW TUMBLING` 对 `TimeWindows`、物化表对 KTable——你会立刻认出它们。届时我们会在 ksqlDB 里把「实时营收」这条管道真正用 Go 消费端跑通。",
    },
  ],
};
