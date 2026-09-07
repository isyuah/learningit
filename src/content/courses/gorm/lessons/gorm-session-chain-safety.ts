import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-session-chain-safety",
  courseSlug: "gorm",
  title: "Session、链污染与预编译语句",
  summary: "理解传统链式状态的复用边界，并正确使用 Session、NewDB、DryRun 与 PrepareStmt。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "根 *gorm.DB 通常可以在 goroutine 间共享，但一段已经追加 Where 的传统 API 中间链不等于无状态查询模板。GORM 的 Statement 会积累 Clause；错误复用可能把上一次条件带进下一次查询。Session 负责从根句柄派生具有明确配置和状态边界的操作。",
    },
    {
      type: "heading",
      text: "什么是条件污染",
    },
    {
      type: "code",
      title: "错误复用中间链",
      language: "go",
      code: `query := db.Where("tenant_id = ?", tenantID).
    Where("status = ?", "published")

query.Where("author_id = ?", 7).Find(&byAuthor)
// tenant_id AND status AND author_id

query.Where("featured = ?", true).Find(&featured)
// 可能累积成 tenant_id AND status AND author_id AND featured
// 第二次查询意外继承 author_id`,
    },
    {
      type: "paragraph",
      text: "链式方法返回新的 *gorm.DB，但传统 API 的 Statement 初始化状态决定它是否适合继续复用。最安全的规则是：长期保存根 db 或明确的新会话，具体条件在一次调用内构造并执行；不要把任意中间链当成不可变值对象。",
    },
    {
      type: "code",
      title: "用函数或新会话构造可复用策略",
      language: "go",
      code: `func PublishedForTenant(tenantID uint) func(*gorm.DB) *gorm.DB {
    return func(db *gorm.DB) *gorm.DB {
        return db.Where("tenant_id = ?", tenantID).
            Where("status = ?", "published")
    }
}

db.Scopes(PublishedForTenant(tenantID)).
    Where("author_id = ?", 7).
    Find(&byAuthor)

db.Scopes(PublishedForTenant(tenantID)).
    Where("featured = ?", true).
    Find(&featured)`,
    },
    {
      type: "heading",
      text: "泛型 API 的复用形状更清晰",
    },
    {
      type: "code",
      title: "复用泛型基础条件",
      language: "go",
      code: `published := gorm.G[Post](db).
    Where("tenant_id = ?", tenantID).
    Where("status = ?", "published")

byAuthor, err := published.Where("author_id = ?", 7).Find(ctx)
featured, err := published.Where("featured = ?", true).Find(ctx)`,
    },
    {
      type: "paragraph",
      text: "泛型链把操作记录下来，并在终结方法执行时应用到新的 Statement，因此更适合复用基础条件。这不代表可以忽略业务隔离：tenant 条件仍可能漏写，必须通过仓储边界、数据库策略或经过审查的插件保证。",
    },
    {
      type: "heading",
      text: "常用 Session 选项按行为分类",
    },
    {
      type: "table",
      caption: "Session 配置不是一份万能模板",
      headers: ["选项", "改变什么", "典型用途/风险"],
      rows: [
        ["NewDB", "创建不携带当前条件的新 DB", "需要同一事务但清除当前 Clause；可能绕过预期过滤"],
        ["Context", "后续操作共享 context", "传统 API 连续会话"],
        ["DryRun", "只构造 SQL 不执行", "调试/测试；不能证明数据库接受 SQL"],
        ["PrepareStmt", "缓存预编译语句", "重复 SQL 可能提速；占用客户端/服务端资源"],
        ["SkipHooks", "跳过模型 Hook", "受控导入；可能绕过重要不变量"],
        ["SkipDefaultTransaction", "写操作不套默认事务", "性能权衡；会改变原子边界"],
        ["CreateBatchSize", "控制创建批次", "统一限制语句大小和批次事务"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "Hook 里的 tx 是 NewDB 模式",
      body: "Hook 收到的 tx 与当前操作处于同一事务，但不带当前条件，方便查询其它模型。它不是全局根 db；必须继续使用这个 tx 才能参与同一事务，也要显式添加新的 WHERE，避免误更新全表。",
    },
    {
      type: "heading",
      text: "PrepareStmt 的收益与成本",
    },
    {
      type: "paragraph",
      text: "PrepareStmt 会为执行过的 SQL 创建并缓存预编译语句。重复且形状稳定的查询可能减少解析开销，但动态 SQL 形状多时会形成庞大缓存，并占用数据库端 prepared statement 配额。GORM v1.31 提供缓存最大数量和 TTL 配置；是否开启应由指标和压测决定。",
    },
    {
      type: "code",
      title: "按会话开启并管理语句缓存",
      language: "go",
      code: `tx := db.Session(&gorm.Session{PrepareStmt: true})
tx.First(&user, 1)
tx.Model(&user).Update("name", "alice")

stmtManager, ok := tx.ConnPool.(*gorm.PreparedStmtDB)
if ok {
    defer stmtManager.Close()
    // stmtManager.Stmts.Keys() 可用于诊断已缓存 SQL
}`,
    },
    {
      type: "paragraph",
      text: "全局开启时缓存跟随数据库句柄生命周期；Session 开启时要理解何时释放。还要避免高基数 SQL 文本：值使用参数绑定，而不是把值格式化进 SQL，既降低注入风险，也让语句形状更稳定。",
    },
    {
      type: "heading",
      text: "Session 与事务的边界",
    },
    {
      type: "code",
      title: "同一事务中派生配置",
      language: "go",
      code: `return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
    quiet := tx.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Error)})

    // quiet 仍使用事务连接，只改变当前会话配置
    if err := quiet.Create(&auditRows).Error; err != nil {
        return err
    }
    return tx.Model(&Post{}).
        Where("id = ?", id).
        Update("status", "published").Error
})`,
    },
    {
      type: "quiz",
      question: "为什么不应长期复用 db.Where(...) 得到的传统 API 中间链？",
      options: [
        "它可能携带并累积 Statement 条件，后续查询产生条件污染",
        "因为 *gorm.DB 只能使用一次",
        "因为 Where 会立即关闭连接池",
        "因为传统 API 不支持并发",
      ],
      answer: 0,
      explanation: "根句柄通常可共享，问题在于带条件的 Statement 状态。使用一次性链、Scope、Session 或泛型基础链表达复用。",
    },
    {
      type: "exercise",
      title: "找出一次多租户条件泄漏",
      description: "给定一个被多个仓储方法复用的 query := db.Where(tenant_id...)，构造能让条件累积或漏掉 tenant 的测试场景，并分别用 Scope 与泛型链重构。说明 NewDB 在哪里可能成为安全风险。",
      hint: "重点观察每次终结操作前 Statement 中有哪些 WHERE，不要只看变量名叫 query。",
    },
    {
      type: "keypoints",
      items: [
        "根 *gorm.DB 通常可共享；带条件的传统 API 中间链可能污染后续查询。",
        "一次性链、Scope、新 Session 和泛型基础链是更清晰的复用方式。",
        "Session 选项会改变真实行为，不能复制万能配置。",
        "Hook 的 tx 处于同一事务且是 NewDB 模式，应继续使用 tx 并重建条件。",
        "PrepareStmt 可能提速，也会占用缓存和数据库资源，要设置边界并用指标验证。",
        "Session 派生不会自动离开事务，但 NewDB/SkipHooks 等选项可能绕过业务护栏。",
      ],
    },
  ],
};
