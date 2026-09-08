/* ==================================================================
 * 课时：综合项目：订单事件管道（Go）（kafka-capstone-order-pipeline）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 10 章第一课（exercise，90min，全书收口实战）：四阶段里程碑把
 * 第 1–9 章串成一条真实可跑的 Go 订单事件管道。
 *
 * 事实核对（2026-09-08）：本课全部代码已用 go vet 与 go build 验证
 * 编译通过；示例输出在 apache/kafka:4.3.1（单节点 KRaft）+ franz-go
 * v1.21.6 + PostgreSQL 16（postgres:16 Docker 镜像）上端到端实测摘录。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "90 分钟综合实战：为书舟书店实现一条 Go 订单事件管道——阶段 A 设计主题（事件流/状态/死信），阶段 B 实现订单发布与幂等落库消费，阶段 C 加重试/死信/支付去重，阶段 D 用 lag 与故障演练验证可靠性；每阶段给出可观察的验收标准。",
  blocks: [
    {
      type: "paragraph",
      text: "这是第 10 章的第一课，也是整门课的收口实战：把第 1–9 章的知识落成一条**真实可运行**的订单事件管道。你会亲手做一遍架构决策（主题怎么建、分区多少、键选什么）、写一遍带正确提交语义的消费者、把失败消息送进死信、再亲眼看到 lag 增长与崩溃后的重复窗口。代码都给出完整形态，你要做的是理解后运行、观察、并回答每阶段末尾的问题——**验收标准不是「程序能跑」，而是「你能解释你看到的现象」**。全课建议时间分配：阶段 A 约 20 分钟、B 约 25 分钟、C 约 25 分钟、D 约 20 分钟。",
    },
    {
      type: "heading",
      text: "项目总览：订单事件管道",
    },
    {
      type: "paragraph",
      text: "场景沿用全书固定设定——书舟书店。我们取它的最小可运行切片：**orders 服务**把订单事件发布进 Kafka；一组消费者把订单状态幂等投影到 PostgreSQL（库存域的前置动作）；另一组消费者对已支付订单执行结算——调用一个本地 mock 的收单渠道，失败走重试与死信。架构图里每一个箭头都对应前面某课讲过的机制：",
    },
    {
      type: "code",
      title: "系统图（text）",
      language: "text",
      code: "订单事件管道（书舟最小切片）\n\n┌────────────┐   order.created / order.paid   ┌────────────────┐  幂等 upsert   ┌──────────────────┐\n│  orders     │ ──────►  orders.events  ─────► │  stock-applier  │ ─────────────► │  order_state 表   │\n│ （发布端）   │      key=order_id，12 分区      │ （组：库存投影）  │    (PostgreSQL)   │ （每订单一行）    │\n└────────────┘                               └────────────────┘                └──────────────────┘\n\n同一份订单事件被第二个独立消费组并行处理（同一主题，多个消费组各读各的）：\n\n┌────────────────┐  只看 order.paid   ┌────────────────┐  POST /charge   ┌────────────────┐\n│ payment-settle │ ─────────────────► │   结算逻辑      │ ──────────────► │ mock 收单渠道   │\n│ （组：支付结算）  │                    │ （重试/去重/幂等）│                 │  (HTTP :8090)  │\n└────────────────┘                    └───────┬────────┘                 └────────────────┘\n                                              │ 重试耗尽仍失败\n                                              ▼\n                                   ┌──────────────────────┐\n                                   │ dlq.orders.events     │  信封(原始消息+现场)+headers\n                                   │ （死信，人工/自动兜底）  │\n                                   └──────────────────────┘",
    },
    {
      type: "paragraph",
      text: "开工前如果对某个环节的手感生疏了，只回看这几课（都是站内链接，随时可跳）：[本地运行 Kafka 4.3（KRaft）与 CLI 初体验](/courses/kafka/lessons/kafka-kraft-quickstart)（容器与 kcli 命令）、[franz-go 初体验](/courses/kafka/lessons/kafka-go-client-hello)（Producer/PollFetches 骨架）、[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)（分区数推导）、[存储：Segment、保留策略与日志压缩](/courses/kafka/lessons/kafka-storage-segments-retention)（compaction）、[拉取模型、位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)（手动提交）、[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)（重试/死信/幂等落库的完整形态）。",
    },
    {
      type: "heading",
      text: "环境准备：Kafka + PostgreSQL + Go 模块",
    },
    {
      type: "paragraph",
      text: "本课需要三个东西同时在线：**Kafka 4.3.1 单节点**（沿用第 1 章方式，容器名 `kafka`、端口 9092）；**PostgreSQL 16**（本课新引入，容器名 `bookboat-pg`、宿主机端口 5433，用于幂等落库的验收）；**一个 Go 模块**（franz-go v1.21.6 + pgx v5 驱动）。逐条准备：",
    },
    {
      type: "code",
      title: "1) 确认/启动 Kafka（沿用第 1 章容器）",
      language: "bash",
      code: "docker ps --filter name=kafka --format '{{.Names}} {{.Status}}'\n# 没在跑就启动；没有就按第 1 章新建：\ndocker run -d --name kafka -p 9092:9092 apache/kafka:4.3.1\n\n# 定义统一 CLI 前缀（注意用 -i 而不是 -it：本课有管道输入命令）\nkcli() { docker exec -i kafka /opt/kafka/bin/\"$@\"; }",
    },
    {
      type: "code",
      title: "2) 启动 PostgreSQL 16（本课专用容器）",
      language: "bash",
      code: "docker run -d --name bookboat-pg \\\n  -e POSTGRES_USER=bookboat -e POSTGRES_PASSWORD=bookboat \\\n  -e POSTGRES_DB=bookboat -p 5433:5432 postgres:16\n\ndocker exec bookboat-pg pg_isready -U bookboat -d bookboat\n# 等到输出 “accepting connections” 再继续",
    },
    {
      type: "code",
      title: "3) Go 模块骨架与依赖",
      language: "bash",
      code: "mkdir bookboat-pipeline && cd bookboat-pipeline\ngo mod init bookboat-pipeline\ngo get github.com/twmb/franz-go@v1.21.6\ngo get github.com/jackc/pgx/v5@latest",
    },
    {
      type: "code",
      title: "项目结构：五个可执行程序，按阶段逐个创建",
      language: "text",
      code: "bookboat-pipeline/\n├── go.mod\n├── orders/    main.go   # 阶段 B：模拟 orders 服务发布订单事件\n├── stock/     main.go   # 阶段 B：库存投影消费者（手动提交 + 幂等落库）\n├── channel/   main.go   # 阶段 C：mock 收单渠道（HTTP :8090）\n├── payment/   main.go   # 阶段 C：结算消费者（重试/死信/去重）\n└── dlqdump/   main.go   # 阶段 C：死信查看器（读 dlq.orders.events）",
    },
    {
      type: "callout",
      variant: "warning",
      title: "两个数据安全的动作性提醒",
      body: "本课阶段 D 会 `docker stop kafka` 演练宕机：**stop 再 start 数据还在，容器数据目录完好**；但 `docker rm kafka` 会连同消息与消费组位点一起删除。演练只 stop，不 rm。另外 PostgreSQL 的 5433 是宿主机映射端口——若你本机 5433 被占用，改映射（如 `-p 5434:5432`）并把下文所有连接串里的 5433 同步改掉。",
    },
    {
      type: "heading",
      text: "阶段 A：架构与主题设计（约 20 分钟）",
    },
    {
      type: "list",
      items: [
        "给三个主题各写一份设计决策并说清理由：主题语义、键、分区数、保留/清理策略（本地与生产的差异）",
        "在本地 broker 建好三个主题，用 `kafka-topics.sh --describe` 验证配置真实生效",
        "用 CLI 往 compacted 主题写同 key 多版本，观察「删除时机不保证」的语义",
      ],
    },
    {
      type: "paragraph",
      text: "先把第 2 章的两个判断搬过来：**主题是存储语义的载体**——事件流、状态、死信是三种不同的数据，放进同一个主题就会被同一种保留策略错待；**分区是并行与顺序的唯一边界**——订单状态机要求同一订单的事件有序，所以事件流的 key 必须是 `order_id`。下面是本课的参考设计（`本地 → 生产`表示开发与生产的取值差异），**先自己填一版理由，再对照**：",
    },
    {
      type: "table",
      caption: "三个主题的设计表（对照用）",
      headers: ["主题", "键", "分区（本地 → 生产）", "保留与清理", "理由（一句话）"],
      rows: [
        ["`orders.events`（事件流）", "`order_id`", "12 → 12（按第 2 章推导）", "`retention.ms=604800000`（7 天），`cleanup.policy=delete`", "每张订单 3~5 个事件，事件间彼此独立、要按订单回放与审计，所以按时间整体保留 7 天、不做 compact；key=order_id 让一单全部事件同分区保序（状态机最怕先见 paid 后见 created）；分区数 = max(峰值吞吐 ÷ 单分区吞吐, 消费并行度) + 增长余量，12 个让峰值每分区约 2k 条/秒；本地单节点 rf=1，生产 rf=3 + minISR=2"],
        ["`inventory.stock`（状态）", "`sku`", "3 → 12~24（按 sku 规模）", "`cleanup.policy=compact`", "库存是「每个 sku 的当前值」，下游要的是最新状态而不是变更史；compact 保证每个 key 的最新值在、旧值后台清理且**删除时机不保证**；从头重放可重建当前快照（对应 Kafka Streams 里 KTable changelog 的思想，第 8 章）"],
        ["`dlq.orders.events`（死信）", "沿用原消息 key（`order_id`）", "12 → 12", "保留期建议拉长（生产 30 天或按审计要求）", "保存「处理不了的消息 + 现场」供人工修复后重放；分区数与源主题一致，同一订单的失败记录保持与原流一致的顺序；**Kafka 没有内置死信**，它是消费者代码写出来的普通主题"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "数字是推导的，不是抄来的",
      body: "表里的分区数来自第 2 章那套推导结构（峰值 5000 单/秒 → 事件 1.5~2.5 万/秒 → 每分区约 2k/秒 → 4+ 消费实例 → 留余量 → 12），单分区吞吐的量级假设必须用你自己的消息大小压测校准（第 9 章 [容量规划](/courses/kafka/lessons/kafka-capacity-tuning)给方法）。能把「12 是怎么来的」讲成一段推导，比记住 12 值钱得多——下一课复盘会专门回放这一点。",
    },
    {
      type: "code",
      title: "创建三个主题（注意 --config 只对本主题生效）",
      language: "bash",
      code: "kcli kafka-topics.sh --bootstrap-server localhost:9092 --create \\\n  --topic orders.events --partitions 12 --replication-factor 1 \\\n  --config retention.ms=604800000\n\nkcli kafka-topics.sh --bootstrap-server localhost:9092 --create \\\n  --topic inventory.stock --partitions 3 --replication-factor 1 \\\n  --config cleanup.policy=compact\n\nkcli kafka-topics.sh --bootstrap-server localhost:9092 --create \\\n  --topic dlq.orders.events --partitions 12 --replication-factor 1",
    },
    {
      type: "code",
      title: "验证配置（示例输出节选，4.3.1 实测；TopicId/Leader 随环境而异）",
      language: "text",
      code: "$ kcli kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic orders.events\nTopic: orders.events\tTopicId: 70JexIroSPu7WX4C_obxZw\tPartitionCount: 12\tReplicationFactor: 1\tConfigs: min.insync.replicas=1,segment.bytes=1073741824,retention.ms=604800000\n\tTopic: orders.events\tPartition: 0\tLeader: 1\tReplicas: 1\tIsr: 1\tElr: \tLastKnownElr:\n\tTopic: orders.events\tPartition: 1\tLeader: 1\tReplicas: 1\tIsr: 1\tElr: \tLastKnownElr:\n…\n\n$ kcli kafka-topics.sh --bootstrap-server localhost:9092 --describe --topic inventory.stock\nTopic: inventory.stock\tTopicId: LaUVe1HKRrqrmiwamGInhA\tPartitionCount: 3\tReplicationFactor: 1\tConfigs: min.insync.replicas=1,cleanup.policy=compact,segment.bytes=1073741824\n\tTopic: inventory.stock\tPartition: 0\tLeader: 1\tReplicas: 1\tIsr: 1\tElr: \tLastKnownElr:",
    },
    {
      type: "paragraph",
      text: "注意 describe 第一行 `Configs` 列：`retention.ms=604800000` 与 `cleanup.policy=compact` 是我们用 `--config` 写进**主题级配置**的证据——它只作用于这个主题，不影响别的主题。接着做第 2 章那个「compact 语义边界」的小观察：往 `inventory.stock` 写同一 sku 的两版库存，立刻从头读——**两个版本都在**。这是特性不是 bug：压缩由后台 cleaner 异步执行，删除时机从不保证，只有「每个 key 的最新值一定会保留到」是承诺。",
    },
    {
      type: "code",
      title: "观察 compact 主题：同 key 两版先都可见",
      language: "bash",
      code: "printf '%s\\n' \\\n  '978-7-5086-9366-2:{\"sku\":\"978-7-5086-9366-2\",\"stock\":40,\"at\":\"2026-09-08T10:00:00Z\"}' \\\n  '978-7-5086-9366-2:{\"sku\":\"978-7-5086-9366-2\",\"stock\":37,\"at\":\"2026-09-08T10:01:00Z\"}' \\\n  '978-7-121-39948-2:{\"sku\":\"978-7-121-39948-2\",\"stock\":12,\"at\":\"2026-09-08T10:01:30Z\"}' | \\\n  kcli kafka-console-producer.sh --topic inventory.stock \\\n  --bootstrap-server localhost:9092 \\\n  --reader-property parse.key=true --reader-property key.separator=:\n\nkcli kafka-console-consumer.sh --topic inventory.stock --from-beginning \\\n  --bootstrap-server localhost:9092 \\\n  --formatter-property print.partition=true \\\n  --formatter-property print.key=true\n# 两条同 key 消息都会先被打印（压缩是异步的），隔几分钟再读可能只剩较新的那版",
    },
    {
      type: "exercise",
      title: "阶段 A 动手：设计表 + 建主题 + 观察 compact",
      description:
        "① 在纸上（或注释里）写出三个主题的设计表：主题语义、键、分区数、保留/清理策略、理由，覆盖「本地 vs 生产」差异（rf、minISR、分区数）；② 用上面的命令创建三个主题，describe 验证：orders.events 显示 12 个分区且 Configs 含 retention.ms=604800000，inventory.stock 显示 cleanup.policy=compact，dlq.orders.events 分区数与源主题一致；③ 对 inventory.stock 写同一 sku 的两个版本库存后从头消费，确认两个版本都可见，并解释为什么「不会立刻只剩新版本」；④ 思考题：如果 orders.events 也设成 compact，会对「按订单回放」造成什么破坏？",
      hint: "答案都藏在第 2 章两课里：分区数推导的三个约束、compaction 的「只保留每 key 最新值 + 删除时机不保证」、以及时间删除与压缩的对象差异。思考题想不通就先标记，做完阶段 B 的重复吸收实验再回来想——那正是「同 key 多事件」的现实例子。",
    },
    {
      type: "divider",
    },
    {
      type: "heading",
      text: "阶段 B：orders 发布 + 正确消费者（约 25 分钟）",
    },
    {
      type: "list",
      items: [
        "写一个模拟 orders 服务的生产者：每笔订单发 order.created，模拟渠道回调后再发 order.paid（key=order_id，事件契约显式）",
        "写一个「正确消费者」：手动提交（整批处理成功才提交 + revoke 补交）、把订单状态幂等投影到 PostgreSQL",
        "用 `-repeat 2` 故意制造重复事件，亲眼看到重复被吸收：DB 行数 = 订单数，而不是事件数",
      ],
    },
    {
      type: "paragraph",
      text: "先定事件契约——它是跨服务的地基（第 6 章 [事件建模](/courses/kafka/lessons/kafka-event-modeling)）。**刻意说明**：第 6 章定稿的正式契约是带 `event_id/type/occurred_at/version` 的「信封」。本课为了让第 1–5 章 CLI 与 Go 示例里的字段能无缝延续、把注意力集中在管道机制上，**沿用扁平演示体**（下表右列给出与信封的映射）；跨团队/生产请按信封 + Schema Registry 走（第 6 章两课），本课的手工 JSON 只是单团队取舍，不是对信封的否定。字段全部显式：",
    },
    {
      type: "code",
      title: "order.created 事件体（JSON）",
      language: "json",
      code: "{\n  \"orderId\": \"20260908-000123\",\n  \"event\": \"order.created\",\n  \"at\": \"2026-09-08T10:00:00Z\",\n  \"amount\": 5900,\n  \"items\": [\n    { \"sku\": \"978-7-5086-9366-2\", \"qty\": 1 }\n  ]\n}",
    },
    {
      type: "table",
      caption: "事件字段契约",
      headers: ["字段", "类型", "含义", "为什么显式"],
      rows: [
        ["`orderId`", "string", "订单号（= 分区键）", "消费端幂等键、跨服务关联都靠它；同订单事件必须同 key 同分区"],
        ["`event`", "string", "事件名：order.created / order.paid / order.cancelled", "过去时命名 = 已发生的事实，不是指令（第 6 章）"],
        ["`at`", "string（RFC3339）", "事件发生时间（occurred），非处理时间", "回放与审计的时间基准，别用消费端处理时间冒充"],
        ["`amount`", "integer", "金额，单位分", "单位写进契约，避免「5900 是元还是分」的歧义"],
        ["`items`", "array", "商品明细：sku + qty", "给下游（库存扣减/结算）足够信息，不必回查订单库"],
      ],
    },
    {
      type: "table",
      caption: "扁平演示体 ↔ 第 6 章信封的字段映射（生产按右列）",
      headers: ["本课扁平体", "信封（正式契约）", "说明"],
      rows: [
        ["`orderId`（顶层）", "`order_id`（key + 信封字段）", "分区键与跨服务关联键一致；信封里同时出现在 key 与 body，便于独立消费方"],
        ["`event`", "`type`", "事件类型字段名对齐官方命名习惯（<聚合>.<过去分词>）"],
        ["`at`", "`occurred_at`", "字段名表意更明确；UTC RFC3339 语义相同"],
        ["（无）", "`event_id`（UUID）", "事件实例唯一 id：信封用它做事件级幂等去重（第 5 章「业务键首选 event_id」）；本课投影以 order 为单位收敛，用 order_id + 状态机去重已够，故未引入"],
        ["`amount`", "`payload.amount_cents`", "业务数据收进 payload，金额单位仍为分"],
        ["`items`", "`payload.items`", "同上；业务载荷随事件类型演化不影响元数据字段"],
      ],
    },
    {
      type: "paragraph",
      text: "生产者很简单：沿用第 1 章已验证的 ProduceSync + 回调打印落点坐标的写法。为了后面观察重复吸收，加一个 `-repeat` 参数——**每条事件发送多次，模拟上游重复投递**（真实环境里 at-least-once 的重复随时发生，这里是把它变成可控实验）；`-gap` 控制 created 与 paid 之间模拟的渠道回调时延（压测时可置 0）。存为 `orders/main.go`：",
    },
    {
      type: "code",
      title: "orders/main.go（完整可运行，franz-go v1.21.6）",
      language: "go",
      code: `// orders/main.go —— 书舟 orders 服务的模拟发布端：
// 每笔订单先发 order.created，模拟支付渠道回调成功后再发 order.paid。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

type orderItem struct {
	Sku string \`json:"sku"\`
	Qty int    \`json:"qty"\`
}

type orderEvent struct {
	OrderID string      \`json:"orderId"\`
	Event   string      \`json:"event"\`
	At      string      \`json:"at"\`
	Amount  int64       \`json:"amount"\`
	Items   []orderItem \`json:"items"\`
}

func main() {
	kafka := flag.String("kafka", "localhost:9092", "broker 地址")
	start := flag.Int("start", 1, "第一个订单的序号；多次运行请递增，避免订单号撞车")
	n := flag.Int("n", 12, "产生的订单数")
	repeat := flag.Int("repeat", 1, "每条事件发送几次（>1 模拟上游重复投递）")
	sleep := flag.Duration("sleep", 150*time.Millisecond, "两笔订单之间的间隔")
	gap := flag.Duration("gap", 300*time.Millisecond, "created 与 paid 之间的间隔（模拟渠道回调时延）")
	flag.Parse()

	cl, err := kgo.NewClient(kgo.SeedBrokers(*kafka))
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	// 书舟在售图书（sku 为 ISBN 风格）
	books := []string{
		"978-7-5086-9366-2", "978-7-111-63459-7", "978-7-115-58765-3",
		"978-7-121-39948-2", "978-7-302-58328-9",
	}

	mkPayload := func(seq int, event string) []byte {
		v, _ := json.Marshal(orderEvent{
			OrderID: orderID(seq),
			Event:   event,
			At:      time.Now().UTC().Format(time.RFC3339),
			Amount:  int64(1500 + seq*370), // 单位：分
			Items:   []orderItem{{Sku: books[seq%len(books)], Qty: 1 + seq%3}},
		})
		return v
	}

	for i := range *n {
		seq := *start + i
		for range *repeat {
			emit(ctx, cl, seq, "order.created", mkPayload(seq, "order.created"))
		}
		time.Sleep(*gap) // 模拟渠道回调的时延（压测时可 -gap 0）
		for range *repeat {
			emit(ctx, cl, seq, "order.paid", mkPayload(seq, "order.paid"))
		}
		time.Sleep(*sleep)
	}

	if err := cl.Flush(ctx); err != nil {
		log.Fatalf("flush: %v", err)
	}
	fmt.Println("全部事件已确认写入（acks=all）")
}

func orderID(seq int) string {
	return fmt.Sprintf("20260908-%06d", seq)
}

// emit 同步发送一条事件并打印 broker 返回的落点坐标。
func emit(ctx context.Context, cl *kgo.Client, seq int, event string, value []byte) {
	res := cl.ProduceSync(ctx, &kgo.Record{
		Topic: "orders.events",
		Key:   []byte(orderID(seq)),
		Value: value,
	})
	if err := res.FirstErr(); err != nil {
		log.Fatalf("投递失败 %s %s: %v", orderID(seq), event, err)
	}
	fmt.Printf("已确认 %s  %-13s -> partition=%d offset=%d\\n",
		orderID(seq), event, res[0].Record.Partition, res[0].Record.Offset)
}
`,
    },
    {
      type: "paragraph",
      text: "消费者的目标表是一张「订单当前状态」投影表。第 5 章讲过幂等落库的两种形态，这里用**需要状态流转的那一种**：同订单的 created → paid 是合法推进，不能因为「已存在」就拒绝，所以用 `ON CONFLICT DO UPDATE`（防重标记的 `DO NOTHING` 形态留给阶段 C 的结算表，那里一张订单只结算一次）。唯一键就是幂等键：**用业务键 `order_id`，而不是 (topic, partition, offset)**——从死信重放或位点重置时 offset 会变，业务键跨重放稳定。",
    },
    {
      type: "code",
      title: "order_state 表（PostgreSQL；程序启动时自动建，这里单列讲解）",
      language: "sql",
      code: "CREATE TABLE IF NOT EXISTS order_state (\n    order_id   TEXT PRIMARY KEY,       -- 幂等键 = 业务键\n    state      TEXT NOT NULL,          -- order.created / order.paid / order.cancelled\n    amount     BIGINT NOT NULL,        -- 单位：分\n    at         TIMESTAMPTZ NOT NULL,   -- 事件发生时间\n    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n\n-- 处理事件时执行：重复投递同一事件 = 幂等（同样的 state 覆盖同样的 state）\nINSERT INTO order_state (order_id, state, amount, at, updated_at)\nVALUES ($1, $2, $3, $4, now())\nON CONFLICT (order_id) DO UPDATE\nSET state = EXCLUDED.state, amount = EXCLUDED.amount,\n    at = EXCLUDED.at, updated_at = now();",
    },
    {
      type: "paragraph",
      text: "消费者代码把第 4 章「正确消费」的姿势完整落一遍：`DisableAutoCommit`（提交时机归我们）、`PollRecords(ctx, 50)` 限制单批条数（同时把崩溃后的重复窗口控制在可见范围）、整批处理成功才 `CommitUncommittedOffsets`、再平衡交还分区前用 `OnPartitionsRevoked` 补交一次、处理失败不提交让组重投。幂等用「查当前状态 + 状态比较」实现，比裸 upsert 多做两件事：**同一事件的重复投递被识别并打日志（重复吸收）**，**乱序到达的旧事件（如迟到的 created 追在 paid 后面）被丢弃，不许状态回退**。存为 `stock/main.go`：",
    },
    {
      type: "code",
      title: "stock/main.go（完整可运行，手动提交 + 幂等投影）",
      language: "go",
      code: `// stock/main.go —— 库存/订单投影消费者（组 stock-apply）：
// 消费 orders.events，把每张订单的最新状态幂等投影到 PostgreSQL 的 order_state 表。
// 手动提交：整批处理成功才提交位点（at-least-once，重复靠唯一键+状态比较吸收）。
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // 注册名为 "pgx" 的 database/sql 驱动
	"github.com/twmb/franz-go/pkg/kgo"
)

const (
	group     = "stock-apply"
	topic     = "orders.events"
	batchSize = 50 // 单批记录数上限：决定「崩溃后最多重读多少条」的窗口
)

type orderEvent struct {
	OrderID string \`json:"orderId"\`
	Event   string \`json:"event"\`
	At      string \`json:"at"\`
	Amount  int64  \`json:"amount"\`
}

// rank 给出订单事件在状态机里的先后：created(1) < paid(2) < cancelled(3)。
// 用它对状态流转做单调性保护：乱序到达的旧事件不允许把状态往回拨。
func rank(event string) int {
	switch event {
	case "order.created":
		return 1
	case "order.paid":
		return 2
	case "order.cancelled":
		return 3
	}
	return 0
}

func main() {
	kafka := flag.String("kafka", "localhost:9092", "broker 地址")
	dsn := flag.String("dsn",
		"postgres://bookboat:bookboat@localhost:5433/bookboat?sslmode=disable",
		"PostgreSQL DSN")
	slow := flag.Duration("slow", 0, "每条消息处理前 sleep（演示消费滞后用）")
	flag.Parse()

	db, err := openDB(*dsn)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	cl, err := kgo.NewClient(
		kgo.SeedBrokers(*kafka),
		kgo.ConsumerGroup(group),
		kgo.ConsumeTopics(topic),
		kgo.DisableAutoCommit(), // 提交时机由我们控制
		kgo.OnPartitionsRevoked(func(ctx context.Context, cl *kgo.Client, _ map[string][]int32) {
			// 再平衡交还分区前补交一次：把已处理完的位点交出去，缩小接手方重读范围。
			if err := cl.CommitUncommittedOffsets(ctx); err != nil {
				log.Printf("revoke 补交失败: %v", err)
			}
		}),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	for {
		fetches := cl.PollRecords(ctx, batchSize)
		if fetches.IsClientClosed() || ctx.Err() != nil {
			break // 收到退出信号或客户端关闭
		}
		fetches.EachError(func(topic string, partition int32, err error) {
			log.Printf("拉取错误 %s/%d: %v", topic, partition, err)
		})

		var batchErr error
		fetches.EachRecord(func(r *kgo.Record) {
			if batchErr != nil {
				return
			}
			if *slow > 0 {
				time.Sleep(*slow)
			}
			if err := apply(ctx, db, r); err != nil {
				batchErr = err
			}
		})
		if batchErr != nil {
			// 处理失败：不提交、让进程退出 → 组重平衡后这批消息原样重投。
			// 想要“重试若干次再进死信”的版本，见 payment/main.go（阶段 C）。
			log.Fatalf("处理失败，本批位点未提交：%v", batchErr)
		}

		if err := cl.CommitUncommittedOffsets(ctx); err != nil {
			log.Printf("提交失败: %v", err)
		}
		if fetches.NumRecords() > 0 {
			log.Printf("本批 %d 条处理完成并提交", fetches.NumRecords())
		}
	}
}

// apply 把一条订单事件投影到 order_state（幂等）。
func apply(ctx context.Context, db *sql.DB, r *kgo.Record) error {
	var ev orderEvent
	if err := json.Unmarshal(r.Value, &ev); err != nil {
		return fmt.Errorf("JSON 解析失败: %w", err)
	}
	if ev.OrderID == "" || rank(ev.Event) == 0 {
		return fmt.Errorf("非法事件 order=%q event=%q", ev.OrderID, ev.Event)
	}

	var cur string
	err := db.QueryRowContext(ctx,
		"SELECT state FROM order_state WHERE order_id = $1", ev.OrderID).Scan(&cur)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// 首见该订单：走下面的插入
	case err != nil:
		return fmt.Errorf("查询当前状态: %w", err)
	case cur == ev.Event:
		// 同一事件的重复投递：幂等吸收（这是 at-least-once 的重复被消化掉的现场）
		log.Printf("重复吸收  %s 已处于 %s（offset=%d）", ev.OrderID, cur, r.Offset)
		return nil
	case rank(ev.Event) < rank(cur):
		// 乱序旧事件（如迟到的 created 追到 paid 之后）：丢弃，不许状态回退
		log.Printf("过期事件跳过 %s 当前 %s 收到 %s（offset=%d）", ev.OrderID, cur, ev.Event, r.Offset)
		return nil
	}

	if _, err := db.ExecContext(ctx, \`
		INSERT INTO order_state (order_id, state, amount, at, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (order_id) DO UPDATE
		SET state = EXCLUDED.state, amount = EXCLUDED.amount,
		    at = EXCLUDED.at, updated_at = now()\`,
		ev.OrderID, ev.Event, ev.Amount, ev.At); err != nil {
		return fmt.Errorf("upsert: %w", err)
	}
	log.Printf("状态流转  %s  -> %s（offset=%d）", ev.OrderID, ev.Event, r.Offset)
	return nil
}

func openDB(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, err
	}
	// 启动时自建表（演示用）；生产环境的 schema 由迁移工具管理
	_, err = db.ExecContext(ctx, \`
		CREATE TABLE IF NOT EXISTS order_state (
			order_id   TEXT PRIMARY KEY,
			state      TEXT NOT NULL,
			amount     BIGINT NOT NULL,
			at         TIMESTAMPTZ NOT NULL,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)\`)
	return db, err
}
`,
    },
    {
      type: "paragraph",
      text: "运行验收（两个终端 + 一个 psql）：先起消费者（它会因全新消费组、默认 earliest 而从主题开头等待/消费），再跑生产者。`-repeat 2` 让每笔订单的 created 与 paid 各发两次：",
    },
    {
      type: "code",
      title: "终端一：跑消费者",
      language: "bash",
      code: "go run ./stock\n# 等待……（新组无位点，会从最早开始读；此刻主题还没数据）",
    },
    {
      type: "code",
      title: "终端二：发 12 笔订单、每条事件发 2 次",
      language: "bash",
      code: "go run ./orders -n 12 -repeat 2",
    },
    {
      type: "code",
      title: "生产者输出（示例节选，4.3.1 + franz-go v1.21.6 实测；offset 随历史而异）",
      language: "text",
      code: "已确认 20260908-000001  order.created -> partition=0 offset=0\n已确认 20260908-000001  order.created -> partition=0 offset=1   ← repeat 2：同一事件第二条\n已确认 20260908-000001  order.paid    -> partition=0 offset=2\n已确认 20260908-000001  order.paid    -> partition=0 offset=3\n已确认 20260908-000002  order.created -> partition=0 offset=4\n…（共 12 单 × 2 事件 × 2 次 = 48 条）\n全部事件已确认写入（acks=all）",
    },
    {
      type: "paragraph",
      text: "同订单的两条事件落在同一分区、offset 连续——这是「同 key 同分区」的直接证据。回到终端一观察消费者：每笔订单的四条记录（created×2、paid×2）分别打出「状态流转」与「重复吸收」，整批 48 条处理完成后提交一次：",
    },
    {
      type: "code",
      title: "消费者输出（示例节选，4.3.1 + franz-go v1.21.6 实测）",
      language: "text",
      code: "2026/09/08 21:35:39 状态流转  20260908-000001  -> order.created（offset=0）\n2026/09/08 21:35:39 重复吸收  20260908-000001 已处于 order.created（offset=1）\n2026/09/08 21:35:39 状态流转  20260908-000001  -> order.paid（offset=2）\n2026/09/08 21:35:39 重复吸收  20260908-000001 已处于 order.paid（offset=3）\n…（其余 11 单同模式；不同分区交错打印属正常）\n2026/09/08 21:35:39 本批 48 条处理完成并提交",
    },
    {
      type: "code",
      title: "验收：DB 里只有 12 行，不是 48 行",
      language: "bash",
      code: "docker exec -i bookboat-pg psql -U bookboat -d bookboat \\\n  -c \"SELECT count(*) FROM order_state;\"\n\n count\n-------\n    12\n(1 row)",
    },
    {
      type: "code",
      title: "验收：组的滞后为 0",
      language: "bash",
      code: "kcli kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\\n  --describe --group stock-apply\n\n# 示例输出节选（CONSUMER-ID 为当前成员，退出后显示 -）：\n# GROUP         TOPIC         PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CONSUMER-ID  HOST        CLIENT-ID\n# stock-apply   orders.events 0          8               8               0    kgo-…        /172.17.0.1  kgo",
    },
    {
      type: "exercise",
      title: "阶段 B 动手：跑通发布 + 幂等消费闭环",
      description:
        "① 复制并运行 orders/main.go 与 stock/main.go（注意两个程序都要能编译通过：`go vet ./orders ./stock`）；② 先起消费者再跑 `go run ./orders -n 12 -repeat 2`，对照上面的输出，确认你能在日志里同时看到「状态流转」和「重复吸收」两种日志；③ 用 psql 数行数（应为 12 而不是 48），并用 consumer-groups describe 确认 LAG=0；④ 再跑一次 `go run ./orders -n 5 -start 100 -repeat 1`（新订单号），观察行数变为 17——**顺序执行多次 = 累加，重复投递 = 吸收**，这是 at-least-once 世界的基本盘；⑤ 思考题：把 `-repeat` 设成 3 再跑新一批，为什么行数仍然只等于订单数？如果这里不用唯一键而用「先删后插」会怎样？",
      hint: "验收看三点：重复事件不翻倍（行数 = 订单数）、状态只前进不回退（created 重复 = 吸收，paid 之后到的 created = 过期事件跳过）、提交只发生在整批处理成功后。阶段 D 会杀进程制造「真重复」，届时你会看到同样的吸收日志——先记住它的样子。",
    },
    {
      type: "divider",
    },
    {
      type: "heading",
      text: "阶段 C：失败处理——重试上限、死信与支付去重（约 25 分钟）",
    },
    {
      type: "paragraph",
      text: "B 阶段证明了「重复投递能被吸收」；C 阶段处理真正的失败。剧情：订单管道多一条支线——`payment-settle` 消费 `order.paid`，调用本地 mock 收单渠道收款，成功后落一张结算表。渠道是外部系统，会以**确定性**的方式失败（便于观察）：订单号末位 0-4 立即可用；5-7 **第一次请求返回 503（瞬态），重试即成功**；8-9 **永远 503（模拟渠道侧永久故障）**。你的消费者必须把第 5 章的机制全部落地：失败分类 → 瞬态有限次退避重试 → 仍失败带现场进死信；渠道调用带幂等键、落库带唯一键——**重复的 paid 事件只结算一次**。",
    },
    {
      type: "code",
      title: "channel/main.go（mock 收单渠道，HTTP :8090）",
      language: "go",
      code: `// channel/main.go —— 模拟收单渠道的 HTTP 服务（阶段 C）：
// 按 order_id 幂等：同一订单重复请求只收一次款。
// 行为按订单号末位数字确定（便于观察）：
//   0-4  立即可用（200 ok）
//   5-7  第一次繁忙（503 busy），第二次起成功 —— 瞬态故障
//   8-9  永远不可用（503 permanently_unavailable）—— 永久故障
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"sync"
)

type chargeReq struct {
	OrderID string \`json:"order_id"\`
	Amount  int64  \`json:"amount"\`
}

type chargeResp struct {
	Status string \`json:"status"\`
}

var (
	mu       sync.Mutex
	attempts = map[string]int{}  // order_id -> 已收到第几次请求
	charged  = map[string]bool{} // order_id -> 是否已收款
)

func main() {
	addr := flag.String("addr", ":8090", "监听地址")
	flag.Parse()

	http.HandleFunc("/charge", handleCharge)
	log.Printf("mock channel listening on %s（POST /charge）", *addr)
	log.Fatal(http.ListenAndServe(*addr, nil))
}

func handleCharge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req chargeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}

	mu.Lock()
	attempts[req.OrderID]++
	attempt := attempts[req.OrderID]
	already := charged[req.OrderID]
	mu.Unlock()

	respond := func(code int, status string) {
		body, _ := json.Marshal(chargeResp{Status: status})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write(body)
		fmt.Printf("[channel] %s 第 %d 次请求 -> HTTP %d %s\\n",
			req.OrderID, attempt, code, status)
	}

	digit := req.OrderID[len(req.OrderID)-1] - '0'
	switch {
	case digit >= 8:
		respond(http.StatusServiceUnavailable, "permanently_unavailable")
	case digit >= 5 && attempt == 1:
		respond(http.StatusServiceUnavailable, "busy")
	case already:
		respond(http.StatusOK, "already_charged") // 幂等命中：不重复收款
	default:
		mu.Lock()
		charged[req.OrderID] = true
		mu.Unlock()
		respond(http.StatusOK, "ok")
	}
}
`,
    },
    {
      type: "code",
      title: "payment/main.go（结算消费者：重试/死信/去重）",
      language: "go",
      code: `// payment/main.go —— 结算消费者（组 payment-settle，阶段 C）：
// 消费 orders.events 里的 order.paid，调用 mock 渠道结算；
// 瞬态失败有限次退避重试，仍失败则把原消息带现场投进 dlq.orders.events；
// 落库用唯一键（order_id）去重——重复投递的 paid 不会产生第二行结算记录。
package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/twmb/franz-go/pkg/kgo"
)

const (
	group       = "payment-settle"
	sourceTopic = "orders.events"
	dlqTopic    = "dlq.orders.events"
	maxAttempts = 3
	batchSize   = 50
)

// dlqEnvelope 与第 5 章死信课的结构保持一致：信封里带足原始消息与失败现场。
type dlqEnvelope struct {
	SourceTopic string    \`json:"source_topic"\`
	Partition   int32     \`json:"partition"\`
	Offset      int64     \`json:"offset"\`
	Key         []byte    \`json:"key"\`
	Value       []byte    \`json:"value"\`
	FailedAt    time.Time \`json:"failed_at"\`
}

var errTransient = errors.New("transient")

type orderEvent struct {
	OrderID string \`json:"orderId"\`
	Event   string \`json:"event"\`
	At      string \`json:"at"\`
	Amount  int64  \`json:"amount"\`
}

func main() {
	kafka := flag.String("kafka", "localhost:9092", "broker 地址")
	dsn := flag.String("dsn",
		"postgres://bookboat:bookboat@localhost:5433/bookboat?sslmode=disable",
		"PostgreSQL DSN")
	channelURL := flag.String("channel", "http://localhost:8090", "mock 渠道地址")
	flag.Parse()

	db, err := openDB(*dsn)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()

	cl, err := kgo.NewClient(
		kgo.SeedBrokers(*kafka),
		kgo.ConsumerGroup(group),
		kgo.ConsumeTopics(sourceTopic),
		kgo.DisableAutoCommit(),
		kgo.OnPartitionsRevoked(func(ctx context.Context, cl *kgo.Client, _ map[string][]int32) {
			if err := cl.CommitUncommittedOffsets(ctx); err != nil {
				log.Printf("revoke 补交失败: %v", err)
			}
		}),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	var settled, skipped int
	for {
		fetches := cl.PollRecords(ctx, batchSize)
		if fetches.IsClientClosed() || ctx.Err() != nil {
			break
		}
		fetches.EachError(func(topic string, partition int32, err error) {
			log.Printf("拉取错误 %s/%d: %v", topic, partition, err)
		})

		var batchErr error
		fetches.EachRecord(func(r *kgo.Record) {
			if batchErr != nil {
				return
			}
			done, err := handlePaid(ctx, db, cl, *channelURL, r)
			if err != nil {
				batchErr = err
				return
			}
			if done {
				settled++
			} else {
				skipped++
			}
		})
		if batchErr != nil {
			log.Fatalf("处理失败，本批位点未提交：%v", batchErr)
		}

		if err := cl.CommitUncommittedOffsets(ctx); err != nil {
			log.Printf("提交失败: %v", err)
		}
		if fetches.NumRecords() > 0 {
			log.Printf("本批 %d 条提交完成（累计结算 %d 条、跳过 %d 条）",
				fetches.NumRecords(), settled, skipped)
		}
	}
}

// handlePaid 处理一条订单事件；done=true 表示这笔订单本次完成结算。
func handlePaid(ctx context.Context, db *sql.DB, cl *kgo.Client, channelURL string, r *kgo.Record) (bool, error) {
	var ev orderEvent
	if err := json.Unmarshal(r.Value, &ev); err != nil {
		toDLQ(ctx, cl, r, 0, fmt.Errorf("JSON 解析失败: %w", err))
		return false, nil // 永久失败：进死信，本消息处理完毕
	}
	if ev.Event != "order.paid" {
		return false, nil // 只处理支付成功事件，其余（created 等）跳过并照常提交
	}

	// 去重①：结算表里已有该订单 → 重复投递（或已结算过），直接吸收，不再调渠道
	var one int
	err := db.QueryRowContext(ctx,
		"SELECT 1 FROM payment_settlements WHERE order_id = $1", ev.OrderID).Scan(&one)
	if err == nil {
		log.Printf("重复吸收  %s 已结算过，跳过渠道调用（offset=%d）", ev.OrderID, r.Offset)
		return false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}

	attempts, err := settleWithRetry(ctx, channelURL, ev)
	if err != nil {
		// 有限次重试仍失败：带现场进死信，由人工/自动补偿后重放
		toDLQ(ctx, cl, r, attempts, err)
		return false, nil
	}

	// 去重②：唯一键兜底（防并发/防重复插入），真正落库只有一次
	res, err := db.ExecContext(ctx, \`
		INSERT INTO payment_settlements (order_id, amount, channel, settled_at)
		VALUES ($1, $2, 'mock-channel', now())
		ON CONFLICT (order_id) DO NOTHING\`,
		ev.OrderID, ev.Amount)
	if err != nil {
		return false, fmt.Errorf("结算落库: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		log.Printf("唯一键命中  %s 已有结算行（并发或重复，视为成功）", ev.OrderID)
		return false, nil
	}
	log.Printf("结算成功  %s amount=%d（offset=%d）", ev.OrderID, ev.Amount, r.Offset)
	return true, nil
}

// settleWithRetry 调渠道结算：瞬态失败退避重试 maxAttempts 次。
func settleWithRetry(ctx context.Context, channelURL string, ev orderEvent) (int, error) {
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		lastErr = callChannel(ctx, channelURL, ev)
		if lastErr == nil {
			return attempt, nil
		}
		if !errors.Is(lastErr, errTransient) {
			return attempt, lastErr // 永久失败：重试没有意义
		}
		if attempt < maxAttempts {
			backoff := time.Duration(attempt*attempt) * 300 * time.Millisecond // 0.3s、1.2s
			log.Printf("瞬态失败将重试 %s 第 %d 次失败：%v（%s 后重试）",
				ev.OrderID, attempt, lastErr, backoff)
			time.Sleep(backoff)
		}
	}
	return maxAttempts, lastErr
}

func callChannel(ctx context.Context, channelURL string, ev orderEvent) error {
	body, _ := json.Marshal(map[string]any{
		"order_id": ev.OrderID,
		"amount":   ev.Amount,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, channelURL+"/charge", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("%w: %v", errTransient, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Idempotency-Key", ev.OrderID) // 幂等键：渠道侧按订单去重
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: 渠道不可达: %v", errTransient, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	detail := strings.TrimSpace(string(data))
	switch {
	case resp.StatusCode == http.StatusOK:
		log.Printf("渠道成功  %s 响应 %s", ev.OrderID, detail)
		return nil
	case resp.StatusCode >= 500:
		return fmt.Errorf("%w: 渠道 HTTP %d %s", errTransient, resp.StatusCode, detail)
	default:
		return fmt.Errorf("渠道 HTTP %d %s（不可重试）", resp.StatusCode, detail)
	}
}

// toDLQ 把处理失败的原消息包成信封（保留 key/value/来源坐标/时间），
// 并把失败原因放进 header，供死信消费者审计与重放。
func toDLQ(ctx context.Context, cl *kgo.Client, r *kgo.Record, attempts int, cause error) {
	env, _ := json.Marshal(dlqEnvelope{
		SourceTopic: r.Topic,
		Partition:   r.Partition,
		Offset:      r.Offset,
		Key:         r.Key,
		Value:       r.Value,
		FailedAt:    time.Now().UTC(),
	})
	res := cl.ProduceSync(ctx, &kgo.Record{
		Topic: dlqTopic,
		Key:   r.Key, // 保留原 key：按订单聚合与重放去重都靠它
		Value: env,
		Headers: []kgo.RecordHeader{
			{Key: "error", Value: []byte(cause.Error())},
			{Key: "status", Value: []byte("review")},
			{Key: "attempts", Value: []byte(strconv.Itoa(attempts))},
		},
	})
	if res.FirstErr() != nil {
		log.Printf("写死信失败（死信丢失，需人工核查）：%v", res.FirstErr())
		return
	}
	log.Printf("已投死信  %s/%d offset=%d（尝试 %d 次：%v）",
		r.Topic, r.Partition, r.Offset, attempts, cause)
}

func openDB(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, err
	}
	_, err = db.ExecContext(ctx, \`
		CREATE TABLE IF NOT EXISTS payment_settlements (
			order_id   TEXT PRIMARY KEY,
			amount     BIGINT NOT NULL,
			channel    TEXT NOT NULL,
			settled_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)\`)
	return db, err
}
`,
    },
    {
      type: "code",
      title: "dlqdump/main.go（死信查看器）",
      language: "go",
      code: `// dlqdump —— 死信查看器：不带消费组，把 dlq.orders.events 从头打印一遍
// （信封字段 + headers），跑 -t 秒后自动退出。
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

type dlqEnvelope struct {
	SourceTopic string \`json:"source_topic"\`
	Partition   int32  \`json:"partition"\`
	Offset      int64  \`json:"offset"\`
	Key         []byte \`json:"key"\`
	Value       []byte \`json:"value"\`
	FailedAt    string \`json:"failed_at"\`
}

type orderEvent struct {
	OrderID string \`json:"orderId"\`
	Event   string \`json:"event"\`
	At      string \`json:"at"\`
	Amount  int64  \`json:"amount"\`
}

func main() {
	kafka := flag.String("kafka", "localhost:9092", "broker 地址")
	seconds := flag.Int("t", 5, "读取多少秒后退出")
	flag.Parse()

	cl, err := kgo.NewClient(
		kgo.SeedBrokers(*kafka),
		kgo.ConsumeTopics("dlq.orders.events"),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	// 无组消费默认从最早位置开始：每次运行都完整打印现有死信
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*seconds)*time.Second)
	defer cancel()

	for ctx.Err() == nil {
		fetches := cl.PollFetches(ctx)
		fetches.EachError(func(topic string, partition int32, err error) {
			fmt.Printf("读取错误 %s/%d: %v\\n", topic, partition, err)
		})
		fetches.EachRecord(func(r *kgo.Record) {
			var env dlqEnvelope
			_ = json.Unmarshal(r.Value, &env)
			var ev orderEvent
			_ = json.Unmarshal(env.Value, &ev)
			headers := map[string]string{}
			for _, h := range r.Headers {
				headers[h.Key] = string(h.Value)
			}
			fmt.Println("--- 死信记录 ---")
			fmt.Printf("headers: error=%q status=%q attempts=%q\\n",
				headers["error"], headers["status"], headers["attempts"])
			fmt.Printf("来源: %s/%d offset=%d @ %s\\n",
				env.SourceTopic, env.Partition, env.Offset, env.FailedAt)
			fmt.Printf("原消息: order=%s event=%s amount=%d\\n",
				ev.OrderID, ev.Event, ev.Amount)
		})
	}
}
`,
    },
    {
      type: "paragraph",
      text: "先读 payment/main.go 里的三个分层，它们对应三种不同的「重复/失败来源」：**去重①**在调渠道之前查结算表——重复投递的 paid（如 `-repeat 2` 产生的第二条）被直接吸收，不浪费渠道调用；**去重②**是唯一键兜底（`ON CONFLICT DO NOTHING`，RowsAffected=0 即已存在）；**渠道幂等键**（`X-Idempotency-Key: order_id`）是第三层——它防的是「渠道调用发出、结算落库前崩溃」的窗口：重投后 DB 查不到记录、渠道会被再调一次，但渠道凭幂等键只收一次款。三层里前两层是日常主力，第三层是崩溃窗口的保险——这正是[投递语义课](/courses/kafka/lessons/kafka-delivery-semantics)「对外部系统只能做到有效一次」的落地。",
    },
    {
      type: "callout",
      variant: "note",
      title: "失败分类的代码长什么样",
      body: "看 settleWithRetry：`callChannel` 返回的错误被分为两类——**瞬态**（网络错误、HTTP 5xx，包一层 `errTransient`）会退避重试，退避 300ms → 1.2s，上限 3 次；**永久**（HTTP 4xx 等）不重试直接返回。`toDLQ` 把原始消息包成信封（含来源 topic/partition/offset、原 key/value、失败时间）并写三个 header：`error`（失败原因）、`status: review`、`attempts`（已试次数）——与第 5 章死信课的结构一致。投死信后**照常提交位点**：这条消息已处理完毕（归宿是死信），不提交会让它无限重投。",
    },
    {
      type: "paragraph",
      text: "运行顺序很重要，它本身就是一次教学：**payment-settle 是全新消费组，默认 earliest，启动后会先把 `orders.events` 里的历史（B 阶段那 48 条）从头重放一遍**——created 被跳过，历史 paid 全部被结算。这不是 bug，是[提交日志](glossary:commit-log)模型的能力：新消费者补历史不需要任何数据搬运。三个终端：",
    },
    {
      type: "code",
      title: "终端一：mock 渠道",
      language: "bash",
      code: "go run ./channel",
    },
    {
      type: "code",
      title: "终端二：结算消费者（先启动，观察它重放历史）",
      language: "bash",
      code: "go run ./payment",
    },
    {
      type: "code",
      title: "终端三：发新一批订单（101 起，每条事件发 2 次制造重复）",
      language: "bash",
      code: "go run ./orders -n 20 -start 101 -repeat 2",
    },
    {
      type: "code",
      title: "结算消费者输出（示例节选，4.3.1 实测；时间与 offset 随运行而异）",
      language: "text",
      code: "2026/09/08 21:36:32 渠道成功  20260908-000005 响应 {\"status\":\"ok\"}\n2026/09/08 21:36:32 结算成功  20260908-000005 amount=3350（offset=2）\n2026/09/08 21:36:32 重复吸收  20260908-000005 已结算过，跳过渠道调用（offset=3）   ← 重复的 paid\n…\n2026/09/08 21:36:39 瞬态失败将重试 20260908-000007 第 1 次失败：transient: 渠道 HTTP 503 {\"status\":\"busy\"}（300ms 后重试）\n2026/09/08 21:36:39 渠道成功  20260908-000007 响应 {\"status\":\"ok\"}                       ← 5-7 号：重试即成功\n2026/09/08 21:36:39 结算成功  20260908-000007 amount=4090（offset=6）\n…\n2026/09/08 21:36:41 瞬态失败将重试 20260908-000109 第 2 次失败：…（1.2s 后重试）\n2026/09/08 21:36:42 已投死信  20260908-000109 orders.events/7 offset=15（尝试 3 次：…503 permanently_unavailable）  ← 8-9 号：重试耗尽进死信\n…\n2026/09/08 21:36:53 本批 26 条提交完成（累计结算 26 条、跳过 102 条）",
    },
    {
      type: "code",
      title: "渠道日志（示例节选：5-7 号 503→200，8-9 号连续 503；幂等键层平时不触发）",
      language: "text",
      code: "[channel] 20260908-000007 第 1 次请求 -> HTTP 503 busy\n[channel] 20260908-000007 第 2 次请求 -> HTTP 200 ok\n[channel] 20260908-000008 第 1 次请求 -> HTTP 503 permanently_unavailable\n[channel] 20260908-000008 第 2 次请求 -> HTTP 503 permanently_unavailable\n[channel] 20260908-000008 第 3 次请求 -> HTTP 503 permanently_unavailable\n…（注意：8-9 号订单各出现 3 次 × 2 条事件 = 6 次请求，因为它们从未结算成功、去重①拦不住）",
    },
    {
      type: "code",
      title: "用 dlqdump 查看死信（信封 + headers 全带现场）",
      language: "bash",
      code: "go run ./dlqdump\n\n--- 死信记录 ---\nheaders: error=\"transient: 渠道 HTTP 503 {\\\"status\\\":\\\"permanently_unavailable\\\"}\" status=\"review\" attempts=\"3\"\n来源: orders.events/7 offset=14 @ 2026-09-08T13:36:41.4758396Z\n原消息: order=20260908-000109 event=order.paid amount=41830\n--- 死信记录 ---\n…（示例计数：历史单 8、9 各 2 条 + 新单 108/109/118/119 各 2 条 = 共 12 条信封——死信路径不自动去重，见下方 callout）",
    },
    {
      type: "callout",
      variant: "warning",
      title: "死信自己也是 at-least-once 的一段",
      body: "注意 dlqdump 的输出里同一张失败订单出现**多条信封**：`-repeat 2` 产生的两条重复 paid 各自完整走完「重试耗尽 → 投死信」，所以本课的 6 张失败订单（历史单 8、9 + 新单 108/109/118/119）各留下 2 条信封、共 12 条。这不是 bug，是死信管道诚实的 at-least-once 语义——**投死信也是一个普通 Produce，不承诺去重**。推论很实际：重放死信的工具必须幂等（重放前查结算表/唯一键），否则修好渠道后一重放，8-9 号订单会被重复处理。第 5 章死信课里「死信增长本身要告警、要有人看」在这里有了具体的形状。",
    },
    {
      type: "exercise",
      title: "阶段 C 动手：跑通 失败 → 重试 → 死信 → 去重",
      description:
        "① 三个终端分别跑 channel、payment、orders（先 payment 再 orders，观察历史重放）；② 在三个日志里分别找到：渠道成功（0-4 号订单）、第一次 503 重试后成功（5-7 号）、3 次尝试后「已投死信」（8-9 号）、「重复吸收 已结算过」（重复的 paid 被拦在渠道之前）；③ 用 psql 数 `payment_settlements` 行数——它应等于「已结算成功的订单数」，重复事件不翻倍（本课示例：历史 10 单 + 新 16 单 = 26 行）；④ 用 dlqdump 看死信信封与 headers，确认 attempts=3、status=review；⑤ 思考题：结算表为什么用 `DO NOTHING` 而 order_state 用 `DO UPDATE`？如果把渠道调用放到「先插结算行」之后，能省掉什么、又会引入什么新窗口？",
      hint: "去重①依赖「先查表」——所以重复的 paid 在渠道日志里只出现一次；而 8-9 号订单从未结算成功，去重①拦不住它们的重复事件，渠道日志里每个事件都出现 3 次。DO NOTHING vs DO UPDATE 的区别回到第 5 章幂等消费两种方法的适用场景想。",
    },
    {
      type: "divider",
    },
    {
      type: "heading",
      text: "阶段 D：可观测与故障演练（约 20 分钟）",
    },
    {
      type: "paragraph",
      text: "最后一步是把「它真的可靠吗」变成可观察的证据。三组演练，每组先看现象再解释原理。前两组用 `stock-apply` 消费组，第三组（可选）动 broker。",
    },
    {
      type: "subheading",
      text: "D-1 消费停了，lag 会说话",
    },
    {
      type: "paragraph",
      text: "Kafka 里最便宜的健康指标是[消费滞后](glossary:lag)：生产者一直在写、消费端停一下，`kafka-consumer-groups.sh --describe` 的 LAG 列立刻上涨。把消费者全部停掉，用 `-gap 0` 快速灌一批订单（`-start 9001` 避开已用订单号），再 describe：",
    },
    {
      type: "code",
      title: "灌一批货，然后看无人消费时的积压",
      language: "bash",
      code: "go run ./orders -n 200 -start 9001 -gap 0 -sleep 0\n#（Ctrl+C 停掉 stock 与 payment 之后再 describe）\nkcli kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\\n  --describe --group stock-apply\n\n# 示例输出节选：LAG 列非 0，CURRENT-OFFSET 停在原处、LOG-END-OFFSET 继续涨\n# GROUP        TOPIC          PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG   CONSUMER-ID  HOST        CLIENT-ID\n# stock-apply  orders.events  0          34              78              44    -            -           -\n# stock-apply  orders.events  1          42              100             58    -            -           -\n# stock-apply  orders.events  5          28              80              52    -            -           -",
    },
    {
      type: "paragraph",
      text: "三列一起读：`CURRENT-OFFSET`（已提交位点）不动、`LOG-END-OFFSET`（分区末尾）在涨、`LAG` 就是两者的差。消费端一恢复，LAG 会被追平回 0——**lag 是「消费跟不上生产」的体温计，先看它再决定要不要加机器**（第 4 章与第 9 章 [观测课](/courses/kafka/lessons/kafka-monitoring-lag)都强调：加消费者实例救不了单个热分区）。",
    },
    {
      type: "subheading",
      text: "D-2 kill -9：亲手看一次重复窗口与提交行为",
    },
    {
      type: "paragraph",
      text: "这是本课最重要的一个实验。先让消费者**故意变慢**（`-slow 100ms`：每条消息处理前睡 100ms），同时灌入大量积压；趁它处理到一半时**强杀进程**（模拟崩溃：不发 LeaveGroup、不提交）；等组协调器判定成员死亡（会话超时默认 45s，第 4 章讲过）后重启消费者——观察两件事：**未提交的尾部被重读**（日志里同一批 offset 再次出现），以及**数据库没有因此翻倍**（幂等吸收）。",
    },
    {
      type: "code",
      title: "演练步骤（kill 命令按你的系统选一行）",
      language: "bash",
      code: "# ① 生产一大波积压（消费者此刻停着）\ngo run ./orders -n 200 -start 2001 -gap 0 -sleep 0\n\n# ② 起一个慢消费者（新终端）\ngo run ./stock -slow 100ms\n# 观察它一条条慢慢消化积压……\n\n# ③ 趁它处理到一半，强杀（崩溃模拟；优雅 Ctrl+C 不算）\n# Linux/macOS：ps aux | grep stock  找到 pid 后 kill -9 <pid>\n# Windows PowerShell：Get-Process stock | Select Id\n#                     Stop-Process -Id <pid> -Force\n\n# ④ describe 看现场：被杀的成员还在列表里（协调器等会话超时），\n#    某些分区 CURRENT-OFFSET 未提交、LAG 挂着\nkcli kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\\n  --describe --group stock-apply\n\n# ⑤ 等约 45 秒（会话超时）后重启普通速度的消费者，观察日志",
    },
    {
      type: "code",
      title: "④ 被杀瞬间的组状态（示例节选，4.3.1 实测）",
      language: "text",
      code: "GROUP         TOPIC          PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG   CONSUMER-ID  HOST        CLIENT-ID\nstock-apply   orders.events  8          24              34              10    kgo-6b8377…  /172.17.0.1  kgo\nstock-apply   orders.events  9          -               32              -     kgo-6b8377…  /172.17.0.1  kgo\nstock-apply   orders.events  10         -               26              -     kgo-6b8377…  /172.17.0.1  kgo\nstock-apply   orders.events  11         -               32              -     kgo-6b8377…  /172.17.0.1  kgo\n\n# 读法：分区 8 已提交到 24，正在处理 24-33 这一批（LAG=10，未提交）；\n# 分区 9-11 连第一次提交都没来得及做（CURRENT-OFFSET 为 -）——\n# 这些正是崩溃后被重读的范围。",
    },
    {
      type: "paragraph",
      text: "等约 45 秒、成员被移除后重启消费者（这次不 `-slow`）：它会从**最后提交的位点**继续，把那批「已处理未提交」的尾部重读一遍——日志里 offset 与杀前重合，打出的日志以「重复吸收/过期事件跳过」为主（因为 DB 里已有这些订单的状态），然后快速把积压追平：",
    },
    {
      type: "code",
      title: "⑤ 重启后的日志开头（示例节选：与杀前重合的 offset 被重读、被幂等吸收）",
      language: "text",
      code: "2026/09/08 21:44:32 状态流转  20260908-002116  -> order.created（offset=18）\n2026/09/08 21:44:32 状态流转  20260908-002116  -> order.paid（offset=19）\n2026/09/08 21:44:32 本批 50 条处理完成并提交\n…（重启后从最后提交位点继续：未提交的尾部会被再次读到）",
    },
    {
      type: "paragraph",
      text: "怎么确认「重读真的发生了」而不是猜测：把杀前日志的尾部与重启后日志的头部放在一起对照，找同一批 offset——例如杀前最后处理到分区 8 的 offset 33，重启后日志会再次出现从 24（最后提交点）开始的记录。这些记录重投时打出的多是「重复吸收 / 过期事件跳过」而非新的「状态流转」，因为 DB 里已经有这批订单的状态了——**重复发生在消息层，被幂等吸收在落库层**，这正是 at-least-once + 幂等这条管道每一环的日常。",
    },
    {
      type: "code",
      title: "最终验收：LAG 归零 + DB 行数不多不少",
      language: "bash",
      code: "kcli kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\\n  --describe --group stock-apply\n# LAG 全部回到 0\n\ndocker exec -i bookboat-pg psql -U bookboat -d bookboat \\\n  -c \"SELECT count(*) FROM order_state;\"\n# = 已经产生的订单总数（2001-2200 共 200 张 → 200 行），崩溃重读不翻倍",
    },
    {
      type: "callout",
      variant: "tip",
      title: "这个实验为什么是面试金矿",
      body: "「你的管道崩溃一次会重复多少消息？」——如果你亲手做过这个实验，答案不是背出来的：重复范围 ≈ 最近一次提交之后 poll 到的记录（本程序手动提交 + 批大小 50，所以是一个批次的量级；自动提交则还要加最长 5 秒的尾巴），且这些重复会被幂等吸收。会话超时默认 45 秒意味着 kill 之后协调器要等这么久才把分区判给别人——重启太快会看到消费者「干等」。这些数字第 11 章不会替你说，下一课[复盘](/courses/kafka/lessons/kafka-capstone-review)会教你怎么把它们讲成故事。",
    },
    {
      type: "subheading",
      text: "D-3（选做）停 broker：单节点如实会发生什么",
    },
    {
      type: "paragraph",
      text: "把生产端停掉前先想清楚：本地是**单节点 rf=1**——这台 broker 同时是唯一副本、唯一的控制器。它一停，producer 发不出、consumer 拉不到，没有任何副本可切换，**这是单点，不是故障转移的演示**。但客户端行为仍然值得看：停 broker 时正在发送的生产者会怎样？",
    },
    {
      type: "code",
      title: "演练：生产者运行中停掉 broker（只 stop，不 rm！）",
      language: "bash",
      code: "# 终端一：跑一个慢速生产者（每条事件间隔拉长，留出操作时间）\ngo run ./orders -n 60 -start 3001 -gap 100ms -sleep 1ms\n\n# 终端二：运行几秒后停掉 broker，观察终端一\n docker stop kafka        # 只停容器，数据目录还在\n# → producer 不再打印新的“已确认”，同步发送阻塞在重试队列里\n# → （等 10~20 秒后）\n docker start kafka       # 数据原样回来\n# → producer 自动恢复，把停摆期间积压的消息全部补发完成\n# → 最后打印：全部事件已确认写入（acks=all）",
    },
    {
      type: "code",
      title: "实测现象（4.3.1 + franz-go v1.21.6；时间戳省略）",
      language: "text",
      code: "已确认 20260908-003018  order.created -> partition=7 offset=44\n已确认 20260908-003018  order.paid    -> partition=7 offset=45\n已确认 20260908-003019  order.created -> partition=1 offset=36   ← 此处 broker 被 stop\n（约 10 秒无输出：请求在客户端内退避重试，未确认消息在客户端手里，不丢）\n已确认 20260908-003019  order.paid    -> partition=1 offset=37   ← broker 回来后继续\n已确认 20260908-003020  order.created -> partition=8 offset=34\n…\n全部事件已确认写入（acks=all）",
    },
    {
      type: "callout",
      variant: "warning",
      title: "如实说明单节点的边界",
      body: "这个实验里一条消息都没丢，原因要讲准确：`acks=all` 确认过的消息已落在这台 broker 的磁盘（stop 不删数据），没确认的还在客户端缓冲里等重试——**没有任何一条是「副本救回来的」**。真实的数据安全 = rf=3 + min.insync.replicas=2 的集群：任何一台 broker 宕机，副本仍在、ISR 收缩后写入继续或按 minISR 拒绝（宁可失败不丢）。本地单节点能演示的只是客户端行为，演示不了副本冗余——那部分见[第 9 章](/courses/kafka/lessons/kafka-kraft-cluster-deploy)。另外再次强调：这个演练用的是你自己的学习容器；别对共享环境里的 broker 做 stop。",
    },
    {
      type: "exercise",
      title: "阶段 D 动手：把可靠性变成可观察的证据",
      description:
        "① 按 D-1 制造一次无人消费的积压并用 describe 读出 LAG，然后恢复消费、看着 LAG 归零；② 按 D-2 完整做一次「慢消费 → kill -9 → 等 45 秒 → 重启」：在杀前日志、describe 现场、重启日志三处找到证据（未提交分区 CURRENT-OFFSET 为 -、重启后同批 offset 重读、DB 行数不翻倍）；③ 做完把 `-slow` 去掉对比一次：重复范围是不是从「一批（50 条）以内」变成了更小？④（选做）按 D-3 停一次 broker，观察生产者阻塞重试与恢复补发；⑤ 用你自己的话回答：这套管道里「不丢」由哪几段保证、「不重」由哪一段保证？",
      hint: "重复范围由提交粒度决定：手动提交 + PollRecords(50) 时崩溃最多重读当前这一批；默认自动提交（每 5 秒、滞后一轮 poll）则多出秒级尾巴。想对比的话，把 stock/main.go 里的 DisableAutoCommit 那行注释掉再杀一次——你会看到窗口变大。第 5 题的标准答案结构在[投递语义课](/courses/kafka/lessons/kafka-delivery-semantics)的三段归属表里。",
    },
    {
      type: "divider",
    },
    {
      type: "heading",
      text: "总验收清单",
    },
    {
      type: "table",
      caption: "四阶段验收一览（全部通过 = 本课完成）",
      headers: ["里程碑", "关键验收", "通过标准"],
      rows: [
        ["A 主题设计", "三个主题 describe 输出", "orders.events：12 分区、Configs 含 retention.ms=604800000；inventory.stock：cleanup.policy=compact；dlq.orders.events：与源主题同分区数；设计表每行理由能口述"],
        ["B 发布与幂等消费", "生产者/消费者日志 + psql + describe", "同订单同分区连续 offset；日志同时出现「状态流转」与「重复吸收」；order_state 行数 = 订单数（重复不翻倍）；组 LAG=0"],
        ["C 失败处理与去重", "channel/payment 日志 + dlqdump", "末位 5-7 订单：503 一次后重试成功；末位 8-9 订单：3 次尝试后进死信（信封带 error/status=review/attempts=3）；重复 paid 打印「重复吸收 已结算过」且结算表行数 = 成功订单数；dlqdump 能看到信封与 headers"],
        ["D 可观测与故障演练", "describe 三连 + kill -9 实验", "无人消费时 LAG>0、消费恢复后 LAG=0；kill -9 后未提交分区 CURRENT-OFFSET 为 -；重启后同批 offset 重读但 DB 不翻倍；（选做）停 broker 后 producer 阻塞重试、恢复后补发完成"],
      ],
    },
    {
      type: "heading",
      text: "你刚刚做过的每一步，对应书里哪一课",
    },
    {
      type: "table",
      caption: "项目动作 → 课程知识点映射",
      headers: ["你在项目里做的", "对应的原理与课时", "一句话收获"],
      rows: [
        ["主题三分：事件流 / 状态 / 死信，各自配不同的保留与清理", "存储与保留策略（[Segment、保留策略与日志压缩](/courses/kafka/lessons/kafka-storage-segments-retention)）；主题语义设计（[事件建模](/courses/kafka/lessons/kafka-event-modeling)）", "主题是存储语义的载体，一种语义一套策略"],
        ["orders.events 12 分区 + key=order_id，并把推导写进设计表", "分区与键（[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)）", "分区数 = 吞吐 ÷ 单分区、消费并行度、增长余量三约束；key 决定顺序边界"],
        ["生产者保持默认 acks=all + 幂等，ProduceSync 逐条确认", "可靠发布（[可靠发布：acks、重试与幂等生产者](/courses/kafka/lessons/kafka-producer-reliability-acks)）", "确认过的才不丢；未确认的在客户端手里"],
        ["手动提交：整批成功才提交 + revoke 补交 + 批大小限制", "提交时机（[拉取模型、位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)）", "提交粒度 = 崩溃后的重复窗口"],
        ["kill -9 后协调器等 45 秒才移除成员，重启后从提交位点续读", "消费组协调（[消费组与经典再平衡协议](/courses/kafka/lessons/kafka-consumer-groups-classic)）", "会话超时决定故障转移延迟，未提交尾部必然重读"],
        ["重复事件被「状态比较 + 唯一键」吸收，DB 行数不翻倍", "幂等消费（[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)）", "at-least-once 的重复要靠业务键幂等兜底"],
        ["失败分类、退避重试上限、死信信封带现场", "失败模式（[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)）", "永久失败别重试，死信要带现场且要有人看"],
        ["结算表 DO NOTHING vs 投影表 DO UPDATE；渠道幂等键", "投递语义（[投递语义](/courses/kafka/lessons/kafka-delivery-semantics)）", "「有效一次」= 幂等键 + 唯一键，事务管不到外部系统"],
        ["全新消费组从 earliest 重放历史；LAG 三列读法", "拉取模型与滞后（[位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)、[观测](/courses/kafka/lessons/kafka-monitoring-lag)）", "提交日志可回放；lag 是消费健康体温计"],
        ["停 broker 观察客户端行为，并如实区分单点与集群", "生产端故障行为（[可靠发布](/courses/kafka/lessons/kafka-producer-reliability-acks)）；集群部署（[KRaft 集群](/courses/kafka/lessons/kafka-kraft-cluster-deploy)）", "单节点只能演示客户端语义，副本冗余要 rf=3"],
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "90 分钟用不完怎么办",
      body: "最低完成线是 A + B（主题设计 + 发布与幂等消费），那已经覆盖了架构决策与 at-least-once 的核心闭环；C 的死信与去重是全书最有工程味道的一环，建议无论如何补上；D 的 kill -9 实验哪怕只做一遍也值得——它是你以后面试里「我验证过重复窗口」这句话的来源。每个阶段的验收独立成立，随时可以分次做完。",
    },
    {
      type: "paragraph",
      text: "到这里，一条「能解释自己每个行为」的订单事件管道就在你手上了。先别急着开新项目——下一课[项目复盘：架构决策与评审清单](/courses/kafka/lessons/kafka-capstone-review)会把你在这一课里做过的每个决策逐条对照原理，并教你怎么把这条管道讲成一个 30 秒/3 分钟的项目叙事。",
    },
  ],
};
