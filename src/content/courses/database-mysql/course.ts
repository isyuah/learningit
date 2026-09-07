/* ==================================================================
 * 课程：MySQL 数据库系统学习与面试（database-mysql）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "database-mysql",
  title: "MySQL 数据库系统学习与面试",
  tagline: "从原理到面试的系统化路径",
  description:
    "面向已经会写基本 SQL（CRUD、过滤、排序、聚合、JOIN、GRANT 权限）的学习者，系统补齐从「会查」到「懂原理、能面试」的完整能力。课程以 MySQL / InnoDB 为主线：先快速回顾关系模型并建立「一条查询如何执行」的整体心智模型，再深入数据建模、高级 SQL、B+ 树索引、事务与 ACID、隔离级别、MVCC、锁机制、存储引擎与日志、查询优化与工程实践。\n\n全程以一套贯穿始终的「电商订单库」示例数据展开，每一节都有可直接运行的 SQL、交互测验与动手练习。最后一章面试冲刺，把索引、事务/隔离/锁、存储引擎/日志/复制与数据库设计四类高频面试题整理成「考点 + 答题框架 + 追问点」，让你既能理解又能开口作答。\n\n内容以现代 MySQL 5.7 / 8.0 + InnoDB 为基准，版本敏感的行为会明确标注。",
  level: "intermediate",
  hours: 12,
  learners: 0,
  coverIndex: "06",
  coverColor: "primary",
  updatedAt: "2026-02",
  outcomes: [
    "建立数据库整体架构与「一条查询如何执行」的心智模型",
    "会做规范化的表设计，并理解范式与反范式的取舍",
    "掌握子查询、CTE、窗口函数与聚合等高级 SQL",
    "理解 B+ 树索引、聚簇/二级索引，并为真实查询设计索引、读懂 EXPLAIN",
    "掌握事务、ACID、隔离级别与 MVCC、锁机制，能分析并发正确性",
    "理解 InnoDB 存储引擎、redo/undo log 与 WAL、binlog 复制",
    "会定位慢查询并完成常见性能优化",
    "能把工程实践（事务边界、SQL 注入、连接池、备份）用对",
    "系统刷完四类高频数据库面试题，具备开口答题的能力",
  ],
  chapters: [
    {
      id: "foundation",
      title: "关系模型与数据库架构",
      intro: "快速回顾你已经掌握的 SQL 基础，并建立「一条查询如何执行」的整体心智模型——它是理解后面所有章节的骨架。",
      lessons: [
        {
          slug: "mysql-relational-model",
          title: "关系模型：表、行、键与关系",
          minutes: 16,
          kind: "reading",
        },
        {
          slug: "mysql-db-architecture",
          title: "一条查询如何执行：数据库整体架构",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-sql-foundations",
          title: "SQL 基础快速回顾：CRUD、过滤、聚合与 JOIN",
          minutes: 22,
          kind: "reading",
        },
      ],
    },
    {
      id: "advanced-sql",
      title: "SQL 精进与高级查询",
      intro: "在 CRUD 之上，补齐真实业务与面试都需要的高级查询能力。",
      lessons: [
        {
          slug: "mysql-subqueries-cte",
          title: "子查询与 CTE：把查询拆成可思考的块",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-window-functions",
          title: "窗口函数：排行、累计与跨行计算",
          minutes: 22,
          kind: "reading",
        },
        {
          slug: "mysql-aggregation-advanced",
          title: "GROUP BY / HAVING 聚合进阶",
          minutes: 18,
          kind: "reading",
        },
        {
          slug: "mysql-dml-transactions",
          title: "写入 DML 与事务细节：INSERT / UPDATE / DELETE",
          minutes: 20,
          kind: "reading",
        },
      ],
    },
    {
      id: "modeling",
      title: "数据建模与表设计",
      intro: "把「存什么、怎么存」想清楚：数据类型、范式与反范式、从需求到建表。",
      lessons: [
        {
          slug: "mysql-normalization",
          title: "范式：1NF / 2NF / 3NF 与反范式",
          minutes: 22,
          kind: "reading",
        },
        {
          slug: "mysql-schema-design",
          title: "表设计实战：需求到建表与常见反模式",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "mysql-data-types",
          title: "数据类型与字段设计选择",
          minutes: 16,
          kind: "reading",
        },
      ],
    },
    {
      id: "indexes",
      title: "索引与存储结构",
      intro: "索引是 MySQL 性能的核心。这一章从 B+ 树讲透：为什么用 B+ 树、聚簇与二级索引、如何设计与读懂执行计划。",
      lessons: [
        {
          slug: "mysql-index-btree",
          title: "B+ 树索引：为什么是 B+ 树",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-clustered-secondary",
          title: "聚簇索引与二级索引：回表是怎么发生的",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-index-design",
          title: "索引设计：最左前缀与如何为查询建索引",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "mysql-index-advanced",
          title: "覆盖索引、索引下推与失效陷阱",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-explain",
          title: "EXPLAIN：读懂执行计划",
          minutes: 24,
          kind: "reading",
        },
      ],
    },
    {
      id: "transactions",
      title: "事务、隔离与并发控制",
      intro: "从 ACID 到隔离级别、MVCC 与锁——数据库并发正确性的核心，也是面试的重灾区。",
      lessons: [
        {
          slug: "mysql-acid",
          title: "事务与 ACID：为什么需要事务",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-isolation-levels",
          title: "隔离级别：脏读、不可重复读与幻读",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "mysql-mvcc",
          title: "MVCC：快照读、读视图与 undo log",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "mysql-locking",
          title: "锁机制：表锁、行锁、间隙锁与 next-key",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "mysql-deadlock",
          title: "死锁：成因、检测与规避",
          minutes: 20,
          kind: "reading",
        },
      ],
    },
    {
      id: "engine-logs",
      title: "存储引擎与日志机制",
      intro: "InnoDB 的架构、redo/undo log 与 WAL、binlog 复制——理解数据如何落盘、如何恢复、如何复制。",
      lessons: [
        {
          slug: "mysql-engine-innodb",
          title: "存储引擎对比与 InnoDB 架构",
          minutes: 22,
          kind: "reading",
        },
        {
          slug: "mysql-redo-undo-wal",
          title: "redo / undo log 与 WAL、崩溃恢复",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "mysql-binlog-replication",
          title: "binlog 与主从复制",
          minutes: 22,
          kind: "reading",
        },
      ],
    },
    {
      id: "performance",
      title: "查询优化与性能",
      intro: "把学到的东西用于真实问题：定位慢查询、针对常见场景优化、管理连接池。",
      lessons: [
        {
          slug: "mysql-slow-query",
          title: "慢查询定位与优化流程",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-optimization-patterns",
          title: "常见优化场景：分页、JOIN、count 与批量",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "mysql-connection-pool",
          title: "连接池与高并发连接管理",
          minutes: 18,
          kind: "reading",
        },
      ],
    },
    {
      id: "engineering",
      title: "工程实践与安全",
      intro: "让数据库在真实系统里跑得正确、安全、可恢复。",
      lessons: [
        {
          slug: "mysql-transaction-practice",
          title: "事务工程最佳实践",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-sql-injection",
          title: "SQL 注入与防御、权限与 GRANT",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-backup-operations",
          title: "备份、恢复与运维基础",
          minutes: 18,
          kind: "reading",
        },
      ],
    },
    {
      id: "interview",
      title: "面试冲刺",
      intro: "把全课知识按面试考点重新组织：高频题、答题框架与追问点，帮你真的开口答出来。既有数据库自身的机制（索引/事务/锁/引擎/日志/复制），也涵盖后端面试常考的数据库相关系列话题（乐观锁、缓存一致性、分库分表、读写分离）。",
      lessons: [
        {
          slug: "mysql-interview-index",
          title: "面试：索引高频题与答题框架",
          minutes: 22,
          kind: "quiz",
        },
        {
          slug: "mysql-interview-transaction",
          title: "面试：事务 / 隔离 / 锁高频题",
          minutes: 24,
          kind: "quiz",
        },
        {
          slug: "mysql-interview-engine",
          title: "面试：存储引擎 / 日志 / 复制高频题",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "mysql-interview-design",
          title: "面试：数据库设计与场景题",
          minutes: 22,
          kind: "reading",
        },
        {
          slug: "mysql-interview-optimistic-lock",
          title: "面试：乐观锁 vs 悲观锁",
          minutes: 18,
          kind: "reading",
        },
        {
          slug: "mysql-interview-cache-consistency",
          title: "面试：数据库与缓存一致性",
          minutes: 22,
          kind: "reading",
        },
        {
          slug: "mysql-interview-sharding",
          title: "面试：分库分表与分布式",
          minutes: 22,
          kind: "reading",
        },
        {
          slug: "mysql-interview-replica-consistency",
          title: "面试：读写分离与主从一致性",
          minutes: 20,
          kind: "reading",
        },
      ],
    },
  ],
};
