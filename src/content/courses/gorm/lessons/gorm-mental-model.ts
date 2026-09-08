/* ==================================================================
 * 课时：GORM 的核心心智模型（gorm-mental-model）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-mental-model",
  courseSlug: "gorm",
  title: "GORM 的核心心智模型",
  summary: "从模型、Statement、Clause 到连接池，理解一次 GORM 操作怎样变成 SQL。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "学习任何一个框架，最怕的是「会调用 API 却不知道它在干什么」。如果你能先在心里建立起一幅清晰的地图——GORM 到底在你的程序与数据库之间承担什么职责，它的每行代码在背后发生了什么——那么后面学习模型定义、增删改查、关联关系时，就只是往这张地图上填细节，而不是不断撞见一个个孤立的魔法。这一节我们先不写多少代码，专注把这幅地图画对。",
    },
    {
      type: "heading",
      text: "没有 ORM 时，你在写什么",
    },
    {
      type: "paragraph",
      text: "先回到最原始的形态。假设你要用 Go 直接操作 MySQL，把一篇博客文章存进去、再读出来。你会经历三件重复且容易出错的事。",
    },
    {
      type: "list",
      items: [
        "手写 SQL：把结构体的每个字段拼进一条 INSERT / SELECT 语句，字段一多，字符串拼接又长又容易写错字段名。",
        "手工映射：数据库返回的行（row）是数据库的类型，你要手动 `row.Scan` 把它塞回 Go 的 `User` 结构体字段，类型还得逐个转换。",
        "样板代码：打开连接、关闭连接、处理每一行的 Scan、判断 rows.Err()……这些与业务无关的胶水代码，每个实体都要写一遍。",
      ],
    },
    {
      type: "code",
      title: "没有 ORM 的原始写法（示意）",
      language: "go",
      code: "// 手写 SQL + 手动映射，字段越多越痛苦\nrows, err := db.Query(\"SELECT id, name, email, age FROM users WHERE id = ?\", id)\nif err != nil {\n    return err\n}\ndefer rows.Close()\n\nvar u User\nif rows.Next() {\n    // 逐个字段手工 Scan，类型、顺序都不能错\n    err = rows.Scan(&u.ID, &u.Name, &u.Email, &u.Age)\n}\n",
    },
    {
      type: "paragraph",
      text: "这段代码只有一块查询，但你已经在操心三类事情：SQL 语法、类型映射、资源管理。如果把四个表、几十个字段、增删改查全写出来，烦琐程度会成倍放大，而且每一处手写都藏着写错字段名的风险。ORM 要解决的，正是这三类重复劳动。",
    },
    {
      type: "heading",
      text: "GORM 的角色：一层翻译器",
    },
    {
      type: "paragraph",
      text: "GORM（Go Object-Relational Mapping）是 Go 生态中最流行的 [ORM](glossary:orm) 库。它做的事情从本质上说只有一件：在「Go 结构体」和「数据库表」之间做双向翻译。",
    },
    {
      type: "list",
      items: [
        "定义方向：你声明一个 Go 结构体，GORM 根据约定把它翻译成一张表的形状（表名、列名、主键、索引）。",
        "写入方向：你传入一个结构体实例，GORM 把它翻译成 INSERT / UPDATE 语句。",
        "读取方向：你调用 Find / First，GORM 把查询翻译成 SELECT 语句，把结果行翻译回结构体切片。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "ORM 不是「免写 SQL」",
      body: "GORM 没有消灭 SQL，它只是替你生成 SQL。你仍然需要理解表、列、主键、外键这些数据库概念，否则很难判断它生成的语句对不对。这也是为什么这门课假设你已经掌握了基础 SQL——GORM 的每个 API 背后都对应着你熟悉的 SELECT/INSERT/UPDATE/DELETE。",
    },
    {
      type: "heading",
      text: "三个关键实体",
    },
    {
      type: "paragraph",
      text: "在整个 GORM 的使用中，你反复打交道的实体其实只有几个。先把它们的职责分清楚。",
    },
    {
      type: "definition",
      term: "*gorm.DB（数据库句柄）",
      definition: "GORM 的操作入口，持有配置、方言、底层 ConnPool 以及当前查询状态。它不是某一条物理连接；常规场景下底层是 database/sql 管理的连接池。初始化后的根句柄通常可共享，但带条件的传统 API 链不能随意复用。",
    },
    {
      type: "definition",
      term: "Model（模型）",
      definition: "一个 Go 结构体，对应数据库中的一张表。例如 `User` 结构体对应 `users` 表。它是 GORM 翻译的「源语言」。",
    },
    {
      type: "definition",
      term: "Statement 与 Clause",
      definition: "一次操作会构造一个 Statement。Where、Order、Limit、OnConflict 等能力把条件或表达式加入 Statement 的 Clause 集合，终结方法再由方言把这些 Clause 编译成目标数据库的 SQL 并交给连接池执行。",
    },
    {
      type: "heading",
      text: "最小的可用心智模型",
    },
    {
      type: "paragraph",
      text: "把上面连起来，就能得到这一节最重要的一个心智模型，三句话：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "模型类型提供表、列、主键、关联等 schema 信息，但查询结果也可以映射到专用 DTO。",
        "链式方法把 Clause 追加到本次逻辑 Statement；方言决定最终 SQL 的细节。",
        "First、Find、Create、Update、Delete 等终结操作才会借用连接并执行 SQL。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "链式方法不会立刻执行",
      body: "这是新手最容易产生的误解。`db.Where(...)` 或 `db.Order(...)` 返回的是另一个 `*gorm.DB`，此刻还没有任何 SQL 被发出。SQL 是在你调用 Find、Create 这类终结方法的那一刻才执行。理解这一点，你才能解释「为什么只调用 Where 却查不到任何东西」这类困惑。",
    },
    {
      type: "code",
      title: "把心智模型对应到代码",
      language: "go",
      code: "// 每个方法逐步拼 SQL；真正执行发生在 Find()\nvar posts []Post\n\ndb.Where(\"user_id = ?\", 42).   // 附加 WHERE 片段\n  Order(\"created_at DESC\").     // 附加 ORDER BY 片段\n  Limit(10).                    // 附加 LIMIT 片段\n  Find(&posts)                  // 此刻才构造完整 SQL 并执行\n\n// 等价地，GORM 大致生成（示意）：\n// SELECT * FROM posts WHERE user_id = 42\n//        ORDER BY created_at DESC LIMIT 10\n",
    },
    {
      type: "paragraph",
      text: "上面这段代码中，`Where`、`Order`、`Limit` 都在「往语句上追加条件」，只有最后的 `Find(&posts)` 才真正触发了对数据库的查询，并把结果填充进 `posts` 切片。这也解释了为什么你要把结果变量的地址（`&posts`）传进去——GORM 需要把翻译回来的行写进它指向的内存。",
    },
    {
      type: "heading",
      text: "两套 API，共用同一套引擎",
    },
    {
      type: "paragraph",
      text: "GORM v1.30.0 起提供泛型 API。传统 API 把结果、错误和 RowsAffected 放在返回的 `*gorm.DB` 上；泛型 API 用 `gorm.G[T](db)` 绑定结果类型，把 `context.Context` 传给终结操作，并直接返回数据与错误。两者最终都进入同一套 Statement、Callback、Clause、方言和连接池机制，可以在同一项目里渐进共存。",
    },
    {
      type: "code",
      title: "同一个查询的两种表达",
      language: "go",
      code: `// 传统 API：目标对象由调用方传入，错误在 *gorm.DB 上
var traditional []Post
err := db.Where("user_id = ?", 42).
    Order("created_at DESC").
    Limit(10).
    Find(&traditional).Error

// 泛型 API（GORM >= v1.30.0）：结果与错误直接返回
generic, err := gorm.G[Post](db).
    Where("user_id = ?", 42).
    Order("created_at DESC").
    Limit(10).
    Find(ctx)`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "根句柄可共享，不等于任意链都可共享",
      body: "传统 API 的 `db.Where(...)` 会产生携带 Statement 状态的句柄，把这种中间链保存后继续追加不同条件，可能造成条件污染。新会话方法或泛型 API 能提供更清晰的操作隔离；具体规则会在 Session 课展开。",
    },
    {
      type: "heading",
      text: "GORM 的能力边界",
    },
    {
      type: "paragraph",
      text: "一幅好的地图不仅要标出它能到达的地方，也要标出边界。ORM 并不适合所有访问数据库的场合，以下几个场景你应该思考是否绕开它。",
    },
    {
      type: "list",
      items: [
        "复杂的分析型 SQL：嵌套子查询、窗口函数、多表聚合这类「以 SQL 本身为中心」的场景，用 ORM 的链式拼装反而别扭，直接写原生 SQL 或使用 GORM 的原生 SQL 支持更清晰。",
        "高吞吐微调：ORM 在每条语句上都有对象转换与反射开销，会在你和数据库调优（如批量写入路径）之间隔一层。注重极致性能的读写路径有时值得绕过它。",
        "底层数据库能力：行锁、隔离级别细调、权限管理等更深层的数据库话题超出了 GORM 的职责。GORM 会给你有限的入口（例如行锁，我们会在并发那节讲），但深层机制属于独立的数据库课程范畴。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "边界不是「禁止」，而是「权衡」",
      body: "说 GORM 不适合复杂分析 SQL，不等于在这些场景里 GORM 完全无用。你可以用 GORM 处理大部分常规 CRUD，只在真正需要时切换到原生 SQL。合理的工程实践通常是两者并用，而不是非黑即白。",
    },
    {
      type: "heading",
      text: "关于关联关系的预告",
    },
    {
      type: "paragraph",
      text: "在后面的章节里你会遇到 User、Post、Comment 这三个模型之间的关联：一篇文章（Post）属于某个作者（User），一条评论（Comment）属于某篇文章和某个作者。这些「表之间的关系」在 ORM 里同样通过结构体字段表达。这一节你只需要知道它们存在、知道翻译层会为关联维护外键约定即可，具体机制留到专门的关联章节去深入。",
    },
    {
      type: "quiz",
      question: "以下哪个时刻，GORM 才会真正把 SQL 发送给数据库执行？",
      options: [
        "调用 db.Where(\"age > ?\", 18) 时",
        "调用 db.Order(\"created_at\") 时",
        "调用 db.Find(&users) 时",
        "声明结构体 type User struct 时",
      ],
      answer: 2,
      explanation: "Where、Order 这些链式方法只在往 SQL 语句上追加条件，真正触发执行的是 Find、Create、First 这类终结方法。声明结构体只定义了「翻译的源语言」，什么时候都不执行 SQL。",
    },
    {
      type: "keypoints",
      items: [
        "GORM 负责 schema 映射、SQL 构造、结果扫描与数据库工作流，但不会替你理解 SQL。",
        "*gorm.DB 是数据库句柄而非单条物理连接；常规连接由 database/sql 池化管理。",
        "链式方法构造 Statement/Clause，终结操作才借用连接并执行。",
        "泛型与传统 API 共用底层引擎，可以渐进共存，但返回值与链复用语义不同。",
        "复杂分析 SQL、数据库约束和极致性能路径仍需要回到 SQL 与目标方言判断。",
      ],
    },
  ],
};
