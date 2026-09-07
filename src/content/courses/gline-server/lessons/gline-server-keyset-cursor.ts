/* ==================================================================
 * 课时：Keyset 分页与签名游标（gline-server-keyset-cursor）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-keyset-cursor",
  courseSlug: "gline-server",
  title: "Keyset 分页与签名游标",
  summary: "为什么深翻页不用 OFFSET？游标里藏了什么、签了什么名、防什么攻击？",
  minutes: 18,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "查询要翻页,但日志系统不能像博客那样用 LIMIT/OFFSET——数据在持续写入,OFFSET 深翻页既慢又会漂移。Gline 用 keyset(游标)分页:以「上一页最后一行」为下一页起点,并把游标做成不透明 + 签名的令牌。",
    },
    {
      type: "heading",
      text: "OFFSET 的两个本质问题",
    },
    {
      type: "list",
      items: [
        "深翻页慢:第 N 页要扫描并丢弃前 (N-1)×limit 行,O(offset) 随页号增长。",
        "并发写入漂移:翻页期间有新行插入,OFFSET 会把同一行重复返回或漏行——页面不稳定。",
      ],
    },
    {
      type: "heading",
      text: "Keyset:以上一页末尾为起点",
    },
    {
      type: "code",
      title: "SQL 形态(entries repo)",
      language: "sql",
      code: `-- 第一页:无游标,多取 1 行判断有无下一页
SELECT ... FROM log_entries
WHERE project_id = $1
  AND observed_at >= $from AND observed_at < $to
  [AND service IN (...)] ...
ORDER BY observed_at DESC, id DESC
LIMIT $limit + 1;

-- 第 N 页:带上页末行游标
  AND (observed_at, id) < ($cursor_observed_at, $cursor_id)
ORDER BY observed_at DESC, id DESC
LIMIT $limit + 1;`,
    },
    {
      type: "paragraph",
      text: "要点(与 guides/05 及源码一致):",
    },
    {
      type: "list",
      items: [
        "ORDER BY 双列 (observed_at DESC, id DESC):observed_at 可能重复(同毫秒多条),id(自增)是唯一决胜键,保证全序稳定。",
        "谓词用行值比较 (a,b) < (x,y),命中复合索引 log_entries_project_time_idx,每页 O(log n) 定位,不随页号变慢。",
        "多取 1 行:len(rows) > limit 说明还有下一页,返回 next_cursor;等于 limit 则没有(去尾)。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "实测证据",
      body: "docs/performance-baseline.md:180 万行数据集上,第 1 页 5-7ms,第 2-5 页各 5-6ms——翻页成本恒定,正是 keyset 的证明。如果深翻页变慢,先怀疑是不是有人用了 OFFSET。",
    },
    {
      type: "heading",
      text: "游标为什么不透明:内容与签名",
    },
    {
      type: "paragraph",
      text: "next_cursor 不是裸的 (observed_at, id)——那会让客户端伪造/篡改游标跳到任意位置,绕过时间窗或跨 project。真实编码(CursorCodec, query/service.go:426-473):",
    },
    {
      type: "code",
      title: "游标 = base64url(payload) . base64url(HMAC)",
      language: "text",
      code: `payload = {
  v: 1,
  project_id: "uuid",          // ← 绑定租户
  filter_hash: "hex...",       // ← 绑定过滤条件
  observed_at: "RFC3339Nano",  // ← 上一页末行位置
  id: 12345                    // ← 决胜键
}

cursor = base64url(json(payload))
       + "."
       + base64url(HMAC-SHA256(cursorSecret, payload))`,
    },
    {
      type: "table",
      caption: "游标绑定了什么,防什么",
      headers: ["绑定", "防什么"],
      rows: [
        ["project_id", "A 项目的游标不能用于 B 项目(Decode 时比对 expectedProject)"],
        ["filter_hash", "改过滤条件必须重新从第一页查——旧游标失效,而不是静默翻错结果"],
        ["HMAC 签名", "客户端不能伪造/篡改 observed_at/id 跳到任意位置"],
        ["位置 ∈ [from,to)", "Search 里额外校验游标落在本次时间窗内(service.go:157)"],
      ],
    },
    {
      type: "paragraph",
      text: "cursorSecret 派生自 pepper(bootstrap/application.go:HMAC(pepper, \"gline-query-cursor-v1\"))——Server 重启不失效,但换了 pepper 所有旧游标作废(可接受:游标本就是短命令牌)。Decode 时校验:长度 ≤2048、恰好一个点分隔、HMAC 常量时间比对、project 与 filter_hash 匹配。",
    },
    {
      type: "heading",
      text: "filter_hash:让游标与查询条件绑定",
    },
    {
      type: "paragraph",
      text: "buildQuery 时(query/service.go:340-360)把规范化后的 from/to/services/hosts/levels/message/trace_id 序列化后 sha256,得到 filterHash。它有两个用途:Decode 时比对(防跨条件用游标)与 Encode 时写入。规范化(filter 排序、level 大写)保证「相同查询条件」总产生相同 hash——用户用同样的过滤条件翻页,游标始终有效。",
    },
    {
      type: "quiz",
      question: "用户在第一页用了 service=api,拿到 next_cursor;第二页把 service 改成 db 但仍带上旧游标。会发生什么?",
      options: [
        "正常返回 db 的第二页",
        "游标验签失败,返回 400 invalid_cursor",
        "返回 api 的第二页(忽略新条件)",
        "返回 500 internal_error",
      ],
      answer: 1,
      explanation:
        "旧游标的 filter_hash 由 service=api 算出;第二页 buildQuery 用 service=db 算出新 hash。Decode 时 expectedFilterHash 不匹配 → ErrInvalidCursor → 400。这是刻意设计:防止「用 A 条件的游标翻 B 条件的结果」导致漏行/错乱,改条件必须重新从第一页查。",
    },
    {
      type: "exercise",
      title: "对比 OFFSET 与 keyset 的 SQL",
      description:
        "写出一条第 5 页查询的 OFFSET SQL 与 keyset SQL,分析:数据在翻页期间新增 100 行,两种方式各会发生什么(重复/漏行)?",
      hint: "OFFSET 是位置偏移,新增行会把后续页整体往后推;keyset 以上一页末行为锚,不受新行影响。",
    },
    {
      type: "keypoints",
      items: [
        "keyset 分页:ORDER BY (observed_at DESC, id DESC) + 行值比较,每页 O(log n)。",
        "多取 1 行判断有无下一页,翻页成本恒定。",
        "游标 = 签名 JSON:绑 project_id、filter_hash、位置;防伪造/跨租户/跨条件。",
        "filter_hash 让「改条件必须重查第一页」成为硬约束。",
      ],
    },
  ],
};
