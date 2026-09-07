import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-generics-overview",
  courseSlug: "gorm",
  title: "泛型 API：版本、设计与迁移路线",
  summary: "理解 gorm.G[T] 的设计目标、返回语义、与传统 API 的共存方式及渐进迁移策略。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "GORM 从 v1.30.0 起正式提供 Go 泛型 API。它不是另一个 ORM，也不是 GORM Gen 的别名：gorm.G[T](db) 仍然使用原来的模型解析、Clause、Callback、方言、插件和连接池，只是重新设计了调用表面，让结果类型、context 和错误流更符合现代 Go 代码的习惯。",
    },
    {
      type: "heading",
      text: "为什么传统 API 需要另一种调用表面",
    },
    {
      type: "paragraph",
      text: "传统 API 把查询构造状态和执行结果都放在 *gorm.DB 上。它很灵活，但也带来三个常见成本：结果目标通过 interface{} 传入，错误藏在链尾的 Error 字段里，保存一段带条件的中间链后复用还可能累积条件。泛型 API 用类型参数固定结果模型，让终结方法直接返回数据和 error，并在每次执行时显式接收 context。",
    },
    {
      type: "table",
      caption: "两套 API 的核心差异",
      headers: ["维度", "传统 API", "泛型 API"],
      rows: [
        ["结果类型", "调用方传 &user / &users", "gorm.G[User] 固定 T，First/Find 直接返回"],
        ["错误", "终结操作后的 result.Error", "直接返回 error"],
        ["Context", "db.WithContext(ctx)", "终结方法显式接收 ctx"],
        ["影响行数", "result.RowsAffected", "Update/Updates/Delete 直接返回，或用 WithResult"],
        ["链复用", "中间 *gorm.DB 需理解 Session 与条件污染", "操作应用到独立 Statement，更适合复用基础链"],
        ["生态", "完整且历史最久", "复用相同底层与插件，可渐进混用"],
      ],
    },
    {
      type: "code",
      title: "同一个查询的两种写法",
      language: "go",
      code: `// 传统 API
var user User
err := db.WithContext(ctx).
    Where("email = ?", email).
    First(&user).Error

// 泛型 API
user, err := gorm.G[User](db).
    Where("email = ?", email).
    First(ctx)`,
    },
    {
      type: "heading",
      text: "gorm.G[T] 绑定的是什么",
    },
    {
      type: "paragraph",
      text: "T 同时决定默认模型和常见返回类型。gorm.G[User](db) 默认从 users 表查询，First 返回 User，Find 返回 []User，Create 接收 *User。它带来的是结果与模型层面的类型信息，并不意味着字符串形式的列名和 SQL 条件自动获得编译期检查；Where 中的拼写错误仍要到运行期才暴露。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "泛型不等于所有 SQL 都类型安全",
      body: "gorm.G[User] 能防止把 User 查询误扫进完全不相关的结果类型，却不会检查字符串列名、Raw SQL 语法或数据库约束。需要字段级编译期帮助时，再考虑 GORM CLI 生成的 field helper；无论哪种方式都要用集成测试验证目标方言。",
    },
    {
      type: "heading",
      text: "终结方法直接表达结果语义",
    },
    {
      type: "code",
      title: "查询、计数与写入的典型返回值",
      language: "go",
      code: `user, err := gorm.G[User](db).Where("id = ?", id).First(ctx)
users, err := gorm.G[User](db).Where("active = ?", true).Find(ctx)
count, err := gorm.G[User](db).Where("active = ?", true).Count(ctx, "*")

rows, err := gorm.G[User](db).
    Where("id = ?", id).
    Update(ctx, "name", "新名字")

rows, err = gorm.G[User](db).
    Where("disabled = ?", true).
    Delete(ctx)`,
    },
    {
      type: "paragraph",
      text: "这种返回形状会推动调用方明确区分三件事：数据库执行是否失败、查询是否未找到、写操作是否影响了预期行数。error 为 nil 只表示执行成功，不保证条件更新命中一行；更新关键业务状态时仍要检查 rows。",
    },
    {
      type: "heading",
      text: "为什么没有 Save 与 FirstOrCreate",
    },
    {
      type: "paragraph",
      text: "泛型 API 有意移除了 Save 和 FirstOrCreate 等容易产生歧义或并发问题的方法。Save 在传统 API 中既可能创建也可能全量更新，更新未命中时还可能转为创建；FirstOrCreate 的先查后建也不能替代数据库唯一约束。泛型代码应显式选择 Create、Updates、OnConflict 或事务，让意图和并发保证可见。",
    },
    {
      type: "table",
      caption: "从模糊操作迁移到显式操作",
      headers: ["旧习惯", "泛型路径", "需要守住的规则"],
      rows: [
        ["Save(&user)", "已知新增用 Create；已知更新用 Where + Updates", "更新检查 rows，避免误插入"],
        ["FirstOrCreate", "唯一约束 + OnConflict，或事务内按业务规则处理", "应用层先查不能消除竞态"],
        ["result.Error", "直接检查返回的 err", "不要丢弃 error"],
        ["result.RowsAffected", "写方法返回 rows，或传 WithResult", "零行可能是业务冲突"],
      ],
    },
    {
      type: "heading",
      text: "传统与泛型 API 可以共存",
    },
    {
      type: "paragraph",
      text: "迁移不需要大爆炸式重写。事务入口、Association Mode、Migrator 和部分插件仍常通过传统 *gorm.DB 使用，而事务内部的普通 CRUD 可以调用 gorm.G[T](tx)。同一个服务中可以让新仓储方法使用泛型 API，旧模块保留传统 API，等行为测试稳定后再逐个迁移。",
    },
    {
      type: "code",
      title: "在传统事务入口中使用泛型操作",
      language: "go",
      code: `err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
    if err := gorm.G[Post](tx).Create(ctx, &post); err != nil {
        return err
    }

    rows, err := gorm.G[User](tx).
        Where("id = ?", post.UserID).
        Update(ctx, "post_count", gorm.Expr("post_count + 1"))
    if err != nil {
        return err
    }
    if rows != 1 {
        return fmt.Errorf("author not found")
    }
    return nil
})`,
    },
    {
      type: "heading",
      text: "一条可执行的迁移路线",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "先把 gorm.io/gorm 升到支持泛型的版本，并用现有集成测试确认传统路径没有回归。",
        "选择边界清晰的仓储方法，把 WithContext + Find/First 改成 gorm.G[T] 的直接返回。",
        "迁移写操作时补上 RowsAffected 决策，显式替换 Save/FirstOrCreate。",
        "保留 Migrator、Association Mode 或插件所需的 *gorm.DB，不为了形式纯度强行包装。",
        "在目标数据库上验证 SQL、错误分类、事务与关联行为，再扩大迁移范围。",
      ],
    },
    {
      type: "quiz",
      question: "下列哪项最准确地描述 GORM 泛型 API？",
      options: [
        "它是复用 GORM 底层引擎的新调用表面，让结果、context 和 error 更明确",
        "它完全绕开 *gorm.DB 和插件系统",
        "它让所有字符串 SQL 在编译期都能被验证",
        "它要求项目一次性删除全部传统 API",
      ],
      answer: 0,
      explanation: "泛型 API 与传统 API 共用核心引擎并支持渐进共存；类型参数改善结果类型与调用语义，但不会编译字符串 SQL。",
    },
    {
      type: "exercise",
      title: "为一个旧仓储制定迁移清单",
      description: "选择一个包含 First、Find、Save 和 FirstOrCreate 的传统仓储，逐个写出泛型替代方案。对每个写操作说明唯一约束、RowsAffected 和并发竞态如何处理。",
      hint: "不要做逐字 API 翻译。先给每个方法标注查询一条、查询列表、明确创建、条件更新、冲突插入中的哪一种语义。",
    },
    {
      type: "keypoints",
      items: [
        "GORM 泛型 API 从 v1.30.0 起提供，本课程按 v1.31.2 接口核对。",
        "gorm.G[T] 绑定模型和结果类型；终结方法直接接收 context 并返回数据/error。",
        "类型参数不会验证字符串列名和 Raw SQL，仍要依赖约束与集成测试。",
        "Save、FirstOrCreate 被有意移除，应改成 Create、Updates、OnConflict 或显式事务。",
        "传统与泛型 API 可在同一 *gorm.DB、事务和插件生态中渐进共存。",
      ],
    },
  ],
};
