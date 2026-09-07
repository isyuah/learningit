/* ==================================================================
 * 课时：面试——事务 / 隔离 / 锁高频题（mysql-interview-transaction）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 本节把事务、ACID、隔离级别、MVCC 与锁整理成面试答题框架。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-interview-transaction",
  courseSlug: "database-mysql",
  title: "面试：事务 / 隔离 / 锁高频题",
  summary: "ACID、隔离级别、MVCC 快照读/当前读、行锁/间隙锁/next-key、死锁与一条 UPDATE 如何加锁——事务正确性的高频考点与答题框架。",
  minutes: 24,
  kind: "quiz",
  blocks: [
    {
      type: "paragraph",
      text: "事务、隔离级别、MVCC 与锁，是数据库面试真正的重灾区，也是最能拉开差距的板块。这一节的核心思路是：先把 ACID 讲清楚「每个特性由哪个机制保障」，再讲隔离级别与并发问题的对应关系，然后用「快照读 vs 当前读」这条主线把 MVCC 和锁串起来，最后讲死锁与一条 UPDATE 的加锁路径。掌握了这套框架，无论面试官从哪里切入你都能顺藤摸瓜。",
    },
    {
      type: "heading",
      text: "高频题 1：ACID 分别是什么，各自由什么保障？",
    },
    {
      type: "paragraph",
      text: "答题框架：先把四个字母展开，再各配一个「谁来实现」。A（原子性 Atomicity）= 事务要么全做要么全不做，靠 undo log 回滚；C（一致性 Consistency）= 事务执行前后数据满足约束（业务/约束层面的一致），是最终目标，由其它三个特性共同保证；I（隔离性 Isolation）= 并发事务互不干扰，靠锁 + MVCC 实现；D（持久性 Durability）= 提交后数据不丢失，靠 redo log + WAL 实现。加分点：讲清楚「一致性与其它三者的关系」——一致性是目的，A/I/D 是手段；还要能指出悲观并发控制靠锁、乐观并发控制靠版本（MVCC）。",
    },
    {
      type: "table",
      caption: "ACID 与实现机制的对应",
      headers: ["特性", "含义", "主要由谁保障"],
      rows: [
        ["A 原子性", "全做或全不做", "undo log（回滚）"],
        ["C 一致性", "前后满足约束", "其余三者的最终目标"],
        ["I 隔离性", "并发互不干扰", "锁 + MVCC"],
        ["D 持久性", "提交后不丢", "redo log + WAL"],
      ],
    },
    {
      type: "heading",
      text: "高频题 2：隔离级别与并发问题（脏读 / 不可重复读 / 幻读）",
    },
    {
      type: "paragraph",
      text: "答题框架：先给四个隔离级别及其解决的问题：读未提交（Read Uncommitted）可能脏读，读已提交（Read Committed / RC）解决脏读但可能不可重复读，可重复读（Repeatable Read / RR）解决不可重复读，可串行化（Serializable）解决全部（包括幻读）——它用锁把所有并发事务串行化实现。三个问题定义：脏读 = 读到别人未提交的修改；不可重复读 = 同一事务内两次读同一行，值变了（别人改了并提交）；幻读 = 同一事务内两次范围查询，行数变了（别人插入了新行，或满足条件的行数变化）。注意区分不可重复读（同一行被改）和幻读（行集合新增/减少）。",
    },
    {
      type: "callout",
      variant: "note",
      title: "追问点：MySQL 默认隔离级别是什么？",
      body: "InnoDB 默认隔离级别是可重复读（REPEATABLE READ）。这是与很多其它数据库（如 PostgreSQL 默认 RC）不同的地方。面试常追问「为什么 MySQL 用 RR 还能基本解决幻读」，见下一题。",
    },
    {
      type: "heading",
      text: "高频题 3：InnoDB 为什么 RR 还能基本解决幻读？",
    },
    {
      type: "paragraph",
      text: "答题框架：可重复读只承诺「解决不可重复读」，理论上不解决幻读；InnoDB 在 RR 下通过「MVCC 快照读 + next-key 锁的当前读」两条腿基本消除幻读。① 快照读（一致性非锁定读）：普通 SELECT 在 RR 下读到的是事务第一个快照点的一致性视图，其它事务之后插入的新行根本不在这个视图里，因此快照读不会看到幻行。② 当前读（锁定读）：UPDATE / DELETE / SELECT ... FOR UPDATE / LOCK IN SHARE MODE 读的是最新已提交版本，靠 next-key 锁（行锁 + 间隙锁）锁住扫描区间，阻止其它事务向该区间插入新行，从而在锁定读下也不产生幻读。要点：InnoDB 的 RR「基本」解决幻读，靠的就是这两者，而不是 RR 定义本身。",
    },
    {
      type: "heading",
      text: "高频题 4：快照读 vs 当前读，读的是什么数据？",
    },
    {
      type: "paragraph",
      text: "答题框架：快照读（snapshot read）= 普通不带锁的 SELECT，读的是基于 undo log 版本链构造的一致性快照，不加锁、不阻塞别的写，是 InnoDB 高并发读的主要途径；在 RC 下每次语句都取一个新快照，在 RR 下同一事务内复用第一个快照（这就是 RR 能保证可重复读的原因）。当前读（current read）= UPDATE / DELETE / INSERT 以及 SELECT ... FOR UPDATE / LOCK IN SHARE MODE，读取最新的已提交数据并加锁，是「先读后写」的正确基础。记住一句话：快照读靠 MVCC 不阻塞，当前读靠锁保证看到最新状态。",
    },
    {
      type: "heading",
      text: "高频题 5：MVCC 原理（读视图 + undo 版本链）",
    },
    {
      type: "paragraph",
      text: "答题框架：MVCC（多版本并发控制）让读写不互斥。核心是「一行存在多个历史版本」：每次 UPDATE 会先把旧版本写入 undo log，形成以事务为节点的版本链，每行还有隐藏的 trx_id 和 roll_pointer 等字段。读的时候，事务会生成一个「读视图（read view / 一致性视图）」，记录当前活跃事务列表等信息；据此判断版本链上每个版本的可见性：能看到「在创建视图前已提交」的版本，看不到「视图创建后提交或尚未提交」的版本。据此沿 undo 版本链找到对当前事务可见的那个版本，一次性完成读取。事务提交、隔离级别不同，决定读视图的生成时机（RC 每语句建、RR 首条语句建复用）。",
    },
    {
      type: "heading",
      text: "高频题 6：行锁 / 表锁 / 间隙锁 / next-key 锁",
    },
    {
      type: "paragraph",
      text: "答题框架：先给两种粗粒度锁：表锁（整张表加锁，锁开销小但并发差，MyISAM 只有表锁；InnoDB 有表锁出现在 DDL、LOCK TABLES 等少数场景）与行锁（InnoDB 提供，锁粒度细、并发高）。再按 InnoDB 的锁定方式展开：① 记录锁（record lock）锁住一行；② 间隙锁（gap lock）锁住一个区间（不含端点），目的是阻止其它事务在区间内插入，这是解决 RR 下当前读幻读的关键；③ next-key 锁 = 记录锁 + 它前面的间隙锁，是 InnoDB RR 下默认的锁定单位，既锁行又锁住其前方区间；④ 插入意向锁等其它锁通常不是面试必须展开的。别忘了提意向锁（intention lock）：表上加意向锁，标记「有事务在行上加锁」，让表级锁与行锁之间能互斥协作。",
    },
    {
      type: "heading",
      text: "高频题 7：死锁的成因与处理",
    },
    {
      type: "paragraph",
      text: "答题框架：死锁（deadlock）= 两个或多个事务各自持有一部分锁、又都在等待对方持有的锁，形成循环等待，谁都无法推进。InnoDB 的处理：① 有死锁检测（deadlock detection），检测到循环后「牺牲」其中一个事务，回滚它并抛出 Deadlock 错误（innodb_deadlock_detect 默认开启，回滚代价最小的那个）；② 在高并发下也可用锁等待超时（innodb_lock_wait_timeout）兜底。规避手段：按一致的顺序访问表/行（避免 A 先锁 t1 再锁 t2 而 B 反过来）、尽量缩短事务、一次尽量获取所需全部锁、用唯一索引减少间隙锁范围、合理设计隔离级别。加分点：能说出「两个 UPDATE 交叉加锁产生死锁」这个典型案例，以及 `SHOW ENGINE INNODB STATUS` 能看最近一次死锁信息。",
    },
    {
      type: "heading",
      text: "高频题 8：一条 UPDATE 是如何加锁的？",
    },
    {
      type: "paragraph",
      text: "答题框架：以 `UPDATE orders SET status='paid' WHERE user_id=7 AND status='pending'` 为例（id 为主键，user_id 有二级索引 idx_user）。① 这属于当前读，先按 WHERE 扫描定位行；② 命中行时加 next-key 锁/记录锁：对二级索引 idx_user 上命中的记录加锁（含其前方区间，RR 下），并给对应的聚簇索引主键记录加 record lock，防止并发修改/删除；③ 如果条件唯一（如按主键 id 直接命中），通常只需加聚簇索引记录锁，锁更少；④ 若不满足条件的行（status 已非 pending）会被释放，加锁窗口尽量小；⑤ 更新的数据写入后会同步刷 undo 版本并生成 redo 日志。面试加分点是讲清楚「先二级索引加锁，再对聚簇索引加锁」这个顺序，以及「RR 下范围条件会扩大为间隙锁，条件越具体锁越小」。",
    },
    {
      type: "heading",
      text: "自测",
    },
    {
      type: "quiz",
      question: "InnoDB 默认的隔离级别是？",
      options: [
        "读未提交（Read Uncommitted）",
        "读已提交（Read Committed）",
        "可重复读（Repeatable Read）",
        "可串行化（Serializable）"
      ],
      answer: 2,
      explanation: "InnoDB 默认隔离级别是可重复读（RR）。PostgreSQL 等默认 RC，但 MySQL/InnoDB 是 RR。",
    },
    {
      type: "quiz",
      question: "关于「不可重复读」与「幻读」的区别，正确的是？",
      options: [
        "两者完全相同，只是叫法不同",
        "不可重复读是同一行数据在两次读取间被修改，幻读是同一范围在两次读取间行集发生变化（出现/消失）",
        "不可重复读只发生在读未提交级别，幻读只发生在可串行化级别",
        "幻读指读到别的未提交事务的数据"
      ],
      answer: 1,
      explanation: "不可重复读针对同一行的值变化；幻读针对满足条件的结果集合数量变化。A 错误，C 错误（两者在高隔离级别下才会被『解决』而非『只发生』），D 描述的是脏读。",
    },
    {
      type: "quiz",
      question: "在 RR 隔离级别下，下面哪条语句属于「当前读」（会加锁并读取最新数据）？",
      options: [
        "SELECT id FROM orders WHERE user_id = 7",
        "SELECT total_amount FROM orders WHERE id = 9",
        "SELECT id FROM orders WHERE user_id = 7 FOR UPDATE",
        "普通不带锁的 SELECT，且采用一致性快照"
      ],
      answer: 2,
      explanation: "SELECT ... FOR UPDATE 是显式当前读，会加锁并读取最新已提交数据。普通 SELECT 是快照读（A、B、D 都是快照读场景）。",
    },
    {
      type: "quiz",
      question: "关于 InnoDB 的 next-key 锁，下列说法正确的是？",
      options: [
        "next-key 锁只锁住一行记录本身，不涉及前后区间",
        "next-key 锁 = 记录锁 + 记录前端的间隙锁，是 RR 下默认的锁定单位，可阻止向区间内插入新行避免当前读幻读",
        "next-key 锁只在可串行化级别存在",
        "next-key 锁与行锁无关，是一种表级锁"
      ],
      answer: 1,
      explanation: "next-key 锁由记录锁与它前方区间（间隙锁）组成，RR 下默认使用，来阻止当前读的幻读。A 忽略了间隙部分，C 错（RR 下已有 next-key），D 错（它属于行锁体系）。",
    },
    {
      type: "quiz",
      question: "在 InnoDB 中，MySQL 的「快照读」在 RR 级别下读取的是？",
      options: [
        "每次语句读取最新已提交的全局数据",
        "本事务第一个一致性读时建立的读视图（快照），同一事务内保持一致",
        "未提交事务写入的脏数据",
        "整张表的物理拷贝"
      ],
      answer: 1,
      explanation: "RR 下，事务内首个一致性读建立读视图并被复用，因此整个事务看到同一快照——这正是 RR 消除不可重复读的原理。A 是 RC 逐语句取新快照，C 是脏读，D 不存在。",
    },
    {
      type: "keypoints",
      items: [
        "ACID：A 靠 undo，I 靠锁+MVCC，D 靠 redo+WAL，C 是其余三者保证的目标",
        "隔离级别：RU→脏读；RC→不可重复读；RR→不可重复读；Serializable→所有（含幻读）；InnoDB 默认 RR",
        "InnoDB 的 RR 靠「MVCC 快照读 + next-key 锁当前读」基本消除幻读",
        "快照读=普通 SELECT，读一致性快照不加锁；当前读=UPDATE/DELETE/FOR UPDATE，读最新并加锁",
        "MVCC=读视图+undo 版本链，按可见性沿版本链取可见版本",
        "InnoDB 行锁体系：记录锁、间隙锁、next-key（记录锁+前方间隙）、意向锁",
        "死锁=循环等待；InnoDB 死锁检测牺牲一个事务回滚，也可靠锁超时；规避见上",
        "一条 UPDATE 走当前读：先对二级索引加锁，再对聚簇索引加锁，RR 范围条件扩为间隙锁",
      ],
    },
  ],
};
