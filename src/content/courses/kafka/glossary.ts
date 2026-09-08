/* ==================================================================
 * 课程术语表：Kafka 系统学习（kafka）
 * ----------------------------------------------------------------
 * 词条列表已在总计划 local/kafka-course-plan.md 第 5 节冻结。
 * 课时作者只能引用下列 key；确需新增时向 Integrator 申请。
 * 类型见 ../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { GlossaryEntry } from "../../types";

export const glossary: GlossaryEntry[] = [
  {
    key: "commit-log",
    term: "提交日志（commit log）",
    summary: "只追加（append-only）、按顺序编号的记录序列。Kafka 的主题本质上就是分布式提交日志：消息落盘后按偏移量可回放，消费不会删除数据。",
  },
  {
    key: "topic",
    term: "主题（topic）",
    summary: "Kafka 中消息的分类容器。一个主题被划分为若干分区；生产者向主题写入，消费者从主题读取。",
  },
  {
    key: "partition",
    term: "分区（partition）",
    summary: "主题内的并行与顺序单位：分区内消息有序，分区之间没有全局顺序；相同 key 的消息总是进入同一分区。",
  },
  {
    key: "offset",
    term: "偏移量（offset）",
    summary: "分区内每条消息的唯一递增序号。消费者用它记录“读到了哪”，也是回放（seek）的游标。",
  },
  {
    key: "broker",
    term: "Broker",
    summary: "一台运行 Kafka 服务端的节点，负责存储分区数据并服务客户端的读写请求；多个 broker 组成集群。",
  },
  {
    key: "controller",
    term: "控制器（controller）",
    summary: "集群中负责处理元数据变更（主题创建、分区分配、副本状态）的角色；KRaft 模式下由投票 quorum 中选出的节点担任。",
  },
  {
    key: "kraft",
    term: "KRaft",
    summary: "Kafka 的集群元数据管理模式：用内部元数据日志与投票 quorum 代替 ZooKeeper。Kafka 4.0 起是唯一模式。",
  },
  {
    key: "replica",
    term: "副本（replica）",
    summary: "同一分区的多份拷贝，分别存放在不同 broker 上，用于容错；其中一个是 leader，其余为 follower。",
  },
  {
    key: "isr",
    term: "ISR（In-Sync Replicas）",
    summary: "与 leader 保持同步的副本集合。只有 ISR 中的副本才能接任 leader；acks=all 时写入要等 ISR 全部确认。",
  },
  {
    key: "min-insync",
    term: "min.insync.replicas",
    summary: "broker 配置：当 ISR 数量低于该值时，acks=all 的写入会被拒绝。它是“宁可让写入失败，也不悄悄丢已确认数据”的保险丝。",
  },
  {
    key: "unclean-election",
    term: "unclean leader election",
    summary: "允许不在 ISR 中的副本接任 leader 的开关。开启可保住可用性，但可能丢失“已确认”过的消息。",
  },
  {
    key: "leader-election",
    term: "首领选举（leader election）",
    summary: "分区 leader 副本失效后，从 ISR 中选出新 leader 的过程；选举期间该分区暂时不可写。",
  },
  {
    key: "acks",
    term: "确认级别（acks）",
    summary: "生产者配置，决定写入成功如何判定：acks=0 不等确认、acks=1 等 leader 落盘、acks=all 等 ISR 全部落盘。它精确决定“写失败时可能丢多少”。",
  },
  {
    key: "idempotent-producer",
    term: "幂等生产者（idempotent producer）",
    summary: "生产者通过 PID + 序列号为消息去重，使网络重试不会在 broker 上产生重复记录；是实现 exactly-once 的第一块基石。",
  },
  {
    key: "consumer-group",
    term: "消费组（consumer group）",
    summary: "一组共享订阅关系的消费者。主题的每个分区在同一时刻只分配给组内一个成员；组内成员共同承担全部分区，可水平扩展。",
  },
  {
    key: "rebalance",
    term: "再平衡（rebalance）",
    summary: "消费组成员变化或订阅变化时，协调器重新分配分区所有权的流程；再平衡期间成员会经历状态变化，处理不当会造成重复消费或停顿。",
  },
  {
    key: "coordinator",
    term: "组协调器（group coordinator）",
    summary: "broker 上负责维护消费组成员关系、接收 offset 提交、触发再平衡的组件；每个消费组由某个 broker 承担协调职责。",
  },
  {
    key: "lag",
    term: "消费滞后（lag）",
    summary: "分区最新消息的偏移量与消费者已提交偏移量之差。lag 持续增长说明消费跟不上生产，是积压的核心信号。",
  },
  {
    key: "delivery-semantics",
    term: "投递语义（delivery semantics）",
    summary: "对消息从生产到消费全链路“丢/重”程度的划分：at-most-once（可能丢不重复）、at-least-once（不丢但可能重）、exactly-once（不丢不重）。",
  },
  {
    key: "compaction",
    term: "日志压缩（log compaction）",
    summary: "一种按 key 的保留策略：只保留每个 key 的最新值并清理旧值，适合保存“当前状态”（如用户画像），不适合保存事件流。",
  },
  {
    key: "retention",
    term: "保留策略（retention）",
    summary: "主题数据保存多久或多大的策略（按时间/大小删除，或按 key 压缩）；清理按 segment 粒度生效，因此删除有延迟。",
  },
  {
    key: "transaction",
    term: "事务（transaction）",
    summary: "让一批跨分区的写入（以及“读-处理-写”）要么全部可见、要么全部不可见的机制；配合幂等生产者与 read_committed 消费实现端到端精确一次。",
  },
  {
    key: "outbox",
    term: "发件箱模式（outbox pattern）",
    summary: "在同一数据库事务里写业务数据与待发事件，再由独立 relay 把事件发布到消息系统，避免“业务库与消息系统双写不一致”的集成模式。",
  },
  {
    key: "cdc",
    term: "CDC（变更数据捕获）",
    summary: "通过读取数据库事务/复制日志来捕获数据变更并发布为事件流的技术（如 Debezium），与业务代码解耦，但事件是“数据状态变更”而非“领域事件”。",
  },
  {
    key: "schema-registry",
    term: "Schema Registry",
    summary: "集中管理消息 Schema、按规则校验兼容性、并通过 schema id 分发 Schema 的服务，让生产方与消费方的契约可以安全演进。",
  },
  {
    key: "dead-letter",
    term: "死信（dead letter）",
    summary: "多次重试仍无法处理的消息被投递到的专门主题（如 dlq.orders.events）。Kafka 核心没有内置死信机制，死信是客户端侧实现的模式。",
  },
  {
    key: "kafka-streams",
    term: "Kafka Streams",
    summary: "Apache Kafka 官方的流处理库（JVM，Java/Scala）：在应用进程内构建有状态、无界数据的处理拓扑，自动处理容错与扩展。没有 Go 官方版本。",
  },
  {
    key: "ksqldb",
    term: "ksqlDB",
    summary: "基于 Kafka Streams 的独立流处理服务，提供类 SQL 接口定义流/表与持续查询；适合用 SQL 而非代码表达流逻辑的团队。",
  },
  {
    key: "topology",
    term: "拓扑（topology）",
    summary: "流处理应用的处理图：源节点（source）→ 处理器 → 状态存储 → 汇节点（sink）。Kafka Streams 按拓扑执行，并通过备份实现容错。",
  },
  {
    key: "window",
    term: "窗口（window）",
    summary: "把无界事件流按时间切成有界片段再做聚合的单位，常见有滚动（tumbling）、跳跃（hopping）、滑动（sliding）与会话（session）窗口。",
  },
  {
    key: "connect",
    term: "Kafka Connect",
    summary: "Apache Kafka 官方的数据集成框架：通过连接器（connector）把外部系统（数据库、文件、对象存储等）接进或接出 Kafka，负责缩放、容错与 offset 管理。",
  },
  {
    key: "share-group",
    term: "Share 组（share group）",
    summary: "Kafka 4.x（KIP-932 “Queues for Kafka”）引入的消息分发模型：组内消息可被任一成员领取并按需确认，接近“队列”的工作分发语义。本课程写作时处于 preview。",
  },
  {
    key: "exactly-once",
    term: "精确一次（exactly-once）",
    summary: "端到端不丢不重。在 Kafka 内部 = 幂等生产者 + 事务 + read_committed 消费；跨出 Kafka 到外部系统时，只能做到“有效一次”（配合幂等键或 Outbox）。",
  },
  {
    key: "serializer",
    term: "序列化器（serializer / serde）",
    summary: "客户端把业务对象编码成字节的组件（生产时序列化、消费时反序列化）。配合 Schema Registry 时，字节负载会携带 schema id 以便解码与校验。",
  },
];
