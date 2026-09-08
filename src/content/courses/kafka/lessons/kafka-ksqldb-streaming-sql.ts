/* ==================================================================
 * 课时：ksqlDB：用 SQL 做流处理（kafka-ksqldb-streaming-sql）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 事实核对（2026-09-08）：SQL 关键字/语法按官方文档核对
 * （docs.ksqldb.io：CREATE STREAM、CREATE TABLE AS SELECT、SELECT
 * (Push/Pull Query)、Time and Windows、Queries 概念页，最近更新
 * 2024-10-28）。版本提示：ksqlDB 文档非随 Kafka 4.x 同步发布，
 * 涉及版本兼容处均注明「以官方文档为准」。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "ksqlDB 把上一课的 Streams 机制包成独立服务与 SQL：CREATE STREAM/TABLE 注册与派生、pull/push/persistent 三种查询的区别，以及一条“订单流 → 5 分钟营收物化表 → Go 消费展示”的端到端管道。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课[拓扑、KStream/KTable、状态与窗口](/courses/kafka/lessons/kafka-streams-dsl-topology)你把 Kafka Streams 的机制看透了。本课的主角 [ksqlDB](glossary:ksqldb) 是同一套机制的**SQL 化外壳**：它把「写 Java 拓扑」变成「写 SQL 语句」，把「自己部署一个流服务」变成「连上一个 ksqlDB server」。对你这样的 Go 团队，它正是[流处理心智模型课](/courses/kafka/lessons/kafka-streaming-model)选型决策表里的「路 B」——不写 Java，把窗口/物化/容错交给引擎，Go 只消费结果。本课所有 SQL 关键字与行为均按官方文档表述；因为 ksqlDB 的版本节奏独立于 Kafka 4.x，涉及版本差异处我会明确标注「以官方文档为准」。",
    },
    {
      type: "heading",
      text: "定位与架构：一个“会说 SQL 的 Streams”",
    },
    {
      type: "paragraph",
      text: "官方对 ksqlDB 的定义是「基于 Kafka Streams 的流式数据库」：一条 `CREATE ... AS SELECT` 语句提交后，服务端把它**编译成一个 Kafka Streams 拓扑并常驻执行**——你上一课学的 source/processor/sink、RocksDB 状态、changelog、窗口全部在底层原样发生，只是由 server 进程替你管理。它与业务服务完全解耦：你不需要在自己的 Go 进程里嵌入任何东西，只通过两种接口打交道——**SQL/HTTP**（定义查询、push/pull）和**Kafka 主题**（结果落盘后任何客户端都能消费）。架构上值得记住的就一句话：**ksqlDB 是独立 server，SQL 层基于 Kafka Streams；同一 `ksql.service.id` 下的多个 server 组成一个 ksqlDB 集群**（查询定义共享，server 故障时的接管/HA 细节以官方 “High availability” 文档为准；教学单机即可）。",
    },
    {
      type: "callout",
      variant: "note",
      title: "版本边界：ksqlDB 与 Kafka 4.x 不是同一条发布线",
      body: "ksqlDB 由 Confluent 主导开源（镜像如 `confluentinc/cp-ksqldb-server`），其版本号走**独立发布线**（与 Apache Kafka 的 4.x 不同步），KRaft-only 集群上要用支持对应 Kafka 版本的 ksqlDB 发行版。动手前先查官方 quickstart / 兼容性说明，不要默认「最新镜像一定配得上你的 4.3 broker」——本课不写死具体版本号，命令均标注为教学示意。",
    },
    {
      type: "heading",
      text: "STREAM vs TABLE：先注册，再派生",
    },
    {
      type: "definition",
      term: "注册（registration）与派生（derivation）",
      definition:
        "`CREATE STREAM`/`CREATE TABLE` 只是给**已存在的主题**声明 schema 并注册一个逻辑名（不复制数据、不建新主题）；`CREATE STREAM/TABLE AS SELECT`（CSAS/CTAS）则是运行一个**持久查询**，把结果写进一个新主题并持续更新。前者是「给数据起名字」，后者是「派生出新数据」。",
    },
    {
      type: "table",
      caption: "ksqlDB 里 STREAM 与 TABLE 的对照（摘自官方 CREATE 文档）",
      headers: ["", "STREAM", "TABLE"],
      rows: [
        ["数据模型", "不可变、只追加的事件集合（历史事实）", "可变集合：同 key 后到者覆盖先到者（模型变化）"],
        ["键列声明", "`KEY` 列（可 NULL，同 key 无特殊处理）", "`PRIMARY KEY` 列（非空；后到同 key 记录**替换**旧行）"],
        ["对 null 值的消息", "忽略（不产生行）", "视为 tombstone：删除该 key 的现有行"],
        ["Kafka 侧的映射", "普通事件流只能追加（如 orders.events）", "适合 changelog / compacted 主题（如 inventory.stock）"],
        ["典型产物", "CSAS 派生流（过滤/转换后的新事件流）", "CTAS 派生物化表（聚合/join 的持续更新结果）"],
      ],
    },
    {
      type: "paragraph",
      text: "「流与表二象」在 ksqlDB 里就是 STREAM/TABLE：对 `orders.events` 这种 append-only 主题声明 STREAM；对 `user.profile` 这种 compacted 主题声明 TABLE。记住官方那句对照：**流的同 key 两条消息互不知晓，表的同 key 后者覆盖前者**——这与上一课 KStream/KTable 的语义完全一致，只是 `KEY` 换成了 `PRIMARY KEY` 的表达。",
    },
    {
      type: "heading",
      text: "三种查询：persistent / push / pull",
    },
    {
      type: "paragraph",
      text: "官方把查询明确分成三类，混用是新手第一大坑：**持久查询（persistent）** = `CREATE ... AS SELECT`，常驻服务端、结果持续写入新主题，是「建管道」；**push 查询** = 客户端发起、**订阅结果的实时变化**，REST 返回一条不结束的 chunked 响应，结果**不落主题**，是「实时订阅」；**pull 查询** = 客户端发起、**取当前值即返回**（像查数据库），基于物化表增量维护的低延迟点查，是「请求-响应」。pull 与 push 的关键差异：pull 只支持对**已物化**的数据做有限查询（默认要求对键列做等值过滤；窗口表可再加 WINDOWSTART/WINDOWEND 范围；全表扫描需显式开启 `ksql.query.pull.table.scan.enabled`），不支持 `GROUP BY`/`WINDOW`/`JOIN`——**聚合必须事先用 CTAS 物化好，pull 才能查**。push 则支持完整 SQL（过滤、分组、join）。",
    },
    {
      type: "table",
      caption: "pull vs push 一句话对照",
      headers: ["", "pull query（拉）", "push query（推）"],
      rows: [
        ["行为", "查“此刻”的值，返回有限结果即结束", "订阅变化，持续推送（长连接）"],
        ["数据来源", "已物化的表（CTAS 结果）或流", "流或物化表的实时变更"],
        ["SQL 能力", "键等值点查（默认）；无 GROUP BY/WINDOW/JOIN", "完整 SQL：过滤/投影/分组/窗口/join"],
        ["接口", "REST 单次响应", "REST chunked（无限长响应）或消费结果主题"],
        ["典型用途", "页面加载、按 sku 查当前库存/营收、请求-响应", "实时看板刷新、告警触发、异步控制流"],
      ],
    },
    {
      type: "heading",
      text: "端到端：orders.events → 5 分钟营收 → Go 消费",
    },
    {
      type: "paragraph",
      text: "下面把「实时营收」完整跑一遍。先做一个建模假设并说明：**假定 `orders.events` 的值里带 `sku`（商品）与 `amount`（金额，分为单位）两个字段**。这是本课的教学假设载荷——字段名与层级和第 6 章定稿的书舟「信封契约」（金额在 `payload.amount_cents`、事件类型叫 `type`）并不一致，演示时别把两套示例混用。如果线上契约是「主事件 + 明细行」或信封结构，通常先有一段流式 ETL（CSAS）把明细/载荷展开成扁平的行项目流再聚合——做法是先把载荷注册成字符串列、再用 `EXTRACTJSONFIELD` 逐字段拆出并 `CAST` 成目标类型（确切语法以官方文档为准）。输入 schema 决定你能不能直接聚合，这是设计流管道时最先要想清楚的事（事件建模决策见[第 6 章事件建模课](/courses/kafka/lessons/kafka-event-modeling)）。",
    },
    {
      type: "subheading",
      text: "第 1 步：注册输入流",
    },
    {
      type: "code",
      title: "ksqlDB CLI：把 orders.events 注册为 STREAM（语法按官方 CREATE STREAM）",
      language: "sql",
      code: `-- orders.events 的 key 是 order_id（纯字符串）→ 声明为 KEY 列；
-- 键用 KAFKA 格式（原样字符串），值用 JSON（JSON 不需要 Schema Registry）。
-- 注意：注册已有主题时 kafka_topic 必须与实际主题名一致；
-- 语句本身不校验分区数/副本数（结果主题默认继承输入主题的分区数）。
-- 本课本地主题是第 1 章建的 3 分区（书舟生产设计值 12）——以实际主题为准。
CREATE STREAM orders_events (
    order_id VARCHAR KEY,
    event    VARCHAR,
    sku      VARCHAR,
    amount   BIGINT,          -- 单位：分
    at       VARCHAR
) WITH (
    kafka_topic = 'orders.events',
    key_format  = 'KAFKA',
    value_format = 'JSON'
);`,
    },
    {
      type: "paragraph",
      text: "执行后 `SHOW STREAMS;` 能看到它，`DESCRIBE orders_events;` 能看列。每行还有三个系统列可用：`ROWTIME`（该事件的时间戳，毫秒；默认取 Kafka 消息时间戳，即事件时间，可在 `WITH (TIMESTAMP='字段')` 改为用消息里的字段）、`ROWPARTITION`/`ROWOFFSET`。**窗口计算按 `ROWTIME` 归窗**——这一点直接复用上一课的「事件时间窗口」。",
    },
    {
      type: "subheading",
      text: "第 2 步：CTAS 派生 5 分钟营收物化表",
    },
    {
      type: "code",
      title: "ksqlDB CLI：持久查询（语法按官方 CTAS + WINDOW TUMBLING）",
      language: "sql",
      code: `-- 常驻查询：按 sku 每 5 分钟滚动窗口汇总已支付金额；
-- 宽限期 1 分钟（GRACE PERIOD）：窗口结束后 1 分钟内到达的迟到事件仍计入。
-- EMIT CHANGES：窗口每收到一条新事件就更新一次（持续更新语义，见下文提醒）。
CREATE TABLE revenue_5min
WITH (kafka_topic = 'revenue.5min')            -- 不指定则默认用表名大写 REVENUE_5MIN
AS SELECT
    sku,
    SUM(amount) AS revenue_cents,
    COUNT(*)    AS order_events
FROM orders_events
WINDOW TUMBLING (SIZE 5 MINUTES, GRACE PERIOD 1 MINUTE)
WHERE event = 'order.paid'
GROUP BY sku
EMIT CHANGES;`,
    },
    {
      type: "list",
      items: [
        "这是一条**持久查询**：提交后常驻执行，服务端为其创建一个 Streams 拓扑（聚合需要按新 key=sku 重分区，内部会出现重分区主题）；结果主题 `revenue.5min` 的分区数默认继承输入主题（12），副本数同理，也可在 `WITH` 里用 `PARTITIONS`/`REPLICAS` 显式指定",
        "分组键从 `order_id` 换成 `sku` 后，「同 sku 的事件进同分区」由引擎内部重分区保证——这正是第 2 章「同 key 同分区」在引擎里的应用",
        "窗口化聚合的产物是**表**（changelog 语义）：主题里每个 (sku, 5 分钟窗口) 会被**反复更新**——窗口内每来一单就追加一条“该窗口当前累计值”的记录，迟到事件在宽限期内还会再改一次。**下游绝不能按普通事件流累加，而要按 key 覆盖显示**（见第 4 步的 Go 代码）",
        "只想要「窗口关闭后的最终值」：把 `EMIT CHANGES` 换成 `EMIT FINAL`（抑制中间更新，仅窗口聚合支持；具体限制以官方 SELECT 文档为准）",
        "窗口边界（Unix 毫秒）在消息键里由引擎编码；需要读到明文的窗口起止，在查询里显式取 `WINDOWSTART`/`WINDOWEND` 系统列即可（示例见第 3 步）",
      ],
    },
    {
      type: "subheading",
      text: "第 3 步：push 与 pull 各看一眼",
    },
    {
      type: "code",
      title: "ksqlDB CLI：push 查询（订阅实时变化）与 pull 查询（点查当前值）",
      language: "sql",
      code: `-- push：任何新事件/更新都会推过来，连接不结束（Ctrl+C 退出）。
-- WINDOWSTART/WINDOWEND 是窗口表/查询里的系统列。
SELECT sku,
       from_unixtime(WINDOWSTART) AS window_start,
       revenue_cents
FROM revenue_5min
EMIT CHANGES;

-- pull：查“此刻”某个 sku 的营收，返回有限行后结束。
-- 默认只支持对键列做等值点查；窗口表可再加 WINDOWSTART/WINDOWEND 范围过滤。
SELECT sku, revenue_cents
FROM revenue_5min
WHERE sku = '978-7-111-00001-2'
  AND WINDOWSTART >= 1725000000000;

-- pull 也支持查流（有限扫描语义，官方文档允许对任何流发起 pull），
-- 但不支持 GROUP BY/WINDOW/JOIN；全表扫描需在会话里显式开启（服务端可配置默认开启）：
SET 'ksql.query.pull.table.scan.enabled' = 'true';
SELECT * FROM revenue_5min;`,
    },
    {
      type: "paragraph",
      text: "ksqlDB 也支持跳跃与会话窗口，语法如 `WINDOW HOPPING (SIZE 30 SECONDS, ADVANCE BY 10 SECONDS)`、`WINDOW SESSION (60 SECONDS)`（会话=不活动间隙切分，做 user.behavior 会话化正合适）；**注意 ksqlDB 的 SQL 窗口只有这三种，没有 Kafka Streams 里的 Sliding 窗口**（join 用 `WITHIN` 子句表达时间窗）。未指定 `GRACE PERIOD` 时官方文档长期给出的默认宽限期是 24 小时（较新版本对默认值有收紧/移除的讨论，行为以所用版本文档为准）——课堂/演示环境请显式给一个小的宽限期，否则迟到窗口会滞留很久。",
    },
    {
      type: "subheading",
      text: "第 4 步：Go 集成——直接消费结果主题（主力姿势）",
    },
    {
      type: "paragraph",
      text: "把 Go 接进 ksqlDB 管道，**默认且最稳的姿势是消费结果主题**：`revenue.5min` 就是 Kafka 里的一个普通主题，用第 4 章的 franz-go 技能即可。REST push query 适合「临时调试/少量订阅」，把它当生产主力会引入长连接与格式解析成本，一般只做辅助。下面是消费端骨架（复用[第 1 章 franz-go 消费者](/courses/kafka/lessons/kafka-go-client-hello)的结构）：",
    },
    {
      type: "code",
      title: "Go：消费 revenue.5min 的更新流（franz-go v1.21 骨架）",
      language: "go",
      code: `package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"

	"github.com/twmb/franz-go/pkg/kgo"
)

// revenue.5min 的值是 JSON（VALUE_FORMAT='JSON'）：一行 = 一次窗口更新
type RevenueUpdate struct {
	SKU          string \`json:"SKU"\`          // 分组列，大写（ksqlDB 未加引号的列名规范化为大写）
	REVENUE_CENTS int64  \`json:"REVENUE_CENTS"\`
	ORDER_EVENTS int64  \`json:"ORDER_EVENTS"\`
}

func main() {
	cl, err := kgo.NewClient(
		kgo.SeedBrokers("localhost:9092"),
		kgo.ConsumerGroup("revenue-dashboard"),
		kgo.ConsumeTopics("revenue.5min"),
		// 新组第一次启动时，只读之后的更新（等价 auto.offset.reset=latest）
		kgo.ConsumeStartOffset(kgo.NewOffset().AtEnd()),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	for {
		fetches := cl.PollFetches(ctx)
		if ctx.Err() != nil {
			break
		}
		fetches.EachError(func(topic string, partition int32, err error) {
			log.Printf("拉取出错: topic=%s partition=%d err=%v", topic, partition, err)
		})
		fetches.EachRecord(func(r *kgo.Record) {
			var u RevenueUpdate
			if err := json.Unmarshal(r.Value, &u); err != nil {
				log.Printf("无法解析（主题里可能有非窗口更新的控制记录?）: %v", err)
				return
			}
			// 关键：这是「按 (sku, 窗口) 覆盖的更新」，不是独立事件——
			// 看板应就地覆盖 SKU 的当前值，绝不能把 revenue_cents 累加起来。
			fmt.Printf("[更新] sku=%s 本窗口累计=%d 单量=%d\\n",
				u.SKU, u.REVENUE_CENTS, u.ORDER_EVENTS)
			// 若需要窗口起止：消息键携带窗口边界（编码取决于 KEY_FORMAT），
			// 可先 PRINT 'revenue.5min' FROM BEGINNING; 观察键的形态再决定解析。
		})
	}
}`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "结果主题是 changelog：按 key 覆盖，不要累加",
      body: "初学者最常见的错误：把 `revenue.5min` 当成「每 5 分钟一条的独立营收事件」去 `+=` 累加——结果同一窗口被计了 N 次。记住 `CREATE TABLE AS SELECT` 写的是**表的变更日志**：每个 (sku, 窗口) 可能被更新很多次（窗口内每单一次、迟到事件再修正一次）。消费端的正确姿势是维护一个「sku → 当前值」的映射就地覆盖（看板就是这么画的），或者只订阅 `EMIT FINAL` 的最终值管道。这正是上一课 callout 里「窗口聚合持续更新语义」的 Go 侧回响。",
    },
    {
      type: "subheading",
      text: "REST push query：何时用、长什么样",
    },
    {
      type: "paragraph",
      text: "不想为了看实时结果建消费组、或查询里有没法落成主题的临时逻辑时，用 REST：向 ksqlDB 的 HTTP 查询端点发 SQL，响应是**不结束的 chunked 流**（官方 Queries 文档原话：push query 通过 HTTP 请求执行，API 返回无限长度的分块响应）。适合调试与低频订阅；生产主力仍是消费主题。",
    },
    {
      type: "code",
      title: "示意：用 curl 发起 push query（端点/媒体类型以官方 REST API 文档为准）",
      language: "bash",
      code: `curl -N -X POST http://localhost:8088/query \\
  -H "Content-Type: application/vnd.ksql.v1+json" \\
  -d '{"sql":"SELECT sku, revenue_cents FROM revenue_5min EMIT CHANGES;"}'
# 输出示例（示意）：每来一次更新追加一行 JSON
# {"row":{"columns":["978-7-111-00001-2",5900]},"errorMessage":null}`,
    },
    {
      type: "heading",
      text: "部署一句话 + 与自研/Streams 的决策",
    },
    {
      type: "paragraph",
      text: "部署上，ksqlDB 是一个独立 JVM 服务：官方 quickstart 提供 docker compose（`confluentinc/cp-ksqldb-server` 等镜像），教学单机即可；生产把多个 server 配成同一 `ksql.service.id` 组成集群以 HA（查询定义共享、故障接管），并把它与业务服务解耦、按普通有状态服务监控（它消费主题、维护 RocksDB 物化状态，监控口径与第 9 章消费组/lag 一致）。默认 HTTP 端口 8088（以官方 server 配置文档为准）。启动方式、镜像 tag 与 Kafka 版本兼容性随时会变，动手前以官方 quickstart 为准。",
    },
    {
      type: "table",
      caption: "决策：同一需求下 ksqlDB vs Kafka Streams 库 vs 自研 Go",
      headers: ["维度", "ksqlDB（独立服务 + SQL）", "Kafka Streams（进程内 JVM 库）", "自研 Go 消费 + 外部状态"],
      rows: [
        ["谁写逻辑", "数据/业务同学写 SQL；无需提交代码发布", "JVM 工程师写 Java DSL（Scala 封装 4.3 起弃用）", "Go 工程师写代码（第 4/5 章技能）"],
        ["能力边界", "窗口/聚合/join/物化视图；复杂逻辑靠 UDF（Java）", "最灵活：Processor API 可做任意自定义处理", "全部自管：薄状态场景够用，厚状态（会话/乱序/事件时间窗）成本高"],
        ["状态与容错", "引擎内置（物化视图 + changelog，同 Streams）", "引擎内置（RocksDB + changelog + standby）", "自己设计（Redis/DB + 位点 + 幂等恢复）"],
        ["部署代价", "多一个常驻服务（可集群、需监控）", "无新服务，但应用要跑 JVM 且每实例有状态盘", "无新服务，纯 Go 部署最顺"],
        ["Go 集成", "消费结果主题 / REST push / pull 点查", "消费结果主题", "直接内联，无跨服务"],
        ["适合书舟", "营收看板、库存余量点查等 SQL 可表达的聚合", "特征计算等规则复杂、需要代码控制的重管道", "简单过滤/路由/单条转换与轻计数"],
      ],
    },
    {
      type: "quiz",
      question:
        "书舟要做「实时营收看板」：页面要持续刷新每个 sku 在当前 5 分钟窗口的营收，运营还要能随时点查某个 sku 的最新累计营收。最合适的组合是？",
      options: [
        "全部用 pull query：它延迟最低，让前端每 5 秒轮询一次 pull 接口即可",
        "用 CTAS 建 revenue_5min 物化表；页面订阅其变更（push query 或直接消费结果主题），按 sku 点查用 pull query",
        "push query 会持续写主题，直接消费即可，不需要 CTAS",
        "pull query 支持 GROUP BY 与 WINDOW，可以在查询时临时现算，无需预先物化",
      ],
      answer: 1,
      explanation:
        "两个需求分别对应两种查询：持续订阅实时变化 → push（或消费 CTAS 结果主题，生产主力）；点查当前值 → pull（正确选项）。选项 1 用轮询 pull 冒充实时流，既浪费点查语义又拿不到“持续更新”；选项 3 错在 push 的结果不持久化、不写主题（官方文档明确）；选项 4 错在 pull 不支持 GROUP BY/WINDOW——聚合必须先由 CTAS 常驻物化，pull 才能低延迟点查。",
    },
    {
      type: "keypoints",
      items: [
        "ksqlDB = 独立 server + SQL 层基于 Kafka Streams：CSAS/CTAS 提交后编译成 Streams 拓扑常驻执行；同 ksql.service.id 多 server 组集群，教学单机即可",
        "STREAM=不可变事件流（KEY 列）；TABLE=同 key 覆盖的变更集合（PRIMARY KEY，null=删除）；注册不改数据，派生（AS SELECT）才建新主题",
        "三种查询：persistent（CSAS/CTAS 常驻写主题）；push（订阅实时变化，REST 无限长 chunked 响应，不落主题）；pull（点查当前值，仅查已物化的表/流，默认键等值，不支持 GROUP BY/WINDOW/JOIN）",
        "窗口：TUMBLING/HOPPING/SESSION（ksqlDB 无 Sliding）；GRACE PERIOD 历史默认 24h（新版本以官方文档为准），演示显式收紧；窗口化聚合输出是持续更新的 changelog——下游按 key 覆盖，别累加；只取最终值用 EMIT FINAL",
        "Go 集成主力 = 直接消费 CTAS 结果主题（kgo 消费 JSON 即可）；REST push 用于调试/低频订阅；pull 供点查",
        "决策：SQL 能表达且不想养 JVM 开发 → ksqlDB；规则复杂要代码控制 → Streams 库；薄状态纯 Go → 自研消费",
        "版本提醒：ksqlDB 版本节奏独立于 Kafka 4.x，KRaft 集群上以官方 quickstart/兼容性说明为准",
      ],
    },
    {
      type: "paragraph",
      text: "到这里第 8 章收官：你有了「先判断要不要流处理、再选引擎形态、再看懂机制、最后用 SQL 落地」的完整闭环。下一站回到 Kafka 本身——流应用本质是特殊的消费组，它们的健康同样看 lag 与指标，[第 9 章观测与排障](/courses/kafka/lessons/kafka-monitoring-lag)会把这些补全；想把今天学的管道亲手写成 Go 工程，第 10 章[综合项目](/courses/kafka/lessons/kafka-capstone-order-pipeline)见。",
    },
  ],
};
