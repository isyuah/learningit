/* ==================================================================
 * 课时：PromQL：查询与计算（obs-promql）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 版本边界：Prometheus 3.14（2026-08），PromQL 语法与 2.x 兼容。
 * 本课只讲本课程会用到的函数语义，不列参考大全；衔接数据模型课
 * （obs-prometheus-model）与埋点课（obs-prometheus-instrumentation），
 * 输出直接供告警课（obs-alerting）消费。指标均为 shop 示例服务指标。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-promql",
  courseSlug: "observability",
  title: "PromQL：查询与计算",
  summary: "选择器与两种向量、counter 的 rate 家族、错误率/延迟/饱和度的标准写法——把原始序列算成能回答问题的数字。",
  minutes: 36,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "数据模型课（obs-prometheus-model）讲清了拉取模型与指标类型，埋点课（obs-prometheus-instrumentation）为 shop 埋上了 `shop_http_requests_total{method,route,status}` 与 `shop_http_request_duration_seconds` 这些原始序列。但原始序列回答不了任何业务问题：每秒有多少请求？多慢算慢？百分之多少是错的？PromQL（Prometheus Query Language）就是把时间序列算成答案的语言，也是本课程唯一需要系统掌握的查询语言——今天的每一个表达式，下一课（obs-alerting）都会变成告警规则，排障课（obs-troubleshooting）里则直接拿它定位故障。学完本课，你应该能独立写出覆盖 Latency / Traffic / Errors / Saturation 的标准查询，并且清楚每个函数为什么这样用、边界在哪——而不是背一张函数表。",
    },
    {
      type: "heading",
      text: "选择器与两种向量",
    },
    {
      type: "paragraph",
      text: "PromQL 查询的骨架是 `指标名{标签筛选}`：先选出一组时间序列（series），再对它们施加计算。`shop_http_requests_total` 单独写表示该指标名下的全部序列；大括号里是**标签匹配器（label matcher）**，多个条件之间是与（AND）关系，序列必须同时满足才算命中。匹配器共四类：`=` 精确相等（`status=\"500\"`）；`!=` 不相等；`=~` 正则匹配，而且正则是**完全锚定**的——`status=~\"5..\"` 匹配恰好三个字符、以 5 开头的状态码（500、502、503…），不是「包含 5」；`!~` 正则不匹配。埋点课在 shop 上设置的 method、route、status 标签，现在全部变成查询维度：`shop_http_requests_total{route=\"/orders\"}` 只看下单链路，`shop_http_requests_total{method=\"POST\", route=~\"^/payments|^/orders\"}` 筛选两类写操作。注意：指标里每个标签组合都是一条独立序列，不加筛选时返回的就是全部序列——Console 结果里一行就是一条序列。",
    },
    {
      type: "paragraph",
      text: "查询结果有两种形态，分清它们是理解后面一切的基石。**即时向量（instant vector）**：在求值时刻，每个序列取**最近一个样本**，输出「每条序列 → 一个值」的表——单独写 `shop_http_requests_total` 得到的就是即时向量。**范围向量（range vector）**：在查询后加 `[5m]`，如 `shop_http_requests_total[5m]`——每个序列返回**过去 5 分钟窗口内的全部样本**（一串带时间戳的点），窗口写法支持 5m、1h、1d 等单位。为什么要先分清：能施加的运算完全不同——算术、比较、聚合（sum/avg）吃即时向量；rate、increase 这类「看变化」的函数**只接受范围向量**。写错输入形态时，Prometheus 最常见的报错就是 expected instant vector / range vector。后续所有关于速率、占比、分位数的查询，本质都是同一条流水线：取范围向量 → 用 rate 家族压成即时向量 → 聚合与比较。",
    },
    {
      type: "heading",
      text: "counter 的正确打开方式：rate、irate、increase",
    },
    {
      type: "paragraph",
      text: "对 counter 型指标，最常犯的概念错误是直接拿原始值做算术。counter 记录的是**自进程启动以来的累计值**：进程重启就归零，而且任何两个样本的差都包含它们之间发生的全部增长。所以——**绝不要对原始 counter 做 sum/avg**：把两个重启时间不同的实例加总，任一实例重启都会让总和突然掉一截，画出的曲线带着与业务无关的「假下跌」；把累计值拿来平均更是没有时间含义。要回答「多快」，用 rate 家族。`rate(counter[5m])` 返回窗口内**每秒平均增长速率**：它对重启归零免疫（样本倒退会被当作一次重置而非负数），是画曲线、算占比、写告警的默认选择。`irate(counter[5m])` 只看窗口内**最后两个样本**的斜率：反应最快，也最受单次采样噪声影响，适合肉眼看瞬时尖峰，不适合做稳定统计与告警。`increase(counter[5m])` 回答「这个窗口**新增了多少**」，约等于 rate × 窗口秒数，适合「最近 5 分钟失败了几次订单」这类问题；但两端存在边界外推（按采样间隔推测窗口外的增长），整数计数器可能得到非整数结果，窗口越小、样本越少越不可靠。与之相对，gauge（如 `shop_payments_inflight` 在途支付数）是**瞬时读数**——现在是多少就是多少，直接画线、设阈值，对它套 rate 是高频错误，见文末 warning。",
    },
    {
      type: "code",
      title: "rate / irate / increase：对 counter 的标准三连",
      language: "promql",
      code: "# 每秒请求速率：重启安全，画流量曲线、写告警的默认写法\nrate(shop_http_requests_total[5m])\n\n# 只看最后两个样本的瞬时斜率：响应快、噪声大，肉眼找尖峰用\nirate(shop_http_requests_total[5m])\n\n# 最近 5 分钟失败的订单数（约等于 rate × 300s，边界外推使结果未必是整数）\nincrease(shop_orders_failed_total[5m])",
    },
    {
      type: "heading",
      text: "高频模式：错误率、延迟与饱和度",
    },
    {
      type: "paragraph",
      text: "先看 Errors。错误率的定义是「5xx 请求占全部请求的比例」。直接照搬直觉写「5xx 总数 ÷ 总请求数」会踩两个坑。其一是两侧都必须先 rate：原始 counter 之比是「自启动以来的历史占比」，实例一重启就跳变，没有时间窗口意义。其二是**顺序**：必须先对每个 counter 序列单独 rate，再做聚合——rate 是逐序列运算，依赖每条序列自己的增长与重启历史；若先把多实例、多状态码的原始值 sum 成一条再 rate，等于把重启时刻各不相同的计数混在一起，语义即刻崩坏，这就是「先 rate 后聚合、顺序不可反」。聚合语法：`sum(...)` 把剩余标签全部合并成一个数；`sum by (route)(...)` 保留 route 分组、合并其余标签，用来回答「错误是否集中在某条路由」；`sum without (method)(...)` 则显式排除指定标签后再合并。分子分母用相同的 by 子句时，两者标签集一致，除法会按路由逐组进行。",
    },
    {
      type: "paragraph",
      text: "再看 Latency。直方图在存储层展开成一组 `..._bucket{le=\"...\"}` 序列，客户端总会补一个 `le=\"+Inf\"` 兜底桶。**每个桶的计数 = 观测值 ≤ le 的累计次数**，因此随着 le 增大，桶计数单调不减——这就是累积桶。对它 rate 之后，每个桶得到「每秒新增落入该桶的计数」，整组桶构成一张随时间滑动的分布。多实例、多路由各有自己的桶组，必须先 `sum by (le)`——**只保留 le 标签**，把同一桶界的计数跨实例累加，得到一张合并后的分布——再交给 `histogram_quantile(0.9, ...)` 估算分位数：它在这组桶上定位 p90 落在哪两个桶界之间，按边界**线性插值**给出估计值（桶分得越细越接近真实分布，数学细节不展开）。「p90 为什么比平均值更能代表体验」埋点课讲过，此处直接使用。饱和度/利用率的路数更简单：CPU、内存是 gauge 语义，读 node_exporter 或 Go runtime 指标直接画线、算占比即可（例如 CPU 用 `node_cpu_seconds_total` 做 rate 后求非 idle 占比），本课不展开 node_exporter 细节。",
    },
    {
      type: "code",
      title: "三张黄金信号查询（可直接粘进 Graph）",
      language: "promql",
      code: "# 全站 5xx 错误率：先 rate、再聚合、最后相除，顺序不可反\nsum(rate(shop_http_requests_total{status=~\"5..\"}[5m])) / sum(rate(shop_http_requests_total[5m]))\n\n# 按路由拆开看：错误集中在哪条路由（两侧标签集同为 {route}，可逐组相除）\nsum by (route) (rate(shop_http_requests_total{status=~\"5..\"}[5m])) / sum by (route) (rate(shop_http_requests_total[5m]))\n\n# 全站 p90 延迟：桶先 rate，sum by (le) 按桶界对齐累加，再一次估算分位数\nhistogram_quantile(0.9, sum by (le) (rate(shop_http_request_duration_seconds_bucket[5m])))",
    },
    {
      type: "callout",
      variant: "warning",
      title: "三个高频错误与反例",
      body: "对 counter 用 avg/sum 且不先 rate：`avg(shop_http_requests_total{route=\"/orders\"})` 把「自启动以来的累计值」跨实例平均——任一实例重启都会让结果突然下跌，数值也没有任何时间维度。对 gauge 用 rate：`rate(shop_payments_inflight[5m])`——gauge 可升可降，rate 假设序列只增（把下降当作重置），结果必然误导；gauge 要变化率应使用 delta/deriv，多数场景直接看原始值即可。histogram_quantile 聚合顺序错：`histogram_quantile(0.9, sum(rate(shop_http_request_duration_seconds_bucket[5m])))` 忘记 `by (le)`——sum 把全部桶界并成一条，分位数没有分布可算，结果无意义；先对每条序列单独 histogram_quantile 再平均也不对——分位数不可线性平均。正确写法只有一种：桶先按 le 对齐累加（sum by (le)），再一次估算分位数。",
    },
    {
      type: "paragraph",
      text: "实操建议：把上面的表达式逐条粘进 Prometheus 网页的查询框。Console 页签在**时间范围右端这一时刻**做一次求值并把结果显示成表——适合先验证语法、看当前数值是否合理；Graph 页签按时间范围（如最近 1 小时）逐点求值画出曲线，步长（Resolution）默认随范围与图宽自动推导，也可以手动指定——它决定「每隔多久求值一次」，与表达式里的范围向量窗口 `[5m]` 无关。动手最快的一课练习：把 `shop_http_requests_total` 和 `rate(shop_http_requests_total[5m])` 两条曲线叠在一起——原始 counter 是单调台阶、重启处下跳，rate 是平滑的每秒速率，这一眼就能固化本课全部直觉。下一课（obs-alerting）会把这些表达式变成带阈值的告警规则。",
    },
    {
      type: "quiz",
      question: "shop 部署了多个实例、每条路由都有请求。想监控「最近 5 分钟全站 5xx 请求占全部请求的比例」，下面哪个表达式是正确的？",
      options: [
        "sum(rate(shop_http_requests_total{status=~\"5..\"}[5m])) / sum(rate(shop_http_requests_total[5m]))",
        "sum(shop_http_requests_total{status=~\"5..\"}) / sum(shop_http_requests_total)",
        "avg(rate(shop_http_requests_total{status=~\"5..\"}[5m])) / avg(rate(shop_http_requests_total[5m]))",
        "rate(shop_http_requests_total{status=~\"5..\"}[5m]) / rate(shop_http_requests_total[5m])",
      ],
      answer: 0,
      explanation: "正确式先把每个 counter 序列单独 rate（处理重启归零、得到每秒速率），再各自聚合后相除，得到按请求量加权的全站错误率。B 是两个自启动累计值之比：无时间窗口意义，实例重启即跳变；C 对多实例求平均：每个实例等权，实例间流量差异被抹平，不是全站错误率；D 漏了聚合：分子分母标签集不同（分子只有 5xx 序列），元素级相除无法得到全站占比，必须先聚合再除。",
    },
  ],
};
