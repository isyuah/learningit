/* ==================================================================
 * 课时：查询治理：硬性限制与索引前提（gline-server-query-governance）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-query-governance",
  courseSlug: "gline-server",
  title: "查询治理：硬性限制与索引前提",
  summary: "日志只增不减,查询凭什么快?为什么时间范围必填、limit 有上限、并发超限宁可立刻 429?",
  minutes: 16,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "摄取是把数据写进来,查询是把数据读出去。日志数据对单个 project 是 append-only、只增不减——无界查询会拖垮任何后端。Gline 的策略不是「靠硬件硬扛」,而是把治理做进查询 API 本身:每个查询的成本有数学上界。",
    },
    {
      type: "heading",
      text: "七条硬性限制(DefaultConfig, query/service.go)",
    },
    {
      type: "table",
      caption: "查询的硬性规则",
      headers: ["规则", "值", "违反时"],
      rows: [
        ["from/to 必填", "RFC3339", "400 invalid_time_range"],
        ["时间跨度", "≤ 7 天(GLINE_QUERY_MAX_RANGE)", "400 invalid_time_range"],
        ["limit", "默认 100,最大 500(env ≤1000)", "400 invalid_request"],
        ["filter 数量", "每项 ≤ 32 值,值 ≤ 128 B", "400 invalid_request"],
        ["q(message 关键词)", "≤ 512 B,ILIKE 转义", "400 invalid_request"],
        ["执行期限", "10s(GLINE_QUERY_TIMEOUT)", "504 query_timeout"],
        ["项目并发", "信号量满", "429 query_capacity_limited + Retry-After"],
      ],
    },
    {
      type: "paragraph",
      text: "这些限制的意图:把「查询者能造成的伤害」限制在可预测范围。即使数据涨到千万行,单查询成本有上界(时间窗 + limit),这是「180 万行仍个位数毫秒」(docs/performance-baseline.md)的前提之一。",
    },
    {
      type: "heading",
      text: "时间范围为什么必填",
    },
    {
      type: "list",
      items: [
        "让 DB 一定能命中 (project_id, observed_at DESC, id DESC) 复合索引(见摄取章 storage 课)。",
        "让每次查询成本可预期——时间窗是成本的第一决定因子。",
        "把「用户意图」显式化:查哪个窗口,而不是「全表」。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "日志系统最常见的滥用",
      body: "忘了加时间条件的全表扫描,是日志查询系统被拖垮的头号原因。强制 from/to 从 API 层面消灭它——parseTime 拒绝空值,还拒绝越界年份(1970-9999),防止「时间炸弹」查询。",
    },
    {
      type: "heading",
      text: "Search 的执行骨架(query/service.go:117)",
    },
    {
      type: "code",
      title: "Search 的步骤",
      language: "text",
      code: "Search(ctx, principal, params):\n  1. principal.Require(ScopeQuery)\n  2. ctx = WithTimeout(ExecutionTimeout=10s)     # 硬期限\n  3. buildQuery:校验参数,规范化 filter,算 filterHash\n  4. projects.Get + project.CanQuery()            # 项目可用?\n  5. if params.Cursor != \"\":\n       cursors.Decode(cursor, projectID, filterHash)   # 验签\n       if 游标位置不在 [from,to) 内 -> ErrInvalidCursor\n  6. limiter.Acquire(projectID)                    # 信号量,满则 429\n  7. entries.List(query)                           # SQL\n  8. if page.Next != nil:\n       cursors.Encode(projectID, filterHash, *page.Next)   # 签名游标",
    },
    {
      type: "heading",
      text: "并发治理:信号量 + 超时双保险",
    },
    {
      type: "paragraph",
      text: "Search 的并发控制有两道:项目级信号量(limiter.Acquire)与 10s 执行期限。设计取舍(README/STATUS 明确记录):信号量满时**宁可立刻 429 失败,也不排队**。为什么?",
    },
    {
      type: "list",
      items: [
        "429 + Retry-After 语义清晰,客户端能正确退避;",
        "排队会把「现在满」变成「10s 后模棱两可的内部超时」;",
        "快失败让负载自然扩散到其他时间点,而不是堆积成雪崩。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "filter hash 是什么?为什么现在算?",
      body: "buildQuery 除了构造 SQL,还算出一个 filterHash(规范化过滤条件的 SHA-256)。它不是给 SQL 用的,是给游标签名用的——后面 keyset 课会看到:游标绑定 filter hash,改过滤条件则旧游标失效,防止「用 A 条件的游标翻 B 条件的结果」。",
    },
    {
      type: "quiz",
      question: "项目级信号量已满时,新的查询请求会被怎么处理?",
      options: [
        "排队等待,直到有空位",
        "立即返回 429 query_capacity_limited + Retry-After",
        "无限期挂起直到超时",
        "绕过信号量直接执行",
      ],
      answer: 1,
      explanation:
        "Search 调 limiter.Acquire,满则立即返回 ErrCapacityLimited → HTTP 429 + Retry-After。刻意不排队:排队把「现在满」变成「10s 后模糊超时」,而 429 语义清晰、客户端可退避、负载自然扩散。",
    },
    {
      type: "keypoints",
      items: [
        "查询治理 = 7 条硬性限制,让单查询成本有上界。",
        "时间范围必填:命中索引 + 成本可预期 + 消灭全表扫描。",
        "Search:Require → 10s 超时 → buildQuery → CanQuery → 游标验签 → 信号量 → SQL。",
        "信号量满宁可立刻 429,不排队。",
      ],
    },
  ],
};
