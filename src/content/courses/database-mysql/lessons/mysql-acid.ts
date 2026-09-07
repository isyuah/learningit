/* ==================================================================
 * 课时：事务与 ACID：为什么需要事务（mysql-acid）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-acid",
  courseSlug: "database-mysql",
  title: "事务与 ACID：为什么需要事务",
  summary: "把多步写操作当成一个原子单位，理解原子性、一致性、隔离性、持久性由谁保证。",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "在电商系统里，「下单」从来不是一条 SQL，而是几条必须同时生效的语句：扣减商品库存、生成订单、写入订单明细、可能还要记一笔支付。如果它们之间任意一步失败，系统就会留下半截状态——库存扣了订金没收、订单建了库存没扣。事务（Transaction）就是数据库用来解决这类问题的机制：把一组操作打包成一个「全做或全不做」的单位。这一课我们讲清楚事务是什么，以及它的四个核心性质 ACID 分别意味着什么、由哪一层保证。",
    },
    {
      type: "heading",
      text: "什么是事务：全做或全不做",
    },
    {
      type: "paragraph",
      text: "事务是一组数据库操作的逻辑单位。事务启动后，你可以执行多条 INSERT / UPDATE / DELETE；最后要么 COMMIT（提交，让所有修改永久生效），要么 ROLLBACK（回滚，撤销本次事务里的所有修改）。关键点是：数据库把这一组操作看待成一个整体，绝不会停在「做了一半」。",
    },
    {
      type: "code",
      title: "下单扣库存：一个典型事务",
      language: "sql",
      code: "START TRANSACTION;\n\n-- 1. 扣减库存（先判断库存是否充足）\nUPDATE product SET stock = stock - 1 WHERE id = 100 AND stock > 0;\n-- 若上方影响行数为 0，说明库存不足，应回滚\n\n-- 2. 生成订单\nINSERT INTO orders (user_id, status, total_amount)\nVALUES (7, 'pending', 2899.00);\n\n-- 3. 写入订单明细\nINSERT INTO order_item (order_id, product_id, quantity, price)\nVALUES (LAST_INSERT_ID(), 100, 1, 2899.00);\n\nCOMMIT;  -- 全部成功，一起生效\n-- 任何一步失败 -> ROLLBACK，库存回退、订单撤销",
    },
    {
      type: "callout",
      variant: "note",
      title: "扣库存用「条件更新」判断成功，而不是先读后写",
      body: "上面 `UPDATE ... WHERE id = 100 AND stock > 0` 附带 `AND stock > 0`，利用影响行数判断库存是否足够。如果直接用「先 SELECT stock、再 UPDATE」就会引入竞态：两个并发请求可能读到同一个旧库存，各自扣 1，最后少扣一次。真正正确且无竞态的写法会在「锁」那一课展开，这里先记住方向：把判断和扣减合并成一条原子 SQL。",
    },
    {
      type: "definition",
      term: "事务（Transaction）",
      definition: "一组数据库操作的逻辑单位，作为一个整体要么全部成功提交（COMMIT），要么全部失败回滚（ROLLBACK）。多条必须同时生效的语句应当放进同一个事务。",
    },
    {
      type: "heading",
      text: "ACID：四个性质的精确含义",
    },
    {
      type: "paragraph",
      text: "ACID 是评价事务语义的四条性质：原子性（Atomicity）、一致性（Consistency）、隔离性（Isolation）、持久性（Durability）。它们回答四个不同的问题：失败会不会留半截？数据会不会违反规则？并发会不会互相干扰？提交后会不会丢？下面逐一展开。",
    },
    {
      type: "definition",
      term: "原子性（Atomicity）",
      definition: "事务内所有操作要么全部执行成功，要么全部不执行。任何一条语句失败，事务整体回滚，不存在「做了一半」。在电商场景：扣库存和建订单必须同生共死。",
    },
    {
      type: "paragraph",
      text: "原子性针对的是「这一组操作」的整体，而不是单条语句。单条 UPDATE 数据库天然保证原子；真正的挑战是「多条逻辑上必须一起生效」的语句。判断标准是：如果在第 1 条成功后、第 3 条失败前系统崩溃，数据是否仍一致？若是，这段逻辑就该放进事务。",
    },
    {
      type: "definition",
      term: "一致性（Consistency）",
      definition: "事务执行前后，数据始终满足数据库的约束和业务的业务规则（不变式，invariant）。例如：库存不能为负、订单金额必须为正、转账前后总金额守恒。",
    },
    {
      type: "paragraph",
      text: "一致性最容易误解，因为它是 ACID 里最不像「数据库机制」的一条。要区分类别：数据库能自动强制的一致性，包括主键唯一、外键、NOT NULL、CHECK 约束、默认值等——这些由数据库兜底。而像「库存不能为负」「总金额守恒」这类业务不变式，数据库通常不知道它们的含义，必须由应用代码在事务里维护（例如先判断库存再扣减）。所以一致性是「数据库约束 + 应用业务规则」共同作用的结果，而不是数据库单独提供的某种开关。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "区分「数据库强制的一致性」与「业务不变式」",
      body: "面试常考：一致性是谁的责任？答案是双重的——数据库负责约束层面的完整性（主键/外键/唯一等），应用负责业务层面的不变式（库存非负、余额守恒等）。错误的认知是「只要开了事务，一致性就自动保证了」。开了事务只保证了原子性和隔离性，业务不变式仍要靠应用在事务中正确编码。",
    },
    {
      type: "definition",
      term: "隔离性（Isolation）",
      definition: "并发执行的事务之间互不干扰。一个事务未提交的中间状态，不应被其它事务看到或影响；多个事务并发执行的效果，应当与它们串行执行一致（或按隔离级别弱化这个保证）。",
    },
    {
      type: "paragraph",
      text: "隔离性解决「两个事务同时读写同一条数据会怎样」。完全严格地隔离（可串行化）成本很高，所以数据库提供了不同的隔离级别，允许在正确性与并发性能之间权衡。MySQL / InnoDB 通过「多版本并发控制（MVCC）+ 锁」共同实现隔离——这是后面几课的核心内容，这里先记住：隔离性由 MVCC 和锁保证，且默认级别是 REPEATABLE READ。",
    },
    {
      type: "definition",
      term: "持久性（Durability）",
      definition: "事务一旦 COMMIT，其修改就永久保存，即使之后系统崩溃、断电也不会丢失。",
    },
    {
      type: "paragraph",
      text: "持久性由 InnoDB 的 redo log（重做日志）+ WAL（预写日志）机制实现：提交时先把修改记录到磁盘上的 redo log，崩溃恢复时再据此重放未落盘的数据页。单说这两句可能不够清晰，完整机制会在「redo / undo log 与 WAL」那课展开，这里你只需建立印象：提交不一定立刻把数据页写盘，但一定会先写日志，因此「提交成功」在崩溃后依然可信。",
    },
    {
      type: "heading",
      text: "每一层各由谁保证",
    },
    {
      type: "table",
      caption: "ACID 四性的保证层面",
      headers: ["性质", "实现机制", "负责方"],
      rows: [
        ["原子性", "undo log（回滚日志）：失败时据此撤销修改", "存储引擎（InnoDB）"],
        ["一致性", "主键/外键/约束 + 应用在事务中维护业务不变式", "数据库 + 应用共同"],
        ["隔离性", "MVCC（快照）+ 锁（行锁/间隙锁）", "存储引擎（InnoDB）"],
        ["持久性", "redo log + WAL（预写日志），崩溃后重放", "存储引擎（InnoDB）"],
      ],
    },
    {
      type: "paragraph",
      text: "注意这张表的要点：原子性靠 undo log，持久性靠 redo log，隔离性靠 MVCC 与锁，而一致性是「约束 + 应用」的综合结果。原子性和持久性看起来像「一对」——一个负责失败时撤销（undo），一个负责成功后保住（redo）。后面的存储引擎与日志章节会分别深入，这里先建立正确的归属关系，会直接帮助你理解为什么 InnoDB 需要两类日志。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "记忆锚点",
      body: "原子性 = 失败要撤销（靠 undo log）；持久性 = 成功不丢失（靠 redo log）；隔离性 = 并发不互相干扰（靠 MVCC + 锁）；一致性 = 数据始终满足规则（约束 + 应用）。面试被问 ACID，先答这四个「问题」每个由哪个机制回答，再举电商例子。",
    },
    {
      type: "heading",
      text: "MySQL 里怎么开事务",
    },
    {
      type: "paragraph",
      text: "MySQL 默认是「每条语句自动提交」（autocommit=1），所以你不写事务时每条 SQL 独立生效。需要一组操作原子化时用 `START TRANSACTION` 显式开启，结束时 COMMIT 或 ROLLBACK。也支持保存点（SAVEPOINT）做到「部分回滚」，但那是事务工程里更细致的用法。",
    },
    {
      type: "code",
      title: "隐式提交与显式事务",
      language: "sql",
      code: "-- 默认 autocommit=1：单条语句自动提交，不需要事务\nUPDATE product SET stock = stock - 1 WHERE id = 100;\n\n-- 需要原子性时显式开事务\nSTART TRANSACTION;\nINSERT INTO orders (user_id, status) VALUES (7, 'pending');\nINSERT INTO order_item (order_id, product_id, quantity) VALUES (LAST_INSERT_ID(), 100, 1);\nCOMMIT; -- 或 ROLLBACK;\n\n-- 查看当前是否自动提交\nSELECT @@autocommit;",
    },
    {
      type: "callout",
      variant: "warning",
      title: "哪些语句会隐式提交当前事务",
      body: "并非所有语句都能在事务里回滚。诸如 DDL（CREATE / ALTER / DROP TABLE）、`TRUNCATE TABLE` 等语句会**隐式提交**当前事务，无法被 ROLLBACK 撤销。所以事务里通常只放 DML（INSERT / UPDATE / DELETE）与查询，别在事务中途执行这些 DDL。",
    },
    {
      type: "heading",
      text: "小结与前置预告",
    },
    {
      type: "paragraph",
      text: "这一课明确了事务与 ACID 的定义和各自的责任方。下一课我们会聚焦「隔离性」的具体展开：并发的两个事务究竟会读到什么、出现脏读、不可重复读、幻读是什么，以及四种隔离级别如何取舍。然后的 MVCC 与锁两课会解释 InnoDB 到底怎么实现这些隔离。把 ACID 的框架先立住，后面都是往这个框架里填实现细节。",
    },
    {
      type: "quiz",
      question: "「库存不能为负」这条规则在 ACID 中主要属于哪一类，由谁负责？",
      options: [
        "原子性，由 undo log 保证",
        "持久性，由 redo log 保证",
        "一致性中的业务不变式，需要应用在事务中维护",
        "隔离性，由锁保证",
      ],
      answer: 2,
      explanation: "库存非负是业务层面的不变式，数据库不知道其含义，必须由应用在事务中编码（例如用条件更新判断库存）。数据库自身只强制主键/外键/约束等完整性问题。",
    },
    {
      type: "quiz",
      question: "事务提交后即使系统崩溃也不会丢失修改，这是 ACID 中的哪一条、由什么机制保证？",
      options: [
        "原子性，由 undo log 保证",
        "持久性，由 redo log + WAL 保证",
        "一致性，由外键保证",
        "隔离性，由 MVCC 保证",
      ],
      answer: 1,
      explanation: "提交后修改不丢失是持久性；InnoDB 通过把修改先写入磁盘上的 redo log（WAL），崩溃恢复时据此重放，从而保证已提交事务不丢失。",
    },
    {
      type: "exercise",
      title: "设计一个「下单扣库存」事务",
      description: "给出 product / orders / order_item 三张表（库存字段为 stock，需防超卖），写一个事务：检查并扣减库存（用条件更新判断是否成功）→ 插入订单 → 插入订单明细 → 提交；任一步失败则整体回滚。说明为什么不用「先 SELECT 库存再扣」。",
      hint: "把扣库存写成 UPDATE ... WHERE id = ? AND stock > 0，用影响行数判断；订单 id 用 LAST_INSERT_ID() 取回给明细的外键。",
    },
    {
      type: "keypoints",
      items: [
        "事务 = 一组操作的逻辑单位，要么全部 COMMIT，要么全部 ROLLBACK",
        "ACID：原子性、一致性、隔离性、持久性，各自回答不同的问题",
        "原子性靠 undo log，持久性靠 redo log + WAL，隔离性靠 MVCC + 锁，一致性靠约束 + 应用",
        "一致性要区分：数据库强制的约束 vs 应用维护的业务不变式",
        "InnoDB 默认隔离级别是 REPEATABLE READ（下一课展开）",
        "DDL / TRUNCATE 会隐式提交，无法回滚",
      ],
    },
  ],
};
