import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-retries-resilience",
  courseSlug: "grpc-go",
  title: "重试、幂等与失败预算",
  summary:
    "理解 gRPC 重试不是默认护身符，只有在方法语义、状态码、服务配置和 deadline 同时允许时才安全。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "“Unavailable 就重试”听起来合理，却可能把一次故障放大成重试风暴。重试前必须回答：请求是否已经在服务端生效？重复执行是否安全？剩余 deadline 是否足够？服务端是否明确把这个错误当作暂时可重试？这些问题比配置一个 maxAttempts 更重要。",
    },
    {
      type: "heading",
      text: "先判断方法是否幂等",
    },
    {
      type: "table",
      caption: "方法语义与重试风险",
      headers: ["方法", "重复调用的风险", "设计建议"],
      rows: [
        ["GetBook", "通常是读操作，风险较低", "可在明确的暂时错误上退避重试"],
        ["CreateOrder", "可能创建两笔订单", "使用业务幂等键，并让服务端去重"],
        ["SetBookPrice", "重复设置同一值通常可接受", "定义为幂等写入并验证版本冲突"],
        ["AppendReadingEvent", "可能重复记账或累计", "带 event_id，服务端以唯一键去重"],
      ],
    },
    {
      type: "heading",
      text: "只对合适的错误尝试重试",
    },
    {
      type: "paragraph",
      text: "Unavailable、ResourceExhausted 或某些连接建立失败，可能代表暂时问题，但不是永远适合重试。InvalidArgument、PermissionDenied 和 NotFound 通常不会因为再发一次相同请求而变好。DeadlineExceeded 还要先检查总预算是否已经耗尽，继续重试可能只增加负载。",
    },
    {
      type: "code",
      title: "带总预算的有限重试",
      language: "go",
      code: 'func getBookWithRetry(ctx context.Context, client pb.CatalogServiceClient, req *pb.GetBookRequest) (*pb.Book, error) {\n  const maxAttempts = 3\n  var lastErr error\n\n  for attempt := 0; attempt < maxAttempts; attempt++ {\n    book, err := client.GetBook(ctx, req)\n    if err == nil {\n      return book, nil\n    }\n    lastErr = err\n\n    code := status.Code(err)\n    if code != codes.Unavailable && code != codes.ResourceExhausted {\n      return nil, err\n    }\n    if attempt == maxAttempts-1 {\n      break\n    }\n\n    delay := time.Duration(1<<attempt) * 50 * time.Millisecond\n    timer := time.NewTimer(delay)\n    select {\n    case <-ctx.Done():\n      timer.Stop()\n      return nil, ctx.Err()\n    case <-timer.C:\n    }\n  }\n  return nil, lastErr\n}',
    },
    {
      type: "paragraph",
      text: "手写循环只是展示决策关系；实际项目可以使用 gRPC-Go 的 service config 和重试能力，但仍要配置可重试 status、最大尝试次数、退避、超时和方法范围。透明重试、配置重试与业务层重试的语义不同，必须看当前客户端版本文档。",
    },
    {
      type: "heading",
      text: "服务配置表达策略",
    },
    {
      type: "code",
      title: "service config 的关键字段",
      language: "json",
      code: '{\n  "methodConfig": [{\n    "name": [{ "service": "catalog.v1.CatalogService" }],\n    "timeout": "0.8s",\n    "retryPolicy": {\n      "maxAttempts": 4,\n      "initialBackoff": "0.05s",\n      "maxBackoff": "0.5s",\n      "backoffMultiplier": 2,\n      "retryableStatusCodes": ["UNAVAILABLE"]\n    }\n  }]\n}',
    },
    {
      type: "callout",
      variant: "warning",
      title: "重试可能制造重复副作用",
      body: "客户端在收到响应前断开时，服务端可能已经完成写入，只是响应没有到达。对非幂等写操作，不能用“没有收到成功”推断“服务端没有执行”；应使用幂等键、状态查询或业务去重。",
    },
    {
      type: "heading",
      text: "退避还不够：要避免重试风暴",
    },
    {
      type: "list",
      items: [
        "使用指数退避并加入抖动，避免大量客户端同时再次请求。",
        "限制最大尝试次数和总 deadline，给服务端留出恢复空间。",
        "区分单次请求重试、连接重建和上游整体重试，避免层层放大。",
        "为重试次数、最终 code、方法和总耗时建立指标。",
      ],
    },
    {
      type: "quiz",
      question: "为什么 CreateOrder 不能因为没收到响应就直接重试？",
      options: [
        "因为 gRPC 不支持任何重试",
        "因为服务端可能已经创建成功，重复调用可能产生两笔订单",
        "因为 Unavailable 只能在浏览器使用",
        "因为 deadline 会自动变长",
      ],
      answer: 1,
      explanation:
        "网络失败只说明调用方没有得到确定结果，不说明服务端一定没有副作用。非幂等写入需要幂等键、去重或状态查询。",
    },
    {
      type: "exercise",
      title: "为写入 RPC 制定重试策略",
      description:
        "给 CreateReadingEvent 设计 event_id、服务端去重和客户端重试规则。分别处理“收到 Unavailable”“收到 DeadlineExceeded”“客户端进程在发送后崩溃”三种情况。",
      hint:
        "先把“请求是否已生效”变成可以查询的业务事实，再讨论重试，而不是从错误字符串推测。",
    },
    {
      type: "keypoints",
      items: [
        "重试安全性首先由幂等性决定，其次才是 status code 和客户端配置。",
        "Unavailable 不等于“无条件可重试”，DeadlineExceeded 也可能意味着预算已用完。",
        "指数退避、抖动、最大尝试次数和总 deadline 共同限制故障放大。",
        "非幂等写入应使用幂等键、去重或状态查询处理不确定结果。",
      ],
    },
  ],
};
