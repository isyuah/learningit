import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-health-graceful-shutdown",
  courseSlug: "grpc-go",
  title: "健康检查与优雅停机",
  summary:
    "让负载均衡器和平台知道服务是否可接流量，并在发布或扩缩容时给正在进行的 RPC 一个可控的结束路径。",
  minutes: 28,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "一个能响应 GetBook 的进程不等于一个可以安全接流量的服务。它可能已经无法访问数据库、正在退出、证书已失效，或者只剩下无法满足 deadline 的资源。健康检查和优雅停机把这些运行状态显式暴露给平台与调用方。",
    },
    {
      type: "heading",
      text: "区分 liveness 与 readiness",
    },
    {
      type: "table",
      caption: "两类探针回答不同问题",
      headers: ["探针", "问题", "失败时的动作"],
      rows: [
        ["liveness", "进程是否还活着、是否陷入无法恢复的状态？", "重启实例"],
        ["readiness", "此刻是否准备好接收新请求？", "从流量池摘除，但不一定重启"],
      ],
    },
    {
      type: "paragraph",
      text: "不要把所有依赖故障都映射成 liveness 失败，否则数据库短暂抖动会触发大量重启。readiness 更适合表达“暂时不要给我新流量”。检查接口本身也要有超时和资源上限，不能因为探活把故障服务压得更坏。",
    },
    {
      type: "heading",
      text: "注册标准 health service",
    },
    {
      type: "code",
      title: "启动时暴露 gRPC 健康检查",
      language: "go",
      code: 'healthServer := health.NewServer()\nhealthpb.RegisterHealthServer(grpcServer, healthServer)\n\nhealthServer.SetServingStatus(\n  "catalog.v1.CatalogService",\n  healthpb.HealthCheckResponse_SERVING,\n)\n\n// 依赖初始化失败或准备下线时\nhealthServer.SetServingStatus(\n  "catalog.v1.CatalogService",\n  healthpb.HealthCheckResponse_NOT_SERVING,\n)',
    },
    {
      type: "paragraph",
      text: "健康状态应该跟服务真正的生命周期绑定：监听 socket 成功不代表依赖初始化完成，收到停机信号后也应先标记 NOT_SERVING，再停止接收新的业务流量。平台使用的探针方式和服务名要在部署配置里保持一致。",
    },
    {
      type: "heading",
      text: "优雅停机的顺序",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "收到 SIGTERM 或等价的停止信号。",
        "先标记 NOT_SERVING，让流量分发停止选择本实例。",
        "停止接收新的业务请求，但允许已开始的 RPC 继续。",
        "等待进行中的 RPC 在窗口内完成。",
        "超时后强制 Stop，释放进程资源并记录未完成调用。",
      ],
    },
    {
      type: "code",
      title: "GracefulStop 加超时兜底",
      language: "go",
      code: 'func stopServer(s *grpc.Server, timeout time.Duration) {\n  done := make(chan struct{})\n  go func() {\n    s.GracefulStop()\n    close(done)\n  }()\n\n  select {\n  case <-done:\n    log.Println("grpc server stopped gracefully")\n  case <-time.After(timeout):\n    log.Println("grpc graceful stop timed out; forcing stop")\n    s.Stop()\n  }\n}',
    },
    {
      type: "callout",
      variant: "warning",
      title: "GracefulStop 可能一直等",
      body: "一个没有 deadline 的流式 RPC 或卡在下游依赖的 handler，可能让 GracefulStop 长时间不返回。因此健康状态、调用 deadline、停机窗口和 Stop 兜底必须一起设计。",
    },
    {
      type: "heading",
      text: "反射是调试能力，不是授权机制",
    },
    {
      type: "code",
      title: "开发环境启用 reflection",
      language: "go",
      code: 'reflection.Register(grpcServer)\n\n// 之后可以用 grpcurl 查看服务和调用描述\n// grpcurl -plaintext localhost:50051 list',
    },
    {
      type: "paragraph",
      text: "Server Reflection 能让 grpcurl 等工具发现服务描述，适合开发、测试和受控诊断。它会暴露接口形状，不应被当作认证或授权；生产环境是否启用要结合网络隔离、工具链和暴露面决定。",
    },
    {
      type: "quiz",
      question: "服务收到停机信号后，为什么应先将 readiness 设为 NOT_SERVING？",
      options: [
        "让已经进行中的 RPC 立刻被杀死",
        "让流量分发停止把新的请求送到这台实例，同时给已有 RPC 留出完成窗口",
        "让 TLS 证书自动续期",
        "让客户端自动把所有请求改成 unary",
      ],
      answer: 1,
      explanation:
        "readiness 表达是否接收新流量。先摘流量、再优雅等待，可以减少发布期间的新请求失败；已有调用是否完成仍由 deadline 和停机窗口决定。",
    },
    {
      type: "exercise",
      title: "设计一次无损发布",
      description:
        "给 CatalogService 写出 SIGTERM 后 30 秒停机流程：何时拒绝新流量，如何处理长流，哪些指标要记录，30 秒后仍未结束时做什么。",
      hint:
        "把 readiness、GracefulStop、调用 deadline 和 Stop 兜底按时间顺序串起来。",
    },
    {
      type: "keypoints",
      items: [
        "liveness 表示进程是否需要重启，readiness 表示当前是否接收新流量。",
        "健康状态应和依赖初始化、下线流程绑定，不只是监听端口成功。",
        "优雅停机需要先摘流量，再等待，最后有强制停止兜底。",
        "reflection 便于诊断，但不是安全机制；暴露范围要受控。",
      ],
    },
  ],
};
