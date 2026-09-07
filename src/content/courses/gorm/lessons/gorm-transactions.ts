/* ==================================================================
 * 课时：事务：全做或全不做（gorm-transactions）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-transactions",
  "courseSlug": "gorm",
  "title": "事务：全做或全不做",
  "summary": "把多步写操作包成一个原子单位，避免数据只改了一半。",
  "minutes": 22,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "想象一个转账场景：从账户 A 扣 100 元，再往账户 B 加 100 元。如果这两步之间程序崩溃了，就会发生「A 已扣款、B 未到账」——钱凭空消失。事务（Transaction）就是用来解决这类问题的：它把一组操作打包成一个「全做或全不做」的原子单位，要么全部成功提交，要么全部回滚，数据库绝不会停在中间状态。"
    },
    {
      "type": "heading",
      "text": "为什么需要事务"
    },
    {
      "type": "paragraph",
      "text": "事务解决的不仅是「一条语句本身」。单条 UPDATE 数据库自己就保证原子；真正的问题在于「多条逻辑上必须同时生效」的语句。最常见的判断是：如果在第一条语句成功、第二条语句失败之后，系统崩溃了，数据是否仍然一致？如果答案是否定的，那么这段操作就应该放进事务。"
    },
    {
      "type": "list",
      "items": [
        "转账：先扣钱、后加钱，两步必须同生共死",
        "下单：扣库存、生成订单、记支付流水，任何一步失败都要整体撤销",
        "组表数据：往主表和两张附表各插入一行，失败时不能留下半截数据"
      ]
    },
    {
      "type": "heading",
      "text": "最干净的写法：db.Transaction"
    },
    {
      "type": "paragraph",
      "text": "GORM 推荐用 `db.Transaction(func(tx *gorm.DB) error { ... })` 来执行事务。传给闭包的 `tx` 就是这个事务的句柄，闭包内的所有数据库操作都应该通过 `tx` 而不是原来的 `db` 执行——否则那些操作不会进入事务。闭包返回 `error` 时整体回滚，返回 `nil` 时提交。"
    },
    {
      "type": "code",
      "title": "用 db.Transaction 转账",
      "language": "go",
      "code": "func Transfer(db *gorm.DB, from, to uint, amount int64) error {\n    return db.Transaction(func(tx *gorm.DB) error {\n        // 1. 从 from 账户扣款\n        if err := tx.Model(&User{}).Where(\"id = ?\", from).\n            Update(\"balance\", gorm.Expr(\"balance - ?\", amount)).Error; err != nil {\n            return err // 返回 error -> 回滚\n        }\n\n        // 2. 往 to 账户加款\n        if err := tx.Model(&User{}).Where(\"id = ?\", to).\n            Update(\"balance\", gorm.Expr(\"balance + ?\", amount)).Error; err != nil {\n            return err // 再次回滚\n        }\n\n        // 3. 记录一笔订单\n        if err := tx.Create(&Order{\n            UserID: from,\n            Amount: amount,\n            Status: \"transferred\",\n        }).Error; err != nil {\n            return err\n        }\n\n        return nil // 全部成功 -> 提交\n    })\n}"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "用原子更新表达式，而不是先读后写",
      "body": "上面的转账用 `gorm.Expr(\"balance - ?\")` 直接在数据库里做算术，而非「先 SELECT 再 UPDATE」。先读后写会有竞态：两个并发请求可能读到同一个旧余额，各自加/扣，最后丢更新。在单个事务里，原子表达式（以及下几课的锁）是保证一致性的关键。"
    },
    {
      "type": "heading",
      "text": "返回语义：error 回滚，nil 提交"
    },
    {
      "type": "paragraph",
      "text": "`db.Transaction` 的语义简单而明确：闭包返回非 nil 错误，事务回滚，且 `db.Transaction` 把同一个错误原样返回给你；闭包返回 nil，事务提交，函数返回 nil。这样事务边界、错误传播和回滚决策都集中在一处，是最不容易写错的模式。"
    },
    {
      "type": "code",
      "title": "余额不足也要回滚",
      "language": "go",
      "code": "func Transfer(db *gorm.DB, from, to uint, amount int64) error {\n    return db.Transaction(func(tx *gorm.DB) error {\n        var fromUser User\n        if err := tx.Where(\"id = ?\", from).First(&fromUser).Error; err != nil {\n            return err\n        }\n        if fromUser.Balance < amount {\n            return errors.New(\"余额不足\") // 业务校验失败 -> 整个事务回滚\n        }\n        // ... 扣款 / 加款 / 记订单 ...\n        return nil\n    })\n}"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "无论如何都要走 rollback，或优先用闭包形式",
      "body": "事务最常见的 bug 是「某条路径提了交、另一条路径忘了回滚」，或反过来。用手动 Begin/Commit/Rollback 时，务必用 `defer` 兜底回滚（见下节）。用闭包形式 `db.Transaction` 则从根上消除了这个错误类别——回滚决策只有一个出口，不会漏。"
    },
    {
      "type": "heading",
      "text": "手动 Begin / Commit / Rollback 与 defer 兜底"
    },
    {
      "type": "paragraph",
      "text": "某些场景（例如需要把事务句柄传给别的函数、或在 `if/else` 分支里提交）用 `db.Transaction` 的闭包形式不方便，可以手动控制。`tx := db.Begin()` 开始事务，成功后 `tx.Commit()`，失败时 `tx.Rollback()`。关键是要用 `defer` 保证任何提前返回的路径都不会留下一个挂起的未提交事务。"
    },
    {
      "type": "code",
      "title": "defer 兜底回滚",
      "language": "go",
      "code": "tx := db.Begin()\nif tx.Error != nil {\n    return tx.Error\n}\n\n// 防呆：凡是没走到 Commit 的路径，最后都补一个 Rollback\n// （Commit 之后再 Rollback 是安全的 no-op）\ndeferredRollback := true\ndefer func() {\n    if deferredRollback {\n        tx.Rollback()\n    }\n}()\n\ndoStepA(tx) // 任何一步失败，return 时 defer 会自动回滚\nif err := doStepB(tx); err != nil {\n    return err\n}\n\nif err := tx.Commit().Error; err != nil {\n    return err\n}\ndeferredRollback = false // 已提交，不再回滚\nreturn nil"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "不要忘了把 deferredRollback 置为 false",
      "body": "这个「defer + 标志位」模式里，只有把 `deferredRollback = false` 放在提交成功之后，才能避免「已经 Commit 又被 defer 再 Rollback」的乌龙。很多资深开发者也都用这个模式，但它比 `db.Transaction` 更容易出错——所以在能选的地方，优先闭包形式。"
    },
    {
      "type": "heading",
      "text": "嵌套事务与 Savepoint"
    },
    {
      "type": "paragraph",
      "text": "真实代码里常会出现「外层一个事务，内部又要局部回滚」。GORM 的做法是嵌套事务配合保存点（Savepoint）：内层 `tx.Transaction(...)` 或 `tx.SavePoint(\"sp\")` 相当于在事务里打个标记，之后 `tx.RollbackTo(\"sp\")` 只撤销这个标记之后的操作，而不会影响外层已经完成的部分。"
    },
    {
      "type": "code",
      "title": "SavePoint 实现局部回滚",
      "language": "go",
      "code": "err := db.Transaction(func(tx *gorm.DB) error {\n    if err := tx.Create(&userA).Error; err != nil {\n        return err\n    }\n\n    // 记住当前位置\n    if err := tx.SavePoint(\"sp1\").Error; err != nil {\n        return err\n    }\n\n    if err := tx.Create(&userB).Error; err != nil {\n        return err\n    }\n\n    // B 这条记录有问题，只回滚它，保留 userA\n    if err := tx.RollbackTo(\"sp1\").Error; err != nil {\n        return err\n    }\n\n    return nil // 提交时只包含 userA\n})"
    },
    {
      "type": "paragraph",
      "text": "在 GORM v2 里，内层嵌套的 `tx.Transaction(func(tx2 *gorm.DB) error { ... })` 也会自动使用保存点机制：内层返回 nil 只提交到保存点（不影响外层），内层返回 error 则回滚到保存点。如果你在内层错误处理里手动调用了 Commit/Rollback 而破坏了保存点，GORM 会有意改写其行为（文档称之为破坏性操作）——一般来说，不要在嵌套事务里手动控制提交/回滚。"
    },
    {
      "type": "heading",
      "text": "单条写操作其实也被包了事务"
    },
    {
      "type": "paragraph",
      "text": "你可能好奇：为什么单条 `db.Create(&user)` 不需要自己包事务？因为 GORM 在默认配置下，会为每一条单独的 Create / Update / Delete 隐式地包一层事务（`SkipDefaultTransaction` 默认是 false）。好处是迁移、插件等场景更安全，代价是每条语句多了一次 BEGIN/COMMIT 的开销。"
    },
    {
      "type": "code",
      "title": "批量插入时关闭默认事务以提速",
      "language": "go",
      "code": "// 单条语句关闭默认事务：批量插入时能显著减少 BEGIN/COMMIT 次数\ndb.Session(&gorm.Session{SkipDefaultTransaction: true}).\n    Create(&users) // users 是一个很大的切片"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "什么时候值得关掉默认事务",
      "body": "当你确认「某一条单独的写语句」本身已具备原子性、不需要事务语义，且处于高吞吐的批量路径（例如一次插入上万行）时，再用 `SkipDefaultTransaction: true`。日常 CRUD 保持默认即可——不要为了微小的优化过早关掉它。"
    },
    {
      "type": "heading",
      "text": "在事务内读取：用 tx 而不是 db"
    },
    {
      "type": "paragraph",
      "text": "事务内的读取也应当使用 `tx`。一个常见误区是「我在事务里，但用 `db.First(...)` 去读」。`db` 走的是独立的数据库连接，读不到 `tx` 里尚未提交的修改；而 `tx` 会复用同一个连接，你看到的是事务视角内的数据（取决于隔离级别）。所以：凡是逻辑上属于这个事务的读写，全部用 `tx`。"
    },
    {
      "type": "code",
      "title": "事务内一致性读取",
      "language": "go",
      "code": "db.Transaction(func(tx *gorm.DB) error {\n    var before, after User\n    if err := tx.Where(\"id = ?\", from).First(&before).Error; err != nil {\n        return err\n    }\n    if err := tx.Model(&User{}).Where(\"id = ?\", from).\n        Update(\"balance\", gorm.Expr(\"balance - ?\", amount)).Error; err != nil {\n        return err\n    }\n    if err := tx.Where(\"id = ?\", from).First(&after).Error; err != nil {\n        return err\n    }\n    _ = before // 读到的是变更前的值\n    _ = after  // 与 before 相差 amount\n    return nil\n})"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "事务别拖太长",
      "body": "事务在执行期间通常持有行锁或连接。写操作的锁会阻塞其它事务，连接也会被长时间占用。因此事务里只放必须原子的逻辑，绝不要放网络请求、用户输入等待、长时间计算。一个常见的工程反例是「在事务里调用第三方支付接口」——正确做法是先落库标记「处理中」，回调成功后再开事务改状态。"
    },
    {
      "type": "quiz",
      "question": "对于 `db.Transaction(func(tx *gorm.DB) error { ... })`，下面哪种说法正确？",
      "options": [
        "闭包返回 nil 时整体回滚",
        "闭包返回 error 时整体回滚，返回 nil 时提交",
        "闭包返回 error 时也照样提交，只是记一条日志",
        "闭包内无论做什么，最终都会提交"
      ],
      "answer": 1,
      "explanation": "db.Transaction 的契约是：返回非 nil error 则回滚并把该错误返回；返回 nil 则提交。"
    },
    {
      "type": "exercise",
      "title": "补齐转账事务",
      "description": "实现一个 `Transfer(db, from, to, amount)`：用 `db.Transaction` 完成「校验余额→扣款→加款→记订单」，确保任何一步失败都整体回滚，并在余额不足时返回明确的业务错误。",
      "hint": "把四步放进闭包，每一步检查 `.Error`，失败就 `return err`；余额校验失败可以 `return errors.New(\"余额不足\")`；全部成功再 `return nil`。"
    },
    {
      "type": "keypoints",
      "items": [
        "多步必须同时生效的写操作要放进事务",
        "优先用 db.Transaction(func(tx) error)：error 回滚、nil 提交",
        "事务内一律用 tx，别用 db 去读或写",
        "手动 Begin/Commit/Rollback 时用 defer 兜底回滚",
        "嵌套事务用 SavePoint/RollbackTo 做局部回滚",
        "单条写默认也有隐式事务，可用 SkipDefaultTransaction 关闭"
      ]
    }
  ]
};
