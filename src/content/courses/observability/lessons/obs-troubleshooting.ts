/* ==================================================================
 * 课时：综合实战：用观测定位线上故障（obs-troubleshooting）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-troubleshooting",
  courseSlug: "observability",
  title: "综合实战：用观测定位线上故障",
  summary: "从 Grafana 面板读形状，用 PromQL 收窄、Tempo 追链路、Loki 取证，把一次支付链路故障从告警走到根因与复盘。",
  minutes: 45,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "这是压轴课：前面所有工具——指标、PromQL、告警、追踪、日志——在这一课串成一条排障工作流。场景沿用共享主线：shop 服务（order → payment → stock 三个组件，SQLite 存储）的支付回调链路出了问题。本课先带你完整走一遍标准五步（读面板 → 拆指标 → 追 trace → 查日志 → 修与验证），每一步给出真实操作、你会看到什么、以及这一步的坑；最后留一个练习让你在 demo 环境（第 14 课 obs-full-stack-deploy 起的观测栈）里独立复现并走完全程。先记住工作流的一句话：先用最便宜的信号问清「影响面」，再用追踪问清「单个请求内部发生了什么」，最后用日志问清「具体错误与因果」。某天下午你收到一条 Grafana 告警：「POST /payments 错误率超过阈值」，随后订单创建失败率的业务面板也开始爬升。用户的描述是「下单越来越慢，偶尔直接失败」。此刻你手上有一整套第 14 课搭好的观测栈：Prometheus 3.14 存指标、Tempo 3.0 存 trace、Loki 3.7 存日志，Grafana 13.2 统一查看，shop 的 OTel 埋点把三种信号关联在一起。先别动手查任何东西，按顺序走：错误率与延迟的曲线是什么形状，决定了你的第一判断。",
    },
    {
      type: "heading",
      text: "第 1 步：读面板形状——爬坡还是尖峰",
    },
    {
      type: "paragraph",
      text: "打开 Grafana 的 shop 总览仪表盘，把时间范围放到最近 30 分钟，先看错误率（`rate(shop_http_requests_total{status=~\"5..\"}[5m])`，按 route 分）和延迟（`shop_http_request_duration_seconds` 的 p95，第 7 课 obs-promql 的写法）两张面板。你会看到：错误率不是瞬间跳高，而是在 10～20 分钟内从不到 0.1% 一路「爬坡」到约 5%，p95 延迟同步从约 250ms 爬到 1s 以上，中间穿插几根更陡的尖峰——对应偶发超时；`/healthz` 与 `/orders/{id}` 曲线干净。这一段的坑：形状本身就是线索——**爬坡**通常是资源累积型问题（锁竞争、连接池耗尽、队列堆积：坏得越来越频繁），**尖峰**通常是瞬态冲击（上游抖动、发布、突发流量：来得快去得快）。另外默认的宽时间窗口（6h/24h）会用长平均把爬坡抹成一条缓线，一定要先放大到能看清形状的窗口再看。看到「只有 /payments 与 /orders 相关的链路上爬坡、健康检查干净」，第一判断是：不是整个服务挂了，是某条内部调用路径在劣化。",
    },
    {
      type: "heading",
      text: "第 2 步：PromQL 收窄——哪个 route、哪种失败、是不是饱和",
    },
    {
      type: "code",
      title: "在 Grafana Explore 里逐步收窄（PromQL）",
      language: "promql",
      code: "# 1) 按 route 拆错误率：锁定出问题的链路（对比各 route 的占比曲线）\nsum by (route) (rate(shop_http_requests_total{status=~\"5..\"}[5m]))\n  / sum by (route) (rate(shop_http_requests_total[5m]))\n\n# 2) 按 route 拆 p95：确认延迟劣化也只在同一条链路上\nhistogram_quantile(0.95,\n  sum by (route, le) (rate(shop_http_request_duration_seconds_bucket[5m])))\n\n# 3) 饱和度：stock 组件的 SQLite 写锁等待（counter；\n#    若 demo 埋点名不同，以示例工程实际导出的指标为准）\nrate(shop_stock_write_lock_wait_seconds_total[5m])   # > 0 说明此刻有人在排队等锁\n",
    },
    {
      type: "paragraph",
      text: "查询结果会告诉你三件事：错误率和 p95 都集中在 `/payments`（及调用它的 `/orders`）上，其它 route 归零，说明问题不在网关或全局依赖，而在支付链路内部；第三条查询里，stock 的写锁等待指标在错误率爬坡的同一时段开始持续 > 0——饱和度信号（USE 里的 S，第 6 课讲过）出现了。这一步的坑有两个：一是时间窗口，收窄到分钟级才看得到锁等待与错误之间的先后关系，窗口太宽两者会被平均到同一根曲线上，因果顺序就丢了；二是「低频错误可能被采样吃掉」——指标是全量的，而 trace 不一定全，后面跳 trace 找不到样本时，记得回到指标点用 exemplar 跳（第 12 课 obs-exemplars-bridges），不要因此怀疑「指标是不是错了」。至此你已经把范围从「整个 shop」收到「支付链路 + stock 写锁」这个假设。",
    },
    {
      type: "heading",
      text: "第 3 步：跳 Trace——瀑布里谁在拖时间",
    },
    {
      type: "paragraph",
      text: "到 Grafana Explore 切 Tempo 数据源做 Search：`service.name = \"shop\"`，duration 过滤选较慢区间，按耗时降序挑一条慢 trace（TraceID 形如 `463ac35c9f6413ad48485a3953bb6124`，第 4 课 obs-trace-model 讲过结构）。打开 span 瀑布你会看到：最外层是支付回调的处理 span，中间是 payment 调用 stock 的客户端 span，再往里 stock 的处理 span 几乎占满整条时间线——而 stock 内部那一段 SQLite 写操作（Go 里 database/sql 的 db 埋点在 contrib 中按实验支持，span 名称以 demo 埋点为准）占了这个 span 的绝大部分耗时；在错误 trace 里，同一个位置附近能看到状态为 Error 的 span，其事件里带着异常信息。读瀑布的要点是找「占比最大的等待」而不是看最外层——整条 trace 慢，往往只有一段在真正等。这一步的坑：head-based 采样可能把低频错误 trace 丢掉（第 11 课 obs-sampling-propagation），找不到 Error 样本时用两个替代入口——指标面板上的 exemplar 直接跳 trace，或从下一步的日志按 trace_id 反查；另外别拿第一条命中的 trace 当代表，Tempo Search 里按 duration 排序后再挑。",
    },
    {
      type: "heading",
      text: "第 4 步：Loki 取证——错误消息与因果时间线",
    },
    {
      type: "paragraph",
      text: "现在用日志给假设取证。从慢 trace 上复制 trace_id，到 Grafana Explore 切 Loki，按结构化日志里的 trace 关联字段过滤（第 9 课 obs-structured-logging 讲了注入，第 10 课 obs-loki-logging 讲了 LogQL 基本写法）：`{service_name=\"shop\"} |= \"463ac35c9f6413ad48485a3953bb6124\"`（Loki 3.x 原生 OTLP 接收默认把 resource 的 service.name 映射为 service_name 标签，以部署课的 yaml 为准）。同一 trace_id 下你能把整条链路的时间线拉直：stock 的日志里周期性出现 `SQLITE_BUSY: database is locked`——写事务等待超过 busy_timeout 后放弃；随后几十到几百毫秒，payment 的日志出现「调用上游 mock 超时」的错误，再往后是订单失败记录。顺序本身就在讲因果：stock 锁竞争把写拖慢 → payment 调用 stock 变慢 → 而 payment 客户端给上游 mock 的超时设得太短，把「慢」直接放大成了「超时错误」→ 失败请求触发客户端重试，重试又带来更多写、加剧锁竞争——正反馈。这一步的坑：不要只过滤 error 级别或只看错误行本身，锁等待是「慢」不是「错」，先看写等待指标与 busy 日志的起点才能确认谁先谁后；同时确认各组件日志在同一时钟下（demo 同机无碍，生产要小心日志时间戳的来源）。",
    },
    {
      type: "heading",
      text: "第 5 步：根因、修复与验证",
    },
    {
      type: "paragraph",
      text: "证据链闭合，根因是两条叠加：**stock 组件的 SQLite 写锁竞争**——并发写事务排队，而 `busy_timeout` 设得太短，等待超限的写直接报 `SQLITE_BUSY` 失败；**payment 客户端给上游 mock 的超时设得过短**——stock 一慢，payment 立刻把慢判成超时错误，错误率被放大，重试又加重锁竞争。修复分两侧：stock 侧把 busy_timeout 提高到能容忍排队的水位（连接建立后执行 `PRAGMA busy_timeout = 5000;`，具体设置方式以所用 SQLite 驱动的文档为准），让写事务等待而不是秒失败；若并发继续上涨，再考虑把写操作串行化（单写者队列）或补索引缩短写事务持锁时间。payment 侧把上游超时调到明显高于 mock 的 p99（比如 3s 而不是 1s），并给失败加重试退避，避免一次抖动直接变错误。验证不是「改完就完」：回到第 1 步那两张面板，观察错误率回落到基线以下、p95 回到约 250ms、写锁等待速率归零——demo 里改回参数即可看到曲线回落。复盘时问两个问题：**哪些指标本可更早预警**——stock 的写锁饱和度（等待时长、等待者数）如果做成 USE 组件告警而不是只盯用户错误率，会在错误率爬坡之前约十分钟先响，这正是第 15 课（obs-slo）说的「内部组件用饱和度盯、用户链路用 SLO 盯」的分工；**哪些文档该有**——这条告警的 annotations 里应该挂 runbook（第 8 课 obs-alerting 讲过），runbook 至少写一句「支付链路变慢：先查 stock 写等待」，把这次半小时的定位压缩成下次的十分钟。",
    },
    {
      type: "exercise",
      title: "练习：完整走一遍排障工作流",
      description: "用第 14 课（obs-full-stack-deploy）的观测栈与 shop demo，复现本课故障并独立走完五步：先按场景制造负载（提高对 /payments 与 /orders 的并发请求，并调小 payment 调用上游 mock 的超时与 SQLite busy_timeout，制造出「错误率爬坡 + 偶发超时」的曲线形状），然后依次完成：① 从仪表盘读出错误率与延迟的形状并写下你的第一判断；② 用 PromQL 按 route 拆出问题链路并检查饱和度指标；③ 用 Tempo 找到一条慢 trace，标出占时最长的 span 与 Error span；④ 用 trace_id 到 Loki 拉出完整日志时间线，找出最早出现的错误消息；⑤ 给出修复方案、实施，并用面板曲线回落作为验证。全程把每一步「你看到了什么、依据是什么」记录下来。",
      hint: "定位线索：错误率只在 /payments 与 /orders 爬坡；trace 里 payment 调用 stock 的 span 占时最长，偶发 Error span 的事件里带 database is locked；Loki 中同一 trace_id 下 stock 的 SQLITE_BUSY 日志早于 payment 的超时日志；修复后写锁等待速率应归零。若 trace 找不到样本，回指标面板用 exemplar 跳转。",
    },
    {
      type: "quiz",
      question: "为什么标准排障顺序是「先指标、再 trace、最后日志」，而不是反过来先翻日志？",
      options: [
        "指标包含的错误信息最详细，能直接给出根因，trace 和日志只是补充",
        "日志最全所以最可信，应该最先看；指标与 trace 都经过采样可能丢数据",
        "指标是全量且廉价的，先回答「是否发生、影响多大、在哪条链路上」把范围收窄；trace 再定位单个请求内部哪段调用慢或错；日志最后对具体错误取证——倒过来会先陷入单点样本，无法区分影响面与代表性",
        "先看日志是因为日志保留时间最长，其它信号很快会被覆盖",
      ],
      answer: 2,
      explanation: "三种信号的粒度与成本不同（第 2 课 obs-three-pillars）：指标是压缩后的全量视图，最便宜、保留最久，适合第一步缩小范围；trace 覆盖单个请求内的调用链，但受采样影响（第 11 课）；日志最接近原始事实、用于取证，但先翻日志就像在书里逐行找一句没记住的话。排障的正确姿势是带着「在哪条链路上」的问题去找样本，而不是从样本里找问题。",
    },
  ],
};
