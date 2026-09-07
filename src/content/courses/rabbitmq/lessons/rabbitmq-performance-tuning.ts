/* ==================================================================
 * 课时：性能优化与故障排查（rabbitmq-performance-tuning）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-performance-tuning",
  courseSlug: "rabbitmq",
  title: "性能优化与故障排查",
  summary: "从消息大小、持久化、确认模式到 prefetch 与告警阈值，理解吞吐从哪里来、卡在哪。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "「队列很慢」通常不是 RabbitMQ 一个环节的问题，而是整条链路的匹配问题：发布方确认方式、消费方确认方式、prefetch、消息大小、持久化程度、磁盘速度、告警阈值、连接与信道数量共同决定吞吐。这一节先建立性能心智模型（瓶颈在哪里），再逐个旋钮讲清楚怎么调，最后列常见性能陷阱。",
    },
    {
      type: "heading",
      text: "性能从哪来：先找瓶颈",
    },
    {
      type: "paragraph",
      text: "RabbitMQ 的性能模型可以简化为三对关系：生产者→队列（ingress）、队列→消费者（egress）、以及贯穿始终的持久化与确认。消息要走「确认」回路（Publisher Confirms 或 Consumer ack），每一条确认都是一次往返。因此吞吐的上限往往不是网络带宽，而是：确认的往返次数、磁盘 IO（持久化消息）、以及单连接的串行化程度。经典队列与 Quorum 队列的取舍也在此处：Quorum 每条消息都要写 WAL 并等多数派确认，磁盘越快吞吐越高；消息越大、成员越多，吞吐越低。",
    },
    {
      type: "table",
      caption: "影响吞吐的因素与调优方向",
      headers: ["因素", "影响", "调优方向"],
      rows: [
        ["消息大小", "越大吞吐越低（尤其 Quorum，IO 密集）", "大 payload 存对象存储，消息只带引用"],
        ["持久化 vs 非持久", "持久化要落盘，非持久更快但有丢失风险", "按可靠性需求选择；Quorum 始终持久化"],
        ["发布确认", "每条确认一次往返；批量可摊薄", "用批量 publish（如确认 N 条一次）"],
        ["消费确认与 prefetch", "prefetch=1 每消息一次往返，吞吐最低", "合理提高 prefetch（如 100~300）"],
        ["并发", "单连接/单信道串行；多信道并行", "多连接、多信道分摊，避免单点热点"],
        ["磁盘", "Quorum/持久化消息的吞吐上限", "用 SSD；给 Quorum 预留 3~4 倍 WAL 内存"],
      ],
    },
    {
      type: "heading",
      text: "内存与磁盘告警阈值：保护性节流",
    },
    {
      type: "paragraph",
      text: "RabbitMQ 有两个「保护性水位」，触达后不是崩掉，而是阻塞发布连接（消费不受影响）：内存高水位默认是可用 RAM 的 60%（`vm_memory_high_watermark.relative = 0.6`），磁盘低水位默认 50 MiB（`disk_free_limit`）。注意：告警是集群级的——一个节点触达，全部节点都会阻塞发布者。容器环境强烈建议用绝对内存阈值（如 `vm_memory_high_watermark.absolute = 4Gi`），因为节点不一定能正确探测 cgroup 限制。",
    },
    {
      type: "code",
      title: "rabbitmq.conf 设置资源水位",
      language: "ini",
      code: `# 内存：绝对阈值（容器环境推荐，替代默认 60%）
vm_memory_high_watermark.absolute = 4Gi

# 磁盘：保守建议设为与内存同量级，避免瞬时打爆
disk_free_limit.absolute = 4GB

# 运行时调整（重启失效）：
#   rabbitmqctl set_vm_memory_high_watermark absolute "4G"
#   rabbitmqctl set_disk_free_limit 4GB`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "告警≠崩溃，但阻塞是全集群的",
      body: "内存告警只「节流」不「防超」：节点实际可能超过水位继续涨，直到 OOM killer 动手。磁盘告警的两个坑：一是瞬时 page-out 可能在两次磁盘检查（最短 10 秒一次，接近水位时加密到每秒 10 次）之间打爆磁盘；二是集群任一节点触发磁盘告警，所有节点都会阻塞生产者。所以阈值要保守（磁盘建议按内存量级设），并用 `rabbitmq-diagnostics alarms` / `check_local_alarms` 持续观察。",
    },
    {
      type: "heading",
      text: "流控（flow control）与连接/信道",
    },
    {
      type: "paragraph",
      text: "除了资源告警，RabbitMQ 还有瞬态流控：当客户端发布快于节点消化时，节点对该连接做 TCP 背压（暂停读），发布操作表现为延迟或超时。这本身是健康的保护机制，但若频繁触发，说明生产者过载或消费者跟不上。连接与信道是资源：每个连接都是 Erlang 进程、每个信道也消耗内存；单节点数千连接、数万信道是可能的，但要防止「连接泄漏」导致的 fd 耗尽（fd 接近上限时节点拒绝新连接）。",
    },
    {
      type: "list",
      items: [
        "连接/信道不是并发武器：真正并行要靠多连接与多信道分摊，但每多一条连接都有内存与 fd 成本。",
        "生产与消费建议分开连接：告警阻塞的是发布连接，混用会让消费也被误伤（见 alarms 文档）。",
        "合理设置客户端心跳与连接回收，避免僵尸连接堆积。",
        "用 `rabbitmq-diagnostics status` / 管理 API 观察 connections/channels 数量与 fd_used。",
      ],
    },
    {
      type: "heading",
      text: "生产者与消费者吞吐调优",
    },
    {
      type: "paragraph",
      text: "生产侧：优先开启 Publisher Confirms；单条确认的往返开销大，应「批量」——发一批（如 100 条）再统一处理 confirm 回调。不要把每条消息都同步等确认再发下一条（这是最常见的吞吐杀手）。消费侧：手动 ack 下，prefetch 决定「一次从队列取多少条未确认消息」。prefetch=1 每处理一条都要等下一轮投递，RTT 完全暴露，吞吐极低；prefetch 过大又会让 unacked 堆积、消息倾斜到慢消费者。通用起点是 100~300，再按处理耗时与单条消息体积实测微调。",
    },
    {
      type: "code",
      title: "Python/pika：批量发布 + 合理 prefetch",
      language: "python",
      code: `import pika

conn = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
ch = conn.channel()

# ---- 生产者：批量发布，统一等确认 ----
ch.confirm_delivery()
BATCH = 100
for i in range(10_000):
    ch.basic_publish(
        exchange="orders.exchange", routing_key="order.created",
        body=f"order-{i}".encode(),
        properties=pika.BasicProperties(delivery_mode=2),  # persistent
    )
    if (i + 1) % BATCH == 0:
        # 阻塞等待此前 100 条全部确认（或在回调中批量处理）
        ch._flush_outbound()  # 触发确认处理；真实项目中用 confirm 回调更优雅

# ---- 消费者：prefetch 控制未确认上限 ----
ch.basic_qos(prefetch_count=200)   # 每信道最多 200 条未确认
ch.basic_consume("orders.created", on_message_callback=handle)
ch.start_consuming()`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "prefetch 不是越大越好",
      body: "prefetch 过高时，多个消费者会「抢」消息：快的抢走很多、慢的被饿着，队列里大量 unacked，还可能导致消息在消费者侧积压内存。prefetch 的合理值取决于：处理耗时的方差、单条消息大小、每个消费者能接受的内存占用。经验上从 100~300 起步、压测对比，而不是拍脑袋设 0（0 表示无限制）。",
    },
    {
      type: "heading",
      text: "常见性能陷阱",
    },
    {
      type: "list",
      items: [
        "N+1 消息问题：一条业务事件被拆成几十条小消息（逐条发布、逐条确认），吞吐被往返次数打垮——合并发布、批量确认。",
        "同步确认一条条发：`confirm_delivery()` 后每条都等 confirm 再发下一条，RTT 完全串行化。",
        "prefetch=1：消费吞吐被每消息往返限制，尤其高 RTT 环境。",
        "大消息当道：几 MB 的 payload 直接进队列，Quorum/持久化下磁盘 IO 成为瓶颈——改用对象存储 + 引用。",
        "忽略告警：内存/磁盘水位长期贴着，发布方被反复阻塞，表现为「时快时慢」的假性能问题。",
        "Quorum 成员过多：为了高可用把成员设成 7+，共识开销吃掉吞吐——多数场景 3 成员足够。",
      ],
    },
    {
      type: "quiz",
      question: "一个消费服务处理单条消息约需 200ms，网络 RTT 很低。它使用手动 ack 且 prefetch=1，吞吐远低于预期。最可能的原因是什么？",
      options: [
        "消息队列类型是 Quorum 队列，导致消费慢",
        "prefetch=1 让每条消息的投递都要等上一轮 ack 的往返，吞吐被串行化",
        "磁盘告警在生效",
        "RabbitMQ 版本太低不支持高吞吐",
      ],
      answer: 1,
      explanation: "prefetch=1 时，消费者处理完一条、ack 之后，才会收到下一条投递；即使 RTT 很低，整个处理-确认-投递也完全串行。提高 prefetch（如 100~300）让节点一次投递多条未确认消息，消费循环就能并行处理。Quorum 队列、磁盘告警、版本高低都不是这个症状的直接原因。",
    },
    {
      type: "keypoints",
      items: [
        "吞吐上限通常在确认往返与磁盘 IO，而不是网络带宽；先找瓶颈再调参。",
        "内存水位默认 60% RAM、磁盘默认 50MiB，触达即集群级阻塞发布者；容器用绝对阈值，磁盘设保守值。",
        "瞬态流控是健康保护；频繁触发说明生产者过载或消费者跟不上。",
        "生产侧批量发布+确认、消费侧合理 prefetch（100~300 起步）是最大的两个杠杆。",
        "N+1 消息、逐条同步确认、prefetch=1、大消息、贴着告警跑、Quorum 成员过多是常见陷阱。",
      ],
    },
  ],
};
