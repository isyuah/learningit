/* ==================================================================
 * 课时：Exemplar：指标与追踪的桥（obs-exemplars-bridges）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-exemplars-bridges",
  courseSlug: "observability",
  title: "Exemplar：指标与追踪的桥",
  summary: "p99 升高时怎样从指标曲线跳到具体某次请求；exemplar 的形态、Prometheus 支持状态与 Go 侧的注入方式。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课（obs-sampling-propagation）结尾留下了一个悬而未决的痛点：采样会把低频错误采掉，而指标却依然诚实地报忧。现在把它讲得更具体。你在 Grafana 上盯着 `shop_http_request_duration_seconds` 的 p99 曲线，发现下午 14:03 开始从 300ms 一路爬到 2.8s——指标告诉你「支付变慢了」，这是它唯一能告诉你的。它不告诉你「是哪一个请求慢、慢在哪一次调用」。如果你在排障时只能停留在指标层，就只能猜测：是 SQLite 锁？是上游超时？是某条特定数据？这一节的主角 Exemplar（范例样本）就是为这个鸿沟造的桥：把「一次具体观测」的引用（通常是 trace_id + span_id）挂在指标样本上，让排障者能从聚合曲线一步跳回单次请求的完整现场。",
    },
    {
      type: "definition",
      term: "Exemplar（范例样本）",
      definition: "挂在某个指标样本上的参考数据：在记录该样本值的同时，附上一组键值标签，通常携带当时的 trace_id 与 span_id，指向产生这次观测的那条具体 trace。Exemplar 是 OpenMetrics 规范引入的概念，作用是弥合「聚合指标没有个体信息」与「trace 才能还原个体」之间的断层。",
    },
    {
      type: "heading",
      text: "Exemplar 的形态",
    },
    {
      type: "paragraph",
      text: "在 OpenMetrics 文本格式中，exemplar 以 `#` 注释行的方式紧随样本值之后出现，携带标签与时间戳。它的 wire 细节（精确的转义规则、protobuf 表示）不必在此展开，只要认得它的样子：一条 histogram 样本的 `_bucket` 行后附上 `# {trace_id=\"...\", span_id=\"...\"} 值 时间戳`，说明「落进这个桶的观测里，有一条来自该 trace」。真正重要的语义有两点：第一，exemplar 是「近期样本的抽样快照」而不是全量历史——client 侧每个桶只保留最新（或少量）的 exemplar；第二，它的价值不取决于它自己，而取决于标签里的 trace_id 能否被追踪后端解析——这决定了「点击跳转」能不能成立。",
    },
    {
      type: "code",
      title: "OpenMetrics 中挂在 histogram 桶上的 exemplar（示意）",
      language: "text",
      code: `# TYPE shop_http_request_duration_seconds histogram
shop_http_request_duration_seconds_bucket{route="/payments",le="0.5"} 9821
shop_http_request_duration_seconds_bucket{route="/payments",le="1"} 9850
# 上面 le="1" 桶多出来的 29 次观测里，有一次带着这条 trace 的引用
# （exemplar 跟在样本行后：# {标签} 值 时间戳，时间戳为秒）：
shop_http_request_duration_seconds_bucket{route="/payments",le="1"} 9850 # {trace_id="463ac35c9f6413ad48485a3953bb6124",span_id="00f067aa0ba902b7"} 0.87 1725609600
shop_http_request_duration_seconds_bucket{route="/payments",le="+Inf"} 9930`,
    },
    {
      type: "heading",
      text: "Prometheus 侧的存储与显示",
    },
    {
      type: "paragraph",
      text: "Exemplar 要真正可用，需要 Prometheus 收下并保存它们。Prometheus 的 exemplar 存储是一个全 series 共享的定长环形缓冲（circular buffer），只存在内存中、按条数限制大小（可在配置文件里经 `storage.exemplars.max_exemplars` 调整，默认上限为 10 万条）——再次强调它是「近期样本的放大镜」。关于开关状态有一个容易混淆的点需要澄清：exemplar 存储能力自 Prometheus 2.x 引入时由 `--enable-feature=exemplar-storage` 开启，官方 feature flag 文档至今仍把它列为可选项；3.14 中该能力仍由这一 feature 开关控制，未显式开启时 exemplar 不会被留存——具体以你所部署版本（3.14）的官方文档为准。classic histogram（client_golang 默认暴露的形式）与 native histogram 都支持携带 exemplar；其中 native histogram 的启用方式随版本演进：Prometheus 3.9 起 `--enable-feature=native-histograms` 已成为 no-op（native histograms 已转正为稳定特性），改为在每个 scrape job 上设置 `scrape_native_histograms: true`（默认 false）才会抓取 native 序列。本课程示例使用 classic histogram，不涉及 native 开关。",
    },
    {
      type: "heading",
      text: "Go client 侧：把 exemplar 挂上去",
    },
    {
      type: "paragraph",
      text: "Prometheus 的 Go client（client_golang 1.24）提供两组带 exemplar 的记录接口：counter 实现 `ExemplarAdder`（`AddWithExemplar(value, labels)`），histogram 实现 `ExemplarObserver`（`ObserveWithExemplar(value, labels)`）。经典 histogram 为每个桶保留一个 exemplar——新观测落入某桶时会替换该桶的旧 exemplar，因此同一时刻每条 series 的每个桶至多携带一个「最近的观察」；summary 不支持携带 exemplar（OpenMetrics 文本格式中没有它的位置）。manual 方式就是显式构造标签（把当前 span 的 trace_id 取出来塞进 `prometheus.Labels`）再调用这些方法。真正省心的是中间件自动注入：`promhttp` 的 `InstrumentHandlerDuration` / `InstrumentHandlerCounter` 等封装接受选项参数，其中 `WithExemplarFromContext(func(ctx context.Context) prometheus.Labels)` 让你提供「从请求 context 里提取 trace_id 的函数」——HTTP 中间件内部会对支持 exemplar 的指标调用带 exemplar 的记录方法，标签来自你提供的函数，请求处理全程无感。promhttp 还有对应的 `WithExemplarFromRequest`（从请求而非 context 取标签）选项。如果你的代码用的是自己的 HTTP 处理逻辑而不是 promhttp 中间件，则需要手动完成「从 context 取 trace_id → 构造 Labels → 调 ObserveWithExemplar」这三步——这正是下面代码里 `observeWithTrace` 示范的。函数签名与选项命名随版本可能微调，以 client_golang 1.24 官方文档为准。",
    },
    {
      type: "code",
      title: "client_golang：手动挂 exemplar 与中间件注入（Go）",
      language: "go",
      code: `import (
    "context"
    "net/http"

    "go.opentelemetry.io/otel/trace"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

// 1) 手动：把当前 OTel span 的 trace_id 挂到一次观测上。
//    只有 context 里存在已采样的 span 时才值得挂——未采样的 trace
//    即使被引用，跳过去也是一条空记录。
func observeWithTrace(ctx context.Context, h prometheus.Observer, dur float64) {
    if sc := trace.SpanContextFromContext(ctx); sc.IsSampled() && sc.IsValid() {
        if eo, ok := h.(prometheus.ExemplarObserver); ok {
            eo.ObserveWithExemplar(dur, prometheus.Labels{
                "trace_id": sc.TraceID().String(),
                "span_id":  sc.SpanID().String(),
            })
            return
        }
    }
    h.Observe(dur) // 不支持 exemplar 或没有 span 时回退为普通观测
}

// 2) promhttp 中间件注入：把提取函数作为选项传入。
//    handler 为被包装的 HTTP 处理函数；提取函数返回 nil 时不附加 exemplar。
func instrumentPayments(handler http.Handler) http.Handler {
    return promhttp.InstrumentHandlerDuration(
        paymentDuration, // prometheus.ObserverVec（构造见第 obs-prometheus-instrumentation 课）
        handler,
        promhttp.WithExemplarFromContext(func(ctx context.Context) prometheus.Labels {
            sc := trace.SpanContextFromContext(ctx)
            if !sc.IsSampled() || !sc.IsValid() {
                return nil
            }
            return prometheus.Labels{
                "trace_id": sc.TraceID().String(),
                "span_id":  sc.SpanID().String(),
            }
        }),
    )
}

// 选项命名（WithExemplarFromContext / WithExemplarFromRequest）以
// client_golang 1.24 官方文档为准；promhttp 选项完整列表见官方文档。`,
    },
    {
      type: "heading",
      text: "OTel 侧：采样与 exemplar 的隐藏联动",
    },
    {
      type: "paragraph",
      text: "如果你走的是 OTel 指标管线（本课程 demo 中 shop 的指标经 Collector 的 OTLP receiver 进入 Prometheus，见第 obs-full-stack-deploy 课），exemplar 的产生机制略有不同但更自动化。OTel Go 的 Metrics SDK 在每次记录测量时，会从 context 里取出当时的 SpanContext 作为候选 exemplar，经过一个 reservoir（蓄水池）抽样后随数据点导出——也就是说只要你在 span 内记录延迟，SDK 就自动为你保留了「这次测量属于哪条 trace」的引用，无需手写。它还有一个与上一课呼应的默认行为：SDK 默认的 exemplar 过滤器是 TraceBasedFilter——只有 context 里存在「已采样」的 span 时，测量才会被作为 exemplar 候选。这形成了一条漂亮的因果链：被采样策略选中的 trace，其 span 内的测量才有资格成为 exemplar；采样率越高，指标上能挂出的 exemplar 越密。反过来说，这也意味着 exemplar 是对「已采样世界」的二次抽样，永远只是样本的样本。OTel 的 Prometheus exporter（`go.opentelemetry.io/otel/exporters/prometheus`）会把 OTLP 数据点上的 exemplar 转写为 Prometheus 格式的 exemplar，标签使用约定俗成的 `trace_id` / `span_id` 键名——整条链路（应用 SDK → OTLP → Collector → Prometheus）上 exemplar 都能被保留下来。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "Exemplar 是放大镜，不是历史查询工具",
      body: "无论走哪条路径，都要记住 exemplar 的边界：client 侧每个桶只保留最近的一两个代表，Prometheus 侧的环形缓冲也按条数上限淘汰（默认约 10 万条、可配置）。它无法回答「昨天下午所有超过 2s 的请求」——那是 trace 与日志的领域。exemplar 擅长的是「此刻曲线异常，给我一个具体样本看看」。所以 exemplar 的实际作用是把指标当作入口：从异常的时间点拿到一个 trace_id，再进入 Tempo 展开整棵树。把它当作索引而非仓库，才不会在需要完整历史时失望。",
    },
    {
      type: "heading",
      text: "完整链路：从 p99 曲线到根因",
    },
    {
      type: "paragraph",
      text: "把这一课与前面所有内容串起来，就是三信号互相引用、逐层下钻的完整图景。以贯穿全课程的 shop 支付延迟故障为例走一遍：① Grafana 上 `histogram_quantile(0.99, rate(shop_http_request_duration_seconds_bucket{route=\"/payments\"}[5m]))` 曲线从 300ms 抬到 2.8s——指标说「有问题」；② 点击曲线上那个 exemplar 标记（若未开启 exemplar 显示，可到该时间点附近手动查询 exemplar），拿到 trace_id `463ac...`，Grafana 检测到 Tempo 数据源后直接跳转到这条 trace——从「哪一段时间」精确到「哪一次请求」；③ Tempo 里展开这条 trace：order → payment → stock 的嵌套 Span，发现耗时集中在 stock 的 `UPDATE stock` SQL 子 Span 上——慢在数据库写；④ 日志早已通过 `trace_id` 字段与这条 trace 关联（第 obs-structured-logging 课的做法），按同一 trace_id 过滤 Loki，看到 stock 反复出现 `database is locked`（SQLite busy timeout 不足）——拿到根因。这条链的关键句是：metrics 负责报警（聚合），exemplar 负责架桥（指标→trace），trace 负责还原（哪次请求、哪一跳、哪个属性），日志负责解释（为什么）。五个环节缺了 exemplar，前三步就要靠运气与手工猜测来衔接。",
    },
    {
      type: "code",
      title: "把「曲线 → exemplar → trace → 日志」的关联画成查询串",
      language: "text",
      code: `# 1. Prometheus：异常时间窗内，这条支付延迟 series 上的 exemplar
#    （Grafana Explore → 勾选 Exemplars → 点击数据点旁的点号）
GET /api/v1/query?query=shop_http_request_duration_seconds_bucket{route="/payments",le="5"}
# => 返回该 series 的 exemplar：trace_id="463ac35c9f6413ad48485a3953bb6124"

# 2. Tempo（Grafana 数据源跳转后等价于）：
#    按 trace_id 取整条 trace，定位慢 span（stock 的 SQL 写）
#    trace_id: 463ac35c9f6413ad48485a3953bb6124

# 3. Loki：用同一个 trace_id 过滤日志，看 stock 组件内部发生了什么
#    （标签名取决于 Collector 侧把 resource 的
#      service.name 映射为 service_name，与 troubleshooting 课一致）
{service_name="shop"} |= "463ac35c9f6413ad48485a3953bb6124"
# => ... database is locked (5) [SQLITE_BUSY] ...`,
    },
    {
      type: "keypoints",
      items: [
        "Exemplar 是挂在指标样本上的引用（通常 trace_id + span_id），补上了「指标知道变慢、但不知道是哪次请求」的断层",
        "OpenMetrics 中 exemplar 以样本后的 `# {标签} 值 时间戳` 形式出现，client 侧每个桶只保留最新的代表",
        "Prometheus 的 exemplar 存储是定长环形缓冲（内存、按条数限制），是否默认开启随版本而异，以 3.14 官方文档与 feature flag 为准",
        "classic 与 native histogram 都支持 exemplar；native 需额外开启（3.9 起旧 flag 为 no-op，改用 scrape job 的 scrape_native_histograms）",
        "client_golang 提供 AddWithExemplar / ObserveWithExemplar，promhttp 中间件可用 WithExemplarFromContext 自动从 context 提取 trace_id",
        "OTel Metrics SDK 自动把测量与当时的 SpanContext 关联为 exemplar，且默认只在已采样 span 内生效——与采样策略形成联动",
        "排障链：指标报警 → exemplar 跳到 trace → trace 定位慢 span → trace_id 过滤日志找到根因；exemplar 是近期样本的放大镜而非历史仓库",
      ],
    },
  ],
};
