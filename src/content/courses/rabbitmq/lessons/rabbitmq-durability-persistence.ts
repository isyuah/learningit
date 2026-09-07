/* ==================================================================
 * 课时：持久化、镜像与消息落盘（rabbitmq-durability-persistence）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-durability-persistence",
  courseSlug: "rabbitmq",
  title: "持久化、镜像与消息落盘",
  summary: "队列 durable、消息 persistent 与发布确认三层组合，理解什么情况下消息仍然会丢。",
  minutes: 26,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前两节分别讲了发布确认与消费确认，解决了「传输途中」与「处理结果」两个环节。但还有一个更底层的威胁：Broker 自己也会重启、断电、崩溃。消息如果只躺在内存里，Broker 一重启就灰飞烟灭。这一节回答：RabbitMQ 的持久化到底持久了什么、不持久什么，以及 classic 与 quorum 队列在持久化上的根本差异。",
    },
    {
      type: "heading",
      text: "持久化的三层：队列、消息、确认",
    },
    {
      type: "paragraph",
      text: "让一条订单消息在 Broker 重启后存活，需要同时满足三个条件，缺一不可：第一，队列声明为 durable（`durable=true`），这样队列本身与声明属性在重启后保留；第二，消息发布时标记 delivery_mode=2（persistent），这样消息被写入磁盘而非只留内存；第三，生产者使用发布确认，确认「消息已落盘」这一事实本身——否则你根本无从知道前两步有没有生效。classic 队列的落盘是异步批量 fsync，性能好但窗口期更长；持久消息在落盘前 Broker 崩溃时不会收到确认，必须由客户端重发。",
    },
    {
      type: "code",
      title: "持久化三层：声明 durable 队列 + 发布 persistent 消息（Python / pika）",
      language: "python",
      code: "import pika\n\nconnection = pika.BlockingConnection(pika.ConnectionParameters(\"localhost\"))\nchannel = connection.channel()\nchannel.confirm_delivery()  # 第三层：发布确认\n\n# 第一层：durable 队列\nchannel.queue_declare(queue=\"orders.queue\", durable=True)\n\n# 第二层：delivery_mode=2 的持久消息 + 确认\nok = channel.basic_publish(\n    exchange=\"orders.events\",\n    routing_key=\"order.created\",\n    body=b'{\"order_id\": \"20260901-0001\"}',\n    properties=pika.BasicProperties(delivery_mode=2),  # 1 = transient，2 = persistent\n    mandatory=True,\n)\nif ok:\n    print(\"消息已确认落盘\")\n",
    },
    {
      type: "callout",
      variant: "warning",
      title: "持久消息在什么时候仍然会丢",
      body: "队列 durable 只保「队列定义」，消息若不持久化（delivery_mode=1）重启时内存消息全部丢失；消息 persistent 只保「落盘」，若队列本身非持久，重启后队列与其中消息一并消失；发布确认保你「知道」落盘结果，但落盘前崩溃的消息没有确认、客户端必须重发。三层各自防一部分，组合起来才完整。",
    },
    {
      type: "heading",
      text: "classic vs quorum：持久化模型的分水岭",
    },
    {
      type: "paragraph",
      text: "classic 队列的消息持久化是「按消息」的：只有 delivery_mode=2 的消息才落盘。quorum 队列完全不同——它基于 Raft 共识复制到多数节点，队列天然只能是 durable，消息总是持久化（官方特性表：per message persistence = always），且发布确认只有在消息复制到仲裁多数后才发出。换句话说，classic 需要你小心地配齐三层，quorum 把「必须落盘」写进了类型本身。另外，RabbitMQ 3.x 时代的镜像队列（classic queue mirroring）只是内存级异步复制，既不能保证不丢消息，还带来脑裂等运维复杂度——RabbitMQ 4.0 已将其移除，官方迁移路径是 quorum 队列或流。",
    },
    {
      type: "table",
      caption: "classic 队列 vs quorum 队列：持久化与高可用",
      headers: ["维度", "Classic Queue（经典队列）", "Quorum Queue（仲裁队列）"],
      rows: [
        ["非持久队列", "支持（transient / exclusive）", "不支持，只能声明为 durable"],
        ["消息持久化", "按消息：仅 delivery_mode=2 落盘", "总是落盘（per message: always）"],
        ["复制", "无（4.0 起镜像队列已移除）", "Raft 复制到多数节点"],
        ["发布确认时机", "写入本节点磁盘后", "复制到仲裁多数之后，才向生产者确认"],
        ["消费者 prefetch 上限", "无特殊限制", "上限 2000，防 Raft 日志失控"],
        ["适用场景", "吞吐优先、可容忍重启丢失的缓存类队列", "订单、支付等「丢了就出大事」的核心队列"],
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "4.x 的默认队列类型",
      body: "4.0 移除镜像队列后，复制数据结构只剩 quorum 队列与流两种。默认队列类型（DQT）可配置为 classic / quorum / stream，vhost 级配置优先于节点级。4.3 还默认禁止声明 transient 非排他 classic 队列（可用 durable、exclusive 或 durable+TTL 替代；`deprecated_features.permit.transient_nonexcl_queues = true` 可临时恢复）——趋势很明显：RabbitMQ 正在把「非持久、不复制」从默认路径上收走。",
    },
    {
      type: "quiz",
      question: "订单服务向 durable 队列发布了 delivery_mode=2 的消息，未开发布确认。随后 Broker 节点在消息落盘前崩溃。会发生什么？",
      options: [
        "消息已写入磁盘，重启后照常投递",
        "消息丢失，但由于没有发布确认，生产者不知道也无法重发",
        "消息自动转移到另一个节点，不会丢失",
        "队列声明了 durable，所以消息一定不会丢",
      ],
      answer: 1,
      explanation: "持久化是异步批量落盘，落盘前崩溃的消息会丢；没有发布确认，生产者无从得知，这正是官方文档强调「持久化必须配发布确认」的原因。队列 durable 只保队列不保未落盘消息；单节点（无复制）下也没有转移可言。",
    },
    {
      type: "keypoints",
      items: [
        "持久化三层缺一不可：队列 durable + 消息 delivery_mode=2 + 发布确认",
        "durable 保队列定义，persistent 保消息落盘，确认保你「知道」落盘结果",
        "落盘是异步批量 fsync：落盘前崩溃的消息没有确认，必须客户端重发",
        "4.0 移除镜像队列（内存级异步复制）；复制方案只剩 quorum 与 stream",
        "quorum 队列消息总是持久化、确认在复制到多数后才发出，安全模型更简单",
        "4.3 默认禁止 transient 非排他 classic 队列，非持久队列路径持续收紧",
      ],
    },
  ],
};
