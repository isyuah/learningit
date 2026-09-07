/* ==================================================================
 * 课时：窗口函数：排行、累计与跨行计算（mysql-window-functions）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-window-functions",
  "courseSlug": "database-mysql",
  "title": "窗口函数：排行、累计与跨行计算",
  "summary": "理解窗口函数相对 GROUP BY 解决了什么，掌握 ROW_NUMBER / RANK / DENSE_RANK / SUM / LAG / LEAD 与移动平均。",
  "minutes": 22,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "上一课我们用 CTE + 子查询解决了「每个分类销量最高」。这类「在每个组内做排行、累计、跨行对比」的需求，用聚合和子查询写起来总是很绕。MySQL 从 8.0 开始提供了**窗口函数（Window Functions）**，它解决的核心问题是：**在保留每一行原始细节的同时，对每一行计算一个基于它所在「窗口」（一组行）的聚合或排行值**。这一课讲透它，你会发现在 8.0 上很多题可以一行窗口函数秒掉。"
    },
    {
      "type": "heading",
      "text": "窗口函数解决了什么：GROUP BY 做不到的事",
    },
    {
      "type": "paragraph",
      "text": "GROUP BY 的问题是它会**折叠行**：一旦按某列聚合，非分组的原始行就消失了，你只能看到「每组一行」的汇总。而业务里经常需要「既有每一行的明细，又把它和同组兄弟列比较」——例如「每个用户订过哪些单，且每单在全库排第几」「每个月的累计销售额，且保留每日明细」。这需要两类信息并存，GROUP BY 天生做不到。窗口函数就是在行的基础上追加一列「根据窗口算出来的值」，原始行一条不丢。"
    },
    {
      "type": "table",
      "caption": "GROUP BY 聚合 vs 窗口函数",
      "headers": ["维度", "GROUP BY 聚合", "窗口函数 (OVER)"],
      "rows": [
        ["输出行数", "每组一行（折叠）", "每一行都保留，原样输出"],
        ["能否访问原行细节", "不能，只能访问分组列与聚合函数", "可以，同时拿到窗口计算值"],
        ["典型场景", "每用户订单总数、每分类销售额", "排行、累计、移动平均、跨行差值"],
        ["所需 MySQL 版本", "所有版本", "仅 MySQL 8.0 及以上"],
        ["是否与聚合函数交集", "是聚合（SUM/COUNT/AVG）", "聚合函数也可用在 OVER 里，语义成窗口计算"]
      ]
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "窗口函数需要 MySQL 8.0",
      "body": "窗口函数（ROW_NUMBER、RANK、DENSE_RANK、LAG、LEAD 及带 OVER 的 SUM/COUNT/AVG）是 **8.0 新增能力，5.7 及更早版本完全没有**。在 5.7 上实现「每组取前 N」「累计值」只能用子查询、派生表或用户变量这类绕法。面试务必先确认 MySQL 版本再谈窗口函数。"
    },
    {
      "type": "heading",
      "text": "语法骨架：函数() OVER (PARTITION BY ... ORDER BY ...)",
    },
    {
      "type": "paragraph",
      "text": "窗口函数的通用结构是 `函数() OVER (窗口定义)`。其中：`PARTITION BY` 把行分成若干「窗」（类似分组，但不折叠行，没有 PARTITION BY 就忽略整个结果集为一个大窗）；`ORDER BY` 决定窗内行计算的顺序（对 SUM/AVG 这类累积型计算、以及对 RANK 等排行函数是必需的）。结果里每一行都会携带它所属窗口计算出的那个值。"
    },
    {
      "type": "code",
      "title": "不加 PARTITION 的全局与按用户的累计下单金额",
      "language": "sql",
      "code": "-- 每个用户的累计消费（按 created_at 排序累加）\nSELECT u.name, o.created_at, o.total_amount,\n       SUM(o.total_amount) OVER (\n           PARTITION BY o.user_id\n           ORDER BY o.created_at, o.id\n       ) AS running_total\nFROM orders o\nJOIN user u ON u.id = o.user_id\nWHERE o.status <> 'cancelled'\nORDER BY u.id, o.created_at;"
    },
    {
      "type": "paragraph",
      "text": "注意上面的 `running_total` 是**运行累计（running total）**：在窗口内按 ORDER BY 的顺序，从第一行加到当前行。这是窗口 `SUM ... OVER (PARTITION BY ... ORDER BY ...)` 与普通 `SUM ... GROUP BY` 的本质区别——一个带顺序地累加，一个不分顺序地整体求和。排序键里带上 `o.id` 是为了在 created_at 相同的情况下给出确定顺序（否则并列时间戳下累计可能不稳定）。"
    },
    {
      "type": "heading",
      "text": "排行三大件：ROW_NUMBER / RANK / DENSE_RANK",
    },
    {
      "type": "paragraph",
      "text": "三者都给窗口内的行编号，区别在于如何处理「并列（tie）」。`ROW_NUMBER` 给每行唯一编号，即使值相同也会按顺序编出 1、2、3、4；`RANK` 并列时相同值共享名次，且**后续名次会跳空**（如 1、1、3、4）；`DENSE_RANK` 并列也共享名次，但**不跳空**（如 1、1、2、3）。选哪个取决于「要不要有并列、要不要跳空」。"
    },
    {
      "type": "code",
      "title": "三种排名对比：按消费金额给用户排行",
      "language": "sql",
      "code": "WITH user_spend AS (\n    SELECT u.id, u.name, SUM(o.total_amount) AS amount\n    FROM orders o\n    JOIN user u ON u.id = o.user_id\n    WHERE o.status <> 'cancelled'\n    GROUP BY u.id, u.name\n)\nSELECT name, amount,\n       ROW_NUMBER() OVER (ORDER BY amount DESC) AS row_no,\n       RANK()       OVER (ORDER BY amount DESC) AS rk,\n       DENSE_RANK() OVER (ORDER BY amount DESC) AS dense_rk\nFROM user_spend\nORDER BY amount DESC;"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "怎么选排名函数",
      "body": "需求明确说「每人一个唯一序号、不关心并列」选 ROW_NUMBER；说「前 3 名 / 第几名」且允许并列跳空，选 RANK；说「并列同分同段、往后不跳号」选 DENSE_RANK。经典题「每个用户第 N 次下单」几乎总是用 ROW_NUMBER 先编号再取 = N，因为它给每行唯一且确定的序号。"
    },
    {
      "type": "heading",
      "text": "经典实战：每个用户的下单次数排名（取每组第 N）",
    },
    {
      "type": "paragraph",
      "text": "「每个用户最近 / 第几笔订单」这类「组内取前 N」问题是窗口函数最典型的用途，也是面试高频题。套路是：先用 ROW_NUMBER 按用户分区、按下单时间排序编号，再把结果包一层 WHERE 取编号 = N。注意窗口函数不能直接写在 WHERE 里（WHERE 在窗口计算之前执行），所以必须套一层派生表或 CTE。"
    },
    {
      "type": "code",
      "title": "每个用户最近一笔订单（组内取第一条）",
      "language": "sql",
      "code": "WITH numbered AS (\n    SELECT o.id, o.user_id, o.total_amount, o.created_at,\n           ROW_NUMBER() OVER (\n               PARTITION BY o.user_id\n               ORDER BY o.created_at DESC, o.id DESC\n           ) AS rn\n    FROM orders o\n    WHERE o.status <> 'cancelled'\n)\nSELECT user_id, id AS latest_order_id, total_amount, created_at\nFROM numbered\nWHERE rn = 1\nORDER BY user_id;"
    },
    {
      "type": "paragraph",
      "text": "`PARTITION BY o.user_id` 把每个用户的订单放进自己的窗，`ORDER BY created_at DESC` 让最近的在最前，于是 `rn = 1` 就是每个用户最近的那单。改 `WHERE rn <= 3` 就变成「每个用户最近三单」。这是一套可复用的范式。"
    },
    {
      "type": "heading",
      "text": "跨行访问：LAG / LEAD",
    },
    {
      "type": "paragraph",
      "text": "除了对整窗/累计做计算，窗口函数还能**跨行取值**：`LAG(列, n)` 取窗口内按顺序往前第 n 行的值，`LEAD(列, n)` 取往后第 n 行的值，默认 n=1。这非常适合「相邻两行对比」——例如计算每笔订单与上一笔订单的金额差、或与上一期相比的环比。"
    },
    {
      "type": "code",
      "title": "相邻订单金额差：LAG 与 LEAD",
      "language": "sql",
      "code": "SELECT o.id, o.user_id, o.total_amount, o.created_at,\n       LAG(o.total_amount) OVER (\n           PARTITION BY o.user_id ORDER BY o.created_at, o.id\n       ) AS prev_amount,\n       o.total_amount - LAG(o.total_amount) OVER (\n           PARTITION BY o.user_id ORDER BY o.created_at, o.id\n       ) AS diff_from_prev,\n       LEAD(o.created_at) OVER (\n           PARTITION BY o.user_id ORDER BY o.created_at, o.id\n       ) AS next_order_time\nFROM orders o\nWHERE o.status <> 'cancelled'\nORDER BY o.user_id, o.created_at;"
    },
    {
      "type": "paragraph",
      "text": "没有上一个值的那行（每组的第 1 行），`LAG` 返回 NULL——`prev_amount` 为 NULL，diff 也是 NULL，这是预期行为而不是错误。用 COALESCE 可以把它替换成 0 或其他默认值，但要小心不要把「没有上一笔」和「上一笔真的是 0」混为一谈。"
    },
    {
      "type": "heading",
      "text": "移动平均：把窗口框起来",
    },
    {
      "type": "paragraph",
      "text": "默认的 `SUM/AVG ... OVER (PARTITION BY ... ORDER BY ...)` 是从窗的第一行累计到当前行（运行类型）。若要「只取当前行前后几行」的**移动窗口**，需要用显式的**帧（frame）**定义，例如 `ROWS BETWEEN 2 PRECEDING AND CURRENT ROW`（取当前及前两行）或 `ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING`。它让 SUM/AVG/COUNT 变成滑动窗口。"
    },
    {
      "type": "code",
      "title": "按时间求每日订单额的 3 日移动平均",
      "language": "sql",
      "code": "WITH daily AS (\n    SELECT DATE(created_at) AS day,\n           SUM(total_amount)  AS amount\n    FROM orders\n    WHERE status <> 'cancelled'\n    GROUP BY DATE(created_at)\n)\nSELECT day, amount,\n       AVG(amount) OVER (\n           ORDER BY day\n           ROWS BETWEEN 2 PRECEDING AND CURRENT ROW\n       ) AS moving_avg_3d\nFROM daily\nORDER BY day;"
    },
    {
      "type": "paragraph",
      "text": "帧（frame）只在「有 ORDER BY 的窗口」里才有意义：ORDER BY 给出了行的逻辑顺序，ROWS 帧在这个顺序上滑。帧的默认规则是 `RANGE UNBOUNDED PRECEDING`（从前到当前行，运行累计）；显式指定 ROWS 帧才能得到「前 N 行到后 M 行」的移动窗口。这是窗口函数里最容易忽略、也最常被面试追问的点。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "窗口函数别写在 WHERE 里",
      "body": "WHERE 在窗口计算之前执行，因此 `WHERE rn = 1`（rn 是窗口结果）会报「Unknown column」或语义错误。正确做法是：把窗口计算放进 CTE 或派生表，再在外层 WHERE 过滤。这是窗口函数使用中最常见的第一个坑。"
    },
    {
      "type": "quiz",
      "question": "对数据 [100, 200, 200, 300] 按金额降序排行（不分区、无并列序键外的区别），使用 ROW_NUMBER / RANK / DENSE_RANK 的三列结果分别是？",
      "options": [
        "1,2,3,4 / 1,2,2,4 / 1,2,2,3",
        "1,2,3,4 / 1,1,2,3 / 1,1,2,3",
        "1,2,2,4 / 1,1,2,3 / 1,2,2,3",
        "1,2,2,3 / 1,2,3,4 / 1,2,2,4"
      ],
      "answer": 0,
      "explanation": "按降序应为 [300,200,200,100]。ROW_NUMBER 给唯一编号 1,2,3,4；两个 200 并列，RANK 同为 2 且后续跳空（下一名是 4）；DENSE_RANK 同为 2 但不跳空（下一名是 3）。所以三列分别是 1,2,3,4 / 1,2,2,4 / 1,2,2,3，只有选项 A 符合。"
    },
    {
      "type": "exercise",
      "title": "每个商品销量最高的订单明细",
      "description": "在 shop 库写一条查询：列出「每个商品在销量（quantity）最高、若并列则取价格更低）的那一笔 order_item 明细」，并附上该 order_item 在该商品所有订单中的销量排名。用窗口函数实现，要求结果能直接回答「该商品卖得最好的那笔单是谁的」。",
      "hint": "先按 product_id 分区用 ROW_NUMBER 排序（quantity DESC, price ASC 做 tie-break），包一层取 rn=1；若想同时看排名，可再保留 RANK 列。"
    },
    {
      "type": "keypoints",
      "items": [
        "窗口函数保留每一行，同时按 PARTITION 窗计算一个值，不折叠行",
        "仅 MySQL 8.0 支持；5.7 没有窗口函数",
        "ROW_NUMBER 唯一编号；RANK 并列同号但跳空；DENSE_RANK 并列同号不跳空",
        "SUM/AVG OVER (PARTITION..ORDER..) 是运行累计；用 ROWS 帧做移动窗口",
        "LAG/LEAD 跨行取相邻值，缺行返回 NULL 可用 COALESCE 处理",
        "窗口结果不能直接进 WHERE，要套 CTE/派生表再过滤"
      ]
    }
  ]
};
