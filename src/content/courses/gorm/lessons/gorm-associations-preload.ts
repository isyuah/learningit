/* ==================================================================
 * 课时：预加载：Preload 与 Joins（gorm-associations-preload）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-associations-preload",
  courseSlug: "gorm",
  title: "预加载：Preload 与 Joins",
  summary: "用 Preload 一次性把关联数据带回来，避开 N+1 查询陷阱，并理解 Preload 与 Joins 的取舍。",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "上一节我们建立了四种关联，并且知道 foreignKey 决定「怎么把两张表连起来」。但光有关联还不够——真正查询时，如果你手动一个个去取关联数据，很快会掉进性能深坑 N+1。这一节讲 GORM 的预加载（Preload），以及它和 Joins 各自的适用场景。",
    },
    {
      type: "heading",
      text: "N+1 问题：为什么「看起来很自然」的查询会爆炸",
    },
    {
      type: "paragraph",
      text: "假设你要列出 20 篇文章，并且每篇都要显示作者名字。最容易想到的写法是：先查出这 20 篇文章，再对每一篇单独查询一次它的作者。",
    },
    {
      type: "code",
      title: "朴素写法：一次主查询 + 每条子记录一次查询",
      language: "go",
      code: "var posts []Post\nif err := db.Find(&posts).Error; err != nil {\n    return err\n}\n\nfor i := range posts {\n    // 每篇文章都单独触发一次 SELECT\n    if err := db.First(&posts[i].User, posts[i].UserID).Error; err != nil {\n        return err\n    }\n}",
    },
    {
      type: "paragraph",
      text: "第一条 Find 查出 N 篇（这里是 20）篇文章，我紧接着又发了 N 次（20 次）查询取作者。总查询数 = 1 + N。当 N 是 20、100、甚至更多时，数据库来回次数线性增长，延迟和连接压力随之上升——这就是著名的 N+1 问题。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "N+1 是关联查询的头号性能陷阱",
      body: "凡是「先查出一批主记录，再逐条查它们的关联」，无论写成循环还是写在模板里，都会触发 N+1。它最大的危害不是单次慢，而是随数据量线性恶化、在压测时突然暴露。识别它的信号：日志里出现同一条 SQL 被重复执行 N 次。",
    },
    {
      type: "heading",
      text: "Preload 一次性取回关联",
    },
    {
      type: "paragraph",
      text: "GORM 的 Preload 把「逐条查询关联」合并成「在主查询之后，用一条 IN 查询一次取回全部关联」。对上面的例子，查询总数从 1+N 降到 2：一条查文章，一条查文章的所有作者。",
    },
    {
      type: "code",
      title: "用 Preload 避免 N+1",
      language: "go",
      code: "var posts []Post\nif err := db.Preload(\"User\").Find(&posts).Error; err != nil {\n    return err\n}\n\n// 生成的 SQL（示意）：\n// 1) SELECT * FROM posts;\n// 2) SELECT * FROM users WHERE id IN (post 的 user_id 列表);",
    },
    {
      type: "paragraph",
      text: "第一条查 posts 得到全部记录并收集所有 user_id；第二条用 `WHERE id IN (...)` 一次把用到的作者都取回来，GORM 再按外键把作者填进每篇 Post 的 User 字段。无论 20 篇还是 200 篇，只要作者还在同一页里，关联查询都只有这一条。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "关键收益",
      body: "Preload 让查询数量从「1 + N」变成「1 + 关联种类数」。代价是第二条查询可能返回更多行（一次取回所有文章的评论、所有作者），但对数据库而言，多返回些行远便宜过 N 次网络往返。",
    },
    {
      type: "heading",
      text: "嵌套预加载",
    },
    {
      type: "paragraph",
      text: "Post 有 User，还有 Comments，而每条 Comment 又属于 User。Preload 支持用点号逐层深入：`Preload(\"Comments.User\")` 会先预加载每篇文章的评论，再预加载每条评论的作者。",
    },
    {
      type: "code",
      title: "嵌套预加载与同时预加载多个关联",
      language: "go",
      code: "var posts []Post\ndb.Preload(\"User\").            // 文章的作者\n  Preload(\"Comments\").          // 每篇文章的评论\n  Preload(\"Comments.User\").     // 每条评论的作者\n  Find(&posts)\n\n// 也可以在同一调用里多点几层：\n// db.Preload(\"Comments.User\").Preload(\"Tags\").Find(&posts)",
    },
    {
      type: "paragraph",
      text: "嵌套预加载同样按「每个预加载字段一条查询」来压平：这里大概对应 文章→用户、文章→评论、评论→作者 几条查询，总次数与嵌套深度无关地可控，而不是对每条评论再逐条查作者。",
    },
    {
      type: "heading",
      text: "带条件的预加载",
    },
    {
      type: "paragraph",
      text: "Preload 的第二个参数可以传查询条件，只加载满足条件的关联数据。注意：这里的条件是加在「关联查询」上，而不是主查询上。",
    },
    {
      type: "code",
      title: "为关联附加筛选条件",
      language: "go",
      code: "var users []User\ndb.Preload(\"Posts\", \"title LIKE ?\", \"%GORM%\").Find(&users)\n\n// 只给每篇标题含 GORM 的文章填充 Posts；\n// 如果某用户没有任何匹配的文章，其 Posts 为空切片，但用户本身仍被返回",
    },
    {
      type: "paragraph",
      text: "这是「软筛选」：预加载的条件只作用于当前这一侧的关联数据。想用硬筛选（例如只返回「有匹配文章」的用户）就得到主查询上再加条件，不能指望预加载条件替你把用户过滤掉。",
    },
    {
      type: "heading",
      text: "自定义 Select 的预加载",
    },
    {
      type: "paragraph",
      text: "默认 Preload 会 `SELECT *` 取回关联的所有列。若只想取个别列（例如只要作者的 Name），可以给关联查询指定 Select。",
    },
    {
      type: "code",
      title: "预加载时只选部分列",
      language: "go",
      code: "var posts []Post\ndb.Preload(\"User\", func(db *gorm.DB) *gorm.DB {\n    return db.Select(\"id\", \"name\")\n}).Find(&posts)",
    },
    {
      type: "callout",
      variant: "warning",
      title: "Select 列改了，映射也要跟得上",
      body: "Preload 的 Select 需在回调里用 db.Select(...) 指定。若只选了 id、name，GORM 会用它们填充 User 字段，其他列（如 Email）会是零值。实践中按需选列能省带宽，但要确认没有代码依赖那些没选的字段。",
    },
    {
      type: "heading",
      text: "Joins：用一条 JOIN 查询来代替第二条查询",
    },
    {
      type: "paragraph",
      text: "对于 belongs-to 这类「一对一」的关联，还有一种更省的方式：Joins(\"User\")。它把关联直接写进同一条 SQL 的 JOIN 里，就完全没有了第二条查询。",
    },
    {
      type: "code",
      title: "Joins 预加载 belongs-to 关联",
      language: "go",
      code: "var posts []Post\nif err := db.Joins(\"User\").Find(&posts).Error; err != nil {\n    return err\n}\n\n// 示意 SQL：\n// SELECT posts.*, users.name, users.email ...\n// FROM posts JOIN users ON users.id = posts.user_id",
    },
    {
      type: "table",
      caption: "Preload 与 Joins 的对比",
      headers: ["维度", "Preload", "Joins"],
      rows: [
        ["查询条数", "主查询 + 每个关联一条 IN 查询", "belongs-to 场景可压成一条 JOIN"],
        ["适用范围", "has one / has many / many2many 都支持", "主要用于 belongs-to（一对一）关联；带条件时无法查到 LEFT JOIN 对应子句"],
        ["行重合", "各表独立返回，无列名冲突", "JOIN 会产生同名列，需注意 Select 与别名"],
        ["灵活性", "支持嵌套、条件、回调", "无法方便地带到其他表的作用域并做筛选"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "Joins 的边界",
      body: "Joins 主要适合 belongs-to 这种一条主记录恰好关联一条的场合，把往返省成一次。对于 has many / many2many，若强行 JOIN，会因一对多把主记录的行膨胀重复（Post 有多条 Comment 就会产生多行），此时应坚持用 Preload。",
    },
    {
      type: "heading",
      text: "两者的根本区别：独立的查询 vs 单条 SQL",
    },
    {
      type: "paragraph",
      text: "Preload 是一条主查询 + 若干条独立的关联查询，最后在 Go 内存里把对象拼起来；Joins 则是在数据库端用一条 JOIN 就把跨表数据取齐。理解这个区别，你才会根据「能不能少查、会不会行重复、有没有关联条件」来选择。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "经验法则",
      body: "默认优先 Preload——它语义最简单、几乎支持所有关联形态。只有当目标是 belongs-to 且想省掉第二条查询时，才考虑 Joins；一旦关联带自己的条件，就退回 Preload。",
    },
    {
      type: "quiz",
      question: "有 50 篇文章，用朴素写法（先 Find 全部，再逐篇 First 取作者）大约会发出多少次查询？",
      options: ["1", "2", "51", "50 的平方"],
      answer: 2,
      explanation: "1 条主查询 + 50 条取作者的查询 = 51，这正是「1 + N」的 N+1 陷阱。用 Preload(\"User\") 可以把 51 压成 2。",
    },
    {
      type: "exercise",
      title: "为列表页消除 N+1",
      description: "写一个查询：取前 10 篇 Post，同时带上每篇的作者、评论，以及每条评论的作者，且只取前 5 条评论。思考：这个需求用 Preload 怎么写？是不是该配合 Limit？提示：Preload 的第二个参数可以传 Limit。",
      hint: "db.Preload(\"User\").Preload(\"Comments\", func(db *gorm.DB) *gorm.DB { return db.Order(\"created_at DESC\").Limit(5) }).Preload(\"Comments.User\").Limit(10).Find(&posts)。注意别把 Limit 误加在主查询上。",
    },
    {
      type: "keypoints",
      items: [
        "N+1 = 1 条主查询 + N 条关联查询；用 Preload 把关联查询压成「每个关联一条」。",
        "Preload(\"User\") 先用主查询，再用 `IN (...)` 一次性取回全部作者。",
        "嵌套预加载 Preload(\"Comments.User\") 按字段逐层压平。",
        "Preload 第二参数可给关联加条件（软筛选）或自定义 Select。",
        "Joins(\"User\") 主要服务于 belongs-to，把第二条查询省成一条 JOIN；has many / many2many 慎用。",
      ],
    },
  ],
};
