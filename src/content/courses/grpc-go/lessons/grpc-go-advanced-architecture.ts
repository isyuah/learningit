import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-advanced-architecture",
  courseSlug: "grpc-go",
  title: "高级架构练习：多实例 CatalogService",
  summary:
    "把服务发现、负载均衡、网关、TLS、重试、健康检查和 tracing 放进一张可验证的系统设计中。",
  minutes: 42,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "高级 gRPC 能力真正困难的地方，不是记住更多 option，而是这些 option 会互相影响。多实例 CatalogService 可能同时涉及 DNS、round_robin、TLS、网关重试、服务端 deadline、health service 和 OpenTelemetry。现在用一个架构练习把它们放回组件、流量和失败域中。",
    },
    {
      type: "heading",
      text: "目标架构",
    },
    {
      type: "code",
      title: "一次请求的逻辑路径",
      language: "text",
      code: "Browser / HTTP client\n        |\n   HTTP/JSON Gateway ---- TLS / auth / rate limit\n        |\n   gRPC ClientConn\n   resolver -> service config -> round_robin balancer\n        |\n CatalogService x N ---- health / graceful shutdown\n        |\n repository + pricing gRPC service\n        |\n traces / metrics / structured logs",
    },
    {
      type: "paragraph",
      text: "这张图是教学模型：网关对外提供 HTTP/JSON，内部用 gRPC 调用多实例 CatalogService；客户端连接通过 resolver 获取地址，balancer 选择实例；服务实例暴露 health 状态并在停机时摘流量；观测信号记录每个边界，但不把敏感业务内容写入日志或 span。",
    },
    {
      type: "heading",
      text: "先做四个架构决策",
    },
    {
      type: "table",
      caption: "决策、理由与验证",
      headers: ["决策", "推荐起点", "必须验证"],
      rows: [
        ["服务发现", "DNS 或平台 resolver 提供地址", "地址变化、空地址、解析延迟和版本来源"],
        ["负载均衡", "读请求使用 round_robin，写请求按幂等语义处理", "实例摘除、连接失败和重试不会造成重复副作用"],
        ["对外协议", "HTTP/JSON 网关，内部原生 gRPC", "JSON 映射、认证 metadata、错误和 deadline 能对齐"],
        ["观测", "metrics + structured logs + OTel tracing", "同一 trace 能串起网关、gRPC 和下游，并控制基数"],
      ],
    },
    {
      type: "heading",
      text: "沿着失败路径推演",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "一个 CatalogService 实例变为 NOT_SERVING，resolver/balancer 如何停止选择它？",
        "客户端在 RecordReading 的响应到达前断开，如何用 event_id 查询或安全重放？",
        "网关返回 HTTP 504 时，内部 gRPC 是 DeadlineExceeded、Unavailable 还是网关自身超时？",
        "定价服务变慢时，GetBook 的总 deadline 如何分配，trace 如何显示这段时间？",
        "滚动发布收到 SIGTERM，readiness、GracefulStop 和连接 drain 的顺序是什么？",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要把“多一层组件”当作高可用",
      body: "网关、resolver、balancer、重试和 tracing 都可能引入新的故障域与延迟。架构应说明每层的超时、重试、认证、观测和退出行为，否则组件数量增加只会让问题更难定位。",
    },
    {
      type: "heading",
      text: "验收测试矩阵",
    },
    {
      type: "table",
      caption: "至少覆盖这些集成情景",
      headers: ["情景", "预期结果", "关键观测"],
      rows: [
        ["三个实例均正常", "请求分布符合策略，成功率稳定", "实例维度请求数、p95、trace"],
        ["一个实例拒绝健康检查", "新请求不再选择它，已有调用按窗口结束", "health 状态、picker 更新、停机日志"],
        ["读请求暂时 Unavailable", "有限退避，仍受总 deadline 约束", "attempt、最终 code、负载变化"],
        ["写响应丢失", "重复 event_id 不产生重复事件", "幂等命中、业务结果查询"],
        ["网关 JSON 参数错误", "HTTP 4xx 与 gRPC InvalidArgument 对齐", "映射日志，不泄露凭证"],
        ["下游定价服务变慢", "上游剩余预算耗尽并可定位慢 span", "span 时序、deadline、依赖 p99"],
      ],
    },
    {
      type: "exercise",
      title: "提交一份架构决策记录",
      description:
        "为上述系统写一页 ADR：画出组件与信任边界，说明 resolver/balancer、网关和 OTel 的职责，定义读写 RPC 的重试与幂等规则，并给出 6 个集成测试场景及对应指标。",
      hint:
        "每一个组件都回答四个问题：它接收什么、输出什么、失败如何表现、如何被观测。没有答案的组件暂时不要加入架构。",
    },
    {
      type: "quiz",
      question: "当一个实例被标记为 NOT_SERVING 时，最完整的系统行为是什么？",
      options: [
        "只在日志里记录，继续向它发送所有请求",
        "停止把新请求路由到它，并按优雅停机窗口处理已有 RPC",
        "让所有客户端立刻无限重试",
        "把所有请求改发 HTTP/JSON 并忽略原始错误",
      ],
      answer: 1,
      explanation:
        "健康状态要影响流量选择，同时保留已有调用的可控结束路径。重试仍需受 status、幂等性和 deadline 约束，不能无限进行。",
    },
    {
      type: "keypoints",
      items: [
        "高级 gRPC 设计的核心是组件职责、信任边界、失败域和观测闭环。",
        "服务发现、负载均衡、网关和 tracing 需要明确配置来源与版本。",
        "读写请求的重试规则不同；写入必须能处理响应未知和重复副作用。",
        "架构完成的证据是失败矩阵与集成测试，而不是组件列表。",
      ],
    },
  ],
};
