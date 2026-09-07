/* ==================================================================
 * 课时：死信队列：拒绝、过期与路由失败（rabbitmq-dead-lettering）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2），AMQP 0-9-1。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-dead-lettering",
  courseSlug: "rabbitmq",
  title: "死信队列：拒绝、过期与路由失败",
  summary: "消息被拒绝、过期或被丢弃时，如何通过死信交换机把它们交给专门的处理者，而不是悄悄消失。",
  minutes: 28,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "在订单系统里，支付服务消费「订单已创建」消息时，可能遇到库存不足、风控拒绝等无法处理的场景。如果消费者把消息丢弃，审计就丢了线索；如果无限重试，又可能把一条坏消息反复塞给下游。死信（Dead Letter）机制给出的答案是：队列在「放弃」一条消息时，不直接删除它，而是把它重新发布到一个专门的交换机——死信交换机（Dead Letter Exchange，DLX）。DLX 本身是普通交换机（direct / fanout / topic 皆可），只是被源队列在声明时通过 x-dead-letter-exchange 指定为「退信地址」。这一节回答四个问题：死信在什么时候触发、如何配置、典型用法是什么、以及 4.x 中 quorum 队列带来的可靠性差异。",
    },
    {
      type: "heading",
      text: "死信的触发条件：四种，且只有四种",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "消费者负向确认：AMQP 0-9-1 消费者对消息执行 `basic.reject` 或 `basic.nack`，且 requeue 参数为 false；AMQP 1.0 消费者使用 rejected outcome 同理。",
        "消息过期：消息的 per-message TTL（expiration 属性）到期，被队列判定过期。",
        "长度溢出：队列达到长度上限（x-max-length / x-max-length-bytes），按溢出策略丢弃旧消息（drop-head）或拒绝新消息（reject-publish-dlx，仅 classic 队列）。",
        "超过投递次数上限：quorum 队列的消息被重新投递超过 delivery-limit（4.0 起默认 20），按策略丢弃或死信。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "「无法路由」并不会触发死信",
      body: "一个常见的误解是「消息路由不到任何队列就会进死信」。实际上，无法路由的消息要么被丢弃、要么在设置了 mandatory 时通过 basic.return 退还给发布者，与死信机制无关。反过来，一条已经在死信流程中的消息如果无法从 DLX 路由到任何队列，它会被静默丢弃（at-most-once 语义下）——这是下一节延迟消息方案必须保证「DLX 上有绑定」的原因。另外注意：整个队列过期（queue TTL）时，队列里的消息不会被死信化，而是随队列一起被删除。",
    },
    {
      type: "code",
      title: "声明带死信配置的队列（Python / pika）",
      language: "python",
      code: `# 支付服务：消费订单消息，处理失败时进入兜底流程
import pika, json

conn = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
ch = conn.channel()

# 死信交换机：topic 类型，下游按 routing key 分流
ch.exchange_declare("orders.dlx", "topic", durable=True)
ch.queue_declare("orders.dlq.fallback", durable=True)
ch.queue_bind("orders.dlq.fallback", "orders.dlx", routing_key="#")

# 工作队列：声明时把死信交换机挂上去
args = {
    "x-dead-letter-exchange": "orders.dlx",
    # 不指定 x-dead-letter-routing-key 时，沿用消息原始 routing key
}
ch.queue_declare("orders.payments", durable=True, arguments=args)

def on_msg(channel, method, props, body):
    order = json.loads(body)
    try:
        process_payment(order)          # 业务处理
        channel.basic_ack(method.delivery_tag)
    except PaymentRejected:
        # requeue=False：拒绝这条消息，送进死信
        channel.basic_nack(method.delivery_tag, requeue=False)

ch.basic_qos(prefetch_count=10)
ch.basic_consume("orders.payments", on_msg, auto_ack=False)
ch.start_consuming()`,
    },
    {
      type: "paragraph",
      text: "被死信化的消息会带着「案底」重新发布：exchange 被替换为 DLX 的名字；路由键要么使用队列上配置的 x-dead-letter-routing-key，要么保留消息原始的 routing key（含 CC/BCC 引入的键）。AMQP 0-9-1 消息会新增 x-death 头（数组，按时间倒序记录每次死信事件：来源队列、原因、次数、首次时间等），以及 x-first-death-* 与 x-last-death-* 头。原始 TTL 会被移除并记录到 original-expiration，避免消息在死信队列里再次过期。下游可以根据 x-death 里的 reason 判断死信原因：rejected / expired / maxlen / delivery_limit。",
    },
    {
      type: "heading",
      text: "典型用法：重试、审计与兜底",
    },
    {
      type: "list",
      items: [
        "延迟重试队列：把死信投递给一个带 TTL 的重试队列，TTL 到期后再死信回原工作队列——这是下一节延迟消息方案的基础。",
        "审计与追踪：把订单事件的全部死信汇聚到一个审计流（推荐直接用 stream 承接），保留业务痕迹，用于排查「这条消息为什么没被处理」。",
        "兜底（fallback）：与重试搭配，超过重试次数上限后进入人工兜底队列（如告警 + 人工介入），而不是无限循环。",
      ],
    },
    {
      type: "heading",
      text: "quorum 队列：at-least-once 死信",
    },
    {
      type: "paragraph",
      text: "默认情况下，死信本质上是「不带发布确认的重发布」：消息从源队列移除、立刻投给 DLX，如果目标队列恰好不可用或拓扑配错，消息就丢了——这叫 at-most-once 死信，也是 quorum 队列的默认策略。对大多数「死信只是信息性数据」的场景够用；但如果你把死信当作「还要继续处理的业务数据」，就需要 quorum 队列的 at-least-once 死信：源队列保留死信消息，由一个内部死信消费者进程带发布确认投递到所有目标队列，全部确认后才从源队列删除；投递失败会周期重试（默认重试间隔约 3 分钟）。启用条件是三个配置同时生效：dead-letter-strategy 设为 at-least-once、overflow 设为 reject-publish、并配置了死信交换机。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "at-least-once 死信的四个代价",
      body: "（1）overflow 必须用 reject-publish，drop-head 会直接回退为 at-most-once——因为丢头会违反「不丢」的承诺。（2）目标队列长时间不可用时，死信消息会在源队列堆积，官方建议给源队列配置 max-length / max-length-bytes 兜底。（3）内部死信消费者默认 prefetch 为 32（可调 dead_letter_worker_consumer_prefetch），高吞吐死信场景需要调大。（4）通过策略从 at-least-once 切回 at-most-once（或把 overflow 改回 drop-head）时，所有尚未被目标确认的死信会被永久删除。另外，源队列里消息若标记为 transient，死信到目标 classic 队列后不会持久化——要真正保活，发布时就得把 delivery_mode 设为 2。",
    },
    {
      type: "quiz",
      question: "以下哪种情况会触发消息进入死信队列？",
      options: [
        "消息发布时路由不到任何队列（无绑定匹配）",
        "消费者对消息执行 basic.nack 且 requeue=false",
        "消息所在队列整体到期（queue TTL 触发）",
        "消费者没有及时 ack，被 consumer timeout 强制重投递",
      ],
      answer: 1,
      explanation: "触发死信的四种情况是：负向确认且 requeue=false、per-message TTL 过期、队列长度溢出、quorum 队列超过 delivery-limit。无法路由的消息不会死信（会被丢弃或返还发布者）；队列整体到期时消息随队列删除、不进入死信；consumer timeout 把消息重新入队供重投递，与死信无关。",
    },
    {
      type: "keypoints",
      items: [
        "死信只有四种触发：reject/nack(requeue=false)、per-message TTL 过期、长度溢出、quorum 超投递上限。",
        "DLX 是普通交换机，靠 x-dead-letter-exchange（+可选 x-dead-letter-routing-key）挂在源队列上；路由失败或 DLX 不存在时消息被静默丢弃。",
        "死信消息带 x-death / x-first-death-* / x-last-death-* 头，原始 TTL 被移除，原因码为 rejected / expired / maxlen / delivery_limit。",
        "默认死信是 at-most-once（无发布确认，可能丢）；quorum 队列可开启 at-least-once，需 dead-letter-strategy + overflow=reject-publish + DLX 三者齐备。",
        "死信队列的典型用途：延迟重试、审计追踪、人工兜底。",
      ],
    },
  ],
};
