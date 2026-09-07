/* ==================================================================
 * 课时：写入 DML 与事务细节：INSERT / UPDATE / DELETE（mysql-dml-transactions）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-dml-transactions",
  "courseSlug": "database-mysql",
  "title": "写入 DML 与事务细节：INSERT / UPDATE / DELETE",
  "summary": "掌握 INSERT / UPDATE / DELETE 的各种写法与边界，理解 auto-commit、隐式提交与 DML 的事务边界。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "前几课我们聚焦「读」：子查询、窗口函数、聚合。但真实系统一半的工作是「写」——INSERT、UPDATE、DELETE。这一课把写 DML 的常见变体（批量插入、upsert、JOIN 更新、DELETE LIMIT）讲清楚，更重要的是建立关于**事务边界**的正确心智：在 MySQL 里，每条 DML 到底以什么为一个原子单位、什么时候自动提交、哪些语句会隐式终结一个事务。ACID 与隔离级别的完整原理放在第五章，本课只做必要的向前预告。"
    },
    {
      "type": "heading",
      "text": "INSERT 的多种形态：单行到批量",
    },
    {
      "type": "paragraph",
      "text": "INSERT 最基本的是单行插入。批量形态 `INSERT ... VALUES (...),(...),(...)` 用一条语句插多行，网络往返更少，是写入性能的基本功。还可以用 `INSERT ... SELECT` 从查询结果直接灌入——注意它会锁定 / 读取源表，语义上类似一次复制拷贝。批量插入的默认事务行为我们到「事务边界」一节再回到。"
    },
    {
      "type": "code",
      "title": "单行 / 多行 / 从查询插入",
      "language": "sql",
      "code": "-- 单行插入\nINSERT INTO user (name, email, created_at)\nVALUES ('小明', 'xiaoming@example.com', NOW());\n\n-- 多行批量插入\nINSERT INTO product (name, category, price, stock, created_at)\nVALUES\n  ('机械键盘', '外设', 399.00, 50, NOW()),\n  ('无线鼠标', '外设', 129.00, 200, NOW()),\n  ('显示器', '数码', 1599.00, 80, NOW());\n\n-- 从查询结果插入：归档已取消订单\nINSERT INTO order_archive (id, user_id, status, total_amount, created_at)\nSELECT id, user_id, status, total_amount, created_at\nFROM orders\nWHERE status = 'cancelled';"
    },
    {
      "type": "heading",
      "text": "INSERT ... ON DUPLICATE KEY UPDATE：主键/唯一键冲突时的升级",
    },
    {
      "type": "paragraph",
      "text": "当插入的行与现有行的**主键或唯一键**冲突时，`INSERT ... ON DUPLICATE KEY UPDATE`（常称为 upsert）会转而执行指定的 UPDATE，而不是报错。它是「存在则更新，不存在则插入」最直接的内建写法，不需要应用层先 SELECT 再二选一（那会引入竞态）。它依赖唯一约束来判断冲突，所以别把它用在没有唯一键的表上。"
    },
    {
      "type": "code",
      "title": "upsert：按 email 唯一键“写不进去就更新”",
      "language": "sql",
      "code": "-- 假设 user.email 有唯一索引 UNIQUE(email)\nINSERT INTO user (name, email, created_at)\nVALUES ('小明', 'xiaoming@example.com', NOW())\nON DUPLICATE KEY UPDATE\n    name      = VALUES(name),          -- MySQL 8.0.20 后推荐改成新别名写法\n    created_at = NOW();\n\n-- 8.0.20+ 更推荐的写法：用行别名，避免 VALUES() 函数歧义\nINSERT INTO user (name, email, created_at) AS new\nVALUES ('小明', 'xiaoming@example.com', NOW())\nON DUPLICATE KEY UPDATE name = new.name;"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "ON DUPLICATE KEY UPDATE 的版本差异",
      "body": "`VALUES(col)` 在冲突更新里引用“将要插入的值”是历史写法；MySQL 8.0.20 起它被标注为 deprecated，推荐用行别名 `INSERT ... AS new ... ON DUPLICATE KEY UPDATE name = new.name`。两种写法在各自版本都可用，但新代码建议用别名语法。不依赖唯一键的冲突不会触发该更新分支。"
    },
    {
      "type": "heading",
      "text": "INSERT IGNORE 与 REPLACE",
    },
    {
      "type": "paragraph",
      "text": "另两个写冲突的选项：`INSERT IGNORE` 遇到主键/唯一键冲突时**静默跳过**该行（不报错、不更新，继续处理其它行）；`REPLACE` 遇到冲突时**先删旧行再插新行**（新行自增 id 会变化，且会触发 delete + insert，副作用比 upsert 大）。三者的取舍：要更新就用 ON DUPLICATE KEY UPDATE，要静默跳过就用 INSERT IGNORE，要“以新代旧”且接受删除副作用再用 REPLACE。"
    },
    {
      "type": "code",
      "title": "INSERT IGNORE 与 REPLACE 对比",
      "language": "sql",
      "code": "-- 冲突时跳过：重复的 email 不再插入，其余继续\nINSERT IGNORE INTO user (name, email, created_at)\nVALUES ('小明', 'xiaoming@example.com', NOW());\n\n-- 冲突时先删后插\nREPLACE INTO user (name, email, created_at)\nVALUES ('小明', 'xiaoming@example.com', NOW());\n\n-- 注意：REPLACE 会重新分配自增主键，且等价于 DELETE + INSERT 两条操作"
    },
    {
      "type": "heading",
      "text": "UPDATE：按条件更新、用聚合/表达式、以及 UPDATE ... JOIN",
    },
    {
      "type": "paragraph",
      "text": "UPDATE 的基本形态是 `UPDATE 表 SET 列=值 WHERE 条件`。值可以是常量、表达式，甚至带进 join 的另一张表的列。真实业务里「用子查询/JOIN 的结果来更新」非常常见，MySQL 支持在 UPDATE 里直接 JOIN 其他表。注意：不带 WHERE 的 UPDATE 会更新整张表——这是最危险的线上事故之一，务必先确认 WHERE 命中范围（可用等价的 SELECT 先验证）。"
    },
    {
      "type": "code",
      "title": "UPDATE 的三类写法",
      "language": "sql",
      "code": "-- 1) 简单条件更新\nUPDATE product SET stock = stock - 1 WHERE id = 1001;\n\n-- 2) 用聚合 / 表达式：给所有外设加价 10%\nUPDATE product\nSET price = price * 1.10\nWHERE category = '外设';\n\n-- 3) UPDATE ... JOIN：用子查询聚合的结果回填订单的最近支付时间\nUPDATE orders o\nJOIN (\n    SELECT order_id, MAX(paid_at) AS last_paid\n    FROM payment\n    GROUP BY order_id\n) p ON p.order_id = o.id\nSET o.created_at = COALESCE(p.last_paid, o.created_at)\nWHERE o.status = 'paid';"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "UPDATE 前先 SELECT 验证命中范围",
      "body": "一条不带（或条件写错）WHERE 的 UPDATE / DELETE 会波及全表或大范围行，InnoDB 还会在事务提交前一直持有这些行的锁，阻塞其它写入。安全习惯：先用等价的 SELECT（或 SELECT COUNT(*)）确认命中行，再用 LIMIT（DELETE 支持，UPDATE 不支持直接 LIMIT——见下）或更严格条件收窄。"
    },
    {
      "type": "heading",
      "text": "DELETE 与 DELETE LIMIT",
    },
    {
      "type": "paragraph",
      "text": "DELETE 删除满足 WHERE 的行。MySQL 支持 `DELETE ... LIMIT n`，限制一次最多删 n 行，常用于「批量清理时小步删除、避免一次锁住太多行」。注意 UPDATE 在 MySQL 里**不支持** LIMIT（那是别的数据库的行为），DELETE 支持。DELETE 会触发 InnoDB 的 undo log（回滚所需的旧版本），也因此在 MVCC 下被删除的行并不立刻物理消失。"
    },
    {
      "type": "code",
      "title": "DELETE 与 DELETE LIMIT 分批清理",
      "language": "sql",
      "code": "-- 删除单个取消订单\nDELETE FROM orders WHERE id = 12345 AND status = 'cancelled';\n\n-- 分批删除：一次最多删 100 行，常用于“清理过期数据”防止长事务/长锁\nDELETE FROM orders\nWHERE status = 'cancelled' AND created_at < DATE_SUB(NOW(), INTERVAL 60 DAY)\nLIMIT 100;\n\n-- 注意：UPDATE 不支持 LIMIT；UPDATE ... LIMIT 会语法报错"
    },
    {
      "type": "heading",
      "text": "事务边界：auto-commit 与 DML 的默认行为",
    },
    {
      "type": "paragraph",
      "text": "现在到本课最核心的心智模型。在 InnoDB 下，**每条 DML（INSERT / UPDATE / DELETE）都在一个事务里执行**，事务是原子的最小单位。区分两种情况：如果你显式 `BEGIN` / `START TRANSACTION` 并最后 `COMMIT` / `ROLLBACK`，那么从 BEGIN 到提交之间的多条 DML 属于同一个事务，一起生效或一起回滚；如果你没有显式开启事务，那么 MySQL 在默认的 **auto-commit** 模式下，**每条单独的 DML 语句都会自动作为一个小事务立即提交**——也就是每条语句自带原子性，但语句之间互相独立。"
    },
    {
      "type": "code",
      "title": "显式事务 vs 自动提交",
      "language": "sql",
      "code": "-- 默认 auto-commit：下面两条各自立即生效，彼此独立\nUPDATE orders SET status = 'paid' WHERE id = 1001;\nUPDATE payment SET paid_at = NOW() WHERE order_id = 1001;\n\nSTART TRANSACTION;                 -- 显式开启事务\nUPDATE orders  SET status = 'paid' WHERE id = 1002;\nUPDATE payment SET paid_at = NOW() WHERE order_id = 1002;\nCOMMIT;                            -- 一起生效；若中途出错可以 ROLLBACK 一起撤销"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "隐式提交（Implicit Commit）：DDL 会终结当前事务",
      "body": "并非所有语句都像 DML 一样只在事务里执行。**DDL（CREATE / ALTER / DROP TABLE 等）以及像 TRUNCATE、GRANT、LOCK TABLES 这类语句会触发隐式提交**——即使你在事务中间执行它们，MySQL 也会先把当前事务提交掉，然后才执行这条语句，之后无法回滚。因此在事务里混入 DDL 会导致「前面已经提交、后面却想回滚」的结构性矛盾。TRUNCATE 不能回滚，DELETE 可以回滚——这是两者巨大差异之一（TRUNCATE 是 DDL 语义）。"
    },
    {
      "type": "code",
      "title": "TRUNCATE 无法回滚 vs DELETE 可回滚",
      "language": "sql",
      "code": "START TRANSACTION;\nDELETE FROM order_item WHERE order_id = 2001; -- DML，可回滚\nROLLBACK;\n\nSTART TRANSACTION;\nTRUNCATE TABLE order_item;                   -- DDL，隐式提交且不可回滚\nROLLBACK;                                    -- 没有效果，数据已清空\n-- 所以在清理整表前要三思 TRUNCATE vs DELETE"
    },
    {
      "type": "paragraph",
      "text": "把这些连起来：写 DML 时要同时想三件事——①这条 / 这组语句应不应该放进同一个显式事务（多步必须原子则必须）；②当前连接是 auto-commit 还是手动事务（决定了语句间的隔离性）；③有没有 DDL 混在中间造成隐式提交。这些判断的真正底层依据——为什么事务要原子、为什么有提交/回滚、redo/undo 如何支撑——正是「事务与 ACID」那一章的内容，本课先把边界建立起来，第五章再深入原理。"
    },
    {
      "type": "definition",
      "term": "auto-commit",
      "definition": "MySQL 的默认模式：每条单独的 DML 语句在不显式 BEGIN 时自动作为一个事务立即提交，语句本身原子、但语句之间相互独立。可被 SET autocommit = 0 关闭（然后手动 COMMIT/ROLLBACK）。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "向前预告：ACID 与事务原理在第五章",
      "body": "本课只建立了「DML 在事务边界里、auto-commit 与隐式提交」的操作层事实。真正的「为什么」——事务的 ACID 保证、redo/undo、隔离级别、MVCC 与锁——是后面的「事务、隔离与并发控制」章节的系统内容，这里不做展开，避免提前割裂知识体系。"
    },
    {
      "type": "quiz",
      "question": "在默认 auto-commit 模式下执行下面两条语句，紧接着发生崩溃：`UPDATE orders SET status='paid' WHERE id=1;` 和 `UPDATE payment SET paid_at=NOW() WHERE order_id=1;`。请问第一条更新的结果如何？",
      "options": [
        "两条都回滚，因为崩溃时事务未提交",
        "第一条已自动提交、结果保留；第二条是否保留取决于它自己是否已提交，二者彼此独立",
        "两条都会保留，因为 DML 从不回滚",
        "第一条回滚、第二条保留，因为 MySQL 会优先保留最后一条"
      ],
      "answer": 1,
      "explanation": "在 auto-commit 下每条 DML 单独作为一个事务自动提交。第一条语句一旦执行完就自动提交并持久化（即使之后崩溃也保留）。第二条是独立的事务，其结果只取决于它自己是否已提交。这正是「语句之间彼此独立」的含义，也是为什么要求原子性的多步写要放进显式事务。"
    },
    {
      "type": "exercise",
      "title": "事务化一个“下单扣库存”流程",
      "description": "写一段 SQL：用显式事务完成「扣减 product 库存 + 插入 orders 记录 + 插入 order_item 明细 + 写入 payment 支付流水」四步。要求：任一失败整体回滚；并指出如果其中混入一条 CREATE TABLE（DDL）会破坏什么保证。",
      "hint": "START TRANSACTION 后依次执行四条 DML，最后 COMMIT；中途出错执行 ROLLBACK。思考第 1 题：把 CREATE TABLE 放进事务会导致隐式提交，让之前的 UPDATE 提前提交、无法整体回滚。"
    },
    {
      "type": "keypoints",
      "items": [
        "INSERT 支持单行 / 多行 VALUES / INSERT...SELECT 三种形态",
        "ON DUPLICATE KEY UPDATE 依据主键 / 唯一键做 upsert，8.0.20 推荐行别名写法",
        "INSERT IGNORE 冲突静默跳过；REPLACE 先删后插（自增变化、副作用大）",
        "UPDATE 可用表达式与 JOIN 其他表；UPDATE 不支持 LIMIT，DELETE 支持 LIMIT",
        "InnoDB 下每条 DML 都在事务里；auto-commit 时每条单独自动提交",
        "DDL / TRUNCATE 等触发隐式提交，会终结当前事务且不可回滚",
        "ACID 的完整原理在第五章展开，本课只建立事务边界心智"
      ]
    }
  ]
};
