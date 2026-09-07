/* ==================================================================
 * 课时：序列化与 IO 开销：容易被忽略的固定成本（sc-serialization-io）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 章节 2「请求路径与 IO：第一公里的性能」第 5 课。
 * 注：Protobuf/gRPC 的 API 用法属于 grpc-go 课程，本课只讲取舍位置。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "序列化是每个响应都要付的固定成本：JSON 吃 CPU、膨胀体积、放大带宽与内存；讲清 Protobuf/gRPC、大列表分页、N+1 查询与压缩各自的取舍。",
  blocks: [
    {
      type: "paragraph",
      text: "前面几课把请求送到了存储、把并发模型与池化调好了——响应写回之前，还有一笔每请求都躲不掉的**固定成本**：序列化与数据结构搬运。它不显眼，却在三个地方同时花钱：**CPU**（把结构体编码成字节）、**带宽与内存**（编码结果的体积）、以及**往返次数**（数据没取对，就得再问一次数据库）。Go 里最典型的是 JSON 编码/解码：对每个字段做反射、分配临时对象，大对象上开销可观。这一课把这类「搬运费」摊开算一遍。",
    },
    {
      type: "heading",
      text: "JSON 的三笔账单",
    },
    {
      type: "list",
      items: [
        "CPU：反射遍历字段、类型转换、转义，编码解码都要做；一次 JSON 编解码的耗时往往以微秒到几十微秒计（视对象大小），远超同机一次内存拷贝。",
        "体积：JSON 有键名重复、数字用文本表示，比二进制格式大数倍——同样内容，体积累积到带宽与网络传输时间上（第 1 课：传输时间 = 数据量 ÷ 带宽）。",
        "内存与 GC：编码过程的临时分配推高 GC 压力；超大响应体同时拉高服务端与客户端内存（Go 的垃圾回收以分配为代价，见 Go 官方文档的 pprof 指南）。",
        "量级与测量：单条小响应编解码在微秒级，但当服务 QPS 到单机 2 万以上、又遇上几百 KB 的大响应时，序列化占比会冲到不可忽视的量级，与数据库查询、网络等待并列成为 Top 开销。优化前先测量——pprof 的 CPU profile 会直接告诉你序列化占几个百分点（工具用法见 observability 课程）。",
      ],
    },
    {
      type: "heading",
      text: "替代：Protobuf / gRPC",
    },
    {
      type: "paragraph",
      text: "**Protobuf（Protocol Buffers）** 是 Google 的二进制序列化格式：字段编号紧凑编码、预生成代码免反射，比 JSON 更小、更快；配套的 gRPC 是跨服务 RPC 框架（HTTP/2 + Protobuf）。对 sale 服务而言：对外（App/浏览器）用 JSON/REST；sale 与下游微服务（若拆分，见第 6 章）之间改用 gRPC/Protobuf，可省下可观的序列化 CPU 与带宽。迁移成本是引入 .proto schema 与代码生成——具体 API 与工具链见 grpc-go 课程（从『Protobuf 契约与兼容性』到『Keepalive、流控与消息边界』），本课只给取舍结论：**同进程内没有序列化；同机不同进程可接受 JSON；跨网络高频调用换 Protobuf**。另外 gRPC 内置 HTTP/2 多路复用，顺带缓解了第 1 课讲的连接复用问题；对外 API 之所以仍是 JSON 的天下，是因为它的体积优势远小于接入成本。",
    },
    {
      type: "heading",
      text: "大响应体：全量列表是最常见的浪费",
    },
    {
      type: "code",
      title: "闪购商品列表：一次把 1000 条 JSON 全量返回",
      language: "text",
      code: `// 伪代码：GET /products?page=1 的错误示范与开销估算
// 返回全部 1000 条商品（每条含 name/price/stock/图片 URL 等字段，约 800 字节）
// 响应体 ≈ 800 B × 1000 ≈ 800 KB

// 开销分解（教学示例：假设该列表恰是大促会场热点页，量级对齐课程基线的
// 「单品热点读 10 万+ QPS」）：
//  ① 序列化：1000 条 × 逐字段编码 → CPU 显著（pprof 可见 json 热点）
//  ② 传输：800 KB × 10 万 QPS = 80 GB/s —— 远超带宽预算，网关先顶不住
//  ③ 客户端：App 解析 800 KB 只为展示首屏 20 条 → 白付的带宽与电量
//  ④ 数据库：SELECT * 不带分页，回表全取 → 慢查询（EXPLAIN 见 mysql 课程）

// 修正：
//  ① 服务端分页（LIMIT/OFFSET），只返回本页
//  ② 列表只输出列表所需字段（瘦身 DTO），详情走 /products/{id}
//  ③ 商品读路径配缓存（第 3 章）：热点读 10 万+ QPS 由 Redis 承接`,
    },
    {
      type: "paragraph",
      text: "列表接口的正确姿势是**服务端分页**：LIMIT/OFFSET 在深分页（第 10000 页）时会退化——OFFSET 越大数据库扫描越多，此时换**游标分页**（cursor/keyset：按上次最后一条的 id 往后取，如 WHERE id > 上次id ORDER BY id LIMIT 20）。`gline-server` 课程的 keyset 走读实现了同样的机制。分页不只是用户体验问题：它同时约束了序列化体积、带宽、数据库扫描三条线。",
    },
    {
      type: "heading",
      text: "数据库 N+1 与批量：少问几次比快序列化更重要",
    },
    {
      type: "code",
      title: "N+1 与批量查询对比（伪代码）",
      language: "text",
      code: `// N+1：先查 1000 个订单，再对每个订单查一次商品 —— 1 + N 次查询
for order in db.query("SELECT * FROM orders WHERE user_id=?"):
    product = db.query("SELECT * FROM products WHERE id=?", order.product_id)

// 每次查询都是一次网络往返（1-5ms）+ 连接占用 + SQL 解析
// 1000 次 → 光往返就 1-5 秒，连接池也被串行占满

// 批量：一次 IN 查询 + 一次本地映射
rows = db.query("SELECT * FROM products WHERE id IN (?,?,...)", ids...) // 1 次
byId = { row.id: row for row in rows }   // 应用侧映射

// 把 1001 次往返压成 2 次（orders + products），序列化总量不变，等待量下降两个数量级`,
    },
    {
      type: "paragraph",
      text: "批量查询的收益往往大于换序列化格式：数据库往返一次 1–5 ms（第 1 课基线），而一次往返能取回一千条；把 N+1 压成 2 次，省下的是 999 次往返——比任何序列化优化都大。ORM 的预加载（如 gorm 课程的 Preload）本质就是帮你做批量 IN 查询。",
    },
    {
      type: "heading",
      text: "压缩：带宽与 CPU 的交易",
    },
    {
      type: "paragraph",
      text: "HTTP 层 gzip/br 压缩能把文本型 JSON 响应缩小一个数量级（文本冗余高），代价是服务端压缩 CPU 与客户端解压 CPU。判断标准：**响应够大（通常几十 KB 以上）且走的是慢链路（公网），压缩划算；同机房内网与极小响应，压缩反而不值**（白付 CPU，省下的传输时间毫秒都不到）。现代网关（Nginx）通常统一配置并缓存压缩结果，避免每个请求重复压缩。",
    },
    {
      type: "callout",
      variant: "note",
      title: "取舍优先级：先治「取太多」，再治「编太慢」",
      body: "序列化与 IO 开销的优化顺序有讲究：① 先减少数据量本身（分页、瘦字段、批量、缓存）——不取、少取永远快过快编码；② 再换更快的编码（Protobuf）或压缩传输（gzip/br）；③ 最后才动协议（REST → gRPC）。把「每次响应只含用户真正要的 20 条 × 瘦字段」做好，比把 1000 条全量 JSON 换成 Protobuf 的收益高一个数量级。",
    },
    {
      type: "quiz",
      question:
        "闪购商品列表接口在压测中 CPU 高企。pprof 显示 json 编码占大头，同时数据库慢查询日志显示该接口的 SQL 全表扫描。优先级最高的优化是？",
      options: [
        "立刻把 JSON 换成 Protobuf，降低编码 CPU",
        "先做服务端分页 + 瘦字段 + 批量/缓存，从源头减少「要编的数据」，再考虑编码格式",
        "给所有响应开启 gzip 压缩，减少带宽",
        "把列表接口改为游标分页，同时保留全量字段",
      ],
      answer: 1,
      explanation:
        "CPU 高与慢查询同源：取太多、编太多。先分页瘦身把数据量降下来，序列化 CPU、带宽、数据库扫描三线同时受益；Protobuf/压缩只优化编码环节，全表扫描的慢查询依旧在。",
    },
    {
      type: "keypoints",
      items: [
        "JSON 在 CPU（反射编码）、体积（键名/文本数字→带宽内存）、GC（临时分配）三处花钱；高 QPS 下占比可观。",
        "Protobuf/gRPC 用于服务间通信（更小更快 + HTTP/2 复用），对外 API 仍以 JSON 为主；API 细节归 grpc-go 课程。",
        "大列表要服务端分页：浅分页 LIMIT/OFFSET，深分页换游标；列表瘦身、详情单独取。",
        "N+1 把延迟放大成往返次数：批量 IN + 应用侧映射，收益常大于换序列化格式。",
        "gzip/br 是带宽与 CPU 的交易：大响应 + 公网路径划算，内网小响应不划算。",
        "优化顺序：先少取（分页/瘦身/批量/缓存），再快编（Protobuf），后压传（压缩）。",
      ],
    },
  ],
};
