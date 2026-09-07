/* ==================================================================
 * 课时：Prometheus 数据模型与采集（obs-prometheus-model）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-prometheus-model",
  courseSlug: "observability",
  title: "Prometheus 数据模型与采集",
  summary:
    "Prometheus 为什么用拉取模型、metric 与 label 如何构成时间序列、四种指标类型的语义差别，以及一次 scrape 的生命周期。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "在《三支柱：指标、日志、追踪》（obs-three-pillars）一课里我们说指标回答「系统现在处于什么状态」；而 Prometheus 是这门课里指标这一支柱的后端。从这一课开始，我们进入指标体系的工程细节：先弄清楚 Prometheus 到底「怎么把数字弄进来」（采集），以及「这些数字长什么样」（数据模型）。这两件事决定了后面所有查询、告警、面板的写法——顺序是：采集模型 → 数据模型（名字与标签）→ 指标类型（counter/gauge/histogram/summary）→ 一次完整抓取长什么样。这一课只讲概念与阅读，不写 PromQL（留给《PromQL：查询与计算》（obs-promql）课），埋点代码从下一课《Go 指标埋点：从零到黄金信号》（obs-prometheus-instrumentation）开始。",
    },
    {
      type: "heading",
      text: "拉取模型：Prometheus 主动来拿",
    },
    {
      type: "paragraph",
      text: "Prometheus 与大多数监控系统最根本的不同是方向：它不要求应用把数据「推」给某个中央服务，而是由 Prometheus 服务器周期性地访问每个应用暴露的 HTTP 端点（/metrics）把数据「拉」回来——这个过程叫 scrape（抓取）。拉取模型是 Prometheus 全设计的基石，它的好处要在操作层面体会。",
    },
    {
      type: "list",
      items: [
        "天然的服务发现：被监控对象只要在监听端口上提供服务，Prometheus 就能靠 DNS、Consul、Kubernetes 等机制找到它，把目标列表变成配置，无需在每个应用里配置「往哪儿推」。",
        "健康检查是免费的副作用：一次 scrape 要么成功要么失败，「拿不到数据」本身就是一个信号——目标进程死了、端口挂了、响应超时了，直接反映为 scrape 失败与 up 指标为 0，不需要另设心跳机制。",
        "有利于本地调试：因为数据是「Prometheus 主动 GET 一个 URL」，你在开发机上直接 curl 一下就能看到自己埋的指标，不需要先部署一套接收端；抓取间隔、超时、重试都由采集端统一控制，行为可预测。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "拉取 vs 推送：一个经典误区",
      body: "很多新手把 Pushgateway 当成「默认应该用」的组件，这其实把方向搞反了。对于常驻的在线服务，请始终默认用拉取：服务发现、健康检查、调试便利都是拉取送的。Pushgateway 的正确用途非常窄——它存在的理由是让「短命任务」（批处理、CI 作业、定时 job）也能上报数据，因为这类进程只在几秒到几分钟内活着，Prometheus 根本来不及抓到它。它本身不提供高可用、不做持久化、挂了会丢数据，而且在推模式下「进程死了」这件事不再可见（没有 scrape 就没有 up=0 一说）。判断标准很简单：你的进程是不是常驻服务？是，就用拉取。",
    },
    {
      type: "heading",
      text: "时间序列：名字 + 标签",
    },
    {
      type: "definition",
      term: "时间序列（time series）",
      definition: "Prometheus 存储与查询的基本单位：一个指标名加上一组唯一标签键值对，构成一条随时间推进不断追加新样本（时间戳 + 值）的数值流。换句话说，每条时间序列是一个「有名字、有身份」的单调增长的数值历史。",
    },
    {
      type: "paragraph",
      text: "先看一条最直观的例子：上一课的课程里（或者说任何用 client_golang 的服务里），`/metrics` 端点会输出类似 `http_requests_total{code=\"200\",handler=\"/api/v1/query\"} 1727` 这样的行。把它拆开：`http_requests_total` 是指标名（metric name），花括号里是标签（label），最后的 `1727` 是此刻的样本值，而样本真正落库时会带上抓取时刻的时间戳。指标名 + 整组标签值（不含值的顺序）才唯一定位一条时间序列——所以 `http_requests_total{code=\"200\",...}` 和 `http_requests_total{code=\"500\",...}` 是两条不同的序列，各自有独立的数值史，谁也不能覆盖谁。",
    },
    {
      type: "definition",
      term: "标签（label）",
      definition: "附加在指标上的 key=value 维度，用于把一条指标按业务维度切开。标签分为两类：指标本身声明的维度（如 method、route、status）由埋点代码决定，在服务端文本里可见；而 job 与 instance 两个「目标标签」是 Prometheus 抓取时自动加上的——job 来自抓取配置里的 job_name，instance 是抓取的目标地址，用来区分「这组数字来自哪个服务实例」。",
    },
    {
      type: "paragraph",
      text: "标签是 Prometheus 维度建模的灵魂，但也正是它的陷阱所在。每一条不同的标签值组合 = 一条全新的时间序列 = 服务端内存里常驻的一份样本队列。如果一个标签的取值空间很大或不可枚举，序列数量就会失控，这叫高基数（high cardinality）——这个概念在「三支柱」一课首次定义过，这里直接用它：比如把每次请求的原始 URL（含订单号、随机参数）当作 route 标签值，那么每个订单都会凭空造出至少一条序列，内存与磁盘随流量线性增长，最终拖垮整个 Prometheus。正确做法是把请求归并到有限集合：route 只取路由模板（/orders/{id}，而不是 /orders/42），或者干脆只留 method/status。基数不是「尽量不要太大」，而是「必须在设计时决定并守住」：你能数清一个标签所有可能的取值吗？数不清，它就不配做标签。下一课做埋点时会再次用具体例子落实这条纪律。",
    },
    {
      type: "heading",
      text: "指标类型：四种语义",
    },
    {
      type: "definition",
      term: "counter（计数器）",
      definition: "只增不减的累计值：请求总数、错误总数、订单创建数。它描述「发生了多少次」。进程重启后从 0 重新累计——这是特性不是 bug，查询时靠 rate()/increase() 计算速率（服务重启会在图上表现为一次回落，Prometheus 能识别并处理）。计数器的值只增，若语义上需要下降，说明类型选错了。",
    },
    {
      type: "definition",
      term: "gauge（仪表）",
      definition: "可增可减的瞬时值：当前处理中的请求数、队列长度、内存占用、温度。它描述「现在是多少」，采样到的每个点都代表那一刻的状态快照，不随时间单调。判断口诀：这个数值「下降」是否有意义？有意义就用 gauge。",
    },
    {
      type: "definition",
      term: "histogram（直方图）",
      definition: "测量「分布」而非「单点」的指标类型（如延迟、响应体大小）：观测值按预先声明的桶边界（bucket）累加——每个桶记录「≤ 该上界的观测有多少个」，同时维护所有观测值的总和 _sum 与个数 _count。Prometheus 侧用 histogram_quantile 从桶计数还原分位数（p50/p99 等），这是唯一不需要客户端预知分位数的方法。",
    },
    {
      type: "paragraph",
      text: "直方图有两个代价：桶边界必须提前拍定且事后很难改（改边界 = 换一套序列，历史不可比）；每个桶对每条标签组合都是一份计数，精度与存储开销成反比。它还有个孪生类型 summary：由客户端直接计算分位数。什么时候用 histogram、什么时候用 summary，先看下面的对比表。",
    },
    {
      type: "table",
      caption: "Prometheus 四种指标类型对比（summary 与 histogram 的取舍见《Exemplar：指标与追踪的桥》（obs-exemplars-bridges）一课的进阶部分）",
      headers: ["维度", "counter", "gauge", "histogram", "summary"],
      rows: [
        ["语义", "只增不减的累计值", "可增可减的瞬时值", "按预置桶累加观测值的分布 + _sum/_count", "客户端直接计算的分位数（+ _sum/_count）"],
        ["典型用途", "请求数、错误数、事件总数", "队列长度、连接数、并发量", "延迟/体积等分布的采集（配合 histogram_quantile 求 p99）", "不能聚合、但客户端即可得到分位数的场景（一般推荐 histogram）"],
        ["典型后缀", "_total", "无（语义即瞬时值）", "_bucket/_sum/_count（名字常以 _seconds/_bytes 结尾）", "_sum/_count + 预置分位数"],
        ["可否在服务端聚合", "可（rate/sum 等）", "可", "可（同桶边界才能相加）", "不可（分位数是预计算的，跨实例合并无意义）"],
        ["重启行为", "归零重新累计（查询时用速率吸收）", "无累计，重启即当前值", "归零", "归零"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "两个版本事实，先记住位置",
      body: "一是本课程基线是 Prometheus 3.14，client_golang 也是 1.24：这代默认仍是经典 histogram；实验性的 native histograms（原生直方图，桶动态指数增长、服务端自动分位数）在 Prometheus 3.x 里仍需要启动参数 --enable-feature=native-histograms 才会生效，细节放到《Exemplar：指标与追踪的桥》（obs-exemplars-bridges）课展开，现在只要知道它存在、并且默认不开启即可。二是 exemplar（范例，把样本关联到 trace）在 OTel/OpenMetrics 生态里是让指标能「点进」追踪的关键机制，本课暂不展开，专属课时《Exemplar：指标与追踪的桥》（obs-exemplars-bridges）再讲。",
    },
    {
      type: "heading",
      text: "一次抓取的生命周期",
    },
    {
      type: "paragraph",
      text: "把上面的概念串起来看一次真实 scrape。第一步，Prometheus 从配置里拿到抓取目标（target）列表——最小的做法是 static_configs 直接写死地址；生产上则会换用服务发现机制（Kubernetes、Consul、DNS 等，概念与 relabel 细节在《OpenTelemetry Collector》（obs-collector）与《部署全栈观测环境》（obs-full-stack-deploy）课再碰）。每个 job 下的每个目标，Prometheus 会得到一个地址，并自动为它贴上 job=配置里的 job_name 与 instance=目标地址两个标签。第二步，Prometheus 按 scrape_interval（如 15s）周期访问该地址的 HTTP 端点：默认取 /metrics 路径。这个端点返回的文本就是客户端库导出的指标：以 # HELP / # TYPE 注释开头的元信息行加上一条条样本行，这套文本协议叫 Prometheus 文本格式，其演进形态 OpenMetrics 是它的开放标准版本（OTel 侧采集到 Prometheus 的转换也遵循它）。第三步，Prometheus 解析文本、校验标签与类型，把每条样本以「指标名+标签 → 新时间戳上的新值」追加进对应时间序列；同时记录这次抓取本身的结果：scrape 成功与否、耗时、采样数——这些都落成 scrape_* 与 up 指标。up 是服务健康与否的第一手证据：up == 1 表示最近一次抓取成功，目标不可达、超时、响应 4xx/5xx 都会让 up 变 0。",
    },
    {
      type: "code",
      title: "一个最小的 Prometheus 抓取配置（prometheus.yml）",
      language: "yaml",
      code: "global:\n  scrape_interval: 15s      # 全局默认抓取间隔\n  evaluation_interval: 15s  # 规则（含告警）求值间隔\n\nscrape_configs:\n  - job_name: \"shop\"\n    static_configs:\n      - targets: [\"localhost:8080\"]   # shop 服务的 /metrics 端点\n",
    },
    {
      type: "paragraph",
      text: "启动 Prometheus 后，访问 http://localhost:9090/targets 能看到 shop 这个 job 与它的目标状态（up/down、上次抓取时间）；而 http://localhost:9090/metrics 是 Prometheus 自己暴露的 /metrics——它本身也是一个被观测对象。第一次用浏览器打开应用自己的 /metrics 端点（比如 http://localhost:8080/metrics），你会看到几百行文本。读它的规则很简单：`# HELP` 行解释这一族指标是什么；`# TYPE` 行声明类型（counter/gauge/histogram/summary）；随后每行样本 = 指标名 + 标签 + 空格 + 值；以 `#` 开头的其它行是注释。histogram 会以 _bucket{le=\"上界\"}、_sum、_count 三个后缀展开成多行，这也是你在文本里看到一长串 le= 行的原因。能逐行读懂这份原始输出，是接下来做埋点与写查询的基本功。",
    },
    {
      type: "keypoints",
      items: [
        "Prometheus 默认拉取：服务发现天然、scrape 失败即健康信号、本地 curl 即可调试；Pushgateway 只解决短命任务上报，不是在线服务的默认",
        "时间序列 = 指标名 + 唯一标签组合，一条序列一份独立历史；job/instance 由 Prometheus 抓取时自动打上",
        "高基数是设计问题：标签取值必须有限可枚举，原始 URL 永远不该成为标签值",
        "counter 只增（重启归零，靠速率查询吸收）；gauge 描述可上下波动的瞬时值；histogram 预置桶 + _sum/_count，服务端算分位数",
        "一次 scrape：static_configs/服务发现定目标 → GET /metrics → 文本/OpenMetrics 解析 → 追加样本；up 反映最近一次抓取成败",
        "文本格式可读：# HELP/# TYPE 是元信息，样本行=名字+标签+值；histogram 展开成多条 le= 桶行",
      ],
    },
  ],
};
