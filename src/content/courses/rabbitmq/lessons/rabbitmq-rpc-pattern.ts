/* ==================================================================
 * 课时：RPC 模式：请求-应答（rabbitmq-rpc-pattern）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2），AMQP 0-9-1。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-rpc-pattern",
  courseSlug: "rabbitmq",
  title: "RPC 模式：请求-应答",
  summary: "用 reply_to 与 correlation_id 在消息队列上实现远程调用：请求队列、应答队列与关联匹配。",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "订单系统里，「订单服务调用库存服务扣减库存并等它确认」这类场景，除了 HTTP 还有另一种选择：把请求和应答都走消息队列。AMQP 0-9-1 的请求-应答（RPC）模式不依赖任何特殊交换机，只用两个消息属性——reply_to 和 correlation_id——就把普通的队列变成了一套远程调用通道。这一节讲清它的拓扑、协议细节、完整可运行示例，以及为什么它常常「能用但不值得」。",
    },
    {
      type: "heading",
      text: "拓扑：一个请求队列 + 每个客户端一个应答队列",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "客户端声明一个专属应答队列（通常 server-named 的 exclusive 队列），消费它等待回复。",
        "客户端发布请求到 rpc_queue（服务端监听的请求队列），属性里带 reply_to=应答队列名、correlation_id=本次请求唯一 ID。",
        "服务端消费请求，完成计算后把结果发布回 reply_to 指向的队列，并原样带回 correlation_id。",
        "客户端在应答队列收到消息时，比对 correlation_id 找到对应的请求，把结果交给调用方。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "为什么不给每个请求建一个应答队列",
      body: "最直觉的做法是每条请求建一个临时应答队列，但那样每个请求都要经历建队列 + 消费 + 删队列的往返，开销大且慢。正确做法是每个客户端（进程）只建一个专属应答队列、复用它，用 correlation_id 区分响应归属。由于队列是排他的（exclusive），连接断开即自动删除，不会泄漏。官方教程给出的补充约定：遇到未知 correlation_id 的响应直接丢弃，而不是报错——因为服务端可能「刚发完应答就崩溃、请求尚未 ack」，重启后重试导致同一请求产生重复响应，客户端必须优雅地容忍。",
    },
    {
      type: "code",
      title: "RPC 客户端（Python / pika，可运行）",
      language: "python",
      code: `# rpc_client.py：请求库存服务扣减库存并等待结果
import pika, uuid, json

class InventoryRpcClient:
    def __init__(self):
        self.conn = pika.BlockingConnection(
            pika.ConnectionParameters("localhost"))
        self.ch = self.conn.channel()
        # 每个客户端一个专属应答队列（server-named + exclusive）
        result = self.ch.queue_declare(queue="", exclusive=True)
        self.callback_queue = result.method.queue
        self.ch.basic_consume(
            queue=self.callback_queue,
            on_message_callback=self.on_response,
            auto_ack=True,            # 应答队列无需手动 ack
        )
        self.response = None
        self.corr_id = None

    def on_response(self, ch, method, props, body):
        # 只认自己这次请求的响应
        if self.corr_id == props.correlation_id:
            self.response = json.loads(body)

    def call(self, order_id: int, sku: str, qty: int):
        self.response = None
        self.corr_id = str(uuid.uuid4())
        self.ch.basic_publish(
            exchange="",
            routing_key="orders.stock.rpc",     # 请求队列
            properties=pika.BasicProperties(
                reply_to=self.callback_queue,
                correlation_id=self.corr_id,
                delivery_mode=2,
            ),
            body=json.dumps({"order_id": order_id, "sku": sku, "qty": qty}),
        )
        # 阻塞等待匹配的应答（演示用；生产建议带超时）
        while self.response is None:
            self.conn.process_data_events(time_limit=1)
        return self.response

if __name__ == "__main__":
    client = InventoryRpcClient()
    print(client.call(10086, "SKU-001", 2))   # {'ok': True, 'remaining': 98}`,
    },
    {
      type: "code",
      title: "RPC 服务端（Python / pika，可运行）",
      language: "python",
      code: `# rpc_server.py：库存服务的 RPC 端点
import pika, json

conn = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
ch = conn.channel()

# 请求队列：durable + quorum，保证请求不丢
ch.queue_declare("orders.stock.rpc", durable=True,
                 arguments={"x-queue-type": "quorum"})

STOCK = {"SKU-001": 100}

def on_request(channel, method, props, body):
    req = json.loads(body)
    sku, qty = req["sku"], req["qty"]
    ok = STOCK.get(sku, 0) >= qty
    if ok:
        STOCK[sku] -= qty
    # 应答发布回 reply_to，correlation_id 原样带回
    channel.basic_publish(
        exchange="",
        routing_key=props.reply_to,
        properties=pika.BasicProperties(correlation_id=props.correlation_id),
        body=json.dumps({"ok": ok, "remaining": STOCK.get(sku, 0)}),
    )
    # 请求确认：处理完成才 ack，防止「答完没 ack 崩溃」导致重复执行
    channel.basic_ack(delivery_tag=method.delivery_tag)

# prefetch=1：同一时刻只处理一条请求，避免多请求并发竞争库存
ch.basic_qos(prefetch_count=1)
ch.basic_consume("orders.stock.rpc", on_request, auto_ack=False)
print("库存 RPC 服务已就绪")
ch.start_consuming()`,
    },
    {
      type: "table",
      caption: "RabbitMQ RPC 与直接 HTTP RPC 对比",
      headers: ["维度", "RabbitMQ RPC", "HTTP RPC"],
      rows: [
        ["同步性", "本质是异步管道 + 客户端等待，天然支持服务端排队", "请求-应答同步，靠负载均衡与超时控制"],
        ["背压 / 削峰", "请求堆积在队列里，服务端按 prefetch 拉取", "请求堆积在 LB/服务端连接，需限流降级"],
        ["服务端可用性", "队列持久化 + quorum 复制，服务端宕机请求不丢，恢复后继续处理", "请求直接失败或依赖网关重试"],
        ["端到端延迟", "额外一跳 + 队列往返，延迟更高", "通常更低"],
        ["运维复杂度", "需维护队列拓扑、correlation 匹配、应答队列生命周期", "生态成熟，工具链丰富"],
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "官方教程的告诫：When in doubt, avoid RPC",
      body: "RabbitMQ 官方 RPC 教程原文提醒：RPC 的问题在于调用方难以区分「本地调用」和「慢速远程调用」，误用会让系统难以调试、难以维护。如果你的目标只是「等一个结果」，HTTP 通常更简单；RabbitMQ RPC 真正的价值在于：请求需要排队削峰、请求必须不丢失、或服务端需要按能力限速消费。另外教程明确建议：能做成异步管道（fire-and-forget + 事件流）就不要做阻塞式 RPC——订单系统里「扣库存后发事件让下游各自处理」通常优于「同步等扣减结果」。",
    },
    {
      type: "heading",
      text: "必须处理的三个边界",
    },
    {
      type: "list",
      items: [
        "correlation_id 丢失：服务端忘记回填、或应答队列消费时没比对，客户端会永远等不到响应——始终原样拷贝 correlation_id，并在客户端带超时兜底（如 10 秒无响应即告警/重试）。",
        "应答队列管理：应答队列必须是 exclusive 或设置了合理 TTL 的临时队列，否则客户端进程反复重启会堆积孤儿队列；服务端应使用 prefetch=1 串行处理写操作，避免并发扣减竞态。",
        "幂等与重复：服务端「答完未 ack 即崩溃」会导致请求重试、产生重复响应；客户端要容忍未知/重复 correlation_id，业务上扣库存等写操作要设计幂等键。",
      ],
    },
    {
      type: "quiz",
      question: "在 RabbitMQ RPC 模式中，correlation_id 的作用是？",
      options: [
        "指定应答要发往的队列名",
        "把响应与发起它的请求关联起来",
        "给消息设置 TTL 生存时间",
        "标记消息为持久化",
      ],
      answer: 1,
      explanation: "reply_to 指定应答队列，correlation_id 用于在共享的应答队列中匹配响应归属。TTL 用 expiration，持久化用 delivery_mode=2，都与 correlation_id 无关。",
    },
    {
      type: "keypoints",
      items: [
        "RPC 拓扑：一个请求队列（服务端消费）+ 每客户端一个专属应答队列，reply_to 指路、correlation_id 关联。",
        "服务端：处理完再 ack；应答发布回 reply_to 并原样带回 correlation_id；prefetch=1 串行化写操作。",
        "客户端：忽略未知 correlation_id 的响应；必须带超时；应答队列用 exclusive 或带 TTL 防泄漏。",
        "RabbitMQ RPC 的适用场景是排队削峰、请求不丢失、服务端限速；普通同步调用优先考虑 HTTP。",
        "能异步就不要阻塞：事件驱动管道通常优于 RPC。",
      ],
    },
  ],
};
