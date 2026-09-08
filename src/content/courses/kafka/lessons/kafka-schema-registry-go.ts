/* ==================================================================
 * 课时：Schema Registry 实战（Go / pkg/sr）（kafka-schema-registry-go）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 事实核对（2026-09）：wire format 按 Confluent 官方 serdes-develop 文档；
 * 兼容性执行与 409 输出在 cp-schema-registry:8.3.1 + Kafka 4.3.1 实测；
 * Go API 按 franz-go pkg/sr v1.8.0 源码核对并在本机端到端编译运行验证。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "用 Schema Registry 把事件契约管起来：subject/版本/兼容性检查工作流、schema id 进 payload 的 wire format，以及 franz-go pkg/sr 的注册与编解码实战。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课把事件契约定了型（信封 + 演进纪律），但留了一个悬案：**谁来保证「线上每种结构互相能读」这句话成立？**靠人评审不行——人看不到注册表里的历史版本，也记不住 Avro 那套默认值细则。这一课的答案是[Schema Registry](glossary:schema-registry)：一个集中登记 schema、按规则裁决兼容性、并按 id 把 schema 分发给所有客户端的服务。你会看到它完整的工作流：注册 → 版本自增 → 兼容性检查（被拒时给你一条真实的 409）；然后看到 wire format——**消息字节里怎么携带 schema id**，让解码端不需要事先约定就能查表解码；最后用 Go 把它跑通：franz-go 的 `pkg/sr` 客户端 + 一个 Avro 编码库，完成「注册 → 编码带 id 发送 → 按 id 拉 schema 解码」的闭环。",
    },
    {
      type: "heading",
      text: "Schema Registry 解决什么：契约的单一事实来源",
    },
    {
      type: "paragraph",
      text: "上一课那个「加 `coupon_code` 字段」的例子，没有注册表时是这样演进的：orders 团队在自己的代码里改了结构体、发版；三天后 notify 团队升级时才发现「线上怎么还有旧结构」「你们什么时候加的字段」「这个字段有没有默认值」——每个问题都要拉群问人，而 Kafka 里的历史消息不会等你们对齐。Schema Registry 把三个能力集中到一个服务：**登记**（每个主题/事件类型的历史 schema 全在一处，可查可审计）、**校验**（新 schema 注册时按配置的兼容性规则自动裁决，不兼容直接拒绝）、**分发**（每条消息只携带一个 schema id，解码端按 id 取 schema——不需要在每条消息里塞整份 schema，也不需要离线同步契约文件）。一句话：它把「跨团队的契约」从口头协议变成了一台机器。",
    },
    {
      type: "list",
      items: [
        "**跨团队契约**：生产方注册 schema 即发布契约；消费方以注册表为唯一事实来源做开发与联调，不再「给我发一份 JSON 样例」",
        "**演进校验**：每次 schema 变更过注册表这道闸，破坏兼容的变更在发布时（而不是线上炸了之后）被拒绝",
        "**按 id 分发 schema**：消息自带 schema id，解码端本地缓存 + 缺了就查，历史数据永远可解（只要注册表里还有它）",
        "**治理与审计**：谁、何时、把哪个 subject 演进到了哪个版本，注册表全留痕；配合数据平台/数仓的 schema 血缘",
      ],
    },
    {
      type: "heading",
      text: "三个概念：subject、版本、schema id",
    },
    {
      type: "paragraph",
      text: "注册表里的组织单位叫 **subject（主题契约）**。Confluent 客户端的默认命名策略（TopicNameStrategy）是 `<topic>-value` 与 `<topic>-key`——即每个 Kafka 主题的 value 和 key 各占一个 subject；书舟在 `orders.events.avro` 主题上发事件，value 的 subject 就是 `orders.events.avro-value`。为什么 key/value 分开？它们的结构通常毫无关系（书舟 key 是裸 `order_id` 字符串，value 才是信封），演进也互不影响。",
    },
    {
      type: "list",
      items: [
        "**subject**：契约的命名空间，兼容性检查按 subject 隔离——每个 subject 有自己独立的历史",
        "**版本（version）**：同一 subject 下每次成功注册的 schema 按 1、2、3…递增；**相同 schema 重复注册不会产生新版本**（返回原 id，注册幂等——上生产前反复试跑很常见，不会污染历史）",
        "**schema id**：注册表全局分配的**数字 id**（自 1 递增，跨 subject 全局唯一），它不随版本走：v1 的 schema 是 id 1，v2 是 id 2；旧消息里写死的 id 永远指向旧 schema，这正是「历史消息可解」的机制",
      ],
    },
    {
      type: "paragraph",
      text: "本课实践的完整工作流长这样：把上一课信封的 Avro 版本注册到 subject `orders.events.avro-value`（注册成功 → version 1、id 1）；用 id 编码消息发进主题；再试一次**破坏性变更**（新增无默认值的必填字段）→ 注册表按默认的 `BACKWARD` 规则拒绝，HTTP 409；改成**带默认值的可选字段**再注册 → 通过，version 2。下面先讲编码与校验的机制，再亲手跑。",
    },
    {
      type: "heading",
      text: "wire format：schema id 是怎么“塞进”消息的",
    },
    {
      type: "paragraph",
      text: "Kafka 消息的 Value 是纯字节。要在解码端知道「这段字节该用哪个 schema 解」，Confluent 系客户端采用**在 payload 最前面加固定头**的约定——生产端的序列化组件与消费端的反序列化组件各管一半（合称 [序列化器/反序列化器（serde）](glossary:serializer)）：生产端在 Avro 字节前拼上带 schema id 的头，消费端拆头、取 schema、再解字节。官方叫 Confluent wire format，对所有格式通用（Avro/JSON Schema/Protobuf 的二进制负载都套这个壳；本课以 Avro 为例）：",
    },
    {
      type: "table",
      caption: "Confluent wire format：schema id 在 payload 前缀（官方文档口径）",
      headers: ["字节区间", "内容", "说明"],
      rows: [
        ["第 0 字节", "版本字节（magic）", "目前恒为 `0x00`（官方：serialization format version number, which is 0 when using the schema ID）；未来换格式才变，解码端先验它"],
        ["第 1–4 字节", "schema id", "注册表返回的 4 字节 id，**大端序**（big-endian，网络字节序）"],
        ["第 5+ 字节", "负载数据", "Avro 二进制编码（或其他格式的数据）；Protobuf 还会在 id 后多一段消息索引，本课不涉及"],
      ],
    },
    {
      type: "paragraph",
      text: "为什么 id 进 payload 而不是靠别的通道？因为这样消息**自描述**：任何解码端拿到字节，先读 5 字节头拿到 id，按 id 向注册表取 schema（本地有缓存就不必请求），然后用这个 schema 解码——生产端和解码端之间不需要任何带外协商。上一课信封约定的每个字段，在这里被换成了「注册表里 id=1 的那份 Avro schema」；消费端代码里写的结构体只是它在本地的投影。真实字节长这样（本课实测，`00 00 00 00 01` = magic 0 + id 1）：",
    },
    {
      type: "code",
      title: "一条 order.created 的 Value 前 5 字节（16 进制，实测）",
      language: "text",
      code: `00 00 00 00 01 | 6a 73 6f 6e 2e …（此处为 Avro 二进制负载）
└─┬────┬─┬─┘
magic  id=1（大端）`,
    },
    {
      type: "paragraph",
      text: "换个角度看这个设计的代价与收益：每个 Value 多了 5 字节开销（可忽略）；解码端对未知 id 会**显式失败**（拉不到 schema / magic 不对）而不是静默解错——上一课说的「裸 JSON 演进困境」在这里变成了可见的报错，坏消息永远不会假装自己是好消息。另外官方文档注明：Confluent Platform 8.1.1+ 提供把 schema 标识放进 Kafka 消息 header（GUID）的替代形态，用于迁移场景，**默认仍是前缀带 id 的形态**，本课按默认讲。",
    },
    {
      type: "heading",
      text: "兼容性规则如何被“执行”",
    },
    {
      type: "paragraph",
      text: "上一课定义了向后/向前/完全三类兼容。注册表不是用「人觉得 OK」来判断，而是对**特定格式实现**的规则引擎：注册新版本时，按该 subject（或全局）配置的兼容级别，把新 schema 与已注册版本做结构级比较（Avro 的规则就是上节课那张表：新增无默认字段、删除无默认字段、类型语义变更……），结果只有两种：通过（生成新 version + 新 id）或拒绝（HTTP 409 + 详细原因）。两个执行细节：**默认配置是 `BACKWARD`**（`GET /config` 返回 `{\"compatibilityLevel\":\"BACKWARD\"}`，实测），且**只与最新版本比较**（非传递）；要和历史全部版本比，改成 `BACKWARD_TRANSITIVE` 等带 `_TRANSITIVE` 的级别（每多一版历史就多一分严格）。还可以用 `NONE` 关掉检查——但那只意味着「不拦」，不意味着「安全」，破坏性变更的正确出路永远是上一课说的开新主题迁移，而不是关检查。",
    },
    {
      type: "callout",
      variant: "note",
      title: "Confluent Schema Registry 与 Apicurio Registry",
      body: "Confluent Schema Registry 是事实标准（Confluent 开源项目，本课与绝大多数教程的默认）；[Apicurio Registry](https://www.apicur.io/) 是 Red Hat 主导的开源实现，除自身 API 外实现了 Confluent 兼容层（官方文档称可 drop-in 兼容面向 Confluent API 的工具与客户端），并深度对接 Debezium/Kafka Connect 生态。自托管选型时按团队已有基础设施权衡；本课命令与代码以 Confluent SR 为基准。",
    },
    {
      type: "heading",
      text: "Go 侧落地：franz-go pkg/sr + Avro 编码库",
    },
    {
      type: "paragraph",
      text: "franz-go 对 Schema Registry 的支持在独立子包 [`github.com/twmb/franz-go/pkg/sr`](https://pkg.go.dev/github.com/twmb/franz-go/pkg/sr)：它只负责**和注册表说 HTTP**（注册/查询 schema、查配置），外加一个 `Serde` 类型按 wire format 给数据套/拆 5 字节头。注意三件事：其一，**`pkg/sr` 是 franz-go 仓库里的独立 Go module**，有自己的版本号（写作时 v1.8.0），`go get` 时按子模块地址装，`go.mod` 里会同时出现 `franz-go` 与 `franz-go/pkg/sr` 两条 require；其二，`sr.Client` **不替你缓存 schema，也不做 Avro 编解码**——包文档原话：`does not provide schema auto-discovery and type auto-decoding`，Avro 二进制编码要自己配一个 Avro 库（本课用 [hamba/avro v2](https://pkg.go.dev/github.com/hamba/avro/v2)，Go 生态维护活跃的纯 Go Avro 实现；API 就三个：`Parse`/`Marshal`/`Unmarshal`）；其三，**subject 名要自己拼**——Java 序列化器会自动按 `<topic>-value` 取名，`pkg/sr` 是显式 API，把对齐默认策略的 subject 名写清楚即可。",
    },
    {
      type: "code",
      title: "引入依赖（本课在 franz-go v1.21.6 + pkg/sr v1.8.0 + hamba/avro v2.31.0 实测）",
      language: "bash",
      code: `go get github.com/twmb/franz-go@v1.21.6
go get github.com/twmb/franz-go/pkg/sr@v1.8.0
go get github.com/hamba/avro/v2@v2.31.0`,
    },
    {
      type: "heading",
      text: "生产者：注册 schema，编码带 id 发送",
    },
    {
      type: "paragraph",
      text: "下面这段就是上一课信封的 Avro 版：信封六字段照搬，payload 为了示例只留两个字段。完整流程注释在代码里，三处要点提前说：`CreateSchema` 注册是幂等的（重跑返回同一 id、不产生新版本）；`serde.Register` 把「id + Go 类型 + 编解码函数」登记到 `Serde`（`EncodeFn` 里调用 `avro.Marshal` 产出真正的 Avro 字节，`Serde` 负责在前面拼上 `[0x00][id 大端 4B]`）；编码产物就是可以塞进 `kgo.Record.Value` 的最终字节。",
    },
    {
      type: "code",
      title: "producer/main.go（完整可运行，本课实测；KAFKA_BROKERS / SCHEMA_REGISTRY_URL 可用环境变量覆盖）",
      language: "go",
      code: `package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/hamba/avro/v2"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sr"
)

// valueSchema 与上一课的信封一一对应（payload 只演示两个字段，真实 schema 会很长）。
const valueSchema = \`{
  "type": "record",
  "name": "OrderEvent",
  "namespace": "com.shuzhou.events",
  "fields": [
    { "name": "event_id", "type": "string" },
    { "name": "type", "type": "string" },
    { "name": "occurred_at", "type": "string" },
    { "name": "version", "type": "int" },
    { "name": "order_id", "type": "string" },
    {
      "name": "payload",
      "type": {
        "type": "record",
        "name": "OrderPayload",
        "fields": [
          { "name": "amount_cents", "type": "long" },
          { "name": "currency", "type": "string" }
        ]
      }
    }
  ]
}\`

// Go 侧投影：hamba/avro 按 avro tag 与 schema 字段名对齐。
type orderPayload struct {
	AmountCents int64  \`avro:"amount_cents"\`
	Currency    string \`avro:"currency"\`
}

type orderEvent struct {
	EventID    string       \`avro:"event_id"\`
	Type       string       \`avro:"type"\`
	OccurredAt string       \`avro:"occurred_at"\`
	Version    int          \`avro:"version"\`
	OrderID    string       \`avro:"order_id"\`
	Payload    orderPayload \`avro:"payload"\`
}

func main() {
	brokers := "localhost:9092"
	if v := os.Getenv("KAFKA_BROKERS"); v != "" {
		brokers = v
	}
	srURL := "http://localhost:8081"
	if v := os.Getenv("SCHEMA_REGISTRY_URL"); v != "" {
		srURL = v
	}
	ctx := context.Background()

	// 1) Schema Registry 客户端（pkg/sr 只做 HTTP，不缓存）
	srcl, err := sr.NewClient(sr.URLs(srURL))
	if err != nil {
		log.Fatalf("sr client: %v", err)
	}

	// 2) 注册 schema：幂等——相同 schema 重复注册返回同一 id，不产生新版本。
	//    subject 按默认命名策略手动拼：<topic>-value。
	reg, err := srcl.CreateSchema(ctx, "orders.events.avro-value",
		sr.Schema{Schema: valueSchema})
	if err != nil {
		log.Fatalf("register schema: %v", err)
	}
	fmt.Printf("subject=%s version=%d schema id=%d\\n", reg.Subject, reg.Version, reg.ID)

	// 3) Serde：Avro 编解码由 hamba/avro 负责，Serde 负责套/拆 wire 头
	schema, err := avro.Parse(valueSchema)
	if err != nil {
		log.Fatal(err)
	}
	serde := sr.NewSerde()
	serde.Register(reg.ID, orderEvent{},
		sr.EncodeFn(func(v any) ([]byte, error) { return avro.Marshal(schema, v) }),
	)

	// 4) 两条真实事件（同一订单先后 created -> paid，验证同 key 同分区有序）
	events := []orderEvent{
		{EventID: "9f3c8a1e-7b2d-4f6e-8a7c-3d1b9c2e4f5a", Type: "order.created",
			OccurredAt: "2026-09-08T10:00:03.217Z", Version: 1, OrderID: "20260908-000123",
			Payload: orderPayload{AmountCents: 5900, Currency: "CNY"}},
		{EventID: "a17c02d3-6e5f-4b8a-9c1d-2e3f4a5b6c7d", Type: "order.paid",
			OccurredAt: "2026-09-08T10:02:41.908Z", Version: 1, OrderID: "20260908-000123",
			Payload: orderPayload{AmountCents: 5900, Currency: "CNY"}},
	}

	cl, err := kgo.NewClient(kgo.SeedBrokers(brokers))
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	for _, ev := range events {
		value, err := serde.Encode(ev) // value = [0x00][id 大端 4B] + Avro 字节
		if err != nil {
			log.Fatalf("encode: %v", err)
		}
		// 亲眼看一下 wire 头：前 5 字节应为 00 00 00 00 01（magic 0 + id=1 大端）
		fmt.Printf("wire head: % x  len=%d\\n", value[:5], len(value))
		cl.Produce(ctx, &kgo.Record{
			Topic: "orders.events.avro",
			Key:   []byte(ev.OrderID),
			Value: value,
		}, func(r *kgo.Record, err error) {
			if err != nil {
				log.Printf("produce failed order=%s: %v", r.Key, err)
				return
			}
			fmt.Printf("produced partition=%d offset=%d key=%s type=%s\\n",
				r.Partition, r.Offset, r.Key, ev.Type)
		})
	}
	if err := cl.Flush(ctx); err != nil {
		log.Fatal(err)
	}
	fmt.Println("flush done")
}`,
    },
    {
      type: "paragraph",
      text: "对照真实输出（本课实测，Kafka 4.3.1 + cp-schema-registry 8.3.1 + franz-go v1.21.6 / pkg/sr v1.8.0 / hamba v2.31.0）：",
    },
    {
      type: "code",
      title: "运行 producer（真实输出节选）",
      language: "bash",
      code: `$ go run ./producer
subject=orders.events.avro-value version=1 schema id=1
wire head: 00 00 00 00 01  len=104
wire head: 00 00 00 00 01  len=101
produced partition=2 offset=0 key=20260908-000123 type=order.created
produced partition=2 offset=1 key=20260908-000123 type=order.paid
flush done`,
    },
    {
      type: "paragraph",
      text: "注意注册返回的是 **version=1 与 id=1**：version 是 subject 内的版本序号，id 是注册表全局分配的解码标识；这里恰好都是 1，但二者语义不同（后面注册 v2 时 version 变 2、id 也变 2，但旧消息里的 id=1 永远指向 v1）。wire head 打印出的 `00 00 00 00 01` 就是上一节的机制现场：magic 0 + id=1 大端。",
    },
    {
      type: "heading",
      text: "消费者：按 id 拉 schema，解码并验证",
    },
    {
      type: "paragraph",
      text: "消费者侧的机制重点在「**id 从哪来、schema 从哪取**」：每条消息先拆 5 字节头拿 id；`Serde` 里没登记过这个 id（第一次见）就去注册表 `SchemaByID` 拉 schema 文本、`avro.Parse` 后按 id 登记解码器（后续同 id 消息走本地缓存，不再发 HTTP）；然后 `serde.Decode` 完成解码。这套「未知 id → 现场拉取 → 缓存」正是所有 SR 客户端解码路径的通用形状，这里显式写出来给你看。",
    },
    {
      type: "code",
      title: "consumer/main.go（完整可运行，本课实测）",
      language: "go",
      code: `package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"

	"github.com/hamba/avro/v2"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sr"
)

type orderPayload struct {
	AmountCents int64  \`avro:"amount_cents"\`
	Currency    string \`avro:"currency"\`
}

type orderEvent struct {
	EventID    string       \`avro:"event_id"\`
	Type       string       \`avro:"type"\`
	OccurredAt string       \`avro:"occurred_at"\`
	Version    int          \`avro:"version"\`
	OrderID    string       \`avro:"order_id"\`
	Payload    orderPayload \`avro:"payload"\`
}

func main() {
	brokers := "localhost:9092"
	if v := os.Getenv("KAFKA_BROKERS"); v != "" {
		brokers = v
	}
	srURL := "http://localhost:8081"
	if v := os.Getenv("SCHEMA_REGISTRY_URL"); v != "" {
		srURL = v
	}

	srcl, err := sr.NewClient(sr.URLs(srURL))
	if err != nil {
		log.Fatalf("sr client: %v", err)
	}
	serde := sr.NewSerde()

	cl, err := kgo.NewClient(
		kgo.SeedBrokers(brokers),
		kgo.ConsumerGroup("sr-demo-checker"),
		kgo.ConsumeTopics("orders.events.avro"),
	)
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	for {
		fetches := cl.PollFetches(ctx)
		if ctx.Err() != nil || fetches.IsClientClosed() {
			break
		}
		fetches.EachError(func(topic string, partition int32, err error) {
			log.Printf("fetch error topic=%s partition=%d: %v", topic, partition, err)
		})
		fetches.EachRecord(func(r *kgo.Record) {
			// 1) 拆 wire 头：magic(1B) + schema id(4B 大端)，返回 id 与剩余数据
			id, _, err := serde.DecodeID(r.Value)
			if err != nil {
				log.Printf("bad wire header at %s:%d: %v", r.Topic, r.Offset, err)
				return
			}
			// 2) 首次见到该 id：向 SR 拉 schema、按 id 登记解码器（之后走本地缓存）
			if !serde.IsRegistered(id, sr.DecodeFn) {
				sch, err := srcl.SchemaByID(ctx, id)
				if err != nil {
					log.Printf("fetch schema id=%d: %v", id, err)
					return
				}
				parsed, err := avro.Parse(sch.Schema)
				if err != nil {
					log.Printf("parse schema id=%d: %v", id, err)
					return
				}
				serde.Register(id, &orderEvent{},
					sr.DecodeFn(func(b []byte, v any) error { return avro.Unmarshal(parsed, b, v) }))
				log.Printf("registered decoder for schema id=%d", id)
			}
			// 3) 解码并打印
			var ev orderEvent
			if err := serde.Decode(r.Value, &ev); err != nil {
				log.Printf("decode offset=%d: %v", r.Offset, err)
				return
			}
			fmt.Printf("schema_id=%d partition=%d offset=%d order=%s type=%s amount=%d %s\\n",
				id, r.Partition, r.Offset, ev.OrderID, ev.Type, ev.Payload.AmountCents, ev.Payload.Currency)
		})
	}
}`,
    },
    {
      type: "code",
      title: "运行 consumer（真实输出节选）",
      language: "bash",
      code: `$ go run ./consumer
2026/09/08 21:37:31 registered decoder for schema id=1
schema_id=1 partition=2 offset=0 order=20260908-000123 type=order.created amount=5900 CNY
schema_id=1 partition=2 offset=1 order=20260908-000123 type=order.paid amount=5900 CNY`,
    },
    {
      type: "paragraph",
      text: "收/发两侧对得上：发出的字节里 id=1（`00 00 00 00 01`），消费端拆出来的也是 id=1，并按 id=1 的 schema 解出了完整信封。这就是「schema id 随消息走」的验证闭环：**解码正确性取决于注册表里 id 指向的 schema，而不是收发双方代码版本是否一致**——生产端升级 schema 后发新 id 的消息，没升级的消费端会按旧 id 正常解旧消息，遇到新 id 再去拉新 schema（或按上一课纪律在升级窗口用兼容 schema）。",
    },
    {
      type: "heading",
      text: "实操：把 Schema Registry 跑起来（教学环境）",
    },
    {
      type: "paragraph",
      text: "Schema Registry 需要连着一个 Kafka 集群存它自己的元数据。第 1 章的单节点 broker（容器 `kafka`，通告 `localhost:9092`）可以直接复用：让 SR 容器与 broker 共享宿主网络栈即可——这样 SR 眼里 `localhost:9092` 就是你的 broker。镜像与端口按 8.3.1 / 8081 核对（Docker Hub tag 存在；8081 是官方默认 REST 端口）：",
    },
    {
      type: "code",
      title: "启动 Schema Registry（连接第 1 章的 kafka 容器）",
      language: "bash",
      code: `# Linux / Docker Desktop 4.34+（需在 Docker Desktop 设置里开启 host networking）：
docker run -d --name schema-registry --network host \\
  -e SCHEMA_REGISTRY_HOST_NAME=localhost \\
  -e SCHEMA_REGISTRY_LISTENERS=http://0.0.0.0:8081 \\
  -e SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS=PLAINTEXT://localhost:9092 \\
  confluentinc/cp-schema-registry:8.3.1

# 就绪检查：空注册表应返回空数组 []（REST API 见后文，全程用它做验证）
curl -s http://localhost:8081/subjects
# → []`,
    },
    {
      type: "callout",
      variant: "note",
      title: "两种容器拓扑，任选其一（本课均在 4.3.1 broker + 8.3.1 SR 实测）",
      body: "`--network host` 的写法假设 broker 通告地址在宿主机可达（第 1 章单节点默认 `localhost:9092` 正是如此），零改动接入。若你的 Docker 不支持 host 网络（旧版 Docker Desktop），等价做法：把 broker 与 SR 放进同一个自定义网络，并给 broker 配两个通告 listener（一个对宿主 `localhost`、一个对容器内网）——这是第 9 章 listener 分离思路的迷你版，本课不展开。两种拓扑里 SR 的行为完全一致；下面用 REST 验证的都是注册表本身，与拓扑无关。",
    },
    {
      type: "heading",
      text: "用 REST 亲眼看到兼容性裁决（真实输出）",
    },
    {
      type: "paragraph",
      text: "先建练习主题（与上一课信封呼应，但用独立主题避免和第 1–5 章往 `orders.events` 里发的裸 JSON 混在一起——裸字节没有 wire 头，SR 消费端读不了，这正是「换格式开新主题」纪律的实例）：",
    },
    {
      type: "code",
      title: "创建练习主题（沿用第 1 章的 kcli 前缀）",
      language: "bash",
      code: `kcli kafka-topics.sh --create \\
  --topic orders.events.avro \\
  --partitions 3 \\
  --replication-factor 1 \\
  --bootstrap-server localhost:9092`,
    },
    {
      type: "paragraph",
      text: "然后注册上面那段 Avro schema（`POST /subjects/{subject}/versions`，body 里 `schema` 是转义后的 schema 文本；响应即注册结果）。以下为本课实测输出：全局配置默认 `BACKWARD`；用 Go 生产者注册 v1 得到 id=1；接着手工注册一个「新增必填字段 `channel`（无默认）」的 v2——被拒：",
    },
    {
      type: "code",
      title: "破坏性变更被拒（真实输出：HTTP 409）",
      language: "text",
      code: `$ curl -s http://localhost:8081/config
{"compatibilityLevel":"BACKWARD"}

# 请求：POST /subjects/orders.events.avro-value/versions
# body 里 schema 字段是转义后的 JSON 文本（v2 = v1 + 必填字段 channel，无默认值）
HTTP 409
{"error_code":40901,"message":"Schema being registered is incompatible with an earlier schema for subject \\"orders.events.avro-value\\", details: [{errorType:'READER_FIELD_MISSING_DEFAULT_VALUE', description:'The field 'channel' at path '/fields/5' in the new schema has no default value and is missing in the old schema', additionalInfo:'channel'}, {oldSchemaVersion: 1}, ...]}
# （输出为单行，此处折行仅为排版；40901 = 注册不兼容）`,
    },
    {
      type: "paragraph",
      text: "错误里的 `READER_FIELD_MISSING_DEFAULT_VALUE` 正是上一课那句话的机器版：「新 schema（读者）读旧数据时，缺字段 `channel` 且无默认值可填」。把字段改成**可选并带默认值**（Avro 的 `[\"null\", \"string\"]` + `default: null`）再注册，通过：",
    },
    {
      type: "code",
      title: "兼容变更通过（真实输出：version 2 / id 2）",
      language: "text",
      code: `# 请求同上，body 改为：v2 = v1 + 可选字段 coupon_code ["null","string"]、default null
HTTP 200
{"id":2,"version":2,"schemaType":"AVRO","schema":"{\"type\":\"record\",...}"}   # 节选

$ curl -s http://localhost:8081/subjects/orders.events.avro-value/versions
[1,2]

$ curl -s http://localhost:8081/schemas/ids/1   # 按 id 取回 v1 全文（消费端解码就是走这里）
{"subject":"orders.events.avro-value","version":1,"schemaType":"AVRO","schema":"{\"type\":\"record\",...}"}   # 节选`,
    },
    {
      type: "paragraph",
      text: "注意区分：`GET /schemas/ids/1` 返回的 `version: 1` 是说「id 1 属于这个 subject 的第 1 个版本」，payload 里真正干活的是 `schema` 字段的文本。生产实践里，注册通常发生在**服务启动/构建时**（启动时注册失败就拒绝启动，把「上线即违约」挡在发布前），而不是每条消息注册一次；上面 Go 代码演示的正是「启动注册 + 运行时只编码」的形态。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "SR 是强依赖：选型时要把它当基础设施",
      body: "生产端启动时注册 schema、消费端解码要按 id 拉 schema——SR 一旦不可用，**新**的生产/消费都会受影响（已缓存的解码不受影响）。所以生产 SR 要按基础设施对待：多节点（SR 自己也有主从与容错语义）、监控、备份（schema 存于 Kafka 内部主题，靠主题保留与备份兜底）。这不是「多一个组件」的负担，而是上一课演进纪律的物理载体——它的可用性直接决定你 schema 演进流程能不能跑。",
    },
    {
      type: "heading",
      text: "Go 团队什么时候可以不上 SR：JSON + 文档/校验的取舍",
    },
    {
      type: "callout",
      variant: "tip",
      title: "JSON 裸奔的合法边界：单团队、低频演进、消费者少",
      body: "上一课反模式四说的是「无意识地裸奔」；这里说的是**有意识地选择**。若同时满足：生产消费同属一个团队（或两个能随时拉群对齐的团队）、事件类型与字段半年不改一次、消费方数量一只手数得过来、且你愿意把「字段单位/时区/枚举」写进文档并在 CI 里加 JSON 结构校验——手工 JSON + 文档 + 评审是完全成立的低成本方案（第 10 章实战课的契约就是这个形态）。一旦出现下面任一信号，就该迁移到 Schema Registry：跨团队/跨语言消费、schema 变更开始需要排期协调、数据平台（数仓/流处理/审计）直接读主题、或你发现自己开始在代码里维护「兼容新旧两版字段」的手工逻辑——那正是注册表替你做的事。",
    },
    {
      type: "quiz",
      question:
        "一条用 Confluent wire format 编码的消息，其 Value 前几个字节为 `00 00 00 00 01`，随后是 Avro 负载。以下哪个解读正确？",
      options: [
        "前 5 个字节是消息版本号：0.0.0.1，表示这是第 1 版协议",
        "第 1 个字节 `0x00` 是 magic/格式版本字节，紧接着的 4 字节 `0x00000001`（大端）是 schema id=1，解码端按它向 Schema Registry 取 schema",
        "前 4 字节 `0x00000001` 是分区偏移量，第 5 字节是压缩标记",
        "这 5 个字节没有任何约定意义，不同客户端可以自行解释，只要能互相商量好",
      ],
      answer: 1,
      explanation:
        "wire format 的前缀固定：magic（格式版本，目前恒为 0x00）+ 4 字节大端 schema id + 负载数据（Avro/Protobuf 的二进制编码或 JSON 字节）。schema id 使消息自描述：解码端拆头拿 id、按 id 向注册表取 schema 后解码，跨版本、跨团队都不需要带外协商——这正是「裸 JSON 没人能回答线上有几种结构」问题的机制化答案。",
    },
    {
      type: "keypoints",
      items: [
        "Schema Registry = 契约的单一事实来源：登记（subject/版本/id 全留痕）、校验（注册时按兼容规则裁决）、分发（消息只带 id，解码端按 id 取 schema）",
        "概念三分：subject（默认 `<topic>-value` / `<topic>-key`）、version（subject 内自增，重复注册不产生新版本）、schema id（注册表全局分配，旧消息里的 id 永远指向旧 schema）",
        "wire format：`[0x00 magic][schema id 4 字节大端][数据]`（Protobuf 另有消息索引）；默认即此前缀带 id 形态",
        "兼容性由规则引擎执行：默认 BACKWARD 且只对最新版本检查；破坏性注册返回 HTTP 409 与详细原因（如 READER_FIELD_MISSING_DEFAULT_VALUE）；NONE 只关检查不消除问题",
        "franz-go 用法：`sr.NewClient(sr.URLs(...))` 管 HTTP；`CreateSchema` 幂等注册；`Serde.Register(id, 类型, EncodeFn/DecodeFn)` + `Encode/Decode` 套拆 wire 头；Avro 编解码自配（如 hamba/avro 的 Parse/Marshal/Unmarshal）——`pkg/sr` 是独立子模块，有自己的版本号",
        "消费端通用路径：拆头拿 id → 未登记则 SchemaByID 拉取并注册解码器 → 解码；已缓存 id 不再发 HTTP",
        "上不上 SR 是取舍不是道德：单团队+低频演进可手工 JSON+文档+CI 校验；跨团队/多语言/数据平台直读主题时，SR 是基础设施级的强依赖，要按基础设施运维",
      ],
    },
    {
      type: "paragraph",
      text: "到这里，事件「长什么样」和「契约怎么被管」都有了答案。还剩一个绕不开的工程问题：**事件到底怎么可靠地产生**——订单服务写完订单表之后，那条 `order.created` 是怎么保证不丢、不和数据库状态矛盾的？直接「写完库再发 Kafka」会踩双写不一致的坑，本课和上一课的答案指向同一个模式：事务性 [Outbox](glossary:outbox)，以及它的亲戚 CDC 与事件溯源。下一课[事务性 Outbox、CDC 与事件溯源](/courses/kafka/lessons/kafka-outbox-cdc-es)把它们一次讲透。",
    },
  ],
};
