/* ==================================================================
 * 课时：消费确认、prefetch 与重投递（rabbitmq-consumer-acks）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-consumer-acks",
  courseSlug: "rabbitmq",
  title: "消费确认、prefetch 与重投递",
  summary: "Broker 怎么知道消息被消费成功了？auto ack、手动 ack、requeue 与 prefetch 的完整语义。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一节的发布确认回答了「消息有没有到达 Broker」。但消息到达队列之后，真正的业务处理发生在消费者进程里——而消费侧同样会失败：库存服务可能在扣减途中崩溃。Broker 怎么知道这条消息算不算处理成功？这就是消费确认（Consumer Acknowledgements）要解决的。",
    },
    {
      type: "heading",
      text: "确认模式：auto ack 与手动 ack",
    },
    {
      type: "paragraph",
      text: "消费者在 `basic.consume` 时选择确认模式。auto ack（自动确认）模式下，消息一从 socket 写出去就被 Broker 视为「已处理」直接出队删除——消费者在真正处理前崩溃，消息就永久丢失，官方文档称其为 fire-and-forget 并明确标注不安全。手动确认模式下，消息保持「未确认（unacknowledged）」状态，直到消费者显式调用 `basic.ack` 才算成功。确认消息靠 `delivery tag` 指认：Broker 每次投递分配的正整数，在单通道内单调递增，且必须在收到消息的同一通道上确认——跨通道确认会触发 unknown delivery tag 协议异常并关闭通道。",
    },
    {
      type: "list",
      items: [
        "`basic.ack(deliveryTag, multiple)`: 正向确认，消息被删除；`multiple=true` 时确认该通道上所有序号 ≤ deliveryTag 的未确认消息（批量 ack 减少网络往返）。",
        "`basic.reject(deliveryTag, requeue)`: 负向确认单条消息；`requeue=true` 重新入队，`requeue=false` 则丢弃或按死信配置路由。reject 不支持 multiple。",
        "`basic.nack(deliveryTag, multiple, requeue)`: RabbitMQ 对 AMQP 0-9-1 的扩展，与 reject 语义相同，但多了 `multiple` 参数，可一次拒绝多条。",
        "一个易混淆点：正负确认对 Broker 的效果都是「删除消息」——`basic.ack` 表示成功可删，`basic.reject(requeue=false)` 表示失败但同意丢弃或转死信；真正把消息放回队列的是 `requeue=true`。",
      ],
    },
    {
      type: "code",
      title: "手动确认 + 失败重投递（Python / pika）",
      language: "python",
      code: "import pika\n\nconnection = pika.BlockingConnection(pika.ConnectionParameters(\"localhost\"))\nchannel = connection.channel()\nchannel.basic_qos(prefetch_count=10)  # 每通道最多 10 条未确认消息\n\n\ndef on_message(ch, method, properties, body):\n    try:\n        process_order(body)      # 真正的业务处理\n        ch.basic_ack(method.delivery_tag)   # 成功 → 确认，Broker 删除\n    except TemporaryError:\n        # 瞬时故障（如下游数据库抖动）：放回队列让其它消费者重试\n        ch.basic_nack(method.delivery_tag, multiple=False, requeue=True)\n    except PermanentError:\n        # 无法修复的错误：丢弃/转死信，绝不 requeue 死循环\n        ch.basic_nack(method.delivery_tag, multiple=False, requeue=False)\n\n\nchannel.basic_consume(\"orders.queue\", on_message_callback=on_message,\n                      auto_ack=False)  # 手动确认\nchannel.start_consuming()\n",
    },
    {
      type: "callout",
      variant: "warning",
      title: "requeue 的语义与重投循环",
      body: "`requeue=true` 时消息会尽量回到原位置，若因并发投递与其它消费者的确认无法做到，则放到靠近队头的位置；被 requeue 的消息可能被立即重新投递，如果消费者因某个瞬时条件集体 requeue，就会形成 requeue/redelivery 循环，白白消耗带宽与 CPU——消费端应统计重投递次数，超过阈值就拒绝入队（丢弃或死信），或延迟后再 requeue。另外，手动确认模式下只要消费者所在的通道或连接关闭（TCP 断开、进程崩溃、通道级协议异常），所有未确认投递都会被 Broker 自动重新入队——这是「至少一次」投递的根源：你还没 ack 就崩溃，消息会重投给别的消费者。所以消费逻辑必须幂等，且要处理 `redeliver=true` 标记（表示这是一次重投）。",
    },
    {
      type: "heading",
      text: "prefetch：控制并发与公平分发",
    },
    {
      type: "table",
      caption: "prefetch 取值与效果",
      headers: ["prefetch 值", "行为", "适用场景"],
      rows: [
        ["1", "一次只处理一条，处理完才收下一条；最公平但吞吐最低", "任务重且处理时间差异大、需要严格公平分发的场景"],
        ["100–300", "官方文档给出的常见最优区间，吞吐高且不易淹没消费者", "大多数订单/支付类业务的默认起点"],
        ["0", "不限数量，等同无背压的无限缓冲", "仅当消息体积小、处理稳定且你能控制内存时使用"],
      ],
    },
    {
      type: "paragraph",
      text: "手动确认下，RabbitMQ 会持续投递，通道上在途的未确认消息可以无限堆积，打爆消费者内存。`basic.qos(prefetch_count=N)` 把每通道未确认消息数限制为 N，达到 N 后停止投递直到有消息被确认——这同时是背压与公平分发：两个库存实例消费同一队列时，prefetch=1 保证「谁处理完谁接下一单」，避免慢实例堆积。边界：prefetch 对 `basic.get`（拉模式）无效，只作用于 `basic.consume` 推送；quorum 队列把消费者 prefetch 上限限制为 2000，避免 Raft 日志失控；由于确认是异步的，动态调整 prefetch 时可能出现瞬时略超配置值的情况，属正常现象。",
    },
    {
      type: "exercise",
      title: "练习：观察 requeue 与重复投递",
      description: "用 pika 写一个手动确认的消费者：处理时故意抛异常并 basic_nack(requeue=True)，观察同一消息反复投递、redeliver 标记变为 true；再写一个消费者在收到消息后不 ack 就 sleep 并强制退出进程，重启后观察该消息被自动重新入队并投递。最后把 requeue 改成 false 并配置死信队列，观察消息转死信。",
      hint: "打印 method.redelivered 观察重投标记；用 Ctrl+C 或 os._exit 模拟崩溃而非正常关闭连接，否则部分客户端会在关闭时自动 nack。",
    },
    {
      type: "quiz",
      question: "库存服务收到「扣库存」消息，正在处理时进程崩溃。以下哪种情况消息会丢失？",
      options: [
        "消费者使用 auto ack 模式",
        "消费者使用手动确认，且在崩溃前已 basic_ack",
        "消费者使用手动确认，处理中崩溃（未 ack）",
        "消费者使用手动确认，崩溃前调用了 basic_nack(requeue=True)",
      ],
      answer: 1,
      explanation: "auto ack 下消息发出即删除，处理中崩溃会丢；手动 ack 但已 ack 说明 Broker 已删除消息，崩溃后消息不重投（业务结果是否丢失取决于本地状态）；未 ack 崩溃会被自动 requeue 重投；requeue=True 的 nack 主动放回队列。",
    },
    {
      type: "keypoints",
      items: [
        "auto ack 是 fire-and-forget：消息写出即删除，处理中崩溃即丢失，不应用于重要业务",
        "手动确认三件套：basic.ack（成功）、basic.reject / basic.nack（失败，requeue 决定重投还是丢弃）",
        "requeue 优先放回原位置；集体 requeue 会形成重投循环，要计数并设置阈值",
        "通道/连接关闭时未确认消息自动 requeue——这是至少一次投递的根源，消费必须幂等",
        "prefetch 同时提供背压与公平分发：1 是最保守起点，100–300 是常用区间",
        "delivery tag 按通道隔离，必须在收消息的同一通道上确认",
      ],
    },
  ],
};
