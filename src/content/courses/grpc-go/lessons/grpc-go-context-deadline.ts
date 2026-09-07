import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-context-deadline",
  courseSlug: "grpc-go",
  title: "Context、截止时间与取消",
  summary:
    "把 context 当作一次 RPC 的生命周期预算，理解 deadline、取消传播和服务端停止工作的责任。",
  minutes: 26,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "网络调用最大的危险不是“失败”，而是没有边界地等待。gRPC-Go 把 Go 的 context 放在每个 RPC 的入口，使调用方可以传递 deadline、取消信号和请求范围内的值。它不是日志容器，也不是把所有参数塞进去的通用 map；在 gRPC 中最重要的是生命周期。",
    },
    {
      type: "heading",
      text: "客户端给调用一个时间预算",
    },
    {
      type: "code",
      title: "为 unary RPC 设置 deadline",
      language: "go",
      code: 'ctx, cancel := context.WithTimeout(parent, 300*time.Millisecond)\ndefer cancel()\n\nbook, err := client.GetBook(ctx, req)\nif err != nil {\n  if status.Code(err) == codes.DeadlineExceeded {\n    metrics.Inc("catalog_deadline_exceeded")\n  }\n  return err\n}\n_ = book',
    },
    {
      type: "paragraph",
      text: "deadline 是绝对的时间边界，WithTimeout 只是按当前时刻计算它。调用链越长，越应该从上游预算中分配，而不是每一层都重新创建一个更长的 Background 超时。否则上游已经放弃时，下游仍可能继续占用资源。",
    },
    {
      type: "heading",
      text: "服务端必须观察 ctx.Done",
    },
    {
      type: "code",
      title: "长任务中响应取消",
      language: "go",
      code: 'func (s *catalogServer) Reindex(ctx context.Context, req *pb.ReindexRequest) (*pb.ReindexSummary, error) {\n  for _, page := range pagesToScan(req) {\n    select {\n    case <-ctx.Done():\n      return nil, status.FromContextError(ctx.Err()).Err()\n    default:\n    }\n\n    if err := s.indexPage(ctx, page); err != nil {\n      return nil, err\n    }\n  }\n  return &pb.ReindexSummary{Completed: true}, nil\n}',
    },
    {
      type: "paragraph",
      text: "取消不会让 CPU 密集型代码凭空停止，也不能中断一个完全不接受 context 的第三方调用。服务实现需要把 ctx 传给数据库、HTTP client、子任务和等待操作，并在循环或阶段边界观察 ctx.Done。收到取消后应停止继续接收和提交工作。",
    },
    {
      type: "table",
      caption: "常见 context 错误",
      headers: ["错误做法", "实际后果", "改法"],
      rows: [
        ["handler 内使用 context.Background()", "丢失调用方 deadline 和取消", "沿用 handler 收到的 ctx"],
        ["只在入口检查一次 ctx", "长循环中仍会继续做大量工作", "在可中断边界持续检查"],
        ["把大对象放进 context value", "依赖隐式状态，增加内存和耦合", "显式参数传递业务数据"],
        ["捕获取消后仍返回成功", "调用方会误以为任务完成", "按 ContextError 映射为 Canceled 或 DeadlineExceeded"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "取消不是回滚承诺",
      body: "客户端取消 RPC 只表示它不再等待这次调用；服务端已经提交的数据库写入、发出的消息或外部副作用不会因为 context 被取消而自动回滚。需要原子性时，仍要靠事务、幂等和补偿设计。",
    },
    {
      type: "heading",
      text: "deadline、重试和总预算",
    },
    {
      type: "paragraph",
      text: "一次 300ms 的调用不能因为重试三次就变成 900ms 的无限额度。重试应复用剩余 deadline，并给每次尝试保留合理的网络和服务处理时间。若调用已经接近 deadline，继续排队或发起新尝试通常只会制造更多负载。",
    },
    {
      type: "quiz",
      question: "为什么服务端 handler 不应随手用 context.Background() 调数据库？",
      options: [
        "Background 不能保存字符串",
        "它会切断客户端传入的 deadline 与取消传播，可能让调用方放弃后服务端仍继续工作",
        "Background 会关闭数据库连接",
        "gRPC 只允许使用 context.TODO()",
      ],
      answer: 1,
      explanation:
        "handler 收到的 ctx 是调用生命周期的一部分。改用 Background 会丢失截止时间和取消信号，增加资源浪费和尾部延迟。",
    },
    {
      type: "exercise",
      title: "找出一条泄漏路径",
      description:
        "阅读一个“客户端 200ms 超时、服务端循环扫描 1000 页、数据库查询使用 context.Background()”的实现，指出至少三处生命周期问题，并写出修复策略。",
      hint:
        "沿着 ctx 从 client.GetBook 走到数据库查询，检查每一层是否保留 deadline、是否在循环中可取消、取消后的副作用如何处理。",
    },
    {
      type: "keypoints",
      items: [
        "context 为每次 RPC 提供 deadline、取消和请求范围生命周期。",
        "服务端要把收到的 ctx 传给下游，并在长任务边界观察 ctx.Done。",
        "取消表示调用方不再等待，不等于已发生副作用自动回滚。",
        "重试必须纳入同一个总时间预算，而不是无上限叠加。",
      ],
    },
  ],
};
