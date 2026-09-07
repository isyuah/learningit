/* ==================================================================
 * 课时：面试——存储引擎 / 日志 / 复制高频题（mysql-interview-engine）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 本节把存储引擎、redo/undo/binlog 与主从复制整理成面试 Q/A。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-interview-engine",
  courseSlug: "database-mysql",
  title: "面试：存储引擎 / 日志 / 复制高频题",
  summary: "InnoDB vs MyISAM、redo/undo/binlog 三日志、WAL、binlog 格式、主从复制与延迟——存储与日志层面的高频考点与答题框架。",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "这一节把「存储引擎、日志机制、主从复制」这三块整理成面试 Q/A。它们和协议、取舍相关：redo/undo/binlog 三者极易被混淆，主从复制常被误当成备份。我们的组织方式是每题给出「答题框架」，最后用一张表对比三类日志，再用测验自检。",
    },
    {
      type: "heading",
      text: "高频题 1：InnoDB 和 MyISAM 有什么区别？",
    },
    {
      type: "paragraph",
      text: "答题框架：先给定位——InnoDB 是 MySQL 5.5 起的默认引擎，支持事务与崩溃恢复；MyISAM 是旧引擎，不支持事务。然后从几个维度对比，记住「事务、行级锁、崩溃恢复」三个关键差异：InnoDB 支持事务（ACID）、支持行级锁（高并发写友好）、支持外键、有 redo/undo log 可在崩溃后恢复；MyISAM 不支持事务、只有表级锁（并发写差）、无外键、崩溃后恢复靠重建索引（REPAIR TABLE，慢且可能丢最近修改）。存储方式上：InnoDB 数据与索引常放在同一表空间（聚簇），MyISAM 把 .frm（表定义）/ .MYD（数据）/ .MYI（索引）分开。结论：几乎永远选 InnoDB，MyISAM 只在极少数「只读、无事务需求」的场景还有意义，现代版本基本可以忽略。",
    },
    {
      type: "table",
      caption: "InnoDB vs MyISAM（要点）",
      headers: ["维度", "InnoDB", "MyISAM"],
      rows: [
        ["事务 / ACID", "支持", "不支持"],
        ["锁粒度", "行级锁为主", "表级锁"],
        ["外键", "支持", "不支持"],
        ["崩溃恢复", "redo log 恢复", "无日志，重启后 REBUILD/检查"],
        ["数据/索引存储", "聚簇，同一表空间为主", ".frm/.MYD/.MYI 分离"],
        ["默认地位", "MySQL 默认引擎", "旧引擎，不推荐新用"],
      ],
    },
    {
      type: "heading",
      text: "高频题 2：redo log、undo log、binlog 分别是什么？",
    },
    {
      type: "paragraph",
      text: "答题框架：这三者最容易被问混，关键是先分清「层级」和「用途」。redo log（重做日志）在存储引擎层（InnoDB），记录「物理/页面层面的修改」，用于崩溃后重放以保证持久性（D）；undo log（回滚日志）也在引擎层，记录「修改前的旧值」，用于回滚（A）和 MVCC 版本链。binlog（二进制日志）在 Server 层，记录的是逻辑层面的事件（语句/行的变更），MySQL 自己不靠它做崩溃恢复，它用于主从复制和数据恢复（PITR）。再强调一句预防混淆的话：redo 是「落盘前先记账，崩溃后重放」的持久化机制；binlog 是「复制给从库 / 做时间点恢复」的逻辑日志，两者职责不同。",
    },
    {
      type: "table",
      caption: "三类日志对比",
      headers: ["日志", "所在层", "记录什么", "核心用途"],
      rows: [
        ["redo log", "InnoDB 引擎层", "物理页面的修改", "崩溃恢复、持久性（D）"],
        ["undo log", "InnoDB 引擎层", "修改前的旧值/版本链", "回滚（A）、MVCC"],
        ["binlog", "Server 层", "逻辑变更事件（语句/行）", "主从复制、PITR 恢复"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "追问点：redo 和 binlog 能混吗？",
      body: "不能混。redo 是引擎层的物理重做日志、服务于崩溃恢复与持久性；binlog 是 Server 层的逻辑日志、服务于复制与时间点恢复。它们内容不同、写入时机和依赖的事务提交顺序也不同（binlog 在事务提交时单独写出）。如果面试官追问更深的「两阶段提交（redo prepare → 写 binlog → redo commit）」细节，只有在你确实理解底层机制时再展开；否则明确说 binlog 是在事务提交阶段由 Server 层单独写入的即可，不要硬编造。",
    },
    {
      type: "heading",
      text: "高频题 3：什么是 WAL？为什么需要它？",
    },
    {
      type: "paragraph",
      text: "答题框架：WAL（Write-Ahead Logging，预写日志）= 在真正修改数据页之前，先把这次修改记录追加到 redo log 里。为什么这样设计？因为数据库不可能每次提交都直接把数据页随机写回磁盘（随机 IO 慢，且页没被修改完可能就崩溃）。先顺序写追加的 redo 日志（顺序 IO 很快），事务提交时只要 redo 落盘即可算成功；之后数据页可以在内存 buffer pool 里异步刷盘。一旦崩溃，用已落盘的 redo 重放、把还没刷到磁盘的修改补写回来，从而不丢已提交的数据。一句话：WAL 用「日志先行」换取随机写变顺序写、并保证崩溃后可重放，是持久性与性能之间的关键取舍。",
    },
    {
      type: "heading",
      text: "高频题 4：binlog 有哪几种格式？为什么默认 ROW？",
    },
    {
      type: "paragraph",
      text: "答题框架：binlog 有三种格式。① STATEMENT：记录执行的 SQL 语句本身，日志小，但非确定性问题（如 NOW()、UUID()、自增在不同库/从库执行结果可能不同）会导致主从不一致。② ROW：记录每一行实际变更（前/后镜像），日志较大但最精确、无函数不确定性，MySQL 5.7.7 起默认采用 ROW。③ MIXED：语句确定就用 STATEMENT，不确定就自动转 ROW，是两者的折中。默认 ROW 的原因：精确可靠、避免主从因函数/顺序不一致，代价是日志量更大。加分点：能提到 ROW 格式下闪回（用 binlog 反向解析）等恢复手段更可行，以及 binlog_row_image 等参数影响记录内容（版本相关，谨慎给数字）。",
    },
    {
      type: "heading",
      text: "高频题 5：主从复制原理？异步 vs 半同步 vs 同步？",
    },
    {
      type: "paragraph",
      text: "答题框架：主从复制的基本链路是「主库写 binlog → 从库 IO 线程拉取并写入自己的 relay log（中继日志）→ 从库 SQL 线程重放 relay log」。（MySQL 8.0 的复制基础设施有升级，如并行复制、基于 GTID，但这些是更深的点。）关于一致性强弱：默认是异步（async）复制——主库提交事务后不等待从库确认，性能最好，但主库崩溃时可能丢数据、从库可能滞后；半同步（semi-sync）复制——主库至少等待一个从库确认收到 binlog 后才返回提交成功，降低了丢数据的窗口，牺牲部分性能；同步复制在 MySQL 原生里没有（通常靠 PXC/Group Replication 等方式或分布式方案），不展开。答题要点：能讲清「异步默认、半同步可配、半同步降低丢数据但不等于零丢失」，以及 replication 链路三个角色。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "追问点：这句话对不对——「主从复制可以当备份」？",
      body: "不对，这是常见误区。主从复制解决的是「高可用 + 读写分离（读扩展）」，不是备份：如果主库上不小心 DELETE 或 DROP 一张表，这条 binlog 会原样同步到从库，从库也会被删。备份（备份 + binlog/快照）才能回到「误操作之前的某个时间点」。所以生产上主从复制与独立备份要同时具备，两者职责不同。",
    },
    {
      type: "heading",
      text: "高频题 6：主从延迟的原因与缓解？",
    },
    {
      type: "paragraph",
      text: "答题框架：主从延迟 = 从库重放日志的速度跟不上主库产生写入的速度。原因常见几类：主库写入量大、从库单线程重放（旧版本 CPU 用不满）、从库硬件比主库差、从库还在跑大量查询抢资源、大事务/一条超大 DML（如一次更新全表）长期占用重放等。缓解手段：优先讲「并行复制」（多线程复制）让从库并行重放不同库/组的事务，以及把大事务拆小、避免一次超大 DML；其次讲从库查询分流/只读副本（read replicas）多挂几台分散读；再次讲优化从库硬件、用半同步减少主从差距（不是缩短延迟本身，而是减少丢失窗口）。加分点：延迟本质是「异步带来的」，要强一致读就读主库或等从库追平，或用半同步作为一部分缓解。",
    },
    {
      type: "heading",
      text: "小结与自测",
    },
    {
      type: "paragraph",
      text: "把三层日志记牢：redo 保持久（引擎层、崩溃重放）、undo 保回滚与 MVCC（引擎层、旧值）、binlog 做复制与 PITR（Server 层、逻辑日志）。主从复制是异步复制链路，不是备份。下面用几道题自检。",
    },
    {
      type: "quiz",
      question: "关于 redo log 与 binlog，下列说法正确的是？",
      options: [
        "两者都是引擎层日志，用于崩溃恢复",
        "redo log 用于崩溃恢复与持久性，binlog 是 Server 层的逻辑日志，用于主从复制与 PITR",
        "binlog 属于 InnoDB，记录物理页面的修改",
        "redo log 用于回滚，binlog 用于崩溃恢复"
      ],
      answer: 1,
      explanation: "redo 在引擎层做崩溃恢复/持久性，binlog 在 Server 层做复制与时间点恢复，二者职责不同。A 把 binlog 错归引擎层，C 把 binlog 错归 InnoDB 物理日志，D 张冠李戴（回滚靠 undo）。",
    },
    {
      type: "quiz",
      question: "为什么需要 WAL（预写日志）？最关键的原因是？",
      options: [
        "为了压缩数据库文件节省磁盘空间",
        "把随机写变成顺序写 redo 日志，并在崩溃后能用 redo 重放恢复，兼顾性能与持久性",
        "为了加快 SELECT 查询速度",
        "为了让 binlog 与 redo 完全同步"
      ],
      answer: 1,
      explanation: "WAL 让「日志先行」：提交时先顺序写 redo，数据页异步刷盘，崩溃后用 redo 重放。它不是压缩、不是加速读、也不是让 binlog 与 redo 同步。",
    },
    {
      type: "quiz",
      question: "MySQL 5.7.7 起 binlog 的默认格式是？",
      options: [
        "STATEMENT",
        "MIXED",
        "ROW",
        "无 binlog"
      ],
      answer: 2,
      explanation: "从 5.7.7 起默认 binlog_format 为 ROW，因为 ROW 记录每行实际变更，避免语句格式带来的主从函数不确定性问题。",
    },
    {
      type: "quiz",
      question: "关于主从复制，下列说法正确的是？",
      options: [
        "默认是异步复制，主库提交后不等待从库确认",
        "主从复制可以完全替代日常备份",
        "半同步在主库提交前必须等所有从库都执行完 SQL 才返回",
        "主从复制能保证主库崩溃时主从完全不丢数据"
      ],
      answer: 0,
      explanation: "默认异步：主库事务提交不需要从库确认。B 错误（复制不是备份，误删会同步删从库）；C 错误（半同步只等一个从库「收到 binlog」，不等它执行完）；D 错误（异步下主库崩溃可能丢最近数据）。",
    },
    {
      type: "keypoints",
      items: [
        "InnoDB：事务、行锁、外键、崩溃恢复；MyISAM：无事务、表锁、无崩溃日志——几乎永远选 InnoDB",
        "redo=引擎层物理日志、保持久与崩溃重放；undo=引擎层旧值、回滚+MVCC；binlog=Server 层逻辑日志、复制与 PITR",
        "WAL=日志先行，顺序写 redo 换取随机写变顺序写，并可在崩溃后重放",
        "binlog：STATEMENT / ROW / MIXED；5.7.7 起默认 ROW，精确可靠但日志更大",
        "主从复制：主库写 binlog → 从库 IO 线程收 relay log → SQL 线程重放；默认异步，半同步降低丢数据窗口",
        "主从复制不是备份：误删会同步到从库；备份用于时间点恢复",
        "主从延迟：大事务、单线程重放、硬件差异、查询抢资源；用并行复制、拆小事务、多只读副本、读主库缓解",
      ],
    },
  ],
};
