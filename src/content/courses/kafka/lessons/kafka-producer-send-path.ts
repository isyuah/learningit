/* ==================================================================
 * 课时：生产者发送路径与 Record（kafka-producer-send-path）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Kafka 4.x；Go 客户端 franz-go v1.21.x（pkg/kgo）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "从调用 Produce 到回调返回之间发生了什么：客户端后台机制、Record 字段语义、异步回调与错误处理纪律。",
  blocks: [
    {
      type: "paragraph",
      text: "「书舟书店」的 orders 服务已经能在下单事务提交后把 `order.created` 事件发进 `orders.events` 主题——[kafka-go-client-hello](/courses/kafka/lessons/kafka-go-client-hello) 里你写过最小可运行版本。但「把一条消息发出去」这句话里藏着一台机器：调用 `Produce` 之后消息并不会瞬间出现在 broker 上，它要先在你的进程里排队、组批、被后台线程按分区路由、发到正确的 broker，再等 broker 确认。这节课把这条路径拆开：客户端在后台替你做了什么、`Record` 的每个字段到底意味着什么、以及为什么「回调里检查错误」是生产代码的生死线。",
    },
    {
      type: "heading",
      text: "一个 Client 就是一条生产流水线",
    },
    {
      type: "paragraph",
      text: "`kgo.NewClient(...)` 返回的不是一个「连接」，而是一个管理整条发送流水线的对象。连接是懒建立的：真正写第一条请求时才拨号；同时客户端会在后台常驻若干工作：周期刷新主题元数据（首次发送到新主题、或收到 leader 相关错误时也会立刻触发刷新）、为每个连上的 [broker](glossary:broker) 维护连接与发送队列、把每个 [分区](glossary:partition) 的缓冲记录按批组装成 Produce 请求、并统一处理重试与回调分发。这些全部在库内部完成，应用代码只做两件事：构造 `Record`、调用发送并处理结果。",
    },
    {
      type: "paragraph",
      text: "关键心智：`SeedBrokers` 只是「入口地址」，不是消息的终点。客户端先用种子地址发起元数据请求，拿到每个 topic-partition 的 leader 在哪个 broker 之后，Produce 请求就直接发给对应的 leader broker——这与第 2 章「副本与 ISR」那节课的分区模型严丝合缝：[kafka-replication-isr](/courses/kafka/lessons/kafka-replication-isr)。你给了一串 broker 地址，客户端会自己发现集群全貌，并在 leader 变更后自动改道。",
    },
    {
      type: "code",
      title: "Produce 之后发生了什么（概念图，text）",
      language: "text",
      code: `应用 goroutine: cl.Produce(ctx, rec, cb) ──立即返回──► cb(rec, err) 之后由后台回调
                                    │
                                    ▼
                  ① 序列化由你做：Value/Key 已经是 []byte（见下节）
                                    │
                                    ▼
                  ② 客户端内部：按 key 计算分区（第 2 章的分区器）
                     并追加到「该 topic-partition 的缓冲批 recBuf」
                                    │
                                    ▼
                  ③ 组批条件满足（linger 到点 / 批满 / 冲刷，见「批量、压缩与吞吐调优」）:
                     后台 drain 线程把该分区可发批次打包进 Produce 请求
                                    │
                                    ▼
                  ④ 元数据决定收件人：把请求发给该分区的 leader broker
                     （连接懒建立；broker 挂了/leader 换了 → 触发元数据刷新）
                                    │
                                    ▼
                  ⑤ broker 按 acks 语义落盘并确认（默认 acks=all，见「可靠发布」）
                     → 响应回填 rec.Offset / rec.Partition
                                    │
                                    ▼
                  ⑥ 后台按序调用你的回调 cb(rec, err)；err != nil 即最终失败`,
    },
    {
      type: "definition",
      term: "生产者客户端（producer client）",
      definition: "负责把应用产生的 Record 高效、可靠地写入 Kafka 的库组件。它内部维护元数据缓存、按 broker 的连接池、按 topic-partition 的记录缓冲与组批、重试与幂等状态机；对外暴露的 API 只要求你提供「记录」并处理「结果」。进程内应共享一个 Client，而不是每条消息新建一个（每个 Client 都有一整套后台 goroutine 与独立连接，新建客户端是昂贵的）。",
    },
    {
      type: "heading",
      text: "Record：你写进去的每个字段意味着什么",
    },
    {
      type: "paragraph",
      text: "Kafka 的传输单位是字节。`kgo.Record` 里 `Key` 与 `Value` 都是 `[]byte`——**序列化是应用的责任**：先把自己的结构体变成字节，再交给客户端。书舟的惯例是先 `json.Marshal` 出事件体，塞进 `Value`；`Key` 放分区键（订单事件就是 `order_id` 字符串），让同一订单的全部事件落进同一 [分区](glossary:partition)，保序语义见 [kafka-topics-partitions-keys](/courses/kafka/lessons/kafka-topics-partitions-keys)。",
    },
    {
      type: "code",
      title: "事件体与最终写入的字节（示意 payload）",
      language: "json",
      code: `{
  "type": "order.created",
  "order_id": "20260908-000123",
  "amount_cents": 12800,
  "occurred_at": "2026-09-08T10:11:12+08:00"
}

// Value = 上面的 UTF-8 字节；Key = []byte("20260908-000123")
// 谁消费、怎么解，双方靠同一个 JSON 契约（第 6 章 Schema Registry 会把它管起来）`,
    },
    {
      type: "table",
      caption: "kgo.Record 主要字段在生产路径上的语义（franz-go v1.21）",
      headers: ["字段", "类型", "生产时的语义"],
      rows: [
        ["Topic", "string", "必填目标主题；为空会用 DefaultProduceTopic，仍为空则记录立即失败"],
        ["Key", "[]byte", "分区键：参与分区器哈希，同 key 恒进同分区；可为 nil（走粘性/轮询分发）"],
        ["Value", "[]byte", "消息体；Kafka 完全不解析，字节是什么就存什么"],
        ["Headers", "[]RecordHeader", "key/value 附加信息，broker 只透传落盘不解释；适合放自描述信息（如事件 schema 版本、trace id），不适合放需要查询的数据"],
        ["Timestamp", "time.Time", "记录时间戳；批次恒以 CreateTime 语义写入，未设置时客户端填 time.Now——事件真实发生时间请放进消息体（occurred_at），别依赖这里的时钟"],
        ["Partition", "int32", "通常留 0 由分区器决定，成功后回填真实分区；配 ManualPartitioner 时你预先指定，写错分区号会立即失败"],
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "一个容易踩的建模坑",
      body: "「订单创建于几点几分」这类业务事实要放在消息体里（书舟统一叫 `occurred_at`），而 Record.Timestamp 是 Kafka 记录被生产/存储的时间。两者用途不同：前者是领域事实（重放、审计要它），后者是存储元数据（retention、时间戳索引要它）。把业务时间当 Kafka 时间用，等于把自己的时钟强加给平台。",
    },
    {
      type: "heading",
      text: "异步回调模型：Produce 与 ProduceSync",
    },
    {
      type: "paragraph",
      text: "franz-go 的核心 API 是异步的：`cl.Produce(ctx, rec, cb)` 把记录交给客户端后**立即返回**，真正的发送与确认都在后台进行，结果通过回调 `cb(*Record, error)` 送回。错误是回调的一个参数，不是 panic、也不是返回值——客户端永远不因单条消息的失败而炸掉你的进程。同分区内的记录在成功路径上按 Produce 的调用顺序落盘；成功时回调收到的 Record 已被回填 `Offset`（在分区内的[偏移量](glossary:offset)）与 `Partition`，可以用于审计「这条消息确实进了哪个分区哪一位」。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "回调串行执行，必须快、绝不能阻塞",
      body: "franz-go 的所有回调是串行分发的，且「回调里不允许再调用会阻塞的 Produce/Flush」——你在回调里等待缓冲空间，而释放缓冲空间正需要回调返回，会死锁整个客户端。回调里只做轻量工作（计数、写日志、更新内存状态）；需要重发或做重活就另起 goroutine。",
    },
    {
      type: "paragraph",
      text: "需要同步语义时用 `ProduceSync(ctx, recs...)`：它把记录全部入队后**等所有结果返回**，并返回 `ProduceResults`（`FirstErr()` 取第一个错误、`First()` 取单条结果的记录与错误）。注意两个细节：其一，`ProduceSync` 会立刻触发一次冲刷，不等 linger 组批窗口（批量细节下一课讲）；其二，它没有自己的超时——如果一条记录被可重试错误反复卡住，`ProduceSync` 会一直等，真正的交付时限要靠[可靠发布课](/courses/kafka/lessons/kafka-producer-reliability-acks)的 ctx 与 `RecordDeliveryTimeout` 组合给出。",
    },
    {
      type: "code",
      title: "可运行：orders 服务同步发布 order.created（文件 producer_sync.go）",
      language: "go",
      code: `package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
)

// OrderCreated 是写入 orders.events 的消息体（事件结构规范见第 6 章）。
type OrderCreated struct {
	Type        string \`json:"type"\`         // 事件类型，本例固定 order.created
	OrderID     string \`json:"order_id"\`     // 业务订单号，兼作分区键
	AmountCents int64  \`json:"amount_cents"\` // 金额，单位分
	OccurredAt  string \`json:"occurred_at"\`  // 业务侧事件发生时间
}

func main() {
	brokers := "127.0.0.1:9092" // 第 1 章搭的本地 broker
	if v := os.Getenv("KAFKA_BROKERS"); v != "" {
		brokers = v
	}
	cl, err := kgo.NewClient(kgo.SeedBrokers(brokers))
	if err != nil {
		log.Fatalf("创建客户端失败: %v", err)
	}
	defer cl.Close() // 本示例是同步发送，退出时无缓冲残留；异步场景见下例的 Flush 顺序

	ev := OrderCreated{
		Type:        "order.created",
		OrderID:     "20260908-000123",
		AmountCents: 12800,
		OccurredAt:  "2026-09-08T10:11:12+08:00",
	}
	value, err := json.Marshal(ev)
	if err != nil {
		// 序列化失败是程序 bug，不是 Kafka 的问题
		log.Fatalf("序列化事件失败: %v", err)
	}

	rec := &kgo.Record{
		Topic: "orders.events",
		Key:   []byte(ev.OrderID), // 同 key 同分区，同一订单的事件保序
		Value: value,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	produced, err := cl.ProduceSync(ctx, rec).First()
	if err != nil {
		// 到这里 = 客户端重试后仍失败或错误不可重试。绝不能当“已发送”：
		// 应记录待发状态并告警（补偿/重试链路的工程做法在第 5、6 章）。
		log.Fatalf("order.created 发布失败: %v", err)
	}
	log.Printf("已确认写入 %s partition=%d offset=%d",
		produced.Topic, produced.Partition, produced.Offset)
}`,
    },
    {
      type: "heading",
      text: "错误分类：可重试与不可重试",
    },
    {
      type: "paragraph",
      text: "Kafka 协议错误统一由 `github.com/twmb/franz-go/pkg/kerr` 包表达：`*kerr.Error` 带 `Code`、`Message` 与 **`Retriable`** 标志，`kerr.IsRetriable(err)` 可直接判断。可重试错误（网络瞬断、broker 选举中、ISR 不足等）**由客户端在内部自动退避重试**，你通常看不见它们——直到重试窗口结束（到达重试上限，或被交付时限/ctx 取消终止），最终失败才会到达你的回调；不可重试错误（消息过大、权限拒绝等）重试也没有意义，客户端直接回调错误。具体哪些错误可重试、重试上限与退避怎么配，是[可靠发布：acks、重试与幂等生产者](/courses/kafka/lessons/kafka-producer-reliability-acks)的主题。这节课先把纪律立住。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "回调里不检查 err，就是静默丢消息",
      body: "最经典的线上事故不是「Kafka 挂了」，而是「Kafka 拒绝了但没人看」。`Produce` 的回调签名把错误放在你面前，不检查它，代码依然编译通过、服务依然正常运行——只是订单事件永远没进主题，而对账系统某天发现少了一单。生产代码的最低要求：回调里 err != nil 时必须留下可检索的痕迹（结构化日志 + 计数指标 + 告警），并把该事件交给补偿路径。记住这句话：**发送成功要证明，发送失败要可见**。",
    },
    {
      type: "code",
      title: "可运行：异步批量发布 + 回调错误分类（文件 producer_async.go）",
      language: "go",
      code: `package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"sync/atomic"
	"time"

	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kgo"
)

type OrderCreated struct {
	Type        string \`json:"type"\`
	OrderID     string \`json:"order_id"\`
	AmountCents int64  \`json:"amount_cents"\`
	OccurredAt  string \`json:"occurred_at"\`
}

var (
	okCount   atomic.Int64 // 指标：成功
	failCount atomic.Int64 // 指标：最终失败
)

func publishOrder(ctx context.Context, cl *kgo.Client, ev OrderCreated) {
	value, err := json.Marshal(ev)
	if err != nil {
		log.Printf("序列化失败 order_id=%s: %v", ev.OrderID, err)
		return
	}
	rec := &kgo.Record{
		Topic: "orders.events",
		Key:   []byte(ev.OrderID),
		Value: value,
		Headers: []kgo.RecordHeader{
			{Key: "event_version", Value: []byte("order.created.v1")}, // 自描述信息，broker 只透传
		},
	}
	// 异步：立即返回，结果走回调；回调串行执行，只做轻量工作
	cl.Produce(ctx, rec, func(r *kgo.Record, err error) {
		if err == nil {
			okCount.Add(1)
			return // r.Partition / r.Offset 已回填
		}
		failCount.Add(1)
		classify(r, err)
	})
}

func classify(r *kgo.Record, err error) {
	switch {
	case errors.Is(err, kerr.MessageTooLarge):
		log.Printf("消息过大 key=%s: 检查单条大小与主题 max.message.bytes", r.Key)
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		log.Printf("发布被 ctx 取消 key=%s（重试期超时放弃）", r.Key)
	default:
		// 可重试错误重试耗尽、或其它最终错误，都落到这里
		log.Printf("发布最终失败 topic=%s key=%s: %v", r.Topic, r.Key, err)
	}
	// 共同动作：写审计日志 + 累计告警指标；不可丢的事件进入本地待发表，由补偿任务重发
}

func main() {
	brokers := "127.0.0.1:9092"
	if v := os.Getenv("KAFKA_BROKERS"); v != "" {
		brokers = v
	}
	cl, err := kgo.NewClient(kgo.SeedBrokers(brokers))
	if err != nil {
		log.Fatalf("创建客户端失败: %v", err)
	}

	events := []OrderCreated{
		{Type: "order.created", OrderID: "20260908-000123", AmountCents: 12800, OccurredAt: "2026-09-08T10:11:12+08:00"},
		{Type: "order.created", OrderID: "20260908-000124", AmountCents: 5600, OccurredAt: "2026-09-08T10:11:13+08:00"},
	}
	ctx := context.Background()
	for _, ev := range events {
		publishOrder(ctx, cl, ev) // 高并发路径：各处 goroutine 并发调 publishOrder 即可
	}

	// 优雅退出：先 Flush（停止组批等待，把缓冲全部发完；可设时限），再 Close。
	// 注意 Close 不会替你等缓冲——它会直接以 ErrClientClosed 失败所有未发出的记录。
	flushCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := cl.Flush(flushCtx); err != nil {
		log.Printf("Flush 超时/被取消，剩余缓冲 %d 条未确认", cl.BufferedProduceRecords())
	}
	cl.Close()
	log.Printf("发布完成: ok=%d fail=%d", okCount.Load(), failCount.Load())
}`,
    },
    {
      type: "heading",
      text: "ctx、Flush 与 Close：三种「等待」各等什么",
    },
    {
      type: "list",
      items: [
        "`Produce(ctx, ...)` 的 ctx：管的是「入队这段路」——缓冲满时用它取消排队等待；记录仍在缓冲中未发出时，取消 ctx 会让该记录以 ctx 的错误失败（一批只看首条记录的 ctx）。**一旦请求已发出且幂等开启，取消不再生效**：客户端无法判断 broker 是否已写入，会等结果以保住去重与顺序（[可靠发布课](/courses/kafka/lessons/kafka-producer-reliability-acks)展开）。",
        "`Flush(ctx)`：阻塞直到客户端缓冲清零（全部发出并拿到结果），期间停止一切 linger 等待；ctx 到点则返回 ctx 错误。它是「我准备下班了，把手头的活干完」的等待。",
        "`Close()`：离开消费组、关闭全部连接与后台 goroutine。**它不等缓冲**——实现上先取消内部 ctx 再以 `ErrClientClosed` 失败所有仍缓冲的记录。所以生产退出顺序是「先 Flush（或确认所有回调已返回），再 Close」；顺序反了等于主动丢消息。",
      ],
    },
    {
      type: "paragraph",
      text: "把三件事分清后，一条生产级发送路径就完整了：进程启动时 `NewClient` 一次并全局共享 → 各请求处理器按需 `Produce`（异步）或 `ProduceSync`（低频/关键路径）→ 回调里检查错误并留下痕迹 → 收到停机信号时先 `Flush` 再 `Close`。批量、压缩与吞吐调优，是下一课 [kafka-producer-batching-throughput](/courses/kafka/lessons/kafka-producer-batching-throughput) 的内容——发送路径的每个环节最终都要为吞吐服务。",
    },
    {
      type: "keypoints",
      items: [
        "一个进程共享一个 kgo.Client：它后台负责元数据刷新、按 broker 的连接与发送队列、组批与重试；SeedBrokers 只是入口，leader 是谁由元数据决定",
        "序列化是应用职责：Record 的 Key/Value 是 []byte；业务时间放消息体（occurred_at），Record.Timestamp 是存储元数据",
        "Produce 是异步回调模型，错误是回调参数不是 panic；回调串行执行，必须轻量、不得阻塞",
        "ProduceSync 等全部结果并立即冲刷，适合低频关键路径；它自带无限等待，交付时限要靠[可靠发布课](/courses/kafka/lessons/kafka-producer-reliability-acks)的配置组合",
        "可重试错误由客户端内部重试，回调里见到的 err 是最终失败或不可重试错误——不检查 err 就是静默丢消息",
        "退出顺序：先 Flush 再 Close；Close 会把未发出缓冲以 ErrClientClosed 全部失败",
      ],
    },
  ],
};
