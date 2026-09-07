/* ==================================================================
 * 课时：GROUP BY / HAVING 聚合进阶（mysql-aggregation-advanced）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-aggregation-advanced",
  "courseSlug": "database-mysql",
  "title": "GROUP BY / HAVING 聚合进阶",
  "summary": "把 GROUP BY 的语义、HAVING 与 WHERE 的分工、多列分组、GROUP_CONCAT 与 COUNT 的细节一次讲清。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "基础课里你已经会写 `SELECT category, COUNT(*) FROM product GROUP BY category`。但聚合里藏着大量容易翻车的语义细节：某一列到底能不能出现在 SELECT 里、HAVING 和 WHERE 到底谁先执行、COUNT(*) 和 COUNT(col) 差在哪。这一课把这些「会了但没深究」的规则一次讲透，很多面试的送命题就出在这里。"
    },
    {
      "type": "heading",
      "text": "GROUP BY 的语义：折叠与“每组一行”",
    },
    {
      "type": "paragraph",
      "text": "`GROUP BY col` 把表里 col 值相同的所有行合并成一个输出行。合并之后，这一组里**具体是哪一行**的哪一列，对外层不再有意义——你只能看到：分组列本身、以及对该组整组计算的聚合函数结果（如 SUM / COUNT / MAX / MIN / AVG）。这一步若没想清楚，就会踩「SELECT 了不在分组里、又不是聚合的列」这个坑。"
    },
    {
      "type": "code",
      "title": "最基本的聚合",
      "language": "sql",
      "code": "-- 每个分类的商品数与平均价\nSELECT category,\n       COUNT(*)      AS cnt,\n       AVG(price)    AS avg_price,\n       MAX(price)    AS max_price\nFROM product\nGROUP BY category;"
    },
    {
      "type": "heading",
      "text": "ONLY_FULL_GROUP_BY：为什么“把没分组的列塞进 SELECT”不行",
    },
    {
      "type": "paragraph",
      "text": "问题来了：`SELECT category, name, MAX(price) FROM product GROUP BY category` 里的 `name` 既不在 GROUP BY 里、也不是聚合函数，它到底代表哪一行的名字？SQL 标准认为这没有定义。MySQL 从 5.7.5 起默认开启 **ONLY_FULL_GROUP_BY** 模式，在这种模式下这种查询会直接报错，而不是“挑一行给你”。这是一个版本敏感且影响非常广泛的行为。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "ONLY_FULL_GROUP_BY 是 5.7.5 起的默认",
      "body": "仅 5.7.5 及之后、8.0 默认开启 ONLY_FULL_GROUP_BY：SELECT 中出现的每个非聚合列都必须出现在 GROUP BY 中（或由其它列函数依赖决定，见下文）。5.7.5 之前的 MySQL 和显式关闭该模式的库允许这种查询并任意挑一行——结果不确定。面试 / 线上都可能因这个差异踩到，务必确认你的 MySQL 版本与 sql_mode。"
    },
    {
      "type": "code",
      "title": "会报错与可以用的写法",
      "language": "sql",
      "code": "-- 在默认 ONLY_FULL_GROUP_BY 下：错误，name 不在 GROUP BY、也不是聚合\n-- SELECT category, name, MAX(price) FROM product GROUP BY category;\n-- ERROR 1055: ... which isn't in GROUP BY\n\n-- 正确：要么把 name 加进 GROUP BY，要么只取分组列 + 聚合\nSELECT category, MAX(price) AS max_price FROM product GROUP BY category;\n\n-- 也可以按多列分组，使每组“名”唯一：\nSELECT category, name, SUM(oi.quantity) AS sold\nFROM product p\nLEFT JOIN order_item oi ON oi.product_id = p.id\nGROUP BY p.category, p.name;"
    },
    {
      "type": "paragraph",
      "text": "关于「函数依赖」的特例：如果某列在功能上依赖分组列，MySQL 允许直接出现在 SELECT 里。例如 `GROUP BY p.id` 而主键 id 唯一确定 name，那么选 `p.name` 是**允许**的（8.0 支持基于主键的函数依赖检测，5.7 也部分支持）。判断时记住：能否出现在 SELECT 里 = 「它是否被分组列唯一确定」或「它是否分组列本身」或「它是否是聚合函数」。"
    },
    {
      "type": "code",
      "title": "主键函数依赖：GROUP BY 主键时可以带其他列",
      "language": "sql",
      "code": "SELECT p.id, p.name, p.category, SUM(oi.quantity) AS sold\nFROM product p\nLEFT JOIN order_item oi ON oi.product_id = p.id\nGROUP BY p.id;  -- id 是主键，唯一确定 name/category，允许带上"
    },
    {
      "type": "heading",
      "text": "WHERE 与 HAVING 的分工：过滤发生在不同阶段",
    },
    {
      "type": "paragraph",
      "text": "两者都能过滤，但作用阶段完全不同：**WHERE 在分组（聚合）之前**过滤原始行，因此 WHERE 里**不能使用聚合函数**（如 `WHERE SUM(...) > 10` 不合法）；**HAVING 在分组（聚合）之后**过滤结果组，因此 HAVING 里可以使用聚合函数和分组列。用一个直觉记：WHERE 删行、HAVING 删组。能用 WHERE 先筛掉的行，就别留到 HAVING 再筛——提前减负通常更快。"
    },
    {
      "type": "code",
      "title": "WHERE 与 HAVING 分工",
      "language": "sql",
      "code": "-- 先只统计已支付订单（WHERE 删行），再筛出单用户累计超过 1000 的（HAVING 删组）\nSELECT user_id, COUNT(*) AS order_count, SUM(total_amount) AS amount\nFROM orders\nWHERE status <> 'cancelled'          -- 分组前过滤：行级条件\nGROUP BY user_id\nHAVING amount > 1000;               -- 分组后过滤：组级条件，可用聚合"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "WHERE 里不能用聚合函数",
      "body": "`WHERE SUM(quantity) > 10` 会报错，因为 WHERE 执行时还没发生聚合、SUM 没有意义。要把“组级”条件用上聚合函数，必须放 HAVING。反过来，HAVING 里写能用 WHERE 代替的“行级”条件虽合法但不必要（例如 `HAVING status <> 'cancelled'` 应放 WHERE）。"
    },
    {
      "type": "heading",
      "text": "多列分组：GROUP BY 的多维聚合",
    },
    {
      "type": "paragraph",
      "text": "GROUP BY 可以同时按多列分组，结果按「这些列组合出的笛卡尔式组合」生成每一行。多列分组在 WHERE 一致的前提下，遵守同样的 ONLY_FULL_GROUP_BY 规则：SELECT 里出现的非聚合列必须全部出现在 GROUP BY 列表中（或被函数依赖确定）。按多列分组经常配合窗口函数/子查询解决「分组内再分组」的需求。"
    },
    {
      "type": "code",
      "title": "按（分类 + 状态）多维聚合",
      "language": "sql",
      "code": "SELECT p.category,\n       o.status,\n       COUNT(*)          AS row_count,\n       SUM(oi.quantity)  AS total_qty\nFROM order_item oi\nJOIN orders o  ON o.id = oi.order_id\nJOIN product p ON p.id = oi.product_id\nWHERE o.status IN ('paid', 'shipped', 'completed')\nGROUP BY p.category, o.status\nORDER BY p.category, o.status;"
    },
    {
      "type": "heading",
      "text": "GROUP_CONCAT：把同组多个值并成一行",
    },
    {
      "type": "paragraph",
      "text": "`GROUP_CONCAT(expr)` 把一组内所有行的某列值拼成一个字符串（默认逗号分隔），常用于「每个用户的订单编号列表」「每个分类的商品名列表」。它不是 SQL 标准聚合，而是 MySQL 的扩展，但非常实用。注意它受 `group_concat_max_len` 限制（默认较小，8.0 默认 1024 字节，具体值因版本/配置而定），超长会被截断——大量数据拼接前要意识到这个限制。"
    },
    {
      "type": "code",
      "title": "GROUP_CONCAT 拼接商品名",
      "language": "sql",
      "code": "-- 每个分类下的商品名，用“、”连接\nSELECT category,\n       GROUP_CONCAT(name ORDER BY price DESC SEPARATOR '、') AS product_names,\n       COUNT(*) AS cnt\nFROM product\nGROUP BY category;"
    },
    {
      "type": "heading",
      "text": "COUNT 三兄弟：COUNT(*), COUNT(col), COUNT(DISTINCT col)",
    },
    {
      "type": "paragraph",
      "text": "这三个计数的语义完全不同：`COUNT(*)` 数**行数**（整行，即使全是 NULL 也算行）；`COUNT(col)` 数**该列非 NULL 的个数**（NULL 不算）；`COUNT(DISTINCT col)` 数**该列非 NULL 且去重后的个数**。最容易错的坑是 `COUNT(col)` 对应不上 `COUNT(*)`——当你从 COUNT(*) 改成 COUNT(col) 后结果变少，往往是因为该列存在 NULL。"
    },
    {
      "type": "code",
      "title": "三种 COUNT 的结果差异",
      "language": "sql",
      "code": "SELECT\n    COUNT(*)                 AS total_rows,        -- 所有行\n    COUNT(total_amount)      AS non_null_amount,   -- total_amount 非 NULL 的行\n    COUNT(DISTINCT user_id)  AS distinct_users     -- 不同的非空 user_id 个数\nFROM orders;"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "COUNT(*) 与 COUNT(列) 别混用",
      "body": "如果只想知道“有多少行”，用 COUNT(*)（8.0 上 COUNT(*) 与 COUNT(主键) 在 InnoDB 都需扫描，但语义最直接）。当心把 COUNT(col) 当成行数来解读：某列允许 NULL 时二者会不同。面试常问 “COUNT(*) vs COUNT(1) vs COUNT(col)”——前两者都数行（MySQL 对 COUNT(1) 与 COUNT(*) 语义一致，都算行，1 只是常量），只有 COUNT(col) 会跳过 NULL。"
    },
    {
      "type": "heading",
      "text": "ROLLUP：可选的分组小计",
    },
    {
      "type": "paragraph",
      "text": "`WITH ROLLUP` 在 GROUP BY 结果末尾追加一列「总计 / 小计」行，自动生成更高层级的汇总（多列分组时逐层小计）。它对「报表里的合计行」很实用。注意：ROLLUP 行里被汇总的分组列会是 NULL，解读时别把 NULL 当成真实分组值。本课只做提示性介绍，并不作为强制考点。"
    },
    {
      "type": "code",
      "title": "WITH ROLLUP 生成合计行",
      "language": "sql",
      "code": "SELECT category, COUNT(*) AS cnt\nFROM product\nGROUP BY category WITH ROLLUP;\n-- 末尾会多一行 category = NULL 的总计行"
    },
    {
      "type": "quiz",
      "question": "默认 ONLY_FULL_GROUP_BY（MySQL 5.7.5+/8.0）下，下列哪个查询合法？",
      "options": [
        "SELECT category, name, COUNT(*) FROM product GROUP BY category",
        "SELECT category, COUNT(*) FROM product GROUP BY category",
        "SELECT name, SUM(price) FROM product GROUP BY category",
        "SELECT category, COUNT(*) FROM product GROUP BY category HAVING COUNT(*) > 1 WHERE price > 0"
      ],
      "answer": 1,
      "explanation": "选项 B 的 category 在 GROUP BY 中、COUNT(*) 是聚合，合法。A 的 name 不在 GROUP BY 也非聚合，1055 报错；C 的 name 同样非法（price 的聚合 SUM 合法但 name 不是）；D 把 WHERE 写在 HAVING 之后语法错误——WHERE 必须排在 GROUP BY / HAVING 之前。"
    },
    {
      "type": "exercise",
      "title": "统计每个用户的订单画像",
      "description": "在 shop 库中，写一条查询：按用户输出「有效订单数、累计消费、最近一次下单时间、以及他买过商品的去重数量」。注意用 WHERE 排除 cancelled 订单，用 HAVING 筛出累计消费超过 500 的用户，并用 COUNT(DISTINCT ...) 统计去重商品数。",
      "hint": "先从 order_item JOIN orders 得到每个 user 的去重商品数，或在同一 GROUP BY 里用 COUNT(DISTINCT oi.product_id)。WHERE 删行条件（status）放最前，HAVING 才能用聚合 SUM。"
    },
    {
      "type": "keypoints",
      "items": [
        "GROUP BY 折叠为每组一行，SELECT 的非聚合列必须被分组列唯一确定或本身是分组列",
        "ONLY_FULL_GROUP_BY 从 5.7.5 起默认开启，8.0 亦如此",
        "WHERE 在分组前删行、不能写聚合；HAVING 在分组后删组、可用聚合",
        "多列分组 = 按列组合产生每组一行，同样遵守 ONLY_FULL_GROUP_BY",
        "GROUP_CONCAT 是 MySQL 扩展，把组内值拼成字符串，受 group_concat_max_len 限制",
        "COUNT(*) 数行；COUNT(col) 数非 NULL；COUNT(DISTINCT col) 数非空去重后个数",
        "WITH ROLLUP 会追加总计/小计行（可选知识）"
      ]
    }
  ]
};
