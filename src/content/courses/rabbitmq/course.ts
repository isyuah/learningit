/* ==================================================================
 * 课程：RabbitMQ 消息队列系统学习（rabbitmq）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 *
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2；2026-08）。示例以 AMQP 0-9-1
 * 与官方文档为准，并标注 4.0 / 4.2 / 4.3 的行为差异。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "rabbitmq",
  title: "RabbitMQ 消息队列系统学习",
  tagline: "从 AMQP 心智模型到生产级可靠消息",
  description:
    "面向已经掌握至少一门编程语言与基本后端概念（HTTP、数据库、部署）的学习者，系统学习 RabbitMQ。课程以 RabbitMQ 4.x 为版本边界（主线 4.3，LTS 4.2），示例使用官方 RabbitMQ 教程与 AMQP 0-9-1 语义，并明确标注 4.0 移除镜像队列、4.2 默认启用 Khepri、4.3 默认禁止 transient 非排他经典队列等版本差异。\n\n全程围绕一套「订单系统」场景展开：从消息队列为什么存在、AMQP 模型与一次消息的完整旅程开始，依次覆盖交换机与路由、队列与消息属性、发布确认、消费确认、死信、延迟消息、RPC、流、集群与高可用、监控运维、性能与安全。最后通过一个「订单处理」综合实战，把可靠投递、幂等消费、背压、故障恢复和可观测性串成一条工程主线。",
  level: "intermediate",
  hours: 14,
  learners: 0,
  coverIndex: "09",
  coverColor: "success",
  updatedAt: "2026-09",
  outcomes: [
    "解释 Producer、Broker、Exchange、Queue、Binding、Consumer 与一次消息投递之间的关系",
    "熟练使用 RabbitMQ 4.x：交换机类型、路由键、队列属性、TTL、优先级与 x-arguments",
    "正确配置发布确认、消费手动确认、prefetch、死信与延迟消息，并理解各自的可靠性边界",
    "区分 classic / quorum / stream 三种数据结构的适用场景，并理解 4.x 的版本演进",
    "建立集群、Khepri 元数据、仲裁、镜像迁移与高可用的运维心智模型",
    "掌握监控、告警、性能诊断、安全（TLS、权限、vhost 隔离）与常见故障排查",
    "完成可上线的订单消息实战：可靠投递、幂等消费、背压与故障恢复",
  ],
  chapters: [
    {
      id: "foundation",
      title: "心智模型与核心概念",
      intro: "先理解消息队列解决什么问题，再掌握 AMQP 模型和一次消息的完整旅程。",
      lessons: [
        { slug: "rabbitmq-mental-model", title: "消息队列：为什么需要它", minutes: 24, kind: "reading" },
        { slug: "rabbitmq-amqp-model", title: "AMQP 模型：Exchange、Queue 与 Binding", minutes: 30, kind: "reading" },
        { slug: "rabbitmq-install-setup", title: "安装、启动与管理界面", minutes: 20, kind: "reading" },
        { slug: "rabbitmq-publish-consume-first", title: "第一次发布与消费", minutes: 22, kind: "reading" },
      ],
    },
    {
      id: "exchanges-routing",
      title: "交换机与路由",
      intro: "用四种交换机类型精确控制消息去向，并用绑定、路由键和主题模式组织拓扑。",
      lessons: [
        { slug: "rabbitmq-exchanges-types", title: "四种交换机类型与绑定", minutes: 28, kind: "reading" },
        { slug: "rabbitmq-routing-topologies", title: "路由键、Topic 与拓扑设计", minutes: 26, kind: "reading" },
        { slug: "rabbitmq-queue-basics", title: "队列：声明、属性与生命周期", minutes: 24, kind: "reading" },
      ],
    },
    {
      id: "reliability",
      title: "可靠投递与消费",
      intro: "发布确认、持久化、消费确认与重投递——理解每一层保障什么、不保障什么。",
      lessons: [
        { slug: "rabbitmq-publisher-confirms", title: "发布确认：消息真正到达", minutes: 30, kind: "reading" },
        { slug: "rabbitmq-consumer-acks", title: "消费确认、prefetch 与重投递", minutes: 32, kind: "reading" },
        { slug: "rabbitmq-durability-persistence", title: "持久化、镜像与消息落盘", minutes: 26, kind: "reading" },
        { slug: "rabbitmq-reliability-exercise", title: "可靠投递综合练习", minutes: 20, kind: "exercise" },
      ],
    },
    {
      id: "advanced-patterns",
      title: "高级模式与扩展",
      intro: "用死信、延迟消息、优先级、RPC 和流解决真实系统的常见消息问题。",
      lessons: [
        { slug: "rabbitmq-dead-lettering", title: "死信队列：拒绝、过期与路由失败", minutes: 28, kind: "reading" },
        { slug: "rabbitmq-delayed-messages", title: "延迟消息：TTL、DLX 与插件", minutes: 24, kind: "reading" },
        { slug: "rabbitmq-priority-other-args", title: "优先级、单活跃消费者与更多队列参数", minutes: 22, kind: "reading" },
        { slug: "rabbitmq-rpc-pattern", title: "RPC 模式：请求-应答", minutes: 20, kind: "reading" },
        { slug: "rabbitmq-streams", title: "流：另一种数据结构", minutes: 30, kind: "reading" },
      ],
    },
    {
      id: "operations",
      title: "集群、运维与生产实践",
      intro: "从单节点走向集群：元数据、仲裁、高可用、监控、安全与性能。",
      lessons: [
        { slug: "rabbitmq-clustering-basics", title: "集群、Khepri 与节点角色", minutes: 32, kind: "reading" },
        { slug: "rabbitmq-quorum-high-availability", title: "Quorum 队列、镜像迁移与高可用", minutes: 34, kind: "reading" },
        { slug: "rabbitmq-monitoring-ops", title: "监控、告警与日常运维", minutes: 26, kind: "reading" },
        { slug: "rabbitmq-security", title: "安全：权限、vhost 与 TLS", minutes: 24, kind: "reading" },
        { slug: "rabbitmq-performance-tuning", title: "性能优化与故障排查", minutes: 30, kind: "reading" },
      ],
    },
    {
      id: "capstone",
      title: "综合实战",
      intro: "用订单系统把可靠投递、幂等消费、背压、故障恢复和可观测性串成一条工程主线。",
      lessons: [
        { slug: "rabbitmq-capstone-order-service", title: "综合项目：订单处理服务", minutes: 75, kind: "exercise" },
      ],
    },
  ],
};
