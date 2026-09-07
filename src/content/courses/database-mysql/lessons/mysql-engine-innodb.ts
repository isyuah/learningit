/* ==================================================================
 * 课时：存储引擎对比与 InnoDB 架构（mysql-engine-innodb）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-engine-innodb",
  "courseSlug": "database-mysql",
  "title": "存储引擎对比与 InnoDB 架构",
  "summary": "理解 MySQL 的存储引擎抽象、InnoDB 与 MyISAM 的差异，以及 InnoDB 的表空间、缓冲池、change buffer 与 doublewrite 等核心架构。",
  "minutes": 22,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "前面几章我们一直在用「表」「索引」「事务」这些概念谈论 MySQL。但你可能没停下来想过一个问题：当你执行一条 INSERT 或 SELECT 时，「数据到底存在哪里、怎么落盘、怎么被索引」——这些事到底是谁在负责？答案是一层把「逻辑表」与「物理磁盘」连接起来的组件：存储引擎（Storage Engine）。本章我们先看清存储引擎这个抽象，再深入现代 MySQL 默认也是唯一的现实选择——InnoDB——的架构，为下一课的 redo/undo log 与 WAL、再下一课的 binlog 与复制打基础。"
    },
    {
      "type": "heading",
      "text": "存储引擎抽象：可插拔、按表指定"
    },
    {
      "type": "paragraph",
      "text": "MySQL 的表结构（schema）由 Server 层负责，而「这张表的数据如何存储、如何加锁、如何建索引、能否崩溃恢复」则由存储引擎决定。Server 层通过统一的接口调用引擎，因此引擎可以「插拔」。在 MySQL 中，你甚至可以在建表时按表指定引擎——同一实例下不同表可以用不同引擎。"
    },
    {
      "type": "code",
      "title": "建表时显式指定存储引擎",
      "language": "sql",
      "code": "-- 显式指定 InnoDB\nCREATE TABLE orders (\n  id BIGINT PRIMARY KEY AUTO_INCREMENT,\n  user_id BIGINT NOT NULL,\n  status VARCHAR(20) NOT NULL,\n  total_amount DECIMAL(10,2) NOT NULL,\n  created_at DATETIME NOT NULL,\n  KEY idx_user (user_id)\n) ENGINE = InnoDB;\n\n-- 查看某张表当前用的引擎\nSHOW TABLE STATUS LIKE 'orders';\n-- 或\nSELECT ENGINE FROM information_schema.TABLES\nWHERE TABLE_SCHEMA = 'shop' AND TABLE_NAME = 'orders';"
    },
    {
      "type": "paragraph",
      "text": "现代 MySQL（5.5 起）的默认引擎就是 InnoDB，所以你平时的建表语句不写 ENGINE 也默认落在 InnoDB 上。引擎是可以替换的技术分层，但正如我们即将看到的，不同引擎对事务、并发与恢复的承诺截然不同，选错会直接决定数据的安全性。"
    },
    {
      "type": "heading",
      "text": "InnoDB vs MyISAM：为什么 InnoDB 成为默认"
    },
    {
      "type": "paragraph",
      "text": "在 InnoDB 之前，MyISAM 曾是 MySQL 很长一段时间的默认引擎。它的优势是简单、查询快、索引结构简单、全表扫描快，但它有一个致命短板：不支持事务。理解 InnoDB 为什么取代它，比背一张对比表更有价值。"
    },
    {
      "type": "table",
      "caption": "InnoDB 与 MyISAM 核心差异（概述级）",
      "headers": ["能力", "InnoDB", "MyISAM"],
      "rows": [
        ["事务 / ACID", "支持，有 redo/undo log 与崩溃恢复", "不支持事务，无 ACID 保证"],
        ["锁粒度", "行锁（还有间隙锁、next-key 锁）", "表锁（整表锁定）"],
        ["崩溃恢复", "通过 redo log 恢复崩溃前已提交的事务", "无 WAL，崩溃后表可能损坏需修复"],
        ["外键约束", "支持 FOREIGN KEY", "不支持外键"],
        ["全文索引", "8.0 起 InnoDB 也支持 FULLTEXT", "传统强项，支持 FULLTEXT"],
        ["索引组织", "聚簇索引（数据按主键组织）", "堆表（索引与数据分离，非聚簇）"],
        ["适用场景", "写多、需要事务与并发控制的 OLTP", "历史遗留的读多、可承受崩溃风险场景"]
      ]
    },
    {
      "type": "paragraph",
      "text": "这张表背后其实是几个根本性的权衡。MyISAM 用「表锁」换简单：一次写整个表都锁住，并发写很差，但实现简单。它没有 WAL（预写日志），也没有崩溃恢复能力——这意味着如果进程在写入中途崩溃，表文件可能落在半写状态，需要工具去修复。对一个真实业务，尤其是电商订单库这种「绝对不允许丢订单、崩溃后要能恢复」的场景，MyISAM 的这些特性是不可接受的。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "MyISAM 在当代基本是遗留引擎",
      "body": "除非你有非常明确的理由（例如一整套只读的、无法迁移的历史系统），现代 MySQL 新项目一律选用 InnoDB。面试里提到 MyISAM 主要是为了对比说明「为什么 InnoDB 是默认」——不是鼓励你还用它。把时间花在理解 InnoDB 内部机制上，比花在 MyISAM 细节上回报更高。"
    },
    {
      "type": "quiz",
      "question": "关于 InnoDB 与 MyISAM，下列说法正确的是？",
      "options": [
        "两者都支持事务和外键，只是性能不同",
        "MyISAM 采用行锁并发更好，InnoDB 采用表锁",
        "MyISAM 不支持事务也没有崩溃恢复能力，InnoDB 支持事务并能通过 redo log 做崩溃恢复",
        "InnoDB 的索引和数据分开存放，是堆表"
      ],
      "answer": 2,
      "explanation": "MyISAM 无事务、用表锁且无 WAL 崩溃恢复；InnoDB 支持事务+redo log 恢复，采用聚簇索引（数据按主键组织）。"
    },
    {
      "type": "heading",
      "text": "磁盘 I/O 的最小单位：16KB 页"
    },
    {
      "type": "paragraph",
      "text": "在深入 InnoDB 架构前，先把一个贯穿全章的硬指标记住：InnoDB 对磁盘的读写是以「页（Page）」为单位的，默认一个页的大小是 16KB。无论你更新的是 1 个字节还是 1000 个字节，InnoDB 从磁盘读入、或写回磁盘的最小单位都是一个 16KB 的页。页是数据、索引、undo 等各类对象的公共容器。这个「最小单位」的设定决定了缓冲池缓存什么、doublewrite 为什么要存在，也会在下一课解释为什么事务提交时不能直接把页写回磁盘。"
    },
    {
      "type": "definition",
      "term": "页（Page）",
      "definition": "InnoDB 磁盘 I/O 与缓存的基本单位，默认 16KB。表和索引的数据、undo 记录等都存放在页中；缓冲池以页为单位缓存，doublewrite 也以页为单位处理。"
    },
    {
      "type": "heading",
      "text": "InnoDB 架构总览：数据放哪里"
    },
    {
      "type": "paragraph",
      "text": "InnoDB 的整体结构可以概括成「一份持久化在磁盘上的数据，加上一个常驻内存的缓存层，再加上保证持久性与并发正确性的一圈日志/机制」。我们先搭起这个地图，接下来逐个解释。"
    },
    {
      "type": "list",
      "items": [
        "表空间（Tablespace）：数据和索引最终落盘的物理载体，逻辑上按页组织",
        "索引组织表（Index-Organized Table）：数据按主键聚簇存放，二级索引通过主键回表",
        "缓冲池（Buffer Pool）：InnoDB 性能的心脏，缓存数据页的内存工作集",
        "Change Buffer：缓存对二级索引的随机写，延迟合并以优化随机插入",
        "redo / undo log：保证持久性与回滚/多版本（下一课详述）",
        "Doublewrite Buffer：让半页写入崩溃时也能保证页完整性"
      ]
    },
    {
      "type": "subheading",
      "text": "表空间与索引组织表"
    },
    {
      "type": "paragraph",
      "text": "InnoDB 把整张表的数据和它的聚簇索引放在一起——这就是「索引组织表」：表本身是按主键（通常是自增 id）有序排列的 B+ 树，叶子节点就是数据行。回忆索引章节里讲过的概念：主键→聚簇索引（数据所在），二级索引→回表。表空间配置（独立表空间还是共享表空间、文件大小）在不同的 MySQL 版本里配置方式不同，默认情况下每张 InnoDB 表对应独立表空间文件，但具体配置以你的版本与 `innodb_file_per_table` 等参数为准。"
    },
    {
      "type": "subheading",
      "text": "缓冲池：一切的读写都经过它"
    },
    {
      "type": "paragraph",
      "text": "缓冲池（Buffer Pool）是 InnoDB 里最重要的内存结构，可以理解为「数据库在内存里的工作集」。它按页缓存最近被读写的表数据与索引。背后的心智模型是一个简单的理想：磁盘很慢、内存相对快，我们想让尽可能多的热数据待在内存里。"
    },
    {
      "type": "list",
      "items": [
        "读：先从缓冲池找目标页，命中就直接返回（内存操作，极快）；未命中才从磁盘读页，并把页放进缓冲池供后续重用",
        "写：先改缓冲池里对应页的副本，并不立刻写回磁盘；由后台线程按策略把脏页惰性刷回磁盘",
        "LRU 淘汰：缓冲池用 LRU（最近最少使用）策略淘汰不常用的页，为新的热页腾空间",
        "内存大小由配置决定：默认值随版本而异，生产中通常按机器内存与数据规模调优"
      ]
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "缓冲池就是性能的分水岭",
      "body": "面试里被问到「MySQL 为什么快」「为什么冷表第一次查慢、后面快」，答案的核心都是缓冲池：热数据在内存里，命中由磁盘 I/O 降为内存访问。所以判断数据库性能，先看「能不能把热数据装进缓冲池」，而不是只看 CPU。缓冲池的具体大小由 `innodb_buffer_pool_size` 等配置决定，不同版本默认值不同，不要背死一个数字。"
    },
    {
      "type": "subheading",
      "text": "Change Buffer：优化二级索引的随机写"
    },
    {
      "type": "paragraph",
      "text": "当一次写操作需要更新二级索引，而该索引页恰好不在缓冲池时，InnoDB 默认不会立刻去磁盘读那个页再改，而是先把「这次变更」记到内存里的 Change Buffer 中，等这个二级索引页将来真正被读到（或因后台刷盘）时，再把 Change Buffer 里的变更合并到页上。"
    },
    {
      "type": "paragraph",
      "text": "这解决了一个典型的痛点：二级索引通常是随机插入的（例如按 `user_id` 建的 `idx_user`，新订单的 user_id 分布很散，命中的索引页各不相同）。如果每次都现场读磁盘页再写回去，会产生大量随机 I/O。Change Buffer 把这些随机写暂时攒起来，延迟到读该页时一次性合并，把随机 I/O 摊平。代价是内存占用与合并带来的少量额外处理——所以是针对「写多、且二级索引多」的典型 OLTP 场景的优化。"
    },
    {
      "type": "subheading",
      "text": "redo / undo 与 doublewrite：先到这里"
    },
    {
      "type": "paragraph",
      "text": "InnoDB 还有两件保证数据安全的关键装备，本课先点个名，下一课再深入：redo log（重做日志，用于崩溃恢复与持久化）和 undo log（回滚日志，用于回滚与 MVCC 版本链）。另外还有一个 Doublewrite Buffer（双写缓冲）：因为它先把整页写到一处连续区域，再写回真正的位置，从而避免「写盘中途崩溃只写了半个页」造成的页损坏。二者都用「页是 16KB、写页不是原子的」这个前提来设计。"
    },
    {
      "type": "heading",
      "text": "把视角放回「一条写入如何经过 InnoDB」"
    },
    {
      "type": "paragraph",
      "text": "把这些组件串起来，一次普通的「更新订单状态」大致是这样的：先改缓冲池里对应数据页的副本（顺带记录 undo 与 redo），事务提交时保证 redo 落盘以确认持久化，而真正的数据页由后台线程惰性刷回磁盘；若中途崩溃，用 redo 恢复、用 undo 回滚。注意这里的关键直觉：**所有逻辑上的数据访问都发生在内存（缓冲池），磁盘页的刷回是被延迟的、批量的**——这正是下一课 WAL 的核心动机。"
    },
    {
      "type": "keypoints",
      "items": [
        "MySQL 的存储引擎可插拔、按表指定；现代默认是 InnoDB",
        "MyISAM 无事务、表锁、无崩溃恢复，基本是遗留引擎",
        "InnoDB 采用聚簇的索引组织表，数据按主键 B+ 树存放",
        "磁盘 I/O 最小单位是 16KB 的页",
        "缓冲池是性能心脏：读写都先经过内存工作集，LRU 淘汰",
        "Change Buffer 延迟合并二级索引的随机写；doublewrite 防半页写损坏",
        "redo/undo log 是下一课的主角，本课先建立整体地图"
      ]
    },
    {
      "type": "quiz",
      "question": "关于缓冲池（Buffer Pool）的作用，下列说法最准确的是？",
      "options": [
        "它决定 MySQL 能存多少张表",
        "它缓存数据页，让读写尽可能发生在内存中，降低磁盘 I/O",
        "它只在建表时使用一次，之后无用",
        "它负责把每个事务直接一个页一个页地写回磁盘"
      ],
      "answer": 1,
      "explanation": "缓冲池按页缓存数据与索引，读写优先命中内存工作集，脏页由后台线程惰性刷盘，是 InnoDB 性能的核心。"
    }
  ]
};
