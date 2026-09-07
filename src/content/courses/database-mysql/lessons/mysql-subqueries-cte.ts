/* ==================================================================
 * 课时：子查询与 CTE：把查询拆成可思考的块（mysql-subqueries-cte）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-subqueries-cte",
  "courseSlug": "database-mysql",
  "title": "子查询与 CTE：把查询拆成可思考的块",
  "summary": "理解标量、相关与非相关子查询的求值模型，以及用 CTE 把复杂查询拆成可读、可复用的步骤。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "当一条查询需要依赖另一条查询的结果时，你已经有 JOIN 这个工具。但 JOIN 要求你在一条 FROM 里把多张表「平铺」起来，很多问题用 JOIN 写非常别扭——例如「找出比分类平均价格贵的商品」「找出每个分类销量最高的商品」。子查询（Subquery）和 CTE（Common Table Expression）解决同一个更本质的诉求：把「查询的结果」当作一个可被外层继续加工的值或表。理解它们的求值模型，比死记语法更重要。"
    },
    {
      "type": "heading",
      "text": "标量子查询：当内层只返回一个值"
    },
    {
      "type": "paragraph",
      "text": "标量子查询（Scalar Subquery）出现在可以放单个值的位置：SELECT 列表、WHERE 等号右侧、HAVING 里。它的规则很简单——内层查询必须恰好返回一行一列。如果内层返回 0 行，结果取 NULL；如果返回多于 1 行，MySQL 会直接报错。这个「多于一行就报错」的行为是标量子查询最常见的坑。"
    },
    {
      "type": "code",
      "title": "标量子查询：找比全库平均价贵的商品",
      "language": "sql",
      "code": "-- 内层返回一个数：全库平均价格\nSELECT name, price\nFROM product\nWHERE price > (SELECT AVG(price) FROM product);\n\n-- 注意：如果内层不小心返回多行，会报错\n-- SELECT name FROM product\n-- WHERE price = (SELECT price FROM product); -- ERROR 1242: Subquery returns more than 1 row"
    },
    {
      "type": "paragraph",
      "text": "请注意上面的查询把 `product` 用了两次。每个子查询本质上是独立执行的查询，它不知道外层已经扫到了哪一行。要让它「跟着外层每一行去算」，就需要下文的**相关子查询**。"
    },
    {
      "type": "heading",
      "text": "相关与非相关子查询：两种求值模型",
    },
    {
      "type": "paragraph",
      "text": "两者的差别在于内层是否需要引用外层的列。**非相关（non-correlated）子查询**不引用外层，可以独立求值一次，结果对外层所有行都是同一个东西——前面找全库平均价的例子就是这样。**相关（correlated）子查询**引用外层当前行的列，内层要「对外层的每一行重新算一遍」，求值成本通常是外层行数 × 内层扫描，是最容易把查询写慢的结构。"
    },
    {
      "type": "definition",
      "term": "相关子查询（Correlated Subquery）",
      "definition": "内层子查询引用了外层查询当前行的列，因此每处理外层一行就要重新对内层求值一次。判断依据：内层 WHERE 里出现了外层 FROM 表的别名。"
    },
    {
      "type": "code",
      "title": "相关子查询：每个分类中小于该分类平均价的商品",
      "language": "sql",
      "code": "-- 对 p 的每一行，内层按 p.category 重新算一次该分类均价\nSELECT p.name, p.category, p.price\nFROM product p\nWHERE p.price < (\n    SELECT AVG(price)\n    FROM product p2\n    WHERE p2.category = p.category\n);"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "相关子查询的性能直觉",
      "body": "相关子查询在语义上是「外层每行跑一遍内层」，直觉上是 O(外行 × 内扫描)。MySQL 的优化器（8.0.18+）对许多相关子查询做了 semi-join / lazy materialization 等转换，所以实际未必真的全量重扫；但你自己审查时仍应把相关子查询当作「潜在的重计算」，优先用 JOIN、EXISTS 或 CTE 表达，并用 EXPLAIN 验证实际计划（见索引章）。"
    },
    {
      "type": "heading",
      "text": "IN / NOT IN 与 EXISTS：NULL 的陷阱",
    },
    {
      "type": "paragraph",
      "text": "`WHERE x IN (子查询)` 的语义是「x 等于内层结果里的某一个值」；`EXISTS (子查询)` 的语义是「内层是否至少返回一行」，它只关心有没有行，不关心值。这两者的关键差异在 NULL。SQL 的三值逻辑（TRUE / FALSE / NULL）让 `NOT IN` 面对包含 NULL 的集合时产生反直觉的结果，这是面试和企业里都极容易出错的地方。"
    },
    {
      "type": "code",
      "title": "NOT IN 遇到 NULL：结果为空",
      "language": "sql",
      "code": "-- 表里存在 user_id 为 NULL 的行时，下面的 NOT IN 不会返回任何行\nSELECT id FROM orders\nWHERE user_id NOT IN (SELECT id FROM user);\n\n-- 原因：user_id NOT IN (1, 2, NULL)\n--   = user_id <> 1 AND user_id <> 2 AND user_id <> NULL\n--   = ... AND NULL   -> 整体是 NULL（未知），WHERE 只保留 TRUE\n-- 因此即使有 user_id = 999 的孤儿订单也被过滤掉了"
    },
    {
      "type": "code",
      "title": "用 NOT EXISTS 规避 NULL 问题",
      "language": "sql",
      "code": "-- NOT EXISTS 只判断「是否存在匹配行」，不涉及 NULL 的三值逻辑\nSELECT o.id FROM orders o\nWHERE NOT EXISTS (\n    SELECT 1 FROM user u WHERE u.id = o.user_id\n);"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "什么时候用 EXISTS 而不是 IN",
      "body": "当查询「是否存在匹配行」时，EXISTS 语义更清晰、逻辑上对 NULL 更安全，且常能让优化器走 semi-join 而非逐行 NOT IN。当确实需要「在集合里」这种值语义时，用 IN 并谨慎处理 NULL（或先用 IS NOT NULL 过滤内层）。面试里被问到 IN vs EXISTS，通常是考察你有没有意识到 NOT IN + NULL 的坑。"
    },
    {
      "type": "heading",
      "text": "派生表：FROM 里的子查询",
    },
    {
      "type": "paragraph",
      "text": "子查询还可以出现在 FROM 子句里，此时它是一张**派生表（Derived Table）**——本质上是把内层查询的结果临时当成一张表，给一个别名再继续 JOIN / 过滤。derived table 必须先有别名，这是 MySQL 的强制要求。它把「先算一步、再基于结果继续查」的意图表达得很直接。"
    },
    {
      "type": "code",
      "title": "派生表：每个用户的订单数与累计金额",
      "language": "sql",
      "code": "SELECT u.name, d.order_count, d.total_spent\nFROM user u\nJOIN (\n    -- 这是派生表：先按用户聚合，再与 user 联表\n    SELECT user_id,\n           COUNT(*)          AS order_count,\n           SUM(total_amount) AS total_spent\n    FROM orders\n    WHERE status <> 'cancelled'\n    GROUP BY user_id\n) d ON d.user_id = u.id\nORDER BY d.total_spent DESC;"
    },
    {
      "type": "paragraph",
      "text": "派生表有个效率细节：MySQL 历史上默认会把派生表**物化（materialize）成临时表**，而不是像我们期望的那样直接流式计算。8.0 通过派生表下推（derived table merge / condition pushdown）改善了很多，但不是所有情况都能下推。当你需要「把派生表的结果在多处复用」，或让查询结构更清晰时，就该用下一节的 CTE。"
    },
    {
      "type": "heading",
      "text": "CTE：WITH ... AS 命名的临时结果集",
    },
    {
      "type": "paragraph",
      "text": "**Common Table Expression（CTE）**用 `WITH 名字 AS (查询)` 把一个子查询的结果命名为一个可读的临时名，然后在同一语句里引用它。相比派生表，CTE 可以：先于主查询声明、在同一语句中被多处引用、且彼此可以串联（后面的 CTE 引用前面的 CTE）。这让「一步一步地把复杂查询拆开」成为可能。CTE 是 MySQL 8.0 引入的语法——5.7 及更早版本不支持，只有 8.0 可用（除非你用物化视图或子查询变通）。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "CTE 需要 MySQL 8.0",
      "body": "WITH 子句是 MySQL 8.0 新增的能力，**5.7 没有 CTE**（也因此在 5.7 上写窗口函数同样不行）。如果你的团队仍跑 5.7，只能用派生表（子查询副本）或临时表替代；规划新项目和面试问答时，先确认目标 MySQL 版本。"
    },
    {
      "type": "code",
      "title": "单个 CTE：复用派生表",
      "language": "sql",
      "code": "WITH user_spend AS (\n    SELECT user_id, COUNT(*) AS order_count, SUM(total_amount) AS total_spent\n    FROM orders\n    WHERE status <> 'cancelled'\n    GROUP BY user_id\n)\nSELECT u.name, s.order_count, s.total_spent\nFROM user u\nLEFT JOIN user_spend s ON s.user_id = u.id\nORDER BY s.total_spent DESC;"
    },
    {
      "type": "code",
      "title": "多个 CTE 串联：先聚合再过滤",
      "language": "sql",
      "code": "WITH\npaid_orders AS (\n    SELECT * FROM orders WHERE status = 'paid'\n),\nuser_totals AS (\n    SELECT user_id, SUM(total_amount) AS amount\n    FROM paid_orders       -- 引用上面的 CTE\n    GROUP BY user_id\n)\nSELECT * FROM user_totals\nWHERE amount > 1000\nORDER BY amount DESC;"
    },
    {
      "type": "heading",
      "text": "实战：每个分类销量最高的商品",
    },
    {
      "type": "paragraph",
      "text": "把前面的工具组合起来解决一个真实业务题：「每个分类销量最高的商品」。销量 = 所有 order_item 里该商品的 quantity 之和。写法上可以先聚合成每个商品的销量，再用窗口函数（见下一课）或经典「全外联 / 子查询取最大值」思路。这里用 CTE + EXISTS 展示一种不需要窗口函数也能自洽的表达。"
    },
    {
      "type": "code",
      "title": "每个分类销量最高的商品（CTE 写法）",
      "language": "sql",
      "code": "WITH product_sales AS (\n    SELECT p.id, p.name, p.category,\n           SUM(oi.quantity) AS sold\n    FROM product p\n    LEFT JOIN order_item oi ON oi.product_id = p.id\n    GROUP BY p.id, p.name, p.category\n)\nSELECT name, category, sold\nFROM product_sales ps\nWHERE NOT EXISTS (\n    SELECT 1 FROM product_sales ps2\n    WHERE ps2.category = ps.category AND ps2.sold > ps.sold\n)\nORDER BY category;"
    },
    {
      "type": "paragraph",
      "text": "上面用了「不存在比它销量更高的同类商品」来判断每个分类的销量冠军。注意：如果同分类有多个销量相同的商品，这种写法会把它们都返回——这是「销量最高（可能并列）」的语义。若只想每分类取一条，就需要窗口函数 ROW_NUMBER 或额外加个 tie-break 规则，这正是下一课的内容。"
    },
    {
      "type": "heading",
      "text": "递归 CTE：有限的提及",
    },
    {
      "type": "paragraph",
      "text": "CTE 还有一种形式叫**递归 CTE（Recursive CTE）**，用于处理「层级 / 树状」结构——例如组织树的上下级、商品分类的多级目录、BOM 展开。它的结构是 `WITH RECURSIVE 名字 AS ( 初始行 UNION ALL 递归部分 )`，递归部分不断引用自己生成下一层，直到不再产生新行。概念上值得知道它存在、能解决什么，但电商订单库没有天然的自引用层级表，本课点到即止，专项查询技巧不在本课范围。"
    },
    {
      "type": "code",
      "title": "递归 CTE：生成 1..5 的序列（示意）",
      "language": "sql",
      "code": "-- 需要 MySQL 8.0；示意递归结构，不针对 shop 表\nWITH RECURSIVE seq AS (\n    SELECT 1 AS n                -- 锚点：初始行\n    UNION ALL\n    SELECT n + 1 FROM seq WHERE n < 5   -- 递归部分\n)\nSELECT n FROM seq;\n-- 输出 1,2,3,4,5"
    },
    {
      "type": "quiz",
      "question": "有一张 orders 表，其中某些行的 user_id 为 NULL。执行 `SELECT id FROM orders WHERE user_id NOT IN (SELECT id FROM user);`，下列说法正确的是？",
      "options": [
        "正常返回所有孤儿订单，不会有任何问题",
        "因为 NOT IN 遇到 NULL 会整体变成未知（NULL），结果集会比预期少甚至为空",
        "MySQL 会直接语法报错，因为 NOT IN 不允许 NULL",
        "结果与 NOT EXISTS 完全等价，二者可以任意互换"
      ],
      "answer": 1,
      "explanation": "user_id NOT IN (1,2,NULL) 展开为 user_id<>1 AND user_id<>2 AND user_id<>NULL。任何值与 NULL 比较都是未知（NULL），WHERE 只保留 TRUE，所以满足条件的行反而被过滤掉。NOT EXISTS 只判断有没有匹配行，不受此影响，与 NOT IN+NULL 并不等价。"
    },
    {
      "type": "exercise",
      "title": "用 CTE 找出每个分类最贵且在售的商品",
      "description": "在 shop 库中，写一条查询：找出「每个分类中价格最高」的商品名称与价格。要求用 WITH CTE 表达，且把「已下架 / 无库存」的意思自行定义（例如 stock > 0 视为在售）。再思考：如果两件商品并列最高价，如何处理？",
      "hint": "先在一个 CTE 里按 category 求 MAX(price)，再联表或用 NOT EXISTS 筛出等于该最大值的行；并列问题回到「要不要 tie-break」的语义选择。"
    },
    {
      "type": "keypoints",
      "items": [
        "标量子查询必须返回一行一列，0 行使结果是 NULL，多行则报错 1242",
        "相关子查询引用外层行、逐行重算；非相关子查询只算一次",
        "NOT IN + 内层含 NULL 会让结果异常变少，EXISTS / NOT EXISTS 只看有没有行、对 NULL 安全",
        "FROM 里的子查询叫派生表，必须起别名；8.0 有派生表下推优化",
        "WITH ... AS 是 MySQL 8.0 的 CTE，可多步串联、可复用；5.7 不支持",
        "WITH RECURSIVE 用于层级/树状数据，属于进阶用法"
      ]
    }
  ]
};
