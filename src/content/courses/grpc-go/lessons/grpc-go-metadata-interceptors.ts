import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-metadata-interceptors",
  courseSlug: "grpc-go",
  title: "Metadata 与拦截器",
  summary:
    "用 metadata 携带请求范围的附加信息，用拦截器统一处理日志、认证和指标，同时保持业务 handler 清晰。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "RPC 的请求消息表达业务数据，但一条调用还常常需要 request id、租户、认证凭证、灰度标签和响应 trailer。gRPC 用 metadata 表达这些附加键值；拦截器则提供一个靠近 RPC 边界的统一处理点。两者都很有用，但都不应被当作任意传递状态的垃圾桶。",
    },
    {
      type: "heading",
      text: "客户端发送 metadata",
    },
    {
      type: "code",
      title: "注入请求范围信息",
      language: "go",
      code: 'md := metadata.Pairs(\n  "authorization", "Bearer "+token,\n  "x-request-id", requestID,\n)\nctx := metadata.NewOutgoingContext(ctx, md)\n\nbook, err := client.GetBook(ctx, req)\nif err != nil {\n  return err\n}\n_ = book',
    },
    {
      type: "paragraph",
      text: "metadata 的键通常按小写处理，值可以是字符串；二进制值使用以 -bin 结尾的键并遵守对应 API。不要把大型业务 payload、密码或不可控对象塞进 metadata。它适合边界信息，不替代强类型 request message。",
    },
    {
      type: "heading",
      text: "服务端读取并校验 metadata",
    },
    {
      type: "code",
      title: "从 incoming context 读取凭证",
      language: "go",
      code: 'func tokenFromContext(ctx context.Context) (string, error) {\n  md, ok := metadata.FromIncomingContext(ctx)\n  if !ok {\n    return "", status.Error(codes.Unauthenticated, "missing metadata")\n  }\n\n  values := md.Get("authorization")\n  if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {\n    return "", status.Error(codes.Unauthenticated, "invalid authorization")\n  }\n  return strings.TrimPrefix(values[0], "Bearer "), nil\n}',
    },
    {
      type: "callout",
      variant: "warning",
      title: "metadata 不是信任来源",
      body: "客户端可以伪造自己发送的 metadata。服务端必须通过 TLS 保护传输，并在服务端验证 token、租户和权限；读取到 x-tenant-id 不等于调用者真的属于这个租户。",
    },
    {
      type: "heading",
      text: "拦截器负责横切逻辑",
    },
    {
      type: "code",
      title: "一个最小的 unary server interceptor",
      language: "go",
      code: 'func loggingInterceptor(\n  ctx context.Context,\n  req any,\n  info *grpc.UnaryServerInfo,\n  handler grpc.UnaryHandler,\n) (any, error) {\n  started := time.Now()\n  resp, err := handler(ctx, req)\n  code := status.Code(err)\n  log.Printf("method=%s code=%s duration=%s", info.FullMethod, code, time.Since(started))\n  return resp, err\n}\n\nserver := grpc.NewServer(\n  grpc.UnaryInterceptor(loggingInterceptor),\n)',
    },
    {
      type: "paragraph",
      text: "拦截器必须调用 handler 才能继续业务流程；它可以在调用前做认证或记录开始时间，在调用后记录 code 和耗时。认证失败时可以直接返回 status error，业务 handler 就不会被执行。流式 RPC 使用不同的 stream interceptor 签名，不能把 unary interceptor 直接套上去。",
    },
    {
      type: "heading",
      text: "响应 header 与 trailer",
    },
    {
      type: "code",
      title: "读取服务端附加信息",
      language: "go",
      code: 'var header, trailer metadata.MD\nbook, err := client.GetBook(\n  ctx,\n  req,\n  grpc.Header(&header),\n  grpc.Trailer(&trailer),\n)\nif err != nil {\n  return err\n}\nlog.Println("server version:", header.Get("x-service-version"))\nlog.Println("trace id:", trailer.Get("x-trace-id"))\n_ = book',
    },
    {
      type: "paragraph",
      text: "header 通常在响应消息前发送，trailer 在 RPC 结束时发送。它们适合版本、追踪或结果附加信息；如果调用失败，trailer 是否存在要看失败发生在生命周期的哪个阶段，客户端不能把它当作必有数据。",
    },
    {
      type: "quiz",
      question: "拦截器最适合承担哪类职责？",
      options: [
        "根据请求决定书籍库存并写入数据库",
        "统一记录方法、状态码和耗时，或执行边界认证",
        "把所有业务参数改成字符串",
        "替代 proto 定义服务方法",
      ],
      answer: 1,
      explanation:
        "日志、认证、指标和追踪属于跨多个 RPC 的横切逻辑，拦截器能统一处理；业务规则和数据读写仍应留在服务实现或领域层。",
    },
    {
      type: "exercise",
      title: "设计一条认证边界",
      description:
        "为 CatalogService 设计“客户端携带 token、服务端拦截器验证 token、handler 获取已验证身份”的流程。写出认证失败的 status code，并指出租户信息应来自哪里。",
      hint:
        "区分 token 的传输位置、token 的验证、身份对象的传递和业务权限检查；不要直接信任客户端自报的租户 ID。",
    },
    {
      type: "keypoints",
      items: [
        "metadata 承载请求范围的附加信息，不能替代强类型业务消息。",
        "服务端必须把 metadata 当作不可信输入并验证凭证。",
        "拦截器适合日志、认证、指标和追踪等横切逻辑。",
        "unary 与 stream 拦截器签名不同；header/trailer 的生命周期也不同。",
      ],
    },
  ],
};
