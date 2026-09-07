/* ==================================================================
 * 课时：EXPLAIN：读懂执行计划（mysql-explain）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-explain",
  courseSlug: "database-mysql",
  title: "EXPLAIN：读懂执行计划",
  summary: "用 EXPLAIN 看清一条 SQL 到底怎么扫数据，并完成一次前/后优化对照。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前面所有的索引理论，最终都要落到一个可验证的工具上：EXPLAIN。它不执行查询，而是让 MySQL 告诉你「它打算怎么执行」——扫哪张表、用什么访问方式、大概看多少行。学会读 EXPLAIN，你就能在面试和真实优化里，用证据而不是感觉判断一条 SQL 是否健康。这一课我们把 shop 库的几条查询逐个拆开，并做一次「该用索引却全表扫描」的前后对照优化。",
    },
    {
      type: "heading",
      text: "跑一条 EXPLAIN 看长什么样",
    },
    {
      type: "code",
      title: "EXPLAIN 一条查询",
      language: "sql",
      code: "-- EXPLAIN（或 MySQL 8.0 的 EXPLAIN ANALYZE 是真实执行+耗时，稍后提）\nEXPLAIN\nSELECT id, total_amount\nFROM orders\nWHERE user_id = 42\nORDER BY created_at DESC;\n\n-- 典型输出列（示例值）：\n-- id | select_type | table  | type | possible_keys | key      | key_len | ref  | rows  | Extra\n-- 1  | SIMPLE      | orders | ref  | idx_user      | idx_user | 8       | const| 3     | Using filesort",
    },
    {
      type: "paragraph",
      text: "我们逐个看核心列。首先要给出判断的「好坏标尺」——`type` 列描述的是访问方式，它有一个从好到坏的常见顺序，这是读 EXPLAIN 最重要的一张表。",
    },
    {
      type: "heading",
      text: "type：访问方式的优劣顺序",
    },
    {
      type: "table",
      caption: "EXPLAIN type 的好坏标尺（好 → 坏）",
      headers: ["type", "含义", "常见场景", "好坏"],
      rows: [
        ["system", "表只有一行（极度罕见）", "系统表/单行表", "最好"],
        ["const", "按主键/唯一索引等值，最多命中一行", "WHERE id = 42", "好"],
        ["eq_ref", "JOIN 时被驱动表按主键/唯一索引去连接，每驱动行匹配唯一一行", "JOIN ON user.id = orders.user_id 中按主键连", "好"],
        ["ref", "按某个普通索引等值访问，可能命中多行", "WHERE user_id = 42（二级索引等值）", "较好"],
        ["range", "按索引做范围或部分前缀扫描", "WHERE created_at > '2025-01-01'、LIKE 'x%'", "可接受"],
        ["index", "扫描整个索引（仍是遍历，但基于索引而非全表行）", "覆盖索引导求结果、或 GROUP BY 走索引", "一般"],
        ["ALL", "全表扫描，逐行检查", "无可用索引 / 最优路径就是扫全表", "最差"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "type 只说明访问方式，不等于结果好坏",
      body: "type=ALL 不一定是 bug——例如表太小、或命中比例过高，全表扫描反而是最优路径。但如果一条「本该走索引」的查询变成 ALL，通常就是前面讲的失效陷阱，值得优化。判断要看场景，而不是只看 type 一个格子。",
    },
    {
      type: "heading",
      text: "逐列读懂：id / select_type / table / possible_keys 等",
    },
    {
      type: "list",
      items: [
        "id：执行步骤的编号。多条记录出现且 id 相同表示同一组（join）；id 越大越先执行。子查询常表现为额外的行。",
        "select_type：查询类型，常见 SIMPLE（无子查询/UNION）、PRIMARY（最外层）、SUBQUERY、DERIVED（派生表）等。",
        "table：当前步骤访问的表（或别名/派生表）。",
        "possible_keys：优化器「可能」用到的索引（多个候选）。",
        "key：优化器最终选用的索引。key 为 NULL 说明没用任何索引。",
        "key_len：使用的索引键长度（字节），可据此判断组合索引实际用到了几列。",
        "ref：与 key 比较的对象，const 表示常量（等值）、表列名表示 JOIN 连接列。",
        "rows：优化器**预估**要扫描的行数（估算，不代表执行时的真实行数）。",
      ],
    },
    {
      type: "heading",
      text: "Extra 列的常见标记与含义",
    },
    {
      type: "table",
      caption: "EXPLAIN Extra 常见标记",
      headers: ["Extra 标记", "含义", "建议"],
      rows: [
        ["Using where", "取出行后还要在服务层再过滤（部分条件未走索引）", "看能否把条件纳入索引"],
        ["Using index", "**覆盖索引**：所需列都在二级索引里，不回表", "好事"],
        ["Using index condition", "用了**索引下推（ICP）**：回表前在存储引擎先过滤", "好事，已可接受"],
        ["Using temporary", "用了临时表（常因 GROUP BY/DISTINCT/子查询）", "留意是否过度；页多需大数据排序/分组"],
        ["Using filesort", "无法用索引顺序、需要额外排序", "常见优化目标：让 ORDER BY 走索引消除它"],
        ["Using join buffer", "被驱动表侧无法用索引，用 join buffer 逐行探测", "一般要对 JOIN 的连接列建索引"],
      ],
    },
    {
      type: "paragraph",
      text: "注意 `Using index`、`Using index condition`、`Using where` 三者常被搞混：`Using index` 表示覆盖、免回表（最省钱）；`Using index condition` 表示 ICP、回表减少了但没消除；`Using where` 表示最终还有一部分条件在取出记录后再过滤。读的时候顺着「排序去噪」的思路判断这条查询省不省。",
    },
    {
      type: "heading",
      text: "实战：一条「本该用索引」却 type=ALL 的查询",
    },
    {
      type: "paragraph",
      text: "假设 orders 表只有主键 id 的聚簇索引，`idx_user` 还没建。我们要按用户查订单，并做一次完整的前后对照。",
    },
    {
      type: "code",
      title: "优化前：没有可用索引 → 全表扫描 + filesort",
      language: "sql",
      code: "EXPLAIN\nSELECT id, total_amount\nFROM orders\nWHERE user_id = 42\nORDER BY created_at DESC;\n\n-- 结果（示意）：\n-- id | select_type | table  | type | possible_keys | key  | key_len | ref | rows | Extra\n-- 1  | SIMPLE      | orders | ALL  | NULL          | NULL | NULL    | NULL|100000| Using where; Using filesort",
    },
    {
      type: "paragraph",
      text: "这段输出信息量很大：`type=ALL` 说明全表扫描；`key=NULL` 说明一个索引都没用上（因为没有 idx_user）；`rows≈100000` 说明它预估要扫整张表 10 万行；`Extra` 里同时出现 `Using where`（取行后再过滤）和 `Using filesort`（排序没走索引，要额外排序）。这就是典型的「一条很健康的查询被困成全表扫描」。",
    },
    {
      type: "code",
      title: "优化：建好索引后 EXplain",
      language: "sql",
      code: "CREATE INDEX idx_user ON orders (user_id);\n\nEXPLAIN\nSELECT id, total_amount\nFROM orders\nWHERE user_id = 42\nORDER BY created_at DESC;\n\n-- 结果（示意）：\n-- id | select_type | table  | type | possible_keys | key      | key_len | ref  | rows | Extra\n-- 1  | SIMPLE      | orders | ref  | idx_user      | idx_user | 8       | const| 3    | Using filesort",
    },
    {
      type: "paragraph",
      text: "建了 `idx_user` 后：`type` 从 ALL 变成 `ref`（按二级索引等值访问），`key=idx_user`，`ref=const`（用常量 42 去比较），`rows` 从 10 万降到约 3（该用户的订单数）。全表扫描消失了。但注意 `Extra` 仍保留 `Using filesort`——因为排序列 `created_at` 不在 `idx_user` 里，仍要额外排序。",
    },
    {
      type: "code",
      title: "进一步优化：让 ORDER BY 也走索引，去掉 filesort",
      language: "sql",
      code: "-- 若该查询高频出现，把排序列纳入组合索引：\n-- (user_id, created_at)：先按 user 再按时间排，ORDER BY created_at 可用索引顺序\nCREATE INDEX idx_user_created ON orders (user_id, created_at);\n\nEXPLAIN\nSELECT id, total_amount\nFROM orders\nWHERE user_id = 42\nORDER BY created_at DESC;\n\n-- 结果（示意）：\n-- id | select_type | table  | type | possible_keys | key           | key_len | ref  | rows | Extra\n-- 1  | SIMPLE      | orders | ref  | idx_user_created | idx_user_created | 8    | const| 3   | (无 Using filesort)",
    },
    {
      type: "paragraph",
      text: "把 `created_at` 加进组合索引后，`ORDER BY created_at DESC` 可以直接利用索引的叶子顺序（先 user_id、再 created_at），于是 `Extra` 里的 `Using filesort` 消失了。这一步演示了一个重要技巧：**不少优化是「加一列进组合索引」而非新建独立索引**，让 WHERE 与 ORDER BY 共享一棵树。注意这里 `SELECT id, total_amount` 里 `total_amount` 不在索引中，所以仍会回表取该列（不出现 Using index）；若高频且只读这几列，可考虑把 `total_amount` 也加进索引做覆盖（牺牲空间换免回表）。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "rows 是估算值，不是实测",
      body: "EXPLAIN 的 rows 是优化器基于统计信息（如采样、基数估计）的**预估**行数，不是执行时真实扫描的行数。它对你的判断（从 10 万降到 3）有意义，但别把它当精确值。MySQL 8.0 的 `EXPLAIN ANALYZE` 会真实执行并给出实际耗时与行数，用于进一步验证。",
    },
    {
      type: "heading",
      text: "自查清单：读 EXPLAIN 时的快速判断",
    },
    {
      type: "list",
      items: [
        "有没有 ALL？如果这条查询本该过滤得很窄，ALL 往往是失效或漏建索引。",
        "key 是否为 NULL？NULL 表示没走索引。",
        "rows 是不是离谱地接近整表行数？若是，说明选择性差或没用到最佳路径。",
        "Extra 有没有 Using filesort / Using temporary？有则考虑用索引顺序消除排序/临时表。",
        "有没有 Using index / Using index condition？有则说明覆盖/ICP 生效，是好事。",
        "组合索引有没有只用到一半？比一下 key_len 看断点在哪列。",
      ],
    },
    {
      type: "quiz",
      question: "EXPLAIN 的 type 从最佳到最差的顺序正确的是？",
      options: [
        "ALL > index > range > const",
        "system > const > eq_ref > ref > range > index > ALL",
        "const > system > ALL > ref",
        "range > ref > const > index",
      ],
      answer: 1,
      explanation: "常见标尺为 best→worst：system、const、eq_ref、ref、range、index、ALL。const 代表按主键/唯一索引等值最多命中一行，ALL 代表全表扫描。",
    },
    {
      type: "quiz",
      question: "某条查询 EXPLAIN 输出 `type=ALL` 但 `possible_keys` 里有索引、`key=NULL`，最可能表示？",
      options: [
        "优化器成功用上了索引",
        "索引存在但优化器最终没选用，实际做了全表扫描，需结合 rows/Extra 分析为何没被采用",
        "这条查询是纯 SELECT，永远不会有 key",
        "全表扫描一定比走索引更快",
      ],
      answer: 1,
      explanation: "possible_keys 列出候选索引，key 才是最终选用；key=NULL 说明没走索引、做了全表扫描（type=ALL），应结合是否命中比例过高、是否有失效写法等判断是否值得优化。",
    },
    {
      type: "exercise",
      title: "消除 filesort 与临时表",
      description: "给定 `EXPLAIN SELECT user_id, status, SUM(total_amount) FROM orders GROUP BY user_id, status;` 输出含 `Using temporary; Using filesort`。请设计一个组合索引使 GROUP BY 尽量走索引顺序，说明你如何根据最左前缀组织列，并指出是否可能顺带产生覆盖（Using index）。",
      hint: "GROUP BY (user_id, status) 需要按这两列有序；索引 (user_id, status, total_amount …) 能让分组走索引，且如果 SELECT 列都在索引中就可能出现 Using index。",
    },
    {
      type: "keypoints",
      items: [
        "EXPLAIN 展示执行计划，不执行查询；rows 为预估而非实测",
        "type 好坏标尺：system > const > eq_ref > ref > range > index > ALL",
        "关键列：possible_keys、key、key_len、ref、rows",
        "Extra：Using where / Using index（覆盖）/ Using index condition（ICP）/ Using filesort / Using temporary / Using join buffer",
        "优化套路：让 WHERE 的列能定位、让 ORDER BY/GROUP BY 走索引顺序以消除 filesort/temporary",
      ],
    },
  ],
};
