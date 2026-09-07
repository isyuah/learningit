import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-discovery-balancing",
  courseSlug: "grpc-go",
  title: "服务发现与客户端负载均衡",
  summary:
    "从地址变化的问题出发，理解 resolver、service config、balancer 和连接子通道如何共同选择后端实例。",
  minutes: 36,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "单实例时，把 localhost:50051 写进客户端似乎足够；多实例后，这个地址只解决了“找到一个入口”，没有解决实例注册、地址变化、健康状态和请求分配。gRPC 客户端通常把这件事拆成名称解析和负载均衡两个阶段，让调用方不必在业务代码里维护后端列表。",
    },
    {
      type: "heading",
      text: "四个组件如何接力",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "客户端 target 选择一个 resolver scheme，例如 dns。",
        "resolver 把服务名解析为后端地址，并在地址变化时更新。",
        "service config 提供超时、重试和负载均衡策略等配置。",
        "balancer 根据地址和连接状态选择一个可用的 SubConn/Picker。",
        "生成的 client stub 只发起 RPC，不直接决定选哪台实例。",
      ],
    },
    {
      type: "paragraph",
      text: "这里的 resolver 不是业务服务发现数据库本身，而是把某种发现系统接入 gRPC channel 的适配层。它可以使用 DNS，也可以对接注册中心或控制平面。balancer 也不等于健康检查：它根据 resolver 地址和连接状态做选择，业务健康、依赖健康和路由权重仍需额外设计。",
    },
    {
      type: "heading",
      text: "从 pick_first 到 round_robin",
    },
    {
      type: "table",
      caption: "常见负载均衡策略的决策差异",
      headers: ["策略", "行为", "适合的起点"],
      rows: [
        ["pick_first", "尝试使用一个已连接地址，失败后再换地址", "实例相近、希望减少连接数的简单部署"],
        ["round_robin", "在多个可用地址之间轮转选择", "希望把请求分散到多个实例的普通服务"],
        ["自定义策略", "按权重、区域、延迟或业务标签选择", "有明确路由约束且能维护控制面的团队"],
        ["xDS/服务网格", "由控制平面下发更完整的路由与策略", "多集群、灰度、区域和复杂治理场景"],
      ],
    },
    {
      type: "code",
      title: "用 target 与 service config 选择 round_robin",
      language: "go",
      code: 'serviceConfig := "{\\\"loadBalancingConfig\\\":[{\\\"round_robin\\\":{}}]}"\n\nconn, err := grpc.NewClient(\n  "dns:///catalog.internal.example:443",\n  grpc.WithDefaultServiceConfig(serviceConfig),\n  grpc.WithTransportCredentials(creds),\n)\nif err != nil {\n  return err\n}\ndefer conn.Close()\n\nclient := pb.NewCatalogServiceClient(conn)',
    },
    {
      type: "paragraph",
      text: "示例表达的是配置关系，不是所有环境的最终部署配置。当前 gRPC-Go 版本、resolver scheme 和服务发现系统会影响可用策略；如果 service config 由 resolver 或控制平面下发，应明确哪个来源拥有最终决策权，避免客户端本地默认值悄悄覆盖平台策略。",
    },
    {
      type: "heading",
      text: "连接复用与故障转移",
    },
    {
      type: "paragraph",
      text: "一个 ClientConn 可以承载多个 RPC，balancer 会在连接状态变化时更新选择器。某个实例断开并不等于整个服务不可用，但正在执行的 RPC 是否能迁移、是否能重试，仍由调用语义和重试策略决定。尤其是已经产生副作用的写请求，不能因为 balancer 换了地址就假设可以安全重放。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要把地址列表硬编码进业务层",
      body: "硬编码实例地址会让扩缩容、滚动发布和故障摘除变成业务代码问题。即便暂时使用静态 resolver，也应把地址发现放在连接配置边界，并为地址变化、空地址和解析失败建立观测。",
    },
    {
      type: "heading",
      text: "自定义 resolver 的边界",
    },
    {
      type: "paragraph",
      text: "自定义 resolver 适合把已有注册中心接入 gRPC，但它只负责地址和配置更新，不应在 resolver 里偷偷做业务认证、数据库查询或请求级路由。更复杂的区域、权重和故障策略应由可测试的 balancer 或控制平面表达，并记录配置版本，方便排查“客户端为什么选了这台实例”。",
    },
    {
      type: "quiz",
      question: "resolver 和 balancer 的职责分别是什么？",
      options: [
        "resolver 负责执行业务方法，balancer 负责序列化 protobuf",
        "resolver 提供地址/配置更新，balancer 根据这些信息选择后端连接",
        "resolver 只在服务端使用，balancer 只在客户端业务代码使用",
        "二者都等同于健康检查服务",
      ],
      answer: 1,
      explanation:
        "resolver 把名称解析成地址并可更新配置，balancer 再根据地址和连接状态选择后端。健康检查、授权和业务路由可能与它们协作，但不是同一职责。",
    },
    {
      type: "exercise",
      title: "设计多实例服务发现",
      description:
        "假设 CatalogService 部署在三个实例、两个可用区，服务发现会返回地址和区域标签。选择 pick_first、round_robin、加权策略或控制平面方案，并说明实例下线、解析失败和跨区调用时的行为。",
      hint:
        "先明确目标是减少连接、均匀分配、区域亲和还是灰度路由，再决定 resolver 和 balancer 的职责边界。",
    },
    {
      type: "keypoints",
      items: [
        "服务发现解决“有哪些地址”，负载均衡解决“这次请求选谁”。",
        "resolver、service config 和 balancer 共同影响客户端选择，不应散落在业务代码。",
        "pick_first、round_robin、xDS/控制平面适合不同复杂度的部署。",
        "地址切换不等于 RPC 可以安全迁移或重试，副作用仍要按幂等语义处理。",
      ],
    },
  ],
};
