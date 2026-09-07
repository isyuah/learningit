/* ==================================================================
 * 课时：OpenTelemetry Collector（obs-collector）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-collector",
  courseSlug: "observability",
  title: "OpenTelemetry Collector",
  summary: "在 SDK 与后端之间插入一层独立进程：统一三种信号的接收、边缘处理（批处理/重试/过滤）与多后端分发。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "走到这里，前几课已经把三条信号都讲完了：用 OTel SDK 在进程里生成 trace（第 4 课）、用 client_golang / OTel API 生成 metrics（第 6 课）、用 slog 输出结构化日志（第 9 课）。但它们都停在一个悬而未决的问题上：数据「发送到哪」。如果每个服务各自直连后端，就会出现一批棘手的重复劳动——换一家厂商要改每个服务的配置，换一种语言要把导出逻辑再写一遍，批处理、重试、脱敏、采样这些横切关注点散落在每个进程里，没人统一治理。OpenTelemetry Collector 就是为解决这组问题而生的：一个与语言无关的独立进程，夹在 SDK 与后端之间，统一接收 telemetry，做边缘处理，再按策略分发到任意后端。本课讲清它的定位与组件模型；完整可运行的配置放在下一课（obs-full-stack-deploy）。",
    },
    {
      type: "heading",
      text: "Collector 为什么存在",
    },
    {
      type: "paragraph",
      text: "回想 SDK 的职责边界：SDK 负责「把进程内发生的事变成标准数据模型，并以标准协议送出去」。它刻意不回答「送到谁、怎么处理」。直接让应用连后端有三个代价。第一是语言无关性被破坏：每种语言都要为每家后端重复实现导出细节，而 Collector 是独立进程，只通过标准协议（OTLP）与两侧对话，无论应用用什么语言。第二是边缘处理没有归属：批处理、重试、超时、过滤、采样、脱敏这类与「传输质量」有关的事，写在每个服务里既重复又容易不一致，Collector 把它们集中到一处。第三是后端耦合：应用的 telemetry 出口应当只有一处，换后端、加后端（比如同时送自建 Prometheus 和云厂商）、做集中式出口治理，都不该改应用。Collector 于是扮演「边缘路由器 + 处理器」：SDK 只需要认识它，后端的具体细节由它消化。这也是为什么第 3 课（obs-otel-model）把它列为 OTel 的三大件之一——它补齐了「生成」与「存储」之间的那一层。",
    },
    {
      type: "heading",
      text: "组件模型：receiver / processor / exporter / pipeline",
    },
    {
      type: "code",
      title: "Collector 在拓扑中的位置（本课程 demo 形态，第 14 课完整落地）",
      language: "text",
      code: `                    应用进程（任意语言）
              ┌──────────────────────────────────┐
              │  OTel SDK：traces / metrics / logs │  统一出口 = OTLP
              └───────────────┬──────────────────┘
                              │ OTLP（gRPC :4317 / HTTP :4318）
                              ▼
        ┌──────────────────── Collector ────────────────────┐
        │  pipeline: traces   receiver ─▶ processors ─▶ exporter │
        │  pipeline: metrics  receiver ─▶ processors ─▶ exporter │
        │  pipeline: logs     receiver ─▶ processors ─▶ exporter │
        └──────────────┬─────────────────┬─────────────────┘
                       ▼                 ▼
                   Tempo / 其它 OTLP 后端     Prometheus 兼容存储 / Loki

        一个 pipeline 内部（数据流方向固定，不可回流）：
        [receiver 接收] → [processor 处理] → [exporter 导出]
        同一信号可有多个 exporter：一份数据同时送往多个后端`,
    },
    {
      type: "table",
      caption: "Collector 的四个核心概念",
      headers: ["组件", "职责", "常见例子（0.160 发行版）"],
      rows: [
        ["receiver（接收器）", "把某种来源/协议的 telemetry 变成 Collector 内部统一的数据模型", "otlp（收 gRPC/HTTP 的 OTLP）、filelog（读进程 stdout/日志文件）、prometheus（主动 scrape）"],
        ["processor（处理器）", "对流过 pipeline 的数据做修改、过滤、富化、保护", "batch、resource、attributes、memory_limiter、tail_sampling（contrib）"],
        ["exporter（导出器）", "把内部数据模型转成目标后端协议并送出，含重试与队列", "otlp、otlphttp、prometheusremotewrite（contrib）"],
        ["pipeline（管线）", "在 service.pipelines 里把某信号的 receiver、processors、exporters 接线；一条数据只能沿一个方向流过", "traces / metrics / logs 各一条或多条，可按信号独立编排"],
      ],
    },
    {
      type: "paragraph",
      text: "三个信号的接收在 Collector 上汇于同一个入口：`otlp` receiver 默认同时监听 gRPC 4317 与 HTTP 4318，SDK 的 exporter 指向它即可。为什么 OTLP 能成为「事实标准传输」？它由 OTel 规范定义、一套协议承载 trace/metrics/logs 三种信号（第 3 课的统一模型正是为此设计），所有官方 SDK 默认支持，主流后端（含 Tempo、Prometheus 3.x 的 OTLP receiver、Loki 的原生 OTLP 端点）都原生接受。于是从应用到 Collector、Collector 到后端，全程不必做协议转换。注意它与 Prometheus 的拉取模型（第 5 课）是互补而非替代：prometheus receiver 可以主动去 scrape 目标，适合没有 OTel SDK 的存量服务；而本课程 demo 的主线是应用把 OTLP 推给 Collector，再由 Collector 分发给各后端。",
    },
    {
      type: "heading",
      text: "关键 processors：Collector 的价值所在",
    },
    {
      type: "table",
      caption: "最常用的 processors（本课程涉及的五个）",
      headers: ["processor", "作用", "一句话要点"],
      rows: [
        ["batch", "把多条数据攒成一批再发给 exporter", "默认攒够 8192 条（span/数据点/日志记录）或 200ms 即发；几乎每个 pipeline 都必须有"],
        ["resource", "增改 Resource 级属性（如 service.name、deployment.environment.name）", "把「这个数据来自哪个服务/环境」在边缘补齐，后端据此打标签"],
        ["attributes", "增删改单条数据上的 attributes（含按条件动作）", "脱敏、补 route 等业务标签、删除高基数字段"],
        ["memory_limiter", "给 Collector 自身设内存软/硬上限，超限拒收并背压", "必须放在 processor 链最前面，防止 Collector 自己被流量打 OOM"],
        ["tail_sampling", "等整条 trace 汇齐后再决定采样与否（contrib）", "能按「trace 最终结果」采样（如错误必留），但要缓冲完整子树，有内存与延迟成本"],
      ],
    },
    {
      type: "paragraph",
      text: "为什么 batch 几乎是「必须有」而不是可选项？因为 exporter 每发起一次网络请求都有固定开销，而应用侧 SDK 往往是攒一小批就发一次（比如 Go SDK 默认 5 秒或 512 条）。如果 Collector 收到就立刻转发，后端将面对大量细小请求——对 Prometheus 这类存储来说，写入压力与请求数成正比，小请求会让吞吐急剧下降。batch 把数据按 exporter 攒批（默认 8192 条或 200ms 超时，二者先到先发），把「应用节奏」变成「后端友好节奏」。第 6 课我们讨论过标签基数对存储的伤害，这里同理：请求粒度也是成本，批处理是缓解它的第一道闸。memory_limiter 则回答「Collector 挂了怎么办」——它在内存逼近硬上限时开始拒绝新数据（返回错误形成背压），配合软/硬双阈值防止进程被 OOM killer 杀掉，这让 Collector 成为可靠的数据通路而不是新的单点故障源。至于 tail_sampling，它承接第 11 课（obs-sampling-propagation）的采样讨论：head-based 采样在应用侧就决定去留，无法知道 trace 最终是否出错；tail-based 则需要「整棵 trace 到达之后再看结果」，这决定了它只能放在能汇合完整 trace 的地方——即所有产生同一 trace 的进程都把数据送到同一个 Collector（或同一组可路由的 Collector），由它缓存 span 树、等 trace 结束或超时后再按策略（如「错误必留、成功按概率采样」）决策。代价是明确的：要缓冲所有未决 trace 的 span，内存随并发 trace 数增长，且决策延迟拖慢导出。第 11 课说过采样率与排障可用性的矛盾，tail_sampling 是「把错误找回来」的手段之一，但只有在流量大到 head-based 必须采样、且错误 trace 值得完整保留时才值得引入；本课程的 demo 不做采样（全部保留，便于教学观察）。",
    },
    {
      type: "table",
      caption: "部署形态取舍",
      headers: ["形态", "拓扑", "取舍"],
      rows: [
        ["应用内嵌 exporter", "SDK 直接把数据发往各后端，不部署 Collector", "零额外组件、少一跳；但语言相关、无集中处理，换后端要改每个应用，仅适合玩具/单后端场景"],
        ["sidecar / agent（每应用或每主机一个 Collector）", "与应用同机部署的独立 Collector 进程/容器，收本机 telemetry 再转发", "语言无关、边缘处理（batch/脱敏）靠近源头、仍是一跳；每台机器多一个进程要运维，适合中小规模统一出口"],
        ["gateway（集中式 Collector 集群）", "各应用把数据发给一组集中 Collector，由其统一治理后送后端", "集中采样、脱敏、路由与出口管控；多一跳与高可用成本，适合大规模/多团队需要集中策略的场景"],
      ],
    },
    {
      type: "paragraph",
      text: "导出侧只需认识三种主力，各自的定位一句话讲清：`otlp` exporter（0.160 配置 id 正式名为 `otlp_grpc`，旧别名 `otlp` 仍可用但会打 deprecation 警告）把数据以 OTLP 原样转发给下一个 OTLP 后端——本课程 demo 用它把 traces 发给 Tempo；`prometheusremotewrite` exporter（contrib）把 OTel metrics 翻译成 Prometheus remote write 格式推给 Prometheus 兼容存储；日志送 Loki 则走 Loki 原生 OTLP 端点——Loki 3.x 在 HTTP `/otlp` 上原生接收 OTLP logs，Collector 用核心的 `otlp_http` exporter（旧别名 `otlphttp`）指过去即可（这是 Grafana 官方文档给出的接入方式；早期 contrib 发行版里曾有一个独立的 lokiexporter 组件，它已从发行版移除，2026 年的 otelcol-contrib 0.160 不再包含，看到旧文档里这个组件名时请按「otlphttp → Loki /otlp」理解）。每种 exporter 的完整参数不在此展开，需要时查对应组件文档。部署形态上，本课程 demo 采用 sidecar/agent 形态：docker compose 里跑一个 Collector 容器，与宿主机上的 shop 服务同机，收 shop 的 OTLP（4317），再分别转发给 Tempo / Prometheus / Loki——第 14 课（obs-full-stack-deploy）给出完整配置。别忘了 Collector 自己也是需要观测的进程：它的自身指标（进程内存、各 receiver/exporter 的接收与失败计数）由 `service::telemetry` 控制，默认在 8888 端口以 Prometheus 格式暴露，demo 里由 Prometheus 抓取，排障时先看它。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "core 发行版 vs contrib 发行版",
      body: "Collector 有两个官方发行版：`otelcol`（core）只含核心组件（otlp receiver、batch、otlp exporter 等），`otelcol-contrib` 额外打包数百个社区组件——tail_sampling、filelog、attributes、prometheusremotewrite 等都在 contrib 里。最常见的困惑是：只装了 core（或用了不带 -contrib 的镜像 tag）却在配置里写了 tail_sampling / filelog，启动时报「unknown type」找不到组件。本课程一律使用 `otel/opentelemetry-collector-contrib` 镜像。版本节奏上 Collector 仍是 0.x（2026-09 为 0.160，约每月一发）：0.x 意味着核心 API 已相当稳定，但组件级接口仍可演进，升级版本时留意组件文档的 breaking change。",
    },
    {
      type: "keypoints",
      items: [
        "Collector 是 SDK 与后端之间的独立进程：统一接收、边缘处理、多后端分发，让应用只认识一个 OTLP 出口",
        "四个概念：receiver 收数据、processor 处理、exporter 转协议送出、pipeline 在 service.pipelines 里接线，数据单向流过",
        "otlp receiver 默认 4317（gRPC）/ 4318（HTTP）同时接三种信号；OTLP 是事实标准传输",
        "batch 几乎必须有：按 exporter 攒批（默认 8192 条或 200ms），把应用节奏变成后端友好节奏；memory_limiter 放链首保护 Collector 自身",
        "tail_sampling 需整棵 trace 在 Collector 汇合后决策，有缓冲与延迟成本，适合「错误必留」场景（细节见第 11 课）",
        "exporter 三主力：otlp 原样转发（demo → Tempo）、prometheusremotewrite（→ Prometheus 兼容存储）、日志经 otlphttp → Loki 原生 /otlp（旧 lokiexporter 已从发行版移除）",
        "部署形态：内嵌 exporter / sidecar-agent / gateway；demo 用 sidecar 形态，Collector 自身指标默认暴露在 :8888",
      ],
    },
  ],
};
