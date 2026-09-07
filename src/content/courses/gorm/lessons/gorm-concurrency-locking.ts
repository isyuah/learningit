/* ==================================================================
 * 课时：并发安全与行锁（gorm-concurrency-locking）
 * ----------------------------------------------------------------
 * slug 与 course.ts 大纲一致；内容块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-concurrency-locking",
  courseSlug: "gorm",
  title: "并发安全与行锁",
  summary: "两个请求同时修改同一行会怎样：悲观锁（FOR UPDATE）与乐观锁（Version）的原理与取舍。",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "单线程下读写数据库不会出问题。但真实后端同时处理成千上万个请求，两个请求完全可能同一瞬间读到同一行、各自改完再写回——于是后一个写覆盖了前一个的修改，其中一方的更新无声无息地丢失。这一课解决的就是这个「丢失更新」（lost update）问题。",
    },
    {
      type: "heading",
      text: "问题：读-改-写之间的竞态",
    },
    {
      type: "paragraph",
      text: "订单余额、库存、文章点赞数这类「读出来，按旧值算新值，再写回」的操作，天然存在一个窗口：从读取到写回之间，另一并发请求可能已经改了同一行。数据库的默认隔离级别通常不足以保证这里的正确性，需要应用自己加锁。",
    },
    {
      type: "code",
      title: "一个会丢更新的典型模式",
      language: "go",
      code: "func (s *Service) AdjustAmount(tx *gorm.DB, orderID uint, delta int64) error {\n    // ① 读当前值\n    var o Order\n    if err := tx.First(&o, orderID).Error; err != nil {\n        return err\n    }\n    // ② 基于旧值计算新值\n    newAmount := o.Amount + delta\n    // ③ 写回\n    return tx.Model(&Order{}).Where(\"id = ?\", orderID).\n        Update(\"amount\", newAmount).Error\n    // 两个并发调用 A、B 都读到同一个旧 amount，\n    // 各自 +delta 后写回，后写的把先写的覆盖 → 少加了一次 delta\n}",
    },
    {
      type: "callout",
      variant: "warning",
      title: "留意：这不是 GORM 的错",
      body: "丢失更新源于应用「先读旧值再写回」的编排方式，GORM 只是忠实地执行了这些语句。解决方案要么让数据库在读取时加锁（悲观），要么让写入时校验版本（乐观），两种都由你在 SQL 层主动表达。",
    },
    {
      type: "heading",
      text: "悲观锁：SELECT ... FOR UPDATE",
    },
    {
      type: "paragraph",
      text: "悲观锁的思路是「读的时候就锁死这行，写完了才放行」。GORM 通过 clause.Locking 把锁语义暴露为 SQL 子句：在事务里用 Strength: \"UPDATE\" 会生成 SELECT ... FOR UPDATE，让被选中的行被排他锁锁住，直到事务提交或回滚，其他事务在此期间无法修改它。",
    },
    {
      type: "code",
      title: "悲观锁：锁定一行后再更新",
      language: "go",
      code: "import (\n    \"gorm.io/gorm\"\n    \"gorm.io/gorm/clause\"\n)\n\nfunc (s *Service) AdjustWithPessimistic(tx *gorm.DB, orderID uint, delta int64) error {\n    // 必须先开启事务\n    return tx.Transaction(func(tx *gorm.DB) error {\n        // SELECT ... FOR UPDATE：锁定该行，其余事务在此行上阻塞\n        var o Order\n        if err := tx.Clauses(clause.Locking{\n            Strength: \"UPDATE\",\n        }).First(&o, orderID).Error; err != nil {\n            return err\n        }\n\n        // 锁已持有，其它事务此刻改不了这行，可放心基于 o 计算并更新\n        newAmount := o.Amount + delta\n        return tx.Model(&Order{}).\n            Where(\"id = ?\", orderID).\n            Update(\"amount\", newAmount).Error\n    }) // 提交/回滚时释放行锁\n}",
    },
    {
      type: "definition",
      term: "clause.Locking{Strength: \"UPDATE\"}",
      definition: "GORM 暴露的悲观锁写入口，对应 SELECT ... FOR UPDATE。必须放在事务内使用，否则锁没有事务上下文来释放。Strength 为 \"SHARE\" 时对应 FOR SHARE（读锁）。",
    },
    {
      type: "heading",
      text: "乐观锁：Version 字段 + 条件更新",
    },
    {
      type: "paragraph",
      text: "乐观锁不锁行，而是假设冲突很少发生。思路是在表上放一个 Version 字段，更新时把 WHERE version = ? 一起带上：如果版本没变，说明期间没人改过，更新成功；如果版本变了，说明被并发改过，RowsAffected 为 0，本次更新冲突。",
    },
    {
      type: "code",
      title: "乐观锁：版本号 + 条件更新",
      language: "go",
      code: "// Order.User 与 Order.Version 来自共享示例模型\nfunc (s *Service) AdjustWithOptimistic(db *gorm.DB, orderID uint, delta int64) error {\n    for {\n        // ① 读当前行与版本号\n        var o Order\n        if err := db.First(&o, orderID).Error; err != nil {\n            return err\n        }\n\n        // ② 条件更新：仅当版本仍是读到的版本时生效，并顺手递增版本\n        res := db.Model(&Order{}).\n            Where(\"id = ? AND version = ?\", orderID, o.Version).\n            Updates(map[string]interface{}{\n                \"amount\":  o.Amount + delta,\n                \"version\": o.Version + 1,\n            })\n\n        if res.Error != nil {\n            return res.Error\n        }\n        // ③ 冲突：RowsAffected == 0，重读最新版本后重试\n        if res.RowsAffected == 1 {\n            return nil\n        }\n        if s.retry-- == 0 {\n            return fmt.Errorf(\"并发冲突，重试次数用尽: %d\", orderID)\n        }\n    }\n}",
    },
    {
      type: "callout",
      variant: "tip",
      title: "RowsAffected 是乐观锁的眼睛",
      body: "关键在 WHERE 里同时带 version = ?：数据库只影响满足条件的行。受影响行数为 0 就意味着版本已经别人改过——此时不要「假装成功」，要么报给上层让用户看到冲突，要么重读重试。",
    },
    {
      type: "heading",
      text: "何时用哪种锁",
    },
    {
      type: "paragraph",
      text: "选择取决于冲突概率与代价。悲观锁让并发写变得安全但会阻塞、并持有事务时间更长；乐观锁无阻塞、吞吐高，但冲突时需要重试或让用户重试。",
    },
    {
      type: "table",
      caption: "悲观锁 vs 乐观锁",
      headers: ["维度", "悲观锁（FOR UPDATE）", "乐观锁（Version）"],
      rows: [
        ["并发假设", "认为冲突频繁，先锁再做", "认为冲突很少，做时才校验"],
        ["机制", "SQL 层行锁，直到事务结束", "WHERE version=? 条件更新 + RowsAffected"],
        ["阻塞", "是，写之间互相排队", "否，各做各的，冲突时重试"],
        ["事务要求", "必须放在事务里", "单条更新即可，不强制长事务"],
        ["适合场景", "写冲突多、一致性要求极硬", "读多、冲突少、追求高吞吐"],
      ],
    },
    {
      type: "heading",
      text: "能力边界：深水位属于 MySQL 课程",
    },
    {
      type: "paragraph",
      text: "需要澄清一个重要边界：GORM 在这里做的是「把锁语法作为一种 SQL 子句暴露给你」，并不替你决定隔离级别、间隙锁、死锁检测、MVCC 快照语义这些底层机制。SELECT ... FOR UPDATE 真正锁住什么范围、在什么样的隔离级别下产生什么行为，都取决于数据库引擎本身的实现。",
    },
    {
      type: "callout",
      variant: "note",
      title: "这些属于 MySQL 课程的深入内容",
      body: "InnoDB 的锁粒度与间隙锁、REPEATABLE READ 下的当前读 vs 快照读、死锁的产生与检测、MVCC 如何让读不加锁……这些不依赖 GORM，属于数据库底层知识。本课只覆盖「GORM 允许你表达的 SQL 级锁」这一层，更深机制请你到 MySQL 专题继续。",
    },
    {
      type: "heading",
      text: "顺带澄清：GORM 的连接安全",
    },
    {
      type: "paragraph",
      text: "并发问题不等于「GORM 本身不安全」。GORM 的 *gorm.DB 句柄（如 db）内部维护连接池，是设计为可安全跨 goroutine 共享的：每次你用 db 起一个新的链式查询，它都会基于全局配置新建一个 Statement，互不干扰。真正要注意的反而是不要把「已经链式带状态」的那个 *gorm.DB（比如 db.Where(...) 的返回值）直接塞给多个 goroutine 复用，否则状态会互相污染。",
    },
    {
      type: "code",
      title: "正确的共享姿势 vs 要避免的姿势",
      language: "go",
      code: "// ✅ 推荐：共享基础句柄 db，每个 goroutine 各自新起一条链\nfunc Worker(db *gorm.DB, id uint) {\n    var o Order\n    db.First(&o, id) // 每次新建 Statement，安全\n}\n\n// ❌ 危险：把带条件的链复用给多个 goroutine\n// shared := db.Where(\"status = ?\", \"pending\")  // shared 携带 Where 状态\n// go func() { shared.Find(&a) }()  // 状态被共享，可能互相污染\n// go func() { shared.Find(&b) }()\n// 需要独立作用域时用 db.Session(&gorm.Session{}) 派生新句柄",
    },
    {
      type: "quiz",
      question: "关于 GORM 的乐观锁，下列说法正确的是？",
      options: [
        "乐观锁通过 db.Clauses(clause.Locking{Strength: \"UPDATE\"}) 触发，返回时自动重试",
        "乐观锁依靠 Version 字段 + WHERE version = ? 条件更新，并用 RowsAffected 是否为 0 判断是否发生并发冲突",
        "乐观锁会让所有并发写请求互相阻塞排队",
        "乐观锁不需要 Version 字段，只需要在事务里多查一次即可",
      ],
      answer: 1,
      explanation: "乐观锁的标志就是条件更新 + RowsAffected 判定：version 被并发修改后条件不成立，RowsAffected 为 0 即为冲突。加 FOR UPDATE 的是悲观锁，悲观锁才靠阻塞排队。",
    },
    {
      type: "exercise",
      title: "为库存扣减选择锁策略",
      description:
        "一个商城的库存扣减接口每秒可能被大量请求命中(POST /orders)。请：(1) 分析为什么裸的「读-算-写回」会丢更新；(2) 分别用悲观锁与乐观锁各写一版可靠实现；(3) 结合库存高频写冲突的特点，说明你会选哪种并给出理由。",
      hint: "库存扣减属于写冲突密集的高频操作，乐观锁可能出现大量重试；考虑哪个对吞吐更友好，以及是否需要事务包裹多行一致性。",
    },
    {
      type: "keypoints",
      items: [
        "读-改-写在没有同步时会丢失更新，这是并发一致性问题而非 GORM 缺陷",
        "悲观锁：事务内 db.Clauses(clause.Locking{Strength: \"UPDATE\"}) 生成 SELECT ... FOR UPDATE",
        "乐观锁：Version 字段 + WHERE version=? 条件更新，用 RowsAffected==0 判冲突并重试",
        "深层隔离级别/死锁/MVCC 属于 MySQL 课程，GORM 只暴露 SQL 级锁",
        "基础 *gorm.DB 可跨 goroutine 共享（每次新链新建 Statement），但别复用带状态的链",
      ],
    },
  ],
};
