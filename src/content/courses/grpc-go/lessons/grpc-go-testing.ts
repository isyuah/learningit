import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-testing",
  courseSlug: "grpc-go",
  title: "测试 gRPC 服务",
  summary:
    "用 bufconn 在进程内启动服务端，测试拦截器、错误映射和并发行为，让每个失败路径都有可回归的测试。",
  minutes: 34,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "综合练习要求“写至少 5 个测试覆盖成功与失败路径”，但没教怎么测。这一节补上：gRPC-Go 测试不需要启动真实端口、不需要外部进程。用 bufconn 在测试进程内创建一个内存 listener，让生成的客户端 stub 通过它调用真正的服务端，就能获得完整的 gRPC 生命周期——拦截器、metadata、status code 全部生效。",
    },
    {
      type: "heading",
      text: "用 bufconn 在进程内启动服务",
    },
    {
      type: "code",
      title: "测试用 server 与 client",
      language: "go",
      code: 'func newTestServer(t *testing.T) (pb.CatalogServiceClient, *grpc.Server) {\n  t.Helper()\n\n  server := grpc.NewServer()\n  pb.RegisterCatalogServiceServer(server, &catalogServer{\n    repo: newInMemoryRepo(),\n  })\n\n  lis := bufconn.Listen(1024 * 1024)\n  go func() {\n    if err := server.Serve(lis); err != nil {\n      t.Errorf("serve: %v", err)\n    }\n  }()\n  t.Cleanup(server.Stop)\n\n  conn, err := grpc.NewClient(\n    "passthrough:///bufnet",\n    grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {\n      return lis.DialContext(ctx)\n    }),\n    grpc.WithTransportCredentials(insecure.NewCredentials()),\n  )\n  if err != nil {\n    t.Fatal(err)\n  }\n  t.Cleanup(func() { conn.Close() })\n\n  return pb.NewCatalogServiceClient(conn), server\n}',
    },
    {
      type: "paragraph",
      text: "bufconn.Listen 创建的内存 listener 让客户端和服务端共享同一个进程，没有端口分配、防火墙和部署噪音。passthrough resolver 加自定义 dialer 把连接导向这个 listener。测试仍然走完整的 gRPC 栈，所以它能验证真实调用路径，而不是绕过 runtime 直接调用 handler。",
    },
    {
      type: "heading",
      text: "先测 happy path，再测错误分类",
    },
    {
      type: "code",
      title: "成功与错误路径",
      language: "go",
      code: 'func TestGetBookNotFound(t *testing.T) {\n  client, _ := newTestServer(t)\n\n  _, err := client.GetBook(context.Background(), &pb.GetBookRequest{Isbn: "missing"})\n  if status.Code(err) != codes.NotFound {\n    t.Fatalf("got code %v, want NotFound", status.Code(err))\n  }\n}\n\nfunc TestGetBookEmptyIsbn(t *testing.T) {\n  client, _ := newTestServer(t)\n\n  _, err := client.GetBook(context.Background(), &pb.GetBookRequest{})\n  if status.Code(err) != codes.InvalidArgument {\n    t.Fatalf("got code %v, want InvalidArgument", status.Code(err))\n  }\n}',
    },
    {
      type: "paragraph",
      text: "测试断言的是 status code 而不是错误字符串——这正好强化“客户端按 code 决策”的原则。每个业务规则（空 ISBN、缺资源、无权限、超时）都应该有对应测试；测试通过不代表线上正常，但至少保证服务端的错误分类不会在重构中退化。",
    },
    {
      type: "heading",
      text: "测试拦截器与 metadata",
    },
    {
      type: "code",
      title: "验证认证拦截器拒绝无凭证调用",
      language: "go",
      code: 'func TestAuthInterceptorRejectsMissingToken(t *testing.T) {\n  client, _ := newTestServerWithAuth(t)\n\n  _, err := client.GetBook(context.Background(), &pb.GetBookRequest{Isbn: "x"})\n  if status.Code(err) != codes.Unauthenticated {\n    t.Fatalf("got code %v, want Unauthenticated", status.Code(err))\n  }\n}\n\nfunc TestAuthInterceptorAllowsValidToken(t *testing.T) {\n  client, _ := newTestServerWithAuth(t)\n\n  ctx := metadata.NewOutgoingContext(context.Background(),\n    metadata.Pairs("authorization", "Bearer test-token"))\n  if _, err := client.GetBook(ctx, &pb.GetBookRequest{Isbn: "known"}); err != nil {\n    t.Fatalf("unexpected error: %v", err)\n  }\n}',
    },
    {
      type: "paragraph",
      text: "因为 bufconn 走完整 gRPC 栈，metadata 会从客户端传送到服务端拦截器，认证逻辑被真实执行。这比“单独调用一个函数”更能暴露 metadata 键名、大小写处理和拦截器顺序问题。",
    },
    {
      type: "heading",
      text: "测试超时与取消传播",
    },
    {
      type: "code",
      title: "验证 deadline 会取消服务端工作",
      language: "go",
      code: 'func TestDeadlinePropagatesToServer(t *testing.T) {\n  client, _ := newTestServer(t)\n\n  ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)\n  defer cancel()\n\n  // serverSlowGetBook 在循环中观察 ctx.Done 后返回 DeadlineExceeded\n  _, err := client.GetBook(ctx, &pb.GetBookRequest{Isbn: "slow"})\n  if status.Code(err) != codes.DeadlineExceeded && err != nil {\n    t.Fatalf("got %v, want deadline-related error", err)\n  }\n}',
    },
    {
      type: "paragraph",
      text: "这个测试验证的是生命周期契约：客户端设置的 deadline 确实到达服务端，服务端停止工作并返回 DeadlineExceeded。它把“context 贯穿调用链”从口头原则变成可回归的测试。注意测试不要依赖精确的毫秒数，而是依赖行为契约（服务端在 ctx.Done 后停止）。",
    },
    {
      type: "heading",
      text: "并发与 race 检测",
    },
    {
      type: "code",
      title: "并发调用共享缓存",
      language: "go",
      code: 'func TestConcurrentReads(t *testing.T) {\n  client, _ := newTestServer(t)\n\n  var wg sync.WaitGroup\n  for i := 0; i < 50; i++ {\n    wg.Add(1)\n    go func() {\n      defer wg.Done()\n      if _, err := client.GetBook(context.Background(), &pb.GetBookRequest{Isbn: "known"}); err != nil {\n        t.Errorf("concurrent GetBook: %v", err)\n      }\n    }()\n  }\n  wg.Wait()\n}\n\n// 运行：go test -race ./...',
    },
    {
      type: "paragraph",
      text: "并发测试的价值不在于证明“这次跑过了”，而在于配合 go test -race 暴露共享状态的数据竞争。持续在 CI 里带 -race 跑测试，比偶尔手工检查代码更能提前发现竞态。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "测试基础设施要可注入",
      body: "让服务实现依赖接口（如 repository 接口）而不是具体实现，测试才能注入 in-memory 或故障注入实现。这既是可测试性设计，也让业务测试不依赖真实数据库。",
    },
    {
      type: "table",
      caption: "gRPC 服务测试的关键场景",
      headers: ["场景", "验证什么", "失败常见原因"],
      rows: [
        ["空输入", "InvalidArgument 分类", "handler 忘了校验，直接返回 Unknown"],
        ["资源缺失", "NotFound 分类", "把 repo 错误统一映射成 Internal"],
        ["无凭证", "Unauthenticated", "拦截器顺序、metadata 键名大小写"],
        ["deadline 到期", "服务端停止工作", "handler 用 Background 切断了 ctx"],
        ["并发访问", "无数据竞争", "共享 map/slice 没有同步"],
      ],
    },
    {
      type: "quiz",
      question: "用 bufconn 测试 gRPC 服务的主要好处是什么？",
      options: [
        "可以完全绕过 gRPC runtime，直接调用 handler 函数",
        "在进程内模拟完整 gRPC 栈，拦截器、metadata 和 status code 都真实生效",
        "不需要任何 Go 代码，只验证 proto",
        "自动生成数据库迁移",
      ],
      answer: 1,
      explanation:
        "bufconn 用内存 listener 在测试进程内提供真实 gRPC 传输，客户端 stub 仍走完整调用路径，因此拦截器、metadata、deadline 和 status 映射都能被测试到。",
    },
    {
      type: "exercise",
      title: "为 CatalogService 补齐测试",
      description:
        "用 bufconn 为 GetBook 写 5 个测试：成功、空 ISBN、NotFound、认证拦截器拒绝无凭证、deadline 传播。全部在 go test -race 下通过，并说明每个测试断言的是哪种契约。",
      hint:
        "先把 repository 抽象成接口，再注入内存实现；错误路径断言 status.Code 而不是错误字符串。",
    },
    {
      type: "keypoints",
      items: [
        "bufconn 在进程内模拟完整 gRPC 栈，测试不需要真实端口。",
        "错误路径测试断言 status code，强化“按 code 决策”的客户端原则。",
        "拦截器、metadata 和 deadline 传播都应通过完整调用路径验证。",
        "go test -race 是发现共享状态数据竞争的必要工具，应进 CI。",
        "可注入的依赖（repository 接口）是可测试性的基础。",
      ],
    },
  ],
};
