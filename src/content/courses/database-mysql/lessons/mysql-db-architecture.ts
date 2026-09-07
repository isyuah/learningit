/* ==================================================================
 * 课时：一条查询如何执行：数据库整体架构（mysql-db-architecture）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-db-architecture",
  courseSlug: "database-mysql",
  title: "一条查询如何执行：数据库整体架构",
  summary: "建立一条 SQL 从客户端到磁盘的完整执行心智模型。",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "你有没有想过：当你敲下一条 SELECT，数据库内部到底发生了什么？«会写 SQL» 和 «懂 MySQL» 的分水岭，往往就在这里——能否把一条语句的旅程拆成一个个有名字、有职责的阶段。这一节只讲一个核心问题：一条 SQL 是如何从客户端走到磁盘再返回结果的。这个骨架是整门课的导航图：索引、事务、MVCC、日志，全都挂在它上面。",
    },
    {
      type: "heading",
      text: "整体旅程：一句话版本",
    },
    {
      type: "paragraph",
      text: "先给出一句话：客户端把 SQL 文本发给 MySQL，经过「连接器 → 分析器 → 优化器 → 执行器」四个 SQL 层阶段，再由执行器调用存储引擎（InnoDB）去读写磁盘页，最后把结果返回客户端。存储引擎负责真正碰数据，而分析、优化这些工作与「具体怎么存」无关。这条「SQL 层与存储引擎分离」的边界，是理解 MySQL 的关键。",
    },
    {
      type: "code",
      title: "一段激励性示例：这条语句会走完整条流水线",
      language: "sql",
      code: "-- 一条很普通的查询，却是理解整条流水线的最佳入口\nSELECT u.name, o.total_amount\nFROM user u\nJOIN orders o ON o.user_id = u.id\nWHERE u.email = 'ming@shop.com'\n  AND o.status = 'paid'\nORDER BY o.created_at DESC\nLIMIT 10;",
    },
    {
      type: "callout",
      variant: "note",
      title: "关键心智：SQL 层不直接碰磁盘",
      body: "连接、解析、优化都属于「SQL 层」，它们只处理语句本身，不知道数据存在哪个文件哪一页。真正读写磁盘、加锁、记录、事务的是「存储引擎层」。后面你会看到，同一句 SELECT，换一个存储引擎行为可能不同——这正是两层分离的结果。",
    },
    {
      type: "heading",
      text: "第一站：连接器（Connector）",
    },
    {
      type: "paragraph",
      text: "SQL 到达 MySQL 的第一个阶段是建立与验证连接。连接器做的事包括：校验用户名密码、维护当前会话权限集合、管理连接。之后这条连接上的每一次操作都要在它建立的权限范围内进行。注意「连接」和「一个查询」的粒度完全不同——一个 TCP 连接可以在它的生命周期里执行成千上万条语句，这就是为什么真实应用用「连接池」复用连接而不是每条查询新建一个。",
    },
    {
      type: "code",
      title: "连接与权限校验仍然需要的 DCL",
      language: "sql",
      code: "-- 连接时：客户端用账号密码连接；服务端校验其权限\n-- 创建并授权一个只读账号（与另一课 GRANT 对应）\nCREATE USER 'reporter'@'%' IDENTIFIED BY 'secret';\nGRANT SELECT ON shop.* TO 'reporter'@'%';\n\n-- 建立连接后，此账号只能 SELECT，无法 INSERT/UPDATE\nSELECT * FROM orders WHERE id = 1001; -- 允许\n-- UPDATE orders SET status='cancelled' WHERE id=1001; -- 会被拒绝",
    },
    {
      type: "paragraph",
      text: "权限校验有个面试常考的细节：权限是「连接建立时」加载进会话的。如果你用一个已连接的账号去 `GRANT` 提升另一个人权限，那个人的旧连接不会立刻感知——要重新连接才生效。这是理解权限与连接关系的好例子。",
    },
    {
      type: "heading",
      text: "第二站：查询缓存（Query Cache）——注意，8.0 已移除",
    },
    {
      type: "paragraph",
      text: "在 MySQL 5.7（及其更早版本）里，SQL 层曾有一个「查询缓存」：把 SELECT 语句的文本当作 key，缓存结果集，完全相同的语句再次执行就直接命中返回，跳过解析和执行。看起来很美，但它在 MySQL 8.0 已被**彻底移除**，在 5.7.20 起被标记为 deprecated。",
    },
    {
      type: "paragraph",
      text: "为什么会被移除？因为它的命中率极低且维护成本高：任何一张相关表的写操作都会让涉及它的整块缓存失效（失效粒度是表级的），而写入多的系统里缓存几乎刚写入就失效。更糟的是，查询缓存维护还引入了全局的锁竞争。现代 MySQL 里你不要指望「查询缓存」，正确做法是业务层的缓存或下面章节的覆盖索引——这也正是我们把查询缓存放在这里只是「提一句它不存在」的原因。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "面试要点：MySQL 8.0 没有查询缓存",
      body: "如果你在面试中回答「MySQL 用查询缓存来加速完全相同的查询」，在 8.0 语境下这是错的。8.0 移除了查询缓存；缓存正确性由业务层（如 Redis）或应用层承担。请勿把它当作当前行为来教或学。",
    },
    {
      type: "heading",
      text: "第三站：分析器（Parser）",
    },
    {
      type: "paragraph",
      text: "接下来是词法与语法分析。分析器先把 SQL 文本切成 token（词法分析），再按 MySQL 的语法规则拼成一棵「语法树」（语法分析），并检查：表名是否存在、列名是否存在、语法是否合法。这一阶段出错会抛出「语法错误」或「Unknown column」这类报错——你写错列名时看到的错误，大多来自这里。",
    },
    {
      type: "code",
      title: "分析器会抓到的两类错误",
      language: "sql",
      code: "SELECT nam FROM user WHERE id = 1;     -- 错误 1：列名 nam 不存在（Unknown column）\n\nSELEKT * FROM user;                   -- 错误 2：语法错误（near 'SELEKT'）\n\n-- 正确写法\nSELECT name FROM user WHERE id = 1;",
    },
    {
      type: "heading",
      text: "第四站：优化器（Optimizer）",
    },
    {
      type: "paragraph",
      text: "通过解析后，语句交到优化器。查询优化器不执行查询，它决定「怎么执行最快」——它要选出执行计划（Execution Plan）：走哪个索引、表与表的连接顺序、Join 用什么算法、条件下推怎么做。因为「同样一条 SQL」可以被翻译成很多种执行方式，而代价可能差几个数量级，这一步就是性能的分水岭。",
    },
    {
      type: "paragraph",
      text: "最典型的优化是「选择执行顺序」。对刚才那条 JOIN，是先过滤 user 再连接，还是先过滤 orders？优化器根据统计信息（行数、基数）估算每种方案的代价，选一个它认为最小的。这也是为什么后面「索引」「EXPLAIN」章节如此重要——你写索引和统计信息的质量，直接决定优化器有没有好牌可打。",
    },
    {
      type: "code",
      title: "用 EXPLAIN 看优化器选出的执行计划",
      language: "sql",
      code: "-- EXPLAIN 不真正执行查询，只展示优化器选定的执行计划\nEXPLAIN SELECT u.name, o.total_amount\nFROM user u\nJOIN orders o ON o.user_id = u.id\nWHERE u.email = 'ming@shop.com';\n\n-- 关注 type / key / rows 三列：走的索引、扫描行数、预估代价\n-- type=ref 表示走二级索引等值匹配，通常说明索引用得好",
    },
    {
      type: "heading",
      text: "第五站：执行器（Executor）",
    },
    {
      type: "paragraph",
      text: "拿到执行计划后，执行器开始真正干活：它逐行（或按计划批量）调用存储引擎的接口去读取数据，再在 SQL 层做过滤、连接、排序、聚合、投影，最后把结果返回客户端。执行器是「SQL 层与存储引擎层之间的调度者」——它不负责数据到底存在哪，但负责按计划驱动引擎、把引擎返回的行加工成结果。",
    },
    {
      type: "paragraph",
      text: "一个容易被混在一起的区分：**分析器/优化器/执行器属于 SQL 层，InnoDB 是存储引擎层**。执行器位于两层交界处——它向 InnoDB 要行，InnoDB 把行给执行器。理解这个分工，你就明白了为什么同一个 InnoDB 引擎可以同时服务 SELECT 和事务，也明白了后文「一次写操作路径」其实主要是存储引擎层的工作。",
    },
    {
      type: "heading",
      text: "SQL 层 vs 存储引擎层的分工",
    },
    {
      type: "table",
      caption: "SQL 层与存储引擎层的职责划分",
      headers: ["层次", "负责什么", "不负责什么"],
      rows: [
        ["连接器", "鉴权、会话、连接", "数据读写"],
        ["分析器", "词法/语法解析、对象校验", "选择执行方案"],
        ["优化器", "代价估算、生成执行计划", "真的去读数据"],
        ["执行器", "按计划调度引擎、过滤/排序/聚合", "数据在磁盘的存储格式"],
        ["InnoDB", "页读写、索引、锁、事务、日志落盘", "SQL 语法与优化"],
      ],
    },
    {
      type: "heading",
      text: "存储引擎与页 / 磁盘",
    },
    {
      type: "paragraph",
      text: "流水线的最后一站是存储引擎真正去碰数据。InnoDB 不按「行」直接读磁盘，而是按「页」（Page）为单位读写——页是 InnoDB 与磁盘交换数据的最小单位，默认大小 16KB，具体取舍留到「InnoDB 架构」章节。数据并不是每查一次都回磁盘：InnoDB 维护一个内存缓冲池（Buffer Pool），经常用到的页缓存在内存里，命中就不碰磁盘。",
    },
    {
      type: "code",
      title: "一次普通 SELECT 的磁盘视角",
      language: "sql",
      code: "-- 若行所在的页已在 Buffer Pool，则内存命中，零磁盘 I/O\n-- 若页不在内存，则从磁盘把整页读入后再返回该行\nSELECT * FROM product WHERE id = 1;\n\n-- 观察 IO 与缓存现状（8.0 语法，5.7 略有差异）\nSHOW ENGINE INNODB STATUS;               -- 可看到 log / buffer pool 概览\n-- SELECT * FROM performance_schema  ...  -- 更细的指标可查 performance_schema",
    },
    {
      type: "callout",
      variant: "tip",
      title: "页、缓冲池是后面所有性能话题的根源",
      body: "为什么「读 1 行」常常比「读 1 页里很多行」贵不了太多？为什么索引设计能减少磁盘读？根源都在「以页为单位、以内存缓冲池为缓存」。这一节先记住两个结论：InnoDB 读磁盘的最小单位是页；频繁访问的数据会留在 Buffer Pool。",
    },
    {
      type: "heading",
      text: "SELECT 与 UPDATE 的路径差在哪",
    },
    {
      type: "paragraph",
      text: "把整体的 SELECT 旅程刻进脑子后，我们预告一条重要对比：**SELECT 和 UPDATE 的前半段（连接、解析、优化）几乎一样，真正的区别在「执行」这一站之后**。SELECT 走到执行器，调用 InnoDB 读页、可能借助索引，然后返回；而 UPDATE 在执行写之前，InnoDB 还要做一系列「写路径」的事：对目标行（以及相关区间）加锁、写 undo log（用于回滚与 MVCC）、改内存中的页并标记为脏页、写 redo log（WAL，保证崩溃可恢复），之后才在后台把脏页刷回磁盘。",
    },
    {
      type: "paragraph",
      text: "也就是说，架构上的分水岭在于：**SELECT 主要关心「读得快」——索引、覆盖索引、缓冲池；UPDATE 还要关心「写得对且可恢复」——锁、undo log、redo log 与 WAL**。这正好对应后两批章节的主题：索引章节解决「读」，事务/锁/日志章节解决「写」。现在你有了一个位置感：后面每个主题你都能回答「它发生在流水线的哪一站、属于哪一层」。",
    },
    {
      type: "code",
      title: "UPDATE 会额外触发的写路径（此处只示意）",
      language: "sql",
      code: "-- 一条 UPDATE 除了优化器/执行器，还会触发 InnoDB 的写路径\nUPDATE product SET stock = stock - 1 WHERE id = 1;\n\n-- 写路径示意（由 InnoDB 内部完成，非直接 SQL）\n-- 1) 对 id=1 的行加行锁\n-- 2) 写 undo log（用于回滚与 MVCC 快照）\n-- 3) 修改 Buffer Pool 中的页，标记为脏页\n-- 4) 写 redo log（WAL：先写日志再落盘，崩溃时靠它恢复）\n-- 5) 后台异步把脏页刷回磁盘",
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么「先写日志再改数据」也叫 WAL",
      body: "WAL（Write-Ahead Logging，预写日志）指：在对数据页落盘之前，先把这次修改追加到 redo log。即便系统崩溃，重启时也能靠 redo log 把丢失的修改重放回来——所以性能上可以用顺序追加日志换随机刷盘，正确性上又不丢数据。这是「日志与崩溃恢复」章节的核心。",
    },
    {
      type: "quiz",
      question: "在 MySQL 8.0 中，关于「查询缓存」正确说法是？",
      options: [
        "完全相同的查询会命中查询缓存，显著加速",
        "查询缓存仍在但默认关闭",
        "查询缓存已被移除，不应指望它",
        "查询缓存主要加速 UPDATE 语句",
      ],
      answer: 2,
      explanation:
        "MySQL 8.0 彻底移除了查询缓存（5.7.20 起 deprecated）。查询缓存只缓存 SELECT 且维护成本高，8.0 删除了这一机制。",
    },
    {
      type: "exercise",
      title: "画出并标注一条 UPDATE 的完整旅程",
      description:
        "拿 `UPDATE orders SET status='shipped' WHERE id=1001` 这条语句，按顺序写出它经过的每一个阶段（连接器→分析器→优化器→执行器→InnoDB），并在每个阶段标注「这属于 SQL 层还是存储引擎层」「这一阶段会不会直接读磁盘」。最后指出：相比 SELECT，UPDATE 在执行阶段之后多了哪几步关键动作。",
      hint: "分层判断标准：分析/优化永远在 SQL 层；锁、undo、redo、页读写永远在 InnoDB。UPDATE 的关键增量是「加锁 + undo + redo（WAL）」这组写路径动作。",
    },
    {
      type: "keypoints",
      items: [
        "一条 SQL 的旅程：连接器 → 分析器 → 优化器 → 执行器 → InnoDB → 页/磁盘",
        "查询缓存在 MySQL 8.0 已移除，5.7.20 起 deprecated，不要当作当前行为",
        "分析器负责语法与对象校验，优化器负责选执行计划，执行器负责调度执行",
        "SQL 层不碰磁盘；读写数据、加锁、日志都是存储引擎（InnoDB）的职责",
        "InnoDB 以页为最小读写单位，Buffer Pool 把常用页缓存进内存",
        "SELECT 重「读」（索引/覆盖/缓冲池），UPDATE 额外重「写」（锁/undo/redo + WAL）",
      ],
    },
  ],
};
