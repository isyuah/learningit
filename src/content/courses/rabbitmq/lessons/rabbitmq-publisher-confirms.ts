/* ==================================================================
 * 课时：发布确认：消息真正到达（rabbitmq-publisher-confirms）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-publisher-confirms",
  courseSlug: "rabbitmq",
  title: "发布确认：消息真正到达",
  summary: "为什么「发出去」不等于「到达」，confirm 模式如何让生产者确认消息真的被代理接收并落盘。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一节课里，订单服务把「订单创建」事件 publish 到了交换机，看起来很顺利。但如果此刻你问自己：这段代码执行完，消息就一定在 Broker 里了吗？答案是否定的。网络会抖动、TCP 连接可能在你写入 socket 之后才断开、Broker 节点可能在你发送的瞬间崩溃，消息就无声无息地消失了；更麻烦的是，这类故障往往要等心跳超时（heartbeat）才能被发现。另外，就算消息成功到达，如果路由键匹配不到任何队列（交换机名或路由键拼错），消息默认也会被静默丢弃，publish 调用照样返回成功——丢单而不自知，比丢单更可怕。这一节解决发布这一侧最核心的可靠性问题：生产者如何确定消息真的到达了 RabbitMQ。",
    },
    {
      type: "heading",
      text: "confirm 模式：给发布加上回执",
    },
    {
      type: "paragraph",
      text: "RabbitMQ 为 AMQP 0-9-1 扩展了发布确认（Publisher Confirms）机制：客户端调用 `confirm.select` 把通道切换为 confirm 模式，此后通道上每条发布的消息都被分配一个从 1 开始递增的序列号，Broker 处理完消息后在同一通道上回送 `basic.ack`（成功）或 `basic.nack`（失败）。序列号放在 ack 帧的 `delivery-tag` 字段里，`multiple=true` 表示「直到该序号为止的所有消息都已处理」。注意 `basic.nack` 是 RabbitMQ 的协议扩展，且其中的 `requeue` 字段在发布确认场景下应被忽略——它表示 Broker 拒绝为这些消息负责，客户端可以自行决定是否重发。确认帧是异步到达的，且持久消息的确认要等 Broker 真正落盘（磁盘按批次 fsync，恒定负载下延迟可达几百毫秒），所以生产实践是发一批再统一处理确认，或用异步回调，而不是发一条等一条。",
    },
    {
      type: "code",
      title: "confirm 模式 + 逐条等待确认（Python / pika）",
      language: "python",
      code: "import pika\n\nconnection = pika.BlockingConnection(pika.ConnectionParameters(\"localhost\"))\nchannel = connection.channel()\n\n# 开启 confirm 模式；之后每条消息都会收到 basic.ack / basic.nack\nchannel.confirm_delivery()\n\n# 注意 delivery_mode=2：消息标记为持久化（durability 课时详解）\nfor order_id in [\"20260901-0001\", \"20260901-0002\"]:\n    ok = channel.basic_publish(\n        exchange=\"orders.events\",\n        routing_key=\"order.created\",\n        body=f'{{\"order_id\": \"{order_id}\", \"amount\": 99.0}}'.encode(),\n        properties=pika.BasicProperties(delivery_mode=2),\n        mandatory=True,  # 路由不到队列时触发 basic.return 回调\n    )\n    if not ok:\n        # confirm_delivery 返回 False 表示收到了 basic.nack，需要重发/告警\n        print(f\"订单 {order_id} 发布失败，需要补偿\")\n    else:\n        print(f\"订单 {order_id} 已确认\")\n\nconnection.close()\n",
    },
    {
      type: "code",
      title: "异步确认：追踪未确认序号（Python / pika）",
      language: "python",
      code: "import pika\n\nconnection = pika.BlockingConnection(pika.ConnectionParameters(\"localhost\"))\nchannel = connection.channel()\nchannel.confirm_select()  # 低层 API：只开启 confirm 模式，不阻塞\n\nunconfirmed = {}  # seq -> body，便于 nack 时按原样重发\n\n\ndef on_confirm(frame):\n    method = frame.method  # Basic.Ack 或 Basic.Nack\n    seq = method.delivery_tag\n    ok = isinstance(method, pika.spec.Basic.Ack)\n    if method.multiple:  # 该序号之前的所有消息一并处理\n        for s in [s for s in unconfirmed if s <= seq]:\n            handle_result(s, ok)\n    else:\n        handle_result(seq, ok)\n\n\ndef handle_result(seq, ok):\n    body = unconfirmed.pop(seq)\n    if not ok:\n        print(f\"消息 {body} 被 nack，准备重发\")  # 按业务策略重发或告警\n\n\nchannel.add_on_confirm_callback(on_confirm)\n\nfor seq in range(1, 101):\n    body = f'{{\"order_id\": \"20260901-{seq:04d}\"}}'.encode()\n    unconfirmed[seq] = body\n    channel.basic_publish(\"orders.events\", \"order.created\", body,\n                          properties=pika.BasicProperties(delivery_mode=2))\n",
    },
    {
      type: "heading",
      text: "为什么不用事务（txSelect）",
    },
    {
      type: "table",
      caption: "发布确认 vs AMQP 事务",
      headers: ["维度", "AMQP 事务（txSelect/txCommit）", "发布确认（confirm.select）"],
      rows: [
        ["机制", "通道进入事务模式，commit 时统一提交事务内全部发布", "每条/每批消息收到独立的 basic.ack / basic.nack"],
        ["吞吐", "官方文档指出事务会降低约 250 倍吞吐，代价高昂", "批量确认开销极小，是生产默认方案"],
        ["失败粒度", "commit 失败只能整体重发，不知道是哪条出了问题", "精确到序列号，nack 可定位到具体消息"],
        ["互斥性", "事务通道不能再进入 confirm 模式", "confirm 通道也不能再开启事务"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "发布确认的边界",
      body: "事务是为「多条操作原子性」设计的重武器，用它逐条保证发布可靠是杀鸡用牛刀，官方建议直接用发布确认；一条订单事件不需要与其它消息原子提交，它只需要「要么被确认、要么被明确拒绝」。同时记住：发布确认只覆盖「发布→Broker 落盘」这一侧，不保证消费者处理成功——那是消费确认（下一节）的职责；持久消息的确认意味着落盘，但「落盘」到「被消费」之间消息仍可能因 Broker 崩溃等原因丢失，需要与队列持久化组合使用（durability 课时详解）。",
    },
    {
      type: "quiz",
      question: "关于发布确认，以下哪个说法是正确的？",
      options: [
        "confirm 模式启用后，`basic.nack` 的 requeue 字段表示把消息重新放回队列",
        "收到 basic.ack 只说明 Broker 收到了协议帧，不代表消息已处理",
        "持久消息的 basic.ack 会在消息真正写入磁盘后才发出",
        "开启 confirm 模式的通道仍然可以使用事务来增强可靠性",
      ],
      answer: 2,
      explanation: "持久消息的 ack 要等落盘完成才发出（磁盘批量 fsync，延迟可达数百毫秒）；发布场景的 nack 中 requeue 字段应忽略；ack 意味着 Broker 已处理（含持久化）；confirm 与事务互斥。",
    },
    {
      type: "keypoints",
      items: [
        "basic.publish 成功返回 ≠ 消息到达：网络断开、Broker 崩溃、路由不到都可能吞掉消息",
        "confirm.select 开启确认，每条发布按通道内序列号收到 basic.ack / basic.nack",
        "basic.nack 表示 Broker 拒绝负责，requeue 字段在发布侧无效，客户端自行决定重发",
        "确认异步到达、可 multiple 批量；逐条阻塞等待会把持久化延迟变成吞吐瓶颈",
        "事务能保证发布但吞吐下降约 250 倍，生产环境用发布确认",
        "确认只覆盖「发布→Broker 落盘」，消费处理成功与否由消费确认负责",
      ],
    },
  ],
};
