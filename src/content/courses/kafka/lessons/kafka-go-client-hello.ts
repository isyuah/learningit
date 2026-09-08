/* ==================================================================
 * 课时：franz-go 初体验：第一个 Go 生产者与消费者（kafka-go-client-hello）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 事实核对（2026-09-08）：franz-go v1.21.6（proxy.golang.org @latest 确认）；
 * 全部代码在 Kafka 4.3.1 单节点上编译并端到端运行验证。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "第一个真实可运行的 franz-go 端到端程序：把订单事件异步发进 orders.events、用消费组读回来，并用 CLI 验证分区、offset 与消费组滞后。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课的 CLI 收发已经证明了 broker 在工作；这一课把「CLI 干的事」换成 Go 代码——写完、编译、跑通一个真实的端到端程序：生产者把订单事件发进 `orders.events`，消费者用消费组读出来打印，最后回到 CLI 验证这个组的滞后是 0。代码量不大，但里面每一行都是后面所有章节的地基：你会第一次接触异步发送的回调、拉取循环、以及「位置自动提交」这个第 4 章的主角。",
    },
    {
      type: "heading",
      text: "准备项目与依赖",
    },
    {
      type: "code",
      title: "初始化项目并引入 franz-go",
      language: "bash",
      code: `mkdir kafka-hello && cd kafka-hello
go mod init kafka-hello
go get github.com/twmb/franz-go@v1.21.6`,
    },
    {
      type: "paragraph",
      text: "我们固定到 `v1.21.6`（本课程写作时的当前版本，用 `go get ...@v1.21.6` 精确锁定；如果你拿到更新的版本，API 形状不变，个别默认值以 [pkg.go.dev 文档](https://pkg.go.dev/github.com/twmb/franz-go/pkg/kgo)为准）。为什么选 franz-go：它是**纯 Go** 实现的 Kafka 客户端，项目 README 自述「功能完整的客户端，覆盖 Kafka 0.8.0 到 4.2+」，凡是官方 Java 客户端具备的能力（生产/消费、消费组、事务、管理 API……）它都对齐——本课示例就是在 4.3.1 的 broker 上实测运行的。它是 Go 社区维护最活跃的 Kafka 客户端，所以这门课的全部 Go 示例都建立在它之上。",
    },
    {
      type: "heading",
      text: "客户端视角的一条消息：Record",
    },
    {
      type: "paragraph",
      text: "进入代码前先对齐一个词：在客户端语境里，一条待发送/已收到的消息叫 **Record**（记录），它对应 broker 日志里的[一条日志记录](glossary:commit-log)。我们只用到三个字段：`Topic` 发往哪个[主题](glossary:topic)；`Key` 分区键（[]byte）——分区器对 key 做哈希，**同 key 永远进同一个[分区](glossary:partition)**，这是上一课 CLI 验证过的规律，本课用代码再验证一次；`Value` 消息体（[]byte）。序列化是调用方的事：我们把订单事件 `json.Marshal` 成字节塞进 Value——Kafka 不关心你存的是 JSON、Avro 还是别的，它只搬运字节（schema 管理是[第 6 章](/courses/kafka/lessons/kafka-event-modeling)的事）。",
    },
    {
      type: "code",
      title: "项目结构：两个可执行程序",
      language: "text",
      code: `kafka-hello/
├── go.mod
├── producer/
│   └── main.go     # 终端一运行：go run ./producer
└── consumer/
    └── main.go     # 终端二运行：go run ./consumer`,
    },
    {
      type: "heading",
      text: "先写生产者",
    },
    {
      type: "paragraph",
      text: "把下面的代码存为 `producer/main.go`。它发送三条订单事件：两条不同的订单（`order.created`），外加 `20260908-000123` 的后续状态 `order.paid`——特意让同一个订单号出现两次，稍后验证「同 key 同分区」。",
    },
    {
      type: "code",
      title: "producer/main.go（完整可运行，franz-go v1.21.6）",
      language: "go",
      code: `package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

// 订单事件的最小结构：字段顺序无关紧要，Value 里存的是 JSON 字节
type orderEvent struct {
	OrderID string \`json:"orderId"\`
	Event   string \`json:"event"\`
	Amount  int64  \`json:"amount"\`
	At      string \`json:"at"\`
}

func main() {
	// 1) 创建客户端：seed broker 是集群入口（默认就是 127.0.0.1:9092，显式写出更清楚）
	cl, err := kgo.NewClient(kgo.SeedBrokers("localhost:9092"))
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	now := time.Now().UTC().Format(time.RFC3339)
	mk := func(orderID, event string, amount int64) *kgo.Record {
		v, _ := json.Marshal(orderEvent{OrderID: orderID, Event: event, Amount: amount, At: now})
		return &kgo.Record{
			Topic: "orders.events",        // 主题
			Key:   []byte(orderID),        // 分区键：同 key -> 同分区
			Value: v,                      // 消息体：JSON 字节
		}
	}

	records := []*kgo.Record{
		mk("20260908-000123", "order.created", 5900),
		mk("20260908-000124", "order.created", 12800),
		mk("20260908-000123", "order.paid", 5900), // 同一个订单再发一条
	}

	// 2) 异步发送：Produce 立即返回，结果由第三个参数（promise 回调）通知
	for _, rec := range records {
		cl.Produce(context.Background(), rec, func(r *kgo.Record, err error) {
			if err != nil {
				fmt.Printf("投递失败 key=%s: %v\\n", r.Key, err)
				return
			}
			// 成功时：r.Partition 与 r.Offset 已被客户端填上 broker 分配的坐标
			fmt.Printf("已写入 topic=%s partition=%d offset=%d key=%s\\n",
				r.Topic, r.Partition, r.Offset, r.Key)
		})
	}

	// 3) 等缓冲清空：Flush 阻塞到所有消息发完（或失败回调触发），退出前必须做
	if err := cl.Flush(context.Background()); err != nil {
		log.Fatal(err)
	}
	fmt.Println("flush 完成")
}`,
    },
    {
      type: "paragraph",
      text: "逐段解读这段代码：**① 客户端**——`kgo.NewClient` 返回 `(*Client, error)`。一个 Client 同时具备生产与消费能力（还有管理能力），是 franz-go 与「生产者/消费者两个独立对象」的 Java 客户端最明显的形态差异：在 Go 里它们只是一个客户端的两个侧面。Seed broker 只需一个可达地址即可，客户端会通过它拿到集群全貌。**② Record 与异步 Produce**——`cl.Produce(ctx, rec, promise)` 把消息交给客户端内部缓冲后**立即返回**，真正发出与等待确认都在后台进行；结果（无论成败）通过 `promise func(*Record, error)` 回调通知。回调拿到的不只是错误：**成功时记录上的 `Partition` 与 `Offset` 已被填上 broker 分配的坐标**（franz-go 文档原话：成功产出的记录在回调前会被设置好属性、偏移量与分区），所以上面才能打印出 `partition=2 offset=1` 这样的行。错误永远走回调返回，不会 panic。",
    },
    {
      type: "paragraph",
      text: "**③ Flush**——`Produce` 是异步的，消息可能还坐在客户端缓冲区里没上路；进程一退出就丢。`Flush(ctx)` 阻塞直到缓冲区清空（必要时立刻触发发送），因此**退出前必须显式 `Flush`**，这是新手最容易踩的坑：写完 Produce 就退出，什么也没发出去。`Close` 的职责是离开消费组、关闭连接，并不代替你 flush 生产缓冲——所以示例里 `Flush` 和 `defer cl.Close()` 缺一不可。另外两个默认值先记住结论：幂等写入默认开启、确认级别默认是 `RequireAllISRAcks`（即 [acks](glossary:acks)=all），所以「默认配置已经挺稳」——它们各自的含义、窗口与取舍，[第 3 章可靠发布](/courses/kafka/lessons/kafka-producer-reliability-acks)整章展开。",
    },
    {
      type: "code",
      title: "运行（真实输出：Kafka 4.3.1 + franz-go v1.21.6）",
      language: "bash",
      code: `$ go run ./producer
已写入 topic=orders.events partition=0 offset=1 key=20260908-000124
已写入 topic=orders.events partition=2 offset=1 key=20260908-000123
已写入 topic=orders.events partition=2 offset=2 key=20260908-000123
flush 完成`,
    },
    {
      type: "paragraph",
      text: "观察三点。第一，**同 key 同分区**：`20260908-000123` 的两条都落在 partition 2，offset 从 1 到 2 连续递增；第二，**分区内有序、跨分区无承诺**：回调打印顺序与发送顺序不同（`000124` 先出现），因为不同分区是并行独立推进的——分区内 123 的两条绝不会乱序，跨分区的 123 与 124 谁先谁后没有意义；第三，**offset 是分区级的全局计数**：如果你上一课用 CLI 发过消息，会看到这里的 offset 接着历史编号继续（partition 2 之前已到 0，现在从 1 起），全新主题则从 0 开始——数字与你的运行历史有关，规律与它们无关。",
    },
    {
      type: "heading",
      text: "同步版本：ProduceSync",
    },
    {
      type: "paragraph",
      text: "回调写法适合生产路径（不阻塞、批量攒着发）；但脚本、测试或「就要等结果」的场景，franz-go 提供同步一行版：",
    },
    {
      type: "code",
      title: "ProduceSync：阻塞到全部结果返回",
      language: "go",
      code: `rec := mk("20260908-000200", "order.created", 9900)

results := cl.ProduceSync(context.Background(), rec) // 变参：一次可传多条
if err := results.FirstErr(); err != nil {           // 第一个出错的结果
	log.Fatalf("同步发送失败: %v", err)
}
fmt.Printf("partition=%d offset=%d\\n",
	results[0].Record.Partition, results[0].Record.Offset)`,
    },
    {
      type: "paragraph",
      text: "`ProduceSync` 与 `Produce` 共享同一条发送路径，区别只是它内部替你等所有 promise 收齐再返回（返回类型 `ProduceResults`，可整体取 `FirstErr()`）。异步回调与同步返回是同一语义的两种姿势，[第 3 章发送路径课](/courses/kafka/lessons/kafka-producer-send-path)会讲透两者背后的缓冲、批处理与错误分类。",
    },
    {
      type: "heading",
      text: "再写消费者",
    },
    {
      type: "paragraph",
      text: "消费者这边第一次出现消费组。[消费组（consumer group）](glossary:consumer-group)是「一组共享订阅的消费者」：组的进度由 broker 的[组协调器](glossary:coordinator)保存，组内多个实例瓜分分区（每个分区同一时刻只归组内一个成员）。本课只用它的默认行为把消息读出来；组怎么协调、位置怎么提交，是[第 4 章](/courses/kafka/lessons/kafka-consumer-poll-commit)的全部内容。存为 `consumer/main.go`：",
    },
    {
      type: "code",
      title: "consumer/main.go（完整可运行，franz-go v1.21.6）",
      language: "go",
      code: `package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

func main() {
	// 1) 同一套 NewClient，加两个消费选项：加入组 + 订阅主题
	cl, err := kgo.NewClient(
		kgo.SeedBrokers("localhost:9092"),
		kgo.ConsumerGroup("orders-events-checker"),
		kgo.ConsumeTopics("orders.events"),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	// 2) Ctrl+C 时取消 ctx，让下面的 poll 循环能干净退出
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	// 3) 拉取循环：Kafka 是"拉"模型——循环 poll，处理拿到的每一批
	for {
		fetches := cl.PollFetches(ctx) // 阻塞直到有数据 / ctx 结束 / 客户端关闭
		if ctx.Err() != nil || fetches.IsClientClosed() {
			break // 收到退出信号或客户端已关闭
		}

		// 先看这一批有没有错误（客户端内部已自动重试可重试错误，
		// 这里出现的通常是需要人介入的）
		fetches.EachError(func(topic string, partition int32, err error) {
			fmt.Printf("拉取出错 topic=%s partition=%d: %v\\n", topic, partition, err)
		})

		// 逐条处理记录
		fetches.EachRecord(func(r *kgo.Record) {
			fmt.Printf("partition=%d offset=%d key=%s value=%s\\n",
				r.Partition, r.Offset, r.Key, r.Value)
		})
	}

	// 4) 退出前做一次同步提交（franz-go 文档建议：不再 poll 就没有下一次
	//    自动提交的机会了，主动提交保证位置不落后）
	fmt.Println("收到退出信号，先做一次同步提交……")
	commitCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := cl.CommitUncommittedOffsets(commitCtx); err != nil {
		log.Printf("最终提交失败: %v\\n", err)
	}
	// 5) defer cl.Close()：离开消费组、关闭连接——组内会因此触发一次再平衡
}`,
    },
    {
      type: "paragraph",
      text: "对照生产者看消费侧的五个新点。**① 组与订阅**：`ConsumerGroup(\"orders-events-checker\")` 声明组名（组名是你自己起的业务标识，后面 CLI 查 lag 就用它），`ConsumeTopics(\"orders.events\")` 声明订阅；**② 信号退出**：`signal.NotifyContext` 让 Ctrl+C 变成 ctx 取消，而不是进程被强杀——优雅退出才能完成第 4 步；**③ 拉取循环**：`PollFetches` 阻塞到「有记录可读或 ctx 结束」才返回一批 `Fetches`。先 `EachError` 检查错误（网络类可重试错误客户端已在内部自动重试，这里冒出的是需要你注意的），再 `EachRecord` 逐条处理。这与你熟悉的 HTTP「请求-响应」直觉不同：没有服务端推送，消费者自己不断来拿——为什么是拉而不是推，[第 4 章拉取模型](/courses/kafka/lessons/kafka-consumer-poll-commit)会讲透；**④ 最终提交**：见下方 callout；**⑤ Close**：`defer cl.Close()` 会离开消费组并关闭连接，组内成员变化会触发[再平衡（rebalance）](glossary:rebalance)——第 4 章的另一个大主题。",
    },
    {
      type: "callout",
      variant: "note",
      title: "默认的自动提交：开启、5 秒、滞后一拍",
      body: "只要在消费组里且没有显式关闭，franz-go 就默认**每 5 秒自动提交一次**已 poll 到的位置（`DisableAutoCommit`/`AutoCommitInterval` 可改）。注意它的两个细节：周期是 5 秒；而且它只提交「上一次 poll 已交出的位置」——这是 franz-go 刻意为之：宁可重启后重复读一小段，也不在应用可能还没处理完时就提交，从而保证至少一次（at-least-once）。所以「自动提交」提交的是**拉取位置**，不是你「处理完成」的位置；处理与提交的错位正是重复消费的来源——提交时机是第 4 章的核心内容，这里先建立印象。退出前调用 `CommitUncommittedOffsets` 做一次显式同步提交（franz-go 文档明确建议：关闭前应做最后一次同步提交），本课的验证步骤就靠它拿到 lag=0。",
    },
    {
      type: "heading",
      text: "运行并验证：两个终端 + CLI 收尾",
    },
    {
      type: "paragraph",
      text: "保持上一课的 broker 在跑，开两个终端：",
    },
    {
      type: "code",
      title: "端到端运行",
      language: "bash",
      code: `# 终端一：发送
$ cd kafka-hello && go run ./producer
已写入 topic=orders.events partition=0 offset=1 key=20260908-000124
已写入 topic=orders.events partition=2 offset=1 key=20260908-000123
已写入 topic=orders.events partition=2 offset=2 key=20260908-000123
flush 完成

# 终端二：消费（orders-events-checker 是全新组，无历史位置）
$ cd kafka-hello && go run ./consumer
partition=2 offset=0 key=20260908-000123 value={"orderId":"20260908-000123","event":"order.created","amount":5900,"at":"2026-09-08T10:00:00Z"}
partition=1 offset=0 key=20260908-000125 value={"orderId":"20260908-000125","event":"order.created","amount":3500,"at":"2026-09-08T10:05:00Z"}
partition=0 offset=1 key=20260908-000124 value={"orderId":"20260908-000124","event":"order.created","amount":12800,"at":"2026-09-08T10:00:01Z"}
partition=2 offset=2 key=20260908-000123 value={"orderId":"20260908-000123","event":"order.paid","amount":5900,"at":"2026-09-08T12:43:39Z"}
…
收到退出信号，先做一次同步提交……
# Ctrl+C 结束（示例输出：本课在 4.3.1 + franz-go v1.21.6 实测，按分区乱序节选）`,
    },
    {
      type: "callout",
      variant: "example",
      title: "怎么读到了上节课的消息？这是特性不是 bug",
      body: "如果输出里混着上一课 CLI 发的消息，别怀疑程序错了：`orders-events-checker` 是个**全新消费组，没有任何已提交位置**，而 franz-go 的默认行为是从分区**最早**的位置开始读（文档：默认从头开始消费；等价 `auto.offset.reset=earliest`）——于是它把主题里现存的历史（包括 CLI 发的）从头重放了一遍。这正是[提交日志（commit log）](glossary:commit-log)模型的能力：新消费者补历史数据不需要任何数据复制，从头读即可。只想读「之后的」新消息，给客户端加 `kgo.ConsumeResetOffset(kgo.NewOffset().AtEnd())`（等价 `latest`）；earliest/latest 语义与使用场景，第 4 章详细对比。",
    },
    {
      type: "paragraph",
      text: "消费完成并退出后，回到终端用上一课的 CLI 验证这个组的进度（Docker 方式记得 `kcli` 前缀）：",
    },
    {
      type: "code",
      title: "验证：组已跟上，lag=0",
      language: "bash",
      code: `$ kcli kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\
    --describe --group orders-events-checker

GROUP                 TOPIC          PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CONSUMER-ID  HOST  CLIENT-ID
orders-events-checker orders.events  0          3               3               0    -            -     -
orders-events-checker orders.events  1          2               2               0    -            -     -
orders-events-checker orders.events  2          5               5               0    -            -     -`,
    },
    {
      type: "paragraph",
      text: "`CURRENT-OFFSET` 等于 `LOG-END-OFFSET`、[滞后（lag）](glossary:lag) 全为 0：这个组已把能读的都读完了，且位置已提交（`CONSUMER-ID` 为 `-` 是消费者已退出的正常显示）。数字因你的运行历史而异——分区 0/1/2 各自独立的 offset 计数本身，就是分区模型的又一次实锤。现在把消费者再跑一次：由于位置已提交，它只打印**新**到达的消息，不再重放历史——位置持久化的效果，与上一课 CLI 的 `--group` 行为完全一致，只是这次提交是 Go 程序做的。",
    },
    {
      type: "heading",
      text: "练习：亲手验证「同 key 进同分区」",
    },
    {
      type: "exercise",
      title: "修改 key，观察分区与 offset",
      description:
        "改 `producer/main.go`：把三条消息的 key 全部设成同一个订单号（例如 `20260908-000999`，Value 的 event 字段依次换成 order.created / order.paid / order.cancelled，模拟一个订单的状态流转）。重跑 `go run ./producer`，观察回调打印：三条是否都落在同一 partition、offset 是否连续递增（例如 partition=2 offset=3/4/5）？再换回原来的不同 key 跑一次，对比分区分布有什么不同。最后用上一课的控制台消费者带 `--formatter-property print.partition=true --formatter-property print.key=true` 从 `--from-beginning` 消费同一主题，核对 `20260908-000999` 的三条是否挤在同一分区的连续 offset 上。",
      hint: "只需改动 main() 里三个 mk(...) 调用的第一个参数（订单号）与第二个参数（事件名）。回调里的 r.Partition / r.Offset 是 broker 分配后的真实坐标，直接打印即可。控制台消费者会连同历史消息一起打印，输出较长时可以用管道过滤订单号（如 `| grep 000999`）只看目标记录。思考题：既然同 key 保证同分区，那么一个订单的全部事件天然有序——这对「按订单聚合统计」意味着什么？",
    },
    {
      type: "heading",
      text: "本课小结",
    },
    {
      type: "keypoints",
      items: [
        "franz-go：纯 Go、功能完整的 Kafka 客户端（官方 README 口径覆盖 Kafka 0.8–4.2+），API 与官方 Java 客户端职责对齐；本课程写作时 v1.21.6",
        "消息在客户端里的形态是 `Record`：`Topic` + `Key`（分区键，[]byte，哈希决定进哪个分区）+ `Value`（[]byte；JSON 序列化是调用方的责任）",
        "生产：`Produce(ctx, rec, cb)` 异步，结果（含错误）经回调返回，成功时回调内 `r.Partition`/`r.Offset` 已填充；`ProduceSync(...).FirstErr()` 是同步简化版；退出前必须先 `Flush`（Close 不代替 flush）",
        "错误都走返回值/回调，不会 panic；可重试错误由客户端内部处理，回调/返回值里出现的是需要人介入的错误",
        "消费：`ConsumerGroup(...)` + `ConsumeTopics(...)`，`PollFetches` 拉取循环 + `EachError`/`EachRecord`；组内自动提交默认开启（5 秒、提交「已 poll 的」位置）→ 至少一次语义，提交时机第 4 章讲透",
        "退出前显式 `CommitUncommittedOffsets` 做最后一次同步提交（franz-go 文档建议）；`Close` 离开消费组并触发[再平衡](glossary:rebalance)",
        "全新消费组没有位置时默认从最早开始读 → 自动重放历史（提交日志可回放）；用 `ConsumeResetOffset(NewOffset().AtEnd())` 改为只看新消息",
        "验证闭环：`kafka-consumer-groups.sh --describe --group <组名>` 的 LAG=0 说明组已跟上；下次运行只读新消息",
      ],
    },
    {
      type: "paragraph",
      text: "到这里，第 1 章收官：你已经在本地跑起了真实的 Kafka 4.3，并用 CLI 与 Go 代码各完成了一次完整的「生产-消费」闭环。接下来第 2 章要回答刚才反复出现却还没展开的问题：key 到底怎么映射到分区、消息在分区里如何存储与保留、副本与 ISR 如何保障不丢——从[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)开始。",
    },
  ],
};
