/* ==================================================================
 * 课时：流：另一种数据结构（rabbitmq-streams）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2），AMQP 0-9-1。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-streams",
  courseSlug: "rabbitmq",
  title: "流：另一种数据结构",
  summary: "不可变追加日志：可重复消费、时间回溯、超大积压——什么时候该用 stream 而不是队列。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "队列的设计目标是「尽快把消息送到消费者手里然后删除」——消息被消费掉就没了。但很多场景需要反过来：同一份数据要被多个服务反复读（订单事件给审计、给分析、给通知）、出了 bug 要能回放过去几小时的事件、积压几百万条消息也不掉性能。RabbitMQ 4.x 为此提供了第二种复制数据结构：流（Stream）。它是不可变的追加日志，与队列共存而非取代。这一节讲清流是什么、怎么用、以及和 quorum 队列怎么选。",
    },
    {
      type: "definition",
      term: "Stream（流）",
      definition: "RabbitMQ 的流是一种持久化、复制的追加日志数据结构：消息只能追加到尾部，按发布顺序获得固定 offset，可被任意数量消费者从任意位置反复读取，直到按保留策略（x-max-age / x-max-length-bytes）被清理。它仍是 AMQP 0-9-1 队列，用 x-queue-type: stream 声明，但没有 TTL、优先级、死信等队列特性。",
    },
    {
      type: "heading",
      text: "与队列的根本区别：非破坏性消费",
    },
    {
      type: "paragraph",
      text: "经典队列与 quorum 队列都是「破坏性消费」：一条消息被某个消费者 ack 后就从队列删除。流则永远不因消费而删除消息——消费者只是移动自己的游标（offset）。这带来三个能力：同一份事件流可以被多个服务独立消费（无需为每个消费者建一个队列副本）；可以从任意 offset / 时间点重新读取（回放 / 时间旅行）；积压再大也不影响吞吐（队列为了逼近空态而优化，流为长尾存储而设计）。",
    },
    {
      type: "table",
      caption: "Stream 与 quorum queue 对比",
      headers: ["维度", "Quorum Queue", "Stream"],
      rows: [
        ["数据模型", "FIFO 队列，消费后删除", "追加日志，消费不删除"],
        ["重复消费 / 回放", "不支持（消费即移除）", "支持：从 first / last / offset / 时间戳任一点开始读"],
        ["消息积压", "5M+ 条积压性能显著下降", "设计目标即超大积压（磁盘分段存储，内存占用极小）"],
        ["顺序保证", "多消费者轮询 + 重投递会乱序；SAC 可保序", "每消费者独立 offset，天然按序读取"],
        ["TTL / 优先级 / DLX", "支持（4.3 起严格优先级等）", "不支持（用保留策略替代 TTL）"],
        ["复制", "Raft 复制，写入需多数派确认并落盘 fsync", "复制 + 多数派确认，但不显式 fsync，极端断电可能丢最近数据"],
      ],
    },
    {
      type: "heading",
      text: "声明与消费：offset 从哪开始",
    },
    {
      type: "code",
      title: "声明流并从指定位置消费（Python / pika）",
      language: "python",
      code: `# 审计服务：把订单事件流持久化归档，可随时回放
import pika

conn = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
ch = conn.channel()

# 声明流：x-queue-type: stream，保留策略按大小 + 时长
ch.queue_declare(
    "orders.events",
    durable=True,
    arguments={
        "x-queue-type": "stream",
        "x-max-length-bytes": 20_000_000_000,  # 20 GB
        "x-max-age": "7D",                     # 最多保留 7 天
    },
)
# 绑定到 topic 交换机，接住订单服务发布的事件
ch.exchange_declare("orders.topic", "topic", durable=True)
ch.queue_bind("orders.events", "orders.topic", routing_key="orders.*")

# 消费必须显式设置 QoS（prefetch）；offset 决定从哪开始读
ch.basic_qos(prefetch_count=100)
ch.basic_consume(
    "orders.events",
    on_message_callback=lambda c, m, p, b: (
        print("event:", p.timestamp, b.decode()),
        c.basic_ack(m.delivery_tag),          # ack 只推进本消费者游标
    ),
    auto_ack=False,
    arguments={
        # 可选值：first（从头）/ last / next（新消息）/ 数字 offset / 时间戳 / 间隔如 "1h"
        "x-stream-offset": "first",
    },
)
print("开始从流头消费订单事件")
ch.start_consuming()`,
    },
    {
      type: "callout",
      variant: "note",
      title: "流的 ack 只是推进游标",
      body: "流上消费必须设置 QoS prefetch（不设会报错），basic.ack 在这里的角色是「信用机制」——每 ack 一条，消费者 offset 前进一条；不 ack 只影响游标位置，消息本身永远留在流里。这与队列「ack 即删除」的语义完全不同。另外，offset 定位中的「时间戳」基于消息到达时间（不是应用自定义时间戳），AMQP 0-9-1 精度为秒；流的「消息数」在管理界面会略偏大（offset 跟踪数据也被计入），属正常现象。",
    },
    {
      type: "heading",
      text: "流的复制与保留",
    },
    {
      type: "paragraph",
      text: "流在声明时默认在每个集群节点放一个副本（x-initial-cluster-size 可调），写入需要多数派副本确认才发发布确认；副本增删由运维显式执行（rabbitmq-streams add_replica / delete_replica）。数据按固定大小分段（segment）落盘，保留策略按段清理：max-age（如 7D）与 max-length-bytes 可组合，策略优先于声明参数。注意两点：流不显式 fsync，服务器被直接断电时单节点可能丢失最近数据（quorum 队列则保证 fsync 后才确认）；AMQP 0-9-1 发布的消息在内部转成 AMQP 1.0 编码存储，含复杂表/数组的 headers 不会被转换。",
    },
    {
      type: "heading",
      text: "什么时候用 stream，什么时候用 quorum",
    },
    {
      type: "list",
      items: [
        "用 stream：事件溯源 / 审计日志（订单事件全量留存、按需回放）、大扇出（同一消息给审计、分析、通知多个消费者，免去每个消费者一个队列）、数据管道、超大积压、日志收集。",
        "用 quorum：任务型消息（扣库存、发通知）——消费即完成、需要 ack 语义与死信、投递上限等队列能力；消息量小到中等、对延迟敏感。",
        "用 classic：临时队列、极高队列声明/删除频率、需要 exclusive 的轻量场景（4.3 起 transient 非 exclusive classic 队列默认被禁止）。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "官方建议：quorum 的死信目标用 stream",
      body: "quorum 队列文档推荐「所有 quorum 队列都配一种死信策略，避免消息被静默丢弃」；而承接死信的低优先级兜底，用一个 stream 是低成本好选择——死信大多是「看一眼、留个痕」的数据，stream 的保留策略正好按时间和大小自动清理，不用维护一堆死信队列。",
    },
    {
      type: "quiz",
      question: "关于 RabbitMQ Stream，以下哪个说法正确？",
      options: [
        "消息被消费者 ack 后即从流中删除",
        "消费必须设置 QoS prefetch，ack 用于推进消费者游标",
        "流支持消息优先级与死信交换机",
        "流是临时数据结构，节点重启后数据丢失",
      ],
      answer: 1,
      explanation: "流是非破坏性消费：ack 只推进游标、不删除消息。流没有优先级、DLX、TTL（用保留策略替代），且始终持久化复制。因此只有第 2 项正确。",
    },
    {
      type: "keypoints",
      items: [
        "流 = 不可变追加日志，消费不删除消息，任意消费者可从任意 offset 反复读。",
        "用 x-queue-type: stream 声明；保留策略 x-max-age / x-max-length-bytes 按段清理，策略优先于声明参数。",
        "消费必须设 QoS；ack 推进游标；offset 支持 first / last / next / 数字 / 时间戳 / 间隔。",
        "适用：事件溯源、审计回放、大扇出、数据管道、超大积压；不适用：任务队列、需要 ack 删除语义的场景。",
        "与 quorum 的关键差异：流不显式 fsync（极端断电可能丢最近数据）、无 TTL/优先级/DLX、副本需显式管理。",
      ],
    },
  ],
};
