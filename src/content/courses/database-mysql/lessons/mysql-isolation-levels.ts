/* ==================================================================
 * 课时：隔离级别：脏读、不可重复读与幻读（mysql-isolation-levels）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-isolation-levels",
  courseSlug: "database-mysql",
  title: "隔离级别：脏读、不可重复读与幻读",
  summary: "用两个并发事务讲清三种读异常，再对比四种隔离级别各允许/防止什么。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课我们把隔离性定义为「并发事务互不干扰」。但完全互不干扰（可串行化）代价很高。现实的做法是提供几个不同的隔离级别，让应用在「读到什么程度的数据」上做取舍，代价越低，可能读到的「异常数据」越多。这一课先精确定义三种读异常——脏读、不可重复读、幻读，再给出四种隔离级别如何取舍，最后说明 MySQL / InnoDB 的默认行为。",
    },
    {
      type: "heading",
      text: "先造两个并发的会话",
    },
    {
      type: "paragraph",
      text: "为了把异常讲清楚，我们固定用两张表和一个共享例子：`orders`（订单）和 `product`（商品），两个并发事务分别记为 T1 和 T2。所有异常都源于「一个事务读了正在被另一个事务修改、却还没提交的数据」，或「两次读之间数据被改了」。下面逐一定义。",
    },
    {
      type: "code",
      title: "示例数据",
      language: "sql",
      code: "CREATE TABLE product (\n  id BIGINT PRIMARY KEY,\n  name VARCHAR(128),\n  stock INT\n);\nINSERT INTO product VALUES (1, '手机', 10);\n\nCREATE TABLE orders (\n  id BIGINT PRIMARY KEY,\n  user_id BIGINT,\n  status VARCHAR(16),\n  total_amount DECIMAL(10,2)\n);\nINSERT INTO orders VALUES (1, 7, 'pending', 100.00),\n                          (2, 8, 'paid',   200.00);",
    },
    {
      type: "definition",
      term: "脏读（Dirty Read）",
      definition: "一个事务读到了另一个事务**尚未提交**的修改。如果那个事务之后回滚，读到的就是「从未真正存在过」的数据。",
    },
    {
      type: "table",
      caption: "脏读示例（T1 读到 T2 未提交的数据）",
      headers: ["时刻", "T1（读）", "T2（写）"],
      rows: [
        ["t1", "——", "UPDATE product SET stock = 5 WHERE id = 1;（未提交）"],
        ["t2", "SELECT stock FROM product WHERE id = 1; 读到 5", "——"],
        ["t3", "——", "ROLLBACK;（stock 回到 10）"],
        ["t4", "T1 刚才读到的 5 是脏数据", "——"],
      ],
    },
    {
      type: "paragraph",
      text: "脏读的危害在于：T1 基于一个「会被撤销」的中间值做了决策，例如根据库存 5 决定接受超额下单，结果 T2 回滚，库存其实是 10。脏读是最严重的读异常，任何隔离级别都不该允许它（唯一允许它的是最低的 READ UNCOMMITTED）。",
    },
    {
      type: "definition",
      term: "不可重复读（Non-Repeatable Read）",
      definition: "同一事务内，两次读取同一行，得到不同的值。原因是另一个事务在两次读之间**提交**了对该行的修改。",
    },
    {
      type: "table",
      caption: "不可重复读示例（T1 两次读同一行结果不同）",
      headers: ["时刻", "T1（读）", "T2（写并提交）"],
      rows: [
        ["t1", "SELECT status FROM orders WHERE id = 1; → pending", "——"],
        ["t2", "——", "UPDATE orders SET status = 'paid' WHERE id = 1; COMMIT;"],
        ["t3", "SELECT status FROM orders WHERE id = 1; → paid（变了）", "——"],
      ],
    },
    {
      type: "paragraph",
      text: "不可重复读针对**同一行的值**：同一事务里两次读同一行，因其它事务已提交的修改而不同。它反映的是「行内容被更新覆盖」。注意跟脏读的区别：脏读读到的是未提交数据，不可重复读读到的是已提交但发生变化的行。",
    },
    {
      type: "definition",
      term: "幻读（Phantom Read）",
      definition: "同一事务内，两次执行同一查询，第二次多出（或少了）若干行。原因是另一个事务在两次查询之间**插入或删除**了满足查询条件的行，导致结果集的行数变化，「幻」即多出来的那几行。",
    },
    {
      type: "table",
      caption: "幻读示例（T1 两次范围查询行数变化）",
      headers: ["时刻", "T1（范围查询）", "T2（插入并提交）"],
      rows: [
        ["t1", "SELECT * FROM orders WHERE status = 'pending'; → 返回 1 行", "——"],
        ["t2", "——", "INSERT INTO orders VALUES (3, 9, 'pending', 300.00); COMMIT;"],
        ["t3", "同一查询 → 返回 2 行（多出一行「幻影」）", "——"],
      ],
    },
    {
      type: "paragraph",
      text: "幻读与不可重复读的区别在于范围：不可重复读是「同一行内容变了」，幻读是「结果集多了/少了行」。行级锁只能锁住已存在的行，锁不住「未来会被插入进来的行」，所以防止幻读需要更特殊的手段——InnoDB 用间隙锁（gap lock）和 next-key 锁，这会在「锁」一课深入，这里先记住结论。",
    },
    {
      type: "heading",
      text: "四种隔离级别",
    },
    {
      type: "paragraph",
      text: "SQL 标准定义了四种隔离级别，规定了每种异常是否被允许。从最低到最高：READ UNCOMMITTED、READ COMMITTED、REPEATABLE READ、SERIALIZABLE。下表的「允许」是指该隔离级别**可能**出现这种异常（即使达不到完全不出现，标准定义如此）。",
    },
    {
      type: "table",
      caption: "SQL 标准：隔离级别 × 读异常",
      headers: ["隔离级别", "脏读", "不可重复读", "幻读"],
      rows: [
        ["READ UNCOMMITTED", "允许", "允许", "允许"],
        ["READ COMMITTED", "禁止", "允许", "允许"],
        ["REPEATABLE READ", "禁止", "禁止", "允许（标准上）"],
        ["SERIALIZABLE", "禁止", "禁止", "禁止"],
      ],
    },
    {
      type: "heading",
      text: "逐一理解这四种级别",
    },
    {
      type: "definition",
      term: "READ UNCOMMITTED（读未提交）",
      definition: "事务能看到其它事务尚未提交的修改。这是隔离性最弱、并发最强、开销最低的级别，代价是会出现脏读。实际业务几乎从不用它。",
    },
    {
      type: "definition",
      term: "READ COMMITTED（读已提交）",
      definition: "事务只能看到其它事务**已提交**的修改，因此消除了脏读。但同一事务内两次读之间，其它事务可能提交了修改，所以仍可能出现不可重复读（以及幻读）。这是很多其它数据库（如 PostgreSQL / Oracle 默认）采用的级别。",
    },
    {
      type: "definition",
      term: "REPEATABLE READ（可重复读）",
      definition: "事务开始后（在 InnoDB 中，是第一次快照读时建立读视图），同一事务内多次读取同一快照都得到一致结果，因此既消除了脏读也消除了不可重复读。SQL 标准认为它仍可能幻读，但 **InnoDB 在 REPEATABLE READ 下通过 MVCC + next-key 锁，在绝大多数情况下也消除了幻读**——这一点是这个级别上最容易被误解的地方。",
    },
    {
      type: "definition",
      term: "SERIALIZABLE（可串行化）",
      definition: "最高隔离级别，事务串行执行的效果，彻底杜绝脏读、不可重复读、幻读。代价是并发度最低、锁等待与死锁风险最高。",
    },
    {
      type: "callout",
      variant: "note",
      title: "标准表格与 InnoDB 实现的差异（面试必考）",
      body: "严格按 SQL 标准，REPEATABLE READ 允许幻读。但 MySQL / InnoDB 的实现里，REPEATABLE READ 下普通的一致性读（快照读）用多版本机制保证两次读一致，写相关的查询（当前读）用 next-key 锁阻止插入幻影行，所以在绝大多数场景下 InnoDB 的 REPEATABLE READ **不会出现幻读**。因此面试答「MySQL 默认隔离级别」要答 REPEATABLE READ，并说明为何它实际上大半也防住了幻读——细节在 MVCC 与锁两课。",
    },
    {
      type: "heading",
      text: "MySQL / InnoDB 的默认与常用选择",
    },
    {
      type: "paragraph",
      text: "MySQL / InnoDB 的默认隔离级别是 **REPEATABLE READ（可重复读）**。与很多其它数据库默认 READ COMMITTED 不同，MySQL 选择可重复读有历史原因：它在默认级别下既保证了较强的读一致性，又通过 MVCC 让普通 SELECT 不加锁、不阻塞写，兼顾了正确性与并发性能。MySQL 8.0 里 `SELECT @@transaction_isolation` 可查看（5.7 及更早是 `@@tx_isolation`）。",
    },
    {
      type: "heading",
      text: "如何设置隔离级别",
    },
    {
      type: "paragraph",
      text: "隔离级别可以按会话（session）或全局（global）设置，也可以只对下一次事务生效（`SET TRANSACTION`）。三条语法适用于不同作用范围。",
    },
    {
      type: "code",
      title: "设置隔离级别（session / global / 事务级）",
      language: "sql",
      code: "-- 会话级：仅对当前连接生效\nSET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;\n\n-- 全局级：影响之后新建的连接（不改当前连接，需重连）\nSET GLOBAL TRANSACTION ISOLATION LEVEL READ COMMITTED;\n\n-- 仅对下一次事务生效\nSET TRANSACTION ISOLATION LEVEL SERIALIZABLE;\n\n-- 查看\nSELECT @@transaction_isolation;      -- 8.0\nSELECT @@tx_isolation;               -- 5.7 及更早",
    },
    {
      type: "callout",
      variant: "warning",
      title: "版本敏感的变量名",
      body: "隔离级别变量的名字随版本变化：MySQL 5.7 及更早用 `@@tx_isolation`，8.0 起改为 `@@transaction_isolation`（`@@tx_isolation` 作为旧名仍可读但已废弃）。查询缓存（Query Cache）在 8.0 已被移除，本课程一律不依赖查询缓存。",
    },
    {
      type: "heading",
      text: "隔离级别不是「越高越好」",
    },
    {
      type: "paragraph",
      text: "隔离级别是正确性与并发的权衡：级别越高，读一致性越强，但锁越多、等待越久、死锁概率越高、吞吐越低。工程上要按业务语义选：绝大多数读多写少的业务用默认 REPEATABLE READ 即可；需要对「读到最新已提交数据」敏感、且希望更少锁的场景可能降级到 READ COMMITTED（例如某些读取场景需要每次都读到最新值，不受快照固化影响时）。SERIALIZABLE 通常只在极少数强一致性场景使用，因为几乎串行化了。",
    },
    {
      type: "table",
      caption: "面试速查：异常与级别对应",
      headers: ["异常 / 级别", "READ UNCOMMITTED", "READ COMMITTED", "REPEATABLE READ (MySQL)", "SERIALIZABLE"],
      rows: [
        ["脏读", "可能", "否", "否", "否"],
        ["不可重复读", "可能", "可能", "否", "否"],
        ["幻读", "可能", "可能", "基本否（InnoDB 处理）", "否"],
      ],
    },
    {
      type: "heading",
      text: "小结：为什么要逐级往下学 MVCC 与锁",
    },
    {
      type: "paragraph",
      text: "这一课建立了词汇表：三种读异常 + 四种隔离级别，以及 InnoDB 默认 REPEATABLE READ、且大半防住幻读的结论。但「REPEATABLE READ 如何做到两次读一致？」「InnoDB 如何挡住幻读？」这两个问题，标准表格回答不了，必须去看实现：快照读与读视图（MVCC）回答了「同一事务读到一致快照」，next-key 锁回答了「当前读如何阻止幻影插入」。这正是接下来两课的内容。",
    },
    {
      type: "quiz",
      question: "同一事务内两次执行同一查询，第二次多出了一行（其它事务插入了满足条件的行并提交）。这属于哪种异常？",
      options: [
        "脏读",
        "不可重复读",
        "幻读",
        "写偏斜（write skew）",
      ],
      answer: 2,
      explanation: "结果集多了（或少了）行、而不仅是某行内容变化，正是幻读的典型特征。不可重复读是同一行的值变化，脏读是读到未提交数据。",
    },
    {
      type: "quiz",
      question: "在 READ COMMITTED 级别下，下列说法哪个正确？",
      options: [
        "脏读、不可重复读、幻读都被禁止",
        "只禁止脏读，仍可能不可重复读和幻读",
        "与 SERIALIZABLE 等价",
        "只能读到自己事务修改的数据",
      ],
      answer: 1,
      explanation: "READ COMMITTED 只保证看不到未提交数据（消除脏读）；两次读之间其它事务可能提交修改，所以仍可能出现不可重复读和幻读。",
    },
    {
      type: "quiz",
      question: "MySQL / InnoDB 的默认隔离级别是？",
      options: [
        "READ UNCOMMITTED",
        "READ COMMITTED",
        "REPEATABLE READ",
        "SERIALIZABLE",
      ],
      answer: 2,
      explanation: "MySQL / InnoDB 默认是 REPEATABLE READ，并且通过 MVCC 快照读 + next-key 锁在大部分场景下也防住了幻读。",
    },
    {
      type: "exercise",
      title: "为业务选一个合适的隔离级别",
      description: "有一个「下单」流程：读库存快照、扣库存、插订单。请分析在 READ COMMITTED 与 REPEATABLE READ 下各有什么读异常风险，并说明金融级「转账」场景为什么往往需要更强的一致性保证，给出你的选择与理由。",
      hint: "先分别考察脏读/不可重复读/幻读在两种级别下是否可能，再考虑锁的代价与并发吞吐的取舍。",
    },
    {
      type: "keypoints",
      items: [
        "脏读：读到另一事务未提交、会被回滚的数据",
        "不可重复读：同一行两次读值不同（已提交的更新）",
        "幻读：同一范围查询结果集行数变化（插入/删除）",
        "SQL 标准四级别：RU / RC / RR / SERIALIZABLE，逐级变严格",
        "MySQL / InnoDB 默认 REPEATABLE READ，并用 MVCC + next-key 锁大半防住幻读",
        "设置：SET [SESSION|GLOBAL] TRANSACTION ISOLATION LEVEL ...",
        "隔离级别是正确性与并发的权衡，不是越高越好",
      ],
    },
  ],
};
