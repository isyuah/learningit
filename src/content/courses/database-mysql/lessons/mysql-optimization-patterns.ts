/* ==================================================================
 * 课时：常见优化场景：分页、JOIN、count 与批量（mysql-optimization-patterns）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-optimization-patterns",
  "courseSlug": "database-mysql",
  "title": "常见优化场景：分页、JOIN、count 与批量",
  "summary": "针对电商订单库的真实场景，给出深分页、JOIN、COUNT、批量写四大经典问题的修复模式与陷阱。",
  "minutes": 24,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "上一课我们建立了「定位慢查询 → 修复 → 验证」的整体流程。这一课落到一类具体的「战斗经验」上：在电商订单库 `shop` 里，有几种几乎每个项目都会遇到的慢查询场景——翻页翻得太深、JOIN 把数据撑爆、COUNT 统计超大表、以及逐条循环写库。它们有各自成熟的修复模式，也有各自要付出的代价。这一课逐一把它们讲清楚，并明确标注哪些策略是「用精确性换速度」。"
    },
    {
      "type": "heading",
      "text": "深分页：LIMIT 的偏移量为什么越翻越慢"
    },
    {
      "type": "paragraph",
      "text": "假设要在订单列表上做分页，第 100001 页（偏移 100000）的写法是 `LIMIT 100000, 20`。MySQL 需要先扫描、丢弃前 100000 行，把命中的 20 行返回。代价在于：它不会「跳过」那 10 万行，而是真的把前 10 万行都读出来再扔掉。偏移量越大，无效读越多——这就是深分页慢的根源。"
    },
    {
      "type": "code",
      "title": "深分页：低效但常见的写法",
      "language": "sql",
      "code": "-- 第 100001 页，每页 20 条（orders 上百万行）\nSELECT id, user_id, status, total_amount\nFROM orders\nORDER BY id\nLIMIT 100000, 20;\n\n-- EXPLAIN 关注点：\n-- type : index / range\n-- rows : 接近 100000+ 的估计值（要扫描并丢弃大量行）"
    },
    {
      "type": "paragraph",
      "text": "更糟的变体是按非索引字段排序再偏移，例如 `ORDER BY created_at LIMIT 100000, 20`——这不仅要扫很多行，还常常触发 `Using filesort`。而索引字段上的深分页虽然能沿索引走（type 接近 index），依然要「走过去然后丢掉」，问题没有本质改变。"
    },
    {
      "type": "subheading",
      "text": "修复 1：seek / keyset 分页（游标分页）"
    },
    {
      "type": "paragraph",
      "text": "核心思路是彻底绕开「偏移量」：不告诉数据库「从第 N 行开始」，而是告诉它「从上次看到的某个值之后继续」。对单调递增的主键，就是 `WHERE id > 上一页最后一个 id ORDER BY id LIMIT 20`。数据库直接用索引定位到那个 id，只需扫描随后的 20 行，没有任何丢弃工作，从 O(偏移量) 降到 O(每页行数)。"
    },
    {
      "type": "code",
      "title": "seek 分页：用索引定位代替偏移",
      "language": "sql",
      "code": "-- 首屏：正常取第一页，记住最后一个 id（比如 10020）\nSELECT id, user_id, status, total_amount\nFROM orders\nORDER BY id\nLIMIT 20;\n\n-- 下一页：从上一页最后一条之后开始，仍是 20 条\nSELECT id, user_id, status, total_amount\nFROM orders\nWHERE id > 10020\nORDER BY id\nLIMIT 20;\n\n-- 再下一页：updated 用上一次返回的最后一个 id（比如 10040）\nSELECT id, user_id, status, total_amount\nFROM orders\nWHERE id > 10040\nORDER BY id\nLIMIT 20;"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "seek 分页牺牲的是「随机跳页」",
      "body": "seek 分页只能「顺着往下翻」，不能自由跳到第 5000 页，因为它依赖「上一个锚点 id」，而不是行的绝对序号。如果你的产品必须支持随意点页码（例如后台管理列表、结果总数固定不变），seek 就不适用，需要回到 offset 方案或用别的兜底。这是一个真实的正确性/需求权衡：seek 换来了深翻页的稳定与快，代价是失去了随机跳页能力。"
    },
    {
      "type": "subheading",
      "text": "修复 2：用覆盖索引兜底 offset 的场景"
    },
    {
      "type": "paragraph",
      "text": "如果确实要保留 offset（例如必须随机跳页），一个缓解手段是先在一棵「窄」的覆盖索引上取得主键，再回表取整行，避免在 index 阶段就携带所有要返回的列。因为覆盖索引只需要读索引页，不必读数据页，前 10 万个主键的「路过」成本大幅下降。"
    },
    {
      "type": "code",
      "title": "覆盖索引 + 延迟回表",
      "language": "sql",
      "code": "-- orders 上若已有 KEY idx_created_at (created_at)\n-- 先在覆盖索引里取这一页的 id，再 join 回表取完整行\nSELECT o.*\nFROM (\n    SELECT id\n    FROM orders\n    ORDER BY created_at\n    LIMIT 100000, 20\n) AS page\nJOIN orders o ON o.id = page.id\nORDER BY o.created_at;"
    },
    {
      "type": "paragraph",
      "text": "注意这里的「覆盖索引 + 延迟回表」只是让 offset 分页没以前那么痛，偏移量的成本仍然随页码增长。「是否用 offset」其实是产品需求决定的，索引策略只是把它的代价压低。"
    },
    {
      "type": "heading",
      "text": "JOIN 优化：索引、裁剪列、小表驱动与 fan-out"
    },
    {
      "type": "paragraph",
      "text": "JOIN 慢的原因通常有四类：连接列上没有索引、SELECT 了根本不需要的列、驱动表选得不对导致重复扫描、以及连接本身产生了「行数膨胀」。我们逐一看。join 算法与两表连接列上的索引关系最大——如果被驱动表的连接列没有索引，优化器往往只能反复全表扫（Nested Loop 退化成可怕的开销）。"
    },
    {
      "type": "code",
      "title": "JOIN 前先检查连接列索引",
      "language": "sql",
      "code": "-- 查询每个订单对应的商品明细（orders 1 对 N order_item）\n-- 关键：order_item 上必须有 KEY idx_order (order_id)（建表时已有）\nSELECT o.id, o.status, o.total_amount,\n       oi.product_id, oi.quantity\nFROM orders o\nJOIN order_item oi ON oi.order_id = o.id\nWHERE o.user_id = 42;"
    },
    {
      "type": "paragraph",
      "text": "由于 `order_item` 建表时就带了 `KEY idx_order(order_id)`，被驱动表的连接列有索引，JOIN 可以在索引上定位而不用全表扫。这是 JOIN 性能的地基。接下来是「裁剪列」：`SELECT *` 会让每行带着大量用不到的列穿过 JOIN，放大内存与 I/O。只选要的列，既缩短行宽，也让覆盖连接列的机会更大。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "小表驱动大表，是个经验法则不是定律",
      "body": "「用行数少的表做驱动表」是初学者常被要求遵守的法则，意在减少被驱动表的重复访问次数。但在现代 MySQL（优化器会自己决定 join 顺序，也会用 hash join；8.0 支持 hash join）里，这主要是一个「心理模型」而非必须手动的硬规则。真正要做的：给连接列建索引、剪掉冗余列、看 EXPLAIN 里哪张表先被访问。别为「手动指定驱动表」去写复杂 SQL 而牺牲可读性。"
    },
    {
      "type": "paragraph",
      "text": "还有一个必须警惕的 JOIN 抗模式：**1:N 连接造成行数膨胀（fan-out）**。当 `orders` 与 `order_item` 一对一地看是 1 条订单，但因为一个订单有多条明细，JOIN 后每个订单会变成多行。如果你又在 JOIN 结果上做聚合，稍不留神就会把一行订单的数据重复计算进去——例如 `SUM(oi.quantity)` 才是对的，但 `SUM(o.total_amount)` 会把同一订单金额重复算 N 次。JOIN 后面的 GROUP BY 与聚合必须想明白「膨胀发生在哪一层」。"
    },
    {
      "type": "code",
      "title": "1:N JOIN 后的聚合陷阱",
      "language": "sql",
      "code": "-- 错误示范：总额会在每个明细行上重复累加\nSELECT o.id, SUM(o.total_amount) AS double_counted\nFROM orders o JOIN order_item oi ON oi.order_id = o.id\nWHERE o.id = 100\nGROUP BY o.id;  -- total_amount 被加了 order_item 的条数那么多遍\n\n-- 正确做法：先在子查询/CTE 里按明细做聚合（数量），再和订单总额组合\nWITH item_qty AS (\n    SELECT order_id, SUM(quantity) AS qty\n    FROM order_item\n    WHERE order_id = 100\n    GROUP BY order_id\n)\nSELECT o.id, o.total_amount, i.qty\nFROM orders o\nJOIN item_qty i ON i.order_id = o.id\nWHERE o.id = 100;"
    },
    {
      "type": "heading",
      "text": "COUNT 优化：先分清语义，再谈提速"
    },
    {
      "type": "paragraph",
      "text": "首先必须把语义对齐：`COUNT(*)` 统计「行数」（在 MySQL 里它会计所有行，通常正是你想要的），而 `COUNT(col)` 统计「该列为非 NULL 的行数」。两者概念不同：如果 `col` 允许 NULL，`COUNT(col)` 会少于总行数。很多人以为 `COUNT(*)` 比 `COUNT(col)` 慢——其实在 MySQL 上，`COUNT(*)` 走统计计数往往不更慢，反而是最标准的行数写法。真正的性能问题出现在「统计一个巨大表的行数」。"
    },
    {
      "type": "code",
      "title": "COUNT(*) 与 COUNT(col) 语义对比",
      "language": "sql",
      "code": "-- COUNT(*) 统计总行数\nSELECT COUNT(*) FROM orders;      -- 所有订单行数\n\n-- COUNT(col) 只统计该列非 NULL 的行\nSELECT COUNT(payment_id) FROM orders;  -- 若 payment_id 可空，结果 ≤ COUNT(*)"
    },
    {
      "type": "paragraph",
      "text": "对一张几千万行的 `orders` 表，`SELECT COUNT(*) FROM orders` 需要 InnoDB 去遍历索引或数据——即便用覆盖索引，代价依旧可观。而且**InnoDB 并不像 MyISAM 那样缓存一张表的精确行数**，所以 InnoDB 上的行数统计每次都要真的扫描。这是「为什么 InnoDB 上 COUNT(*) 在超大表上不是免费的」的本质原因。"
    },
    {
      "type": "subheading",
      "text": "近似策略与它的代价"
    },
    {
      "type": "paragraph",
      "text": "当「精确到个位」不是硬需求时（例如前台列表页显示「约 1.2 万条」、后台看板趋势），有三种近似思路：利用统计信息估算、维护独立计数器表、或抽样。这些策略的共同代价是——**返回的不是精确行数**，必须在产品里明确这一点。"
    },
    {
      "type": "code",
      "title": "三招近似计数及其代价",
      "language": "sql",
      "code": "-- 1) 用统计信息估算（快，但只是估算，且行数可能滞后）\nSELECT TABLE_ROWS FROM information_schema.TABLES\nWHERE TABLE_SCHEMA='shop' AND TABLE_NAME='orders';\n--   ⚠ information_schema.TABLES.TABLE_ROWS 是估算值，不是精确行数\n\n-- 2) 独立计数器表：事务里同步维护，读时直接拿\n--    CREATE TABLE stats (name VARCHAR(50) PRIMARY KEY, cnt BIGINT);\n--    UPDATE stats SET cnt = cnt + 1 WHERE name='order_count'; -- 随插入更新\n--    SELECT cnt FROM stats WHERE name='order_count';\n--    ⚠ 代价是每次插入都要维护计数器 + 保证一致性（可能引入额外锁/事务）\n\n-- 3) 抽样估算：在有索引的列上 count 一部分再推算\n--    ⚠ 依赖采样均匀性，误差可能被低估"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "用近似策略前先确认「精确性」不是需求",
      "body": "无论是 `information_schema` 的行数估计，还是计数器表/抽样，都是在「用精确性换速度」。如果业务必须展示精确的「共 N 条」并允许用户跳到最后几页，近似策略会导致分页总数不对、页尾数据错乱。方案：要么忍受 COUNT 开销并配合分页优化，要么明确告知用户「数量为近似值」，要么改用别的交互（无限滚动）来回避总页数需求。"
    },
    {
      "type": "heading",
      "text": "批量插入与批量更新：别在循环里逐条写"
    },
    {
      "type": "paragraph",
      "text": "最后是写入侧的经典反模式：在一个循环里逐条执行 INSERT 或 UPDATE。每一条都是一次独立的「SQL 往返」，除了语句本身的成本，还牵扯到每条语句单独的解析、执行、日志、以及（很多框架下）单独的事务提交。把循环里的 N 次写合并成一次批量写，往往能带来数量级的性能提升。"
    },
    {
      "type": "code",
      "title": "批量插入 vs 逐条插入",
      "language": "sql",
      "code": "-- 反模式：在应用代码里循环 1000 次逐条 INSERT\n-- for (item in items) { INSERT INTO order_item ... VALUES (...item...); }\n\n-- 修复：一次多行 INSERT（MySQL 原生支持）\nINSERT INTO order_item (order_id, product_id, quantity, price)\nVALUES\n  (100, 1, 2, 19.90),\n  (100, 2, 1, 59.00),\n  (100, 3, 3, 12.50);"
    },
    {
      "type": "paragraph",
      "text": "批量 UPDATE 同理：与其在循环里一条条改，不如一次性把所有要改的行放进一条带 `CASE WHEN` 的 UPDATE，或至少把「同一条业务逻辑」的更新打包进一个事务批量提交，减少事务次数与日志刷盘频率。批量越大，分摊的固定开销越薄，但也不是越大越好——超大事务会长时间持有锁、占内存、甚至阻塞其它事务。"
    },
    {
      "type": "code",
      "title": "批量 UPDATE：用 CASE 一次改多行",
      "language": "sql",
      "code": "-- 反模式：循环里逐条 UPDATE 同一类业务\n-- while (...) { UPDATE product SET stock = ... WHERE id = ?; }\n\n-- 修复：一次 UPDATE 用 CASE WHEN 对多行分别赋值\nUPDATE product\nSET stock = CASE id\n    WHEN 1 THEN 10\n    WHEN 2 THEN 5\n    WHEN 3 THEN 8\nEND\nWHERE id IN (1,2,3);"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "批量是有边界的",
      "body": "不要为了「越大越好」把全部数据塞进一条语句或一个事务。一次插入数百万行会让 redo log、undo log 与内存承压，并在执行期间长期持有锁。工程惯例是把大批拆成若干「可控的批」（例如每批 500～1000 行/每批提交一次），在吞吐与事务/锁开销之间取平衡。具体批大小依赖硬件与业务，没有放之四海皆准的魔法数字。"
    },
    {
      "type": "heading",
      "text": "其它该躲开的慢查询反模式"
    },
    {
      "type": "paragraph",
      "text": "除了上面四类，还有一批高频反模式值得随手规避：`SELECT *` 拉回不需要的列；对索引列套函数或运算导致「非 sargable」（不能被索引下推使用）；以及在 WHERE 里对列做隐式类型转换或加函数。这些的核心是同一个原则：**让谓词保持「列本身」（sargable），把函数/计算放到常量一侧**，让索引能被真正用上。"
    },
    {
      "type": "code",
      "title": "非 sargable：函数包住列 vs 包住常量",
      "language": "sql",
      "code": "-- 反模式：对列套函数，索引失效（无法利用 created_at 索引）\nSELECT * FROM orders\nWHERE YEAR(created_at) = 2024;\n\n-- 修复：把函数/计算放到常量侧，保持列本身干净，可用索引\nSELECT * FROM orders\nWHERE created_at >= '2024-01-01'\n  AND created_at <  '2025-01-01';\n\n-- 反模式：SELECT * 带回大量无关列\nSELECT * FROM orders WHERE user_id = 42;\n-- 修复：只选需要的列\nSELECT id, status, total_amount FROM orders WHERE user_id = 42;"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "「函数包列会失效」不是绝对真理，但值得默认遵守",
      "body": "某些版本的 MySQL 对特定函数（如 `LIKE 'abc%'` 前缀匹配、或特定常量函数）能做一些推导，但「对列套函数/运算通常让对应索引失效」仍是我们要默认避开的稳妥习惯。想验证，永远用 EXPLAIN 看 `type`/`key` 是否命中索引，而不是凭印象。"
    },
    {
      "type": "quiz",
      "question": "在 shop 的 orders 表上做深分页，`WHERE id > last_id ORDER BY id LIMIT 20` 相比 `LIMIT 100000, 20` 的主要优势是？",
      "options": [
        "它返回的行数更多",
        "它用索引定位到锚点 id 后只需再扫这一页的 20 行，不再扫描并丢弃前 10 万行",
        "它能让列表随机跳到任意一页",
        "它不再需要任何索引"
      ],
      "answer": 1,
      "explanation": "seek/keyset 分页用 WHERE id > 上一页末尾的 id 让数据库从索引直接定位，只需扫描本页的 LIMIT 行数，消除了 offset 方案里「扫描并丢弃前面 N 行」的成本；代价是不能随机跳页。"
    },
    {
      "type": "exercise",
      "title": "为分页 + 计数场景选方案",
      "description": "运营要「按用户分页查看其订单」，并要求在列表顶部显示「共 N 条订单」且能跳到最后几页。orders 有约 800 万行。请你：(1) 说明能否用 seek 分页并解释或否决的原因；(2) 说明列表行数 COUNT 是否该用 information_schema 估算，为什么；(3) 给出一个可落地的组合方案。",
      "hint": "「必须显示精确总条数 + 可跳页」与 seek 分页的「只顺翻」冲突；COUNT 精确统计在 800 万行上不便宜——想想哪些需求可以放宽，哪些必须精确。"
    },
    {
      "type": "keypoints",
      "items": [
        "深分页用 seek（WHERE id > 锚点 ORDER BY id LIMIT n），代价是不能随机跳页",
        "必须 offset 时，可先走覆盖索引取主键再延迟回表降低代价",
        "JOIN 先保证连接列有索引、裁剪不需要的列；警惕 1:N fan-out 造成聚合重复",
        "COUNT(*) 统计行数，COUNT(col) 统计非 NULL 行数，语义不能混",
        "超大表精确 COUNT 开销大；近似策略（统计估算/计数器/抽样）都以牺牲精确性为代价",
        "批量 INSERT/UPDATE 替代循环逐条写，但批要控制大小避免长锁",
        "躲开 SELECT *、非 sargable（函数包列）、隐式转换等反模式"
      ]
    }
  ]
};
