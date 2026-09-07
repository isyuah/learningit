/* ==================================================================
 * 课时：覆盖索引、索引下推与失效陷阱（mysql-index-advanced）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-index-advanced",
  courseSlug: "database-mysql",
  title: "覆盖索引、索引下推与失效陷阱",
  summary: "用覆盖索引免回表、用索引下推减少回表，并识别导致索引失效的常见写法。",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前面我们反复提到「回表很贵」。这一课给出两个直接优化它的武器——覆盖索引（covering index）与索引下推（index condition pushdown, ICP，MySQL 5.6+），然后集中破解最常见的「索引失效陷阱」，把你在真实业务里一定会撞上的坑提前排掉。",
    },
    {
      type: "heading",
      text: "覆盖索引：把需要的列也放进二级索引，就不回表",
    },
    {
      type: "paragraph",
      text: "回表的唯一原因是「二级索引里没有查询要的全部列」。那如果查询需要的列已经都在二级索引的叶子里呢？就不必再回表取整行了。所谓覆盖索引，就是「这个二级索引包含了查询需要的所有列，因此这次查询可以完全不回表」。注意：覆盖指的是「当前这条查询被覆盖」，而不是索引本身有一个独立属性。",
    },
    {
      type: "code",
      title: "覆盖索引：免回表",
      language: "sql",
      code: "-- orders 表有组合索引 (user_id, status, created_at)\n-- 这条查询只需要 user_id、status、created_at 三列，全在索引里\nSELECT user_id, status, created_at\nFROM orders\nWHERE user_id = 42 AND status = 'paid';\n\n-- 二级索引叶子 = (user_id, status, created_at, 主键 id)\n-- 需要的三列都在 → 直接在索引树里读，不用回到聚簇索引 → 覆盖索引",
    },
    {
      type: "paragraph",
      text: "覆盖索引为什么快？因为二级索引的叶子页本来就比聚簇索引的整行页更紧凑，同一页能放更多索引项；更重要的是它完全免去了「按主键回表」这步每行一次的（可能随机的）页读取。代价是索引要包含更多列，写放大和空间占用增加。所以是「用空间和写入成本换读取速度」——对高频只读某几列的查询非常划算。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "避免 SELECT * 打断覆盖",
      body: "`SELECT *` 需要所有列（包括整行的全部字段），几乎没有二级索引能覆盖它，必然触发回表。若只想取两三列、又希望走覆盖索引，就明确列出需要的列，而不是 `SELECT *`。这是覆盖索引在工程上的最常见的被摧毁方式。",
    },
    {
      type: "heading",
      text: "索引下推（ICP）：在存储引擎里先过滤，少回表",
    },
    {
      type: "paragraph",
      text: "回表次数 = 命中行数。能不能先「缩小命中集合」再回表？索引下推（ICP）就是这个思路，MySQL 5.6+ 引入。理解它需要先看没有 ICP 时发生什么（5.6 之前的行为）：查询在二级索引里定位到一批候选行，直接把每个候选行的主键拿去做回表取整行，最后才在服务层用 WHERE 里「那些不在索引列/不在已用部分上」的条件过滤——于是凡是「其实不满足最终条件」的行，也都白回表了一次。ICP 把这些过滤动作**下推到存储引擎**：引擎在二级索引叶子上、回表之前，先把能用索引列判断的条件过滤掉，只对真正可能满足的行回表。",
    },
    {
      type: "code",
      title: "一个带索引列但没用满前缀的例子：ICP 登场",
      language: "sql",
      code: "-- 索引 (user_id, status, created_at)\n-- WHERE 里 user_id 是等值，status 也给了——但注意 created_at 排序/过滤场景\n\n-- 经典 ICP 案例：组合索引里中间列用了范围，后面的列过滤靠下推\n-- 索引 (user_id, status, created_at)\nSELECT *\nFROM orders\nWHERE user_id = 42 AND status = 'paid' AND created_at > '2025-01-01';\n\n-- user_id、status 都参与定位；created_at 是范围条件\n-- 有 ICP：存储引擎在叶子页上就用 created_at 边界过滤掉不满足的行，只回表可能命中的",
    },
    {
      type: "paragraph",
      text: "判断一个查询是否真的用了 ICP，看 EXPLAIN 的 Extra 列是否出现 `Using index condition`（注意它和 `Using index` 不是一回事，EXPLAIN 课会区分）。ICP 没有让「最终结果变少」——结果集本来就是这样；它让「回表的次数变少」，因为被过滤掉的那部分行没有白做回表。",
    },
    {
      type: "callout",
      variant: "note",
      title: "两个易混的 EXPLAIN 标记",
      body: "`Using index`（真覆盖，不回表）与 `Using index condition`（用了 ICP，回表次数减少但没有消除回表）是两码事。前者更优。别在面试里把它们当同义。",
    },
    {
      type: "heading",
      text: "索引失效陷阱：为什么明明有索引却不走",
    },
    {
      type: "paragraph",
      text: "很多时候不是没建索引，而是查询写法让优化器用不上。下面是高频的几类，以及改写方法。其中第 1 条 LIKE 我们按标准规则讲，并给出更精确的边界说明。",
    },
    {
      type: "table",
      caption: "常见索引失效写法与改写",
      headers: ["写法", "为什么失效", "如何改写 / 说明"],
      rows: [
        ["LIKE '%keyword'（前导通配）", "前缀不确定，叶子有序性用不上，无法在树上剪枝", "改成前缀匹配 LIKE 'keyword%'；不得已时权衡（靠 ICP/覆盖索引可能部分缓解，但不保证）"],
        ["对索引列套函数：WHERE DATE(created_at)='2025-01-01'", "列被函数加工后，树里存的是原值，无法按加工结果下探", "改成范围：created_at >= '2025-01-01' AND created_at < '2025-01-02'"],
        ["隐式类型转换：WHERE user_id = '42' 且列是整数", "列被隐式转换后无法利用原值排序/比较的二分", "传正确类型，或显式 CAST 到列类型一侧"],
        ["OR 中有一侧无索引：a = 1 OR b = 2", "任一分支没索引就难合并成一次索引扫描，倾向全表", "改写为 UNION ALL 两个分别走索引的查询，或尽量让每侧都有可用索引"],
        ["NOT IN / != 等否定条件", "范围性差，往往选择性低，优化器常选择全表", "按实际数据判断；可尝试改写为等价的正向条件或范围"],
      ],
    },
    {
      type: "paragraph",
      text: "关于前导通配 `LIKE '%x'`，标准规则是：**前导通配导致索引无法用于精确定位扫描**，通常退化为全表或大范围扫描。严格地说，在特定条件下（如覆盖索引场景、或启用 ICP 且能下推）MySQL 仍可能减少读取，所以不要宣称「100% 绝对失效」——但业务上应把它当作「不值得依赖索引」的写法，能改成前缀匹配就改。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "失效的核心判据：列被「加工」或「前缀不确定」",
      body: "索引能不能用，本质看能否沿有序的键值剪枝。凡是「让键值失去有序可定位性」的写法——对列套函数、类型转换、前导通配、否定/OR 拆分支——都会失效。把 WHERE 的每一列都问一句「这是不是直接拿原始列在比大小/等值」，能帮你快速排雷。",
    },
    {
      type: "heading",
      text: "外键列建索引是好实践",
    },
    {
      type: "paragraph",
      text: "最后补一个工程习惯：**凡是外键（以及频繁 JOIN 的连接列）应该建索引**。MySQL 的 InnoDB 虽然并不强制要求外键必须有索引，但外键列常被用于关联查询和级联删除，若不索引，JOIN 时每次探测都可能在子表里全表扫描。所以在 `order_item.product_id`、`orders.user_id` 这类外键列上建立索引（这里的 `user_id`、`order_id` 在示例表定义里已经带上了 KEY），是低成本高回报的做法。",
    },
    {
      type: "code",
      title: "为外键/连接列补索引",
      language: "sql",
      code: "-- order_item.product_id 是外键，且 JOIN product 常用\nCREATE INDEX idx_product ON order_item (product_id);\n\n-- like：orders.user_id、order_item.order_id 已带 KEY idx_user / idx_order\n-- 这样 JOIN 从 orders 到 order_item、或从 order_item 到 product 都能走索引",
    },
    {
      type: "quiz",
      question: "关于覆盖索引，下列说法正确的是？",
      options: [
        "只要给表建了二级索引，就一定是覆盖索引",
        "当查询需要的所有列都在二级索引的叶子中时，可免回表、直接在索引上完成查询",
        "覆盖索引仍然需要每次回表取完整行",
        "覆盖索引会显著增加回表次数",
      ],
      answer: 1,
      explanation: "覆盖索引是指「当前查询需要的列已全部在二级索引叶子里」，因此不用回表到聚簇索引。",
    },
    {
      type: "quiz",
      question: "索引下推（ICP）最核心的作用是？",
      options: [
        "把回表后的结果再排序一次",
        "把能用索引列判断的条件下推到存储引擎，在回表前先过滤，从而减少回表次数",
        "让所有查询都不再需要索引",
        "把整行的数据预先缓存到内存",
      ],
      answer: 1,
      explanation: "ICP（MySQL 5.6+）把部分 WHERE 条件下推到存储引擎，在二级索引叶子上、回表前先过滤，减少不必要的回表，EXPLAIN Extra 显示 Using index condition。",
    },
    {
      type: "exercise",
      title: "修复一个索引失效的查询",
      description: "给定 `SELECT * FROM orders WHERE DATE(created_at) = '2025-03-15' AND status = 'completed';` 在有 (status, created_at) 索引时分析为何可能失效，并改写成能利用索引范围的等价形式，说明改写前后各会怎么扫数据。",
      hint: "DATE() 让 created_at 失去有序定位能力；改成 `created_at >= '2025-03-15 00:00:00' AND created_at < '2025-03-16 00:00:00'`。",
    },
    {
      type: "keypoints",
      items: [
        "覆盖索引 = 查询所需列都在二级索引叶子里 → 免回表",
        "SELECT * 常会破坏覆盖，明确列出所需列",
        "索引下推（ICP，MySQL 5.6+）把索引列条件下推到存储引擎，回表前过滤、减少回表（Extra: Using index condition）",
        "失效套路：前导通配 LIKE、列套函数、隐式类型转换、OR 缺索引、NOT IN/!= 等",
        "外键与 JOIN 连接列应建索引",
      ],
    },
  ],
};
