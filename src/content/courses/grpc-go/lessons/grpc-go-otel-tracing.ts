import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-otel-tracing",
  courseSlug: "grpc-go",
  title: "gRPC 与 OpenTelemetry tracing",
  summary:
    "用最小必要知识理解 trace、span、context 传播和 gRPC instrumentation；本课不替代完整的 OpenTelemetry 专题课程。",
  minutes: 36,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前一节讲过用拦截器记录方法、status code 和耗时，但当一次请求跨过 API 网关、CatalogService、数据库和另一个 gRPC 服务时，单条日志仍难以回答“时间到底花在哪里”。OpenTelemetry 的 tracing 用 trace 和 span 把这条跨组件路径串起来。本课只讲 gRPC 集成所需的心智模型与边界，不展开完整 SDK、Collector、采样和后端选型。",
    },
    {
      type: "definition",
      term: "Trace 与 Span",
      definition:
        "Trace 表示一次跨服务请求的整体路径；span 是其中一个带开始/结束时间、属性、状态和父子关系的工作片段，例如一个 gRPC server handler 或一次下游 RPC。",
    },
    {
      type: "heading",
      text: "gRPC 需要做两件事",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "在客户端和服务端 RPC 边界创建或记录 span，并捕获方法、状态和耗时。",
        "通过请求上下文和 metadata 传播 trace context，让下游 span 继续属于同一条 trace。",
      ],
    },
    {
      type: "paragraph",
      text: "这也是为什么 context 不能在 handler 内被 Background 替换：除了 deadline 和取消，它还可能携带当前 span。真正的 trace context 如何编码、是否经过代理透传、是否被采样，由 OpenTelemetry SDK 和 instrumentation 版本决定；不要手动拼装 header 冒充完成了 tracing。",
    },
    {
      type: "heading",
      text: "gRPC-Go 的 instrumentation 边界",
    },
    {
      type: "code",
      title: "使用 otelgrpc stats handler 的示意",
      language: "go",
      code: 'server := grpc.NewServer(\n  grpc.StatsHandler(otelgrpc.NewServerHandler()),\n)\n\nconn, err := grpc.NewClient(\n  target,\n  grpc.WithStatsHandler(otelgrpc.NewClientHandler()),\n  grpc.WithTransportCredentials(creds),\n)\nif err != nil {\n  return err\n}\ndefer conn.Close()',
    },
    {
      type: "paragraph",
      text: "这是当前 otelgrpc 包的集成方向示意；具体构造函数、版本和 tracer provider 初始化应以项目锁定版本的官方文档为准。handler 负责把 gRPC 生命周期接入 OpenTelemetry，不会自动让数据库、HTTP client 或消息队列也产生完整 span。",
    },
    {
      type: "heading",
      text: "哪些字段值得记录",
    },
    {
      type: "table",
      caption: "gRPC span 的诊断价值",
      headers: ["信息", "用途", "注意事项"],
      rows: [
        ["rpc.system / rpc.method", "按服务方法聚合延迟和错误", "使用稳定方法名，避免用户输入做名称"],
        ["status code", "区分业务失败、取消和暂时不可用", "与日志和 metrics 保持同一分类"],
        ["peer/service.instance", "知道请求经过哪个服务或实例", "控制属性基数和敏感信息"],
        ["retry attempt", "识别重试放大和尾部延迟", "区分一次调用和一次尝试"],
        ["trace id", "串起网关、gRPC 和下游依赖", "可传递但不要把凭证当 trace id"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要把每条业务数据都放进 span",
      body: "span attribute 不是业务 payload 仓库。ISBN、租户、用户输入和 token 可能带来隐私泄露、高基数和存储成本；优先记录方法、状态、大小、采样后的稳定标识，并对敏感字段脱敏。",
    },
    {
      type: "heading",
      text: "Tracing、metrics、logs 如何分工",
    },
    {
      type: "table",
      caption: "三种信号回答不同问题",
      headers: ["信号", "最适合回答", "CatalogService 示例"],
      rows: [
        ["metrics", "是否变慢、失败和超载？", "GetBook p95、Unavailable 比例、活动 stream"],
        ["logs", "某次请求发生了什么？", "request id、错误上下文、重试决策"],
        ["traces", "跨服务的时间花在哪里？", "网关到 CatalogService 再到数据库的 span 链"],
      ],
    },
    {
      type: "paragraph",
      text: "不要用 trace 替代 metrics 告警，也不要用一条巨大日志替代 trace。成熟的观测方案会让三种信号通过 trace id、方法名和 status code 关联，但每种信号保留自己的采样、保留期和成本控制。",
    },
    {
      type: "quiz",
      question: "为什么 gRPC 的 OpenTelemetry instrumentation 需要同时关注 client 和 server 边界？",
      options: [
        "因为 tracing 只在 TLS 失败时工作",
        "因为客户端 span 记录调用关系，服务端 span 记录实际处理阶段，二者才能组成跨服务时间线",
        "因为 server span 会自动完成数据库事务",
        "因为没有两个 span 就无法生成 protobuf",
      ],
      answer: 1,
      explanation:
        "客户端和服务端分别代表调用链的不同边界。instrumentation 让它们通过 context 形成父子关系，但下游组件仍需自己的 instrumentation 才能补全时间线。",
    },
    {
      type: "exercise",
      title: "为一次慢调用补观测",
      description:
        "假设 GetBook p99 上升，服务会调用 Redis 和另一个 gRPC 定价服务。设计 metrics、logs 和 traces 各自记录什么，并说明如何避免把 token、完整 request 和高基数 ISBN 写入观测数据。",
      hint:
        "先用 metrics 判断范围，再用 trace 定位阶段，最后用日志补充一次请求的决策上下文。",
    },
    {
      type: "keypoints",
      items: [
        "Trace 是整体请求路径，span 是其中一个有时间边界的工作片段。",
        "gRPC tracing 的关键是 RPC 边界 instrumentation 与 context 传播。",
        "当前 otelgrpc 集成 API 可能随版本变化，应以锁定版本文档为准。",
        "metrics、logs、traces 分工不同，三者通过稳定字段关联而不是互相替代。",
        "本课覆盖 gRPC 集成边界，不替代完整 OpenTelemetry 课程。",
      ],
    },
  ],
};
