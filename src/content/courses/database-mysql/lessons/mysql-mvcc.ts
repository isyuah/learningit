/* ==================================================================
 * 课时：MVCC：快照读、读视图与 undo log（mysql-mvcc）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-mvcc",
  courseSlug: "database-mysql",
  title: "MVCC：快照读、读视图与 undo log",
  summary: "InnoDB 如何用多版本让普通 SELECT 不加锁、且保持一致性读。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课说：InnoDB 在 REPEATABLE READ 下，普通 SELECT 既不阻塞、又能让同一事务多次读到一致结果。这听起来像魔法——不加锁怎么保证一致性？答案是多版本并发控制（MVCC, Multi-Version Concurrency Control）。它的核心思想是：不通过「挡住别人」来保证一致，而是给同一行保存多个历史版本，让每个事务按自己的「读视图」选择该看到的版本。这一课把这个机制讲透：快照读 vs 当前读、隐藏列、undo 版本链、读视图与可见性判定。",
    },
    {
      type: "heading",
      text: "一句话抓住 MVCC",
    },
    {
      type: "paragraph",
      text: "MVCC 让「读者不挡写者、写者不挡读者」。InnoDB 里：普通的 `SELECT` 是**快照读（一致性读 / consistent read）**，它读取某个时刻的一致性快照，**不加任何锁**，因此永远不会阻塞正在写入的其它事务，也不会被别的写事务阻塞。而 `UPDATE` / `DELETE` / `INSERT` 以及 `SELECT ... FOR UPDATE`、`SELECT ... LOCK IN SHARE MODE`（8.0 也叫 `FOR SHARE`）是**当前读（current read）**，它们必须读取**最新已提交**的版本并加锁。这是本课最重要、也是面试最常考的一个区分。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "「SELECT 都不加锁」是错的",
      body: "更精确的说法是：**普通的 plain SELECT 才是快照读、不加锁**。一旦你在 SELECT 后面跟了 `FOR UPDATE` 或 `LOCK IN SHARE MODE`（FOR SHARE），它就变成当前读、需要加锁。面试若被问「MySQL 的 SELECT 加锁吗」，先分快照读与当前读两类来答，才不会被追问住。",
    },
    {
      type: "heading",
      text: "行的多版本从哪来：隐藏列 + undo log 版本链",
    },
    {
      type: "paragraph",
      text: "InnoDB 的每行记录除了用户定义的列，还带有几个系统隐藏列（innodb 内部字段，用户 SELECT * 看不到）：\n\\- **DB_TRX_ID（行版本事务 id）**：最近一次修改（插入/更新）这行的事务 id；\n\\- **DB_ROLL_PTR（回滚指针）**：指向 undo log 里该行上一个版本的位置；\n\\- （另外还有隐藏主键 DB_ROW_ID，用于没有主键的表，这里不展开）。\n\n每次 UPDATE 并不会覆盖旧值，而是生成一个「新版本」，并把旧版本连同回滚指针链起来。这个由 undo log 支撑的、按时间先后串联的版本链，就是「多版本」的物理载体。",
    },
    {
      type: "code",
      title: "版本链的直观示意（伪代码，非真实 SQL）",
      language: "text",
      code: "product(id=1) 的 stock 依次被 T1、T2、T3 修改后，形成版本链：\n\n  最新版本 <-- T3: stock=7   (trx_id=103)\n     ^\n  前一个版本  <-- T2: stock=9   (trx_id=102)\n     ^\n  更早版本    <-- T1: stock=10  (trx_id=101)\n     ^\n  初始版本                           (insert 时的 trx_id=100)\n\n每行通过 DB_ROLL_PTR 指向上一个版本；undo log 保存被覆盖的前值\n用于构造旧版本，也用于事务回滚时反向恢复。",
    },
    {
      type: "callout",
      variant: "note",
      title: "undo log 的双重用途",
      body: "同一份 undo log 版本链既服务于 MVCC（构造旧版本供快照读），也服务于原子性（事务回滚时把数据恢复成修改前）。所以上一课说「原子性靠 undo log」，本课说「快照靠 undo 版本链」——它们用的是同一底层机制。",
    },
    {
      type: "heading",
      text: "读视图（Read View）：你只能看到谁",
    },
    {
      type: "paragraph",
      text: "快照读要回答的问题是：给定一个版本链，这个事务应该看到哪一个版本的 `stock`？InnoDB 的策略是用**读视图（read view）** 记录「我发起快照读这一刻，哪些事务还在活跃（未提交）」。当快照读遍历某行的版本链时，它沿着链从新到旧找第一个「对我可见」的版本。",
    },
    {
      type: "paragraph",
      text: "读视图维护一个「活跃事务 id 列表」和一些边界，核心判定逻辑（概念上）如下：\n\\- 若版本的 `DB_TRX_ID` 等于**创建这个读视图的事务自身**的 id → 可见（我自己的修改当然能看到）；\n\\- 若版本的 `DB_TRX_ID` **小于**读视图记录的最低活跃事务 id（`up_limit_id` 概念，即所有已提交事务的区间）→ 这个版本在我创建视图前就已提交 → 可见；\n\\- 若版本的 `DB_TRX_ID` **大于**读视图记录的最高事务 id（`low_limit_id` 概念，即未来可能出现的 id）→ 这个版本在我创建视图之后才产生 → 不可见；\n\\- 若 `DB_TRX_ID` 落在活跃事务列表 `m_ids` 中 → 这是尚未提交的事务，我做快照读时不应看到它的改动 → 不可见；\n\\- 若 `DB_TRX_ID` 不在 `m_ids` 中但处于活跃区间内 → 该事务虽在我之后开始但已经提交 → 可见。\n\n实际会沿版本链从最新往回遍历，直到找到第一个满足「可见」的版本。",
    },
    {
      type: "code",
      title: "读视图可见性判定（概念伪代码，帮助理解而非真实源码）",
      language: "text",
      code: "for 版本 v in 版本链(从最新到最旧):\n    trx = v.DB_TRX_ID\n    if trx == 我的事务id:        return v        # 我自己的修改\n    if trx < up_limit_id:        return v        # 视图创建前已提交\n    if trx in m_ids(活跃列表):    continue       # 未提交事务，跳过\n    if trx >= low_limit_id:      continue       # 未来，跳过\n    return v                                    # 其它已提交情况\n\n读到可用的旧版本后即返回；若一直找不到才看成「不存在」。",
    },
    {
      type: "callout",
      variant: "note",
      title: "概念字段 vs 内部实现",
      body: "MVCV 课的可见性算法，教材里常提到 `up_limit_id`（当前活跃事务最小 id）和 `low_limit_id`（最大 id + 1 等）。它们是帮助理解的概念上界，InnoDB 内部具体实现以事务号与事务管理器的判定为准。面试讲清「比较版本事务 id 与读视图的活跃事务集合」即可，不必死记伪字段名。",
    },
    {
      type: "heading",
      text: "REPEATABLE READ 与 READ COMMITTED 的快照差别",
    },
    {
      type: "paragraph",
      text: "读视图的创建时机决定了「一致性」能维持多久，这正是两种隔离级别在快照读上的根本区别：\n\\- **REPEATABLE READ**：读视图在**事务第一次执行快照读时建立**，之后整个事务的所有快照读都复用这同一个视图。因此第二次读仍按同一视图判定可见性，即使其它事务已提交了修改，你也看不到它们——所以同一事务多次读同一行、同一范围，结果始终一致（消除了不可重复读，也让结果集行数稳定）。\n\\- **READ COMMITTED**：读视图在**每一条快照读语句开始时都重新建立**。所以两次 `SELECT` 之间其它事务提交的修改，在下一条语句里立刻可见——同一事务内两次读可能不同（出现不可重复读）。\n\n这是回答「InnoDB 怎么实现可重复读」的关键一句话。",
    },
    {
      type: "table",
      caption: "两种隔离级别下快照读的区别",
      headers: ["维度", "REPEATABLE READ", "READ COMMITTED"],
      rows: [
        ["读视图建立时机", "事务第一次快照读时，之后复用", "每条 SELECT 语句开始都重建"],
        ["同事务多次读", "一致（同视图）", "可能变化"],
        ["加锁", "普通 SELECT 不加锁（快照读）", "普通 SELECT 不加锁"],
        ["能否看到其它事务新提交", "看不到（视图固化）", "每条语句都能看到最新已提交"],
      ],
    },
    {
      type: "heading",
      text: "快照读 vs 当前读：什么时候必须加锁",
    },
    {
      type: "paragraph",
      text: "快照读解决了「读」的并发问题，但它读到的可能是**旧版本**。当需要「读到最新数据并真正加锁以防并发修改」时，必须用当前读。区分很直接：\n\\- **快照读（不加锁）**：普通 `SELECT`。\n\\- **当前读（加锁）**：`UPDATE`、`DELETE`、`INSERT`，以及 `SELECT ... FOR UPDATE`（排他锁 X）和 `SELECT ... LOCK IN SHARE MODE` / `FOR SHARE`（共享锁 S）。当前读读取最新已提交版本，并对其加锁，直到事务结束才释放。\n\n这也解释了为什么「先 SELECT 再 UPDATE」会出问题：那个普通的 SELECT 是快照读，看到的可能是旧库存，随后当前读 UPDATE 再按旧值扣减就会丢更新。正确作法是直接对要改的行做当前读加锁（FOR UPDATE）或用一条原子 UPDATE。",
    },
    {
      type: "code",
      title: "当前读示例：扣库存需要 FOR UPDATE 锁住目标行",
      language: "sql",
      code: "START TRANSACTION;\n\n-- 当前读：锁定该商品行直到提交，防止别人并发扣同一库存\nSELECT stock FROM product WHERE id = 100 FOR UPDATE;\n-- 在应用里判断 stock 是否够\n\nUPDATE product SET stock = stock - 1 WHERE id = 100;\n\nINSERT INTO orders (user_id, status, total_amount)\nVALUES (7, 'pending', 2899.00);\n\nCOMMIT;",
    },
    {
      type: "callout",
      variant: "warning",
      title: "快照读与当前读是两种世界观",
      body: "同一事务里，快照读和当前读看到的数据可以不一致：快照读看自己的旧视图，当前读看最新已提交。不要假设「我事务里 SELECT 到的就是最新的」。需要最新且要防并发冲突时，用 FOR UPDATE / LOCK IN SHARE MODE 的当前读，并结合事务控制保证锁的释放时机。",
    },
    {
      type: "heading",
      text: "MVCC 与加锁隔离级别的互补",
    },
    {
      type: "paragraph",
      text: "MVCC 让「一致性读」不需要锁，从而读不挡写、写不挡读，这是 InnoDB 高并发读的底气。但 MVCC 只管「读旧版本」；要阻止「当前读之间互相冲突」「插入幻影行」这类问题，仍需要锁。于是 InnoDB 把两套机制组合起来：普通 SELECT 走 MVCC 快照（无锁），写操作与 FOR UPDATE / FOR SHARE 走加锁的当前读。下一课「锁机制」就专门讲那套当前读用的锁体系——行锁、间隙锁、next-key 锁。",
    },
    {
      type: "quiz",
      question: "在 MySQL / InnoDB 中，下面哪个属于「当前读」（需要加锁）？",
      options: [
        "普通的 SELECT ... FROM product",
        "SELECT stock FROM product WHERE id = 100 FOR UPDATE",
        "SELECT COUNT(*) FROM orders",
        "不带任何锁的只读查询",
      ],
      answer: 1,
      explanation: "FOR UPDATE 把 SELECT 变为当前读，会加排他锁并读取最新已提交数据。普通 SELECT 是快照读、不加锁。",
    },
    {
      type: "quiz",
      question: "REPEATABLE READ 能保证同一事务多次快照读结果一致，根本原因是？",
      options: [
        "每次 SELECT 都锁定整张表",
        "事务第一次快照读时建立读视图并复用，后续都按同一视图判定可见性",
        "其它事务被禁止提交",
        "MySQL 会缓存整张表的查询结果",
      ],
      answer: 1,
      explanation: "RR 下读视图在事务第一次快照读时建立并复用，后续快照读都按同一读视图判定可见性，所以看不到之后提交的修改，结果一致。（注意与查询缓存无关，8.0 已移除缓存。）",
    },
    {
      type: "quiz",
      question: "「先 SELECT 库存再 UPDATE 扣减」为什么在并发下会丢更新？",
      options: [
        "因为 SELECT 没有走索引",
        "因为普通 SELECT 是快照读，读到的可能是旧库存，随后 UPDATE 再基于旧值计算",
        "因为 UPDATE 会失败",
        "因为表被锁住了无法修改",
      ],
      answer: 1,
      explanation: "普通 SELECT 是快照读，可能读到旧版本库存；之后的 UPDATE 是当前读。两个并发事务都基于旧库存各自扣减，就会丢更新。应改用 FOR UPDATE 当前读直接锁定目标行，或用一条原子的条件 UPDATE。",
    },
    {
      type: "exercise",
      title: "分析两个并发扣库存事务的可见性",
      description: "两张并发事务同时执行「SELECT stock ... FOR UPDATE → 判断 → UPDATE stock-1 → COMMIT」。请用本课的快照读/当前读、读视图概念，解释为什么 FOR UPDATE 能防止叠加扣减、而普通 SELECT 不能；并说明若把 FOR UPDATE 换成普通 SELECT 会发生什么。",
      hint: "对比快照读（读旧版本、不加锁）与当前读（读最新、加锁）在并发下的行为差异。",
    },
    {
      type: "keypoints",
      items: [
        "MVCC = 多版本并发控制：读不挡写、写不挡读",
        "普通 SELECT 是快照读（不加锁）；UPDATE/DELETE/INSERT 与 FOR UPDATE/FOR SHARE 是当前读（加锁）",
        "隐藏列 DB_TRX_ID（版本事务 id）+ DB_ROLL_PTR（回滚指针）支撑行多版本",
        "undo log 版本链既供 MVCC 构造旧版本，也供回滚实现原子性",
        "读视图记录活跃事务集合，按版本 trx_id 与视图判定可见性",
        "RR 复用第一次快照读的读视图；RC 每条语句重建读视图",
        "需要最新数据并防并发时用当前读 FOR UPDATE,而不是普通 SELECT",
      ],
    },
  ],
};
