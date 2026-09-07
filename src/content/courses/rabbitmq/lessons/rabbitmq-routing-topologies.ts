/* ==================================================================
 * 课时：路由键、Topic 与拓扑设计（rabbitmq-routing-topologies）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-routing-topologies",
  courseSlug: "rabbitmq",
  title: "路由键、Topic 与拓扑设计",
  summary: "路由键的命名就是协议设计。掌握 topic 通配符、默认交换机与拓扑设计原则，避免把 RabbitMQ 用成一条大杂烩总线。",
  minutes: 26,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课介绍了四种交换机，这一课进入实践层：路由键怎么起名、topic 的 `*` 和 `#` 到底怎么匹配、默认交换机是什么、以及一个真正可维护的拓扑长什么样。路由键本质上是你和所有消费者之间的一份隐式协议——起名随便，后面所有人一起吃苦。",
    },
    {
      type: "heading",
      text: "路由键命名：一份隐式协议",
    },
    {
      type: "paragraph",
      text: "路由键不是自由文本，它是用来做模式匹配的结构化字符串：由点号 `.` 分隔成若干个单词（word），例如 `orders.created`、`payments.paid.eur`。两个约定能让这份协议长期成立：第一，按「域.事件」分层，把业务域放在前面（`orders.`、`payments.`、`inventory.`），事件名在后；第二，路由键只描述「发生了什么」，不描述「谁该处理」——后者是消费端的绑定职责。如果订单服务为了讨好某个特定消费者而把键起成 `orders.for-payment-service`，绑定语义和生产语义就永远绑死在一起了。",
    },
    {
      type: "definition",
      term: "binding key 与 routing key 的匹配规则",
      definition: "匹配总是发生在同一个交换机内：发布时带上 routing key，声明绑定时带上 binding key。direct 要求两者逐字符相等；topic 要求按单词匹配；fanout 不看 key；headers 看消息头而非 key。routing key 和 binding key 都在发布/绑定那一刻固化，broker 不做归一化——大小写、多余的点、空单词都按原样比较。",
    },
    {
      type: "code",
      title: "Topic 交换机：通配符与多个绑定（Python / pika）",
      language: "python",
      code: "import pika\n\nch = pika.BlockingConnection(pika.ConnectionParameters(\"localhost\")).channel()\n\n# 交换机：topic 类型\nch.exchange_declare(exchange=\"orders.events\", exchange_type=\"topic\", durable=True)\n\n# 审计服务：orders.# —— 收 orders. 下所有层级（包括两层、三层）\nch.queue_declare(queue=\"audit.all\", durable=True)\nch.queue_bind(exchange=\"orders.events\", queue=\"audit.all\", routing_key=\"orders.#\")\n\n# 支付服务：orders.* —— 只收恰好两层的订单事件\nch.queue_declare(queue=\"payments.orders\", durable=True)\nch.queue_bind(exchange=\"orders.events\", queue=\"payments.orders\", routing_key=\"orders.*\")\n\n# 发布：orders.created 同时命中上面两个绑定\nch.basic_publish(exchange=\"orders.events\", routing_key=\"orders.created\",\n                 body=b'{\"order_id\": 1002}')\n\n# 发布：orders.shipped.eu 只命中 audit.all（三个词，orders.* 匹配不了）\nch.basic_publish(exchange=\"orders.events\", routing_key=\"orders.shipped.eu\",\n                 body=b'{\"order_id\": 1002, \"region\": \"eu\"}')\n",
    },
    {
      type: "callout",
      variant: "warning",
      title: "topic 通配符的边界，最容易记混",
      body: "`*` 恰好匹配「一个单词」，`#` 匹配「零个或多个单词」——但注意边界：`orders.*` 只匹配 `orders.created` 这种两层键，不匹配 `orders` 本身（缺少第二层），也不匹配 `orders.shipped.eu`（多了一层）。`orders.#` 则匹配 `orders`、`orders.created`、`orders.shipped.eu` 全部。还有三个易错点：routing key 不能为空；`#` 不能当单词后缀用（`orders#` 是非法绑定键）；`.` 与通配符以外没有正则能力——`orders.c*` 不是合法的通配写法，会被当成字面字符匹配不到任何东西。",
    },
    {
      type: "heading",
      text: "默认交换机：空名字的 direct",
    },
    {
      type: "paragraph",
      text: "每个 vhost 都有一个隐式存在的默认交换机（default exchange）：名字为空字符串、类型为 direct，且每个队列创建时都会自动用「队列名」作为 binding key 绑定到它。也就是说，直接 `basic_publish(exchange='', routing_key='queue_name', ...)` 就能把消息送进名为 `queue_name` 的队列——这正是很多教程「往队列发消息」的写法。它省事，但代价是把 routing key 和队列名焊死在一起，等于绕过了交换机层。生产拓扑里应显式声明交换机：明确类型、可加策略、可重绑，默认交换机只适合快速实验或极简单的直连场景。",
    },
    {
      type: "heading",
      text: "拓扑设计原则",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "按业务域划分交换机：`orders.*`、`payments.*`、`inventory.*` 各一个交换机，绑定各自域的语义；不要把整个系统塞进一个 topic 交换机。",
        "事件命名保持「域.事件」两层起步：`orders.created`。将来要加地域维度，改成 `orders.created.eu`，topic 的 `#` 还能兜底旧绑定。",
        "明确语义的消费者用 narrow 绑定（如 `orders.*`），全量归档类消费者用 broad 绑定（如 `orders.#`），各取所需。",
        "绑定可增可删、队列可重建，但发布时的 routing key 是「发出去就定了」的事实——生产端协议一旦上线，改名要同步所有消费者。",
        "避免「万用交换机」：一个接收所有事件的 topic 交换机 + 一堆 `#` 绑定。表面上灵活，实际上失去了路由的全部意义，任何消费者都得自行过滤，流量与排查成本成倍增长。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "先画图，再写代码",
      body: "设计拓扑时先在纸上画三样东西：谁产生什么事件（routing key）、谁消费什么（binding key）、哪些消费者要全量哪些要子集。图能画清楚，代码只是把图翻译成 exchange_declare / queue_declare / queue_bind 三行一组。画不出来，说明边界没想清楚，写代码只会更乱。",
    },
    {
      type: "keypoints",
      items: [
        "路由键按「域.事件」分层命名，只描述事实，不描述消费者",
        "topic：* 匹配一个单词，# 匹配零或多个；boundary 之外没有正则能力",
        "默认交换机（空名 direct）把 key 与队列名焊死，生产拓扑显式声明交换机",
        "按业务域划分交换机，避免万用交换机与全量 # 绑定",
        "binding key 在绑定瞬间固化，broker 不做归一化，注意大小写与多余点号",
      ],
    },
  ],
};
