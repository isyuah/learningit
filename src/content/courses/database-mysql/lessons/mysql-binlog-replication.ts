/* ==================================================================
 * 课时：binlog 与主从复制（mysql-binlog-replication）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-binlog-replication",
  "courseSlug": "database-mysql",
  "title": "binlog 与主从复制",
  "summary": "理解 Server 层的 binlog 及其格式，主从复制的 I/O 线程、relay log、SQL 线程工作流，异步/半同步区别，以及读多写少的读写分离。",
  "minutes": 22,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "上一课我们讲透了 InnoDB 的 redo log 和 undo log——它们是存储引擎层面的、服务于「单机数据持久化与崩溃恢复」的日志。这一课要讲的 binlog 却有着完全不同的位置和使命：它不属于存储引擎，而是属于 Server 层；它不只服务于「这一台机器不丢数据」，还服务于「把变更复制到别的机器」「把数据恢复到过去某个时刻」。理解了 binlog，你就理解了 MySQL 的主从复制、读写分离和基于 binlog 的点位恢复。"
    },
    {
      "type": "heading",
      "text": "binlog 是什么：Server 层的逻辑变更日志"
    },
    {
      "type": "paragraph",
      "text": "binlog（二进制日志）由 MySQL 的 Server 层负责记录。它记录的是一系列「改变了数据」的事件：哪些写操作被执行、对应的数据发生了什么变化。它不服务于存储引擎的崩溃恢复（那是 redo 的事），而是服务于三个典型目标："
    },
    {
      "type": "list",
      "items": [
        "主从复制：把写操作事件同步给从库，让从库重放同样的变更",
        "数据备份 / 点位恢复：从某个备份点开始，顺着 binlog 重放到某个时间点或位置，实现时间点恢复（PITR）",
        "审计 / 分析：记录哪些数据被改过、何时被改"
      ]
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "redo 与 binlog 的分工再强调一次",
      "body": "redo log 是 InnoDB 引擎的物理日志，管「本机崩溃恢复」；binlog 是 Server 层的逻辑日志，管「复制 + 备份恢复」。二者记录的内容、归属、用途都不同。本章不重新讲 redo 的细节（见上一课），这里只需记住：binlog 是站在 Server 层、面向多机/时间线的日志。"
    },
    {
      "type": "heading",
      "text": "binlog 的三种格式：STATEMENT / ROW / MIXED"
    },
    {
      "type": "paragraph",
      "text": "binlog 可以用不同格式记录变更，选择格式决定了「记录的是 SQL 语句本身，还是它实际影响的那些行」。这是面试的高频点。"
    },
    {
      "type": "table",
      "caption": "binlog 三种格式对比",
      "headers": ["格式", "记录什么", "优点", "缺点"],
      "rows": [
        ["STATEMENT", "被执行的 SQL 语句本身", "日志体积小、看起来直观", "某些不确定性语句在从库重放结果可能不一致"],
        ["ROW", "被变更的每一行具体数据（前像/后像）", "确定性好、最安全，能精确还原每行的变化", "日志体积通常更大"],
        ["MIXED", "默认记录 SQL，遇到不安全语句自动切换为 ROW", "兼顾体积与安全", "行为随语句而异，不如 ROW 一目了然"]
      ]
    },
    {
      "type": "paragraph",
      "text": "为什么 ROW 更安全？想象一条 `UPDATE orders SET total_amount = total_amount * 1.1 WHERE status = '已支付'`。在 STATEMENT 格式下，binlog 只记这条 SQL 本身；从库重放时如果数据、函数、时间或执行环境有细微差别（例如用了 `NOW()`、`RAND()`、`LIMIT` 搭配不确定排序、或两张表初始数据不同），得到的行可能与主库不一致。而 ROW 格式把「每一行被改成了什么」的具体值都记下来，从库直接按行重放，结果与主库严格一致。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "现代 MySQL 的默认是 ROW",
      "body": "从 MySQL 5.7.7 开始，binlog 默认格式就是 ROW，8.0 也沿用。所以除非有特殊理由（例如想缩小日志体积），一般不要手动降级成 STATEMENT。这句话面试常考，版本敏感，记得带上「5.7.7 起」这个标签。"
    },
    {
      "type": "quiz",
      "question": "为什么 ROW 格式通常比 STATEMENT 格式更适合作为复制的 binlog 格式？",
      "options": [
        "ROW 格式记录的被变更行的具体数据，重放结果与主库严格一致，能规避不确定性语句",
        "ROW 格式日志体积总是更小",
        "STATEMENT 格式无法被从库理解",
        "ROW 格式不需要 SQL 语句也能恢复，STATEMENT 必须依赖存储引擎"
      ],
      "answer": 0,
      "explanation": "ROW 记录每行实际变更（前像/后像），重放结果确定。STATEMENT 只记语句，遇到 NOW()/RAND()/不确定 ORDER BY 等会导致主从结果不一致。"
    },
    {
      "type": "heading",
      "text": "主从复制：一主一从是怎么把数据搬过去的"
    },
    {
      "type": "paragraph",
      "text": "复制（Replication）的基本思路很朴素：主库（Master）把每次写操作写进自己的 binlog；从库（Replica）拉取这些 binlog 事件并重放，让从库的数据跟上主库。这个「拉取 + 重放」在 MySQL 里由两个线程分工完成。"
    },
    {
      "type": "definition",
      "term": "主从复制（Replication）",
      "definition": "把主库的 binlog 变更事件传送到一个或多个从库并重放，使从库的数据与主库保持同步。用于读写分离、容灾、扩展读能力。"
    },
    {
      "type": "heading",
      "text": "复制的工作流：I/O 线程、relay log、SQL 线程"
    },
    {
      "type": "paragraph",
      "text": "复制过程可以概括成「两个线程 + 一个中继日志」，每一步职责单一、很好理解："
    },
    {
      "type": "list",
      "items": [
        "主库：把写操作写进自己的 binlog（写库即写 binlog）",
        "从库 I/O 线程：连接主库，把主库的 binlog 事件持续拉取下来",
        "relay log（中继日志）：从库把拉下来的日志先落地到本地的 relay log",
        "从库 SQL 线程：读取 relay log 并逐条重放到从库自己的数据上",
        "从库可以选择再作为更下游的主库，形成链式/树状拓扑"
      ]
    },
    {
      "type": "code",
      "title": "查看复制状态（命令版本敏感，以版本为准）",
      "language": "sql",
      "code": "-- 主库：查看当前 binlog 文件与位置\nSHOW MASTER STATUS;\n\n-- 从库：查看复制线程状态（语法随版本演化）\n-- 早期版本用：SHOW SLAVE STATUS;\n-- 8.0.22+ 推荐：SHOW REPLICA STATUS;"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "命令名随版本演化",
      "body": "`SHOW SLAVE STATUS` 是历史悠久的写法；MySQL 8.0.22 起官方把术语从 slave 调整为 replica，推荐 `SHOW REPLICA STATUS`。不同版本同时还可能调整了配置项的名称。面试/文档里见到新旧两种叫法都正常，标注版本即可，不必背死某一个。"
    },
    {
      "type": "heading",
      "text": "异步复制与半同步复制：主库要不要等"
    },
    {
      "type": "paragraph",
      "text": "默认情况下，MySQL 的复制是**异步（asynchronous）**的：主库执行完事务、写好 binlog、返回提交成功，它并不会等待从库把日志拉走并重放。这意味着从库可能落后于主库（replication lag），更极端的情况下，如果主库在从库拉走 binlog 之前崩溃且无法恢复，那么「从库还没收到的那部分提交」就丢了。"
    },
    {
      "type": "list",
      "items": [
        "异步复制（默认）：主库不等从库，吞吐高，但存在从库延迟与潜在数据丢失窗口",
        "半同步复制（semi-sync）：主库提交后，至少要等一个从库确认「已收到 binlog」，才向应用返回成功——显著缩小丢失窗口，代价是提交延迟略增",
        "全同步组复制/多源：更强的同步保证，但更复杂，通常按实际拓扑需要选用",
        "GTID：用全局事务标识符替代「文件名+位置」来定位复制点，让故障切换与配置更简单（8.0 更完善）"
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "复制不是备份：误删会被原样复制",
      "body": "一个常见误区是「我有从库，所以不怕数据丢」。不是的：如果你在主库错误地 DELETE 或 UPDATE 了一大批数据，binlog 会把这次错误原样同步到从库——从库也会跟着删掉。复制同步的是「变更」，它不会判断这次变更是不是你想做的。所以复制不能替代真正的时间点备份；要恢复误操作，得靠备份 + binlog 点位恢复到出错之前（见下）。"
    },
    {
      "type": "heading",
      "text": "读写分离：为什么读走从库、写走主库"
    },
    {
      "type": "paragraph",
      "text": "理解了复制，读写分离的理由就自然浮现：主库承担所有写（以及强一致要求的读），从库只承担读，把查询压力分散到多台机器上，适合「读多写少」的典型业务——比如电商平台，绝大多数请求是浏览商品、查订单，真正下单写入的比例低得多。"
    },
    {
      "type": "list",
      "items": [
        "写（INSERT / UPDATE / DELETE）永远发往主库，保证单点写入的一致性",
        "读（SELECT）可发往任一从库，横向扩展读吞吐",
        "场景限制：因为复制有延迟（异步下从库可能落后），需要「读到自己刚写的数据」的强一致场景不能走从库，否则可能读到旧数据（stale read）"
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "读写分离的「读到旧数据」陷阱",
      "body": "读写分离最常见的坑是：用户刚在主库下了一单，紧接着页面去从库查该订单，结果显示不存在——因为从库还没来得及复制到这条写。解决思路包括：刚写完后的那次读强制走主库、「读己之写」的会话绑定主库、或接受短时间的最终一致。选哪种取决于业务对一致性的要求，但一定不能想当然认为「复制是一条链路、永远实时」。"
    },
    {
      "type": "heading",
      "text": "binlog 与时间点恢复（PITR）"
    },
    {
      "type": "paragraph",
      "text": "除了复制，binlog 的另一个重要作用是充当「时间点恢复」的素材。思路是：用某个全量备份把数据库恢复到备份时刻，然后把该备份点之后、一直到事故发生前（例如某次误 DELETE 之前）的 binlog 事件重放上去，从而把数据恢复到「出错前一刻」，而不是「备份时刻」。这就是为什么 binlog 要长期保留、要按备份与业务要求规划存活时长——它是我们能把数据库「回到过去」的胶水。"
    },
    {
      "type": "keypoints",
      "items": [
        "binlog 是 Server 层逻辑日志，用于复制、备份与时间点恢复",
        "格式有 STATEMENT / ROW / MIXED，5.7.7 起默认 ROW，8.0 沿用",
        "ROW 记录每行具体变更，重放确定、最安全",
        "复制工作流：主库写 binlog → 从库 I/O 线程拉取 → relay log → SQL 线程重放",
        "默认异步复制：主库不等从库，存在延迟与潜在丢失窗口",
        "半同步让主库等一个从库确认，缩小丢失窗口",
        "复制会原样同步错误操作，不能替代真正的备份",
        "读写分离：写走主库、读走从库，但要注意复制延迟带来的读旧数据",
        "binlog + 备份可用于时间点恢复（PITR）"
      ]
    },
    {
      "type": "quiz",
      "question": "关于 MySQL 默认的主从复制，下列说法正确的是？",
      "options": [
        "主库提交后必须等待从库确认才返回成功",
        "从库通过 I/O 线程拉取主库 binlog 写入 relay log，再由 SQL 线程重放；默认是异步的，主库不等待从库",
        "复制会把主库的 binlog 反转后再应用，以避免重复",
        "有了从库就一定能防止误删数据丢失"
      ],
      "answer": 1,
      "explanation": "复制默认异步：I/O 线程拉 binlog → relay log → SQL 线程重放，主库不等从库。异步换来吞吐，也带来延迟与丢失窗口；它也会同步错误操作，不能替代备份。"
    },
    {
      "type": "exercise",
      "title": "判断该请求应发往主库还是从库",
      "description": "用户在页面上用余额支付了一笔订单（写操作），随后要立即查看「我的订单」列表。请判断这笔「查看订单」的读请求应该走主库还是从库，并说明原因；如果一定要走从库，有什么办法规避读到旧数据？",
      "hint": "用户刚写入的数据未同步到从库时，从库可能读不到。可让「读己之写」的会话绑定主库，或接受最终一致。"
    }
  ]
};
