/* ==================================================================
 * 课时：四种关联：建模与标签（gorm-associations-intro）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-associations-intro",
  courseSlug: "gorm",
  title: "四种关联：建模与标签",
  summary: "用一对一、一对多、多对一、多对多表达对象之间的关系，并理解 GORM 如何推断外键。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "单张表只能描述一个实体的属性，而真实业务大多发生在「实体之间」：一个用户有简介，发了很多文章，每篇文章有若干评论和标签。在关系型数据库里，这种关系靠外键承载；到了 GORM 里，我们把它建模成结构体字段之间的「关联」（Association），并让 GORM 帮我们推断或指定对应的外键与连接表。这一节先建立四种关联的心智模型，为后面讲预加载和关联 CRUD 打地基。",
    },
    {
      type: "heading",
      text: "贯穿课程的统一示例：博客后台",
    },
    {
      type: "paragraph",
      text: "整个「关联关系」章节都围绕同一套《博客后台》模型展开。它同时用到了四种关联类型，值得先完整贴出来。我们约定：每一条 Post 属于某个 User；每个 User 有一份 Profile、多篇 Post、多条 Comment；每条 Comment 属于某个 User 和某篇 Post；每篇 Post 与 Tag 是多对多。",
    },
    {
      type: "code",
      title: "博客后台完整模型（四种关联齐备）",
      language: "go",
      code: "type User struct {\n  ID       uint\n  Name     string\n  Email    string\n  Profile  Profile    // has one  ：一个用户一份简介\n  Posts    []Post     // has many ：一个用户多篇文章\n  Comments []Comment  // has many ：一个用户多条评论\n}\n\ntype Profile struct {\n  ID     uint\n  Bio    string\n  UserID uint        // belongs to 的外键：指向 users.id\n}\n\ntype Post struct {\n  ID       uint\n  Title    string\n  Body     string\n  UserID   uint      // 外键：指向 users.id\n  User     User      // belongs to ：文章属于某个作者\n  Comments []Comment // has many　：一篇文章多条评论\n  Tags     []Tag     // many2many ：文章与标签多对多\n}\n\ntype Comment struct {\n  ID      uint\n  Content string\n  UserID  uint\n  PostID  uint\n  User    User      // belongs to User\n  Post    Post      // belongs to Post\n}\n\ntype Tag struct {\n  ID    uint\n  Name  string\n  Posts []Post      // many2many 反查：这篇标签关联的文章\n}",
    },
    {
      type: "subheading",
      text: "四种关联分别回答什么问题",
    },
    {
      type: "definition",
      term: "Has One（一对一）",
      definition: "一个实体的「唯一附属」。User 有一条 Profile，Profile 只属于这一个 User。语义上由谁「拥有」谁决定方向：User 拥有它的 Profile。",
    },
    {
      type: "definition",
      term: "Has Many（一对多）",
      definition: "一个实体的「多个附属」。User 有多篇 Post，但每篇 Post 只属于一个 User。这是最常见的关系：一问一多，外键存在「多」的那一侧（Post 上）。",
    },
    {
      type: "definition",
      term: "Belongs To（多对一 / 属于）",
      definition: "从「多」的一侧反向指着「一」。Post 属于 User，所以 Post 结构体里有一个 User 字段和外键 UserID。Has Many 与 Belongs To 是同一张表两侧的镜像视角。",
    },
    {
      type: "definition",
      term: "Many2Many（多对多）",
      definition: "Post 与 Tag：一篇文章可以挂多个标签，一个标签也可以出现在多篇文章上。谁都不「拥有」对方，靠一张连接表（join table）记录配对关系，例如 post_tags。",
    },
    {
      type: "callout",
      variant: "note",
      title: "Has Many 与 Belongs To 是一体两面",
      body: "在 User 里写 Posts []Post 是 Has Many；在 Post 里写 User User 是 Belongs To。它们指向同一个物理关系（一篇文章归属一个作者），只是站在不同的模型上看。不要把它们当成两种没关系的东西。",
    },
    {
      type: "heading",
      text: "GORM 如何推断外键与引用列",
    },
    {
      type: "paragraph",
      text: "你看到上面模型里并没有任何标签——GORM 靠「命名约定」自动推断。理解这个推断规则，你就知道哪些代码可以省略、什么时候必须用标签显式指定。",
    },
    {
      type: "list",
      items: [
        "对于 belongs to（Post → User）：GORM 会找「所属类型名 + 主键」格式的字段作为外键，这里是 UserID，指向 users 表的 ID。类型 User 有主键 ID，所以推断为 `foreignKey: UserID`、`references: ID`。",
        "对于 has one / has many（User → Profile / Posts）：外键存在「被拥有方」（Profile 表、Post 表）中，命名为 `拥有方类型名 + 主键`，即 UserID，指向拥有方 User 的主键 ID。",
        "主键以外的引用：如果引用的不是主键，而是另一列（例如邮箱），就必须用标签显式声明 references，GORM 不会猜。",
        "many2many 不再使用单列外键，而是生成一张连接表（如 post_tags），两张原表的主键各自作为连接表的一列。",
      ],
    },
    {
      type: "table",
      caption: "四种关联的推断方向与默认外键",
      headers: ["关联", "方向", "外键 / 连接表（默认）", "示例"],
      rows: [
        ["Has One", "User → Profile（被拥有方存 FK）", "profile.user_id → users.id", "每个用户一份简介"],
        ["Has Many", "User → Posts（被拥有方存 FK）", "posts.user_id → users.id", "一个用户多篇文章"],
        ["Belongs To", "Post → User（所属方存 FK）", "posts.user_id → users.id", "文章属于某个作者"],
        ["Many2Many", "Post ↔ Tag（连接表存配对）", "post_tags(post_id, tag_id)", "文章与标签互相关联"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "命名约定不是魔法，是规则",
      body: "外键字段名必须是「类型名 + 主键名」才能被自动识别。若数据库字段命名与 Go 字段不一致，或引用的是非主键列，GORM 会推断成别的（甚至推断错误）。出现诡异的外键问题时，第一反应应是检查是否需要用标签显式声明。",
    },
    {
      type: "heading",
      text: "用标签显式声明：foreignKey / references",
    },
    {
      type: "paragraph",
      text: "当约定不成立或想让意图更明确时，用结构体标签覆盖默认推断。foreignKey 声明「用哪个字段当外键」，references 声明「引用目标表里的哪一列」。",
    },
    {
      type: "code",
      title: "显式外键与引用列",
      language: "go",
      code: "type Profile struct {\n  ID     uint\n  Bio    string\n  AuthorID uint         // 不要叫 UserID，改成 AuthorID\n  User   User `gorm:\"foreignKey:AuthorID;references:ID\"`\n}\n\ntype Post struct {\n  ID    uint\n  Title string\n  By    string   // 用邮箱而不是 ID 关联作者\n  Author User   `gorm:\"foreignKey:By;references:Email\"`\n}",
    },
    {
      type: "paragraph",
      text: "第一个例子里，我们把外键改名为 AuthorID，就必须告诉 GORM 它不再是默认的 UserID。第二个例子更关键：references 指明目标是 User 的 Email 列而不是主键 ID——不写这个标签，GORM 会默认去匹配主键，行为就错了。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "好标签的标准",
      body: "标签不是越写越好。默认能被正确推断时，写清外键归属（foreignKey）反而能提高可读性；只有当引用的不是主键、或外键命名不符合约定时才必须写 references。",
    },
    {
      type: "heading",
      text: "belongs-to 的嵌入声明",
    },
    {
      type: "paragraph",
      text: "如果你的结构体恰好叫「所属类型名」并且有主键（例如 Comment 里的 User 字段、类型正好是 User），那么它天然就是 belongs to 关系，连标签都不用写。这种「类型名即字段名」的简写形式在 belongs-to 里最常见。",
    },
    {
      type: "code",
      title: "belongs-to 的嵌入写法与显式写法等价",
      language: "go",
      code: "// 写法一：字段名等于类型名，直接推断为 belongs to\nComment {\n  User User\n}\n\n// 写法二：字段名自定义，仍要它是 belongs to，用标签声明\nComment {\n  Author User `gorm:\"foreignKey:UserID\"`\n}\n\n// 两条都指向同一关系：comments.user_id = users.id",
    },
    {
      type: "heading",
      text: "many2many 的连接表与标签",
    },
    {
      type: "paragraph",
      text: "多对多由 GORM 自动生成一张连接表。默认表名 = 两个模型名的「复数蛇形」拼接，按字母序：Post 与 Tag 生成 post_tags。连接表里有两列：post_id 和 tag_id，正好是两张原表的主键。",
    },
    {
      type: "code",
      title: "many2many 生成与自定义标签",
      language: "go",
      code: "type Tag struct {\n  ID    uint\n  Name  string\n  Posts []Post `gorm:\"many2many:post_tags;\"`\n}\n\n// 默认生成表：post_tags(post_id, tag_id)\n// 想换表名：gorm:\"many2many:article_tags\"\n// 两个模型都关联同一张连接表时，表名只需在其中一侧声明即可",
    },
    {
      type: "paragraph",
      text: "这里的连接表由 GORM 自动管理，一般不需要你定义对应结构体。只有当连接表本身需要携带额外字段（例如「文章标签」要记录顺序或权重）时，才考虑把连接表升级成显式模型——那属于进阶做法，本节先不展开。",
    },
    {
      type: "heading",
      text: "用 Constraint 声明删除语义",
    },
    {
      type: "paragraph",
      text: "关联只是约束了「怎么查」，而「删了父记录时子记录怎么办」由数据库的外键约束决定，GORM 不会替你默认级联删除。用 constraint 标签控制 ON DELETE / ON UPDATE 行为。",
    },
    {
      type: "code",
      title: "显式声明外键约束",
      language: "go",
      code: "type Post struct {\n  ID     uint\n  Title  string\n  UserID uint\n  User   User `gorm:\"constraint:OnUpdate:CASCADE,OnDelete:SET NULL;\"`\n}",
    },
    {
      type: "callout",
      variant: "warning",
      title: "不声明约束 = 没有级联",
      body: "如果不写 constraint 标签，删除一个仍被 Post 引用的 User 会因外键约束失败报错（或取决于数据库默认行为）。想要「删用户连同其文章一起删」必须显式声明 OnDelete:CASCADE（多数数据库还要求外键列允许 NULL 才能 SET NULL）。这个细节在后面的关联 CRUD 一节会再次遇到。",
    },
    {
      type: "heading",
      text: "什么时候用哪种关联",
    },
    {
      type: "list",
      items: [
        "唯一且必然存在一个附属 → Has One（用户简介）。",
        "一个实体拥有多个另一实体、且每个「子」只属于一个「父」→ Has Many + 子侧 Belongs To（用户-文章）。",
        "需要从「子」反查「父」→ Belongs To（文章-作者）。",
        "双方可以互相拥有多个、无法用单列外键表达 → Many2Many（文章-标签）。",
      ],
    },
    {
      type: "callout",
      variant: "example",
      title: "判断思路",
      body: "问自己两个问题：① 外键能只放在一张表的某一列吗？能 → Has One / Has Many / Belongs To；不能（两边都可能多条）→ Many2Many。② 谁拥有一方更多？属于「拥有附属、但每个附属独享」→ Has One；「多个附属、每个附属归属唯一」→ Has Many（父侧）/ Belongs To（子侧）。",
    },
    {
      type: "quiz",
      question: "「一本书有多个作者，一个作者可以写多本书」应该用什么关联建模？",
      options: [
        "Has One",
        "Has Many / Belongs To",
        "Many2Many",
        "不需要外键，直接两个关联字段",
      ],
      answer: 2,
      explanation: "两边都可以对应多条记录，单列外键表达不了，必须用 Many2Many 借助连接表。Has One 是一条对一条，Has Many/Belongs To 是「一」对「多」的单向归属。",
    },
    {
      type: "exercise",
      title: "识别关联类型",
      description: "对照博客模型：① User 与 Profile 是什么关联？② Post 里的 User 字段是什么关联？③ Post 与 Tag 的连接表默认名字是什么？④ 想用非主键列（如 Email）关联作者，需要哪两个标签？分别作答后再和下一节对照。",
      hint: "① 一个用户一份简介是 Has One；② 文章属于作者是 Belongs To；③ 连接表按字母序叫 post_tags；④ 需要 foreignKey 声明外键字段、references 声明引用列（Email）。",
    },
    {
      type: "keypoints",
      items: [
        "四种关联：Has One、Has Many、Belongs To、Many2Many，分别刻画「唯一附属 / 一对多 / 多对一 / 多对多」。",
        "Has Many 与 Belongs To 是一体两面：外键在「多」的一侧（如 posts.user_id）。",
        "GORM 按「类型名 + 主键」约定推断外键；不满足时用 foreignKey / references 显式声明。",
        "many2many 借助连接表（如 post_tags），两列即两张原表的主键。",
        "级联删除不是默认行为，需要显式 constraint 标签。",
      ],
    },
  ],
};
