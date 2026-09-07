import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-upsert-clauses",
  courseSlug: "gorm",
  title: "Clause、Upsert 与 SQL 表达式",
  summary: "理解 GORM 如何组合 Clause，并用 OnConflict、Expr、Locking 和 Returning 表达数据库语义。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "GORM 链式 API 的底层不是把字符串不断拼接，而是把能力加入 Statement 的 Clause 集合。Where、Order、Limit、OnConflict、Locking 等 Clause 最后由方言编译成 SQL。理解这个模型，才能解释为什么同一段 Go 在 MySQL、PostgreSQL、SQLite 上生成的语句可能不同。",
    },
    {
      type: "heading",
      text: "Clause 是可组合的 SQL 语义",
    },
    {
      type: "code",
      title: "用 Clause 表达锁与冲突",
      language: "go",
      code: `var order Order
err := db.Transaction(func(tx *gorm.DB) error {
    if err := tx.Clauses(clause.Locking{
        Strength: "UPDATE",
        Options:  "NOWAIT",
    }).First(&order, id).Error; err != nil {
        return err
    }
    return tx.Model(&order).Update("status", "paid").Error
})

err := db.Clauses(clause.OnConflict{DoNothing: true}).
    Create(&language).Error`,
    },
    {
      type: "paragraph",
      text: "Locking 需要事务才能产生有意义的持有范围；NOWAIT/SKIP LOCKED 是否可用取决于数据库。OnConflict 也不是一个跨方言完全相同的 SQL 字符串，GORM 让 Dialector 负责生成 INSERT ... ON DUPLICATE KEY、ON CONFLICT 或 MERGE 等语法。",
    },
    {
      type: "heading",
      text: "Upsert 的三个决策",
    },
    {
      type: "table",
      caption: "OnConflict 不是单一策略",
      headers: ["策略", "示例", "适合什么"],
      rows: [
        ["DoNothing", "冲突即忽略", "幂等创建、重复消息去重"],
        ["AssignmentColumns", "冲突时更新列", "同步外部资料、状态刷新"],
        ["DoUpdates + Expr", "按数据库表达式更新", "计数器递增、取较大值、时间比较"],
      ],
    },
    {
      type: "code",
      title: "冲突时用表达式更新计数",
      language: "go",
      code: `err := db.Clauses(clause.OnConflict{
    Columns: []clause.Column{{Name: "post_id"}, {Name: "user_id"}},
    DoUpdates: clause.Assignments(map[string]any{
        "count":     gorm.Expr("count + ?", 1),
        "updated_at": gorm.Expr("CURRENT_TIMESTAMP"),
    }),
}).Create(&reaction).Error`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "Upsert 仍需要唯一约束",
      body: "OnConflict 只有在数据库能识别冲突目标时才有意义。没有对应唯一键时，DoNothing 不会阻止业务重复。把冲突列设计、迁移和 GORM Clause 当作同一个功能交付。",
    },
    {
      type: "heading",
      text: "Expr：原子更新优于先读后写",
    },
    {
      type: "code",
      title: "原子扣减库存",
      language: "go",
      code: `result := db.Model(&Product{}).
    Where("id = ? AND stock > 0", productID).
    UpdateColumn("stock", gorm.Expr("stock - ?", 1))
if result.Error != nil {
    return result.Error
}
if result.RowsAffected != 1 {
    return ErrOutOfStock
}`,
    },
    {
      type: "paragraph",
      text: "把 stock > 0 和 stock - 1 放在同一条 UPDATE 中，数据库会在并发下原子判断和修改。先查询 stock、在 Go 中减一、再 Save 会产生丢更新窗口，事务本身也不能替你选择正确的写入顺序。",
    },
    {
      type: "heading",
      text: "DryRun 与 Statement：看清生成的 SQL",
    },
    {
      type: "code",
      title: "只构造 SQL，不连接数据库执行",
      language: "go",
      code: `stmt := db.Session(&gorm.Session{DryRun: true}).
    Where("status = ?", "published").
    Order("published_at DESC").
    Find(&Post{}).Statement

sql := stmt.SQL.String()
vars := stmt.Vars
log.Printf("sql=%s vars=%v", sql, vars)`,
    },
    {
      type: "paragraph",
      text: "DryRun 适合调试、快照和迁移前检查，但生成 SQL 不代表目标数据库一定接受或使用预期索引。日志里的 Explain SQL 也不应被复制成生产执行语句；真正安全性来自参数绑定，日志展示可能是插值后的诊断文本。",
    },
    {
      type: "heading",
      text: "Returning 与方言差异",
    },
    {
      type: "code",
      title: "请求数据库返回变更后的列",
      language: "go",
      code: `var users []User
err := db.Clauses(clause.Returning{
    Columns: []clause.Column{{Name: "id"}, {Name: "updated_at"}},
}).Where("active = ?", false).
    Delete(&users).Error`,
    },
    {
      type: "paragraph",
      text: "Returning 是方言能力，不应当作所有数据库都支持的默认行为。课程代码如果依赖返回行，必须在目标驱动上验证；否则使用 RowsAffected 和后续查询表达通用语义。",
    },
    {
      type: "heading",
      text: "什么时候写 Raw 而不是自定义 Clause",
    },
    {
      type: "list",
      items: [
        "普通 CRUD、条件、排序、锁、冲突处理：优先使用现有 Clause，保留方言适配。",
        "复杂报表、窗口函数、CTE 或方言专属函数：Raw + 专用 DTO 通常更清晰。",
        "团队反复使用的表达式：可以封装 clause.Expression，但必须为每个方言定义语义。",
        "用户输入的列名、排序方向、表名：只能从白名单映射，不能直接拼进 Clause 或 Raw。",
      ],
    },
    {
      type: "quiz",
      question: "为什么库存扣减优先使用 UPDATE stock = stock - 1 WHERE stock > 0？",
      options: [
        "把检查和写入放进数据库的一条原子语句，避免先读后写的丢更新窗口",
        "因为 GORM 不支持 First",
        "因为事务不能执行 SELECT",
        "因为 Expr 会自动建立索引",
      ],
      answer: 0,
      explanation: "Expr 只是生成表达式，正确性来自条件 UPDATE 的原子执行与 RowsAffected 检查，不是来自 ORM 语法本身。",
    },
    {
      type: "exercise",
      title: "为重复消息选择 Upsert 策略",
      description: "设计一个 webhook_events 表，要求同一个 provider_event_id 只处理一次，重复消息不产生副作用。写出唯一键、OnConflict 策略、处理状态字段和失败重试语义。",
      hint: "先区分“重复已成功”“第一次处理中”“上次失败可重试”，再决定 DoNothing 是否足够。",
    },
    {
      type: "keypoints",
      items: [
        "GORM 通过 Statement/Clause 组合 SQL 语义，再由 Dialector 生成方言 SQL。",
        "OnConflict 要与数据库唯一键一起设计，DoNothing、更新列和 Expr 是不同策略。",
        "条件 UPDATE + Expr 能把检查和修改放进一个原子语句。",
        "DryRun 能观察 SQL 和 Vars，但不等价于目标数据库执行计划。",
        "Returning、Locking 及其它高级 Clause 都有方言边界，必须实测。",
        "优先使用现有 Clause 保留可移植性，Raw/自定义表达式用于真正复杂的 SQL。",
      ],
    },
  ],
};
