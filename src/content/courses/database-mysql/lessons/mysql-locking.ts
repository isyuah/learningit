/* ==================================================================
 * 课时：锁机制：表锁、行锁、间隙锁与 next-key（mysql-locking）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-locking",
  courseSlug: "database-mysql",
  title: "锁机制：表锁、行锁、间隙锁与 next-key",
  summary: "InnoDB 的锁体系：意向锁、S/X 行锁、间隙锁与 next-key 锁，以及当前读如何加锁。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "MVCC 让「读」免于加锁，但真正的写操作之间仍需互相约束，否则两个事务同时改同一行就会互相覆盖。InnoDB 用一套锁体系解决这件事：表级别的意向锁、行级别的共享锁/排他锁，以及为了防幻读而引入的间隙锁与 next-key 锁。这一课把锁的分类、冲突矩阵、加锁场景和当前读的各种写法讲清楚——这是并发正确性的另一半，也是死锁的根源所在。",
    },
    {
      type: "heading",
      text: "锁的粒度：表锁与行锁",
    },
    {
      type: "paragraph",
      text: "锁按「锁住的范围」分，主要有表级锁与行级锁：表级锁锁住整张表，实现简单、开销小、但并发度低（读与读之间共享，一旦有写就几乎串行）；行级锁只锁住需要的那些行，并发度最高，但管理开销和死锁风险也更高。InnoDB 之所以是默认引擎，重要原因之一就是它支持真正的行级锁（MyISAM 只有表级锁）。",
    },
    {
      type: "paragraph",
      text: "更常见的一组对应词是：「表锁（table lock）」面向整表，「行锁（row lock）」面向单行。InnoDB 的行锁不是施加在数据文件上一个孤立的集合，而是施加在索引记录上——所以「有没有走索引」直接决定锁的是几行。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "行锁是锁在索引记录上的",
      body: "InnoDB 的行锁加在索引记录（记录所在索引项）上。若当前读的 WHERE 无法命中索引而全表扫描，InnoDB 会对扫描到的每一行都加锁，实际退化成近似表锁。所以「用上索引」不只是性能问题，也是锁粒度正确性的问题——下一课讲死锁的规避时还会再次强调。",
    },
    {
      type: "heading",
      text: "S 锁与 X 锁：共享与排他的冲突规则",
    },
    {
      type: "paragraph",
      text: "行级锁分两类：共享锁（S, Shared Lock）允许多个事务同时持有同一行的 S 锁、彼此不冲突，通常用于「我要读这行，但别让它在我读的时候被改」的场景；排他锁（X, Exclusive Lock）则规定同一时刻只能有一个事务持有某一行的 X 锁，用于写操作，或要独占某行做后续更新时。",
    },
    {
      type: "paragraph",
      text: "S 与 X 的冲突规则只有一条核心：S 与 S 兼容，S 与 X 互斥，X 与 X 互斥。也就是说，只要有一方持排他锁，另一方（无论 S 还是 X）都要等待。",
    },
    {
      type: "table",
      caption: "行锁兼容性矩阵（✓ 兼容，可同时持有；✗ 互斥，需等待）",
      headers: ["", "其它事务请求 S", "其它事务请求 X"],
      rows: [
        ["已持有 S", "✓", "✗"],
        ["已持有 X", "✗", "✗"],
      ],
    },
    {
      type: "paragraph",
      text: "这张 S/X 冲突矩阵是锁机制的基石，也直接决定了「两个事务同时改同一行会阻塞」「一个事务 FOR UPDATE、另一个 LOCK IN SHARE MODE 会阻塞」等现象。把它记住，绝大多数锁相关的行为都能推理出来。",
    },
    {
      type: "heading",
      text: "意向锁（Intention Lock）：表锁与行锁的协调员",
    },
    {
      type: "paragraph",
      text: "InnoDB 还有一类表级别的「意向锁」：事务要在某行上加锁之前，先要给所在表加上对应的意向锁。意向分两种：意向共享锁（IS, Intention Shared），表示本事务打算（或已经在）对该表某些行加 S 锁；意向排他锁（IX, Intention Exclusive），表示本事务打算（或已经在）对该表某些行加 X 锁。",
    },
    {
      type: "paragraph",
      text: "意向锁的意义在于：当有事务想给整张表加锁（如 `LOCK TABLES ... WRITE`）时，它只需检查表上有没有意向锁冲突，就能快速判断「是否已有事务锁住了某些行」，而不必逐行检查。意向锁彼此之间（IS/IS、IS/IX、IX/IX）都是兼容的——它们只是「声明意图」，真正的互斥发生在行级 S/X 上。",
    },
    {
      type: "heading",
      text: "间隙锁与 next-key 锁：为什么 RR 需要它们",
    },
    {
      type: "paragraph",
      text: "普通行锁只能锁住已经存在的行。但「幻读」问题在于，另一个事务可以插入一条新行到你的查询范围里，而这行在你加锁时还不存在，行锁根本管不住它。为了堵住这个缺口，InnoDB 引入了基于索引区间（间隙）的锁：",
    },
    {
      type: "list",
      items: [
        "记录锁（record lock）：锁住单条索引记录，即普通行锁。",
        "间隙锁（gap lock）：锁住「两条索引记录之间」以及「首条之前 / 末条之后」的开区间。它只阻止其它事务在该间隙内插入新记录，不阻止对已有记录的修改。间隙锁之间、间隙锁与记录锁一般可共存（间隙锁冲突的对象是「插入」）。",
        "next-key 锁：= 记录锁 + 它前面的间隙锁，锁住一个左开右闭的区间 `(上一条, 当前记录]`。它同时阻止对已存在记录的修改和在该区间内插入新记录。",
      ],
    },
    {
      type: "paragraph",
      text: "在 REPEATABLE READ 下，InnoDB 对当前读（以及写操作）默认使用 next-key 锁，从而把「已存在的行」和「可能插入进来的空档」一起锁住，`(上一条, 当前]` 的范围内既改不了也插不进，幻读就没了。",
    },
    {
      type: "code",
      title: "next-key 锁锁住的区间示意（概念）",
      language: "text",
      code: "orders(id) 为 1, 2, 5, 9（已提交），当前读 WHERE id BETWEEN 2 AND 5\n\n  (-∞, 1]  (1, 2]  (2, 5]  (5, 9]  (9, ∞)\n           ^     ^  ^\n           |     |  |___ next-key (5,?] 中 5 记录锁 + 间隙 (2,5)\n           |     |______ 记录 2 及其前间隙\n           |____________ 记录 1 及其前间隙\n\n在 RR 下，以上被 next-key 锁覆盖：既有记录被锁，空隙也被锁，\n其它事务无法向这些区间插入新 id。",
    },
    {
      type: "callout",
      variant: "note",
      title: "RC 为什么没有幻读锁，却更不容易死锁",
      body: "在 **READ COMMITTED** 下，InnoDB 只对当前读加**记录锁**（不加间隙锁和 next-key 锁），因此它的扫描不会锁住「空档」——这也是 RC 能减少锁冲突、降低死锁概率（下一课细讲）的原因。代价是 RC 挡不住幻读（标准意义上）。默认的 REPEATABLE READ 用 next-key 锁换取更严的一致性，代价是锁更多、死锁概率更高。",
    },
    {
      type: "heading",
      text: "当前读加什么锁：FOR UPDATE 与 FOR SHARE",
    },
    {
      type: "paragraph",
      text: "MVCC 课讲过当前读会加锁。这里把具体加什么锁说清楚：`SELECT ... FOR UPDATE` 加排他锁 X，锁定的行其它事务既不能改、作为当前读也不能读最新版本，通常用于「读出来后紧接着要改，且不允许别人并发改」——比如扣库存；`SELECT ... LOCK IN SHARE MODE`（8.0 起也可写 `SELECT ... FOR SHARE`）加共享锁 S，多个事务可以同时 SHARE 读同一行，但持 S 锁期间其它事务不能对该行加 X 锁去修改。",
    },
    {
      type: "paragraph",
      text: "在 RR 下这些当前读还附带 next-key 锁（对范围查询），从而把相关间隙也锁住。无论是 UPDATE/DELETE 还是 FOR UPDATE/FOR SHARE，其持有的锁都是在事务提交或回滚时才释放。",
    },
    {
      type: "code",
      title: "扣库存的两种当前读写法",
      language: "sql",
      code: "-- 写法 A：只读最新库存? 不,加 X 锁并读最新已提交\nSTART TRANSACTION;\nSELECT stock FROM product WHERE id = 100 FOR UPDATE;\n-- 业务判断 stock 是否够\nUPDATE product SET stock = stock - 1 WHERE id = 100;\nCOMMIT;\n\n-- 写法 B：一条原子条件更新,成功后影响行数=1 即扣减成功\nUPDATE product SET stock = stock - 1\nWHERE id = 100 AND stock > 0;",
    },
    {
      type: "callout",
      variant: "tip",
      title: "锁的释放时机：等事务结束",
      body: "事务里加的锁（无论是 FOR UPDATE 显式加的，还是 UPDATE/DELETE 隐式加的）都要等到**事务提交或回滚**才释放，而不是语句执行完就释放。因此事务里若只是 SELECT ... FOR UPDATE 却没及时 COMMIT，就会一直占着锁、阻塞和它冲突的其它事务——这既是并发瓶颈，也是死锁温床（下一课）。",
    },
    {
      type: "heading",
      text: "自增锁（Auto-inc Lock）",
    },
    {
      type: "paragraph",
      text: "表的主键如果是 `AUTO_INCREMENT`，插入时需要给自增计数器加锁，避免并发插入拿到重复 id。传统上 InnoDB 用一个表级「自增锁（AUTO-INC 锁）」保护，但它在**事务提交后才释放**，会影响并发插入吞吐。MySQL 5.1 起可通过参数 `innodb_autoinc_lock_mode` 选择更宽松的模式（例如 `2` 时对「插入行数不确定」的语句采用轻量级加锁），`1`（默认）是「简单插入用轻量级互斥、批量插入用表级自增锁」的折中。这属于进阶细节，面试提一句「自增列有专门的并发保护机制」即可。",
    },
    {
      type: "heading",
      text: "锁与 MVCC、隔离级别的关系小结",
    },
    {
      type: "paragraph",
      text: "把本课与前面串起来：隔离性的完整图景是 MVCC 管快照读（普通 SELECT 不加锁），锁体系管当前读与写（UPDATE/DELETE/INSERT、FOR UPDATE/FOR SHARE 加锁），其中 RR 默认用 next-key 锁防幻读，RC 只用记录锁。理解了 S/X 冲突矩阵，就能预测「什么操作之间会互相等待」；理解了这一点，才能理解下一课的死锁——当两个事务各自持有一把锁、又都在等对方那把锁时，循环等待就发生了。",
    },
    {
      type: "quiz",
      question: "事务 T1 已持有某行的排他锁（X），此时事务 T2 请求该行的共享锁（S），会发生什么？",
      options: [
        "T2 立即成功，与 T1 共享该行",
        "T2 阻塞等待，直到 T1 提交或回滚释放锁",
        "T1 的锁被 T2 抢走",
        "两个事务都会报错回滚",
      ],
      answer: 1,
      explanation: "S 与 X 互斥：只要有一方持 X 锁，另一方无论请求 S 还是 X 都要等待。只有 S 与 S 之间兼容。",
    },
    {
      type: "quiz",
      question: "REPEATABLE READ 下 InnoDB 主要靠什么来防止幻读？",
      options: [
        "只对已有记录加记录锁",
        "next-key 锁（记录锁 + 间隙锁）同时锁住已存在的行和可插入的空档",
        "锁住整张表",
        "禁止其它事务提交",
      ],
      answer: 1,
      explanation: "next-key 锁把 `(上一条, 当前]` 的范围锁住：既有记录被锁，空闲间隙也被堵住，其它事务无法在该范围插入新行，从而消除幻读。",
    },
    {
      type: "quiz",
      question: "下列哪种组合是「兼容」的、可以同时成立？",
      options: [
        "两个事务都持同一行的 X 锁",
        "一个事务持某行 X 锁，另一事务请求同一行 S 锁",
        "两个事务同时持同一行的 S 锁",
        "一个事务持某行 S 锁，另一事务请求同一行 X 锁",
      ],
      answer: 2,
      explanation: "S 与 S 兼容，可同时持有。其余组合（S+X、X+X、X+S）都互斥，需要等待。",
    },
    {
      type: "exercise",
      title: "判断并发下谁会阻塞",
      description: "给定 `product(id=1)`：T1 执行 `SELECT ... WHERE id=1 FOR UPDATE` 后未提交；同时 T2 分别尝试 (a) 普通 `SELECT`，(b) `SELECT ... FOR UPDATE`，(c) `UPDATE product SET stock=stock-1 WHERE id=1`。请用快照读/当前读与 S/X 冲突规则判断每个操作是否会阻塞，并解释为什么。",
      hint: "普通 SELECT 是快照读不加锁；FOR UPDATE 与 UPDATE 都是当前读加锁，需按 X 锁冲突规则判断。",
    },
    {
      type: "keypoints",
      items: [
        "锁粒度：表锁（并发低）vs 行锁（并发高，InnoDB 采用）",
        "行锁分 S（共享）与 X（排他）：S 兼容 S，S/X、X/X 互斥",
        "意向锁（IS/IX）是表级声明，协调表锁与行锁，彼此兼容",
        "next-key 锁 = 记录锁 + 间隙锁，RR 下行它防止幻读",
        "READ COMMITTED 只加记录锁、不加间隙锁",
        "FOR UPDATE 加 X 锁，LOCK IN SHARE MODE / FOR SHARE 加 S 锁",
        "锁随事务提交/回滚释放，行锁加在索引记录上",
      ],
    },
  ],
};
