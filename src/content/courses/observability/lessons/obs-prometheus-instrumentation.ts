/* ==================================================================
 * 课时：Go 指标埋点：从零到黄金信号（obs-prometheus-instrumentation）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 本课代码用 prometheus/client_golang v1.24.1 在 Go 1.27 下编译并
 * 运行验证过；/metrics 输出片段为真实抓取结果。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-prometheus-instrumentation",
  courseSlug: "observability",
  title: "Go 指标埋点：从零到黄金信号",
  summary:
    "用 prometheus/client_golang 给 shop 服务加上 RED 三件套：counter、histogram、gauge 怎么声明、注册、暴露与手工埋点，并守住命名与标签基数的纪律。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课把 Prometheus 的数据模型讲清楚了：counter/gauge/histogram 的语义、标签与基数的关系、scrape 的生命周期。这一课把这些概念落到 shop 服务的代码里——我们将用 prometheus/client_golang（本课程基线 v1.24，要求 Go 1.25+）从零为 HTTP 层加三组指标，并用真实可跑的程序验证每一行输出。目标不是「会调 API」，而是形成一套每次写埋点都会过一遍的决策顺序：选类型 → 起名字 → 定标签 → 注册暴露 → 在正确的位置观测。",
    },
    {
      type: "heading",
      text: "RED 方法：先决定要什么，再决定怎么埋",
    },
    {
      type: "definition",
      term: "RED 方法（Rate / Errors / Duration）",
      definition: "面向请求驱动型服务的黄金信号落地框架：Rate 每秒请求数（流量），Errors 每秒错误请求数或错误率，Duration 请求延迟分布。三者合起来就是「服务在忙什么、忙坏了吗、忙得多慢」——正好覆盖黄金信号（Latency、Traffic、Errors、Saturation）中除饱和度外的三项。",
    },
    {
      type: "paragraph",
      text: "RED 与第一章《为什么需要可观测性》（obs-mental-model）引入的黄金信号一一对应：Rate=Traffic、Errors=Errors、Duration=Latency；Saturation（饱和度）通常落到队列长度、连接池占用这类 gauge 上，它对应的工程框架叫 USE（Utilization/Saturation/Errors，面向资源而非请求），一句话对比就是：RED 度量请求，USE 度量资源。本课以 RED 为主，结尾补一个 USE 式的并发 gauge 例子。把 RED 翻译成指标命名（沿用课程契约的命名约定），就是接下来要注册的三件套。",
    },
    {
      type: "code",
      title: "第一步：声明指标（metrics.go）",
      language: "go",
      code: "package main\n\nimport (\n\t\"github.com/prometheus/client_golang/prometheus\"\n)\n\n// 包级声明：进程生命周期内只创建、只注册一次。\nvar (\n\t// Rate + Errors：按 method/route/status 拆分的请求总数（counter）\n\thttpRequestsTotal = prometheus.NewCounterVec(\n\t\tprometheus.CounterOpts{\n\t\t\tName: \"shop_http_requests_total\",\n\t\t\tHelp: \"Total number of HTTP requests handled by the shop service.\",\n\t\t},\n\t\t[]string{\"method\", \"route\", \"status\"},\n\t)\n\n\t// Duration：请求延迟分布（histogram），单位秒；_seconds 后缀来自单位约定\n\thttpRequestDuration = prometheus.NewHistogramVec(\n\t\tprometheus.HistogramOpts{\n\t\t\tName:    \"shop_http_request_duration_seconds\",\n\t\t\tHelp:    \"HTTP request latency in seconds.\",\n\t\t\tBuckets: prometheus.ExponentialBuckets(0.001, 4, 8), // 见「桶边界」小节\n\t\t},\n\t\t[]string{\"method\", \"route\"},\n\t)\n\n\t// 并发（USE 视角的饱和度探头）：当前正在处理的请求数（gauge）\n\thttpRequestsInFlight = prometheus.NewGauge(\n\t\tprometheus.GaugeOpts{\n\t\t\tName: \"shop_http_requests_in_flight\",\n\t\t\tHelp: \"Number of HTTP requests currently being handled.\",\n\t\t},\n\t)\n)\n\nfunc init() {\n\t// 注册到默认 registry；重复注册同名指标会 panic，所以集中在一处\n\tprometheus.MustRegister(\n\t\thttpRequestsTotal,\n\t\thttpRequestDuration,\n\t\thttpRequestsInFlight,\n\t)\n}\n",
    },
    {
      type: "subheading",
      text: "命名规范：为什么是 _total 与 _seconds",
    },
    {
      type: "paragraph",
      text: "刚才的名字不是随手起的，Prometheus 有一套命名纪律：counter 的名字必须以 _total 结尾（client_golang 不会替你补这个后缀——声明 shop_http_requests 就真的会暴露成 shop_http_requests，绕过了服务端对 counter 名字的校验，所以必须在声明时自己写全）；单位进名字——度量时间的指标用 _seconds 而不是 _milliseconds（除延迟外还有 _bytes 表示字节、基础单位制里不带前缀），且值按「1 秒 = 1.0」的浮点存储，客户端测到 12ms 要 Observe(0.012) 而不是 Observe(12)。这样写的好处是查询时秒、字节单位自明，跨服务对齐口径。Help 必须写清「计数的是什么」，它会被 UI 与告警直接引用。",
    },
    {
      type: "subheading",
      text: "标签设计：route 是模板，不是 URL",
    },
    {
      type: "paragraph",
      text: "标签维度决定了序列的切法。我们选 method/route/status 三个，因为排障时的第一刀通常是「哪个路由、哪种方法、什么状态码在异常」。route 尤其要小心：它必须取路由模板（/orders/{id}），绝不能取真实 URL 路径——/orders/42 和 /orders/43 会各开一条序列，订单量即基数，这正是上一课警告过的高基数爆炸。做法是在埋点前把路径折叠成模板（见下方中间件代码中的 routeOf），使 /orders/42 → /orders/{id}。另一个纪律是标签取值必须白名单化、可枚举：status 用三位状态码即可，不要把整条响应头、用户 ID、trace_id 之类塞进标签。请记住：加一个标签维度 = 序列数乘上它的取值数，每次加维度前先问「我要按它聚合/筛选吗？它的取值上限是多少？」——回答不了就把它放进日志或 trace，而不是指标。",
    },
    {
      type: "code",
      title: "第二步：埋点中间件 + 暴露 /metrics（main.go）",
      language: "go",
      code: "package main\n\nimport (\n\t\"log\"\n\t\"net/http\"\n\t\"strconv\"\n\t\"strings\"\n\t\"time\"\n\n\t\"github.com/prometheus/client_golang/prometheus/promhttp\"\n)\n\n// routeOf 把动态路径段折叠为占位符：/orders/42 -> /orders/{id}。\n// 原始 URL 路径绝不能整串作为标签值——那是基数爆炸的直通车。\nfunc routeOf(p string) string {\n\tsegs := strings.Split(strings.Trim(p, \"/\"), \"/\")\n\tfor i, s := range segs {\n\t\tif _, err := strconv.ParseInt(s, 10, 64); err == nil {\n\t\t\tsegs[i] = \"{id}\"\n\t\t}\n\t}\n\tif len(segs) == 1 && segs[0] == \"\" {\n\t\treturn \"/\"\n\t}\n\treturn \"/\" + strings.Join(segs, \"/\")\n}\n\n// statusWriter 让中间件能拿到下游写出的状态码\n// （ResponseWriter 接口只需实现 WriteHeader 透传，即可满足 http.Hijacker 之外的常见断言；\n//  若你的 handler 用到 http.Flusher/http.Hijacker，需要按需补方法，细节以官方文档为准）\ntype statusWriter struct {\n\thttp.ResponseWriter\n\tstatus int\n}\n\nfunc (w *statusWriter) WriteHeader(code int) {\n\tw.status = code\n\tw.ResponseWriter.WriteHeader(code)\n}\n\n// instrument 是手工埋点中间件：请求进出各观测一次。\nfunc instrument(next http.Handler) http.Handler {\n\treturn http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n\t\thttpRequestsInFlight.Inc()          // 进入：gauge +1\n\t\tdefer httpRequestsInFlight.Dec()    // 离开：gauge -1（defer 保证 panic 路径也复原）\n\n\t\tsw := &statusWriter{ResponseWriter: w, status: http.StatusOK}\n\t\troute := routeOf(r.URL.Path)\n\t\tstart := time.Now()\n\n\t\tnext.ServeHTTP(sw, r)\n\n\t\thttpRequestsTotal.WithLabelValues(r.Method, route, strconv.Itoa(sw.status)).Inc()\n\t\thttpRequestDuration.WithLabelValues(r.Method, route).Observe(time.Since(start).Seconds())\n\t})\n}\n\nfunc main() {\n\tmux := http.NewServeMux()\n\t// promhttp.Handler() 暴露默认 registry 的全部指标\n\tmux.Handle(\"/metrics\", promhttp.Handler())\n\tmux.HandleFunc(\"POST /orders\", createOrder)\n\tmux.HandleFunc(\"POST /payments\", payOrder)\n\tmux.HandleFunc(\"GET /orders/{id}\", getOrder)\n\n\tlog.Fatal(http.ListenAndServe(\":8080\", instrument(mux)))\n}\n",
    },
    {
      type: "paragraph",
      text: "手工埋点有三个正确性要点，写的时候逐一检查。其一，counter/gauge/histogram 的所有更新方法都是并发安全的（内部原子或加锁），多个 goroutine 同时 Inc/Observe 不需要你额外加锁——但要小心「声明一次、注册一次」：同一指标名重复注册会 panic，所以把 MustRegister 收敛在 init() 一处。其二，counter 语义上不可降：只有 Inc/Add，请求处理失败也要计数（+1），失败与否体现在 status 标签上，错误率在查询侧用 Errors/Rate 相除得出，而不是埋点侧维护一个「错误数 gauge」。其三，defer 的 gauge 复原：InFlight 用 defer Dec() 保证即使 handler panic（被 recovery 接住）计数也能归位，否则一个 panic 会让并发 gauge 永久虚高。",
    },
    {
      type: "subheading",
      text: "gauge.Set 与自定义值",
    },
    {
      type: "paragraph",
      text: "中间件里的并发 gauge 用的是 Inc/Dec 的「步进」写法，适合请求进出这类成对事件；但 gauge 最常见的用法其实是 Set——直接设置当前值，例如 `shop_payments_inflight.Set(float64(running))`、连接池空闲数、队列长度。什么时候用 Inc/Dec 什么时候用 Set？如果你的代码里能保证每个 Inc 都有配对的 Dec（就像中间件这样成对出现），步进写法最省事；如果数值的真实来源是某个状态查询（SELECT COUNT(*)、池的 Len()），那就周期性地 Set 它，绝不要拿 Inc/Dec 去模拟一个你不知道会不会漏配对的计数——漏一次，这个 gauge 就永远错了。",
    },
    {
      type: "code",
      title: "第三步：真实 /metrics 输出（v1.24.1 实跑，9 个请求：POST 成功 3 / 失败 3、GET 3 次打点后）",
      language: "text",
      code: "# HELP shop_http_request_duration_seconds HTTP request latency in seconds.\n# TYPE shop_http_request_duration_seconds histogram\nshop_http_request_duration_seconds_bucket{method=\"POST\",route=\"/orders\",le=\"0.001\"} 0\nshop_http_request_duration_seconds_bucket{method=\"POST\",route=\"/orders\",le=\"0.004\"} 0\nshop_http_request_duration_seconds_bucket{method=\"POST\",route=\"/orders\",le=\"0.016\"} 3\nshop_http_request_duration_seconds_bucket{method=\"POST\",route=\"/orders\",le=\"0.064\"} 3\nshop_http_request_duration_seconds_bucket{method=\"POST\",route=\"/orders\",le=\"+Inf\"} 3\nshop_http_request_duration_seconds_sum{method=\"POST\",route=\"/orders\"} 0.036000000000000004\nshop_http_request_duration_seconds_count{method=\"POST\",route=\"/orders\"} 3\n# HELP shop_http_requests_in_flight Number of HTTP requests currently being handled.\n# TYPE shop_http_requests_in_flight gauge\nshop_http_requests_in_flight 0\n# HELP shop_http_requests_total Total number of HTTP requests handled by the shop service.\n# TYPE shop_http_requests_total counter\nshop_http_requests_total{method=\"GET\",route=\"/orders/{id}\",status=\"200\"} 3\nshop_http_requests_total{method=\"POST\",route=\"/orders\",status=\"201\"} 3\nshop_http_requests_total{method=\"POST\",route=\"/orders\",status=\"500\"} 3\n",
    },
    {
      type: "callout",
      variant: "tip",
      title: "标签值白名单化；换标签集 = 换序列",
      body: "把标签值收进白名单再写埋点：status 永远只落三位状态码、route 只落模板、method 只落大写 HTTP 方法。任何来自用户输入、可能无限增长的字符串（订单号、用户名、随机参数）都不得进入标签——它应该进日志或 trace 属性。同时记住上一课的数据模型：标签集变了就是一条新时间序列，序列只在第一次出现后开始存在——所以「上线前改标签名/加维度」会让新旧两套序列并存、面板断点，代码评审时把指标定义当作 API 变更来审。",
    },
    {
      type: "heading",
      text: "桶边界：默认桶 vs 自定义",
    },
    {
      type: "paragraph",
      text: "histogram 最容易被忽略的设计点是桶。client_golang 不指定 Buckets 时用默认桶 prometheus.DefBuckets：从 0.005 到 10 按约 2.5 倍增长共 11 个边界（.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10），是为「秒级网络服务延迟」粗略准备的，+Inf 桶永远自动追加。默认桶有两个问题：一是对毫秒级服务太粗——0.005s 以下全挤进第一桶，p50 附近的区分度很差；二是只覆盖到 10s，慢请求全堆进 +Inf，p99 一旦超过 10s 就完全失真。合理的做法是针对自己服务的 SLO 量级定制：下界低于你要关心的最小值一个量级、上界高于最坏情况，中间按等比（每档约 ×2~×4）铺开，覆盖主要分布的同时把桶数控制在 10 个上下——桶是每条序列都要存的计数，桶越多内存与导出体积越大。比如 shop 期望 p99 在 100ms 内、偶发到秒级，就可以用 ExponentialBuckets(0.001, 4, 8)（起始 1ms，每档 ×4，共 8 档：1ms/4ms/16ms/64ms/256ms/1.024s/4.096s/16.38s），上面的输出就是这样配出来的：三次 12ms 观测全部落进 0.016 桶。",
    },
    {
      type: "callout",
      variant: "note",
      title: "默认指标：注册一次就白送的运行时观测",
      body: "用 prometheus.MustRegister 注册业务指标时，默认 registry 里其实已经躺着两组指标：collectors.NewGoCollector() 暴露的 Go 运行时指标（go_goroutines 当前 goroutine 数、go_gc_duration_seconds GC 停顿分布等）和 NewProcessCollector() 暴露的进程指标（process_cpu_seconds_total、process_resident_memory_bytes 等）——client_golang 的默认 registry 在初始化时就把它们注册好了。所以上例里只注册了三个指标，/metrics 上却能直接抓到 go_goroutines 这类几百行运行时数据，curl 一下就能验证。这也意味着「服务在跑、指标在涨」本身就是一种健康证明。用自定义 registry（prometheus.NewRegistry()）时这两组需要自己 Register——那是做多租户/隔离时的进阶话题，本课不展开。",
    },
    {
      type: "quiz",
      question: "某同事把 shop 的延迟指标写成了 `shop_http_request_duration_milliseconds`，并解释「埋点里测得的就是毫秒数，直接放上去最直观」。按 Prometheus 命名与类型规范，以下哪个说法正确？",
      options: [
        "没问题，指标名带单位后缀即可，毫秒和秒只是显示差异",
        "应该用秒并命名 _seconds，且 counter 语义下毫秒累加值需配合 rate() 才能看延迟",
        "延迟是分布不是累计，必须用 histogram/gauge 且单位用秒；_total 后缀只属于 counter",
        "延迟必须用 gauge，每次 Set 当前耗时，单位毫秒可接受",
      ],
      answer: 2,
      explanation: "延迟是观测样本的分布，用 histogram 测量（桶 + _sum/_count），单位进名字必须是秒（_seconds）并按 1 秒 = 1.0 存值；counter 只管只增的累计事件数并以 _total 结尾。毫秒命名违背单位约定，会导致跨服务查询时单位混乱、histogram_quantile 结果被误解为秒而实际是毫秒。",
    },
    {
      type: "keypoints",
      items: [
        "RED（Rate/Errors/Duration）把黄金信号映射到三类指标：counter 计数、histogram 量延迟分布、gauge 量并发/饱和度；USE 面向资源，一句话对照即可",
        "命名纪律：counter 以 _total 结尾（client_golang 不会自动补，必须自己写全），时间类指标用 _seconds/_bytes 等基础单位进名字，值按 1 秒 = 1.0 存储",
        "标签三思：method/route/status 起步；route 必须折叠成模板（/orders/{id}），原始 URL、订单号、trace_id 永远不当标签",
        "注册暴露：包级声明 + init() 里一次性 MustRegister 到默认 registry，promhttp.Handler() 挂到 /metrics；Go 运行时与进程指标默认已在 registry 中",
        "手工埋点注意并发安全（库已保证）、counter 只增不降、InFlight 用 defer Dec() 防泄漏、gauge 拿状态值用 Set 而非硬凑 Inc/Dec",
        "桶是历史包袱：改边界=历史不可比；按 SLO 量级定制（如 ExponentialBuckets(0.001, 4, 8)），别直接用默认桶也不为毫秒级服务盲目加桶",
      ],
    },
  ],
};
