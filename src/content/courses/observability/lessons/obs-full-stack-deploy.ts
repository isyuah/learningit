/* ==================================================================
 * 课时：部署全栈观测环境（obs-full-stack-deploy）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-full-stack-deploy",
  courseSlug: "observability",
  title: "部署全栈观测环境",
  summary: "一条命令起 shop + collector + Prometheus + Tempo + Loki + Grafana，用指标、trace、日志三条信号验证端到端数据流。",
  minutes: 40,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "上一课（第 13 课 obs-collector）讲清了 Collector 的组件模型，但「讲清」和「跑通」之间还差一套真实可运行的配置。本课动手把它补齐：目标是一条命令（`docker compose up -d --build`）同时起 shop 应用与五个后端容器，之后能在同一个 Grafana 里查到 shop 的指标、trace 与日志，并且三者能凭 trace_id 互跳。全部文件都放在本站配套的 demo 工程目录 E:/Proj/Learn/observability-demo 下（下面每个代码块的文件名就是它在 demo 里的相对路径；本课配置即 demo 工程本身，已全链路实跑验证）。整体拓扑沿用课程契约并做了一处落地修正：**shop 也容器化**（build ./shop），与应用同网络的 collector 之间没有「宿主机 vs 容器」的网络断层，比第 13 课设想的宿主机进程形态更省事、可复现。指标主路是 Prometheus 的 OTLP receiver——Prometheus 3.x 里这个能力默认关闭，必须用 `--web.enable-otlp-receiver` 开关打开（3.14 该开关仍然存在，见下方 compose 注释）；同时加 `--enable-feature=exemplar-storage`，否则第 12 课 obs-exemplars-bridges 讲过的 exemplar 不会被留存，指标点就跳不了 trace。另保留 shop 的经典 `/metrics` 抓取通道做对照（第 6 课埋的 client_golang 指标，见 metrics.go 与下方 scrape 段）。",
    },
    {
      type: "code",
      title: "docker-compose.yml（demo 根目录）",
      language: "yaml",
      code: `# E:/Proj/Learn/observability-demo/docker-compose.yml
# 拓扑：shop(Go) --OTLP/HTTP--> collector --otlp_grpc--> tempo
#                                      |--otlp_http--> prometheus(OTLP receiver)
# 日志：shop slog JSON 双写 stdout + 共享卷 shop.log
#       → collector file_log receiver → otlp_http → loki(OTLP 端点)
# shop 另暴露经典 /metrics 供 scrape 对照；grafana 统一查看三数据源。
# 端口说明：本机 8080/9090/3000 等常被占，demo 统一映射到备用端口
# （8081/9091/3001/3101/3201/4319）。你本机若仍冲突，改左侧宿主端口即可。
name: observability-demo

services:
  shop:
    build: ./shop
    environment:
      SHOP_ADDR: ":8080"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    volumes:
      - shop-logs:/var/log/shop
    ports:
      - "8081:8080"
    depends_on:
      - otel-collector
    # 故障演练开关（第 16 课综合实战用）：
    # SHOP_SLOW_STOCK=1 / SHOP_STOCK_BUSY=1 / SHOP_PAYMENT_SLOW=1

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.160.0
    command: ["--config=/etc/otelcol-contrib/config.yaml"]
    volumes:
      - ./collector/config.yaml:/etc/otelcol-contrib/config.yaml
      # file_log receiver 读 shop 写的共享日志卷
      # （Docker Desktop 下比挂载 /var/lib/docker/containers 可靠）
      - shop-logs:/var/log/shop:ro
    ports:
      - "4319:4318" # OTLP/HTTP
      - "8888:8888" # collector 自身指标

  prometheus:
    image: prom/prometheus:v3.14.0
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      # 3.x 必须显式开启才收 OTLP 指标（本课主线：collector → Prometheus 的 OTLP receiver）
      - --web.enable-otlp-receiver
      # exemplar 存储默认关闭；不开则 OTLP 带来的 exemplar 不会被留存，
      # Grafana 指标点就跳不了 trace（见第 12 课 obs-exemplars-bridges）
      - --enable-feature=exemplar-storage
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9091:9090"

  tempo:
    image: grafana/tempo:3.0.3
    command: ["-config.file=/etc/tempo.yaml"]
    volumes:
      - ./tempo/tempo.yaml:/etc/tempo.yaml
    ports:
      - "3201:3200" # tempo http

  loki:
    image: grafana/loki:3.7.7
    command: ["-config.file=/etc/loki/config.yaml"]
    volumes:
      - ./loki/config.yaml:/etc/loki/config.yaml
    ports:
      - "3101:3100"

  grafana:
    image: grafana/grafana:13.2.1
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: "Admin"   # 教学环境免登录；生产必须关掉匿名
      GF_SECURITY_ADMIN_PASSWORD: admin
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning
    ports:
      - "3001:3000"
    depends_on:
      - prometheus
      - tempo
      - loki

volumes:
  shop-logs:`,
    },
    {
      type: "code",
      title: "collector/config.yaml（contrib 0.160；组件名用新版 otlp_grpc / otlp_http / file_log）",
      language: "yaml",
      code: `# E:/Proj/Learn/observability-demo/collector/config.yaml
# contrib 发行版：otlp + file_log 收，三条 pipeline 分别送 Tempo / Prometheus / Loki。
# 组件名版本事实：0.160 起核心组件统一用带下划线的正式名
#   otlp_grpc（旧别名 otlp，已弃用但可用）/ otlp_http（旧别名 otlphttp）
#   file_log（旧别名 filelog）/ memory_limiter / batch 不变。
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
  file_log/shop:
    include: [/var/log/shop/shop.log]
    start_at: beginning
    poll_interval: 200ms
    # file_log 的日志没有 SDK 注入的 Resource，这里内嵌补上，
    # 保证进 Loki 后有 service_name 索引标签（0.160 实测支持）
    resource:
      service.name: shop
      deployment.environment.name: dev
    operators:
      # shop 每行是一段 slog JSON：解析成结构化字段（level/msg/order_id/trace_id…），
      # Loki 侧才能展开字段、按 trace_id 过滤；解析失败的原始行原样放行（on_error 默认 send）
      - type: json_parser

processors:
  memory_limiter:
    # 保护 collector 自身：放 processor 链最前面（第 13 课讲过）
    check_interval: 1s
    limit_mib: 512
    spike_limit_mib: 96
  batch:
    # 教学演示调小阈值让数据尽快出；生产用默认 8192 条 / 200ms 即可
    send_batch_size: 512
    timeout: 2s

exporters:
  otlp_grpc/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true
  # Prometheus 3.x 的 OTLP receiver：HTTP 路径是 /api/v1/otlp/v1/metrics。
  # 显式 signal endpoint（metrics_endpoint）时 exporter 不再自动追加 /v1/xxx，
  # 必须写全完整路径。
  otlp_http/prometheus:
    endpoint: http://prometheus:9090
    metrics_endpoint: http://prometheus:9090/api/v1/otlp/v1/metrics
  # Loki 原生 OTLP 端点（HTTP，无 gRPC）。同样：显式 logs_endpoint 写全路径
  # http://loki:3100/otlp/v1/logs —— 只写 http://loki:3100/otlp 会 404，
  # 因为 otlp_http 组件名/显式端点语义下 exporter 不再帮你补 /v1/logs。
  # （早期 contrib 发行版里的独立 lokiexporter 已移除，官方接入方式即此，见第 13 课）
  otlp_http/loki:
    endpoint: http://loki:3100
    logs_endpoint: http://loki:3100/otlp/v1/logs

service:
  telemetry:
    metrics:
      # 0.160 起 collector 自身指标用 readers 结构暴露 prometheus 端点
      # （旧 address: 0.0.0.0:8888 写法在 0.160 会报 invalid keys，已实测）
      readers:
        - pull:
            exporter:
              prometheus:
                host: 0.0.0.0
                port: 8888
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_grpc/tempo]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/prometheus]
    logs:
      receivers: [otlp, file_log/shop]
      processors: [memory_limiter, batch]
      exporters: [otlp_http/loki]`,
    },
    {
      type: "code",
      title: "prometheus/prometheus.yml（3.14；OTLP receiver 为主 + scrape 对照）",
      language: "yaml",
      code: `# E:/Proj/Learn/observability-demo/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

storage:
  tsdb:
    # OTLP 批量推送可能乱序；官方指南建议留乱序窗口
    out_of_order_time_window: 30m

otlp:
  # 把 OTel 资源属性提升为标签（否则只出现在 target_info 上）
  promote_resource_attributes:
    - service.name
    - service.version
    - deployment.environment.name

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["127.0.0.1:9090"]

  # 经典抓取通道对照：shop 的 /metrics（client_golang 暴露，第 6 课）
  - job_name: shop
    static_configs:
      - targets: ["shop:8080"]

  # collector 自身指标（service.telemetry.metrics 暴露在 8888，排障先看它）
  - job_name: otel-collector
    static_configs:
      - targets: ["otel-collector:8888"]`,
    },
    {
      type: "code",
      title: "tempo/tempo.yaml（3.0.3 单二进制）与 loki/config.yaml（3.7 单实例）",
      language: "yaml",
      code: `# E:/Proj/Learn/observability-demo/tempo/tempo.yaml
# Tempo 3.x monolithic（-target 默认 all）：一个进程内跑全部组件。
server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
          endpoint: 0.0.0.0:4317   # collector 的 otlp_grpc exporter 从这里推 trace
        http:
          endpoint: 0.0.0.0:4318

storage:
  trace:
    backend: local
    local:
      path: /var/tempo/traces
    wal:
      path: /var/tempo/wal

---
# E:/Proj/Learn/observability-demo/loki/config.yaml
# Loki 3.x 单实例（monolithic，未拆读写分离）；本地文件存储，够教学用。
auth_enabled: false

server:
  http_listen_port: 3100

common:
  instance_addr: 127.0.0.1
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2026-09-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  # OTLP 摄入的日志属性以 structured metadata 存放（Loki 3.0+ 默认开启，
  # 显式写出以对齐官方「Loki OTLP 接入」文档；字段名写法以官方文档为准）
  allow_structured_metadata: true

# 单实例下显式声明，避免 table_manager 告警噪音（demo 已实测）
table_manager:
  retention_deletes_enabled: false`,
    },
    {
      type: "code",
      title: "grafana/provisioning/datasources/datasources.yaml",
      language: "yaml",
      code: `# E:/Proj/Learn/observability-demo/grafana/provisioning/datasources/datasources.yaml
# Grafana 启动时自动加载（/etc/grafana/provisioning）。服务名解析走 compose 网络。
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
    jsonData:
      # 指标 → trace：exemplar 里名为 trace_id 的标签跳到 Tempo 数据源
      exemplarTraceIdDestinations:
        - name: trace_id
          datasourceUid: tempo

  - name: Tempo
    type: tempo
    uid: tempo
    access: proxy
    url: http://tempo:3200
    editable: true

  - name: Loki
    type: loki
    uid: loki
    access: proxy
    url: http://loki:3100
    editable: true
    jsonData:
      # 日志 → trace：把行内 trace_id 字段变成可点击跳转的链接（跳 Tempo）
      derivedFields:
        - name: trace_id
          matcherType: label
          matcherRegex: 'trace_id=(\\w+)'
          url: '\${__value.raw}'
          datasourceUid: tempo`,
    },
    {
      type: "code",
      title: "shop/（Dockerfile + 关键文件）——镜像内构建，otelhttp 自动埋点 + OTLP/HTTP 推送",
      language: "text",
      code: `# E:/Proj/Learn/observability-demo/shop/Dockerfile
FROM golang:1.26.5-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /shop .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /shop /app/shop
EXPOSE 8080
ENTRYPOINT ["/app/shop"]

# —— shop 的可观测性装配（otel.go / main.go / metrics.go 的要点）——
# 依赖版本：go.opentelemetry.io/otel v1.46 / otelhttp v0.71 / client_golang v1.24.1
#   / modernc.org/sqlite v1.58（纯 Go，无 CGO；Dockerfile 里 CGO_ENABLED=0 可编译）
#
# · 传输：trace/metric 都走 OTLP/HTTP（otlptracehttp / otlpmetrichttp），
#   默认端点 otel-collector:4318（compose 网络内），无 TLS（WithInsecure）。
#   日志不走 OTel Logs API（Go 的 Logs SDK 到 v1.47 才稳定），而是 slog JSON
#   双写：stdout（docker logs 可见）+ /var/log/shop/shop.log（共享卷给 collector）。
#   每条日志由自定义 slogHandler 自动注入当前 span 的 trace_id/span_id。
# · 埋点：HTTP 层用 otelhttp.NewHandler 自动建 server span（W3C traceparent
#   进出自动传播）；下单流程里手动起 stock.reserve 子 span；业务 counter
#   shop.orders.created 用 otel.Meter 记录（见 metrics.go 里经典通道对照）。
# · 端口：SHOP_ADDR 默认 :8080；compose 映射到宿主 8081。
#
# 完整源码见 demo 工程（本课不贴全）：demo 目录即本课的「答案文件」，
# 对照阅读 main.go / otel.go / metrics.go / httpclient.go 即可复现全部埋点。`,
    },
    {
      type: "paragraph",
      text: "启动只有一条命令：在 demo 根目录执行 `docker compose up -d --build`。第一次会构建 shop 镜像并拉取五个后端镜像，耗时较长（网络差时可先 `docker compose build` / `docker compose pull` 分步做）。完成后 `docker compose ps` 应看到六个服务全部 Up。随后打流量制造数据：`curl -s http://localhost:8081/healthz` 应返回 `ok`；再连打十几发 `curl -s -X POST http://localhost:8081/orders -d '{}'`（demo 的下单会建订单、扣库存并调用 payment，完整版还写 SQLite——想快速看效果可以再打 `curl -s -X POST http://localhost:8081/payments -d '{}'`）。注意所有端口都是备用映射：应用 8081、Grafana 3001、Prometheus 9091、Loki 3101、Tempo 3201、collector 的 OTLP/HTTP 是 4319——本机这些端口若仍被占用，改 compose 文件里 `宿主端口:容器端口` 的左侧即可。这个 demo 没有「宿主机进程 + 日志重定向」的形态，shop 在容器里把日志双写 stdout 与共享卷，collector 的 file_log receiver 直接读共享卷，少一层手工操作，也避免重定向文件权限、路径不一致这类环境差异。",
    },
    {
      type: "heading",
      text: "端到端验证：从容器健康到跨信号互跳",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "`docker compose ps`：六个服务全部 Up（期望 1/1 Running；collector 依赖后端的 exporter 自带重试队列，即使启动顺序略有先后也会自动续传）。常见失败：端口被占用（8081/9091/3001/3101/3201/4319/8888 任一被本机其它进程占用时 `docker compose up` 会直接报 bind 错误——`netstat -ano | findstr :端口` 找到占用者，或改 compose 里 `宿主端口:容器端口` 的左侧）；镜像拉取慢或超时（先 `docker compose pull` 分步拉，或换镜像加速源）。",
        "`curl -s http://localhost:8081/healthz` 返回 `ok`；`docker compose logs otel-collector` 里没有持续刷新的错误（期望启动 banner 与少量 INFO）。若 collector 日志刷连接拒绝/`error sending batch`，先确认 prometheus/tempo/loki 是否已 Up——exporter 会重试，后端就绪后自动恢复。",
        "Prometheus 查到指标：浏览器开 http://localhost:9091，查询 `shop_http_requests_total`（经典 scrape 通道，第 6 课埋的 client_golang 指标）或 `shop_orders_created_total`（OTLP 通道：OTel counter 经 collector → Prometheus OTLP receiver，翻译后补 `_total` 后缀）。期望两族序列都能查到、且随打流量增长。常见失败一：经典通道没有——查 Prometheus 的 Target 页（Status → Targets），`shop` job 若 down 多半是 shop 容器没起来或 /metrics 没挂上；常见失败二：OTLP 通道没有——先看 collector 日志里 otlp_http exporter 有没有非 2xx，再看 Prometheus 容器日志是否真的带了 `--web.enable-otlp-receiver`（漏掉这个开关时 collector 会收到 404/501，错误信息里带 `/api/v1/otlp` 字样）。",
        "Tempo 看到 trace：Grafana（http://localhost:3001，本配置匿名 Admin）→ Explore → 数据源切 Tempo → Search，查询 `service.name = \"shop\"`（或直接浏览 trace 列表）。期望能看到若干条 trace，点开是带 server span（otelhttp 自动埋的 `POST /orders`）与 `stock.reserve` 子 span 的瀑布。常见失败：一条都没有——回 collector 日志确认 otlp_grpc/tempo exporter 没报错（连接 tempo:4317 失败会刷重试）；也可 `docker compose logs tempo` 看有没有收到 span 的迹象。",
        "Loki 看到日志且含 trace_id：Explore → 切 Loki，查询 `{service_name=\"shop\"}`。期望每条日志都带 time/level/msg/order_id/trace_id/span_id/component 字段（点开行展开看字段）。`service_name` 来自 collector 在 file_log receiver 里内嵌的 resource `service.name`（Loki 的 OTLP 摄入把点转下划线并默认把 service.name 映射成索引标签）；行内 trace_id 由 shop 的 slogHandler 自动注入。常见失败：空结果——八成是共享卷没挂对：`docker compose exec otel-collector ls -l /var/log/shop` 应能看到 shop.log（有内容、持续增长）；其次确认 collector 日志里 otlp_http/loki exporter 没有 4xx（Loki 拒绝时会给出原因，比如 structured metadata 超限）。",
        "跨信号互跳：在 Grafana 里打开 shop 的 OTel 指标图（Explore → Prometheus → 查 `http_server_request_duration_seconds`——otelhttp 直方图经 OTLP 翻译后的名字；OTel Metrics SDK 会自动从 span context 摘 exemplar 挂到数据点上，collector 的 otlp 转发不丢 exemplar），时间范围选刚才打流量的窗口，勾选 Exemplars 后点数据点，应能跳到 Tempo 里对应的那条 trace（数据源 provisioning 里 exemplarTraceIdDestinations 已配好）。注意经典通道的 `shop_http_request_duration_seconds` 没有 exemplar——metrics.go 的 classicMetrics 中间件没有挂 exemplar，这正是第 12 课「OTel 管线自动带 exemplar、client_golang 要手动 WithExemplar」的对照。再到 Loki 用行内 trace_id 过滤 `{service_name=\"shop\"} |= \"<trace_id>\"`，能看到同一次请求的日志（derivedFields 把行内 trace_id 变成可点击跳 Tempo 的链接）。若 exemplar 不可见：确认 Prometheus 启动参数带了 `--enable-feature=exemplar-storage`（第 12 课讲过默认关闭），且数据点是最近产生的（exemplar 环形缓冲只留近期样本）。",
      ],
    },
    {
      type: "exercise",
      title: "排查练习：容器都起了，Grafana 却没有数据",
      description:
        "把栈按上面步骤起好并打几发请求后，人为制造一个断点（例如把 collector 配置里 file_log 的 include 路径改错后 `docker compose restart otel-collector`；或临时把 shop 的 environment 里加 `SHOP_LOG_FILE=/nonexistent.log` 让日志文件写不出去），然后按「数据入口 → collector → 后端 → Grafana」的固定顺序自查，每一层都记录你看到了什么，最后恢复配置并确认数据重新出现。这个顺序就是以后所有「观测栈没数据」排障的模板：永远先确认「源头有没有产生」再到「中间有没有转发」再到「后端有没有入库」，不要一上来就怀疑 Grafana。",
      hint: "按序检查，每层都有明确的通过标准：① 源头：`curl localhost:8081/healthz` 200 且 shop 容器活着？`docker compose exec shop ls -l /var/log/shop/shop.log` 在打请求时有没有增长？（没有 → shop 侧问题，与观测栈无关）② collector 入口：`docker compose logs otel-collector` 有无 receiver 报错？`docker compose exec otel-collector ls -l /var/log/shop` 能看到共享卷里的 shop.log 吗？③ collector 出口：日志里 otlp_grpc / otlp_http exporter 有无非 2xx 或连接失败？「no endpoint / connection refused / 404」分别指向配置写错、后端未起、signal endpoint 路径没写全；④ 后端入库：Prometheus http://localhost:9091 查 `up` 与 `prometheus_tsdb_head_samples_appended_total` 在涨吗？Tempo/Loki 侧 `docker compose logs` 有无摄入报错？⑤ 最后才看 Grafana：数据源配置里 URL 用对了吗（容器内要用 compose 服务名 prometheus/tempo/loki，不是 localhost）？时间范围选对了吗？——如果以上全过仍无数据，把你每层的观察写下来，问题往往出在你跳过的某一层。",
    },
    {
      type: "keypoints",
      items: [
        "拓扑：shop（容器，build ./shop）→ collector(0.160) → Prometheus 3.14（OTLP receiver）/ Tempo 3.0 / Loki 3.7，Grafana 13.2 统一查看；六个容器一条 `docker compose up -d --build`",
        "Prometheus 3.x 收 OTLP 必须加 `--web.enable-otlp-receiver`（默认关）；exemplar 要能跳 trace 还需 `--enable-feature=exemplar-storage`；OTLP 推送乱序时在 storage.tsdb 留 out_of_order_time_window",
        "collector 0.160 组件名版本事实：otlp_grpc / otlp_http / file_log 是新名（旧别名 otlp / otlphttp / filelog 仍可用但弃用）；自身指标用 service.telemetry.metrics.readers 结构暴露 :8888（旧 address 写法报 invalid keys）",
        "显式 signal endpoint（metrics_endpoint / logs_endpoint）时 exporter 不自动追加 /v1/xxx：Prometheus 写全 /api/v1/otlp/v1/metrics，Loki 写全 /otlp/v1/logs（写 /otlp 会 404）",
        "shop 日志 slog JSON 双写 stdout + 共享卷 shop.log，collector 的 file_log receiver 读卷并内嵌 service.name resource + json_parser 解析成结构化字段；Loki 索引标签 service_name 由此而来",
        "排障顺序永远是：源头有没有产生 → collector 有没有收到/转出 → 后端有没有入库 → Grafana 配置对不对；collector 自身指标在 :8888 供 Prometheus 抓取",
        "配置与 demo 工程 E:/Proj/Learn/observability-demo 一一对应（本课代码块即 demo 文件内容）：把仓库 clone/放到该路径即可复现本课全部验证步骤",
      ],
    },
  ],
};
