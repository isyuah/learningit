/* ==================================================================
 * 课时：慢查询定位与优化流程（mysql-slow-query）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-slow-query",
  "courseSlug": "database-mysql",
  "title": "慢查询定位与优化流程",
  "summary": "从「先度量，再下手」出发，走完定位慢查询 → EXPLAIN 找元凶 → 修复 → 验证的系统化优化闭环。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "前面几章我们学了索引、EXPLAIN、事务与锁，都是为了一个目的：让数据库在不同数据量下依然快。但「让每条查询都快」本身是个陷阱——你不可能也不应该优化全部查询。真实项目里的正确做法是一个可重复的流程：先度量，找出真正慢的那几条，定位原因，修复，再验证。这一课就把这个「优化闭环」讲透，并且用一个电商订单库的真实例子带你把流程走一遍。"
    },
    {
      "type": "heading",
      "text": "第一原则：不要优化你还没有度量的东西"
    },
    {
      "type": "paragraph",
      "text": "一个很常见的错误是凭「感觉」优化：觉得某张表该加索引就加，觉得某条 SQL 慢就重写。这往往白忙一场，甚至把本来正常的查询改得更糟。优化的前提是「度量」——你得先知道：哪一条 SQL 慢？慢到什么程度？出现了多少次？占用了多少数据库资源？没有这些数字，你优化的是自己想象中的瓶颈，而不是系统真实的瓶颈。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "度量是起点，不是可选项",
      "body": "「先度量再优化」不是口号。没有基线数据，你既不知道优化是否有效，也不知道是否引入了回归。一个慢查询通常很少是「SQL 写错了」这么简单——它往往来自三类根源之一：缺少或误用了索引、数据量过大、锁竞争（事务/并发）。磨刀不误砍柴工，先用工具把问题找出来。"
    },
    {
      "type": "paragraph",
      "text": "MySQL 给出了两条定位慢查询的路径：一条是「事后查日志」，靠慢查询日志（slow query log）把执行超过某个阈值的语句记录下来；另一条是「实时看现场」，用 `SHOW PROCESSLIST` 或 `performance_schema` 观察此刻正在跑的语句。两者用途不同：日志回答「历史上哪些查询慢」，进程列表回答「现在为什么卡住」。"
    },
    {
      "type": "heading",
      "text": "慢查询日志：让数据库自己记录慢语句"
    },
    {
      "type": "paragraph",
      "text": "慢查询日志的工作原理是：每条语句执行完后，如果它的执行时间超过了设定的阈值 `long_query_time`（单位是秒），就把这条语句连同耗时、扫描行数等信息写进日志文件。这个阈值的最小可配置精度因版本而异（5.7 默认最小可到毫秒级，8.0 用 `long_query_time` 的十进制秒）。它默认是关闭的，需要显式开启。"
    },
    {
      "type": "code",
      "title": "开启并查看慢查询日志",
      "language": "sql",
      "code": "-- 开启慢查询日志（多数版本默认关闭；8.0 也常用 log_slow_queries 或系统变量开关）\nSET GLOBAL slow_query_log = ON;\n\n-- 阈值：执行超过 2 秒的语句才记录（8.0 支持小数，如 0.5 表示 500ms）\nSET GLOBAL long_query_time = 2;\n\n-- 确认是否生效、日志写到哪里\nSHOW VARIABLES LIKE 'slow_query_log';\nSHOW VARIABLES LIKE 'slow_query_log_file';\nSHOW VARIABLES LIKE 'long_query_time';\n\n-- 查看日志文件内容（在服务器 shell 里）\n-- tail -n 50 /var/lib/mysql/主机名-slow.log"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "long_query_time 是版本敏感的值",
      "body": "具体默认阈值、日志文件名格式、以及 `slow_query_log` 变量的确切行为在不同 MySQL 版本/发行版里有差异。关键你要掌握的是「原理与动作」：开启开关 → 设阈值 → 看日志文件。上线后如果系统负载允许，可以把阈值调低（比如 1 秒甚至更低）来捕获更多潜在慢语句，但也要权衡日志量。"
    },
    {
      "type": "paragraph",
      "text": "慢查询日志里的每一条记录会给出：这条语句本身、实际执行耗时、锁定耗时（Lock time）、扫描了多少行（Rows_examined）、返回了多少行（Rows_sent）等。这里 `Rows_examined` 是定位索引问题的金钥匙——如果扫描了上百万行却只返回几行，几乎可以断定索引没有正确命中。"
    },
    {
      "type": "subheading",
      "text": "实时观察：SHOW PROCESSLIST 与 performance_schema"
    },
    {
      "type": "paragraph",
      "text": "日志是「事后」的。当你怀疑数据库现在「卡住」了，更需要的是「当下」的视角。`SHOW FULL PROCESSLIST` 列出当前所有连接以及它们在执行的语句，你可以一眼看到有没有查询处于长时间卡住（`Time` 列很大）的状态。`performance_schema` 则是一张细粒度的「体检测表」，提供语句、锁等待、I/O 等维度的事件统计，是官方推荐的诊断根源的分析工具（对应 `sys` 库里的 `sys.statement_analysis` 等视图）。"
    },
    {
      "type": "code",
      "title": "实时看现场",
      "language": "sql",
      "code": "-- 列出所有连接及其正在执行的语句（FULL 才显示完整 SQL）\nSHOW FULL PROCESSLIST;\n\n-- 用 performance_schema 分析最耗时的前几条语句（8.0 / 5.7 均可）\nSELECT DIGEST_TEXT, COUNT_STAR, SUM_TIMER_WAIT / 1e12 AS total_sec,\n       SUM_ROWS_EXAMINED, SUM_ROWS_SENT\nFROM performance_schema.events_statements_summary_by_digest\nORDER BY SUM_TIMER_WAIT DESC\nLIMIT 10;"
    },
    {
      "type": "heading",
      "text": "EXPLAIN：定位慢的元凶"
    },
    {
      "type": "paragraph",
      "text": "找到一条慢语句后，下一步不是猜，而是用 `EXPLAIN` 让优化器告诉我们它打算怎么执行。针对「某个慢查询」，我们要在 EXPLAIN 输出里重点盯几个信号：有没有全表扫描（type 列出现 `ALL` 且没有充分利用索引）、有没有「文件排序」（Extra 列出现 `Using filesort`，通常意味着 ORDER BY 没能走索引）、有没有创建临时表（`Using temporary`）、以及 `rows` 列对扫描行数的估计是否大得离谱。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "EXPLAIN 的 rows 是估计值",
      "body": "EXPLAIN 输出里的 `rows` 是优化器根据索引统计信息估算出来的「大概要扫描多少行」，不是精确值。它用于「横向对比修复前后」非常有用（从百万级降到几十行），但别把它当成真实扫描行数。精确值请参考 `Rows_examined` 或在真实执行后量测。"
    },
    {
      "type": "heading",
      "text": "修复：索引、SQL 重写、结构/类型，然后验证"
    },
    {
      "type": "paragraph",
      "text": "EXPLAIN 定位之后，修复通常落在三个层面：补/改索引（让查询命中二级索引、多数情况靠最左前缀与覆盖索引）、重写 SQL（改写法使谓词可用索引，即「可下推给索引」的写法）、或调整表结构与数据类型（例如把不适合做等值/范围判断的列类型改对）。但最容易被忽略的是最后一步：验证。每次改动后必须重新 EXPLAIN + 重新度量耗时，看是否真的变快，也要确认没有让其它查询变慢。"
    },
    {
      "type": "heading",
      "text": "动手例子：按状态统计订单数量的慢查询"
    },
    {
      "type": "paragraph",
      "text": "回到我们的电商订单库 `shop`。假设运营想统计每个订单状态有多少笔，我们写了一条很自然的查询。随着订单量涨到上百万行，它越来越慢，被慢查询日志逮到。下面把它完整地「修复前 → 定位 → 修复后」走一遍。"
    },
    {
      "type": "code",
      "title": "修复前：按状态的订单计数",
      "language": "sql",
      "code": "-- 业务：统计每种订单状态的订单数\nSELECT status, COUNT(*)\nFROM orders\nGROUP BY status;"
    },
    {
      "type": "paragraph",
      "text": "这条 SQL 逻辑没毛病，但它在 `orders` 表上做了一次 GROUP BY。先看 EXPLAIN 告诉我们什么。"
    },
    {
      "type": "code",
      "title": "EXPLAIN 定位（修复前）",
      "language": "sql",
      "code": "EXPLAIN SELECT status, COUNT(*) FROM orders GROUP BY status;\n\n-- 输出关键列（示意）\n-- type : ALL            ← 全表扫描\n-- key  : NULL           ← 没有可用索引\n-- rows : 2_000_000      ← 估计扫描两百万行\n-- Extra: Using temporary; Using filesort\n--                      ← 为分组结果建了临时表、还做了文件排序"
    },
    {
      "type": "paragraph",
      "text": "三个红灯一起亮了：`type = ALL` 说明从头到尾扫全表；`Using temporary` 说明为了分组要建临时表承载统计结果；`Using filesort` 说明还要对分组结果排序。而 `rows = 2_000_000` 告诉我们优化器估计要扫两百万行。问题根源清晰：`status` 列上没有索引，优化器无从按状态「分组扫」并复用聚合。"
    },
    {
      "type": "paragraph",
      "text": "为什么「加索引」就能治这个病？因为如果 `status` 有索引，行在索引里已经按 status 排好，GROUP BY 可以直接沿索引顺序累加，既跳过 `Using temporary`/`Using filesort`，又由于只扫「覆盖」的索引列而不必回表。这正好是覆盖索引在聚合上的价值：索引本身能覆盖 `status` 一个列，查询可以在二级索引上完成，不需要读全表数据页。"
    },
    {
      "type": "code",
      "title": "修复：给 status 建索引",
      "language": "sql",
      "code": "ALTER TABLE orders ADD KEY idx_status (status);\n\n-- 或更贴合「经常按状态过滤」的复合索引，例如\n-- ALTER TABLE orders ADD KEY idx_user_status (user_id, status);\n\n-- 重新 EXPLAIN 验证\nEXPLAIN SELECT status, COUNT(*) FROM orders GROUP BY status;"
    },
    {
      "type": "paragraph",
      "text": "加完索引再看执行计划：`key` 指向 `idx_status`，`rows` 的估计大幅下降，`Using temporary` / `Using filesort` 消失，变成了沿索引顺序的扫描（`index` 或 `range` 级别的访问）。`COUNT(*)` 逐个索引条目累加，不再触碰数据页。"
    },
    {
      "type": "code",
      "title": "EXPLAIN 定位（修复后，示意）",
      "language": "sql",
      "code": "EXPLAIN SELECT status, COUNT(*) FROM orders GROUP BY status;\n\n-- 输出关键列（示意）\n-- key  : idx_status\n-- rows : 明显小于修复前（按状态分区数而非全表行数）\n-- Extra: 无 Using temporary / Using filesort"
    },
    {
      "type": "paragraph",
      "text": "真正的验证还要落到「实测」：在真实数据上对比修复前后的执行时间，并确认没有副作用。比如复合索引 `(user_id, status)` 虽然能让这条 GROUP BY 更快，但它对「按 user_id 查订单」也很有用；而对「只按 status 过滤」的查询则不如单纯 `(status)`。选哪个要看实际查询模式——这正是为什么要回到「度量」：用真实访问模式决定索引设计，而不是面面俱到地堆索引。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "别把所有慢查询都归结为「加索引」",
      "body": "加索引能解决大量「缺索引/索引没命中」的慢查询，但不是万能药。数据量真的大到全表都该扫（例如报表全量聚合）时，加索引也救不了「本来就该全扫」的查询；锁竞争导致的慢（一个事务持有锁不放，后面的查询排队）是另一种性质的问题，加索引没有意义。优化前先读 EXPLAIN，分清「索引问题、数据量问题、还是锁问题」。"
    },
    {
      "type": "heading",
      "text": "把流程固化下来"
    },
    {
      "type": "list",
      "items": [
        "开基线：开启慢查询日志或利用 performance_schema，让数据库自己暴露问题",
        "找语句：从日志 / 进程列表挑出「耗时大、出现多」的那几条，而不是漫天优化",
        "看计划：对选定语句执行 EXPLAIN，锁定全表扫、filesort、临时表、rows 估计过大等元凶",
        "动手修：按原因补/改索引、重写 SQL、或调整表结构与类型",
        "再验证：重新 EXPLAIN + 实测耗时，确认变快且无回归，必要时回到第 1 步迭代"
      ]
    },
    {
      "type": "quiz",
      "question": "一段 GROUP BY 查询 EXPLAIN 显示 `type = ALL`、`rows ≈ 两百万`，最可能说明什么？",
      "options": [
        "数据库实例的连接数耗尽",
        "该查询做了全表扫描，且很可能缺少可用索引，扫描行数估计巨大",
        "查询发生了死锁，需要回滚",
        "binlog 未开启导致无法统计"
      ],
      "answer": 1,
      "explanation": "type=ALL 表示全表扫描，rows 巨大是优化器对扫描行数的估计。这通常意味着相关列缺索引、执行计划未命中索引，是典型的慢查询元凶之一；与锁、连接数、binlog 无关。"
    },
    {
      "type": "exercise",
      "title": "为一组慢查询开优化方案",
      "description": "在 shop 库中，`SELECT amount FROM payment WHERE paid_at BETWEEN ... GROUP BY method ORDER BY SUM(amount) DESC` 被慢查询日志捕获。给出你的定位步骤：如何用 EXPLAIN 判断它慢在哪，并写出你认为值得尝试的一到两个修复方向（索引或 SQL 重写），说明你各自期待 EXPLAIN 的什么列发生变化。",
      "hint": "先看 type / key / Extra 的 Using temporary / Using filesort；考虑 `paid_at` 上的范围索引能否覆盖「按 method 分组的中间统计」，并想想「先在子查询里聚合再排序」和「直接排序」的差别。"
    },
    {
      "type": "keypoints",
      "items": [
        "先度量再优化：用慢查询日志 / performance_schema 让数据库自己暴露慢语句",
        "慢查询常用 SHOW FULL PROCESSLIST 看「现在卡在哪」，日志看「历史上哪些慢」",
        "EXPLAIN 盯四类信号：全表扫(ALL)、Using filesort、Using temporary、rows 估计过大",
        "修复三方向：补/改索引、重写 SQL、调整表结构与类型",
        "每次改动后必须重新 EXPLAIN + 实测耗时验证，防止回归",
        "分清三类根源：缺/误用索引、数据量过大、锁竞争——它们要不同的解法"
      ]
    }
  ]
};
