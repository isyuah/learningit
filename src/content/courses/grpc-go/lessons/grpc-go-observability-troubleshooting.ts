import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-observability-troubleshooting",
  courseSlug: "grpc-go",
  title: "可观测性与故障排查",
  summary:
    "从 RPC 方法、status code、耗时和连接阶段建立诊断路径，处理最常见的未实现、超时、TLS 和流式问题。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "gRPC 故障排查不能只看“客户端报错了”。一次调用至少有连接建立、请求发送、服务端排队、业务处理、响应发送和客户端读取几个阶段。没有方法名、status code、耗时、请求范围 ID 和依赖信息，日志通常只能告诉你“失败”，不能告诉你该修哪里。",
    },
    {
      type: "heading",
      text: "先建立稳定的观测维度",
    },
    {
      type: "table",
      caption: "每次 RPC 值得记录的最小维度",
      headers: ["维度", "作用", "注意事项"],
      rows: [
        ["FullMethod", "知道哪个服务方法失败", "控制高基数，避免把用户输入当 label"],
        ["status code", "区分业务拒绝、取消和暂时故障", "不要只记录 err.Error()"],
        ["duration", "判断 deadline、排队或下游变慢", "同时看分位数和超时率"],
        ["request id / trace id", "串起客户端、服务端和下游日志", "不要把 token 当 trace id"],
        ["retry attempt", "发现重试放大和服务抖动", "区分单次调用与每次尝试"],
      ],
    },
    {
      type: "heading",
      text: "用拦截器记录结果，而不是打印敏感请求",
    },
    {
      type: "code",
      title: "结构化记录调用结果",
      language: "go",
      code: 'func observe(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {\n  started := time.Now()\n  resp, err := handler(ctx, req)\n\n  fields := []any{\n    "method", info.FullMethod,\n    "code", status.Code(err).String(),\n    "duration_ms", time.Since(started).Milliseconds(),\n  }\n  logger.InfoContext(ctx, "grpc request completed", fields...)\n  return resp, err\n}',
    },
    {
      type: "paragraph",
      text: "日志字段应围绕诊断需要，而不是把整个 request、authorization metadata 或个人数据序列化出来。对于高价值业务，可以记录脱敏后的资源类型和大小；对于消息内容，优先使用计数、哈希或 trace 关联。",
    },
    {
      type: "heading",
      text: "按症状缩小范围",
    },
    {
      type: "table",
      caption: "常见症状与排查路径",
      headers: ["症状", "优先检查", "容易误判的地方"],
      rows: [
        ["UNIMPLEMENTED", "服务是否注册、方法名和生成代码是否来自同一 proto", "把服务端业务错误误认为网络故障"],
        ["DeadlineExceeded", "总预算、服务端日志、下游依赖和连接建立时间", "只把 deadline 调大而不找慢点"],
        ["Unavailable", "地址、监听端口、负载均衡、连接和实例健康", "把所有 Unavailable 都当成安全可重试"],
        ["Unauthenticated", "TLS 是否成功、metadata 是否到达、token 是否过期", "仅检查客户端有没有设置 token"],
        ["流一直不结束", "是否 CloseSend、服务端是否返回 EOF、是否有无界队列", "把正常等待数据和 goroutine 泄漏混为一谈"],
      ],
    },
    {
      type: "heading",
      text: "用 grpcurl 验证协议边界",
    },
    {
      type: "code",
      title: "开发环境的最小探测",
      language: "bash",
      code: "grpcurl -plaintext localhost:50051 list\ngrpcurl -plaintext localhost:50051 describe catalog.v1.CatalogService\ngrpcurl -plaintext -d '{\"isbn\":\"978-7-000-00000-0\"}' localhost:50051 catalog.v1.CatalogService/GetBook",
    },
    {
      type: "paragraph",
      text: "grpcurl 能把“客户端业务代码问题”和“服务端协议/注册问题”分开。它依赖 reflection，或需要显式提供 proto 描述；生产环境不要为了方便诊断而无条件公开 reflection。",
    },
    {
      type: "callout",
      variant: "example",
      title: "一个实用的排查顺序",
      body: "先确认地址与 TLS，再确认服务是否健康和方法是否注册，然后用 grpcurl 验证协议，接着看 status code 与服务端耗时，最后才进入数据库、线程、流控或代码逻辑。每一步都要能排除一类假设。",
    },
    {
      type: "heading",
      text: "把故障变成可回归的测试",
    },
    {
      type: "list",
      items: [
        "输入为空返回 InvalidArgument，而不是 Unknown。",
        "客户端 deadline 到期后，服务端长任务会停止继续读取或提交工作。",
        "服务重启期间 readiness 先变为 NOT_SERVING，已有调用能在窗口内完成。",
        "TLS 主机名不匹配时连接失败，不能通过关闭校验来“修复”。",
        "非幂等写入在响应丢失后不会因为客户端重试而产生重复记录。",
      ],
    },
    {
      type: "quiz",
      question: "客户端收到 DeadlineExceeded 时，最有价值的第一步是什么？",
      options: [
        "把所有错误改成 Unavailable",
        "无条件把 timeout 改成 10 分钟",
        "对照客户端、服务端和下游耗时，判断预算消耗在哪个阶段",
        "删除所有拦截器",
      ],
      answer: 2,
      explanation:
        "DeadlineExceeded 只说明总预算耗尽，可能发生在连接、排队、业务处理或下游调用阶段。先用分阶段日志和指标定位，再决定改预算还是修慢点。",
    },
    {
      type: "exercise",
      title: "写一份故障排查记录",
      description:
        "假设客户端调用 ListBooks 20 秒后报 DeadlineExceeded，服务端没有业务完成日志。请列出至少四个假设，并说明每个假设用什么日志、指标或 grpcurl 操作区分。",
      hint:
        "不要只列“服务慢”。考虑 DNS/连接、TLS、负载均衡、服务端排队、handler、数据库和流结束信号。",
    },
    {
      type: "keypoints",
      items: [
        "观测至少要有方法、status code、耗时、请求关联 ID 和重试信息。",
        "按症状和阶段排查，不要把所有网络错误当成同一类问题。",
        "grpcurl 能验证协议与注册边界，但 reflection 需要受控暴露。",
        "故障排查结论应沉淀成可验证的测试和告警条件。",
      ],
    },
  ],
};
