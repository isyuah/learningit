import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-generics-crud",
  courseSlug: "gorm",
  title: "泛型 CRUD：返回值、零值与错误",
  summary: "用泛型 API 完成创建、读取、更新、删除，并正确解释零值、未找到和 RowsAffected。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "泛型 CRUD 的价值不在于少写一个 &user，而在于让每个操作的输入、输出和错误路径更难被忽略。本节用博客后台的 User 模型走完一套真实服务方法，并反复检查三个稳定契约：context 由调用方传入、error 立即处理、条件写入用 rows 判断业务结果。",
    },
    {
      type: "heading",
      text: "创建：错误直接返回，模型仍用指针回填",
    },
    {
      type: "code",
      title: "创建单个与批量用户",
      language: "go",
      code: `func CreateUser(ctx context.Context, db *gorm.DB, u *User) error {
    if err := gorm.G[User](db).Create(ctx, u); err != nil {
        return fmt.Errorf("create user: %w", err)
    }
    return nil
}

func ImportUsers(ctx context.Context, db *gorm.DB, users []User) error {
    if len(users) == 0 {
        return nil
    }
    if err := gorm.G[User](db).CreateInBatches(ctx, &users, 500); err != nil {
        return fmt.Errorf("import users: %w", err)
    }
    return nil
}`,
    },
    {
      type: "paragraph",
      text: "T 是 User，但 Create 仍接收 *User，因为 ID 和自动时间等值需要回填。CreateInBatches 接收切片指针；批次大小不是越大越好，要与数据库参数上限、事务时间和失败重试策略一起决定。",
    },
    {
      type: "heading",
      text: "读取一条：把未找到当作领域分支",
    },
    {
      type: "code",
      title: "按 ID 查询并分类错误",
      language: "go",
      code: `var ErrUserNotFound = errors.New("user not found")

func GetUser(ctx context.Context, db *gorm.DB, id uint) (User, error) {
    user, err := gorm.G[User](db).
        Where("id = ?", id).
        First(ctx)
    if errors.Is(err, gorm.ErrRecordNotFound) {
        return User{}, ErrUserNotFound
    }
    if err != nil {
        return User{}, fmt.Errorf("query user %d: %w", id, err)
    }
    return user, nil
}`,
    },
    {
      type: "paragraph",
      text: "First、Take、Last 在没有记录时返回 gorm.ErrRecordNotFound；Find 查询列表时，空集合不是错误。仓储边界可以把框架错误翻译成稳定的领域错误，但必须保留 errors.Is 能识别的因果链，不能只比较错误文本。",
    },
    {
      type: "code",
      title: "列表查询：空结果是正常结果",
      language: "go",
      code: `func ListActiveUsers(ctx context.Context, db *gorm.DB, limit int) ([]User, error) {
    users, err := gorm.G[User](db).
        Where("active = ?", true).
        Order("id DESC").
        Limit(limit).
        Find(ctx)
    if err != nil {
        return nil, fmt.Errorf("list active users: %w", err)
    }
    return users, nil
}`,
    },
    {
      type: "heading",
      text: "更新：值语义和命中语义是两回事",
    },
    {
      type: "code",
      title: "单列更新与结构体更新",
      language: "go",
      code: `// 单列 Update 显式写入值，包括零值
rows, err := gorm.G[User](db).
    Where("id = ?", id).
    Update(ctx, "active", false)

// Updates 传 User 时，默认只更新非零字段
rows, err = gorm.G[User](db).
    Where("id = ?", id).
    Updates(ctx, User{Name: "新名字"})

// 要用 struct 写入零值，显式 Select
rows, err = gorm.G[User](db).
    Where("id = ?", id).
    Select("Age").
    Updates(ctx, User{Age: 0})`,
    },
    {
      type: "paragraph",
      text: "泛型 API 改善了返回形状，却不会改变 GORM 的更新语义：Updates(ctx, User{...}) 默认跳过零值。只改一列时用 Update；要更新多个字段且包含零值，使用 Select 明确字段，或使用由 GORM CLI 生成的 Set helper。不要用不完整模型模拟补丁对象后期待框架猜出哪些零值是用户真的提交的。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "err == nil 不代表用户存在",
      body: "条件 UPDATE 没命中任何行时通常不会报 SQL 错误，而是 rows=0、err=nil。对修改邮箱、推进订单状态、扣减配额等关键操作，必须把 RowsAffected 纳入领域决策；否则接口可能返回成功但数据根本没变。",
    },
    {
      type: "code",
      title: "用条件更新表达状态机",
      language: "go",
      code: `rows, err := gorm.G[Post](db).
    Where("id = ? AND status = ?", id, "draft").
    Update(ctx, "status", "published")
if err != nil {
    return fmt.Errorf("publish post: %w", err)
}
if rows != 1 {
    return ErrPostStateConflict
}`,
    },
    {
      type: "paragraph",
      text: "把旧状态放进 WHERE，数据库就会原子地验证状态并执行更新。rows=0 可能表示记录不存在，也可能表示状态已改变；如果产品需要区分两者，再执行一次只读查询。先查再改会扩大竞态窗口，不能替代条件更新。",
    },
    {
      type: "heading",
      text: "删除：默认写保护与软删除仍然生效",
    },
    {
      type: "code",
      title: "条件删除",
      language: "go",
      code: `rows, err := gorm.G[User](db).
    Where("id = ?", id).
    Delete(ctx)
if err != nil {
    return fmt.Errorf("delete user: %w", err)
}
if rows != 1 {
    return ErrUserNotFound
}`,
    },
    {
      type: "paragraph",
      text: "模型包含 gorm.DeletedAt 时，Delete 仍然执行软删除；没有有效条件的批量删除仍受 ErrMissingWhereClause 保护。需要查询、恢复或物理删除软删记录时，可使用传统 API 的 Unscoped，在仓储内部封装这类高风险操作。",
    },
    {
      type: "heading",
      text: "WithResult：在需要时获取执行元数据",
    },
    {
      type: "code",
      title: "捕获批量创建的结果",
      language: "go",
      code: `result := gorm.WithResult()
err := gorm.G[User](db, result).
    CreateInBatches(ctx, &users, 200)
if err != nil {
    return err
}
log.Printf("inserted=%d", result.RowsAffected)`,
    },
    {
      type: "paragraph",
      text: "WithResult 作为可选 Clause 表达式传给 gorm.G，可以取得 RowsAffected 和底层 sql.Result。只在调用者确实需要这些元数据时使用；大多数 Create 只处理 error 即可，Update/Delete 已直接返回 rows。",
    },
    {
      type: "heading",
      text: "错误翻译的边界",
    },
    {
      type: "paragraph",
      text: "开启 gorm.Config{TranslateError: true} 后，部分方言错误可翻译为 gorm.ErrDuplicatedKey、gorm.ErrForeignKeyViolated 等统一错误。它便于跨方言的上层分类，但会丢失一部分数据库专属细节。需要区分约束名、重试类别或具体错误码时，保留驱动错误解析，并把它集中在数据访问层。",
    },
    {
      type: "table",
      caption: "操作结果如何进入业务决策",
      headers: ["结果", "常见含义", "处理"],
      rows: [
        ["ErrRecordNotFound", "单行查询没有记录", "翻译成领域未找到"],
        ["ErrDuplicatedKey", "唯一约束冲突", "409/幂等成功/业务冲突，按场景决定"],
        ["rows = 0, err = nil", "条件写未命中", "不存在或状态冲突，不能直接算成功"],
        ["context deadline/canceled", "调用被取消或超时", "停止后续工作，按幂等性决定能否重试"],
        ["驱动错误", "连接、语法、约束或数据库状态", "记录安全上下文，分类后上抛"],
      ],
    },
    {
      type: "quiz",
      question: "执行泛型条件更新后得到 rows=0、err=nil，最合理的解释是什么？",
      options: [
        "SQL 执行成功，但没有记录满足 WHERE；业务层仍需判断不存在或状态冲突",
        "GORM 一定发生了内部错误",
        "记录已经更新，只是驱动不统计行数",
        "应立即用 Save 再试一次",
      ],
      answer: 0,
      explanation: "数据库成功执行一条没有命中行的 UPDATE 并不是 SQL 错误。RowsAffected 是条件写入的业务信号，不能忽略。",
    },
    {
      type: "exercise",
      title: "实现一个安全的 PublishPost",
      description: "实现 PublishPost(ctx, db, id)：只允许 draft 到 published，返回稳定的 ErrPostStateConflict，记录不存在时按产品要求决定是否区分。要求使用泛型 Update、检查 rows，并解释为什么不能先 First 再无条件 Update。",
      hint: "把 id 和旧 status 同时放进 WHERE；如果 rows=0 且确实需要区分不存在，再追加一次查询。",
    },
    {
      type: "keypoints",
      items: [
        "泛型 Create 直接返回 error，但仍传指针以接收主键等回填值。",
        "First/Take/Last 的未找到是 ErrRecordNotFound；Find 的空列表不是错误。",
        "Updates(ctx, struct) 默认跳过零值；单列 Update 或 Select 可显式写零值。",
        "条件写必须检查 rows；err=nil 只代表数据库执行成功。",
        "软删除、全局写保护、Hook 和插件不会因为使用泛型 API 而消失。",
        "错误翻译适合统一分类，数据库专属诊断应集中在数据访问层。",
      ],
    },
  ],
};
