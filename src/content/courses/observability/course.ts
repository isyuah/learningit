/* ==================================================================
 * 课程：可观测性系统学习（observability）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 *
 * 版本边界：Prometheus 3.x（3.14，2026-08）；Grafana 13.x（13.2）；
 * Loki 3.x（3.7）；Tempo 3.x（3.0）；OpenTelemetry Go SDK 1.46+
 * （Logs API/SDK v1 随 1.47 稳定）；opentelemetry-collector-contrib
 * 0.160；prometheus/client_golang 1.24（要求 Go 1.25+）。
 * 语义约定（SemConv）以 2026-09 已稳定部分为准，未稳定部分标注实验性。
 * 示例统一为 Go（net/http + database/sql + client_golang + otel-go）。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "observability",
  title: "可观测性系统学习",
  tagline: "从三支柱心智模型到 OpenTelemetry 工程实践",
  description:
    "面向已有后端开发经验、想体系化掌握监控与追踪的学习者。课程不是工具清单，而是建立一套统一的思维框架：先讲清楚「可观测性」到底解决什么问题、为什么传统监控不够，再以 OpenTelemetry 的统一数据模型为骨架，把日志、指标、追踪三个信号及其关系讲透，最后落到 Prometheus + Grafana + Tempo + Loki 这一套以 OTel 为前端的现代观测栈的真实部署与排障。\n\n全程围绕一个 Go 编写的「shop」示例服务（HTTP + SQLite）展开：从手动埋点到 OTel 自动/手动埋点、从拉取采集到 OTLP 推送、从单信号到跨信号关联，最后用一次真实的线上故障排查把所有能力串成一条工程主线。配套可运行的示例工程位于仓库之外的 E:/Proj/Learn/observability-demo。",
  level: "intermediate",
  hours: 12,
  learners: 0,
  coverIndex: "12",
  coverColor: "amber",
  updatedAt: "2026-09",
  outcomes: [
    "解释可观测性与传统监控的区别，以及三种信号各自的适用问题与边界",
    "掌握 OpenTelemetry 的 Trace/Span、Log、Metric 数据模型与传播机制，看懂并设计埋点",
    "用 Go 为真实服务接入自动与手动埋点，正确设置属性、资源与语义约定",
    "理解 Prometheus 拉取模型、指标类型与 PromQL，能构建黄金信号面板",
    "理解 OTLP 与 Collector 在采集拓扑中的角色，能部署一套本地可运行的全栈观测环境",
    "掌握从指标告警到追踪定位、再到日志取证的标准排障工作流",
    "理解 OpenMetrics、Exemplar、事件日志、SLO 等进阶概念及其在工程中的位置",
  ],
  chapters: [
    {
      id: "foundation",
      title: "心智模型与统一数据模型",
      intro: "先理解可观测性解决什么问题，再用 OpenTelemetry 的统一模型把三种信号放进同一张图。",
      lessons: [
        { slug: "obs-mental-model", title: "为什么需要可观测性", minutes: 22, kind: "reading" },
        { slug: "obs-three-pillars", title: "三支柱：指标、日志、追踪", minutes: 30, kind: "reading" },
        { slug: "obs-otel-model", title: "OpenTelemetry：统一数据模型", minutes: 28, kind: "reading" },
        { slug: "obs-trace-model", title: "追踪的解剖：Trace、Span 与 Context", minutes: 26, kind: "reading" },
      ],
    },
    {
      id: "metrics",
      title: "指标与 Prometheus",
      intro: "掌握 Prometheus 的拉取模型与四种指标类型，学会用 PromQL 回答系统问题。",
      lessons: [
        { slug: "obs-prometheus-model", title: "Prometheus 数据模型与采集", minutes: 30, kind: "reading" },
        { slug: "obs-prometheus-instrumentation", title: "Go 指标埋点：从零到黄金信号", minutes: 32, kind: "reading" },
        { slug: "obs-promql", title: "PromQL：查询与计算", minutes: 36, kind: "reading" },
        { slug: "obs-alerting", title: "告警与告警治理", minutes: 28, kind: "reading" },
      ],
    },
    {
      id: "logs",
      title: "日志的现代化",
      intro: "日志从排错文本变成结构化事件：理解其成本模型、与追踪的关联方式，以及它在排障中的真实位置。",
      lessons: [
        { slug: "obs-structured-logging", title: "结构化日志与事件", minutes: 26, kind: "reading" },
        { slug: "obs-loki-logging", title: "Loki：以标签为中心的日志存储", minutes: 30, kind: "reading" },
      ],
    },
    {
      id: "traces-deep",
      title: "追踪工程化与关联",
      intro: "把追踪从演示带到生产：采样、跨服务传播、指标与追踪之间的桥。",
      lessons: [
        { slug: "obs-sampling-propagation", title: "采样与跨服务传播", minutes: 34, kind: "reading" },
        { slug: "obs-exemplars-bridges", title: "Exemplar：指标与追踪的桥", minutes: 24, kind: "reading" },
      ],
    },
    {
      id: "deployment",
      title: "Collector 与观测栈部署",
      intro: "理解 OTel Collector 在采集拓扑中的位置，然后本地部署一套完整观测栈。",
      lessons: [
        { slug: "obs-collector", title: "OpenTelemetry Collector", minutes: 34, kind: "reading" },
        { slug: "obs-full-stack-deploy", title: "部署全栈观测环境", minutes: 40, kind: "exercise" },
      ],
    },
    {
      id: "practices",
      title: "工程实践与排障",
      intro: "把一切串起来：一次线上故障从指标告警开始，到追踪定位、日志取证、复盘改进的完整闭环。",
      lessons: [
        { slug: "obs-slo", title: "SLO 与错误预算", minutes: 26, kind: "reading" },
        { slug: "obs-troubleshooting", title: "综合实战：用观测定位线上故障", minutes: 45, kind: "exercise" },
      ],
    },
  ],
};
