/* ==================================================================
 * 课时：Loki：以标签为中心的日志存储（obs-loki-logging）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-loki-logging",
  courseSlug: "observability",
  title: "Loki：以标签为中心的日志存储",
  summary: "Loki 不索引日志内容、只索引标签：把日志压成块存储、用类 PromQL 的 LogQL 按标签缩小范围再扫内容。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课把日志从「字符串」升级成了「结构化记录」，但还欠一个问题的回答：这些结构化日志送到哪里、怎么存、怎么查？选型之前先看清量级差异。指标一条几十字节、按固定步长采样，一年也就几十 GB 量级；日志逐请求甚至逐事件产出，高流量服务的日志一天就可能超过指标一整年的体积。面对这个量级，传统全文检索引擎（如 Elasticsearch）给每一行日志的每个词都建倒排索引，换来「任意内容秒级搜索」，代价是索引体积常达原始日志的数倍，集群因此昂贵。第 2 课（obs-three-pillars）已经完整论述过这套成本模型，这里直接看 Loki 的不同取舍：索引只落在标签上，内容一行不索引——日志被压缩后原样存储，查询时先用标签把范围缩小到少数几个流，再对范围内的行做过滤。一句话概括设计动机：既然绝大多数日志查询是「先定条件再翻内容」，就让索引保持极小，把力气花在压缩与扫面上。",
    },
    {
      type: "heading",
      text: "核心概念：stream 与 chunk",
    },
    {
      type: "definition",
      term: "stream（日志流）",
      definition: "一组拥有完全相同标签集的日志行按时间排列成的流。标签集就是流的身份：`{service_name=\"shop\", env=\"prod\"}` 是一个流，任一标签值不同（例如 env 换成 dev）就是另一个流。Loki 的组织单元是流，而不是单行日志——这与 Prometheus 用标签集唯一标识一条时间序列的模型完全同构。",
    },
    {
      type: "definition",
      term: "chunk（块）",
      definition: "一个流按时间切分出的连续日志段，压缩（默认 gzip）后作为一个整体存储与传输。chunk 是 Loki 的存储与压缩单元：写入时积累、封口、压缩、落盘；查询只读需要时间范围内的块。块底层可放进对象存储，所以日志「存得越多越便宜」，保留策略通常按天数配置，成本远低于全文索引方案。",
    },
    {
      type: "paragraph",
      text: "把两者放回成本模型里，就得到 Loki 的第一个「直觉公式」：标签每多一个新值（基数 cardinality 上升），可能的流数量就成倍增长，索引条目与维护成本随之上升，查询反而更碎片化。这个概念与第 6 课（obs-prometheus-instrumentation）的标签基数警告完全一致——你在指标上养成的标签纪律可以原样搬过来：标签用于「切分大方向」，而不是「精确到个体」。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "日志保留与成本直觉",
      body: "日志量越大，压缩块 + 对象存储的组合越划算；但块是压缩的，扫内容要解压，成本随数据量上升。所以保留策略要按「真的还要查多久」来定，也别为了「搜什么都能秒出」给日志堆高基数标签——把 `trace_id`、`request_id`、用户 ID 这类逐请求变化的值做成标签，会让流数量爆炸，亲手摧毁 Loki 的索引优势。这类值留在行内的结构化字段里，查询时用行内过滤器扫，才是设计意图。",
    },
    {
      type: "heading",
      text: "标签怎么选：推荐集与高基数红线",
    },
    {
      type: "list",
      items: [
        "service / app：进程名（契约里 shop 是一个进程，`service.name = shop`；order/payment/stock 是它内部的组件，后续课时把它拆开时再给组件分别的 service 值）——最基本的切分维度。",
        "level：日志级别——想查「所有 error」就要能按级别选流，最常见的查询入口。",
        "环境：`deployment.environment.name`（dev/staging/prod）——多环境共用同一套 Loki 时的第一道闸。",
        "固定、少量、可枚举：凡是「取值只有几个、且你真会按它查」的属性（region、实例角色等）才值得做标签。",
        "高基数红线：`trace_id`、`request_id`、随机 ID、用户 ID、IP、完整 URL 路径都不做标签；它们留在行内结构化字段（logfmt 键 / JSON 字段）里，用 LogQL 解析后过滤——对照来看：`service_name=\"shop\"`、`level=\"error\"` 这种少数几个值、反复当入口的字段是标签料；`order_id=\"20260907-001\"` 这种逐请求变化的字段是行内料。",
      ],
    },
    {
      type: "heading",
      text: "LogQL 最小集：选流、滤行、计数",
    },
    {
      type: "list",
      items: [
        "流选择器：`{service_name=\"shop\", level=\"error\"}`——花括号内是与 Prometheus 相同的标签匹配语法（`=`、`!=`、`=~` 正则），先决定在哪些流里找。",
        "行过滤器：`|= \"...\"` 子串匹配（等价 grep）、`|~` 正则匹配，可加 `!=` / `!~` 取反；作用于已选中的流内部，逐行扫内容，不新增索引。",
        "解析器：`| logfmt` 或 `| json` 把日志行解析成可引用字段，再叠加字段过滤 `| order_id=\"20260907-001\"`、`| duration > 1s`——先标签缩流、再解析提字段、再精确过滤，三层递进。",
        "量率：`count_over_time({service_name=\"shop\", level=\"error\"}[5m])` 统计过去 5 分钟错误行数，是把日志变成「指标」的最小入口，也是日志→指标联动的雏形。",
      ],
    },
    {
      type: "code",
      title: "Shop 排障中的真实 LogQL 示例",
      language: "logql",
      code: `# 1. 选流：shop 进程的 error 日志（level 由采集侧做成标签，直接命中）
{service_name="shop", level="error"}

# 2. 追某一单：标签先缩小范围，行内子串过滤到具体请求（order_id 是高基数，留在行内）
{service_name="shop", level="error"} |= "20260907-001"

# 3. 关注 SQLite 写锁冲突：正则行过滤器（注意行过滤要放在解析器之前）
{service_name="shop", level="error"} |~ "database is locked|SQLITE_BUSY"

# 4. 结构化字段过滤：slog JSON 行先 | json 解析成字段，再按字段精确过滤
{service_name="shop"} | json | msg="settle order failed" | amount > 10000

# 5. 错误日志量：把日志当指标看
count_over_time({service_name="shop", level="error"}[5m])`,
    },
    {
      type: "paragraph",
      text: "把写与读两侧连起来看整条通路。部署上，Loki 单二进制即可 monolithic 起整套服务，也能拆成读写分离的微服务形态：distributor 接收校验日志、按标签哈希路由，ingester 攒流、封 chunk 并压缩，querier 按标签索引定位 chunk 后执行行过滤与聚合——本课只需要这个分工概念；教学与实验最简单可靠的形态是 docker 单实例（Loki 3.7，与第 14 课 obs-full-stack-deploy 规划的 compose 拓扑一致），跑起来即可验证上面全部查询。数据怎么写进去：上一课里 shop 把 JSON 日志写到 stdout，主线不是让每个进程各自直连 Loki，而是让日志先进 OTel Collector——Collector 的 filelog receiver 读应用日志、经 otlphttp exporter 推给 Loki 3.x 原生 OTLP 端点（HTTP /otlp），服务名、级别等元数据在采集侧落成 Loki 标签（对应示例里的 service_name、level）——Collector 因此在入口统一接收三个信号，日志只是它的 pipeline 之一，配置细节在第 13 课（obs-collector）给全（进程级直连 Loki——日志驱动或 SDK 指向 3100 端口——也能跑通，只是绕过了 Collector 这道可统一加字段、改标签的闸口，故非主线）。读的一侧入口是 Grafana：Explore 面板把数据源切到 Loki，输入 LogQL 查出一组行，点击任一行的展开箭头就能看到这条日志解析出的全部字段（level、msg、order_id、trace_id……）——上一课打进去的结构化字段在这里原样呈现；行上携带的 trace_id 让 Grafana 能把日志行与对应 trace 互跳，logs → metrics / logs → trace 的联动就此打通第 2 课（obs-three-pillars）说的信号互链。跳转的具体操作与「从指标点一路 drill-down 到日志」的编排，留到第 12 课（obs-exemplars-bridges）与第 16 课（obs-troubleshooting）实战。",
    },
    {
      type: "quiz",
      question: "shop 的日志字段里，下面哪个判断正确？",
      options: [
        "`service_name=\"shop\"`、`level=\"error\"` 留作行内字段，`trace_id` 做成标签——因为排障时总是按 trace_id 查",
        "`level=\"error\"` 做成标签、`order_id` 留行内——因为前者取值少且常作查询入口，后者逐请求变化",
        "为了任意字段都能秒查，把 order_id、trace_id、user_id 全部做成标签",
        "标签越少越好，连 app 也不做，每次查询直接全量扫",
      ],
      answer: 1,
      explanation: "Loki 只为标签建索引：只有取值少、且真会被当查询入口的字段（app、level、env）才适合做标签；order_id / trace_id 这类逐请求变化的高基数值做标签会让流数量爆炸，应留在行内用 json/logfmt 解析后过滤。全做标签摧毁索引、全都不做则每次都全量扫，是两个极端。",
    },
    {
      type: "keypoints",
      items: [
        "Loki 与 ES 类全文索引的本质区别：只索引标签、不索引内容，日志压缩成块原样存储",
        "stream = 同一标签集的行组成的流；chunk = 流的压缩存储单元；查询先选流、再扫内容",
        "标签基数上升 → 流数量与索引成本上升；指标课养成的标签纪律原样适用",
        "推荐标签：service/app、level、环境；trace_id / request_id / 用户 ID 等高基数值一律留行内字段",
        "LogQL 最小集 = 流选择器 `{...}` + 行过滤 `|=` / `|~` + `| logfmt`/`| json` 解析 + `count_over_time`",
        "主线通路：应用结构化 stdout → Collector(filelog) → otlphttp → Loki 原生 /otlp；Grafana Explore 展开日志行看字段、凭 trace_id 跳 trace",
      ],
    },
  ],
};
