import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-capstone",
  courseSlug: "grpc-go",
  title: "综合练习：交付 CatalogService",
  summary:
    "把契约、实现、生命周期、安全、可靠性和运维要求合并成一个可解释、可验证的 gRPC 服务交付。",
  minutes: 42,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "前面的课时分别拆开了 gRPC 的关键能力。现在把它们放回一个交付任务：你要为内部阅读平台实现 CatalogService。目标不是堆满功能，而是让每个选择都能解释边界、失败路径和验证方式。",
    },
    {
      type: "heading",
      text: "项目约束",
    },
    {
      type: "list",
      items: [
        "GetBook：按 ISBN 查询一本书，未找到时返回 NotFound。",
        "ListBooks：按作者过滤并以分页 unary 或服务端流实现，说明选择理由。",
        "RecordReading：记录一次阅读事件，必须支持 event_id 去重。",
        "服务端使用 TLS；认证信息通过 metadata 传入，授权按 tenant_id 判断。",
        "所有 RPC 都接受 deadline；服务端把 context 传给存储层。",
        "提供 health service、reflection 的环境策略和带超时的优雅停机。",
        "记录方法、status code、耗时、request id 和重试次数，但不得记录 token。",
      ],
    },
    {
      type: "heading",
      text: "第一步：冻结 proto 契约",
    },
    {
      type: "code",
      title: "建议的契约骨架",
      language: "protobuf",
      code: 'syntax = "proto3";\n\npackage catalog.v1;\noption go_package = "example.com/catalog/gen/catalogv1";\n\nservice CatalogService {\n  rpc GetBook(GetBookRequest) returns (Book);\n  rpc ListBooks(ListBooksRequest) returns (ListBooksResponse);\n  rpc RecordReading(RecordReadingRequest) returns (RecordReadingResponse);\n}\n\nmessage GetBookRequest { string isbn = 1; }\nmessage ListBooksRequest {\n  string author = 1;\n  int32 page_size = 2;\n  string page_token = 3;\n}\nmessage ListBooksResponse {\n  repeated Book books = 1;\n  string next_page_token = 2;\n}\nmessage RecordReadingRequest {\n  string event_id = 1;\n  string isbn = 2;\n  string tenant_id = 3;\n}\nmessage RecordReadingResponse { bool accepted = 1; }\nmessage Book {\n  string isbn = 1;\n  string title = 2;\n  string author = 3;\n}',
    },
    {
      type: "paragraph",
      text: "这是一个起点，不是唯一答案。你需要补充哪些字段应由服务实际调用方决定。注意 RecordReading 的 tenant_id 不能直接作为授权依据；它最多是业务资源的一部分，真正的租户身份应来自已验证的调用凭证。",
    },
    {
      type: "heading",
      text: "第二步：写出失败矩阵",
    },
    {
      type: "table",
      caption: "交付前必须能回答的失败场景",
      headers: ["场景", "服务端结果", "客户端动作"],
      rows: [
        ["ISBN 为空", "InvalidArgument", "修正请求，不重试"],
        ["书不存在", "NotFound", "显示缺失或走创建流程"],
        ["token 无效", "Unauthenticated", "刷新凭证或终止调用"],
        ["租户无权访问", "PermissionDenied", "不重试并记录授权事件"],
        ["存储暂时不可用", "Unavailable 或 ResourceExhausted", "仅对幂等读操作有限退避"],
        ["RecordReading 响应丢失", "客户端结果未知", "带 event_id 查询或安全重放"],
        ["服务收到 SIGTERM", "readiness 先下线", "等待已有调用，超时后强停"],
      ],
    },
    {
      type: "heading",
      text: "第三步：验证而不是只运行",
    },
    {
      type: "exercise",
      title: "完成 CatalogService 交付清单",
      description:
        "实现或设计这个服务，并提交一份短 README，包含 proto 兼容策略、RPC 形状选择、错误码表、TLS/认证边界、重试条件、健康检查和停机顺序。至少写 5 个测试或验证场景，覆盖一个成功路径和四个失败路径。",
      hint:
        "先画调用链：客户端 context → metadata/interceptor → handler → repository → status response。每个箭头都标出取消、错误和日志边界。",
    },
    {
      type: "heading",
      text: "验收标准",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "重新生成代码后，客户端与服务端都从同一份 proto 编译。",
        "空输入、缺失资源、认证失败和存储故障返回可区分的 status code。",
        "RecordReading 使用 event_id 保证重复请求不会重复记账。",
        "每次下游调用都继承 context，超时后不会继续无界工作。",
        "TLS 的服务名与信任根校验有效，测试中没有关闭校验。",
        "收到停机信号后先摘流量，再等待并在超时后 Stop。",
        "日志能定位方法和阶段，但不包含 token 或敏感业务内容。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "判断自己是否真的学会",
      body: "不要只检查“客户端能拿到一本书”。请故意制造 response 丢失、服务端延迟、token 过期、重复 event_id、证书域名错误和 SIGTERM 中断，再解释系统为什么这样表现、客户端应该做什么、哪些动作绝对不能做。",
    },
    {
      type: "quiz",
      question: "RecordReading 的响应丢失时，最稳妥的设计是什么？",
      options: [
        "认为服务端一定没有写入，直接生成新的 event_id 重试",
        "使用原 event_id 查询或重放，让服务端以幂等键去重",
        "把 status code 改为 OK 并忽略结果",
        "关闭 deadline，等待客户端永远收到响应",
      ],
      answer: 1,
      explanation:
        "响应丢失只能说明客户端没有得到确定结果，服务端可能已经写入。沿用同一 event_id 查询或重放，服务端去重，才能把不确定结果变成安全的业务操作。",
    },
    {
      type: "keypoints",
      items: [
        "交付 gRPC 服务要同时验收契约、实现、生命周期、安全和运维。",
        "失败矩阵比 happy path 更能说明服务是否可用。",
        "幂等键把“响应未知”转化为可查询、可安全重放的业务状态。",
        "真正的完成标准是能解释故障行为并用测试或工具验证。",
      ],
    },
  ],
};
