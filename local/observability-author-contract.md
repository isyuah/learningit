# Observability 课程作者共享契约（Planner 冻结 · 2026-09-07）

## 课程定位
- 标题：可观测性系统学习（observability）
- 学习者：**有后端开发经验的工程师**（会写服务、懂 HTTP/数据库/部署），但**没有用过系统的监控/追踪体系**。不教 Go 语法、HTTP 基础。
- 意图：系统学习 + 工程实践，要求完整理解而非速成。
- 难度：intermediate。目标：学完能独立为一个 Go 服务接入 OTel + Prometheus，并掌握标准排障工作流。
- 主线场景：Go 编写的 **shop 示例服务**（net/http + SQLite，订单/支付/库存三个内部组件）。所有跨课时示例必须与它一致。

## 版本边界（权威事实，写作时不得违反；2026-09-07 核实）
- **Prometheus 3.x**：课程以 3.14（2026-08 发布）为基线。
- **Grafana 13.x**（13.2，2026-09）。
- **Loki 3.x**（3.7.7，2026-08）。
- **Tempo 3.x**（3.0.3）。
- **OpenTelemetry**：Go SDK 1.46（2026-08-25）；**Go Logs API/SDK 将随 v1.47 升为 v1 稳定**（rc 已出，1.47.0-rc.1，2026-08-28）；collector-contrib 0.160（2026-09-02）；语义约定（SemConv）仍在演进：HTTP 语义约定 v1.23+（`http.request.method`、`url.path` 等，旧 `http.method`/`http.route` 已废弃）；`messaging`、`db` 语义约定在 2026-09 为**实验/开发中**（Go 里 database/sql 的 db 埋点在 contrib 中按实验支持）。Metrics API 稳定，Logs 即将 v1。
- **prometheus/client_golang 1.24.x**（1.24.1，2026-07）：**要求 Go 1.25+**；Prometheus 3.x 中 native histograms 仍非默认（需 `--enable-feature=native-histograms`）；OTLP receiver 需 `--web.enable-otlp-receiver` 开关（默认关闭，3.x 未改）；Prometheus 3 默认启用 UTF-8 名称（`NameValidationScheme` 全局已移除）、新增 `prometheus_...` agent 模式、3.0 移除 v1 remote write？——**不写没有核实的细节**；本课程采集以 Prometheus server + OTLP receiver 为主。
- Go 版本：示例按 Go 1.25+ 编写。
- 不确定的行为：标注「需查阅官方文档」或「推断」，禁止编造默认值/版本行为。

## 术语约定（全课程统一；首次出现用 definition block）
- 可观测性 observability / 监控 monitoring / 传统监控（黑盒）
- 三支柱：Metrics（指标）/ Logs（日志）/ Traces（追踪）
- Telemetry（遥测数据）/ Signal（信号）/ Cardinality（基数）
- OpenTelemetry 缩写 **OTel**（不是 OpenTelemetry 全称每次写）；OTLP = OTel 的传输协议
- Trace（追踪）/ Span（跨度）/ SpanContext / TraceID / SpanID / Parent-Child
- Resource（资源，进程/服务属性）/ Attribute（属性，key-value）/ Semantic Convention（语义约定，可写 SemConv）
- Collector：receiver / processor / exporter / pipeline
- Prometheus：scrape（抓取）/ target / label / metric family / counter / gauge / histogram / summary / exemplar / relabel
- RED / USE / 黄金信号（Golden Signals）：Latency、Traffic、Errors、Saturation
- 采样 sampling：head-based（头部采样）/ tail-based（尾部采样）
- Logs：structured logging（结构化日志）/ log record / 事件日志（Event Logs，OTel 概念）/ trace_id + span_id 关联
- 后端：Prometheus（指标）/ Tempo（追踪）/ Loki（日志）/ Grafana（可视化统一入口）
- 排障：Triage（分类）/ Root Cause（根因）

