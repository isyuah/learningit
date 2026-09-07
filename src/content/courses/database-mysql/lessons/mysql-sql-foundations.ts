/* ==================================================================
 * 课时：SQL 基础快速回顾：CRUD、过滤、聚合与 JOIN（mysql-sql-foundations）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-sql-foundations",
  courseSlug: "database-mysql",
  title: "SQL 基础快速回顾：CRUD、过滤、聚合与 JOIN",
  summary: "快速刷新 CRUD 与查询基础，重点放在易错陷阱。",
  minutes: 22,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "这一节不是从头教你 SQL——你已经会 CRUD、过滤、排序、聚合、JOIN 和 GRANT。这节是「带陷阱的快速刷新」：把基础能力过一遍，同时在每一个容易踩坑的地方停一下，讲清为什么。因为后面所有高级查询、索引和优化的讨论，都建立在「你会不会把基础查询写对」之上。先备好一份示例数据。",
    },
    {
      type: "code",
      title: "示例数据：先跑起来",
      language: "sql",
      code: "CREATE TABLE product (\n    id BIGINT AUTO_INCREMENT PRIMARY KEY,\n    name VARCHAR(64), category VARCHAR(32),\n    price DECIMAL(10,2), stock INT, created_at DATETIME\n) ENGINE = InnoDB;\n\nINSERT INTO product (name, category, price, stock) VALUES\n    ('无线机械键盘', '数码', 399.00, 120),\n    ('机械键盘轴体', '数码', 45.00, 800),\n    ('便携充电宝',   '数码', 129.00, 0),\n    ('纯棉T恤',     '服饰', 59.00, 300),\n    ('帆布鞋',       NULL, 199.00, 60);  -- 注意 category 为 NULL 的行",
    },
    {
      type: "heading",
      text: "CRUD：增删改查的收尾细节",
    },
    {
      type: "paragraph",
      text: "你会写 INSERT / SELECT / UPDATE / DELETE，这里只补三个「容易漏」的关键点。其一，`INSERT` 可以指定列，也可以一次插多行；其二，`UPDATE` 和 `DELETE` 如果不带 WHERE 会作用于全表——这是生产事故的头号来源；其三，`UPDATE ... SET` 的顺序不影响结果，但 WHERE 必须写对。",
    },
    {
      type: "code",
      title: "常用 CRUD 收尾写法",
      language: "sql",
      code: "INSERT INTO product (name, category, price, stock) VALUES\n    ('保温杯', '家居', 89.00, 200),\n    ('雨伞',   '家居', 39.00, 150);\n\nUPDATE product SET stock = stock - 2 WHERE name = '保温杯';  -- 一定要带 WHERE\n\nDELETE FROM product WHERE id = 999;  -- 删不存在的行，不报错，只是影响 0 行\n\nSELECT * FROM product;  -- 查全表（小表可接受）",
    },
    {
      type: "callout",
      variant: "warning",
      title: "UPDATE/DELETE 不带 WHERE = 全表操作",
      body: "`UPDATE product SET stock = 0` 会把所有商品的库存清零；`DELETE FROM product` 会清空整张表。写生产环境的修改语句前，先 `SELECT` 一遍确认 WHERE 选中的正是你要动的那几行。这是 DBA 与工程师都要遵守的习惯。",
    },
    {
      type: "heading",
      text: "WHERE 过滤：LIKE、IN、BETWEEN 与 NULL",
    },
    {
      type: "paragraph",
      text: "过滤是把「行」缩小到「你要的行」。除了等值 `=` 和比较 `<`、`>`，你高频使用的还有三类：`LIKE` 做模糊匹配、`IN` 做列表匹配、`BETWEEN` 做范围匹配。但这里藏着 SQL 最经典的一个坑：**NULL 不是任何值**，任何与 NULL 的比较（包括 `=` 和 `<>`）结果都是「未知」（unknown），而 WHERE 只保留「为真」的行。",
    },
    {
      type: "code",
      title: "过滤语法对比",
      language: "sql",
      code: "-- LIKE：% 匹配任意多字符，_ 匹配单个字符\nSELECT name FROM product WHERE name LIKE '%键盘%';\n-- 结果：无线机械键盘、机械键盘轴体\n\n-- IN：列表匹配\nSELECT name FROM product WHERE category IN ('数码','服饰');\n\n-- BETWEEN：闭区间，包含两端\nSELECT name FROM product WHERE price BETWEEN 50 AND 200;\n\n-- 注意 WHERE category = NULL 查不到东西！必须用 IS NULL / IS NOT NULL\nSELECT name FROM product WHERE category = NULL;     -- 空结果（错误用法）\nSELECT name FROM product WHERE category IS NULL;    -- 正确：得到 '帆布鞋'\nSELECT name FROM product WHERE category IS NOT NULL; -- 得到所有有分类的商品",
    },
    {
      type: "callout",
      variant: "warning",
      title: "三值逻辑：TRUE / FALSE / UNKNOWN",
      body: "SQL 用的是三值逻辑。`NULL = NULL` 不是 TRUE，而是 UNKNOWN；`NULL = 1` 也是 UNKNOWN。所以判断「为空」必须用 `IS NULL` / `IS NOT NULL`，判断相等不要用 `= NULL`。这个坑在 WHERE、JOIN ON、CASE 和聚合里都以不同形式出现，务必牢记。",
    },
    {
      type: "heading",
      text: "ORDER BY 与 LIMIT：排序与取前 N 条",
    },
    {
      type: "paragraph",
      text: "排序在查询结果最终返回前进行，`ORDER BY` 支持多列与升降序，`LIMIT` 取前 N 条。注意两点：当你想按某列降序排时是 `DESC`；当 NULL 参与排序时，MySQL 默认把 NULL 排在前面（升序时）。另外 `LIMIT offset, count` 中 offset 的语义是跳过前面多少行——这是分页的基础，但 offset 很大的分页在后续章节会有性能问题。",
    },
    {
      type: "code",
      title: "排序与分页",
      language: "sql",
      code: "SELECT name, price FROM product\nORDER BY price DESC        -- 价格从高到低\nLIMIT 3;                    -- 只取前 3 条\n\n-- 多列排序：先按 category 升序，同 category 再按 price 降序\nSELECT name, category, price FROM product\nORDER BY category ASC, price DESC;\n\n-- 分页：跳过前 2 行取 3 行（第三页的前 3 条，每页 3 条时）\nSELECT name, price FROM product\nORDER BY price DESC\nLIMIT 2, 3; -- 等价于 LIMIT 3 OFFSET 2",
    },
    {
      type: "heading",
      text: "聚合 + GROUP BY + HAVING：分组之后如何过滤",
    },
    {
      type: "paragraph",
      text: "聚合函数（COUNT / SUM / AVG / MAX / MIN）把多行合并成一个值。`GROUP BY` 按某列分组，让聚合函数在「每个组」里分别计算。这里有一个贯穿 SQL 的核心区分：**WHERE 在分组之前过滤行，HAVING 在分组之后过滤组**。这个顺序不是语法巧合，而是语义本质——WHERE 不能引用聚合结果（因为分组还没发生），HAVING 可以。",
    },
    {
      type: "code",
      title: "GROUP BY 与 HAVING：WHERE 先用，HAVING 后用",
      language: "sql",
      code: "-- 按分类统计商品数与平均价\nSELECT category,\n       COUNT(*)  AS cnt,\n       AVG(price) AS avg_price\nFROM product\nWHERE category IS NOT NULL          -- 先过滤行：排除 NULL 分类\nGROUP BY category;                  -- 再分组聚合\n\n-- 想筛「平均价 > 100 的分类」：必须用 HAVING，WHERE 做不到\nSELECT category, AVG(price) AS avg_price\nFROM product\nGROUP BY category\nHAVING AVG(price) > 100; -- HAVING 在分组后过滤组，可引用聚合结果",
    },
    {
      type: "callout",
      variant: "warning",
      title: "WHERE 与 HAVING 别用反",
      body: "面试高频陷阱：`WHERE` 针对「行」，发生在分组之前；`HAVING` 针对「组」，发生在分组之后。把 `WHERE AVG(price) > 100` 这样写会直接报错（WHERE 里不能出现聚合），而把本该在 HAVING 里写的行级过滤放进去又可能得到错误的组粒度结果。原则：能放 WHERE 的尽量放 WHERE，因为它先执行、可用索引、结果更小。",
    },
    {
      type: "heading",
      text: "JOIN：INNER / LEFT / RIGHT 与 ON",
    },
    {
      type: "paragraph",
      text: "JOIN 把多张表的行按某种联系拼在一起。三种你都需要掌握：`INNER JOIN` 只保留两边都匹配的行；`LEFT JOIN` 保留左边全部行，右边没有匹配时用 NULL 填充；`RIGHT JOIN` 反之。联系条件写在 `ON` 里。用 shop 库来演示，注意 ON 的语义决定「要不要保留哪一边的行」。",
    },
    {
      type: "code",
      title: "INNER / LEFT / RIGHT JOIN 对比",
      language: "sql",
      code: "-- 订单与用户：列出每个订单及其用户\nSELECT o.id, o.total_amount, u.name\nFROM orders o\nINNER JOIN user u ON o.user_id = u.id;   -- 只有两边都匹配的行\n\n-- LEFT JOIN：即使某用户没有订单也保留该用户，订单列填 NULL\nSELECT u.id, u.name, o.id AS order_id\nFROM user u\nLEFT JOIN orders o ON o.user_id = u.id;\n-- user 里有但 orders 里没有对应订单的行，order_id 为 NULL\n\n-- 找「没下过单的用户」：LEFT JOIN + IS NULL 过滤\nSELECT u.id, u.name\nFROM user u\nLEFT JOIN orders o ON o.user_id = u.id\nWHERE o.id IS NULL;",
    },
    {
      type: "callout",
      variant: "warning",
      title: "ON 条件 与 WHERE 过滤的执行顺序",
      body: "对 INNER JOIN 来说，把过滤条件放 ON 还是 WHERE，结果通常一样；但对 LEFT JOIN 并不一样——ON 决定「要不要连接」，WHERE 决定「连接完成后要不要这个结果行」。把 `WHERE o.status = 'paid'` 加在 LEFT JOIN 之后，等于把右表没匹配的行（status 为 NULL）也过滤掉，LEFT 就退化成了 INNER。想保留左表全部行，条件应放 ON 里。",
    },
    {
      type: "heading",
      text: "DCL 回顾：GRANT / REVOKE",
    },
    {
      type: "paragraph",
      text: "你已经知道可以用 GRANT 授权、REVOKE 收回权限。这里只快速对齐三件事，完整的安全主题在「工程实践」章节展开。其一，权限粒度可以是库级、表级甚至列级；其二，`FLUSH PRIVILEGES` 在 8.0 里多数情形已不需要（用了 `CREATE USER` / `GRANT` 直接生效），但了解它不碍事；其三，务必区分「创建用户」与「授权」——8.0 中 `GRANT` 不再自动建用户。",
    },
    {
      type: "code",
      title: "GRANT / REVOKE 快速回顾",
      language: "sql",
      code: "-- 授权：给账号 reporter 在 shop 库的只读权限\nGRANT SELECT ON shop.* TO 'reporter'@'%';\n\n-- 收回权限\nREVOKE SELECT ON shop.* FROM 'reporter'@'%';\n\n-- 查看权限（8.0 语法）\nSHOW GRANTS FOR 'reporter'@'%';\n\n-- 8.0：GRANT 不再自动创建用户，需先 CREATE USER\n-- 8.0 中权限管理语句即时生效，通常无需 FLUSH PRIVILEGES",
    },
    {
      type: "heading",
      text: "两个最常见的隐式陷阱",
    },
    {
      type: "paragraph",
      text: "收尾前讲两个最容易被忽略、却常在真实项目和面试里翻车的点：字符串与数字比较、隐式类型转换。理解它们能帮你把「看起来对了但其实在踩坑」的查询一眼识破。",
    },
    {
      type: "subheading",
      text: "陷阱一：字符串与数字比较",
    },
    {
      type: "paragraph",
      text: "比较 `'5'` 和一个数字时，MySQL 会做隐式转换。若某列是字符串类型却与数字比较，MySQL 可能把字符串转成数字比较——这会丧失走该列索引的能力，还可能产生意外结果。反过来，数字列与字符串比较也可能让优化器放弃数字列上的索引。原则是：列的类型与字面量的类型保持一致，别让优化器替你做转换。",
    },
    {
      type: "code",
      title: "隐式转换示例",
      language: "sql",
      code: "-- stock 是 INT，对比时给字符串数字，可能触发隐式转换、影响索引使用\nSELECT name FROM product WHERE stock = '120';    -- 可能类型转换\nSELECT name FROM product WHERE stock = 120;      -- 更好：类型一致，走索引\n\n-- 更隐蔽：某 VARCHAR 列与数字比较，会转成数字再比，导致非预期结果\n-- 例如 name = '20240101abc' 这种混合字符串，与 2024 比较时行为可能反直觉",
    },
    {
      type: "subheading",
      text: "陷阱二：字符串里的数字排序不是数字排序",
    },
    {
      type: "paragraph",
      text: "如果你把「看起来是数字」的数据存成了字符串（VARCHAR），`ORDER BY col` 会按字典序排而不是按数值排：'10' 会排在 '9' 前面。这不是 bug，而是类型语义。想按数字排，要么用数字类型存储，要么 `ORDER BY CAST(col AS SIGNED)`。这也是「字段设计选择」要解决的问题——类型选错了，查询怎么都别扭。",
    },
    {
      type: "code",
      title: "字典序 vs 数值序",
      language: "sql",
      code: "-- 若存在一张 VARCHAR 列存编号 code，数值为 1,2,10:\n-- ORDER BY code 的结果是 1, 10, 2（字典序）而非 1,2,10\n-- 期望按数值排：\nSELECT * FROM t ORDER BY CAST(code AS SIGNED); -- 需要转换\n\n-- 结论：真正的编号应该用数字类型或固定宽度的字符串（如 '0001'）",
    },
    {
      type: "callout",
      variant: "note",
      title: "这一节为后面铺的路",
      body: "本节的 CRUD、过滤、聚合、JOIN 是「手电筒」——后面每一章（子查询、窗口函数、索引、事务、优化）都在此基础上加深度。如果你在 JOIN / NULL / WHERE vs HAVING / 隐式转换这些点仍能举例说明为什么，说明你已经有扎实的 Sql 直觉。",
    },
    {
      type: "quiz",
      question: "关于 WHERE 与 HAVING，下列说法正确的是？",
      options: [
        "WHERE 在分组之后过滤组，HAVING 在分组之前过滤行",
        "WHERE 在分组之前过滤行，HAVING 在分组之后过滤组",
        "WHERE 与 HAVING 完全等价，可互换",
        "HAVING 不能引用聚合函数",
      ],
      answer: 1,
      explanation:
        "WHERE 对行过滤，发生在分组之前，因此不能引用聚合结果；HAVING 对组过滤，发生在分组之后，可以引用聚合函数（如 AVG(price)）。",
    },
    {
      type: "quiz",
      question: "想要找到「user 表中所有没下过单的用户」，正确写法是？",
      options: [
        "INNER JOIN orders 并过滤 o.id 非空",
        "LEFT JOIN orders 并加 WHERE o.id IS NULL",
        "RIGHT JOIN orders 并加 WHERE u.id IS NULL",
        "直接用 WHERE user_id NOT IN (SELECT id FROM orders)",
        "以上 B 与 D 均可实现该需求",
      ],
      answer: 4,
      explanation:
        "LEFT JOIN 保留左表全部行，`WHERE o.id IS NULL` 挑出右边没匹配的行；也可以用 `NOT IN` 子查询。两者都可行（注意 NOT IN 碰到 NULL 的细节本课未展开）。本题考查 LEFT JOIN + IS NULL 的经典写法。",
    },
    {
      type: "exercise",
      title: "找出 NULL 与 HAVING 的组合陷阱",
      description:
        "用 shop 库的 product 表写一条查询：统计「每个分类的商品数量」，逻辑上只想统计有分类（category 非空）的商品，再筛选出「商品数 > 1」的分类。请写出同时正确使用 WHERE 与 HAVING 的完整语句，并解释为什么把分类过滤放在 HAVING 里（而不放 WHERE）结果是错的。",
      hint: "行级过滤放 WHERE：`WHERE category IS NOT NULL`；组级过滤放 HAVING：`HAVING COUNT(*) > 1`。",
    },
    {
      type: "keypoints",
      items: [
        "UPDATE/DELETE 必须带 WHERE，否则作用全表",
        "NULL 参与比较结果都是 UNKNOWN，判空用 IS NULL / IS NOT NULL",
        "WHERE 在分组前过滤行，HAVING 在分组后过滤组",
        "LEFT JOIN 的过滤条件放 ON 保左表全部行，放 WHERE 会把 NULL 行滤掉",
        "避免字符串与数字的隐式类型转换，保持列类型与字面量一致",
        "表存数字类数据用数字类型，否则排序会按字典序",
      ],
    },
  ],
};
