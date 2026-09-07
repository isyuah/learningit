/* ==================================================================
 * 课时：面试——乐观锁 vs 悲观锁（mysql-interview-optimistic-lock）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 本节把「乐观锁 vs 悲观锁」整理成面试答题框架：定义、实现、
 * 适用场景与取舍，并衔接课程里已讲的当前读/行锁与扣库存例子。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "mysql-interview-optimistic-lock",
  courseSlug: "database-mysql",
  title: "面试：乐观锁 vs 悲观锁",
  summary: "两类并发控制策略的定义、三种实现、适用场景与取舍——以及面试最容易追问的边界。",
  minutes: 18,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "乐观锁和悲观锁是并发控制的两种思路，但很多面试者分不清「它们到底是不是数据库的锁」。这一节先把概念、实现、适用场景讲透，再用面试高频问法串一遍，并说清它和课程前面「行锁、当前读、MVCC」这些数据库机制的关系。",
    },
    {
      type: "heading",
      text: "一句话区分：默认怕不怕冲突",
    },
    {
      type: "paragraph",
      text: "悲观锁（Pessimistic Lock）：默认认为并发冲突很频繁，所以「先上锁再操作」，操作期间不允许别人动，直到提交才释放。这种思路是数据库锁的天然形态。乐观锁（Optimistic Lock）：默认认为冲突很少，所以「先不加锁，等写入那一刻再检查有没有被别人改过」——没改就写，改了（版本冲突）就拒绝或重试。",
    },
    {
      type: "table",
      caption: "悲观锁 vs 乐观锁",
      headers: ["维度", "悲观锁", "乐观锁"],
      rows: [
        ["默认假设", "冲突频繁", "冲突很少"],
        ["是否先加锁", "先锁后操作", "不加锁，提交时检查"],
        ["典型实现", "行锁、SELECT ... FOR UPDATE、LOCK IN SHARE MODE", "版本号 / CAS（比较并交换）"],
        ["冲突处理", "等待（阻塞）", "失败后重试或回退"],
        ["适用数据特点", "写多、冲突频繁", "读多写少、冲突少"],
      ],
    },
    {
      type: "heading",
      text: "一个核心澄清：乐观锁是数据库的「锁」吗？",
    },
    {
      type: "callout",
      variant: "warning",
      title: "这是面试最容易被追问的点",
      body: "悲观锁是数据库内建的机制（InnoDB 的行锁、当前读），由引擎实现；乐观锁严格说不是 MySQL 的一个「锁类型」——它是应用层**借用数据库的原子更新 + WHERE 条件**自己实现的一种并发控制策略，具体的版本号维护、冲突后重试逻辑都要应用代码来写。答的时候要分清：数据库提供的是「原子 UPDATE / 条件更新」这些底层能力，乐观锁是建立在其上的上层方案。",
    },
    {
      type: "heading",
      text: "乐观锁的两种主流实现",
    },
    {
      type: "paragraph",
      text: "实现一：版本号（最常见）。表里加一列 version，每次更新时 `WHERE version = 旧版本` 且把 `version = version + 1`，若受影响行数为 0，说明期间版本被改过，需要重新读取再试。实现二：CAS / 时间戳。用时间戳或某个业务字段做比较，本质和版本号一样——「读取时记住一个值，写入时要求它仍然等于这个值」。",
    },
    {
      type: "code",
      title: "版本号实现的乐观锁",
      language: "sql",
      code: "-- 读时拿到 stock=10, version=5\nUPDATE product\nSET stock  = stock - 1,\n    version = version + 1\nWHERE id = 100 AND version = 5;   -- 期望版本仍是 5\n-- 若影响行数 = 1：成功\n-- 若影响行数 = 0：version 已被别人改成 6，本次失败，需要重试",
    },
    {
      type: "heading",
      text: "悲观锁的典型实现：与课程里的当前读衔接",
    },
    {
      type: "paragraph",
      text: "悲观锁走的是我们在「锁机制」课讲的**当前读**：`SELECT ... FOR UPDATE` 加排他锁、锁住目标行直到事务结束；写入的 UPDATE / DELETE 本身就是加行锁的当前读。它的优点是简单可靠、语义直接；缺点是锁竞争明显、事务要短、吞吐受限于串行化。",
    },
    {
      type: "code",
      title: "悲观锁的扣库存写法",
      language: "sql",
      code: "START TRANSACTION;\n-- 当前读：锁住该商品行，直到提交才释放\nSELECT stock FROM product WHERE id = 100 FOR UPDATE;\n-- 应用里判断 stock 是否够\nUPDATE product SET stock = stock - 1 WHERE id = 100;\nCOMMIT;",
    },
    {
      type: "heading",
      text: "在「电商扣库存」上做对比",
    },
    {
      type: "paragraph",
      text: "扣库存是这两者最常被拿出来对比的场景，也和课程「并发扣库存 / 超卖」一脉相承：悲观锁用 `FOR UPDATE` 锁行后扣减，简单可靠但并发高时大量事务排队、吞吐受限；乐观锁用 `UPDATE product SET stock = stock - ? WHERE id = ? AND stock >= ?`（带条件的原子更新，本质是 CAS）或版本号，失败就重试，并发高但冲突频繁时重试成本高。另外要能提到「纯原子表达式 `stock = stock - 1`」配合 `AND stock >= ?` 这种条件更新其实是乐观思路的一种——它不额外建版本号，靠「判断条件在数据库内原子完成」实现防超卖。",
    },
    {
      type: "heading",
      text: "什么时候选哪个",
    },
    {
      type: "list",
      items: [
        "写频繁、冲突率高：用悲观锁，避免大量重试让系统反复空转",
        "读多写少、冲突率低：用乐观锁，不加锁、读不阻塞，并发吞吐高",
        "业务要求强一致顺序：悲观锁更直观",
        "能接受「失败后重试」且冲突不频繁：乐观锁更省资源",
        "数据竞争温和但想减少锁开销：乐观锁（版本号）更合适",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "追问点：乐观锁失败了一定要重试吗？",
      body: "不一定。重试是一种策略，但更严谨的做法是判断「这次冲突是不是真的需要再次尝试」——例如扣库存冲突说明别人已经改了库存，直接重试可能拿到新值后再扣，需要结合业务决定；有些场景（如余额扣减）冲突后应让用户感知或走补偿，而不是无条件循环重试（会放大写压力甚至打满数据库）。",
    },
    {
      type: "heading",
      text: "自测",
    },
    {
      type: "quiz",
      question: "乐观锁和悲观锁最本质的区别是？",
      options: [
        "乐观锁是 MySQL 内建的锁类型，悲观锁不是",
        "乐观锁默认认为冲突少、不加锁，靠提交时的版本/条件检查来避免旧数据覆盖；悲观锁默认认为冲突多、先加锁",
        "悲观锁只在只读场景使用",
        "乐观锁永远比悲观锁并发高",
      ],
      answer: 1,
      explanation: "核心差异在「默认假设」与「加锁时机」：乐观锁默认冲突少、不加锁、提交时检查（版本/CAS）；悲观锁默认冲突多、先加锁。A 说反了，乐观锁不是 MySQL 内建的锁类型。",
    },
    {
      type: "quiz",
      question: "下面哪种写法属于「乐观锁」（无显式先加锁、靠条件/版本防覆盖）？",
      options: [
        "SELECT stock FROM product WHERE id = 100 FOR UPDATE 后再 UPDATE",
        "UPDATE product SET stock = stock - 1 WHERE id = 100 AND version = 5",
        "与悲观锁毫无区别",
        "LOCK TABLES product WRITE",
      ],
      answer: 1,
      explanation: "带 version 条件、影响行数为 0 即失败的写法是标准乐观锁（版本号/CAS）。A 是先加锁的悲观锁；D 是表级悲观锁。",
    },
    {
      type: "quiz",
      question: "在一个读多写少、冲突很少的业务里，选乐观锁的理由是？",
      options: [
        "乐观锁一定不会失败",
        "不加锁的读取并发高、无锁等待，且冲突少时重试代价低，整体吞吐更高",
        "悲观锁无法保证一致性",
        "乐观锁能减少磁盘占用",
      ],
      answer: 1,
      explanation: "读多写少时乐观锁的读不加锁、互不影响，且冲突少所以重试少见，综合吞吐优于悲观锁。C/D 不成立。",
    },
    {
      type: "keypoints",
      items: [
        "悲观锁：默认怕冲突，先加锁再操作——数据库行锁/当前读是典型形态",
        "乐观锁：默认不怕冲突，提交时用版本号/CAS 检查，失败重试——是应用层方案，非 MySQL 内建锁",
        "乐观锁实现：version 字段 + WHERE version = ?，影响行数 0 即冲突",
        "悲观锁实现：SELECT ... FOR UPDATE / 行锁",
        "选型：写多冲突多用悲观锁；读多写少冲突少用乐观锁",
        "扣库存是两者的经典对比场景；带条件原子更新是乐观思路的一种",
      ],
    },
  ],
};
