/* ==================================================================
 * 课时：四种交换机类型与绑定（rabbitmq-exchanges-types）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-exchanges-types",
  courseSlug: "rabbitmq",
  title: "四种交换机类型与绑定",
  summary: "Exchange 是消息路由的枢纽。理解 direct、fanout、topic、headers 四种交换机的语义与绑定规则，才能设计出清晰的拓扑。",
  minutes: 28,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "消息队列最朴素的想法，是把消息直接塞进某个队列。但这样做，生产者必须知道消费者的队列叫什么名字——队列改名、拆分、多消费者共享，全都得改生产端代码，耦合极重。RabbitMQ 用 Exchange（交换机）把「谁生产」和「谁消费」彻底拆开：生产者只对交换机说话，消费者只关心自己的绑定。这一节先把交换机、绑定、路由键这三个概念钉死，再逐个讲四种类型的语义和适用场景。",
    },
    {
      type: "heading",
      text: "Exchange：消息的路由中枢",
    },
    {
      type: "definition",
      term: "Exchange（交换机）",
      definition: "生产者不把消息发给某个队列，而是发给 Exchange。Exchange 是 broker 内部的命名路由实体：收到一条消息后，根据自身的类型与绑定规则，决定把消息复制到哪些队列（也可能一个都不给，消息被丢弃）。Exchange 本身不存储消息。",
    },
    {
      type: "definition",
      term: "Binding 与 Routing Key（绑定与路由键）",
      definition: "Binding（绑定）是一条「从 Exchange 指向 Queue」的连接规则，声明时携带一个 binding key（绑定键）；生产者发布消息时携带 routing key（路由键）。Exchange 按「类型语义 + routing key 与 binding key 的匹配结果」决定消息流向。绑定是单向的：只有绑定到某交换机上的队列，才会收到发往该交换机的消息。",
    },
    {
      type: "code",
      title: "声明交换机、队列并绑定（Python / pika）",
      language: "python",
      code: "import pika\n\nconn = pika.BlockingConnection(pika.ConnectionParameters(\"localhost\"))\nch = conn.channel()\n\n# 1. 声明交换机：名称 + 类型（这里用 direct）\nch.exchange_declare(exchange=\"orders\", exchange_type=\"direct\", durable=True)\n\n# 2. 声明队列\nch.queue_declare(queue=\"orders.payment\", durable=True)\n\n# 3. 绑定：把队列挂到交换机上，binding key = \"orders.created\"\nch.queue_bind(exchange=\"orders\", queue=\"orders.payment\",\n              routing_key=\"orders.created\")\n\n# 4. 发布：routing key 与 binding key 相等时消息才会进入该队列\nch.basic_publish(exchange=\"orders\", routing_key=\"orders.created\",\n                 body=b'{\"order_id\": 1001}')\n",
    },
    {
      type: "heading",
      text: "四种类型：语义与选择",
    },
    {
      type: "paragraph",
      text: "「direct：精确匹配」。direct 交换机把消息路由到 binding key 与 routing key 完全相等的队列。这是订单系统的主力：订单服务把 `orders.created` 发布到 `orders` 交换机，支付服务用 binding key `orders.created` 绑定自己的队列——只有创建订单事件能进队，`orders.paid`、`orders.shipped` 不会混进来。注意：多个队列用相同 binding key 绑定时，消息会被复制给每个队列，天然实现「一份事件、多组消费者」的一对多分发。",
    },
    {
      type: "paragraph",
      text: "「fanout：无差别广播」。fanout 忽略 routing key，把消息复制给所有绑定到它的队列。适合「系统广播」场景：比如订单服务发布「全量库存变更」通知，或者审计服务要求每个订单事件都收到一份。在 fanout 交换机上，routing key 形同虚设——写什么都一样，语义完全由绑定关系决定。",
    },
    {
      type: "paragraph",
      text: "「topic：按模式匹配」。topic 把 routing key 看作一串由点号分隔的单词（如 `orders.created` 是两个词），binding key 可以带通配符：`*` 匹配恰好一个词，`#` 匹配零个或多个词。例如 binding key `orders.#` 能收到 `orders.created`、`orders.paid`、`orders.shipped.europe`，而 `orders.*` 只收两层的事件。日志和跨域事件流是典型场景：`logs.info`、`logs.error` 按级别路由，不同团队各自订阅关心的前缀。通配符的边界规则下一课详细展开。",
    },
    {
      type: "paragraph",
      text: "「headers：按头部匹配」。headers 不看 routing key，而是按消息的 headers 属性匹配：绑定参数用 `x-match` 声明 `all`（所有指定头都匹配）或 `any`（任一匹配）。它看似最灵活，但性能差、绑定配置藏在参数里难以观测、排查困难，实践中几乎不用——能用 topic 表达的语义就尽量别用 headers。",
    },
    {
      type: "table",
      caption: "四种交换机类型对比",
      headers: ["类型", "匹配依据", "routing key 作用", "典型场景", "备注"],
      rows: [
        ["direct", "routing key 与 binding key 完全相等", "精确指定目标", "订单事件按类型分发（orders.created → 支付服务）", "语义最清晰，最常用"],
        ["fanout", "不看 key，广播给所有绑定队列", "被忽略", "系统广播、审计全量事件", "最简单，无路由逻辑"],
        ["topic", "routing key 按 . 分词，binding key 支持 * 与 #", "按模式匹配", "日志分级、多域事件流（logs.* / orders.#）", "表达能力最强"],
        ["headers", "消息 headers 属性，x-match: all / any", "被忽略", "按任意头字段组合过滤（极少见）", "性能与维护成本高，避免默认使用"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "没有绑定，消息就会静默丢失",
      body: "两个新手常犯的错误。第一：消息发到没有任何队列绑定的交换机时会被直接丢弃——默认（不带 mandatory 标志）broker 不会暂存无人认领的消息，也不会通知你。第二：绑定是「Exchange → Queue」的单项关系，一个队列可以绑定多个交换机，但一条绑定只属于一个 (exchange, queue) 对。想要「同一份事件进多个队列」，不是重复绑定，而是让多个队列各自用相同的 binding key 绑定到同一个交换机。",
    },
    {
      type: "quiz",
      question: "订单服务把 routing key 为 orders.created 的消息发布到 type 为 direct 的 orders 交换机，以下哪个队列能收到？",
      options: [
        "binding key 为 orders.created 的队列",
        "binding key 为 orders.* 的队列",
        "绑定到 fanout 交换机 broadcast 的队列",
        "vhost 里的所有队列",
      ],
      answer: 0,
      explanation: "direct 要求 routing key 与 binding key 完全相等；orders.* 是 topic 的通配写法；绑定到别的交换机（哪怕 fanout）的队列收不到发往 orders 的消息；没有任何机制把消息广播给所有队列。",
    },
    {
      type: "keypoints",
      items: [
        "Exchange 把生产与消费解耦：生产者只发交换机，消费者只关心绑定",
        "direct 精确匹配、fanout 广播、topic 模式匹配、headers 按头部匹配",
        "消息路由不到任何队列时静默丢弃，排查问题先检查绑定",
        "选择优先级：direct 表达精确分发、topic 表达事件流，headers 尽量避免",
        "多个队列绑定同一 binding key 即可实现一对多分发",
      ],
    },
  ],
};
