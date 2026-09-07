/* ==================================================================
 * 课时：队列——声明、属性与生命周期（rabbitmq-queue-basics）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-queue-basics",
  courseSlug: "rabbitmq",
  title: "队列：声明、属性与生命周期",
  summary: "队列是消息真正落地的地方。声明参数、生命周期、与交换机的绑定关系，决定了消息如何被存储、分发与回收。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "交换机负责路由，队列负责「落地」：消息最终以 FIFO 顺序躺在队列里，直到被消费者取走确认。这一课把队列讲透——声明时的三个布尔参数各管什么、arguments 能配置哪些存储行为、一个队列从诞生到删除会经历什么，以及 4.3 起关于 transient 队列的重要变化。",
    },
    {
      type: "heading",
      text: "声明一个队列：三个布尔参数",
    },
    {
      type: "definition",
      term: "durable / exclusive / auto-delete",
      definition: "`durable`（持久化）：声明时置 true，则队列的元数据（以及队列里的消息，配合消息本身持久化）在 broker 重启后依然存在；false 则重启即消失。`exclusive`（排他）：只允许声明它的连接使用，连接断开时队列被自动删除，常用于一次性临时队列。`auto-delete`（自动删除）：最后一个消费者取消订阅或断开后，队列被自动删除——注意它不看消息是否消费完，只看有没有消费者。",
    },
    {
      type: "code",
      title: "三种声明的典型写法（Python / pika）",
      language: "python",
      code: "import pika\n\nconn = pika.BlockingConnection(pika.ConnectionParameters(\"localhost\"))\nch = conn.channel()\n\n# 1) 持久化业务队列：订单事件，重启不丢\nch.queue_declare(queue=\"orders.created\", durable=True)\n\n# 2) 临时一次性队列：排他 + 自动删除，连接断开即消失\nch.queue_declare(queue=\"\", exclusive=True)  # server-named，见下文\n\n# 3) 带 arguments 的受限队列：TTL + 长度上限\nch.queue_declare(queue=\"orders.created\", durable=True,\n                 arguments={\"x-message-ttl\": 60000,     # 60 秒后消息过期\n                            \"x-max-length\": 100000})    # 最多保留 10 万条\n",
    },
    {
      type: "heading",
      text: "queue arguments：细粒度控制存储行为",
    },
    {
      type: "table",
      caption: "常用队列 arguments（部分）",
      headers: ["参数", "作用", "典型值"],
      rows: [
        ["x-message-ttl", "消息在队列中的存活时间，超时未消费即过期（可与死信配合）", "60000（毫秒）"],
        ["x-expires", "队列空闲（无消费者、无消息）多久后被自动删除", "300000（毫秒）"],
        ["x-max-length / x-max-length-bytes", "队列最大消息条数 / 字节数，超限时按溢出策略丢弃", "100000 / 536870912"],
        ["x-overflow", "队列满时的行为：drop-head（丢最旧的）或 reject-publish（拒绝新发布）", "drop-head"],
        ["x-dead-letter-exchange / x-dead-letter-routing-key", "消息过期、被拒或超限时转发到的目标交换机与键", "dlx.exchange"],
        ["x-queue-type", "指定队列类型：classic / quorum / stream", "quorum"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "声明参数不一致会报错",
      body: "RabbitMQ 的队列声明是「有则比对，无则创建」：同一队列再次声明时，durable、exclusive、arguments 等任何参数与已存在的不一致，broker 直接报 `PRECONDITION_FAILED` 并拒绝声明。这意味着队列参数在第一次声明时就定型了。想改参数，必须先删除旧队列再重建——而删除队列会连消息一起清空，生产环境改参数要慎之又慎（可选方案：换新队列名并迁移绑定）。",
    },
    {
      type: "heading",
      text: "生命周期与 server-named 临时队列",
    },
    {
      type: "paragraph",
      text: "队列的一生是：声明（queue.declare，幂等）→ 绑定到交换机（queue.bind）→ 接收消息 → 消费者取走并确认 → 删除（queue.delete，或由 exclusive / auto-delete / x-expires 触发）。三种自动消失机制要区分清楚：exclusive 是「连接断开即删」，auto-delete 是「最后一个消费者离开即删」，x-expires 是「空闲超时即删」。",
    },
    {
      type: "paragraph",
      text: "server-named（服务器命名）临时队列是发布/订阅场景的标准做法：声明时传空队列名 `queue=''`，broker 返回一个唯一名称（如 `amq.gen-xxxx`），配合 `exclusive=True`，消费者拿到这个名字即可绑定。典型用法：fanout 广播下，每个消费者声明一个临时队列绑到广播交换机上，各自收到全量消息副本——消费完或断线，队列自动消失，不留垃圾。注意临时队列必须绑定后才能收到消息，且消息永远不落地在临时队列上等待：没有消费者在线的瞬间，发往它的消息一样会丢。",
    },
    {
      type: "heading",
      text: "队列与交换机：一个双向但不对称的关系",
    },
    {
      type: "paragraph",
      text: "队列可以绑定多个交换机，交换机也可以被多个队列绑定（多对多），但两者并不对等：交换机不存储消息，路由不到任何队列的消息直接丢弃；而队列中的消息在消费者确认前是「留在队列里的」。所以「消息进了队列」不等于「消息被处理了」——中间隔着消费者的确认机制（后续课时讲 Consumer Ack 与 Prefetch）。另外，队列类型（classic / quorum / stream）影响复制与存储语义：quorum 队列用 Raft 复制保证高可用，stream 面向追加式日志。默认队列类型（DQT）可在节点级或 vhost 级配置，vhost 级优先。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "4.3：transient 非排他队列默认被禁止",
      body: "从 RabbitMQ 4.3 起，默认禁止声明 transient（不持久化）、非 exclusive 的经典队列——也就是 `durable=False` 且 `exclusive=False` 的组合。这类队列是「既想靠名字共享、又不怕重启丢失」的中间态，最容易被误用（比如多个消费者共用一个名字，消息却随重启蒸发）。需要共享队列就用 durable；只需要临时就用 exclusive（或 server-named）；可用 `deprecated_features.permit.transient_nonexcl_queues = true` 显式恢复旧行为，但新项目不应依赖它。",
    },
    {
      type: "quiz",
      question: "某消费者声明了一个 durable=False、exclusive=False 的经典队列，连接 RabbitMQ 4.3 的 broker，会发生什么？",
      options: [
        "队列正常创建，消息照常收发",
        "声明被拒绝，因为 4.3 默认禁止 transient 非排他经典队列",
        "队列创建成功，但 broker 会自动把 durable 改成 true",
        "连接直接断开，broker 拒绝任何后续操作",
      ],
      answer: 1,
      explanation: "4.3 默认禁止声明 transient 非排他 classic 队列（可用 durable、exclusive、或 durable+TTL 替代；配置 deprecated_features.permit.transient_nonexcl_queues = true 可恢复）。",
    },
    {
      type: "keypoints",
      items: [
        "durable 保元数据与消息、exclusive 绑定连接、auto-delete 跟随消费者；三者的消失时机各不相同",
        "arguments 控制存储细节：TTL、长度上限、溢出策略、死信转发、队列类型",
        "队列参数首次声明定型，二次声明不一致报 PRECONDITION_FAILED，修改需删队重建",
        "server-named 临时队列（空名 + exclusive）是发布/订阅的标配，消费完即自动清理",
        "4.3 起 transient 非排他经典队列默认禁止，共享用 durable、临时用 exclusive",
      ],
    },
  ],
};
