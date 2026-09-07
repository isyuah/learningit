/* ==================================================================
 * 课时：采样与跨服务传播（obs-sampling-propagation）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-sampling-propagation",
  courseSlug: "observability",
  title: "采样与跨服务传播",
  summary: "traceparent 如何把追踪上下文带过服务边界；为什么必须采样、head/tail/parent-based 的取舍；OTel Go 里如何配置。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "第 obs-trace-model 课里，我们说一个 Trace 由跨进程的 Span 组成——请求从 shop 的 order 组件出发，调用 payment，再调用 stock，每一跳都新增一个子 Span。但那里藏着一个被刻意跳过的问题：payment 服务收到 HTTP 请求时，它怎么知道「我现在属于哪个 Trace」？答案是传播（propagation）——由传播器（propagator）把 SpanContext 注入（inject）到外发请求、从入站请求提取（extract）出来，让追踪身份跟着 HTTP 头跨过进程边界。而一旦面对真实流量，第二个问题接踵而至：每个请求都要完整记录吗？在高流量服务上答案是做不到，于是要引入采样（sampling）。这一节把两件事讲透：上下文怎么传，数据怎么取舍。",
    },
    {
      type: "heading",
      text: "W3C Trace Context：traceparent 的格式",
    },
    {
      type: "paragraph",
      text: "追踪上下文如果不能跨实现互通，OTel、Jaeger、Zipkin 各自为政，调用链会在服务边界断裂。W3C 为此制定了 Trace Context 规范，OTel 把它作为默认传播格式。规范里有两个头：`traceparent` 携带核心身份，`tracestate` 携带厂商扩展。`traceparent` 是四段以连字符分隔的十六进制字段，格式为 `version-traceid-spanid-flags`。用 shop 的一个请求做例子：`00-463ac35c9f6413ad48485a3953bb6124-00f067aa0ba902b7-01`。version 占 2 个 hex 字符（当前为 `00`）；trace-id 占 16 字节、即 32 个 hex 字符，全局唯一标识一个 Trace；span-id 占 8 字节、即 16 个 hex 字符，标识「当前正在处理的这个 Span」——父进程发起子请求时把自己的 span-id 写在这里；flags 占 2 个 hex 字符，是位图，本课只需关心最低的 sampled 位：`01` 表示这条 trace 已被采样、应被记录，`00` 表示未采样，其余位保留、接收方应忽略未知位。`tracestate` 则是一串 `vendor=value` 逗号分隔的键值，供 Jaeger 等实现附带各自的私有上下文，随 traceparent 一起传播、各厂商可互相增删——一句话理解：traceparent 是大家都读得懂的身份证，tracestate 是各自口袋里放私有纸条的口袋。",
    },
    {
      type: "paragraph",
      text: "与追踪身份相伴的还有 Baggage：它通过 `baggage` 头传播，是随请求携带的任意业务键值对，任何下游服务都能读到。诱惑在于「免费随请求传递」，风险也正源于此——Baggage 里的每个键值会跟着请求到达所有下游，且常被附加到 Span 或日志上：一旦有人把邮箱、手机号、身份证放进去，就等于把 PII 复制到了每一个服务和存储后端，这是隐私事故的经典来源。经验法则：只放基数低、已脱敏、排障真正用得到的标识（如 `shop.tier=premium`），绝不放用户身份字段。",
    },
    {
      type: "heading",
      text: "为什么要采样：全量追踪的成本与代价",
    },
    {
      type: "paragraph",
      text: "一个未采样的高流量服务，追踪数据的增长速度超出直觉。每个请求在 order、payment、stock 之间穿梭，平均产生几十个 Span；每个 Span 要携带名称、时间戳、状态和若干属性（HTTP 方法、URL、SQL、错误），落库后还要被索引、压缩、长期保存。假设 shop 每秒处理 500 个下单请求、每请求 30 个 Span，一天就是约 13 亿个 Span——存储、传输、查询成本都随流量线性膨胀，而其中绝大多数是健康、重复、排障时没人会看的请求。为 99.9% 的冗余数据付费显然不划算，这就是采样的出发点：只保留有代表性、又覆盖关键路径的子集。但采样永远在「覆盖」与「成本」之间交易，最痛的一刀是：如果错误本身很罕见（比如 shop 只有 0.1% 的下单会超时），而采样率是 10%，一次真实故障被完整记录的概率就只有约万分之一——指标曲线（错误率上升）会诚实报警，可你去 Tempo 翻那条出错 trace 时，它可能根本没被记录。对策不是放弃采样，而是分层设计与为指标样本挂 trace 引用（下一课 Exemplar 的主题）。",
    },
    {
      type: "heading",
      text: "head-based 与 tail-based：决策在哪里做",
    },
    {
      type: "table",
      caption: "两种采样范式的取舍",
      headers: ["维度", "head-based（头部采样）", "tail-based（尾部采样）"],
      rows: [
        ["决策时机", "Span 创建时（请求刚进入、整棵树尚未成形）", "Span 树完整到达 Collector、缓冲收齐之后"],
        ["能看到什么", "只有当前这一跳的信息（哪个端点、是否健康、TraceID 本身）", "整棵树的形状：总延迟、是否含错误、哪些服务参与"],
        ["优点", "实现简单、零额外缓冲、应用内即可完成，几乎不增加延迟", "决策依据充分——可做到「凡含错误或超慢的树全保留」"],
        ["缺点", "无法预知这棵树后来会不会变慢/出错，固定概率会漏掉尾部重要的树", "Collector 必须为全部流量做缓冲与等待，内存与延迟成本高"],
        ["典型场景", "大多数 OTel 部署的默认选择；中低流量服务", "高价值、必须保住低频错误的路径（如支付），由 Collector 承担"],
      ],
    },
    {
      type: "paragraph",
      text: "两种范式之外还有两个常被并列提起的概念。parent-based（基于父级的采样）不直接做概率决策，而是「继承上游的决定」：请求携带的 traceparent 标记 sampled=1 就继续采，否则就不采，只有本地发起的根 Span（无上游上下文）才应用配置的根采样器。这是分布式一致性最关键的一环：如果每个服务各自独立掷骰子，order 决定采样而 payment 判定不采，Tempo 里就只剩根和前半截、中间断了一截的「半棵树」，几乎无法用于延迟分析。优先级采样（priority sampling）则以 Jaeger 为代表：在传播的上下文里带一个采样优先级标记，让下游能覆盖默认决策（例如已知的重要请求强制全采），与 tracestate 的厂商字段机制同源。工程上 head-based + parent-based 的组合覆盖绝大多数需求；tail-based 需要在 Collector 缓冲完整 trace，属于高成本手段，配置位置与代价在第 obs-collector 课展开。",
    },
    {
      type: "code",
      title: "OTel Go SDK：采样器与传播器配置",
      language: "go",
      code: `import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    "go.opentelemetry.io/otel/propagation"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func setupTracerProvider(ctx context.Context) (*sdktrace.TracerProvider, error) {
    exporter, err := otlptracegrpc.New(ctx) // 端点默认 localhost:4317，走 OTLP/gRPC
    if err != nil {
        return nil, err
    }

    // 根采样器：10% 概率。TraceIDRatioBased 的判定只依赖 trace-id 本身，
    // 规范上应保证同一 trace-id 在各进程得到一致结论——与 parent-based
    // 配合时不会因各服务独立掷骰子而撕裂同一棵树。
    ratio := sdktrace.TraceIDRatioBased(0.1)

    // ParentBased 包装：本地根 Span 用 10% 概率；
    // 一旦收到上游已采样/未采样的合法上下文，一律继承，不再自行决策。
    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exporter),
        sdktrace.WithSampler(sdktrace.ParentBased(ratio)),
        // 生产环境还需 sdktrace.WithResource(...) 附加 Resource
        // （service.name=shop 等，构造见官方 sdk/resource 文档）。
    )
    otel.SetTracerProvider(tp)

    // 传播器默认是 No-Op，必须显式设置：
    // TraceContext{} 负责 traceparent/tracestate，Baggage{} 负责 baggage 头。
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{},
        propagation.Baggage{},
    ))
    return tp, nil
}

// 诊断期对照：
// sdktrace.AlwaysSample() —— 全采；sdktrace.NeverSample() —— 全不采
// sdktrace.ParentBased(sdktrace.AlwaysSample()) —— SDK 默认组合`,
    },
    {
      type: "paragraph",
      text: "上面示例里的 ParentBased 是 OTel Go SDK 的默认采样器（默认组合为 `ParentBased(AlwaysSample)`），它保证了「采」与「不采」沿整条调用链一致——要么整棵树都在，要么整棵树都不在。另一点要留意：采样器只决定「要不要记录」，真正让上下文跨服务流动还需要把传播器接到 HTTP 上——`otelhttp`（`go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp`）中间件在服务端/客户端自动完成 extract/inject；若服务没有走这类框架埋点而是自己管理请求头，就要手动调用 `otel.GetTextMapPropagator().Extract/Inject`（配合 `propagation.HeaderCarrier`），具体接入以官方 otelhttp 文档为准。这一步漏掉，trace 会在服务边界断裂，parent-based 的继承也无从谈起。",
    },
    {
      type: "heading",
      text: "工程决策：采样率怎么定",
    },
    {
      type: "paragraph",
      text: "采样率没有万能数字，答案是按路径分层。以 shop 为例：`GET /healthz` 是探活流量，高频、永远健康、排障价值为零，采样率可压到接近 0；`POST /payments` 回调涉及真实资金，且故障场景正需要完整链路，应当高保真——甚至全采；`GET /orders/{id}` 这类普通读接口按流量规模给 1%–10% 即可。同一端点还能按结果分层：错误响应永远全采、成功响应按比例抽采——tail-based 能精确做到「按树的内容」决定，head-based 下则在应用代码里对错误路径显式保住。此外采样率不是一次性决策：流量涨十倍而采样率不变，成本跟着涨十倍；压采样率前，先确认对「低频错误覆盖」的容忍度。最后记住校准闭环——采样率变了，Tempo 里能查到的样本分布就变了，SLO 与告警的解读（第 obs-slo 课）必须基于同一套采样策略。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "跨服务采样不一致 = 半棵树",
      body: "采样决策必须在整条调用链上保持一致，这靠 parent-based 继承实现。任何「本服务独立随机采样」的做法——无论出于省本服务导出量的好意，还是配置了不带 ParentBased 包装的独立概率采样器——都会把 trace 拦腰截断，产生大量无法使用的半棵树，比不采样更浪费存储与排障时间。跨团队协作时同样如此：A 服务压采样率而 B 服务未同步，表现为 B 视角的错误 trace 大量缺失。采样率是全局配置，改动要走评审、注明生效时间，否则「为什么这条 trace 没了」会成为最常被问的问题。",
    },
    {
      type: "quiz",
      question: "shop 每天有极少量（约 0.05%）的下单请求会因 stock 的 SQLite 写锁而超时，这是你们最想抓住的故障。以下哪种采样方案最能保证「出错的那棵树」被完整保留下来？",
      options: [
        "所有服务统一配置 ParentBased(TraceIDRatioBased(0.01))：流量只有 1% 入库，成本最低",
        "head-based + 分层：健康请求 1% 概率采样，payment/stock 这类关键内部调用全采",
        "所有服务统一配置 ParentBased(TraceIDRatioBased(0.5))，把整体采样率提到 50%",
        "tail-based：Collector 缓冲完整 span 树，凡树中含错误状态的 Span 就整棵保留，健康树按比例抽采",
      ],
      answer: 3,
      explanation: "低频错误（0.05%）配合任何固定概率采样（选项 A/B/C 都属于 head-based 概率决策），在 Span 创建时都无法预知这棵树最终会不会出错——50% 采样率下每条出错请求也仅有一半概率被记录。tail-based 等整棵树到 Collector 收齐后按内容决策，「含错误即全保」，精确命中目标；代价是需要缓冲与更高 Collector 开销。",
    },
    {
      type: "keypoints",
      items: [
        "传播器（propagator）把 SpanContext 注入/提取到请求载体，让追踪身份跨服务传递；traceparent 四段格式为 version-traceid-spanid-flags：version 2 hex、trace-id 16 字节 32 hex、span-id 8 字节 16 hex、flags 2 hex，其中只关注最低 sampled 位",
        "tracestate 是厂商私有键值口袋；Baggage 随请求携带业务键值，但绝不能放 PII",
        "全量追踪的存储/传输成本随流量线性增长，高流量服务必须采样；代价是低频错误可能被采掉",
        "head-based 在 Span 创建时决策，简单便宜但看不到树的全貌；tail-based 等整棵树到 Collector 后决策，准但需要缓冲",
        "parent-based 继承上游 sampled 位，是保证「要么整棵树都在、要么都不在」的关键，也是 OTel Go SDK 的默认组合（ParentBased(AlwaysSample)）",
        "OTel Go 里用 sdktrace.TraceIDRatioBased / ParentBased / AlwaysSample 配置采样器，用 SetTextMapPropagator 装配 tracecontext 与 baggage",
        "工程上按端点与结果分层：健康检查低采样、支付等高价值路径高保真、错误响应优先保住",
      ],
    },
  ],
};
