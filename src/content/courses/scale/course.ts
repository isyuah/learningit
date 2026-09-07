/* ==================================================================
 * 课程：后端扩展与高吞吐系统学习（scale）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 *
 * 课程计划（章节职责、课时责任、术语表、写作契约）：local/scale-course-plan.md
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "scale",
  title: "后端扩展与高吞吐系统学习",
  tagline: "按问题类别建立性能与扩展的知识体系",
  description:
    "面向有后端开发经验、想系统理解「性能与吞吐」问题的学习者。课程不按工具讲，而是按问题讲：把后端追求性能与吞吐时遇到的全部问题归纳为九大类——性能分析框架、请求路径与 IO、缓存、异步化、数据库扩展、服务化、流量治理、分布式一致性、综合设计。每一类都回答四个问题：**背景/为什么会这样、解决思路有哪些、每种方案具体怎么做、权衡与失败模式是什么**，并配真实例子。\n\n全程围绕一个 Go 编写的「闪购」大促秒杀后端展开：从单机到多机的每一步压力、每一次架构选择都有据可循。MySQL、Redis、Kafka/RabbitMQ、Nginx 等主流中间件以「决策与取舍」的视角出现，而不是操作手册——库内原理请参见本平台的 MySQL、RabbitMQ 等课程，本课负责把它们放进同一条性能主线上。\n\n内容与篇幅由问题本身的深度决定，无课时数预设。每章末尾有回顾课；最后一章是一次完整的「闪购系统设计」综合实战，把全课程串成可复述、可答辩的知识体系，同时适合系统设计面试准备。",
  level: "intermediate",
  hours: 25,
  learners: 0,
  coverIndex: "14",
  coverColor: "danger",
  updatedAt: "2026-09",
  outcomes: [
    "用「请求路径 + 资源瓶颈」框架分析任何后端性能问题：先测量、再定位、后优化",
    "理解从单机到分布式的每一步：垂直/水平扩容、无状态化、容量估算与扩展性边界",
    "讲透请求路径上的开销：网络栈、并发模型、连接池、序列化，知道快从哪里来",
    "系统掌握缓存：命中率、Cache-Aside、穿透/击穿/雪崩的机制与防线、热点与惊群、多级缓存设计",
    "系统掌握异步化：削峰解耦的本质、消息可靠性与幂等消费、背压、事务性 Outbox、最终一致与补偿",
    "理解数据库扩展路线：读写分离、分片、迁移扩容、存储选型，以及每种方案的一致性代价",
    "掌握服务化与流量治理：无状态设计、网关、服务发现、限流/熔断/降级/过载保护的机制与参数",
    "掌握扩展后的正确性：并发控制、幂等、跨库事务方案谱系与选择地图、一致性级别决策",
    "能独立完成一次「大促秒杀」级别的容量估算与系统设计，并用清晰的权衡表述答辩",
  ],
  chapters: [
    {
      id: "foundation",
      title: "高性能全景：问题分类与思维框架",
      intro: "建立「请求路径 + 资源瓶颈」心智模型，学会先测量再优化，并得到贯穿全课程的九类问题地图。",
      lessons: [
        { slug: "sc-perf-mental-model", title: "性能的本质：请求路径、资源与权衡", minutes: 28, kind: "reading" },
        { slug: "sc-bottleneck-theory", title: "瓶颈与排队：从单机到分布式的分析框架", minutes: 32, kind: "reading" },
        { slug: "sc-capacity-planning", title: "容量估算与规划：从经验到公式", minutes: 26, kind: "reading" },
        { slug: "sc-vertical-vs-horizontal", title: "垂直与水平扩容：什么时候有效", minutes: 24, kind: "reading" },
        { slug: "sc-perf-review", title: "阶段回顾：性能问题全景与自查地图", minutes: 12, kind: "reading" },
      ],
    },
    {
      id: "request-path",
      title: "请求路径与 IO：第一公里的性能",
      intro: "一次请求从进来到返回，钱花在哪里？把「快」建立在正确的 IO 与并发模型上。",
      lessons: [
        { slug: "sc-io-stack", title: "一次请求的旅程：网络栈、Socket 与内核开销", minutes: 30, kind: "reading" },
        { slug: "sc-concurrency-models", title: "并发模型：线程、事件循环与协程", minutes: 34, kind: "reading" },
        { slug: "sc-conn-pooling", title: "连接与线程池：池化为什么是性能基石", minutes: 30, kind: "reading" },
        { slug: "sc-sync-async-boundary", title: "同步与异步的边界：何时必须异步", minutes: 28, kind: "reading" },
        { slug: "sc-serialization-io", title: "序列化与 IO 开销：容易被忽略的固定成本", minutes: 24, kind: "reading" },
        { slug: "sc-request-path-review", title: "阶段回顾：请求路径优化清单", minutes: 12, kind: "reading" },
      ],
    },
    {
      id: "cache",
      title: "缓存：读多写少的第一加速器",
      intro: "缓存放在请求路径的哪个位置、解决什么问题、每种失效模式怎么发生与怎么防。",
      lessons: [
        { slug: "sc-cache-mental-model", title: "缓存的心智模型与命中率", minutes: 30, kind: "reading" },
        { slug: "sc-cache-aside-patterns", title: "Cache-Aside 与常见读写模式", minutes: 30, kind: "reading" },
        { slug: "sc-cache-penetration-avalanche", title: "穿透、击穿、雪崩：三种故障的机制与防线", minutes: 36, kind: "reading" },
        { slug: "sc-hotkey-stampede", title: "热点与惊群：单 key 放大问题", minutes: 32, kind: "reading" },
        { slug: "sc-redis-usage", title: "缓存一致性、分布式锁与计数器", minutes: 34, kind: "reading" },
        { slug: "sc-cache-layer-design", title: "多级缓存与整体设计", minutes: 30, kind: "reading" },
        { slug: "sc-cache-review", title: "阶段回顾：缓存决策树与排障流", minutes: 12, kind: "reading" },
      ],
    },
    {
      id: "async",
      title: "异步化与消息：削峰、解耦与最终一致",
      intro: "请求路径之外的第二条路：把峰值摊平、把耦合切开，换来的是最终一致与消息生命周期管理。",
      lessons: [
        { slug: "sc-async-mental-model", title: "异步化的本质：为什么能削峰与解耦", minutes: 28, kind: "reading" },
        { slug: "sc-queue-reliability", title: "消息可靠性：不丢、不重、不乱", minutes: 36, kind: "reading" },
        { slug: "sc-backpressure", title: "背压与消费能力：削峰的正确姿势", minutes: 30, kind: "reading" },
        { slug: "sc-event-vs-command", title: "事件与命令：消息的两种语义", minutes: 26, kind: "reading" },
        { slug: "sc-async-consistency", title: "最终一致性与补偿", minutes: 32, kind: "reading" },
        { slug: "sc-queue-vs-other", title: "消息之外的异步：任务队列、事件流与选择地图", minutes: 30, kind: "reading" },
        { slug: "sc-async-review", title: "阶段回顾：异步化决策清单", minutes: 12, kind: "reading" },
      ],
    },
    {
      id: "database",
      title: "数据库扩展：读写分离、分片与存储选型",
      intro: "请求最终要落库。库的扩展决定整条链的上限——从索引与缓冲已优化后的下一步讲起，库内原理引用 MySQL 课程。",
      lessons: [
        { slug: "sc-db-scale-bottleneck", title: "数据库为什么先成为瓶颈", minutes: 26, kind: "reading" },
        { slug: "sc-read-scaling", title: "读写分离：扩展读的经典第一招", minutes: 32, kind: "reading" },
        { slug: "sc-sharding-intro", title: "数据分片：为什么必须分、按什么分", minutes: 36, kind: "reading" },
        { slug: "sc-sharding-ops", title: "分库分表工程：迁移、扩容与中间件", minutes: 36, kind: "reading" },
        { slug: "sc-db-cache-architecture", title: "存储选型地图：MySQL、Redis、ES 与对象存储的职责", minutes: 30, kind: "reading" },
        { slug: "sc-db-review", title: "阶段回顾：数据库扩展决策树", minutes: 12, kind: "reading" },
      ],
    },
    {
      id: "service",
      title: "服务化与无状态：从单体到可水平扩展的服务",
      intro: "把「能水平扩」变成工程事实：无状态化、会话外置、服务拆分、网关与东西向流量。",
      lessons: [
        { slug: "sc-stateless-design", title: "无状态设计：水平扩容的前提", minutes: 32, kind: "reading" },
        { slug: "sc-session-scaling", title: "会话与登录态：让用户状态可扩展", minutes: 28, kind: "reading" },
        { slug: "sc-service-splitting", title: "服务拆分：微服务的动机与代价", minutes: 36, kind: "reading" },
        { slug: "sc-gateway-edge", title: "网关与南北流量：统一入口做什么", minutes: 30, kind: "reading" },
        { slug: "sc-service-discovery-rpc", title: "服务发现与调用：东西向流量的正确姿势", minutes: 34, kind: "reading" },
        { slug: "sc-service-review", title: "阶段回顾：服务化改造清单", minutes: 12, kind: "reading" },
      ],
    },
    {
      id: "traffic",
      title: "流量治理：限流、熔断、降级与容量保护",
      intro: "在容量不变的前提下，用控制面保证可用性：限制进入、隔离故障、保护核心。",
      lessons: [
        { slug: "sc-traffic-mental-model", title: "流量治理的目的：为什么容量够还会挂", minutes: 28, kind: "reading" },
        { slug: "sc-rate-limiting", title: "限流：算法与放置位置", minutes: 36, kind: "reading" },
        { slug: "sc-circuit-breaker", title: "熔断与超时：失败隔离", minutes: 32, kind: "reading" },
        { slug: "sc-degradation-fallback", title: "降级与兜底：核心路径保护", minutes: 30, kind: "reading" },
        { slug: "sc-load-shedding", title: "过载保护：压垮系统的最后一根稻草", minutes: 26, kind: "reading" },
        { slug: "sc-traffic-review", title: "阶段回顾：流量治理决策清单", minutes: 12, kind: "reading" },
      ],
    },
    {
      id: "correctness",
      title: "扩展后的一致性：并发、幂等与分布式事务",
      intro: "扩容把单机事务拆成多份。正确性问题的根源，以及可落地的防线。",
      lessons: [
        { slug: "sc-concurrency-single", title: "单机并发正确性：锁、原子与事务边界", minutes: 32, kind: "reading" },
        { slug: "sc-idempotency", title: "幂等：分布式写的第一原则", minutes: 36, kind: "reading" },
        { slug: "sc-distributed-transaction", title: "跨库事务的现实：2PC、TCC、Saga 与消息事务", minutes: 40, kind: "reading" },
        { slug: "sc-consistency-levels", title: "一致性级别：从强一致到最终一致", minutes: 32, kind: "reading" },
        { slug: "sc-idempotency-exercise", title: "设计练习：秒杀下单的库存扣减", minutes: 40, kind: "reading" },
        { slug: "sc-correctness-review", title: "阶段回顾：正确性检查表", minutes: 12, kind: "reading" },
      ],
    },
    {
      id: "capstone",
      title: "综合设计：闪购系统的扩展与高吞吐设计",
      intro: "把全书知识串成一次完整的系统设计：从需求、容量推导到可答辩的架构与关键链路。",
      lessons: [
        { slug: "sc-capstone-requirements", title: "需求与规模：一次真实的容量推导", minutes: 34, kind: "reading" },
        { slug: "sc-capstone-architecture", title: "架构总览：从请求到存储的完整链路", minutes: 40, kind: "reading" },
        { slug: "sc-capstone-deepdive", title: "关键链路深挖：热点读、秒杀写与一致性", minutes: 44, kind: "reading" },
        { slug: "sc-capstone-review", title: "综合回顾：全课程知识地图与自查", minutes: 30, kind: "reading" },
      ],
    },
  ],
};
