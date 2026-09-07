import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-streaming",
  courseSlug: "grpc-go",
  title: "流式 RPC：消息、方向与结束",
  summary:
    "用 Go 客户端实际读写服务端流、客户端流和双向流，建立 EOF、CloseSend 与并发收发的正确直觉。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "流式 RPC 不是“把一个大消息拆成很多小消息”这么简单。它改变了调用的生命周期：一次 RPC 内会有多次 Send/Recv，调用何时完成由消息方向和半关闭状态共同决定。只要没有把这些结束条件说清楚，服务就很容易出现 goroutine 泄漏、客户端永远等待或重复处理。",
    },
    {
      type: "heading",
      text: "先把三个方法写进契约",
    },
    {
      type: "code",
      title: "catalog.proto",
      language: "protobuf",
      code: 'service CatalogService {\n  rpc ListBooks(ListBooksRequest) returns (stream Book);\n  rpc UploadBooks(stream Book) returns (UploadSummary);\n  rpc Recommend(stream RecommendationRequest) returns (stream Book);\n}',
    },
    {
      type: "heading",
      text: "服务端流：一个请求，持续读取响应",
    },
    {
      type: "code",
      title: "读取服务端流",
      language: "go",
      code: 'stream, err := client.ListBooks(ctx, &pb.ListBooksRequest{Author: "知学出版社"})\nif err != nil {\n  return err\n}\n\nfor {\n  book, err := stream.Recv()\n  switch {\n  case err == io.EOF:\n    return nil // 服务端正常结束发送\n  case err != nil:\n    return err // 状态码或传输失败\n  default:\n    fmt.Println(book.GetTitle())\n  }\n}',
    },
    {
      type: "paragraph",
      text: "io.EOF 在这里不是异常，而是服务端明确结束响应流的信号。业务代码应把它与其他错误分开处理；如果 Recv 返回 codes.Canceled 或 codes.DeadlineExceeded，说明调用预算或取消已经结束，不应继续读取。",
    },
    {
      type: "heading",
      text: "客户端流：发送结束后再等最终结果",
    },
    {
      type: "code",
      title: "上传一批记录",
      language: "go",
      code: 'stream, err := client.UploadBooks(ctx)\nif err != nil {\n  return err\n}\n\nfor _, book := range books {\n  if err := stream.Send(book); err != nil {\n    return err\n  }\n}\n\nsummary, err := stream.CloseAndRecv()\nif err != nil {\n  return err\n}\nfmt.Println(summary.GetAccepted(), summary.GetRejected())',
    },
    {
      type: "paragraph",
      text: "CloseAndRecv 的语义是“我不再发送了，请服务端完成剩余处理并给我最终响应”。它不是关闭整个 TCP 连接，也不等于服务端一定已经成功处理所有消息；最终结果和 status code 仍必须检查。",
    },
    {
      type: "heading",
      text: "双向流：发送和接收是两个节奏",
    },
    {
      type: "code",
      title: "双向流的典型结构",
      language: "go",
      code: 'stream, err := client.Recommend(ctx)\nif err != nil {\n  return err\n}\n\nsendDone := make(chan error, 1)\ngo func() {\n  defer close(sendDone)\n  for _, preference := range preferences {\n    if err := stream.Send(preference); err != nil {\n      sendDone <- err\n      return\n    }\n  }\n  sendDone <- stream.CloseSend()\n}()\n\nfor {\n  book, err := stream.Recv()\n  if err == io.EOF {\n    break\n  }\n  if err != nil {\n    return err\n  }\n  fmt.Println("recommendation:", book.GetTitle())\n}\nreturn <-sendDone',
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要在一个 goroutine 里假设发送和接收严格交替",
      body: "双向流常见的安全结构是发送和接收分别运行，并通过 context、错误通道和明确的 CloseSend 协调结束。生产代码还要限制待发送队列，避免业务生产速度超过网络和服务端消费速度。",
    },
    {
      type: "heading",
      text: "流式设计需要补上的业务语义",
    },
    {
      type: "table",
      caption: "不要把传输行为误当成业务保证",
      headers: ["问题", "需要由业务定义什么"],
      rows: [
        ["消息顺序", "是否按发送顺序处理，还是每条消息可独立处理"],
        ["重复消息", "是否带 request_id、sequence 或幂等键"],
        ["中途失败", "已处理消息是否保留，客户端如何重试剩余部分"],
        ["断线恢复", "从头重放、按游标续传，还是接受丢失窗口"],
        ["结束信号", "谁关闭发送，谁决定正常完成，最终响应包含什么"],
      ],
    },
    {
      type: "quiz",
      question: "服务端流客户端收到 io.EOF 时，通常应该如何理解？",
      options: [
        "服务端返回了一个业务异常",
        "服务端正常结束了响应流，可以结束读取",
        "客户端连接一定已经断开，需要立刻重试",
        "必须继续调用 Recv，直到收到 nil",
      ],
      answer: 1,
      explanation:
        "在 gRPC-Go 的流式读取中，io.EOF 表示对端正常结束发送。它和带 status code 的 RPC 错误不同；是否重试还要看方法语义和调用上下文。",
    },
    {
      type: "exercise",
      title: "为上传流补充失败协议",
      description:
        "设计 UploadBooks 的消息和错误策略：第 7 条记录校验失败时，是立即终止整条流，还是在最终 UploadSummary 中返回逐条结果？说明客户端如何避免重试前 6 条造成重复写入。",
      hint:
        "把“传输层失败”和“单条业务拒绝”分开建模，再决定是否需要幂等键或游标。",
    },
    {
      type: "keypoints",
      items: [
        "服务端流持续 Recv 到 io.EOF 或错误；EOF 是正常结束信号。",
        "客户端流发送完成后要 CloseSend，并检查最终响应与错误。",
        "双向流中发送和接收可能有不同节奏，通常要分别协调。",
        "流不自动提供顺序、去重、断点续传或业务背压，需要写进契约。",
      ],
    },
  ],
};
