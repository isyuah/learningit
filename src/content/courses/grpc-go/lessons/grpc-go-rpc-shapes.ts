import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-rpc-shapes",
  courseSlug: "grpc-go",
  title: "四种 RPC 形状与选择",
  summary:
    "用调用双方的消息方向和完成条件，区分 unary、服务端流、客户端流与双向流，而不是只记 API 名称。",
  minutes: 28,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "gRPC 的四种 RPC 形状，本质上是在回答两个问题：请求是一个消息还是一串消息？响应是一个消息还是一串消息？形状一旦写入 proto，生成代码的调用方式、完成条件和错误处理都会随之变化。",
    },
    {
      type: "code",
      title: "CatalogService 的四种方法",
      language: "protobuf",
      code: 'service CatalogService {\n  rpc GetBook(GetBookRequest) returns (Book);\n  rpc ListBooks(ListBooksRequest) returns (stream Book);\n  rpc UploadBooks(stream Book) returns (UploadSummary);\n  rpc Recommend(stream RecommendationRequest) returns (stream Book);\n}',
    },
    {
      type: "table",
      caption: "按消息方向选择 RPC 形状",
      headers: ["形状", "请求", "响应", "适合的场景"],
      rows: [
        ["unary", "一个", "一个", "查询、创建、更新、删除和大多数普通业务命令"],
        ["服务端流", "一个", "多个", "结果逐步产生、结果集较大、订阅式读取"],
        ["客户端流", "多个", "一个", "上传、批量汇总、客户端分段发送的输入"],
        ["双向流", "多个", "多个", "双方持续交互，且两边消息节奏不必严格同步"],
      ],
    },
    {
      type: "heading",
      text: "unary 不是低级形状",
    },
    {
      type: "paragraph",
      text: "unary 调用最像普通函数：一次请求、一次响应或一个错误。它的边界最容易被网关、日志、超时和重试系统理解，所以默认应优先选它。不要为了“以后可能很多结果”提前上流式；分页的 unary 方法往往更容易观测、缓存和重试。",
    },
    {
      type: "heading",
      text: "流式方法改变了完成条件",
    },
    {
      type: "paragraph",
      text: "服务端流的调用在收到第一个 Book 后并没有完成，客户端必须持续 Recv，直到得到 io.EOF 或非 nil 错误。客户端流则要发送若干消息后 CloseSend，再等待一个最终响应。双向流中发送和接收可以交错进行，两边不能假设对方会在收到每条消息后立即回复。",
    },
    {
      type: "callout",
      variant: "example",
      title: "用用户问题而不是“酷不酷”来选流",
      body: "如果调用者只是想拿到前 20 本书，ListBooks 分页的 unary 更直接；如果服务端需要持续产生结果且调用者不想等待全部准备完，服务端流才有价值。如果客户端上传一批记录，客户端流可以减少单个超大请求，但要设计每条消息的校验和最终汇总。",
    },
    {
      type: "heading",
      text: "把业务语义写进消息",
    },
    {
      type: "paragraph",
      text: "流只解决传输中的多条消息，不会自动解决顺序、重复、断点续传、重连和背压。上传方法需要决定收到坏消息时是立即失败还是返回逐条结果；订阅方法需要决定断线后客户端是从头开始、按游标续传，还是接受丢失窗口。把这些语义写进 request、response 和文档，别让调用双方靠猜。",
    },
    {
      type: "quiz",
      question: "对于“给定过滤条件，逐步返回大量书目，客户端读完即结束”的场景，最自然的起点是什么？",
      options: [
        "unary，响应里无限追加字符串",
        "服务端流，客户端持续 Recv 直到 EOF",
        "客户端流，让客户端反复发送空请求",
        "双向流，因为所有流式方法都更快",
      ],
      answer: 1,
      explanation:
        "请求是一个过滤条件，响应由服务端产生多条消息，因此服务端流匹配这个方向。是否更快要通过工作负载验证，不能由“流式”一词直接推出。",
    },
    {
      type: "exercise",
      title: "为三个需求选择 RPC 形状",
      description:
        "为“查询一本书”“客户端上传 10 万条阅读记录”“客户端订阅推荐并随时发送新的偏好”分别选择 RPC 形状，并写出你需要补充的完成、断线和重复语义。",
      hint:
        "先只判断请求/响应方向，再检查分页、批量、重连和幂等是否会迫使你调整消息模型。",
    },
    {
      type: "keypoints",
      items: [
        "四种 RPC 形状由请求和响应的消息数量决定。",
        "unary 是默认选择，不是“低级选择”；它更容易观测和治理。",
        "流式调用的完成条件和错误处理不同，必须持续收发直到 EOF 或错误。",
        "流不会自动提供顺序、重复、断线续传或业务级背压语义。",
      ],
    },
  ],
};
