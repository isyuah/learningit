/* ==================================================================
 * 课时：redo / undo log 与 WAL、崩溃恢复（mysql-redo-undo-wal）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-redo-undo-wal",
  "courseSlug": "database-mysql",
  "title": "redo / undo log 与 WAL、崩溃恢复",
  "summary": "理解日志存在的理由：WAL 预写日志、redo log 的持久化与崩溃恢复、undo log 的回滚与 MVCC，以及 COMMIT 与崩溃时到底发生了什么。",
  "minutes": 24,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "上一课我们留下了两个问题：为什么事务提交时不能直接把数据页写回磁盘？以及真正用于持久化的东西到底是什么？这一课就把答案讲透。理解 redo log / undo log 以及它们背后的 WAL（Write-Ahead Logging，预写日志）思想，是 MySQL 面试的高频区块，也是理解「数据为什么不会丢、崩溃了为什么能恢复」的关键。"
    },
    {
      "type": "heading",
      "text": "日志为什么存在：持久化与「快」的矛盾"
    },
    {
      "type": "paragraph",
      "text": "先想一个朴素的难点：一个事务可能改了散落在很多页上的数据（比如一次 UPDATE 扫了 100 个 16KB 的页）。如果「提交」就意味着把这 100 个页随机写回磁盘，那么：(1) 写入是随机的、分散的，非常慢；(2) 写页不是原子的——中途崩溃可能只剩半个页；(3) 一个事务要 fsync 很多次，提交会慢得不可接受。"
    },
    {
      "type": "paragraph",
      "text": "日志就是为了解开这个死结而存在的。它的核心承诺是：**把「提交快」和「恢复完好」同时做到**。做法是把「这次提交到底改了哪些东西」做成一份小而顺序的、可快速落盘的记录，提交时只需要把它刷到磁盘就敢返回成功；数据页仍然惰性、批量地慢慢刷回磁盘。这样提交不再依赖昂贵的随机页写，而只依赖一次快速的顺序日志写。"
    },
    {
      "type": "definition",
      "term": "WAL（Write-Ahead Logging，预写日志）",
      "definition": "在把数据页写回磁盘之前，先把描述这次修改的日志记录落盘。即：日志先于数据。这样即使数据页尚未刷盘、系统就崩溃，也能靠日志重建数据。redo log 是 WAL 思想的体现。"
    },
    {
      "type": "heading",
      "text": "redo log：重做日志，负责持久化与向前恢复"
    },
    {
      "type": "paragraph",
      "text": "redo log 记录的是一次物理层面上的修改（比如「某页的某个偏移处，把值从 A 改成 B」），它是「物理重做」：崩溃后只要把 redo 里记录的变化重新应用到页上，就能让磁盘上的数据恢复到提交时的状态。redo log 本身是一个**追加写（append-only）、固定大小、环形（circular）**的日志，它在内存里有一份 redo log buffer，落盘是顺序写的——所以刷一次日志远比随机写一堆页快得多。"
    },
    {
      "type": "list",
      "items": [
        "追加写：只往日志末尾追加，不修改已有记录，天然顺序、适合高频 fsync",
        "固定大小 + 环形：日志写满后会覆盖最旧、且已确认安全的部分，是有限容量的循环缓冲区",
        "内存缓冲：事务产生的 redo 先写进内存的 redo log buffer，攒着批量刷盘",
        "物理重做：记录的是「页的物理修改」，崩溃后按它把页重放成已提交的状态"
      ]
    },
    {
      "type": "subheading",
      "text": "COMMIT 时发生了什么：force log at commit"
    },
    {
      "type": "paragraph",
      "text": "这是本节最需要你记住的一句话：**InnoDB 在事务提交时，会保证该事务产生的 redo log 已经刷到磁盘（force log at commit），然后才向应用返回提交成功。** 至于数据页本身，它可能还躺在缓冲池里、还没写回磁盘——没关系，那正是 redo 的用武之地。"
    },
    {
      "type": "paragraph",
      "text": "所以一个事务的完整流程大致是：执行期间，改动先在缓冲池的数据页副本上发生，同时为此产生 undo 记录（用于回滚）和 redo 记录；COMMIT 时，把这一批 redo 顺序刷盘（一次 fsync 即可），确认落盘后返回成功；此后那些脏页由后台线程再慢慢刷回磁盘。想想上一篇讲过的缓冲池——「先改内存、日志先落盘、页惰性刷回」正是把缓冲池和 WAL 拼在一起的完整画面。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "提交刷的是 redo log，不是数据页",
      "body": "一个全网流传的错误说法是「事务提交时 InnoDB 把数据页 fsync 到磁盘」。不对。提交时 force 落盘的是 **redo log**，数据页是后台惰性刷回的。这个区别正是 WAL 的精髓：用一次顺序的日志 fsync 换取「看起来数据已持久化」，又不必为随机页写买单。面试被追问「提交到底同步了什么」，答案就两个字：日志（redo）。"
    },
    {
      "type": "subheading",
      "text": "崩溃时发生了什么：用 redo 重放"
    },
    {
      "type": "paragraph",
      "text": "假如系统在「COMMIT 已确认、但某些脏页还没刷盘」的时候崩溃，重启后会发生什么？那些已提交事务对页的修改可能根本没来得及落盘，但它们全都记在已经落盘的 redo log 里。InnoDB 启动时检查 redo log，把其中记录的所有已提交修改重新应用到数据页上（重放/redo），使数据恢复到崩溃前已提交的状态。这就是「向前恢复」：丢失的是提交之外的未写盘修改，而这些修改恰好被 redo 完好保存。"
    },
    {
      "type": "heading",
      "text": "undo log：回滚日志，负责反向回退与 MVCC"
    },
    {
      "type": "paragraph",
      "text": "与 redo 相对的另一个主角是 undo log。redo 记录「怎么重做」，undo 则记录「怎么撤回」。undo 里保存的是修改之前的旧值（before-image），用的是逻辑层面的描述（而不是像 redo 那样只关心物理页）。它有两个用途："
    },
    {
      "type": "list",
      "items": [
        "回滚（Rollback）：事务中途失败或显式回滚时，用 undo 把已改动的数据还原成修改前的样子",
        "MVCC 版本链：回忆事务章节——快照读会顺着 undo log 构造的版本链找到「在某个读视图下可见」的旧版本，这就是可重复读/读已提交能读到一致旧值的来源"
      ]
    },
    {
      "type": "paragraph",
      "text": "所以 undo 不只是「用来撤销」的临时数据，它还长期服务于多版本并发控制：一个行记录被多次更新后，历史版本就通过 undo 链连着，供不同读视图读取。这也解释了为什么「长事务 + 大量更新」会撑大 undo——版本没法及时清理，是常见的运维痛点。"
    },
    {
      "type": "subheading",
      "text": "redo 与 undo 的本质区别"
    },
    {
      "type": "table",
      "caption": "redo log 与 undo log 对比",
      "headers": ["维度", "redo log", "undo log"],
      "rows": [
        ["是什么", "重做日志，记录「如何重做这次修改」", "回滚日志，记录「修改前的旧值」"],
        ["描述粒度", "物理重做：页级、面向持久化", "逻辑撤销：面向回滚与 MVCC"],
        ["方向", "向前：重放已提交的修改（forward recovery）", "向后：撤回到修改前的状态"],
        ["核心职责", "持久化（durability）+ 崩溃恢复", "回滚（rollback）+ MVCC 版本链"],
        ["提交时", "COMMIT 必须 force 刷盘", "不要求像 redo 那样在提交时强制落盘（随版本配置，详情略）"],
        ["记录的是", "变化后的结果，用于重放", "变化前的旧值，用于撤回"]
      ]
    },
    {
      "type": "heading",
      "text": "Group Commit：让很多人一起刷一次盘"
    },
    {
      "type": "paragraph",
      "text": "既然每个提交都要把 redo 刷盘，而 fsync 是昂贵操作，那么高并发下「每提交一次就 fsync 一次」会变成吞吐瓶颈。InnoDB 用组提交（Group Commit）来缓解：让一批「几乎同时」到达提交点的事务共享同一次 redo 刷盘——大家都在缓冲区里等，攒够了或到了时机，一次 fsync 把这一整组的 redo 一起落盘。对每个事务来说 COMMIT 仍然是「redo 已落盘」，但对磁盘而言 fsync 次数被大幅摊薄，换来更高的提交吞吐。"
    },
    {
      "type": "heading",
      "text": "把整条链路串起来：一次提交 + 一次崩溃"
    },
    {
      "type": "paragraph",
      "text": "用一个电商的例子把两个场景完整走一遍，让机制有血有肉。假设你要把订单 10086 的状态从「待支付」改成「已支付」，金额是 500.00。"
    },
    {
      "type": "code",
      "title": "一次状态更新 + 提交",
      "language": "sql",
      "code": "BEGIN;\nUPDATE orders SET status = '已支付' WHERE id = 10086;\nUPDATE payment SET paid_at = NOW() WHERE order_id = 10086;\nCOMMIT;"
    },
    {
      "type": "list",
      "items": [
        "执行 UPDATE：改动先落到缓冲池里的数据页副本；同时为回滚写 undo（记录旧值），为持久化写 redo（记录要重放的变化）",
        "COMMIT：InnoDB 把本事务的 redo 刷到磁盘（可并入组提交），确认落盘后返回「提交成功」",
        "之后：脏页仍在缓冲池，由后台线程惰性刷回磁盘；此刻磁盘上的页可能还是旧值，但没关系",
        "若此刻崩溃：重启后靠已落盘的 redo 把 10086 的「已支付」状态和支付时间重放到数据页上，提交不丢失",
        "若在 COMMIT 前回滚/出错：靠 undo 把已改的页恢复成旧值，数据完好退回"
      ]
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "两段式心智模型",
      "body": "记住这个分工：redo 管「提交了不丢」（持久化 + 崩溃恢复），undo 管「没提交能退」（回滚）以及「并发读旧版本」（MVCC）。前者向前恢复、后者向后回退，二者互补，缺一不可。能脱口而出这条，面试这块就稳了一大半。"
    },
    {
      "type": "keypoints",
      "items": [
        "WAL：日志先于数据落盘，用一次顺序日志写换取提交快 + 恢复好",
        "redo log 追加写、固定大小、环形，内存缓冲，物理重做",
        "COMMIT 时必须保证 redo 已刷盘（force log at commit），数据页惰性刷回",
        "崩溃恢复靠 redo 重放已提交的修改（向前恢复）",
        "undo log 记录修改前的旧值，负责回滚与 MVCC 版本链",
        "redo=向前/持久化，undo=向后/回滚+多版本",
        "Group Commit 让多个事务共享一次 redo 刷盘以提升吞吐",
        "提交刷的是 redo log，不是数据页"
      ]
    },
    {
      "type": "quiz",
      "question": "一个事务 COMMIT 成功返回后，InnoDB 保证了什么？",
      "options": [
        "该事务改动的所有数据页都已经写回磁盘",
        "该事务的 redo log 已经刷到磁盘，因此崩溃后能恢复这些已提交的修改",
        "什么都没保证，提交可能随时丢失",
        "该事务的 undo log 已经刷到磁盘并被清空"
      ],
      "answer": 1,
      "explanation": "COMMIT 时 force 的是 redo log 落盘（force log at commit）；数据页由后台惰性刷回，崩溃时靠 redo 重放恢复已提交修改。"
    },
    {
      "type": "quiz",
      "question": "redo log 和 undo log 的职责分工，正确的是？",
      "options": [
        "redo 用于回滚，undo 用于崩溃恢复",
        "两者都可以随意互换使用",
        "redo 记录修改前的旧值用于 MVCC，undo 记录变化后结果用于持久化",
        "redo 记录可重放的变化用于持久化与崩溃恢复（向前），undo 记录旧值用于回滚与 MVCC（向后）"
      ],
      "answer": 3,
      "explanation": "redo=物理重做/持久化/向前恢复；undo=逻辑旧值/回滚/MVCC/向后回退。二者方向相反、职责互补。"
    },
    {
      "type": "exercise",
      "title": "判断一次提交后的崩溃是否丢数据",
      "description": "订单 20001 的金额从 100.00 改为 300.00，COMMIT 已成功返回，但该数据页尚未刷回磁盘。此刻服务器断电崩溃。请问重启后订单金额是多少？说明依据的是哪个日志、为什么该日志已可保证这一点。",
      "hint": "COMMIT 已确认 redo log 落盘。崩溃恢复会重放 redo，所以提交的修改不会丢——金额应为 300.00。"
    }
  ]
};
