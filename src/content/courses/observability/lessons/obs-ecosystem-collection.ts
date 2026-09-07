/* ==================================================================
 * 课时：采集层扩展：Alloy、Promtail 与 eBPF（obs-ecosystem-collection）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-ecosystem-collection",
  courseSlug: "observability",
  title: "采集层扩展：Alloy、Promtail 与 eBPF",
  summary: "给采集层一张生态地图：Alloy 统一多信号采集、Promtail 已成历史路径、eBPF 零代码埋点解决无源码场景。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "主线课程里的数据接入只有两条路：应用侧用 OTel SDK 把 trace/metrics 生成好后推给 Collector（第 13 课 obs-collector），日志侧靠 Collector 的 filelog 组件去读文件（第 10 课 obs-loki-logging 与第 14 课 obs-full-stack-deploy 落地）。这两条路是教学上最「正」的写法，但走进真实世界，采集/接入层的选择远不止于此：Grafana 生态有自己的统一采集器 Alloy；日志采集还曾有一个主流 agent 叫 Promtail（如今已进历史通道）；还有一类根本不碰应用代码的 eBPF 自动埋点工具。本课不深入任何一家的配置细节，只给你一张地图：它们各是什么、解决什么问题、用什么实现、何时才需要，以及与主线 OTel Collector / SDK 是什么关系——看完之后，当这些名字出现在架构图或招聘 JD 里，你能立刻知道它们各自在干嘛、自己该不该引入。",
    },
    {
      type: "heading",
      text: "Grafana Alloy：一个 agent 统一采集",
    },
    {
      type: "paragraph",
      text: "Grafana Alloy 是 Grafana 开源的新一代统一采集器。它的官方定位是「OpenTelemetry Collector distribution with built-in Prometheus pipelines, support for metrics/logs/traces/profiles」——一句话拆开看：它首先是 OTel Collector 的一个发行版（distribution）；其次内置了 Prometheus 的拉取管线；能力上覆盖 metrics / logs / traces / profiles 四类数据。它解决的核心问题是「agent 太多」：过去在 Grafana 生态里，日志要跑 Promtail、指标要跑 Prometheus 类的 exporter 与 scraper、追踪要跑 OTel Collector，一台机器上往往同时养着两三个采集进程，各自独立配置、独立升级、独立出故障。Alloy 把这些职责收拢成一个进程，让「采集层」重新变得像一个可以统一治理的组件。",
    },
    {
      type: "code",
      title: "Alloy 用声明式 River 语法接线组件（示意，完整参数以官方文档为准）",
      language: "text",
      code: `// Alloy 的配置语言叫 River：声明式、组件化，组件之间用 forward_to 接线
// 示意：用 loki.source.file 读一条日志文件并转发给 Loki（迁移自 Promtail 的同类职责）

loki.source.file "shop_app" {
  targets    = [{ __path__ = "/var/log/shop/app.log" }]
  forward_to = [loki.write.local.receiver]
}

loki.write "local" {
  endpoint {
    url = "http://loki:3100/loki/api/v1/push"
  }
}`,
    },
    {
      type: "paragraph",
      text: "注意它与主线第 13 课的关系：Alloy 不是「另一个平行生态」，而是 OTel Collector 的发行版——receiver / processor / exporter 这套组件模型原样复用，你在 Collector 上学的概念（batch、resource/attributes 处理、pipeline 思想）在 Alloy 里依然成立，只是接线语言换成 River，并额外内置了 loki.source.*、prometheus.scrape 这类面向 Grafana 的组件。那何时用 Alloy 而非原生 Collector？一句话：当你的后端是 Grafana 全家桶（Loki / Tempo / Mimir / Pyroscope）、或想在一台机器上只养一个采集 agent 时，Alloy 更省事；当你想跟随 OTel 官方发行版、以纯 OTLP 出口对接任意后端（本课程 demo 的形态）时，原生 Collector 依然正统。两条路并不互斥——它们共享同一套组件生态，切换成本主要在学 River 语法，而不是重学概念。",
    },
    {
      type: "heading",
      text: "Promtail：看一眼，认得出是旧路",
    },
    {
      type: "paragraph",
      text: "Promtail 曾是 Loki 官方的日志采集 agent，老教程、老博客里大量出现它的 YAML 配置。现状一句话：Loki 官方已把 promtail 移出主仓库、停止按老方式演进，官方给出的迁移路径就是 Alloy——把 promtail 配置迁移为 Alloy 的 loki.source.file 等组件（迁移指南在 Grafana 官方文档，以官方文档为准）。所以它的定位很清晰：存量系统可能还在跑，但新项目不要再引入。你只要做到「看到 promtail 四个字母就知道它是 Alloy 之前的日志采集器、如今的新名字叫 Alloy」，就已经够用了——别再花时间学它的配置语法，那是正在折旧的知识。",
    },
    {
      type: "heading",
      text: "Beyla / eBPF：不改代码的自动埋点",
    },
    {
      type: "paragraph",
      text: "主线里所有埋点都隐含一个前提：「代码是我们的、可以改」——加 SDK、加依赖、重新发布。但真实系统里有大量例外：接手的老服务没人敢动、业务跑在第三方组件与黑盒中间件上、甚至整个服务早已无人维护。eBPF（Extended Berkeley Packet Filter）类工具就是为这些场景准备的：它不碰你的应用代码，而是把探针挂进 Linux 内核，嗅探进程发出的 HTTP/gRPC 等系统调用与网络流量，从请求的开始/结束/状态码中还原出一次调用的完整轮廓，自动生成 OTel span 与指标——无需改代码、无需加依赖、甚至无需重启进程。Grafana Beyla 就是这类「零代码自动埋点」的代表工具，支持 Go / Python / Node / Rust 等语言（具体机制与语言支持面以官方文档为准），产出仍是标准 OTel 数据，可以照常送给 Collector / Tempo，无缝接入你已经学过的链路模型。",
    },
    {
      type: "paragraph",
      text: "但边界必须看清：eBPF 看到的是「流量/协议层」——请求从哪来、到哪去、耗时多少、状态码如何；它看不到业务内部状态——函数里做了什么、查了什么库、错误出在哪条分支，也无法携带你在业务代码里精心设置的 span attribute（第 11 课 obs-sampling-propagation 讲过：trace 的语义价值来自应用侧标注）。所以它是 SDK 埋点的补充而非替代：它擅长补上「之前完全没有观测」的死角，但观测深度永远低于手写埋点。决策上记住一句：Beyla 属于「有流量价值、但无源码或动不了代码」的服务；只要能改代码，就先老老实实用 SDK。",
    },
    {
      type: "code",
      title: "示意：一条命令让监听 8080 的存量服务开始产出 OTel span（以官方文档为准）",
      language: "text",
      code: `# Beyla 主要靠环境变量配置，默认把 OTel 数据推给本机 :4317 的 Collector/接收端
# 示意命令：请以 Beyla 官方文档为准
BEYLA_OPEN_PORT=8080 ./beyla

# 启动后无需改动任何应用代码：此后访问 8080 端口的每个 HTTP 请求，
# 都会被自动还原成一条带父子的 trace（span），与 SDK 埋点的数据汇入同一条链路`,
    },
    {
      type: "table",
      caption: "三条「把数据送进可观测系统」的路子对照",
      headers: ["路线", "解决什么", "代价", "什么时候选"],
      rows: [
        ["SDK 埋点（主线第 4 / 6 课）", "最深的观测：业务内部状态、自定义属性、语义约定都能进 trace/metrics", "要改代码、加依赖、重新发布；每种语言一份工作", "代码归你管、能发布——默认首选"],
        ["eBPF 自动埋点（Beyla 等）", "存量/第三方/黑盒服务的流量级 trace 与指标，零代码零重启", "只能看到协议与流量层，拿不到业务内部状态；需内核探针权限；语言支持面有限", "没有源码或不能改代码，又想立刻有 trace"],
        ["旁路采集（Collector / Alloy 的 filelog、prometheus.scrape 等）", "把已存在的产物收进来：日志文件、Prometheus 指标端点、OTLP 端口", "数据若不带 trace id / 结构化字段，就无法做请求级关联", "数据本就以文件或端点形态存在，做集中接入"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "别急着全上 eBPF",
      body: "听到「零代码埋点」很容易心动，动手前先问自己两个问题：有没有源码？能不能加依赖？只要答案是「能改代码」，SDK 埋点仍是首选——只有它能把业务语义带进观测数据。eBPF 是「没有选择时的选择」：留给存量服务、第三方组件与黑盒，而不是让新项目跳过埋点直接上探针。采集层的完整决策其实只有一句话：能改代码用 SDK，动不了代码用 eBPF，数据已存在于文件/端点就交给 Collector / Alloy 旁路接入。",
    },
    {
      type: "keypoints",
      items: [
        "采集层三大补充角色：Alloy（统一采集 agent）、Promtail（历史路径）、Beyla（eBPF 零代码埋点）",
        "Alloy 是 OTel Collector 的官方发行版（distribution），内置 Prometheus 管线，一个 agent 收 metrics/logs/traces/profiles；配置语言为声明式 River，receiver/processor/exporter 概念与 Collector 一致",
        "Promtail 已被 Loki 官方移出主仓库，官方迁移路径 = Alloy；再看到 promtail 配置知道是旧路即可，新项目别引入",
        "eBPF（Beyla）在内核层嗅探 HTTP/gRPC 流量，不改代码、不加依赖、不重启进程即可产出 OTel span/metrics，适合存量、第三方与黑盒服务",
        "eBPF 的边界：只能看到流量/协议层，拿不到业务内部状态，是 SDK 的补充而非替代",
        "决策次序：能改代码 → SDK 埋点；无源码/不能动 → eBPF；数据以文件/端点存在 → Collector/Alloy 旁路接入",
      ],
    },
  ],
};
