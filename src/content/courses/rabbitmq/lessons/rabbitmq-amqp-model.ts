/* ==================================================================
 * 课时：AMQP 模型：Exchange、Queue 与 Binding（rabbitmq-amqp-model）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-amqp-model",
  courseSlug: "rabbitmq",
  title: "AMQP 模型：Exchange、Queue 与 Binding",
  summary: "理解 Producer、Broker、Consumer 三角色，以及 Exchange、Queue、Binding、Routing Key 如何共同完成一次消息投递。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课我们建立了「消息队列」的心智图景：生产者发消息，消费者收消息，中间隔着 Broker。但 RabbitMQ 不是简单地把消息塞进一个大桶——它实现的是 AMQP 0-9-1 协议，一个比「队列」更精确、也更灵活的模型。理解这个模型，是后面所有章节（交换机与路由、可靠投递、死信）的地基。",
    },
    {
      type: "heading",
      text: "三个角色",
    },
    {
      type: "list",
      items: [
        "Producer（生产者）：发布消息的一方。通过 AMQP 连接把消息发送给 Broker，并指定一个 Exchange 与 Routing Key。",
        "Broker（代理）：运行 RabbitMQ 的服务器进程。它接收发布的消息、执行路由规则、维护队列，并把消息投递给消费者。",
        "Consumer（消费者）：从队列中获取并处理消息的一方。消费者订阅（consume）某个队列，Broker 把队列中的消息推送给它。",
      ],
    },
    {
      type: "heading",
      text: "核心抽象：Exchange、Queue、Binding 与 Routing Key",
    },
    {
      type: "paragraph",
      text: "AMQP 0-9-1 最关键的设计是：**生产者从不直接把消息发给队列**。消息先被发送到一个 Exchange（交换机），交换机根据 Binding（绑定）规则决定把消息复制到哪些 Queue（队列）。",
    },
    {
      type: "definition",
      term: "Exchange（交换机）",
      definition: "消息的入口与路由器。生产者只把消息交给交换机；交换机不存储消息，而是按照自身类型和消息的 Routing Key，把消息路由到零个、一个或多个队列。",
    },
    {
      type: "definition",
      term: "Queue（队列）",
      definition: "消息的实际存储地。队列缓冲消息直到消费者取走；队列可以设置持久化、TTL、死信等属性，也可以被多个交换机绑定。",
    },
    {
      type: "definition",
      term: "Binding（绑定）",
      definition: "把交换机和队列连接起来的规则，即「Binding Key → 队列」的映射。一个队列可以绑定多个交换机；交换机把消息的 Routing Key 与绑定的 Binding Key 做匹配来决定路由。",
    },
    {
      type: "definition",
      term: "Routing Key（路由键）",
      definition: "生产者发布消息时附带的一个字符串标签，交换机根据它（以及自己的类型）决定消息去哪些队列。它只是消息的一个属性，不是目标地址。",
    },
    {
      type: "heading",
      text: "四种交换机类型（预告）",
    },
    {
      type: "table",
      caption: "四种交换机类型的行为差异",
      headers: ["类型", "路由规则", "典型用途"],
      rows: [
        ["direct", "Routing Key 与 Binding Key 精确相等才路由", "按事件类型点对点分发，如 orders.created 只发给一个队列"],
        ["fanout", "忽略 Routing Key，广播给所有绑定队列", "广播通知，如全量刷新缓存"],
        ["topic", "Binding Key 支持 *（匹配一个词）与 #（匹配零或多个词）", "按模式订阅，如 orders.* 匹配所有订单事件"],
        ["headers", "按消息 header 属性匹配，而非 Routing Key", "需要按多个属性组合路由的少数场景"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么要多一层交换机",
      body: "直接「发到队列」看似简单，但会把路由策略写死在生产者代码里：新增一个下游就得改生产者。交换机把「消息的分类」（Routing Key）与「谁关心这类消息」（Binding）彻底分开：生产者只管说「这是 orders.created」，至于谁听，由运维在 Broker 上配置绑定决定。",
    },
    {
      type: "heading",
      text: "一次消息的完整旅程",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "生产者建立连接与信道（channel），通过 basic.publish 把消息连同 Routing Key 发给某个 Exchange。",
        "交换机接收消息，根据自身类型与 Routing Key，对照各绑定的 Binding Key 决定目标队列（可能一个、多个或零个）。",
        "没有匹配到任何队列时：若发布设置了 mandatory 标志，Broker 会把消息退回生产者；否则消息被静默丢弃。",
        "消息进入队列后按顺序排列，直到消费者通过 basic.consume 订阅该队列。",
        "Broker 把消息投递给消费者；消费者处理完后用 basic.ack 确认，Broker 才把消息从队列中删除。",
      ],
    },
    {
      type: "code",
      title: "AMQP 视角下的消息旅程（伪代码）",
      language: "text",
      code: `# 生产者侧
basic.publish(
  exchange    = "orders.events",
  routing_key = "orders.created",
  body        = { order_id: 1024, amount: 199 }
)

# Broker 内部：orders.events（topic 交换机）按绑定匹配
  binding "orders.*"   -> orders.created.queue   # 匹配，入队
  binding "payments.*" -> payments.created.queue # 不匹配，跳过

# 消费者侧
basic.consume(queue = "orders.created.queue")
basic.deliver(...)  ->  处理  ->  basic.ack`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "最常见的误解：消息直接进队列",
      body: "初学时最容易踩的坑是以为「publish 到队列名」就是在发消息。在 AMQP 0-9-1 里，basic.publish 的第一个参数是 Exchange 名，不是队列名！把路由键当成队列名、或忘记声明交换机，会导致消息被静默丢弃或路由不到任何队列。交换机会在专门的章节里详细练习。",
    },
    {
      type: "quiz",
      question: "在 AMQP 0-9-1 模型中，生产者发布一条消息时，消息首先到达哪里？",
      options: [
        "目标队列",
        "Exchange（交换机）",
        "Consumer（消费者）",
        "vhost 的默认存储",
      ],
      answer: 1,
      explanation: "AMQP 0-9-1 的关键设计是生产者只把消息发给 Exchange，由交换机按类型和绑定规则路由到队列。生产者不直接与队列打交道。",
    },
  ],
};
