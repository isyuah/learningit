import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-mental-model",
  courseSlug: "grpc-go",
  title: "gRPC 到底解决什么问题",
  summary:
    "从一次跨进程调用的真实路径出发，理解 gRPC、HTTP/2、Protobuf、stub 与业务服务各自承担的责任。",
  minutes: 22,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "如果把 gRPC 当成“比 REST 更快的 HTTP API”，后面的很多决策都会变得模糊。更有用的理解是：gRPC 是一套让不同进程按照明确服务契约进行远程调用的框架。它把接口描述、代码生成、消息编解码、HTTP/2 传输、截止时间和错误模型串成了一条调用路径。",
    },
    {
      type: "heading",
      text: "先看一次调用发生了什么",
    },
    {
      type: "paragraph",
      text: "假设订单服务要向商品服务请求一本书。调用方写的是 client.GetBook(ctx, request)，但这不是本地函数调用。客户端 stub 会把方法名和请求消息编码后交给 gRPC client，client 再通过 HTTP/2 发出请求；服务端 gRPC runtime 解码请求，调用你实现的 GetBook 方法，再把响应或错误编码后发回客户端。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "业务代码构造请求消息，并传入 context。",
        "生成的 client stub 选择远程方法和消息类型。",
        "Protocol Buffers 负责把结构化消息编码成线上字节。",
        "gRPC runtime 使用 HTTP/2 stream 传输这次 RPC。",
        "服务端 runtime 解码消息并调用业务实现。",
        "响应、状态码、metadata 沿相反方向返回。",
      ],
    },
    {
      type: "definition",
      term: "RPC",
      definition:
        "Remote Procedure Call，远程过程调用。它让调用方用接近本地函数的形式表达跨网络请求，但不应让你忘记网络调用会延迟、失败、取消和部分完成。",
    },
    {
      type: "heading",
      text: "四个角色不要混为一谈",
    },
    {
      type: "table",
      caption: "一次 gRPC 调用中的职责分工",
      headers: ["角色", "负责什么", "不负责什么"],
      rows: [
        ["proto 契约", "描述服务方法、请求、响应和字段编号", "不负责数据库事务或业务规则"],
        ["生成代码", "提供 Go 消息类型、client 与 server 接口", "不自动实现你的业务逻辑"],
        ["gRPC runtime", "连接、编解码、HTTP/2 stream、状态与生命周期", "不替你决定重试是否安全"],
        ["业务实现", "校验输入、读写数据、返回业务结果", "不应自行拼装协议帧"],
      ],
    },
    {
      type: "heading",
      text: "为什么不是直接手写 HTTP/JSON",
    },
    {
      type: "paragraph",
      text: "手写 HTTP/JSON 并不一定错。它在浏览器直连、公开 API、需要人类直接阅读报文的场景里很自然。gRPC 的价值在于服务之间有稳定契约、调用语言可能不同、接口数量较多，并且你希望把序列化、客户端桩、流式调用和统一错误处理交给框架。",
    },
    {
      type: "callout",
      variant: "note",
      title: "gRPC 不等于自动高性能",
      body: "HTTP/2、多路复用和二进制 Protobuf 能改善某些工作负载，但真实效果仍取决于消息大小、连接复用、服务端处理、网络质量和部署拓扑。不要把“用了 gRPC”当作性能结论，应该用延迟、吞吐、错误率和资源消耗验证。",
    },
    {
      type: "heading",
      text: "本课程的统一心智模型",
    },
    {
      type: "paragraph",
      text: "后续每一节都沿着 CatalogService 展开。我们把 proto 当作跨团队协作的契约，把生成代码当作编译期边界，把 context 当作调用预算，把 status code 当作机器可判断的结果，把 metadata 当作请求附加信息，把 interceptor 当作横切边界。这样学到的不是一组孤立 API，而是一套能迁移到其他语言的服务设计方法。",
    },
    {
      type: "quiz",
      question: "下列哪项最准确地描述 gRPC client stub 的作用？",
      options: [
        "它会自动完成数据库查询和事务提交",
        "它把远程方法调用转换为客户端可使用的类型化调用，并交给 gRPC runtime 发送",
        "它只负责把 JSON 字符串放进 HTTP 请求",
        "它保证网络调用永远不会超时",
      ],
      answer: 1,
      explanation:
        "stub 通常由 proto 生成，负责提供类型化的客户端调用入口；连接、编解码和传输由 runtime 处理，业务逻辑仍由服务实现负责。网络调用的超时和失败必须显式处理。",
    },
    {
      type: "keypoints",
      items: [
        "gRPC 是服务契约、代码生成、消息编解码和传输生命周期的组合。",
        "远程调用看起来像函数调用，但必须按网络调用处理延迟、失败、取消和部分完成。",
        "proto、生成代码、runtime 和业务实现有不同职责。",
        "gRPC 是否合适取决于边界和约束，不是单纯的性能标签。",
      ],
    },
  ],
};
