/* ==================================================================
 * 课时：追踪的解剖：Trace、Span 与 Context（obs-trace-model）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 知识边界：只讲 Trace/Span/SpanContext/parent-child、时间与嵌套、
 * 状态/事件/属性；传播只点到 W3C traceparent，细节归
 * obs-sampling-propagation。术语遵循课程契约。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-trace-model",
  courseSlug: "observability",
  title: "追踪的解剖：Trace、Span 与 Context",
  summary: "用一次下单请求把 Trace、Span、SpanContext 与 Parent-Child 因果模型讲透。",
  minutes: 26,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "想象排障现场：客户报「订单一直创建失败」，你在 order 组件日志里看到 `调用支付超时`，又在 payment 组件日志里看到一条时间只差几十毫秒的数据库错误。两条日志都像根因，时间戳也几乎一致——可它们真的有关吗？未必。日志按进程隔离（这一点在「三支柱」一课（obs-three-pillars）里说过），每个进程都只有自己窗口里的事实；把各进程的日志按时间戳拼起来并不能拼出一次请求的完整故事：跨机器时钟有偏差、异步调用中间隔着队列与调度、并发请求的时间线互相交错。排障需要的是另一把尺子：**请求粒度的因果视图**——一次 `POST /orders` 从入口到每个下游，经历了哪些工作单元、彼此是什么关系。这把尺子就是 Trace。上一课（obs-otel-model）给了三种信号共用的骨架（Resource/Attribute/Scope），本课把「追踪」这个信号单独放大：它的四个核心概念（Trace、Span、SpanContext、Parent-Child）、时间与因果的关系、状态与错误记录，最后用 shop 的一次真实下单把一棵 span 树从头到尾解剖一遍。",
    },
    {
      type: "heading",
      text: "Trace 与 Span：一次请求的因果树",
    },
    {
      type: "definition",
      term: "Trace（追踪）",
      definition: "一次逻辑操作（如一次 POST /orders 下单）从入口到所有下游涉及的 span 的集合，因共享同一个 TraceID 而能聚合成一棵树。树的根通常是入口组件的 server span，叶子是没有任何下游的局部工作（一次数据库写、一次文件操作）。Trace 就是「请求粒度因果视图」的落地：它把散落在多个进程、多条日志里的工作单元粘成一张可整体回放的关系图。",
    },
    {
      type: "definition",
      term: "Span（跨度）",
      definition: "因果树上的一个节点：一段有名字、有明确开始/结束时刻的工作单元——一次 HTTP 请求处理、一次库存扣减、一次 SQLite 写都可以是 span。一条 span 记录包含：名字、kind（在调用链里的角色：server / client / internal 等）、开始与结束时间戳、状态（Unset / Ok / Error）、一批 attribute（key-value，key 遵循 SemConv）、若干带时间戳的 event，以及自己的身份（TraceID + SpanID）和 parent 的 SpanID。规则：一个 span 只属于一个 trace，除根外只有一个直接 parent；span 内部可以再开子 span，形成嵌套。",
    },
    {
      type: "heading",
      text: "SpanContext：树如何挂接、如何跨进程生长",
    },
    {
      type: "definition",
      term: "TraceID 与 SpanID",
      definition: "两个标识符：TraceID（128 位，16 字节）全局唯一地标识一次请求的整个 trace；SpanID（64 位，8 字节）标识树中某一个具体的 span。它们由 SDK 在创建 span 时生成：child 复用父的 TraceID、换一个自己的新 SpanID，并记住父的 SpanID。本课程的示例 TraceID 形如 `463ac35c9f6413ad48485a3953bb6124`（32 个十六进制字符）。",
    },
    {
      type: "definition",
      term: "SpanContext（跨度上下文）",
      definition: "标识一个 span「在树中位置」的最小不可变身份：TraceID + SpanID + flags（trace 标志，含一个「是否被采样记录」的位），必要时还带 trace state。它在 span 创建时生成，并随这个 span 向外传播：同一进程内传给子孙，跨进程时序列化进请求头交给对端（详见下文）。后端也靠它判断两条遥测记录是否属于同一次请求。",
    },
    {
      type: "definition",
      term: "Parent-Child（父子关系）",
      definition: "span 之间的因果边。child 在「创建的那一瞬间」从当前 context 里取出父的 SpanContext，继承 TraceID 并把父的 SpanID 写进自己的 parent_span_id 字段——也就是说，因果关系在创建时就被数据固化下来，不需要也不依赖任何时间比较。父与子可以隔着一台机器、隔着几十毫秒甚至更久的队列延迟，树的结构依然成立。",
    },
    {
      type: "paragraph",
      text: "把上面四个概念串起来，就能回答一个经常困扰新手的问题：**判断两个 span（或两条日志）是否属于同一请求、谁是谁的原因，凭什么是可靠的？**凭的不是时间。时间轴只是后端把各 span 按开始时间排开画出来的「瀑布图」，是派生视图，用来观察延迟分布；而树的结构（谁是根、谁挂在谁下面）是 span 创建时写入的数据，与时钟无关。两个理由让时间戳不能承担因果判断：其一，跨机器时各进程时钟未必一致，几十毫秒的先后完全可能是时钟偏差造成的假象；其二，异步场景里「时间接近」的两条记录可能毫无关系（同一时刻不同请求的日志在并发交错），而真正有因果的父子 span 反而可能相隔很久（父已结束很久，子才开始执行）。所以排障时的可靠动作是核对 SpanContext：共享同一 TraceID 且存在 parent-child 链，才有资格谈因果（这正是后面结构化日志一课（obs-structured-logging）里「按 trace_id 过滤日志」能成立的根据）。跨进程时父的 SpanContext 如何到达对端？标准做法是放进请求头，最常见的载体是 W3C 的 traceparent，它携带 TraceID、SpanID 与采样标志——只点到为止，完整格式与 tracestate、baggage 都在采样与传播一课（obs-sampling-propagation）里展开。",
    },
    {
      type: "heading",
      text: "完整例子：POST /orders 的一次旅程",
    },
    {
      type: "code",
      title: "一次下单的 span 树（结构示意，时间线自左向右）",
      language: "text",
      code: `Trace 463ac35c9f6413ad48485a3953bb6124
│   ← 一次 POST /orders 请求：order → payment → stock 三个组件协作
│
POST /orders            server · order 组件    182ms   ← 根 Span：HTTP 入口
├─ 落库订单草稿          internal · order        7ms    写 SQLite
├─ POST /payments       client · order 组件    124ms   ← HTTP 调 payment 组件
│  └─ POST /payments    server · payment 组件  110ms
│     └─ stock.deduct   client · payment 组件   42ms   ← HTTP 调 stock 组件
│        └─ stock.deduct server · stock 组件    38ms    写 SQLite 扣减库存
└─ 回写订单状态          internal · order        9ms    写 SQLite

每一行的缩进代表一层父子关系；每列依次为 span 名字、
kind（server/client/internal）、所属组件、耗时。`,
    },
    {
      type: "paragraph",
      text: "读这棵树要抓住三件事。第一，**嵌套的时长是包含关系**：`POST /payments` 的 client span 是 124ms，它包裹的 payment server span 是 110ms，两者之差主要是网络与对端队列等待——client span 度量的是「我发起调用到拿到结果」的全部，server span 才度量对端真实处理时间；这正是定位延迟时先看 client/server 差距、再看 server 内部的原因。第二，**属性挂在具体 span 上**：HTTP server span（根与 payment 的 `POST /payments`）携带稳定版 HTTP 语义约定的键，如 `http.request.method=POST`、`url.path=/orders`；内部工作 span 则带业务自定义属性（如扣减数量），自定义键要避开 SemConv 已占用的名字空间，高基数风险见 Prometheus 埋点一课（obs-prometheus-instrumentation）。第三，**成功路径上的状态**：本例所有 span 都保持默认的 Unset——没有显式赋值的 Unset 语义是「这个工作单元没有出错」，绝大多数正常 span 不需要也不应该显式标 Ok。状态只有三值，其边界值得单独说清：Unset = 未判定（默认，等同于「无错误」）；Ok = 明确成功，仅在你想刻意表达「这段完成了使命」时设置；Error = 这个工作单元失败了。什么时候置 Error？异常、超时、依赖返回错误导致该 span 的目的没有达成——注意粒度：支付超时时，payment 的 server span 应置 Error，order 侧发起的 client span 也置 Error（因为它拿到的结果就是失败）；而一次 4xx 客户端请求通常不算服务端 span 的错误（具体映射随语义约定演进，以官方文档为准）。**Error 是结论，细节要另记**：状态位只承载「成败」这一个布尔结论，具体证据——错误消息、异常类型、调用栈——应该记成 span event：一条带时间戳、可以挂属性的事件，显示在瀑布图的对应位置。Go SDK 里对应的是 `span.SetStatus(codes.Error, …)` 与 `span.RecordError(err)`（后者自动记一条携带异常类型与栈的 exception 事件；精确签名以官方文档为准）。把「结论」与「证据」分开，正是排障时能先扫状态再查事件的基础。",
    },
    {
      type: "quiz",
      question: "你在浏览 shop 的追踪数据时看到：payment 组件的一个 span，与 order 组件另一个 span 在时间轴上几乎完全重叠。据此能断定它们属于同一次请求并存在因果（父子）关系吗？",
      options: [
        "能，时间高度重叠是因果关系的直接证据",
        "不能，时间重叠只能说明两者并发发生；必须核对两个 span 的 SpanContext——共享同一 TraceID 且存在 parent-child 链才算因果",
        "不能，除非两个 span 恰好跑在同一台机器上",
        "能，只要两个 span 的名字相同就说明它们是同一请求的两个阶段",
      ],
      answer: 1,
      explanation: "时间轴只是后端按时间戳绘制的派生视图：并发请求的 span 会互相交错，跨机器还有时钟偏差，所以时间接近或重叠既不能证明相关、也不能证明因果。可靠判据是数据本身：两个 span 是否共享同一 TraceID、parent_span_id 是否构成链条——这两者在 span 创建那一刻就被写入，与时钟无关。",
    },
    {
      type: "keypoints",
      items: [
        "Trace = 一次请求的因果树：共享同一 TraceID 的 span 集合；根是入口的 server span",
        "Span = 一段有名字、起止时间、状态、属性与事件的工作单元；一个 span 只属于一个 trace、只有一个直接 parent",
        "SpanContext = TraceID + SpanID + flags；child 在创建瞬间继承父的 TraceID 并记下父 SpanID——因果在创建时固化，不依赖时钟",
        "时间轴/瀑布图是派生视图：判断两个 span 是否同属一次请求、谁是谁的原因，只能核对 SpanContext 与 parent-child 链",
        "Span 状态三值 Unset/Ok/Error：Error 是「成败结论」，错误细节（消息/异常/栈）记成带时间戳的 span event",
        "跨进程传播把父 SpanContext 放进 W3C traceparent 请求头（格式与采样细节在 obs-sampling-propagation 一课）",
      ],
    },
  ],
};
