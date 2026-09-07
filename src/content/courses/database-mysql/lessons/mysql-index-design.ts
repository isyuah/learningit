/* ==================================================================
 * 课时：索引设计：最左前缀与如何为查询建索引（mysql-index-design）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-index-design",
  courseSlug: "database-mysql",
  title: "索引设计：最左前缀与如何为查询建索引",
  summary: "从真实查询出发选列、理解组合索引最左前缀、选择性，以及什么时候不该建索引。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "会建索引之后，更要会「该给哪几列建、建什么样的索引」。盲目建索引不但不省事，反而拖慢写入。这一课教你一套可复用的推理方法：从真实 SQL 出发，找出该被索引的列，理解组合索引的最左前缀规则与选择性，并识别「不该建索引」的情形。",
    },
    {
      type: "heading",
      text: "哪些列值得建索引：从一条真实查询出发",
    },
    {
      type: "paragraph",
      text: "判断要不要给某列建索引，最可靠的办法是看「真实要跑的 SQL」到底写了什么。同一个列在不同的查询里角色不同，价值也不同。我们把候选对象分成四类，优先级从上到下：",
    },
    {
      type: "list",
      items: [
        "WHERE 里的过滤列：例如 `WHERE user_id = 42`、`WHERE status = 'paid'`，直接决定要扫多少行，索引价值最高。",
        "JOIN 的连接列：例如 `order_item` 的 `order_id` 用来连 `orders`，给它建索引能避免驱动表对每行发起全表扫描（这在 EXPLAIN 课会看到 ref/ALL 的差别）。",
        "ORDER BY 的排序列：叶子有序，B+ 树能按索引键直接给出有序结果，避免额外文件排序（filesort）。",
        "GROUP BY、去重 DISTINCT (列) 等：因为索引键有序，很多聚合也能少排序。",
      ],
    },
    {
      type: "code",
      title: "从查询反推建索引",
      language: "sql",
      code: "-- 目标查询：按用户查他某状态下的订单\nSELECT id, total_amount\nFROM orders\nWHERE user_id = 42 AND status = 'paid'\nORDER BY created_at DESC;\n\n-- 反推：user_id（WHERE）、status（WHERE）、created_at（ORDER BY）都值得进索引\n-- 组合成下面这个（顺序见「最左前缀」）\nCREATE INDEX idx_user_status ON orders (user_id, status, created_at);",
    },
    {
      type: "heading",
      text: "组合索引与最左前缀规则",
    },
    {
      type: "paragraph",
      text: "一个索引可以包含多列，叫组合索引（composite index）。组合索引的关键规则是**最左前缀**（leftmost prefix）：索引 (a, b, c) 本质上是先按 a 排、a 相同再按 b 排、b 也相同再按 c 排。因此它能被用于查询首列 `a`、前两列 `a,b`、或前三列 `a,b,c`——凡是「从最左边开始、连续取」的前缀都能用；但如果查询不从 a 开始，或者跳过了中间某列，这个索引就只能用到「断点之前」的部分。",
    },
    {
      type: "table",
      caption: "索引 (a, b, c) 的可用性",
      headers: ["查询条件", "能用到的前缀", "说明"],
      rows: [
        ["WHERE a = ?", "a", "用满第 1 列"],
        ["WHERE a = ? AND b = ?", "a, b", "用满前 2 列"],
        ["WHERE a = ? AND b = ? AND c = ?", "a, b, c", "用满全部"],
        ["WHERE b = ? OR c = ?", "无", "首列 a 缺失，索引通常不可用（会全表扫描）"],
        ["WHERE a = ? AND c = ?", "a", "断在 b：b 缺失，无法继续用 c 下探"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "「断点」发生在中间列缺失时",
      body: "对索引 (a, b, c)，`WHERE a = ? AND c = ?` 只能用到 a。因为叶子的顺序是先按 a 再按 b 再按 c，跳过 b 直接约束 c，无法在下探时用 c 的边界去剪枝——c 只能在 a 命中的那一段里被逐个过滤（这属于「索引里过滤」的动作，后面讲解索引下推时会更精确）。",
    },
    {
      type: "heading",
      text: "最左前缀的一个判断捷径",
    },
    {
      type: "paragraph",
      text: "面试常问（a,b,c）能覆盖哪些查询。别死背，用一句话判断：**把 WHERE 条件按「索引列从左到右」的次序看，凡是能连续覆盖的前缀都能用；从第一个不满足等值的列开始就停（范围条件之后列也不继续匹配）。** 例如 `WHERE a = 1 AND b > 5 AND c = 3`：a 用等值继续，b 是范围，c 在 b 之后一般用不上这一层的精确定位（c 会被当作普通过滤而非索引精查）。这也解释了为什么工程上常把「等值列」放前面、「范围列」放后面。",
    },
    {
      type: "heading",
      text: "索引选择性（cardinality）",
    },
    {
      type: "paragraph",
      text: "一个索引好不好用，要看它能把目标「筛」得多窄。这用**选择性**（selectivity）衡量：选择性 = 该列的不同值数量（cardinality）/ 表总行数。选择性越接近 1，说明这一列取值越多样、每值对应的行越少，索引越「挑得动」，越值得放前面或被单独索引。",
    },
    {
      type: "table",
      caption: "用选择性判断列的位置",
      headers: ["例子", "cardinality 形象理解", "是否适合放组合索引最左"],
      rows: [
        ["user_id（每个用户多单，但值多样）", "不同用户很多 → 选择性高", "适合放最左，能快速缩窄范围"],
        ["status（只有 pending/paid/shipped/completed/cancelled 五种）", "不同值极少 → 选择性低", "单独不划算，一般放后面做辅助过滤"],
        ["created_at（几乎每行不同）", "不同值极多 → 选择性极高", "非常适合索引，但通常是范围列"],
      ],
    },
    {
      type: "paragraph",
      text: "所以一个实用指导：**组合索引里，把选择性最高的列放在最左边**。因为 B+ 树按最左列先排序，最左列越「挑得动」，下探时能剪掉的子树越多。把 `status`（就 5 种取值）放最左，往往一刀下去还是扫掉 1/5 的表，几乎没帮上忙。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "低选择性列「确实可以」放右边做覆盖/过滤",
      body: "说 status 选择性低，不等于绝不建索引。它是「不该单独放最左」，但可以放在组合索引右侧作为补充过滤，或用于覆盖索引（取它以满足查询所需列）。决策要结合真实查询，而不是见低选择性就一律不索引。",
    },
    {
      type: "heading",
      text: "什么时候不要建索引",
    },
    {
      type: "list",
      items: [
        "低选择性且没有别的作用：例如一个只有 true/false 的列，单独索引几乎不缩小范围，纯属浪费。",
        "表很小：几百行的小表，全表扫描一次代价极低，索引省下的 I/O 不值维护成本。",
        "写多读少、或写入很热的表：每次插入/更新都要同步维护每一个索引的 B+ 树，索引越多写越慢——要为写放大买单。",
        "几乎不被单独查询的列：索引若不服务于任何 WHERE/JOIN/ORDER BY，就是纯开销。",
      ],
    },
    {
      type: "heading",
      text: "SQL：CREATE / DROP / 组合索引",
    },
    {
      type: "code",
      title: "索引管理语法",
      language: "sql",
      code: "-- 普通索引\nCREATE INDEX idx_user ON orders (user_id);\n\n-- 组合索引（最左列放选择性最高的）\nCREATE INDEX idx_user_status ON orders (user_id, status, created_at);\n\n-- 唯一索引：约束唯一性，也同时是索引\nCREATE UNIQUE INDEX uk_email ON user (email);\n\n-- 删除索引\nDROP INDEX idx_user ON orders;\n\n-- 建表时在列定义后声明索引\nCREATE TABLE payment (\n  id BIGINT AUTO_INCREMENT PRIMARY KEY,\n  order_id BIGINT NOT NULL,\n  amount DECIMAL(10,2),\n  method VARCHAR(16),\n  paid_at DATETIME,\n  KEY idx_order (order_id)   -- 在 CREATE TABLE 里建普通索引\n);",
    },
    {
      type: "callout",
      variant: "warning",
      title: "先确认先例，再建索引",
      body: "建索引前先用 `EXPLAIN`（后面专门一课）验证这条查询现在是不是全表扫描、建了之后有没有走上索引。盲目照搬网上「通用索引清单」常会建出用不上的索引，反而在写入路径留下持续成本。索引是手段，服务于真实 SQL。",
    },
    {
      type: "quiz",
      question: "组合索引 (a, b, c) 中，`WHERE a = ? AND c = ?` 能用到索引的哪部分？",
      options: [
        "a 和 c 都能用于精确定位",
        "只用得到 a，c 因为中间的 b 缺失而无法继续下探",
        "一个都用不到",
        "只用得到 c",
      ],
      answer: 1,
      explanation: "最左前缀要求从最左边连续取前缀；c 前面缺了 b，断点之后无法用 c 继续定位，所以只用到 a。",
    },
    {
      type: "quiz",
      question: "组合索引的列顺序，通常应遵循什么原则？",
      options: [
        "把选择性低的列放在最左以节省空间",
        "把选择性最高、最常作为等值条件的列放在最左",
        "列顺序无所谓，MySQL 会自动优化",
        "永远按字母顺序排列列",
      ],
      answer: 1,
      explanation: "最左列先排序、承担最多剪枝，把选择性最高或最常等值查询的列放最左，能让索引更有效地缩窄扫描范围。",
    },
    {
      type: "exercise",
      title: "为真实查询设计组合索引",
      description: "给定查询 `SELECT * FROM order_item WHERE order_id = ? AND product_id = ?;`，请说明建 `(order_id, product_id)` 组合索引的原因，并指出如果只建 `(product_id)` 单独索引，这条查询会怎样，以及是否需要为 JOIN 场景额外建索引。",
      hint: "order_id 既承担 WHERE 等值过滤又是 JOIN 到 orders 的连接列，最左放它最常见；单列 product_id 无法覆盖 order_id 开头的查询。",
    },
    {
      type: "keypoints",
      items: [
        "从真实 SQL 出发：WHERE 过滤、JOIN 连接、ORDER BY / GROUP BY 的列最值得索引",
        "组合索引服从最左前缀：从最左连续取前缀才可用，中间缺列即断点",
        "组合索引列顺序：选择性最高、最常等值的列放最左，等值列优先于范围列",
        "低选择性、小表、写热、不被查询的列不适合建索引",
        "CREATE INDEX / CREATE UNIQUE INDEX / DROP INDEX 可管理索引",
      ],
    },
  ],
};
