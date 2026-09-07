/* ==================================================================
 * 课时：OpenTelemetry：统一数据模型（obs-otel-model）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 版本边界：OTel Go SDK 1.46（2026-08）；Logs API/SDK 随 v1.47 升 v1；
 * SemConv：HTTP 稳定新版，db/messaging 实验。本课不展开 span 内部结构。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-otel-model",
  courseSlug: "observability",
  title: "OpenTelemetry：统一数据模型",
  summary: "OTel 是什么、API/SDK 分离为何带来厂商中立、三种信号如何共享一套数据模型。",
  minutes: 28,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "三支柱一课（obs-three-pillars）让我们看清了指标、日志、追踪三种信号的形态与各自擅长回答的问题。现在设想回到没有 OTel 的时代：公司的 metrics 用厂商 A 的 SDK（私有协议），日志进厂商 B 的系统，traces 又选了厂商 C。于是两件可怕的事必然发生：其一，应用代码被迫 import 三套 SDK、初始化三套、遵守三份文档，换一家后端就要改代码重新发版——业务代码与遥测厂商深度绑定；其二，同一次 `POST /orders`，延迟指标躺在 A 的图表里，日志在 B 的检索框里，trace 在 C 的瀑布图里，三者没有任何公共标识，排障时只能在三套 UI 之间手工对照。本课讲清楚 OTel 如何终结这个局面：它是什么、API/SDK 分离如何保证厂商中立、三种信号如何共享同一套数据模型。至于 span 树内部长什么样，那是下一课（obs-trace-model）的事。",
    },
    {
      type: "heading",
      text: "OTel 是什么",
    },
    {
      type: "paragraph",
      text: "OpenTelemetry（后文统一简称 OTel）是 CNCF 托管的开源项目，2019 年由两个互相竞争的标准化尝试 OpenTracing 与 OpenCensus 合并而来——那次合并本身就是业界对「重复造标准代价高昂」的一次承认。它由三件套构成：**规范（Specification）**定义跨语言通用的数据模型与命名，回答「写什么、叫什么」；**各语言 SDK** 实现这套规范，把埋点变成真实数据（Go 的官方 SDK 在 2026-08 的版本为 1.46）；**Collector** 是与语言无关的接收/处理/转发组件，课程后面有专门一课（obs-collector）。成熟度现状（2026-09 核实）：tracing 与 metrics 的 API 早已 v1 稳定，Logs 的 Go API/SDK 正随 v1.47 从 rc 升为 v1 稳定（1.47.0-rc.1 已发布）——也就是说，现在按这些 API 写业务埋点是安全的；而语义约定仍在演进：HTTP 语义约定已稳定新版（`http.request.method`、`url.path` 取代已废弃的 `http.method`、`http.route`），`db`、`messaging` 等仍属实验/开发中，动手前要核对官方文档的版本状态。",
    },
    {
      type: "definition",
      term: "Instrumentation（埋点 / 插桩）",
      definition: "在应用中产生遥测数据的动作与代码，OTel 术语里直接叫 instrumentation。两种形态：手动埋点（业务代码里显式创建 span、记录指标、写日志）与自动埋点（由库与框架的钩子代为产生，例如 HTTP 中间件、数据库驱动包装，Go 生态多在 contrib 仓库提供）。每条被产生的遥测记录都会附带来源信息 InstrumentationScope——哪个库、什么版本产生的。",
    },
    {
      type: "definition",
      term: "Resource（资源）",
      definition: "描述遥测数据「来自哪个运行实体」的元数据，粒度为进程/服务级，随该实体产出的每一条信号携带。最小集合含 `service.name`（本课程服务为 `shop`），通常还有 `deployment.environment.name`（如 `dev`）。一句话区分：Resource 回答「谁产生的」，Attribute 回答「这一次记录的具体内容」。Resource 到达后端后通常成为可过滤维度，写错 `service.name` 等于让所有信号进错家门。",
    },
    {
      type: "definition",
      term: "Semantic Convention（语义约定，可写 SemConv）",
      definition: "OTel 为属性 key 与取值制定的「通用字典」：什么场景用哪个 key、含义与取值规则是什么。例如 HTTP 服务端 span 上稳定使用 `http.request.method=POST` 与 `url.path=/orders`，而不是各团队自创 `request.method` 或 `path`。只有大家都遵守同一本字典，跨语言、跨团队、跨工具的数据才能互相查询与理解。约定带版本（schema），稳定与实验状态并存，以官方文档为准。",
    },
    {
      type: "definition",
      term: "OTLP（OpenTelemetry Protocol）",
      definition: "OTel 定义的传输协议，把三种信号统一序列化，在 SDK 与 Collector 之间、Collector 与后端之间搬运。它是 OTel 家族的默认通信语言：业务侧不必关心最终后端用哪种私有协议。本课只需记住它的位置，协议与配置细节放到 Collector 一课（obs-collector）。",
    },
    {
      type: "heading",
      text: "API/SDK 分离：厂商中立为什么能成立",
    },
    {
      type: "paragraph",
      text: "OTel 最核心的工程决策，是把「埋点 API」与「导出 SDK」拆成两层，业务代码只见前者。用 Go 来说：业务代码 import 的是 `go.opentelemetry.io/otel` 暴露的 Tracer、Meter、Logger 接口与 provider 存取函数，只表达「我想记录什么」；真正干活的是 SDK 层——进程启动处装配的 TracerProvider / MeterProvider / LoggerProvider，它们持有 exporter，决定记录被送到哪里、是否批量、如何采样。这个拆分带来三个直接推论。第一，exporter 只是可替换的适配器：目标后端（Tempo、Prometheus、任何兼容 OTLP 的商业后端）只是装配时的配置，换后端只改启动代码的几行，业务埋点一行不动——厂商中立由此而来。第二，测试友好：测试环境装配内存 exporter 或干脆不装配 SDK；未装配时 OTel API 是安全的 no-op，程序照常运行，埋点代码永远不会成为崩溃源，可以先写埋点、后配导出。第三，关注点分离：业务开发者只学一套 API，导出拓扑交给平台/运维侧决定。这本质上是面向接口编程在遥测领域的落地。",
    },
    {
      type: "code",
      title: "otel-go 最小装配：trace 一条管线",
      language: "go",
      code: `// setupOTel 在进程启动时装配 SDK。业务代码只 import API 层，
// 数据送往哪里由本函数里的 exporter 决定（换后端 = 只改这里）。
package main

import (
    "context"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func setupOTel(ctx context.Context) (func(context.Context) error, error) {
    // 1) Resource：这段代码运行在哪个服务上（键名遵循 SemConv）
    res, err := resource.New(ctx,
        resource.WithAttributes(
            attribute.String("service.name", "shop"),
            attribute.String("deployment.environment.name", "dev"),
        ),
    )
    if err != nil {
        return nil, err
    }

    // 2) Trace exporter：把 span 序列化成 OTLP 发出
    //    默认目标为本地 Collector（localhost:4317，见 obs-collector 一课）
    traceExporter, err := otlptracegrpc.New(ctx)
    if err != nil {
        return nil, err
    }

    // 3) SDK 装配：TracerProvider = resource + 导出管线（默认批量导出）
    tp := sdktrace.NewTracerProvider(
        sdktrace.WithResource(res),
        sdktrace.WithBatcher(traceExporter),
    )
    otel.SetTracerProvider(tp) // API 层的 GetTracerProvider 从此返回真实实现

    // 4) Metrics / Logs 装配同构：MeterProvider / LoggerProvider 配
    //    reader/exporter 后 SetMeterProvider / SetLoggerProvider；日志 API
    //    随 Go SDK v1.47 稳定。两段的具体签名以官方文档为准，本课不展开。
    return tp.Shutdown, nil // 进程退出前 flush 缓冲中的 span
}`,
    },
    {
      type: "heading",
      text: "统一数据模型：三种信号共用一套骨架",
    },
    {
      type: "paragraph",
      text: "Metrics、Logs、Traces 的数据形态完全不同——时序数值、带时间戳的记录、嵌套树。OTel 的「统一」不是把三者合并成一种结构，而是让三种信号共用同一套携带框架：每一条 span、每一条 log record、每一个 metric datapoint 都附带三样东西——(1) **Resource**（来自哪个服务、什么环境）；(2) 一批 **Attribute**（key-value，含义由 SemConv 定义；metric 上它们会成为时序的维度，详见 Prometheus 数据模型一课 obs-prometheus-model）；(3) **InstrumentationScope**（这条记录由哪个埋点库、什么版本产生）。这套骨架带来两个实际好处。其一，同一服务的三种信号天然带着 `service.name=shop`，在任何后端里都能按服务聚合与过滤。其二，跨信号关联有了共同的挂点：log record 可以携带 `trace_id` 指向同一次请求的 trace，metric datapoint 可以通过 exemplar 挂上代表性 trace——两者的机制分别在结构化日志一课（obs-structured-logging）与 Exemplar 一课（obs-exemplars-bridges）展开，本课先不深入。",
    },
    {
      type: "callout",
      variant: "note",
      title: "「一次埋点，多条信号」的边界",
      body: "装配时 trace/metric/log 三条管线可以同时开启：同一次请求的代码路径里既建 span 又记日志，它们借助共享的上下文携带同一个 TraceID（跨服务如何传递见 obs-sampling-propagation）。至于把既有日志框架（如 Go 的 log/slog）桥接进 OTel、以及指标点通过 exemplar 反查 trace 这类「桥」机制，一句话带过：它们都存在、都有各自课时，本课掌握统一骨架即可。",
    },
    {
      type: "keypoints",
      items: [
        "OTel = 规范 + 各语言 SDK + Collector（CNCF 项目，由 OpenTracing/OpenCensus 合并而来）；2026-09：tracing/metrics API 稳定，Logs 随 Go SDK v1.47 升 v1",
        "厂商中立不是口号：API/SDK 分离让业务代码只见 API，exporter 在装配时可整体替换，换后端不改埋点",
        "Resource 回答「谁产生的」（service.name），Attribute 回答「这一次记录的内容」，InstrumentationScope 回答「哪个埋点库产生的」",
        "三种信号形态不同，但共用 Resource / Attribute / OTLP 这一套骨架；跨信号关联靠共享 ID（trace_id、exemplar），桥接机制在后续课时",
        "不装配 SDK 时 OTel API 是安全的 no-op：埋点可以先写，导出后配；SemConv 的键名以官方最新稳定版为准",
      ],
    },
  ],
};
