/* ==================================================================
 * 课时：Quorum 队列、镜像迁移与高可用（rabbitmq-quorum-high-availability）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-quorum-high-availability",
  courseSlug: "rabbitmq",
  title: "Quorum 队列、镜像迁移与高可用",
  summary: "用 Raft 共识理解仲裁队列的数据安全与可用性边界，并掌握 4.0 移除镜像队列后的迁移路径。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一节提到：集群只复制元数据，消息内容默认不复制。于是问题来了——经典队列（classic queue）的 leader 挂掉，消息就丢了或至少不可达，单点故障依旧存在。RabbitMQ 的老解决方案是「镜像队列」（classic queue mirroring，简称 CMQ）：把队列内容复制到多个节点。但镜像机制有严重的固有缺陷：同步（sync）过程会阻塞、故障转移存在丢失窗口、脑裂恢复不可预测。4.0 起镜像队列被移除，取而代之的是两种「复制数据结构」：基于 Raft 的 Quorum 队列（仲裁队列）与 Stream。这一节把 Quorum 队列的语义、特性、迁移路径与高可用设计讲透。",
    },
    {
      type: "definition",
      term: "Quorum Queue（仲裁队列）",
      definition: "基于 Raft 共识算法的持久化复制队列。每个队列有一个 leader 与若干 follower（成员分布在不同的集群节点上），写入需多数派（quorum，即 N/2+1）确认。以数据安全为设计目标：已确认给生产者的消息，在多数派成员未永久失联的前提下不会丢失。",
    },
    {
      type: "heading",
      text: "Raft、多数派与 leader/follower",
    },
    {
      type: "paragraph",
      text: "Quorum 队列复用与 Khepri、Stream 相同的 Ra 库（Raft 实现）。每个队列是一个独立的 Raft 集群：所有状态变更（入队、出队、ack）都提交给 leader，leader 复制到 follower 并等待多数派确认。默认每个 Quorum 队列有 3 个成员，分布在 3 个不同的集群节点上；成员数量可用 `x-quorum-initial-group-size` 调整（应为奇数，且性能随成员数下降，官方不建议超过 5~7 个成员）。",
    },
    {
      type: "list",
      items: [
        "多数派决定一切：3 成员队列容忍 1 个成员失联，5 成员容忍 2 个；少于多数派时队列不可用（写操作阻塞或超时）。",
        "leader 故障：多数派一侧立即选举新 leader，未 ack 的消息会被重新投递（至少一次语义的来源之一）。",
        "已确认即安全：Publisher Confirms 只有在消息被多数派成员持久化后才发回——这是 Quorum 队列数据安全的根基。",
        "成员管理是半自动的：`rabbitmq-queues add_member` / `delete_member` / `grow` / `shrink` 显式增删；或开启连续成员调和（CMR）自动向目标组大小靠拢。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "多数派要求适用于集群中的每个 Raft 组件",
      body: "Khepri（元数据）、Quorum 队列、Stream 各自遵循「成员多数派在线」规则。这意味着一个 Quorum 队列的成员可以只落在集群的部分节点上——例如 7 节点集群里，某个队列只占 3 个节点；其它节点可以访问它，但该队列的可用性只取决于那 3 个成员。规划高可用时，既要看集群规模，也要看每个队列的成员分布。",
    },
    {
      type: "heading",
      text: "Quorum 队列的关键特性",
    },
    {
      type: "table",
      caption: "Classic 队列与 Quorum 队列对照（本课程版本边界）",
      headers: ["特性", "Classic 队列", "Quorum 队列"],
      rows: [
        ["消息复制", "无（4.0 起镜像已移除）", "有（Raft 多成员）"],
        ["持久化", "按消息 delivery mode", "始终持久化（无论 delivery mode）"],
        ["transient/排他", "支持", "不支持（必须 durable；不可 exclusive）"],
        ["毒消息处理", "无", "有（x-delivery-limit，默认 20）"],
        ["消费者超时", "无（4.3 起不再评估）", "有（consumer_timeout）"],
        ["全局 QoS（global QoS）", "支持", "不支持（用按信道的 QoS）"],
        ["死信策略", "at-most-once", "可配 at-least-once（需 overflow=reject-publish）"],
        ["内存占用", "消息可在内存", "永不在内存中保留消息本体（WAL+segment 落盘）"],
      ],
    },
    {
      type: "paragraph",
      text: "有几个特性值得单独强调，因为它们直接影响应用写法。第一，「始终持久化」：消息一旦被确认，就写在磁盘（WAL 与 segment 文件）上，与消息自带的 delivery mode 无关；但被死信转发的消息会保留原始 delivery mode——若希望死信目标队列里也持久，源消息发布时仍应设置 persistent。第二，「消费者超时」：Quorum 队列可以配置 unack 超时（如 `consumer_timeout = 1800000`），超时后消息被重新投递，防止消费者卡死后消息被永久占住。",
    },
    {
      type: "heading",
      text: "毒消息处理与死信：at-least-once 的代价",
    },
    {
      type: "paragraph",
      text: "一个消息被反复处理失败、不断 requeue，会形成「deliver-requeue 循环」，拖垮队列。RabbitMQ 4.0 起 Quorum 队列内置默认投递上限：`x-delivery-limit` 默认为 20，超过后消息被丢弃或（配置了 DLX 时）进入死信。注意 4.3 的语义细节：基于 `delivery-count` 而非 `acquired-count`——通过 `basic.reject`/`basic.nack(requeue=true)` 或信道关闭导致的真正重投才会计数；应用主动 requeue 用于「先别处理」的路由逻辑不计数。",
    },
    {
      type: "code",
      title: "声明带毒消息保护与死信的 Quorum 队列（Python/pika）",
      language: "python",
      code: `import pika

params = pika.ConnectionParameters("localhost")
conn = pika.BlockingConnection(params)
ch = conn.channel()

# Quorum 队列：x-queue-type=quorum（必须声明时指定，不能用策略改）
# x-delivery-limit：投递 5 次仍失败则死信（默认 20）
# dead-letter-exchange：配合 at-least-once 死信策略（见下方策略）
ch.queue_declare(
    queue="orders.created",
    durable=True,
    arguments={
        "x-queue-type": "quorum",
        "x-delivery-limit": 5,
    },
)

conn.close()`,
    },
    {
      type: "paragraph",
      text: "死信本身的语义也需要理解。默认死信策略是 at-most-once：消息从源队列移到 DLX 目标队列的过程中可能丢失（例如目标队列不可用）。Quorum 队列支持更强的 at-least-once 死信：通过策略设置 `dead-letter-strategy=at-least-once` 与 `overflow=reject-publish`，源队列内部会起一个「死信消费者」，先发布到目标队列、收到发布确认后才从源队列删除。代价是更高的内存与 CPU 占用，且死信消息在源队列仍占用配额；一旦目标队列长期不可达，源队列可能堆积满。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "at-least-once 死信的三个前置条件",
      body: "要启用 at-least-once 死信：(1) 策略里设 `dead-letter-strategy=at-least-once`；(2) overflow 必须是 `reject-publish`（`drop-head` 会悄悄回退到 at-most-once）；(3) 启用 `stream_queue` feature flag。另外，死信消费者每队列一个、常驻在 leader 节点，会保留未确认死信消息体在内存中，且有 32 条的内置 prefetch。对死信吞吐要求高的场景才调 `dead_letter_worker_consumer_prefetch`。",
    },
    {
      type: "heading",
      text: "4.0 移除镜像队列后的迁移路径",
    },
    {
      type: "paragraph",
      text: "经典队列镜像（CMQ）在 2021 年废弃、2024 年随 4.0 移除。还在 3.13 上跑镜像队列的团队，官方推荐的迁移路径是蓝绿部署（Blue-Green）：部署一个新版集群（使用 Quorum 队列或 Stream），同步元数据，切消费者、排空消息、切生产者，最后下线旧集群。`rabbitmqadmin` v2 提供自动化的迁移命令，并且导出 definitions 时可以用转换器剥离 CMQ 相关的策略键（如 `ha-mode`）。",
    },
    {
      type: "list",
      items: [
        "导出旧集群 definitions：`rabbitmqadmin definitions export --transformations strip_cmq_keys_from_policies,drop_empty_policies`，把 ha-mode 等镜像策略键从导出文件里清掉。",
        "在新集群用 Quorum 队列重建拓扑：声明队列时指定 `x-queue-type=quorum`（或把 vhost/节点级默认队列类型 DQT 配成 quorum）。",
        "用蓝绿或 Shovel 迁移存量消息：切换消费者到新集群并确认追平后，再切换生产者。",
        "验证：用 `rabbitmq-queues quorum_status <queue>` 查看成员与 leader，确认复制符合预期。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "迁移不是「把 x-queue-type 改掉」就完事",
      body: "Quorum 队列不支持 transient、exclusive、global QoS、每消息 TTL 之外的某些参数（如 `x-max-priority` 之外的旧行为）。迁移前先对照特性矩阵检查应用：声明代码里的参数、消费者用的 QoS、死信策略都需要同步调整。官方还提供 `quorum_queue.property_equivalence.relaxed_checks_on_redeclaration` 配置，用于放宽应用重声明时的 x-queue-type 等价检查，给迁移留缓冲。",
    },
    {
      type: "heading",
      text: "高可用设计：Quorum+Streams 还是经典单点",
    },
    {
      type: "paragraph",
      text: "高可用不是「把队列都设成 Quorum」这么简单。设计决策应该是：数据安全与可用性由谁承担、延迟与吞吐的预算多少。Quorum 队列适合长期存在、对消息丢失敏感的核心业务队列（订单、支付、投票）；它们以牺牲延迟换取数据安全，且磁盘 IO 密集——消息越大吞吐越低，需要 SSD 并预留充裕磁盘（日志 compaction 需要后台处理）。Stream 适合需要复制 + 可重复读/大积压的场景（如 fan-out 通知、审计）。而临时队列、高 churn（频繁建删）的队列、RPC 应答队列则完全不适合 Quorum——它们更适合经典队列，或干脆用 Stream。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "Quorum 队列不是「零成本高可用」",
      body: "每个 Quorum 队列至少占用每 3 万条消息约 1 MiB 的内存索引（与消息大小无关），WAL 默认上限 512 MiB、内存占用建议按 WAL 上限的 3~4 倍预留；成员数越多吞吐越低（5 节点以上性能明显衰减）。如果为了「稳妥」把几千个临时队列都建成 5 成员 Quorum，代价会远超收益。官方建议：超过约 5000 个 Quorum 队列时重新审视拓扑。高可用是设计权衡，不是默认选项。",
    },
    {
      type: "quiz",
      question: "3 节点集群上有一个 3 成员的 Quorum 队列，其中 2 个节点同时故障。关于该队列的说法哪个正确？",
      options: [
        "队列仍可正常读写，因为还有 1 个成员在线",
        "队列不可用，直到至少 2 个成员重新在线（恢复多数派）；未确认给生产者的消息可能丢失",
        "leader 会自动切换到剩下的节点继续服务",
        "队列自动变为经典队列继续工作",
      ],
      answer: 1,
      explanation: "Quorum 队列需要多数派（3 成员中至少 2 个）在线才能工作。只剩 1 个成员时写操作无法达成共识，队列不可用，直到多数派恢复。只有已确认给生产者的消息才保证安全；未确认（in-flight）的消息可能丢失。",
    },
    {
      type: "keypoints",
      items: [
        "Quorum 队列基于 Raft：leader 写入、多数派确认；数据安全优先于可用性。",
        "始终持久化、无 transient/排他；支持毒消息保护（x-delivery-limit 默认 20）、消费者超时与 at-least-once 死信。",
        "镜像队列 4.0 已移除；迁移用蓝绿部署 + 清掉 ha-mode 策略键 + 重建为 Quorum/Stream。",
        "高可用设计是权衡：核心业务队列用 Quorum，临时/高 churn/RPC 用经典或 Stream；控制成员数与队列数量。",
        "维护前检查多数派：`rabbitmq-queues quorum_status`、`check_if_node_is_quorum_critical`。",
      ],
    },
  ],
};
