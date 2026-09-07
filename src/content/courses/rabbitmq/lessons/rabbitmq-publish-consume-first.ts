/* ==================================================================
 * 课时：第一次发布与消费（rabbitmq-publish-consume-first）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-publish-consume-first",
  courseSlug: "rabbitmq",
  title: "第一次发布与消费",
  summary: "用 Python pika 跑通第一段「订单事件」发布与消费：连接、channel、声明队列、basic_publish 与 basic_consume，并理解 Work Queue 的分发语义。",
  minutes: 22,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "环境已经就绪，现在写第一段真正的 RabbitMQ 代码。我们沿用订单系统场景：订单服务发布「订单已创建」事件，一个消费者把它打印出来。为了不引入新的复杂度，这一课先用默认交换机路由到**队列**——是的，这里有个特例：向默认交换机（空字符串）发布时，Routing Key 直接当作队列名。上一课的警告由此展开：消息默认不是直接进队列，只有默认交换机做了这个特殊处理。",
    },
    {
      type: "heading",
      text: "准备：安装 pika",
    },
    {
      type: "code",
      title: "安装 Python 客户端（RabbitMQ 官方教程同款）",
      language: "bash",
      code: `pip install pika

# 确认 RabbitMQ 已就绪（宿主机）
rabbitmqctl status   # 或 docker exec rabbitmq rabbitmqctl status`,
    },
    {
      type: "heading",
      text: "发布端：声明队列并发送",
    },
    {
      type: "code",
      title: "send.py —— 订单服务发布订单事件",
      language: "python",
      code: `import pika

# 1. 建立 TCP 连接（默认 localhost:5672，guest/guest）
connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
# 2. 在连接上打开一个信道（channel），绝大多数操作都在 channel 上做
channel = connection.channel()

# 3. 声明队列：durable=True 表示队列本身持久化（消息持久化后续课程讲）
channel.queue_declare(queue="orders.created", durable=True)

# 4. 发布：exchange 为空字符串 = 使用默认交换机，routing_key 直接当队列名
channel.basic_publish(
    exchange="",
    routing_key="orders.created",
    body="订单已创建: order_id=1024",
)
print(" [x] 已发送 '订单已创建: order_id=1024'")

connection.close()`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "exchange=\"\" 是什么？",
      body: "AMQP 中 `basic_publish` 的 `exchange` 参数传空字符串，表示使用 Broker 内置的默认交换机（direct 类型，名字就叫空串）。此时 Routing Key 被当作队列名直接路由。它是官方入门教程的惯例，但真实项目中通常显式声明并使用业务交换机——这正是下一章节「交换机与路由」的内容。",
    },
    {
      type: "heading",
      text: "消费端：订阅并处理",
    },
    {
      type: "code",
      title: "receive.py —— 通知服务消费订单事件",
      language: "python",
      code: `import pika

connection = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
channel = connection.channel()

# 与发布端声明同一个队列：声明是幂等的，重复调用不会出错
channel.queue_declare(queue="orders.created", durable=True)

def callback(ch, method, properties, body):
    print(f" [x] 收到: {body.decode()}")
    # 确认处理完成，Broker 才删除这条消息（未确认的语义后续课程展开）
    ch.basic_ack(delivery_tag=method.delivery_tag)

# auto_ack=False：手动确认，防止消费者处理中途挂掉导致消息丢失
channel.basic_consume(queue="orders.created", on_message_callback=callback, auto_ack=False)
print(" [*] 等待消息，Ctrl+C 退出")
channel.start_consuming()  # 阻塞式事件循环`,
    },
    {
      type: "paragraph",
      text: "运行方式：先开一个终端跑 `python receive.py`（进入等待），再开另一个终端跑 `python send.py`，观察消费者终端打印出消息。如果想多发几条，把 `send.py` 循环跑几次即可。",
    },
    {
      type: "heading",
      text: "Work Queue：消息分发给多个消费者",
    },
    {
      type: "paragraph",
      text: "现在启动**两个** `receive.py` 消费者，再连续发布多条消息。你会发现消息不是被每个消费者各复制一份，而是被**轮流分发**：每条消息恰好交给一个消费者。这就是 AMQP 默认的轮询（round-robin）分发——所有绑定到同一队列的消费者平分队列里的消息。这让你可以横向增加消费者来提升吞吐，每个消费者处理不同的消息，互不重复。",
    },
    {
      type: "list",
      items: [
        "默认行为是轮询：第一条给 c1、第二条给 c2、第三条给 c1……与消息内容无关。",
        "「多个消费者 = 各处理一部分」的前提是任务可以并行、且不要求顺序——订单事件拆开处理通常没问题。",
        "同一队列的消息天然有序，但一旦多个消费者并行消费，整体顺序就被打破了；需要严格顺序的场景只能单消费者。",
        "Broker 会把未确认（unacked）的消息交给另一个消费者重投，前提是原消费者断开——具体机制在「消费确认」章节讲。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "先发后收，消息不会消失",
      body: "在入门示例里我们总是先启动消费者再发消息。但真实场景中消息可能在任何时刻到达：队列会缓存消息直到有消费者订阅。所以**先运行 send.py 再启动 receive.py 也完全没问题**，消息会一直等在队列里——这正是上一课「缓冲」价值的体现。",
    },
    {
      type: "exercise",
      title: "练习：跑通并观察 Work Queue 分发",
      description: "启动两个 receive.py 消费者（终端 A、B），然后运行 send.py 六次（或循环发送六条消息）。观察：(1) 六条消息是否在 A、B 之间轮流分配？(2) 先全部发送完再启动消费者，消息是否一条不少地全部到达？(3) 把 receive.py 的 basic_ack 改成 auto_ack=True，再重复发送，思考如果消费者中途 Ctrl+C，消息会怎样（先别急着下结论，下一章节验证）。",
      hint: "用两个终端分别启动 receive.py；发送循环可以用 for i in range(6): channel.basic_publish(...)。观察时注意区分：轮询分发与广播（fanout）是两回事。",
    },
    {
      type: "quiz",
      question: "两个消费者订阅同一个队列、各收到一半消息，这属于 AMQP 的哪种语义？",
      options: [
        "广播（fanout）：每个消费者都收到全部消息",
        "Work Queue 轮询：每条消息只交给一个消费者",
        "主题订阅：按路由键过滤",
        "消息复制：每条消息自动备份",
      ],
      answer: 1,
      explanation: "多个消费者订阅同一队列时，AMQP 默认把每条消息轮询分发给其中一个消费者——这是 Work Queue 模式，用于并行分摊任务。广播是 fanout 交换机绑定多个队列、每个队列各有一份副本，是另一种模式。",
    },
  ],
};
