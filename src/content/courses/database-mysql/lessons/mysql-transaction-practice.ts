/* ==================================================================
 * 课时：事务工程最佳实践（mysql-transaction-practice）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "mysql-transaction-practice",
  "courseSlug": "database-mysql",
  "title": "事务工程最佳实践",
  "summary": "把事务用对：边界短、加锁少、顺序一致，别让并发正确性毁在工程细节上。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "前面几章你已经理解了 ACID、隔离级别、MVCC（快照读 / 读视图）与 InnoDB 的行锁、间隙锁、next-key 锁以及死锁——那是「原理」。这一节把这些原理收拢成一组可以直接用于真实系统的工程规则：事务该怎样定边界、怎样控制锁的持有时间、怎样选隔离级别、遇到超时和死锁该怎样重试。我们会用贯穿全课的电商订单库（shop）里的「下单扣库存」作为主线例子。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "前置知识",
      "body": "本节建立在上面提到的原理之上：如果你还不清楚快照读与当前读的区别、行锁 / 间隙锁 / next-key 锁以及死锁的成因，请先回看第 5 章（事务、隔离与并发控制）的对应课时。这里不再重新推导这些机制，只讲怎么把它们用在工程里。"
    },
    {
      "type": "heading",
      "text": "规则一：事务要短，锁的持有时间就是一切"
    },
    {
      "type": "paragraph",
      "text": "一个写事务在提交之前，它修改过的行上的写锁（以及可能产生的 next-key / 间隙锁）都不会释放，其它事务读到那条路径会被阻塞或等待。所以「锁持有多久」取决于「事务开多久」。把事务开得越长，越容易把自己变成别人的瓶颈、也越容易被别人阻塞而陷入等待甚至死锁。"
    },
    {
      "type": "list",
      "items": [
        "事务里绝对不要放网络请求、HTTP 调用、第三方支付接口、消息队列发送——这些耗时且不可控",
        "事务里不要放 await 用户输入或等待某个人工确认",
        "事务里不要做与本次原子写无关的重计算或批量导出",
        "原则：能放进事务的只有「逻辑上必须同时生效」的少量 SQL"
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "经典反例：在事务里调支付接口",
      "body": "「下单并把钱付了」最自然的写法是先开事务、调支付、等回调再提交。但支付回调可能几十秒甚至更久，事务会一直持有库存行的写锁——整张商品被这个单子堵死。正确做法是：事务只在内存中更新状态为「处理中」并立刻提交，等支付平台异步回调成功后，再开一个「短事务」把订单标记为已支付。把长周期操作拆在事务之外，只把状态变更放进事务。"
    },
    {
      "type": "heading",
      "text": "规则二：锁定顺序要一致，死锁主要靠它预防"
    },
    {
      "type": "paragraph",
      "text": "你在死锁那一课学到的核心结论是：两个事务各自持有对方需要的锁、互不相让时才会死锁。工程上最有效的预防手段之一，是让「所有事务访问多个资源的顺序完全一致」。如果每个事务都按相同顺序加锁，就不会出现 A 拿了 x 等 y、B 拿了 y 等 x 的环形等待。"
    },
    {
      "type": "code",
      "title": "下单扣库存：两条写按固定顺序",
      "language": "sql",
      "code": "-- 事务 A：先改 orders，再改 inventory\nBEGIN;\nINSERT INTO orders (user_id, status, total_amount)\nVALUES (7, 'paid', 199.00);\nUPDATE product SET stock = stock - 1 WHERE id = 12;\nCOMMIT;\n\n-- 事务 B：也必须先改 orders，再改 inventory（顺序保持一致）\nBEGIN;\nINSERT INTO orders (user_id, status, total_amount)\nVALUES (8, 'paid', 399.00);\nUPDATE product SET stock = stock - 1 WHERE id = 12;\nCOMMIT;"
    },
    {
      "type": "paragraph",
      "text": "顺序一致的规则尤其容易在「多表写入」和「批量任务」里被打破。比如库存盘点脚本先 UPDATE product 再扫 orders，而下单流程先 INSERT orders 再 UPDATE product——两者顺序相反，高并发下就可能互相死锁。制定团队规范：所有涉及同一组表的写事务，统一按同一物理顺序访问。"
    },
    {
      "type": "heading",
      "text": "规则三：默认用快照读，只在必要时用当前读"
    },
    {
      "type": "paragraph",
      "text": "在默认的 REPEATABLE READ 隔离级别下，普通的 SELECT（不带 FOR UPDATE / LOCK IN SHARE MODE / 以及普通 UPDATE 中的读取）走的是快照读：基于读视图（Read View），不持有任何锁，几乎不阻塞任何并发。这是 MySQL 高并发吞吐的核心来源。因此：能靠快照读的语义满足需求，就不要主动加锁去竞争。"
    },
    {
      "type": "list",
      "items": [
        "只是读取一个一致性快照、判断是否存在、统计数量——用普通 SELECT，零锁开销",
        "只有在「读了之后还要基于读到的值去写，且必须保证中间不被别人改」时才用当前读（SELECT ... FOR UPDATE）",
        "用锁之前先问自己：我真的需要把「读」和「经过计算的写」绑定成对其它事务可见的临界区吗？"
      ]
    },
    {
      "type": "heading",
      "text": "规则四：不要在事务里先 SELECT 后 UPDATE 造成丢更新"
    },
    {
      "type": "paragraph",
      "text": "即便用了事务，「先 SELECT 余额，再按读到的值 UPDATE」也是竞态重灾区：两个并发事务可能读到同一个旧值，各自加上自己的偏移，后提交者把先提交者的结果覆盖掉。事务隔离只保证「并发下看到的结果符合某隔离级别」，并不替你决定「基于快照算出来的写应该基于哪个值」。"
    },
    {
      "type": "code",
      "title": "下单扣库存的两种正确做法",
      "language": "sql",
      "code": "-- 做法一（推荐）：原子自减 + 条件防止超卖，天然安全\nUPDATE product\nSET stock = stock - 1\nWHERE id = 12 AND stock > 0;\n-- 若受影响行数为 0 => 库存不足，回滚\n\n-- 做法二（确实要先读时）：用当前读把读和写并成一个临界区\nBEGIN;\nSELECT stock FROM product WHERE id = 12 FOR UPDATE;\n-- 在内存里核对库存，够就执行 UPDATE（此时该行已被本事务锁住）\nUPDATE product SET stock = stock - 1 WHERE id = 12;\nCOMMIT;"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "为什么做法一更优",
      "body": "`UPDATE ... SET stock = stock - 1 WHERE id = ? AND stock > 0` 把「检查库存」和「扣减」合并在一条语句里由数据库原子地完成，既不需要显式锁也不需要事务内先读后写，还把超卖的条件判断交给了受影响行数。能用一个原子表达式表达的写，就不要拆成「读 + 计算 + 写」。"
    },
    {
      "type": "heading",
      "text": "规则五：隔离级别选「恰好够用」，别盲目最高"
    },
    {
      "type": "paragraph",
      "text": "隔离级别越高，需要的一致性保证越强，但通常也带来更强的锁、更多等待和更复杂的实现。默认的 REPEATABLE READ（可重复读）是 InnoDB 的默认值，配合 MVCC 在绝大多数业务下已经足够。只在你确实需要某级别才去 CHANGE 它："
    },
    {
      "type": "table",
      "caption": "隔离级别选择：按你的实际需求，而不是一股脑拉满",
      "headers": ["你的需求", "够用的隔离级别", "为什么"],
      "rows": [
        ["允许读到别人未提交的数据（几乎没人需要）", "READ UNCOMMITTED", "读到的可能是未提交、会被回滚的中间值，通常不选"],
        ["读一行时，只想看到已提交、且现在是最新的值", "READ COMMITTED", "每次读都能看到最新已提交值；无间隙锁，写并发更高"],
        ["事务内的多次读保持一致、避免不可重复读", "REPEATABLE READ（默认）", "MVCC 快照读实现，兼顾一致性与并发，多数业务的默认选择"],
        ["连幻读也要杜绝，事务间完全串行化", "SERIALIZABLE", "代价最大、并发最低；一般只在极少数强一致场景使用"]
      ]
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "工程结论",
      "body": "默认 REPEATABLE READ 通常是对的起点。不要为了「显得严谨」把所有事务提升到 SERIALIZABLE；相反，如果你能确认业务只需要「读到的都是已提交且最新的值」，把会话设为 READ COMMITTED 往往能减少间隙锁带来的写冲突。原则永远是：用满足正确性要求的最低隔离级别。"
    },
    {
      "type": "heading",
      "text": "规则六：留意写操作带来的「隐藏锁」"
    },
    {
      "type": "paragraph",
      "text": "并不是只有你显式写 `FOR UPDATE` 才会上锁。任何一条 UPDATE / DELETE / INSERT 都可能隐式带上行锁，条件范围的 UPDATE / DELETE 还可能带上间隙锁或 next-key 锁。所以在设计事务时，要预估「这条写会让哪些行的锁被持有、挡住谁」。一个常见例子是：一条没有走索引的全表范围 DELETE，会以 next-key 锁锁住扫描到的范围，造成大面积的阻塞——这也是为什么写操作尽量要命中索引。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "别把全表当作「删一点点」",
      "body": "`DELETE FROM orders WHERE status = 'cancelled'` 若该条件没有可用的二级索引，InnoDB 会对扫描路径加锁，可能阻塞其它对 orders 的写入。工程上希望「删老数据」这类批量操作不长期占锁，通常分组限速、小批量提交（例如每次删 1000 条并短暂停顿），而不是在一个满负载事务里一次删完——这既控制锁持有，也避免 undo log 被撑大。"
    },
    {
      "type": "heading",
      "text": "规则七：别让长事务撑大 undo log"
    },
    {
      "type": "paragraph",
      "text": "隔离级别依赖 undo log 来实现快照读与读视图：一个长事务若一直不提交，它最先看到的那个读视图所依赖的旧版本数据就不能被清理，undo log 会不断累积，磁盘与内存开销随之上升，甚至影响其它事务的版本链遍历。所以「事务要短」不只为了锁，也为了及时让旧版本可以被回收。"
    },
    {
      "type": "list",
      "items": [
        "尽早提交：完成原子写立即可提交，不要在事务里挂机或等待",
        "应用要妥善处理「打开事务后崩溃/异常却忘了 commit/rollback」的路径，避免事务悬在会话上",
        "监控长事务：看 `information_schema.innodb_trx` 中运行超过阈值的活动事务，及时排查",
        "批量写任务优先小事务分批，而不是一个巨型事务跑到底"
      ]
    },
    {
      "type": "heading",
      "text": "规则八：处理超时与死锁要「重试」而不是「直接失败」"
    },
    {
      "type": "paragraph",
      "text": "即使你遵守了以上所有规则，真实系统里死锁和锁等待超时仍可能发生——因为并发是外部世界的干扰，你无法完全掌控所有客户端。所以工程上不以「永不死锁」为目标，而是「死锁后能优雅地恢复」。InnoDB 检测到死锁时会回滚其中某个事务并抛错；应用层应当捕获死锁 / 锁等待超时错误，做有限次的安全重试。"
    },
    {
      "type": "code",
      "title": "伪代码：带退避的上单重试",
      "language": "text",
      "code": "for attempt in 1..3:            # 有限次重试，避免无限循环\n    tx = begin()\n    try:\n        update product set stock = stock - 1\n               where id = 12 and stock > 0\n        if affected_rows == 0: return \"库存不足\"\n        insert into orders ...\n        insert into order_item ...\n        commit()\n        return \"成功\"\n    except DeadlockError / LockWaitTimeout:\n        rollback()\n        sleep(attempt * random_jitter)   # 退避，减少再次同时冲击的概率\nraise \"重试次数耗尽，交给上层处理\""
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "重试的边界",
      "body": "「重试整个事务」只对「事务本身没有对外副作用」的情况安全（比如它没有发送过外部消息）。如果你在事务里发了消息或扣了外部额度，重试可能造成重复——这时要引入幂等（见下一节）。重试次数要有限（如 3 次）并带随机退避，避免所有请求在同一时刻齐刷刷地再次打架。"
    },
    {
      "type": "heading",
      "text": "规则九：用幂等处理「提交了才崩溃」的再执行"
    },
    {
      "type": "paragraph",
      "text": "重试能覆盖死锁，却覆盖不了「首次执行其实已提交、只是响应在网络上丢了，客户端误以为失败而重发」。这类重复执行对纯加性写（多插一条订单）是致命的。解决办法是幂等：为业务请求分配一个唯一的关键业务号，并在表上对它能建唯一索引；重试再次插入时，唯一约束会拦住重复行。"
    },
    {
      "type": "code",
      "title": "给订单加唯一幂等键",
      "language": "sql",
      "code": "-- 给 orders 增加一个业务幂等键，例如外部下单请求号\nALTER TABLE orders ADD COLUMN request_id VARCHAR(64) NOT NULL,\n  ADD UNIQUE KEY uk_request (request_id);\n\n-- 事务里插入时，若同一 request_id 已存在则唯一键冲突，重试自然失败为“已处理”\nBEGIN;\nINSERT INTO orders (request_id, user_id, status, total_amount)\nVALUES ('req-2026-0001', 7, 'paid', 199.00);\nUPDATE product SET stock = stock - 1 WHERE id = 12 AND stock > 0;\nCOMMIT;"
    },
    {
      "type": "paragraph",
      "text": "有了唯一幂等键，客户端即使把同一个请求重复提交，数据库层也能保证只生效一次——这让「重试」与「崩溃恢复后重放」都变得安全，是工程里补上事务最后一块短板的关键手段。"
    },
    {
      "type": "quiz",
      "question": "在同一高并发场景下，两个事务需要依次修改 orders 与 product 两张表的数据。为避免死锁，最有效的工程做法是？",
      "options": [
        "把隔离级别升到 SERIALIZABLE，让它们排队执行",
        "让两个事务都按「先 orders、后 product」的相同顺序加锁访问",
        "让两个事务各用不同的顺序，各锁各的，互不干扰",
        "在事务里加上睡眠，错开访问时间"
      ],
      "answer": 1,
      "explanation": "死锁源于环形等待；让所有事务对多资源按同一顺序加锁，从结构上消除环形等待，是首选的预防手段。提升隔离级别只是在放大串行化代价，并不消除顺序不一致带来的死锁窗口；不同的锁顺序恰恰是死锁的制造者。"
    },
    {
      "type": "quiz",
      "question": "为什么「把第三方支付回调等长等待放进事务」是反模式？",
      "options": [
        "因为事务对外部网络的调用不可靠，MySQL 不支持",
        "因为事务会长期持有行锁并占用连接，把并发全部堵住；回调慢还可能让连接被拖垮",
        "因为事务一旦提交后支付状态就再也改不了",
        "因为 MySQL 事务天然只能持续几百毫秒"
      ],
      "answer": 1,
      "explanation": "事务的锁要持有到提交；支付回调等长等待会无限拉长锁与连接的持有时间，成为系统吞吐瓶颈。正确拆分是把状态标记为「处理中」立即提交，再用回调后开的短事务去改状态。"
    },
    {
      "type": "exercise",
      "title": "设计一个下单扣库存的正确事务",
      "description": "基于 shop 库（users / products / orders / order_items），写出一个「下单扣库存」的事务：用原子自减 + 库存条件防止超卖，固定加锁顺序，事务里不出现网络调用，并说明遇到死锁时应用层应如何处理。",
      "hint": "把「扣库存」写成 `UPDATE ... SET stock = stock - 1 WHERE id = ? AND stock > 0`，用受影响行数判断库存；对比「先 SELECT 再 UPDATE」为什么有丢更新风险。"
    },
    {
      "type": "keypoints",
      "items": [
        "事务要短：锁持有时间=事务时间，绝不放网络调用/长等待",
        "多资源加锁顺序全团队一致，从结构上预防死锁",
        "默认用快照读（MVCC），只在真正需要临界区语义时用 FOR UPDATE 当前读",
        "能用一个原子表达式写就别先读后写；扣库存用 UPDATE 条件自减",
        "隔离级别选恰好够用，默认 REPEATABLE READ，别盲目 SERIALIZABLE",
        "注意写操作隐藏的范围锁/next-key 锁；长事务会撑大 undo log",
        "死锁/超时走「有限次 + 随机退避」的安全重试",
        "用唯一业务键做幂等，让重试与崩溃重放都安全"
      ]
    }
  ]
};
