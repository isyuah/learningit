/* ==================================================================
 * 课时：综合项目：订单处理服务（rabbitmq-capstone-order-service）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-capstone-order-service",
  courseSlug: "rabbitmq",
  title: "综合项目：订单处理服务",
  summary: "把可靠投递、幂等消费、背压、死信与可观测性串成一套可上线的订单消息系统。",
  minutes: 75,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "前面所有课时讲的知识点，现在要合成一个真实系统。目标：设计并实现一个「订单处理消息系统」——订单服务发布订单创建事件，支付服务、库存服务、通知服务各自消费并处理。要求不是「能跑通」，而是达到生产级标准：Quorum 队列 + 发布确认 + 手动 ack + 幂等消费 + 死信 + 监控。这一节是练习课：先给出架构与逐步指导，然后用多道练习逼你把每一层做扎实。环境建议：3 节点 RabbitMQ 4.2/4.3 集群（Docker Compose 即可），Python + pika（或你熟悉的客户端），订单数据可用内存字典模拟数据库。",
    },
    {
      type: "heading",
      text: "系统架构（文字版）",
    },
    {
      type: "list",
      items: [
        "生产者：订单服务（order-service）——创建订单后发布 `order.created` 事件，开启 Publisher Confirms，mandatory + 备交换机兜底。",
        "交换机：`orders.exchange`（topic 类型）；路由键 `order.created`、`order.paid`、`order.shipped`。",
        "队列：`orders.created`（Quorum，durable）→ 支付服务；`orders.created.inventory`（Quorum）→ 库存服务；`orders.notify`（Stream 或 Quorum）→ 通知服务。",
        "死信：`orders.dlx` 交换机 + `orders.dead` 队列；处理失败超过投递上限的消息进入死信，人工/审计处理。",
        "幂等：每个事件带 `event_id`（UUID），消费方用「事件表 + 唯一约束」去重，天然幂等。",
        "监控：Prometheus 抓取 + 关键告警（队列深度、unacked、内存/磁盘水位、死信队列增长）。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么核心队列用 Quorum 而不是经典队列",
      body: "订单事件丢失 = 订单丢了钱：必须复制 + 多数派确认。Quorum 队列满足：已确认消息不丢、leader 故障自动选举、内置毒消息保护（x-delivery-limit）。经典队列在 4.x 已无镜像，单点存储，不适合这类核心业务。通知类事件如果积压量大、需要回放，可考虑 Stream（可重复读、按 offset 消费）。",
    },
    {
      type: "exercise",
      title: "练习 1：声明拓扑（Quorum 队列 + 死信 + 交换机）",
      description: "用 pika（或等价客户端）编写拓扑初始化脚本：声明 `orders.exchange`（topic）、`orders.dlx`（direct）、死信队列 `orders.dead`（durable、Quorum 或 classic 均可）、`orders.created` 与 `orders.created.inventory` 两个 Quorum 队列（durable、`x-queue-type=quorum`、`x-delivery-limit=5`、`x-dead-letter-exchange=orders.dlx`、`x-dead-letter-routing-key=order.failed`）。建立绑定：orders.created 队列绑定 `order.created` 路由键。脚本要可重复执行（幂等声明）。",
      hint: "队列声明参数：durable=True、arguments 里给 x-queue-type=quorum、x-delivery-limit=5、x-dead-letter-exchange 与 x-dead-letter-routing-key。声明不存在才创建——pika 的 queue_declare 对已存在且参数一致的队列是幂等的。绑定用 channel.queue_bind(queue=..., exchange=..., routing_key=...)。",
    },
    {
      type: "exercise",
      title: "练习 2：生产者——发布确认 + mandatory",
      description: "实现 order-service 的发布函数：为每条订单生成 `event_id`（UUID）与 `order_id`，发布到 orders.exchange（routing_key=order.created，delivery_mode=2 persistent，properties.headers 里带 event_id）。开启 publisher confirms，并实现批量确认：每发布 50 条处理一次 confirm 回调；对未确认/被 nack 的消息实现重试（指数退避，最多 3 次）。同时开启 mandatory：路由不到任何队列时触发 Return 回调并告警。",
      hint: "pika 中 channel.confirm_delivery() 开启同步确认，或 channel.add_on_confirm_callback 用异步批量。mandatory=True 时 Basic.Return 通过 channel.add_on_return_callback 收到。重试要区分「nack（broker 明确拒绝）」与「连接中断（未知）」，后者必须重新发布。",
    },
    {
      type: "exercise",
      title: "练习 3：消费者——手动 ack + 幂等消费",
      description: "实现支付服务消费者：连接 orders.created 队列，basic_qos(prefetch_count=100)，手动 ack。处理流程：(1) 先按 event_id 查事件表（唯一约束），已存在则直接 ack（幂等）；(2) 不存在则执行「支付扣款」（模拟：内存字典 + 随机失败）；(3) 成功则写入事件表并 ack；(4) 失败则 basic_nack(requeue=false)——让消息走死信，而不是无限重试。用两个消费实例同时跑，验证同一订单不会被处理两次（幂等生效）。",
      hint: "幂等关键：事件表在扣款「之前」插入并提交（或扣款与插事件同一事务），否则并发下会重复扣款。nack(requeue=False) 后消息进入 DLX——被 x-delivery-limit 兜底与主动死信结合。测试幂等：手动把同一 event_id 的消息塞两条，观察只处理一次。",
    },
    {
      type: "exercise",
      title: "练习 4：死信链路验证",
      description: "故意让支付服务抛异常（如对特定 order_id 模拟「余额不足」），连续发布该订单，确认：(1) 消息重投到 x-delivery-limit=5 后被死信；(2) orders.dead 队列收到路由键 order.failed 的消息，headers 含 x-death 信息（记录被拒绝原因与次数）；(3) 编写一个死信处理脚本（消费 orders.dead，记录到审计日志或人工队列）。同时验证：删除 DLX 或让死信目标不可达时，消息滞留在源队列（at-most-once 与 at-least-once 死信的行为差异可选探索）。",
      hint: "x-death 头在死信消息的 headers 里，含 cause（如 rejected/expired）、count、queue 等。观察用 rabbitmqctl list_queues 或管理 UI。死信消费者要防毒：它自己也可能失败，建议对死信也做去重或只做审计。",
    },
    {
      type: "exercise",
      title: "练习 5：故障与背压演练",
      description: "做两个故障演练：(a) 停掉一个集群节点，验证 Quorum 队列在多数派存活时正常服务（发布确认继续、消费不中断），再用 rabbitmq-queues quorum_status 观察 leader 迁移；(b) 停掉全部消费者，持续发布 1 万条消息，观察队列深度上涨、内存水位，并确认触发资源告警时发布连接被阻塞（publisher confirm 超时/失败），恢复消费者后队列排空、告警清除。",
      hint: "停节点用 rabbitmqctl stop_app（保留 Erlang 进程）而不是直接 kill。演练前记录告警状态：rabbitmq-diagnostics alarms。观察发布阻塞：连接会收到 Connection.Blocked（pika 可注册 add_on_connection_blocked_callback）。演练后把集群恢复，并练习 check_if_node_is_quorum_critical。",
    },
    {
      type: "exercise",
      title: "练习 6：监控与告警落地",
      description: "启用 rabbitmq_prometheus，配置 Prometheus 抓取（15692），并为以下指标各写一条告警规则：队列深度 orders.* 超过 5000 持续 5 分钟、unacked 超过 1000 持续 5 分钟、节点内存水位 > 80%（mem_alarm 触发）、磁盘剩余 < 2GB、死信队列 orders.dead 有消息。最后用 rabbitmq-diagnostics 的检查命令写一个「集群就绪」脚本（ping + check_local_alarms + check_if_node_is_quorum_critical），供部署/升级前使用。",
      hint: "Prometheus 指标名形如 rabbitmq_queue_messages_ready、rabbitmq_process_open_fds、rabbitmq_node_mem_alarm 等（以 /metrics 实际输出为准，先 curl 确认）。告警规则用 PromQL：如 increase(rabbitmq_queue_messages_ready[5m]) > 5000 或直接绝对值条件。就绪脚本记得用 -q 与退出码判断。",
    },
    {
      type: "heading",
      text: "对照检查：你的系统达标了吗",
    },
    {
      type: "list",
      items: [
        "核心队列是 Quorum（x-queue-type=quorum），durable，非 transient/排他。",
        "生产者开启 Publisher Confirms，mandatory + Return 回调，重试有退避且有界。",
        "消费者手动 ack、prefetch 合理（≥100）、处理失败 nack(requeue=false) 而非无限重试。",
        "幂等靠 event_id + 事件表唯一约束，且在副作用之前完成去重判断。",
        "死信链路通：x-delivery-limit 兜底、DLX 路由正确、死信有消费者处理且自身防毒。",
        "故障演练过：单节点故障服务不中断（多数派）、消费者全停触发告警与阻塞、恢复后排空。",
        "监控落地：Prometheus 抓取、队列深度/unacked/水位/死信四条告警、就绪检查脚本可跑。",
      ],
    },
    {
      type: "quiz",
      question: "在订单系统中，消费者收到一条 order.created，处理支付时发现该 event_id 已在事件表中（之前已处理过）。正确处理是？",
      options: [
        "再次执行支付扣款，确保订单被支付",
        "直接 basic_ack 确认（幂等跳过），不再重复处理",
        "basic_nack(requeue=true) 让它重新投递",
        "把消息发到死信队列等待人工处理",
      ],
      answer: 1,
      explanation: "幂等消费的核心：event_id 已处理过就直接 ack，避免重复扣款。重新扣款会重复记账；requeue 会无限循环；进死信则把正常去重误判为异常。唯一约束保证并发下也只有一次能插入成功，其余都走「已存在→ack」。",
    },
    {
      type: "keypoints",
      items: [
        "架构：order-service 发布 → orders.exchange（topic）→ Quorum 队列 → 支付/库存/通知消费；DLX 兜底异常。",
        "可靠投递：Publisher Confirms + mandatory + 有界重试；消费手动 ack + prefetch。",
        "幂等：event_id + 事件表唯一约束，去重判断先于副作用执行。",
        "故障：Quorum 多数派容忍单节点故障；消费者全停会触发告警与发布阻塞，恢复后自然排空。",
        "可观测：Prometheus 抓取、队列深度/unacked/水位/死信告警、集群就绪检查脚本。",
      ],
    },
  ],
};
