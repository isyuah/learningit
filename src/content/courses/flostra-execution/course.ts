/* ==================================================================
 * 课程：Flostra Execution 深度学习（flostra-execution）
 * ----------------------------------------------------------------
 * 真实案例：E:/Proj/Flostra
 * 课程主线：一次 workflow execution 如何从 API 进入数据库、Outbox、
 * RabbitMQ、Python worker，再通过 Attempt、心跳、Watchdog 和事件流
 * 回到可观察的最终状态。
 *
 * 版本边界：以 E:/Proj/Flostra 当前工作树与 gback/backend 主线代码为准。
 * 课程中的“从简单到复杂”是教学重建；除非标注 Git commit，否则不表示
 * 项目一定按完全相同的时间顺序实现。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "flostra-execution",
  title: "Flostra Execution 深度学习",
  tagline: "沿着一次任务的时间线，读懂 Outbox、Attempt 与 Worker 协作",
  description:
    "这不是一份 API 目录，而是一门围绕真实 Flostra 代码的代码阅读课。我们从最简单的“创建 execution 后直接发布 RabbitMQ”开始，每遇到一个真实工程压力，就引入一个机制：事务 Outbox、投递 lease、Attempt fencing、Worker 心跳、Watchdog、取消、人工 redrive、事件流与 Python DAG 执行器。\n\n你不需要先记住所有 model 字段，也不需要按目录拓扑排序通读整个仓库。每节课都从一个可观察的问题开始，先画时间线，再定位少量入口函数，最后用测试、SQL 条件和失败场景验证自己的理解。课程只讲仓库中能够被代码或测试证明的行为；对设计演进的重建会明确标注为教学模型。",
  level: "intermediate",
  hours: 8,
  learners: 0,
  coverIndex: "16",
  coverColor: "info",
  updatedAt: "2026-09",
  outcomes: [
    "用一张时间线解释一次 execution 从 Spawn 到终态的控制流、数据流和外部副作用",
    "区分 execution、outbox message、execution attempt 和 audit 各自拥有的事实",
    "解释事务 Outbox 如何解决“数据库已提交但消息没发出”的裂缝，以及 at-least-once 的边界",
    "读懂 outbox dispatcher 的 SKIP LOCKED、lease、重试、发布确认与失租处理",
    "用 AttemptId、WorkerId、lease 和条件更新解释旧 worker 为什么不能覆盖新状态",
    "区分 Watchdog 超时、用户取消、RabbitMQ 重投递和人工 redrive 这四种不同动作",
    "读懂 Python worker 的 ACK/NACK、事件协议、心跳以及 DAG 就绪批次并发执行",
    "用测试和故障注入证明自己的理解，并把项目讲成诚实、可追问的简历故事",
  ],
  chapters: [
    {
      id: "orientation",
      title: "先建立一条可追踪的执行故事",
      intro: "不要从 models 目录开始背字段。先确定一次执行要完成什么，以及状态从哪里来、到哪里去。",
      lessons: [
        {
          slug: "flostra-execution-map",
          title: "Execution 到底是什么：先画出一条完整时间线",
          minutes: 30,
          kind: "reading",
        },
        {
          slug: "flostra-execution-baseline",
          title: "第一版系统：直接发布为什么看起来足够好",
          minutes: 28,
          kind: "reading",
        },
      ],
    },
    {
      id: "durable-delivery",
      title: "把投递变成可恢复的数据库事实",
      intro: "先解决提交与发送之间的原子性，再学习 dispatcher 如何在不持有数据库事务的情况下可靠重试。",
      lessons: [
        {
          slug: "flostra-execution-transaction-outbox",
          title: "事务 Outbox：为什么 execution 和消息意图必须一起提交",
          minutes: 42,
          kind: "reading",
        },
        {
          slug: "flostra-execution-outbox-dispatcher",
          title: "Dispatcher：lease、SKIP LOCKED、确认与重试",
          minutes: 45,
          kind: "reading",
        },
      ],
    },
    {
      id: "attempt-fencing",
      title: "让旧 Worker 失去写入资格",
      intro: "Outbox 解决“有没有发出去”，Attempt 解决“谁还有资格改变这次执行”。",
      lessons: [
        {
          slug: "flostra-execution-attempt",
          title: "Attempt：一次投递为什么要有独立身份",
          minutes: 42,
          kind: "reading",
        },
        {
          slug: "flostra-execution-stale-events",
          title: "事件与 fencing：如何让迟到事件变成无害的 no-op",
          minutes: 40,
          kind: "reading",
        },
      ],
    },
    {
      id: "failure-recovery",
      title: "失败、超时、取消与重跑不是一回事",
      intro: "把四类看似相似的失败动作拆开，才能读懂边界条件和运维语义。",
      lessons: [
        {
          slug: "flostra-execution-watchdog-cancel",
          title: "Watchdog 与取消：谁负责结束一项失联的工作",
          minutes: 40,
          kind: "reading",
        },
        {
          slug: "flostra-execution-redrive",
          title: "Redrive：为什么重跑必须显式、幂等并留下审计",
          minutes: 38,
          kind: "reading",
        },
      ],
    },
    {
      id: "worker-runtime",
      title: "从消息协议走进 Python Worker",
      intro: "控制面只负责调度和裁决，真正执行发生在 worker；这一章沿着 ACK、事件和 DAG 调度读另一半系统。",
      lessons: [
        {
          slug: "flostra-execution-worker",
          title: "Worker 生命周期：消费、ACK、NACK、心跳与终态事件",
          minutes: 45,
          kind: "reading",
        },
        {
          slug: "flostra-execution-dag",
          title: "DAG 执行器：就绪批次、端口输入与节点级重试",
          minutes: 42,
          kind: "reading",
        },
      ],
    },
    {
      id: "practice",
      title: "把理解变成代码阅读能力",
      intro: "最后用测试和一个小型故障推演检查你是否真的掌握了这条执行链。",
      lessons: [
        {
          slug: "flostra-execution-tests-reading",
          title: "测试是证据：用行为而不是函数数量学习 execution",
          minutes: 35,
          kind: "reading",
        },
        {
          slug: "flostra-execution-capstone",
          title: "综合练习：从一个故障反推出整条链路",
          minutes: 50,
          kind: "exercise",
        },
      ],
    },
  ],
};
