/* ==================================================================
 * 课时：死锁：成因、检测与规避（mysql-deadlock）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-deadlock",
  courseSlug: "database-mysql",
  title: "死锁：成因、检测与规避",
  summary: "两个事务互相等待对方持有的锁，InnoDB 如何发现并解决，以及如何在源头规避。",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一课的锁机制告诉我们：只要有一方持排他锁，另一方相同或共享锁的请求就要等待。当两个事务各自持有一把锁、又都在等对方手里的那把锁时，就形成了**循环等待**——谁也等不到、谁也走不动，这就是死锁（deadlock）。这一课讲清死锁的成因与判定，InnoDB 如何自动发现并解决它，以及更重要的：怎么在设计上规避它。",
    },
    {
      type: "heading",
      text: "死锁的本质：循环等待资源",
    },
    {
      type: "paragraph",
      text: "死锁产生的四个必要条件（全部同时满足）：互斥（资源/行锁一次只被一个事务持有）、持有并等待（事务已持有一把锁，又去请求第二把锁）、不可剥夺（已持有的锁不能被强制拿走，必须由持有者自己释放）、循环等待（存在一个等待环，T1 等 T2、T2 等 T1，或更长的环）。数据库里最常见的是「两个事务以相反顺序锁定同一组资源」触发的两行循环等待。",
    },
    {
      type: "heading",
      text: "一个教科书式的两事务死锁",
    },
    {
      type: "paragraph",
      text: "我们用电商的 `product` 商品表构造死锁：T1 先锁 id=1 再想锁 id=2，T2 先锁 id=2 再想锁 id=1。T1 持有了 1 号商品、等待 2 号；T2 持有了 2 号商品、等待 1 号——两个事务互相等对方手里的资源，谁都等不到。",
    },
    {
      type: "table",
      caption: "两个转账事务互锁",
      headers: ["时刻", "T1", "T2"],
      rows: [
        ["t1", "UPDATE product SET stock=stock-1 WHERE id=1;（持有 id=1 的 X 锁）", "UPDATE product SET stock=stock-1 WHERE id=2;（持有 id=2 的 X 锁）"],
        ["t2", "UPDATE product SET stock=stock-1 WHERE id=2;（等待 T2 释放）", "UPDATE product SET stock=stock-1 WHERE id=1;（等待 T1 释放）"],
        ["t3", "相互等待，死锁形成", "相互等待，死锁形成"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "死锁的典型来源：加锁顺序不一致",
      body: "同样的两步操作，只要**全局统一加锁顺序**（大家都先锁 id 小、再锁 id 大），T1 和 T2 就会排队而不是互等，死锁就不会发生。业务代码里「每条事务自己决定先锁哪一行」是最常见的死锁诱因（例如两条相反方向的转账）。",
    },
    {
      type: "heading",
      text: "InnoDB 如何检测并处理死锁",
    },
    {
      type: "paragraph",
      text: "InnoDB 会持续维护事务之间的**等待关系图（wait-for graph）**：节点是事务，有向边表示「等待该事务持有的锁」。当图中出现**环**时，就说明存在死锁。InnoDB 默认开启死锁检测（`innodb_deadlock_detect` 默认为 ON），一旦检测到环，会挑选一个**代价最小**的事务作为受害者（victim）回滚，让它释放锁，从而打破循环；另一事务得以继续。被回滚的事务会收到一个明确的错误（MySQL 报错：Deadlock found ... Try restarting transaction），需要应用层重试。",
    },
    {
      type: "code",
      title: "死锁被检测后，应用侧会收到的错误",
      language: "text",
      code: "ERROR 1213 (40001): Deadlock found when trying to get lock;\ntry restarting transaction",
    },
    {
      type: "callout",
      variant: "tip",
      title: "回滚的是整个事务",
      body: "死锁检测回滚的是整个事务（不是只回滚出问题的那条语句），所以你在事务里已做的修改都会撤销——应用必须把整个事务当成可重试的单位来处理。这也是很多人建议「用极短的事务」的原因：事务越短，出错的成本越低。",
    },
    {
      type: "heading",
      text: "用 SHOW ENGINE INNODB STATUS 分析死锁",
    },
    {
      type: "paragraph",
      text: "排查死锁时，最常用的命令是 `SHOW ENGINE INNODB STATUS`。它会输出一段引擎状态，其中最靠后的 `LATEST DETECTED DEADLOCK` 一节记录了最近一次死锁的两个事务各自持有什么锁、正在等待什么锁，以及谁被判定为受害者。结合业务日志，你通常能定位到是哪两条语句以相反顺序抢锁。",
    },
    {
      type: "code",
      title: "查看最近一次死锁信息",
      language: "sql",
      code: "SHOW ENGINE INNODB STATUS\\G\n-- 输出末尾的 LATEST DETECTED DEADLOCK 段落给出:\n--  *) 两个事务分别持有的锁\n--  *) 各自等待的锁\n--  *) WE ROLL BACK TRANSACTION (...) 指明受害者",
    },
    {
      type: "callout",
      variant: "note",
      title: "死锁不是未提交的 bug",
      body: "死锁是 InnoDB 在正常并发下的固有现象，不是数据库故障。真正的问题在于「你的业务是否任由死锁发生」：发生率高、且没有重试，就会表现为偶发失败。规避死锁的正确姿势是「降低其发生概率 + 失败后重试」，而不是指望永远不发生。",
    },
    {
      type: "heading",
      text: "如何规避死锁：五位一体的工程实践",
    },
    {
      type: "list",
      items: [
        "统一加锁顺序：所有事务按固定顺序（例如按主键升序）锁定多行，消除循环等待",
        "把事务做短：缩小事务边界，减少同时持有的锁数量和持有时间",
        "少持锁：尽量少访问行、少用范围锁；必要时降级隔离级别（如 RC 不用 next-key 锁）",
        "确保走索引：让 WHERE 命中索引，确保只锁必要的行，而不是全表扫描时锁大量行",
        "失败重试：对死锁错误捕获后再执行一次整个事务",
      ],
    },
    {
      type: "paragraph",
      text: "前四点是从源头降低死锁概率，第五点是兜底。特别强调「统一加锁顺序」和「让事务走索引锁必要的行」这两点，因为它们在电商扣库存、转账这类高频并发写里最常见也最有效。降级隔离级别是把双刃剑：RC 的 next-key 锁更少、死锁少，但会失去 RR 的部分读一致性，要按业务要求取舍。",
    },
    {
      type: "heading",
      text: "案例：一次转账死锁的分析与修复",
    },
    {
      type: "paragraph",
      text: "场景：`accounts` 表（这里用 user 表模拟账户），实现 `transfer(from, to, amount)`。若两个请求同时发生「A→B」和「B→A」，各自先 `UPDATE from 扣款`、后 `UPDATE to 加款`，就会以相反顺序锁定 A 与 B，形成死锁。",
    },
    {
      type: "paragraph",
      text: "**修复方案**：进入事务后先对涉及的账户（A、B）按固定顺序排序加锁——例如一律 `WHERE id IN (A, B) ORDER BY id` 或先对较小 id 加 `SELECT ... FOR UPDATE`，保证两个方向的事务锁顺序一致，死锁自然消失。同时把「余额校验 + 扣款 + 加款」压缩在极短事务里，失败则整事务重试。",
    },
    {
      type: "code",
      title: "规避转账死锁：先按固定顺序锁账户",
      language: "sql",
      code: "START TRANSACTION;\n-- 无论方向如何,都先锁 id 较小的账户,再锁较大的,顺序全局一致\nSELECT ... FROM user WHERE id IN (A, B) ORDER BY id FOR UPDATE;\n\n-- 校验 from 余额\nUPDATE user SET balance = balance - :amount WHERE id = :from;\nUPDATE user SET balance = balance + :amount WHERE id = :to;\n\nCOMMIT;\n-- 应用层捕获死锁错误后,整事务重试",
    },
    {
      type: "quiz",
      question: "下面哪种做法最直接地消除「以相反顺序锁定多个资源」引起的死锁？",
      options: [
        "把事务做得更长以等待对方释放",
        "全局统一多行加锁的顺序",
        "把隔离级别从 RR 提到 SERIALIZABLE",
        "在事务里多读几行以提前拿锁",
      ],
      answer: 1,
      explanation: "统一加锁顺序后不会出现 T1 等 T2、T2 等 T1 的循环等待。加长事务、高隔离级别只会增加锁与死锁风险。",
    },
    {
      type: "quiz",
      question: "InnoDB 检测到死锁后通常如何处理？",
      options: [
        "让两个事务都等待更久",
        "死锁无法解决，只能重启数据库",
        "回滚代价较小的一个事务作受害者，另一事务继续",
        "自动把死锁事务升级为最高优先级先执行",
      ],
      answer: 2,
      explanation: "InnoDB 用 wait-for graph 检测环，挑代价最小的事务回滚打破循环，被回滚事务报 1213 错误、需应用重试。",
    },
    {
      type: "exercise",
      title: "分析扣库存中的死锁并给出修复",
      description: "两个并发事务各自要「先锁商品 id=100、再锁订单商品 id=101」的减库存操作。请画出它们的等待关系，判断是否可能死锁，并给出两种修复：统一加锁顺序、以及缩短/合并操作减少总持有锁数。说明你会用 SHOW ENGINE INNODB STATUS 里的哪个段落确认问题。",
      hint: "画出 T1、T2 的锁与等待；修复重点是让两边以相同顺序获取锁。",
    },
    {
      type: "keypoints",
      items: [
        "死锁 = 循环等待：互斥 + 持有并等待 + 不可剥夺 + 循环",
        "最常见成因：两个事务以相反顺序锁定同一组资源",
        "InnoDB 用 wait-for graph 检测环，回滚代价最小的事务作受害者",
        "被回滚事务报 ERROR 1213，必须整体重试",
        "SHOW ENGINE INNODB STATUS 的 LATEST DETECTED DEADLOCK 段用于分析",
        "规避：统一加锁顺序、短事务、少持锁、走索引锁必要行、失败重试",
      ],
    },
  ],
};
