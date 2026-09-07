import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-schema-indexes-constraints",
  courseSlug: "gorm",
  title: "索引、约束与字段权限",
  summary: "从查询和数据不变量出发设计索引、唯一约束、检查约束、外键与字段读写权限。",
  minutes: 30,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "模型标签不是装饰性元数据，它会参与建表、查询和写入。真正稳健的模型需要同时回答三类问题：数据库如何高效定位数据，哪些状态必须由数据库拒绝，以及哪些字段允许在哪种操作里被读写。把这些规则只留在服务代码里，会在并发、脚本和其它客户端面前失效。",
    },
    {
      type: "heading",
      text: "索引从查询形状出发",
    },
    {
      type: "code",
      title: "为博客查询设计复合索引",
      language: "go",
      code: `type Post struct {
    ID          uint
    UserID      uint      ` + "\x60" + `gorm:"index:idx_posts_author_status_time,priority:1"` + "\x60" + `
    Status      string    ` + "\x60" + `gorm:"size:16;index:idx_posts_author_status_time,priority:2"` + "\x60" + `
    PublishedAt time.Time ` + "\x60" + `gorm:"index:idx_posts_author_status_time,sort:desc,priority:3"` + "\x60" + `
    Slug        string    ` + "\x60" + `gorm:"size:160;uniqueIndex"` + "\x60" + `
}`,
    },
    {
      type: "paragraph",
      text: "复合索引顺序应该服务真实 WHERE、ORDER BY 和基数分布。示例面向“某作者的已发布文章按发布时间倒序”这一查询；如果系统主要按 status 跨作者扫描，顺序可能不同。priority 只决定同一复合索引中的字段次序，不会替你判断哪个次序更快。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "标签能创建索引，不能证明索引合理",
      body: "每个字段都加 index 会增加写放大、磁盘占用和优化器选择成本。用慢查询、EXPLAIN 和线上负载验证；删除或改名索引则应进入版本化迁移，不要期待 AutoMigrate 自动清理旧索引。",
    },
    {
      type: "heading",
      text: "唯一约束是并发正确性的最后防线",
    },
    {
      type: "paragraph",
      text: "注册邮箱、文章 slug、幂等 request_id 等业务键必须由数据库唯一约束保证。应用层“先查询不存在再插入”在两个并发请求下仍可能同时通过，只有唯一索引能对最终写入做原子裁决。GORM 捕获冲突后，再把方言错误或 ErrDuplicatedKey 翻译成领域冲突。",
    },
    {
      type: "code",
      title: "复合唯一索引",
      language: "go",
      code: `type Membership struct {
    TenantID uint ` + "\x60" + `gorm:"uniqueIndex:uk_membership"` + "\x60" + `
    UserID   uint ` + "\x60" + `gorm:"uniqueIndex:uk_membership"` + "\x60" + `
    Role     string
}

// 数据库保证同一租户内同一用户只有一条 Membership`,
    },
    {
      type: "heading",
      text: "软删除与唯一性要按方言设计",
    },
    {
      type: "paragraph",
      text: "如果一行软删除后允许复用业务键，普通 unique(email) 会继续看到旧行。解决方式不是删除唯一约束，而是重新表达“活跃行唯一”：PostgreSQL 可用部分唯一索引；部分方言可把非 NULL 删除标志加入复合唯一索引；GORM 的 soft_delete 插件可用整数或时间戳标志帮助建模。方案必须与目标数据库的 NULL 唯一性规则一致。",
    },
    {
      type: "heading",
      text: "检查约束与外键约束",
    },
    {
      type: "code",
      title: "把不变量放进 schema",
      language: "go",
      code: `type Comment struct {
    ID     uint
    PostID uint   ` + "\x60" + `gorm:"not null;index"` + "\x60" + `
    Post   Post   ` + "\x60" + `gorm:"constraint:OnUpdate:CASCADE,OnDelete:RESTRICT;"` + "\x60" + `
    Score  int    ` + "\x60" + `gorm:"check:score_range,score >= -1 AND score <= 1"` + "\x60" + `
    Body   string ` + "\x60" + `gorm:"not null"` + "\x60" + `
}`,
    },
    {
      type: "paragraph",
      text: "外键决定父子数据能否进入悬空状态，OnDelete 决定删除父记录时的数据库行为。RESTRICT、CASCADE、SET NULL 没有通用最佳值：评论是否跟随文章删除、审计记录是否必须保留，都是领域决策。若迁移配置关闭了自动外键创建，就要在显式迁移中补上并验证。",
    },
    {
      type: "heading",
      text: "字段级读写权限",
    },
    {
      type: "table",
      caption: "常用字段权限标签",
      headers: ["标签", "语义", "适用例子"],
      rows: [
        ["->", "只读", "数据库生成列、视图字段"],
        ["<-:create", "仅创建可写", "创建后不可改变的 owner_id"],
        ["<-:update", "仅更新可写", "特殊回填字段"],
        ["-", "读写与迁移都忽略", "纯内存展示字段"],
        ["-:migration", "运行时可映射，迁移忽略", "由外部迁移管理的列"],
      ],
    },
    {
      type: "paragraph",
      text: "字段权限是数据访问层的一道护栏，不是授权系统。恶意调用者仍不应直接控制模型；HTTP/消息输入先经过 DTO、鉴权与业务校验，再映射到允许写入的字段。数据库权限、GORM 字段权限和应用授权要形成多层边界。",
    },
    {
      type: "heading",
      text: "用 Migrator 验证而非猜测",
    },
    {
      type: "code",
      title: "启动或迁移测试中的 schema 断言",
      language: "go",
      code: `m := db.Migrator()
if !m.HasIndex(&Post{}, "idx_posts_author_status_time") {
    return errors.New("required post index is missing")
}
if !m.HasConstraint(&Comment{}, "fk_comments_post") {
    return errors.New("required comment foreign key is missing")
}

types, err := m.ColumnTypes(&Post{})
// 检查数据库真实列类型，而不是只看 Go 标签`,
    },
    {
      type: "quiz",
      question: "为什么“注册前先查 email 是否存在”不能替代唯一索引？",
      options: [
        "两个并发请求可能同时查到不存在并同时插入，只有数据库约束能原子裁决",
        "因为 GORM 不支持 Where",
        "因为唯一索引只优化查询，不参与写入",
        "因为事务一定会自动串行所有注册请求",
      ],
      answer: 0,
      explanation: "先查后写存在竞态窗口。唯一约束是数据不变量的最终保证，应用层查询只负责更友好的提前反馈。",
    },
    {
      type: "exercise",
      title: "为博客后台审查 schema",
      description: "为 User、Post、Comment、Tag 设计主键、唯一键、复合索引、外键和 OnDelete 策略。每个索引都写出它服务的查询，每个约束都写出它阻止的非法状态。",
      hint: "从用户列表、作者文章页、slug 访问、评论加载、标签关联和删除流程反推，不要按字段清单机械加 index。",
    },
    {
      type: "keypoints",
      items: [
        "索引顺序来自真实查询形状和数据分布，标签只负责声明。",
        "唯一约束是并发下业务键和幂等键的最终防线。",
        "软删除的唯一性需要按方言使用部分索引、复合标志或 soft_delete 插件。",
        "外键与检查约束把不变量放在所有写入客户端共享的数据库边界。",
        "字段权限是写入护栏，不替代 DTO、鉴权和数据库权限。",
        "用 Migrator 与目标数据库检查真实 schema，不要只相信模型源码。",
      ],
    },
  ],
};
