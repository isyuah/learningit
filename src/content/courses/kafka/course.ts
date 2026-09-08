/* ==================================================================
 * 课程：Kafka 系统学习（kafka）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 *
 * 版本边界：Apache Kafka 4.x（主线 4.3.1，2026-09；KRaft-only，ZooKeeper 已于
 * 4.0 移除）。Go 示例以 franz-go v1.21.x（pkg/kgo）为准；Kafka Streams 无 Go
 * 官方库，其机制讲解使用 Java DSL 片段并显著标注“示意”。
 *
 * 总计划/知识模型/事实表：local/kafka-course-plan.md（唯一权威计划工件）。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "kafka",
  title: "Kafka 系统学习",
  tagline: "从提交日志心智模型到事件流平台工程",
  description:
    "面向已经掌握至少一门编程语言（本课程示例使用 Go）与基本后端概念（HTTP、数据库、并发、部署）、但还没有消息队列经验的学习者，系统学习 Apache Kafka。课程以 Kafka 4.x 为版本边界（主线 4.3，纯 KRaft 模式），代码示例使用 franz-go v1.21.x，并明确标注 4.x 的版本行为与弃用路线。\n\n全程围绕一套「书舟书店」订单与用户事件平台场景展开：从事件流为什么存在、提交日志心智模型与一次消息的完整旅程开始，依次覆盖主题/分区/存储、生产者、消费者与消费组（含 KIP-848 新组协议）、可靠性与事务、事件建模与 Schema Registry、Kafka Connect、Kafka Streams 与 ksqlDB 流处理、KRaft 集群运维与安全，最后通过一个 Go 订单事件管道实战收尾，并附一个独立的「面试速查」章节用于复习与查漏补缺。",
  level: "intermediate",
  hours: 20,
  learners: 0,
  coverIndex: "18",
  coverColor: "danger",
  updatedAt: "2026-09",
  outcomes: [
    "解释 Kafka 的定位与核心心智模型：Broker、Topic、Partition、Offset、副本、消费组与一次消息的完整旅程",
    "在本地运行 Kafka 4.x（KRaft）并用 CLI 管理主题、消息与消费组",
    "用 franz-go 写出正确的生产/消费代码：分区键、批量、确认、重试、幂等与背压",
    "理解消费组协调与两种再平衡协议（classic / KIP-848），以及 4.x 的演进与弃用方向",
    "建立可靠性与端到端语义的精确心智：acks、副本、提交时机、幂等与事务各自保障什么、不保障什么",
    "掌握事件建模与 Schema 演进，能设计并实现事务性 Outbox、CDC 等事件集成模式",
    "理解 Kafka Connect 与 Debezium CDC 的架构、适用边界与运维要点",
    "掌握流处理范式、Kafka Streams 的拓扑/状态/窗口模型，并能做流引擎选型",
    "会部署与运维 KRaft 集群：关键指标、消费滞后、容量、安全（TLS/SASL/ACL）与故障排查",
    "完成一个可上线的 Go 事件管道实战，并能把整门课的知识用于系统设计与面试表达",
  ],
  chapters: [
    {
      id: "foundation",
      title: "心智模型与起步",
      intro: "从零建立事件流视角：为什么需要它、核心概念如何协作，并在本地把第一个消息跑起来。",
      lessons: [
        { slug: "kafka-why-event-streaming", title: "为什么需要事件流平台", minutes: 26, kind: "reading" },
        { slug: "kafka-core-model", title: "核心心智模型：一次消息的旅程", minutes: 34, kind: "reading" },
        { slug: "kafka-kraft-quickstart", title: "本地运行 Kafka 4.3（KRaft）与 CLI 初体验", minutes: 30, kind: "reading" },
        { slug: "kafka-go-client-hello", title: "franz-go 初体验：第一个 Go 生产者与消费者", minutes: 32, kind: "reading" },
      ],
    },
    {
      id: "topics-storage",
      title: "主题、分区与存储",
      intro: "数据如何组织与持久：分区是并行与顺序的边界，Segment 与保留策略决定存储行为，副本与 ISR 决定数据安全。",
      lessons: [
        { slug: "kafka-topics-partitions-keys", title: "主题、分区与键：并行与顺序的边界", minutes: 34, kind: "reading" },
        { slug: "kafka-storage-segments-retention", title: "存储：Segment、保留策略与日志压缩", minutes: 32, kind: "reading" },
        { slug: "kafka-replication-isr", title: "副本、ISR 与数据安全", minutes: 36, kind: "reading" },
      ],
    },
    {
      id: "producer",
      title: "生产者",
      intro: "把消息可靠高效地送进去：发送路径、批量与压缩、acks 与幂等。",
      lessons: [
        { slug: "kafka-producer-send-path", title: "生产者发送路径与 Record", minutes: 30, kind: "reading" },
        { slug: "kafka-producer-batching-throughput", title: "批量、压缩与吞吐调优", minutes: 32, kind: "reading" },
        { slug: "kafka-producer-reliability-acks", title: "可靠发布：acks、重试与幂等生产者", minutes: 36, kind: "reading" },
      ],
    },
    {
      id: "consumer",
      title: "消费者与消费组",
      intro: "正确地读：拉取模型与提交时机、消费组协调，以及经典与新两代再平衡协议。",
      lessons: [
        { slug: "kafka-consumer-poll-commit", title: "拉取模型、位置管理与提交时机", minutes: 34, kind: "reading" },
        { slug: "kafka-consumer-groups-classic", title: "消费组与经典再平衡协议", minutes: 36, kind: "reading" },
        { slug: "kafka-consumer-group-protocol-848", title: "KIP-848 新组协议与 4.x 演进方向", minutes: 28, kind: "reading" },
      ],
    },
    {
      id: "reliability",
      title: "可靠性、事务与失败模式",
      intro: "端到端不丢不重：投递语义的组合拳、事务与精确一次，以及消费失败的工程化处理。",
      lessons: [
        { slug: "kafka-delivery-semantics", title: "投递语义：从 at-most-once 到 exactly-once", minutes: 32, kind: "reading" },
        { slug: "kafka-transactions-go", title: "事务与精确一次（Go / franz-go）", minutes: 36, kind: "reading" },
        { slug: "kafka-failure-patterns-dlq", title: "消费失败、重试、死信与幂等消费", minutes: 34, kind: "reading" },
      ],
    },
    {
      id: "events-schema",
      title: "事件建模与 Schema",
      intro: "契约先行：事件如何命名与演进、用 Schema Registry 管理契约，以及 Outbox、CDC 与事件溯源等集成模式。",
      lessons: [
        { slug: "kafka-event-modeling", title: "事件建模与兼容性思维", minutes: 34, kind: "reading" },
        { slug: "kafka-schema-registry-go", title: "Schema Registry 实战（Go / pkg/sr）", minutes: 34, kind: "reading" },
        { slug: "kafka-outbox-cdc-es", title: "事务性 Outbox、CDC 与事件溯源", minutes: 34, kind: "reading" },
      ],
    },
    {
      id: "connect",
      title: "Kafka Connect",
      intro: "把系统接进、接出 Kafka：Connect 架构与第一个连接器，以及用 Debezium 做数据库 CDC。",
      lessons: [
        { slug: "kafka-connect-architecture", title: "Connect 架构与第一个连接器", minutes: 32, kind: "reading" },
        { slug: "kafka-connect-cdc-practice", title: "Debezium CDC：数据库变更变成事件", minutes: 30, kind: "reading" },
      ],
    },
    {
      id: "streams",
      title: "流处理与 Kafka Streams",
      intro: "生态深入：流处理心智模型与引擎选型、Kafka Streams 的拓扑/状态/窗口，以及 ksqlDB。",
      lessons: [
        { slug: "kafka-streaming-model", title: "流处理心智模型与引擎选型", minutes: 30, kind: "reading" },
        { slug: "kafka-streams-dsl-topology", title: "拓扑、KStream/KTable、状态与窗口（Java DSL 示意）", minutes: 36, kind: "reading" },
        { slug: "kafka-ksqldb-streaming-sql", title: "ksqlDB：用 SQL 做流处理", minutes: 30, kind: "reading" },
      ],
    },
    {
      id: "ops",
      title: "集群、安全与运维",
      intro: "让它长期稳定运行：KRaft 集群部署、观测与滞后、容量与调优、安全、以及症状驱动的排障。",
      lessons: [
        { slug: "kafka-kraft-cluster-deploy", title: "KRaft 集群：架构、部署与升级", minutes: 36, kind: "reading" },
        { slug: "kafka-monitoring-lag", title: "观测：指标、日志与消费滞后", minutes: 34, kind: "reading" },
        { slug: "kafka-capacity-tuning", title: "容量规划与性能调优", minutes: 32, kind: "reading" },
        { slug: "kafka-security", title: "安全：TLS、认证、授权与配额", minutes: 34, kind: "reading" },
        { slug: "kafka-troubleshooting", title: "排障手册：症状 → 诊断 → 处置", minutes: 32, kind: "reading" },
      ],
    },
    {
      id: "capstone",
      title: "综合实战",
      intro: "把整门课串成一条工程主线：先做一个可上线的订单事件管道，再逐条复盘架构决策。",
      lessons: [
        { slug: "kafka-capstone-order-pipeline", title: "综合项目：订单事件管道（Go）", minutes: 90, kind: "exercise" },
        { slug: "kafka-capstone-review", title: "项目复盘：架构决策与评审清单", minutes: 30, kind: "reading" },
      ],
    },
    {
      id: "interview",
      title: "面试速查与总复习",
      intro: "额外附赠：按主题组织的高频问答与回答框架，外加一个覆盖全课程的最终测验。",
      lessons: [
        { slug: "kafka-interview-core", title: "面试速查：核心机制问答", minutes: 34, kind: "reading" },
        { slug: "kafka-interview-reliability", title: "面试速查：可靠性语义问答", minutes: 30, kind: "reading" },
        { slug: "kafka-interview-architecture", title: "面试速查：集群、运维与系统设计题", minutes: 30, kind: "reading" },
        { slug: "kafka-final-checkpoint", title: "总复习测验", minutes: 30, kind: "quiz" },
      ],
    },
  ],
};