## 共享场景（shop 服务，全局唯一事实源）
- shop 是一个 Go 服务，暴露 REST API：`POST /orders`（下单）、`GET /orders/{id}`、`POST /payments`（支付回调）、`GET /healthz`。
- 内部组件：order（订单）→ payment（支付）→ stock（库存扣减）。用 SQLite 存储。
- 运行拓扑（deploy 课时+demo）：**shop 应用 → OTel Collector（0.160）→ Prometheus 3.14 / Tempo 3.0 / Loki 3.7；Grafana 13.2 统一查看**。Prometheus 采用双模式：对 shop 用 **OTLP receiver**（`--web.enable-otlp-receiver`）接指标；同时演示 `/metrics` 抓取模式。**不引入 Alloy**（保持课程聚焦；如提及为「另一种采集器选择」）。
- 指标命名约定（demo 与课时一致）：
  - RED：`shop_http_requests_total{method,route,status}`（counter）、`shop_http_request_duration_seconds`（histogram）
  - 业务：`shop_orders_created_total`、`shop_orders_failed_total`、`shop_stock_shortages_total`
  - 资源：`shop_payments_inflight`（gauge）等
  - 单位后缀 `_seconds`/`_total`/`_bytes` 按 Prometheus 惯例
- 服务名：`service.name = shop`；`deployment.environment.name = dev`；trace 示例的 TraceID 形如 `463ac35c9f6413ad48485a3953bb6124`。
- 故障场景（troubleshooting 课时专用）：**支付回调变慢 + 偶发超时**：表现为 latency 升高、错误率爬升（timeout）、订单创建失败率上升；根因：stock 组件对 SQLite 写锁竞争（busy timeout 不够）+ payment 对上游 mock 超时设置过短——作者以教学一致性为准，不展开矛盾细节。

