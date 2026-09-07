import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-generics-joins-preload",
  courseSlug: "gorm",
  title: "泛型查询：Joins、Preload 与 Raw SQL",
  summary: "使用泛型 JoinBuilder、PreloadBuilder、LimitPerRecord 与 Raw/Exec 处理复杂查询。",
  minutes: 36,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "泛型 API 不只覆盖简单 CRUD。它为关联 Join 和 Preload 提供了专门的 builder，让回调能表达关联条件、排序和每个父记录的限制；遇到 ORM 表达不自然的报表或方言能力时，也保留 Raw、Exec、Row 与 Rows 作为明确的 SQL 边界。",
    },
    {
      type: "heading",
      text: "先选加载策略，再写 API",
    },
    {
      type: "table",
      caption: "Preload 与 Joins 的决策",
      headers: ["需求", "优先选择", "原因"],
      rows: [
        ["加载 has-many/many-to-many 集合", "Preload", "主查询和关联查询分开，避免父行被重复展开"],
        ["加载一个 belongs-to/has-one", "Preload 或 Join Preload", "按查询数、筛选需求和行宽选择"],
        ["按关联是否存在筛选父记录", "Joins + clause.Has", "让数据库按关联存在性筛选"],
        ["每个父记录只取前 N 个子项", "PreloadBuilder.LimitPerRecord", "表达 per-parent 限制，不是全局 Limit"],
        ["复杂报表/窗口函数", "Raw 到专用 DTO", "SQL 本身是核心，ORM 链不应遮蔽语义"],
      ],
    },
    {
      type: "heading",
      text: "条件 Preload 与嵌套 Preload",
    },
    {
      type: "code",
      title: "加载已发布文章及最新评论",
      language: "go",
      code: `users, err := gorm.G[User](db).
    Where("active = ?", true).
    Preload("Posts", func(p gorm.PreloadBuilder) error {
        p.Where("status = ?", "published").
          Order("published_at DESC").
          LimitPerRecord(3)
        return nil
    }).
    Preload("Posts.Comments", func(p gorm.PreloadBuilder) error {
        p.Order("created_at DESC").LimitPerRecord(2)
        return nil
    }).
    Find(ctx)`,
    },
    {
      type: "paragraph",
      text: "Limit 与 LimitPerRecord 不是一回事。对 has-many 集合，普通 Limit 可能限制整次关联查询的总行数，导致前几个父记录拿完额度；LimitPerRecord 表达每个父记录各取 N 条。最终 SQL 和性能仍受方言能力影响，需要在真实数据库上 EXPLAIN。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "Select 关联列时保留关联键",
      body: "Preload 需要父键和外键把多次查询的结果拼回对象图。只 Select 展示列却漏掉 ID、UserID 等关联键，可能导致关联无法正确装配。按需选列之前，先列出 GORM 完成映射所需的键。",
    },
    {
      type: "heading",
      text: "Joins：按关联存在性和关联条件筛选",
    },
    {
      type: "code",
      title: "只查拥有 Company 的用户",
      language: "go",
      code: `users, err := gorm.G[User](db).
    Joins(clause.Has("Company"), nil).
    Find(ctx)`,
    },
    {
      type: "code",
      title: "LEFT JOIN 并限制关联表",
      language: "go",
      code: `user, err := gorm.G[User](db).
    Joins(
        clause.LeftJoin.Association("Company"),
        func(j gorm.JoinBuilder, joinTable clause.Table, curTable clause.Table) error {
            j.Where(map[string]any{"name": companyName})
            return nil
        },
    ).
    Where("users.id = ?", id).
    First(ctx)`,
    },
    {
      type: "paragraph",
      text: "JoinBuilder 把关联 JOIN 的附加条件限制在回调中，joinTable 和 curTable 能用于构造不依赖硬编码别名的表达式。Joins 更适合一对一关联；若对 has-many 直接 JOIN，父行可能因每个子记录重复，分页、计数和扫描都会变复杂。",
    },
    {
      type: "heading",
      text: "使用子查询作为关联来源",
    },
    {
      type: "code",
      title: "从受限 Company 子查询进行 Join",
      language: "go",
      code: `companyQuery := gorm.G[Company](db).
    Select("id", "name").
    Where("enabled = ?", true)

users, err := gorm.G[User](db).
    Joins(
        clause.LeftJoin.
            AssociationFrom("Company", companyQuery).
            As("active_company"),
        nil,
    ).
    Find(ctx)`,
    },
    {
      type: "paragraph",
      text: "把子查询放进 Join 能先缩小关联数据，但复杂度会迅速上升。代码评审时不要只看链是否优雅，要把生成 SQL、索引路径、结果基数和分页语义一起检查。链式 API 只是 SQL 构造器，不会自动选择最佳执行计划。",
    },
    {
      type: "heading",
      text: "Raw：复杂 SQL 返回强类型结果",
    },
    {
      type: "code",
      title: "把聚合查询扫进专用 DTO",
      language: "go",
      code: `type AuthorStat struct {
    UserID    uint
    PostCount int64
}

stats, err := gorm.G[AuthorStat](db).
    Raw(
        "SELECT user_id, COUNT(*) AS post_count "+
            "FROM posts WHERE status = ? "+
            "GROUP BY user_id HAVING COUNT(*) >= ?",
        "published", minPosts,
    ).
    Find(ctx)`,
    },
    {
      type: "paragraph",
      text: "T 不必总是数据库模型，也可以是查询专用 DTO。Raw 仍应把所有值作为参数绑定；表名、列名、排序方向等标识符不能用 ? 占位，必须来自可信代码或经过白名单映射。",
    },
    {
      type: "code",
      title: "Exec 与 WithResult",
      language: "go",
      code: `result := gorm.WithResult()
err := gorm.G[any](db, result).Exec(
    ctx,
    "UPDATE posts SET archived_at = ? WHERE status = ? AND created_at < ?",
    time.Now(), "published", cutoff,
)
if err != nil {
    return err
}
log.Printf("archived=%d", result.RowsAffected)`,
    },
    {
      type: "heading",
      text: "Row/Rows：手动扫描时承担资源责任",
    },
    {
      type: "code",
      title: "流式读取行",
      language: "go",
      code: `rows, err := gorm.G[User](db).
    Where("active = ?", true).
    Select("id", "email").
    Rows(ctx)
if err != nil {
    return err
}
defer rows.Close()

for rows.Next() {
    var id uint
    var email string
    if err := rows.Scan(&id, &email); err != nil {
        return err
    }
}
return rows.Err()`,
    },
    {
      type: "paragraph",
      text: "一旦选择 Rows，GORM 不再替你完成全部扫描与资源管理。必须 Close、检查每次 Scan，并在循环结束后检查 rows.Err。长时间逐行处理会持续占用连接；大量数据更常用 FindInBatches，让每批查询及时结束。",
    },
    {
      type: "quiz",
      question: "需要为每个 User 预加载最近 3 篇 Post，哪个选择最贴合语义？",
      options: [
        "在 PreloadBuilder 中 Order 后使用 LimitPerRecord(3)",
        "在主查询上 Limit(3)",
        "对 has-many 直接 JOIN 后忽略重复父行",
        "循环每个 User 单独查询 3 篇 Post",
      ],
      answer: 0,
      explanation: "LimitPerRecord 表达每个父记录的关联上限；主查询 Limit 限制父记录，循环查询会制造 N+1。",
    },
    {
      type: "exercise",
      title: "实现博客首页加载策略",
      description: "首页需要 20 位活跃作者、每人最近 3 篇已发布文章、每篇文章最近 2 条评论，并显示文章数。设计 Preload/聚合查询组合，说明为什么不使用一个巨型 JOIN，并列出要检查的索引。",
      hint: "对象图加载和聚合统计不一定要塞进一条 SQL。分别考虑父记录分页、每父记录限制、结果基数和缓存可能性。",
    },
    {
      type: "keypoints",
      items: [
        "Preload 适合集合关联；Joins 更适合按一对一关联加载或筛选。",
        "LimitPerRecord 表达每个父记录的关联上限，与普通 Limit 不同。",
        "关联 Select 必须保留装配所需的主键和外键。",
        "Raw 可以返回强类型 DTO，但字符串 SQL、标识符和执行计划仍由你负责。",
        "Exec 配合 WithResult 取得影响行数；Rows 需要显式 Close、Scan 和 Err 检查。",
        "选择 API 的标准是查询语义与性能形状，不是链式代码看起来更短。",
      ],
    },
  ],
};
