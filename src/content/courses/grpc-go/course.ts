import type { Course } from "../../types";

export const course: Course = {
  slug: "grpc-go",
  title: "gRPC 系统学习",
  tagline: "从第一个 RPC 到可运营的 Go 服务",
  description:
    "面向已经掌握 Go、HTTP 和基本网络编程的开发者。课程用一条 CatalogService 主线，逐步建立 gRPC 的协议心智模型、Go 实践能力、生产工程判断与高级架构能力。",
  level: "intermediate",
  hours: 12,
  coverIndex: "08",
  coverColor: "info",
  updatedAt: "2026-08",
  outcomes: [
    "解释 gRPC、HTTP/2、Protocol Buffers、stub 和服务端实现之间的关系",
    "使用 Go 定义 proto、生成代码并完成 unary 与四种流式 RPC",
    "正确处理 context、deadline、取消、状态码、metadata 和拦截器",
    "为服务配置 TLS、认证边界、重试策略、健康检查与优雅停机",
    "能从症状出发排查未实现、超时、TLS、协议和服务发现问题",
    "理解 resolver、service config、负载均衡、Keepalive、流控和消息边界",
    "能在 gRPC、HTTP/JSON 网关、代理和 OpenTelemetry tracing 之间做边界决策",
    "用 Well-Known Types 与 Buf 设计可共享、可演进、可验证的 proto 工程",
    "为高并发 gRPC 服务设计限流、过载保护与并发安全边界，并系统化测试服务",
  ],
  chapters: [
    {
      id: "model-and-first-call",
      title: "建立模型，完成第一次调用",
      intro: "先看清 gRPC 在应用代码、协议契约和网络传输之间各自负责什么。",
      lessons: [
        { slug: "grpc-go-mental-model", title: "gRPC 到底解决什么问题", minutes: 22, kind: "reading" },
        { slug: "grpc-go-first-rpc", title: "从 proto 到第一个 Go RPC", minutes: 32, kind: "exercise" },
      ],
    },
    {
      id: "contract-design",
      title: "设计可演进的服务契约",
      intro: "Protocol Buffers 的字段规则与 RPC 形状，决定了客户端和服务端如何长期协作。",
      lessons: [
        { slug: "grpc-go-protobuf-contract", title: "Protobuf 契约与兼容性", minutes: 30, kind: "reading" },
        { slug: "grpc-go-protobuf-advanced", title: "消息建模：Well-Known Types 与字段设计", minutes: 32, kind: "reading" },
        { slug: "grpc-go-rpc-shapes", title: "四种 RPC 形状与选择", minutes: 28, kind: "reading" },
        { slug: "grpc-go-buf-workflow", title: "用 Buf 管理 proto 工程", minutes: 28, kind: "exercise" },
      ],
    },
    {
      id: "lifecycle-and-errors",
      title: "理解一次调用的生命周期",
      intro: "把流、context、deadline 和错误放回完整的调用路径中理解。",
      lessons: [
        { slug: "grpc-go-streaming", title: "流式 RPC：消息、方向与结束", minutes: 34, kind: "reading" },
        { slug: "grpc-go-context-deadline", title: "Context、截止时间与取消", minutes: 26, kind: "reading" },
        { slug: "grpc-go-status-errors", title: "状态码与可处理的错误", minutes: 30, kind: "reading" },
      ],
    },
    {
      id: "production-boundaries",
      title: "把安全与可靠性放进边界",
      intro: "学习哪些能力属于传输安全，哪些属于业务认证和客户端策略。",
      lessons: [
        { slug: "grpc-go-metadata-interceptors", title: "Metadata 与拦截器", minutes: 32, kind: "reading" },
        { slug: "grpc-go-tls-auth", title: "TLS、认证与信任边界", minutes: 30, kind: "reading" },
        { slug: "grpc-go-retries-resilience", title: "重试、幂等与失败预算", minutes: 34, kind: "reading" },
        { slug: "grpc-go-server-concurrency", title: "高并发下的服务端资源保护", minutes: 34, kind: "reading" },
      ],
    },
    {
      id: "advanced-architecture",
      title: "高级架构与生态",
      intro: "把单实例 RPC 提升到多实例、跨协议和可追踪的服务架构。",
      lessons: [
        { slug: "grpc-go-discovery-balancing", title: "服务发现与客户端负载均衡", minutes: 36, kind: "reading" },
        { slug: "grpc-go-connection-tuning", title: "Keepalive、流控与消息边界", minutes: 32, kind: "reading" },
        { slug: "grpc-go-gateway-proxy-interop", title: "网关、代理与跨协议互操作", minutes: 36, kind: "reading" },
        { slug: "grpc-go-otel-tracing", title: "gRPC 与 OpenTelemetry tracing", minutes: 36, kind: "reading" },
        { slug: "grpc-go-advanced-architecture", title: "高级架构练习：多实例 CatalogService", minutes: 42, kind: "exercise" },
      ],
    },
    {
      id: "operate-and-build",
      title: "运维与综合实战",
      intro: "让服务可探活、可停止、可观测、可测试，并用一个小项目把知识串起来。",
      lessons: [
        { slug: "grpc-go-health-graceful-shutdown", title: "健康检查与优雅停机", minutes: 28, kind: "reading" },
        { slug: "grpc-go-observability-troubleshooting", title: "可观测性与故障排查", minutes: 34, kind: "reading" },
        { slug: "grpc-go-testing", title: "测试 gRPC 服务", minutes: 34, kind: "exercise" },
        { slug: "grpc-go-capstone", title: "综合练习：交付 CatalogService", minutes: 42, kind: "exercise" },
      ],
    },
  ],
};