## 知识地图（哪些概念属于哪节课）
- **obs-mental-model**：黑盒 vs 白盒；可观测性=外部行为可被内部状态解释；三个问题（出什么问题/在哪/为什么）；定义 telemetry 三信号；monitoring vs observability（已知未知）；**只引入概念，不深入任何工具**。
- **obs-three-pillars**：每个信号的形态/回答的问题/成本/盲区；三者互补关系与 overlap；logs 高基数问题直觉；high cardinality 概念首次完整定义。
- **obs-otel-model**：OTel 是什么（CNCF、厂商中立、规范+SDK+Collector）；API/SDK 分离；Resource/Attribute/事件模型；三种信号统一走 OTLP；**不深入 span 传播细节**。
- **obs-trace-model**：Trace/Span/SpanContext/TraceID/SpanID/parent-child；时间与嵌套；Span 状态、事件、属性；**传播机制只点到（W3C traceparent），细节留给 sampling-propagation 课时**。
- **obs-prometheus-model**：拉取模型 vs 推送（对比）；指标家族与四种类型 + exemplar 概念先不展开（exemplar 单独课时）；job/instance 标签、target、服务发现概念；**不写 PromQL 语法**（留给 promql 课时）。
- **obs-prometheus-instrumentation**：client_golang 的 counter/gauge/histogram 用法、registry、promhttp；**go 运行时默认指标**；从 0 为 shop 加 RED 指标；正确命名（_total/_seconds/单位）与**标签基数警示**；黄金信号在此课落地。
- **obs-promql**：选择器、范围向量、rate/irate、increase、聚合 by/without、histogram_quantile、常用模式（错误率、饱和度）、**只讲本课程会用到的函数语义**，不列参考大全。
- **obs-alerting**：告警的目的与反模式（告警疲劳）；规则文件、Prometheus 内 alerting 规则求值；Alertmanager 的角色（分组/抑制/静默/路由）；**不部署 Alertmanager**，讲清边界；用「支付延迟 > 5s 持续 5m」作贯穿告警示例。
- **obs-structured-logging**：为什么需要结构化；log record 字段（时间/级别/消息/属性）；从 fmt.Println 到 slog（Go 标准库 log/slog）；trace_id/span_id 注入日志；**OTel Logs 与 Event 的关系**；「日志排障的位置」。
- **obs-loki-logging**：Loki 的标签索引 vs 全文索引（对比 ES）；chunk/stream；LogQL 基本（label 选择 + 行过滤）与 `{app="shop"} |= "error"`；与 Prometheus 标签一致性；结构化日志经 OTel Collector 到 Loki（loki exporter）；Grafana 里日志→指标跳转（简述）。
- **obs-sampling-propagation**：W3C traceparent/tracestate 格式；baggage；为什么采样；head-based vs tail-based（各自取舍）；parent-based 默认；**Go 传播器代码**；采样率对「排障可用性」的影响（低频错误可能被采样掉→exemplar/日志关联动机）；只讲概念性配置，部署细节归 collector 课时。
- **obs-exemplars-bridges**：exemplar 定义与用途（把高延迟指标点关联到 trace）；OpenMetrics 中 exemplar 形态；Prometheus native/classic histogram 与 exemplar 支持差异（需 --enable-feature 开启 native histograms 的课程说明）；Go client 里 WithExemplar；**Grafana 里从指标点跳到 trace**；「logs 与 traces 通过 trace_id 关联」。
- **obs-collector**：Collector 定位（边缘/集中、receiver/processor/exporter/pipeline）；OTLP receiver；batch processor（为什么必须）；tail_sampling processor 概念；资源检测 processor；**loki exporter / otlp exporter / prometheusremotewrite exporter（简述）**；部署形态 sidecar/agent/gateway；不手把手写全部 yaml（deploy 课时给全）。
- **obs-full-stack-deploy**：**docker-compose 起 prometheus+tempo+loki+grafana+collector+shop**；给全 compose 与 collector yaml（可直接运行）；验证（Grafana datasource、explore trace/metrics/logs）；手动制造请求观察数据；指向 E:/Proj/Learn/observability-demo；kind: exercise，动手为主。
- **obs-slo**：SLO/SLI/error budget；与告警的关系（multiwindow、burn rate 简述）；为什么 SLO 是告警的北极星；**用 shop 的支付延迟做示例 SLI**；不铺开全部 burn-rate 数学。
- **obs-troubleshooting**：综合实战：从 Grafana 告警面板 → PromQL 定位（latency/error 曲线）→ 跳 trace（慢 span、属性）→ 跳日志（trace_id 过滤）→ 根因（SQLite 锁/上游超时）→ 修复与验证；kind: exercise。

## 写作规则
- 章节之间不要重复完整解释：后一课引用前课概念（如「第 X 课讲过……」）而不重复整段。
- 中文写作；术语首次出现给 definition；**不规定每课必须用哪些 block 类型**。
- 代码必须真实、完整、与版本一致（Go 1.25+ / client_golang 1.24 API）；伪代码仅在确有必要并标注。
- 示例只引入教学所需字段，不虚构 API。拿不准的 API 形状 → 写「参考官方文档/该版本」。
- quiz/exercise 只在有真实教学价值时用；quiz 检验理解而非原文复述。

## 平台写入规则
- 每节课一个文件：`src/content/courses/observability/lessons/<slug>.ts`，导出 `lesson: Lesson`，slug 与文件名一致，courseSlug 为 "observability"。
- block 类型仅限 types.ts：paragraph / heading / subheading / list / callout(tip|note|warning|example) / code / table / definition / keypoints / quiz / exercise / video / quote / divider。
- lesson slug 全局唯一，不得与其它课程冲突。
- 每课篇幅参考：8–14 个 blocks、正文 1500–3500 中文字实质内容（对标 rabbitmq 课程）。
- **不要运行 npm run validate / typecheck / build（集成者统一执行）；不要改 course.ts；不要改平台文件。**

## 交付前自查
- [ ] slug/文件名/courseSlug 一致
- [ ] 代码与 2026-09 版本事实一致，无编造 API
- [ ] 术语符合契约
- [ ] 未重复其它课时已讲内容
- [ ] 结构正确（TS 语义）
