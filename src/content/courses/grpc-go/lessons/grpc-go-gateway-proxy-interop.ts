import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-gateway-proxy-interop",
  courseSlug: "grpc-go",
  title: "网关、代理与跨协议互操作",
  summary:
    "区分 grpc-gateway、L7 代理与 grpc-web，理解 HTTP/JSON 到 gRPC 的映射、边界认证和兼容性代价。",
  minutes: 36,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "gRPC 很适合服务之间的类型化调用，但浏览器、第三方集成和现有 HTTP 客户端未必能直接使用原生 gRPC。网关和代理可以提供适配层，关键是先明确它们解决的是协议入口、路由治理还是浏览器传输问题，不要把“加一个代理”当作架构答案。",
    },
    {
      type: "table",
      caption: "三类边界组件的职责",
      headers: ["组件", "主要作用", "需要警惕什么"],
      rows: [
        ["grpc-gateway", "按 proto/HTTP 注解生成 HTTP/JSON 到 gRPC 的反向代理", "JSON 映射、错误映射、流式能力和额外延迟"],
        ["L7 代理/网关", "TLS 终止、路由、限流、负载均衡、访问日志和策略", "代理与后端的身份边界、重试放大、header 传递"],
        ["grpc-web 代理", "让浏览器通过支持的浏览器传输访问 gRPC 服务", "浏览器侧能力和代理协议限制，不等于原生 gRPC"],
      ],
    },
    {
      type: "heading",
      text: "用 proto 声明 HTTP 映射",
    },
    {
      type: "code",
      title: "google.api.http 注解示意",
      language: "protobuf",
      code: 'import "google/api/annotations.proto";\n\nservice CatalogService {\n  rpc GetBook(GetBookRequest) returns (Book) {\n    option (google.api.http) = {\n      get: "/v1/books/{isbn}"\n    };\n  }\n}',
    },
    {
      type: "paragraph",
      text: "网关根据注解把 HTTP method、path、query 和 body 映射到 gRPC request，再把响应映射回 JSON。这样可以让一个服务契约产生两种入口，但也意味着 proto 同时承担 RPC 语义和公开 HTTP 兼容性，变更字段名、枚举和错误结构时要评估两侧影响。",
    },
    {
      type: "heading",
      text: "JSON 映射不是无损转换",
    },
    {
      type: "list",
      items: [
        "proto 字段名可能以 lowerCamelCase 出现在 JSON，客户端不能只凭 Go 字段名猜测。",
        "枚举、bytes、64 位整数和 Timestamp 有各自的 JSON 表示规则。",
        "gRPC status code 需要映射成 HTTP 状态和错误 body，不能假设两套状态一一对应。",
        "metadata 中的认证、trace id 和租户信息要明确哪些能被 HTTP header 传入。",
        "双向流和浏览器请求的能力可能受网关/代理版本限制，应按实际实现验证。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "网关不应复制业务逻辑",
      body: "HTTP 到 gRPC 的转换、认证入口和协议错误映射可以在网关处理；库存、租户授权和幂等写入仍应由 gRPC 服务负责。否则 HTTP 客户端和原生 gRPC 客户端会走出两套不一致的业务规则。",
    },
    {
      type: "heading",
      text: "代理重试与后端重试要分层",
    },
    {
      type: "paragraph",
      text: "如果网关对 Unavailable 自动重试，客户端也对同一请求重试，服务端还配置了重试，三层叠加会迅速放大负载。应明确哪一层拥有重试策略、哪一层知道幂等性、哪一层负责最终 deadline，并在日志中记录 attempt 来源。",
    },
    {
      type: "heading",
      text: "如何选择入口",
    },
      {
      type: "table",
      caption: "按调用者与约束选择协议入口",
      headers: ["需求", "推荐起点", "原因"],
      rows: [
        ["内部服务到服务", "原生 gRPC", "强类型、代码生成、流式与统一状态模型"],
        ["公开 HTTP API 或浏览器", "HTTP/JSON 网关", "生态兼容、调试和缓存工具更成熟"],
        ["浏览器需要接近 gRPC 语义", "grpc-web 加受控代理", "适应浏览器传输能力并保留部分 gRPC 模型"],
        ["统一入口治理多种后端", "L7 代理/网关", "集中处理 TLS、路由、限流与观测"],
      ],
    },
    {
      type: "quiz",
      question: "为什么 HTTP/JSON 网关不应复制 CatalogService 的库存和授权逻辑？",
      options: [
        "因为网关不能解析 JSON",
        "因为会产生 HTTP 与原生 gRPC 两套业务语义，最终结果可能不一致",
        "因为 gRPC 服务不允许被 HTTP 调用",
        "因为所有网关都只能做 TLS 终止",
      ],
      answer: 1,
      explanation:
        "网关适合协议转换和边界策略，业务规则应由后端服务统一执行，否则不同入口会出现权限、幂等和错误处理差异。",
    },
    {
      type: "exercise",
      title: "为 CatalogService 设计双入口",
      description:
        "为 GetBook 和 RecordReading 设计原生 gRPC 与 HTTP/JSON 两个入口。列出 path、认证 header、错误映射、幂等键传递和网关/后端各自负责的逻辑。",
      hint:
        "先画协议转换边界，再检查字段命名、status code、metadata 和重试是否在转换后仍能表达。",
    },
    {
      type: "keypoints",
      items: [
        "grpc-gateway 负责 HTTP/JSON 与 gRPC 的映射，L7 代理负责更广的治理边界。",
        "JSON 映射、错误码、metadata 和流式能力都有兼容性代价。",
        "网关不应复制业务逻辑，认证和授权边界要明确。",
        "重试应由一层主导，避免客户端、网关和服务端叠加放大。",
      ],
    },
  ],
};
