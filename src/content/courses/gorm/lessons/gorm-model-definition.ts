/* ==================================================================
 * 课时：模型定义：结构体到数据库表（gorm-model-definition）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-model-definition",
  courseSlug: "gorm",
  title: "模型定义：结构体到数据库表",
  summary: "GORM 的命名约定、结构体标签，以及如何把一个 Go 结构体映射成一张正确的表。",
  minutes: 22,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "心智模型的第一句话是「每一个结构体对应一张表」。这一节我们要回答：这个对应到底怎么发生？GORM 靠一套「约定 + 标签」的机制来决定表名、列名、主键和数据类型。理解了约定，你写出来的模型才是「预期内」的；理解了标签，你才能在约定不够时精确控制每一列。",
    },
    {
      type: "heading",
      text: "核心约定：让「对的默认值」自动发生",
    },
    {
      type: "paragraph",
      text: "GORM 的一个设计哲学是「约定优于配置」（convention over configuration）。只要你不加干预，它会按一套固定规则把结构体映射成表。先看整个课程贯穿使用的例子。",
    },
    {
      type: "code",
      title: "贯穿课程的核心模型",
      language: "go",
      code: `type User struct {
    ID        uint
    Name      string
    Email     string \`gorm:"uniqueIndex"\`
    Age       uint8
    CreatedAt time.Time
    UpdatedAt time.Time
    DeletedAt gorm.DeletedAt
}

type Post struct {
    ID        uint
    Title     string
    Body      string
    UserID    uint
    CreatedAt time.Time
}

type Comment struct {
    ID      uint
    Content string
    UserID  uint
    PostID  uint
}`,
    },
    {
      type: "paragraph",
      text: "猜一猜：`User` 会映射成什么表名？哪些列？哪一列是主键？我们逐条看 GORM 的默认约定。",
    },
    {
      type: "table",
      caption: "GORM 的核心约定",
      headers: ["约定", "默认规则", "例子"],
      rows: [
        ["表名", "结构体名的蛇形复数", "User → users, Post → posts"],
        ["主键", "名为 ID（或 Id）的字段", "User.ID 是主键"],
        ["列名", "字段名的蛇形（snake_case）", "CreatedAt → created_at"],
        ["自动维护时间", "CreatedAt / UpdatedAt 自动填值", "插入与更新时自动写入"],
        ["软删除", "DeletedAt 字段", "提供软删除能力（删除≠物理删除）"],
        ["外键约定", "字段名 + ID", "Post.UserID 指回 User 主键"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "三个惯例字段的隐藏能力",
      body: "`CreatedAt` 与 `UpdatedAt` 不只是普通字段——GORM 会在新建 / 更新记录时自动为它们写入时间，你无需手动赋值。`DeletedAt gorm.DeletedAt` 更特殊：它一旦出现，删除操作默认就变成软删除（加个标记而非真删），这一点我们留到删除章节细讲，现在先认识它。",
    },
    {
      type: "heading",
      text: "数据类型的映射",
    },
    {
      type: "paragraph",
      text: "Go 的静态类型要落到数据库的 SQL 类型上，GORM 对常用类型做了内置映射。理解这张表，你才能预判生成的列长什么样。",
    },
    {
      type: "table",
      caption: "Go 类型 → 常见数据库类型（以 PostgreSQL 等为例，SQLite 会宽松处理）",
      headers: ["Go 类型", "映射到", "说明"],
      rows: [
        ["uint / int", "整数类型", "满足条件时通常自动成为自增主键"],
        ["string", "文本 / varchar", "可用 size 标签限定长度"],
        ["bool", "布尔", "true/false"],
        ["float64", "浮点", "带小数位"],
        ["time.Time", "时间 / timestamp", "配合 CreatedAt 等使用"],
        ["[]byte", "二进制（blob）", "适合存原始字节"],
      ],
    },
    {
      type: "paragraph",
      text: "三组常用类型的选择值得留意：普通字符串用 `string`；短文本存储如 Body 可用 `string` 加 `type` 标签覆盖为 text；二进制内容（图片、文件）用 `[]byte`。`time.Time` 用于任何需要时间语义的字段，配合 parseTime 等连接参数使用。SQLite 对类型比较宽容，MySQL/PostgreSQL 则更严格。",
    },
    {
      type: "heading",
      text: "用结构体标签精确控制",
    },
    {
      type: "paragraph",
      text: "约定能覆盖大部分情况，但现实中的表总有特殊要求：某一列不能为空、要有默认值、要建索引、列名要覆盖默认命名。这些都通过结构体标签（struct tag）来声明。标签写在字段名后面的反引号里，格式是 `gorm:\"键:值;键:值\"`。",
    },
    {
      type: "table",
      caption: "常用 gorm 标签一览",
      headers: ["标签", "含义", "示例"],
      rows: [
        ["column", "自定义列名，覆盖默认蛇形命名", "column:user_name"],
        ["type", "覆盖列的 SQL 类型", "type:text, type:datetime"],
        ["size", "列的长度/宽度", "size:256"],
        ["not null", "非空约束", "not null"],
        ["unique / uniqueIndex", "唯一约束 / 唯一索引", "uniqueIndex"],
        ["default", "默认值", "default:0"],
        ["primaryKey", "标记为主键", "primaryKey"],
        ["autoIncrement", "自增", "autoIncrement"],
        ["index", "创建普通索引，可命名", "index:idx_name"],
        ["comment", "列注释", "comment:用户昵称"],
      ],
    },
    {
      type: "code",
      title: "一个带大量标签的完整模型",
      language: "go",
      code: `type User struct {
    // 用标签强制覆盖默认约定
    ID        uint      \`gorm:"primaryKey;autoIncrement"\`
    Name      string    \`gorm:"size:64;not null;comment:用户昵称"\`
    Nickname  string    \`gorm:"column:nick_name;size:32"\`
    Email     string    \`gorm:"uniqueIndex;not null"\`
    Age       uint8     \`gorm:"default:18;comment:年龄"\`
    Bio       string    \`gorm:"type:text"` + "`" + `      // 长文本
    CreatedAt time.Time
    UpdatedAt time.Time
}

// 覆盖表名（默认会是 users）
func (User) TableName() string {
    return "blog_users"
}`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "列名用 column 明确覆盖更稳妥",
      body: "默认命名规则（字段 HelloWorld → 列 hello_world）大多数时候够用，但一旦历史表名或列名与默认规则不一致（比如表里存的是 nick_name 而字段叫 Nickname），就一定要用 column 标签或在命名策略里显式声明，否则 GORM 会按默认规则生成列名，导致与已有列对不上。命名策略（NamingStrategy）可以统一定制这些规则，适合整个项目的全局命名需求。",
    },
    {
      type: "heading",
      text: "gorm.Model 用不用？",
    },
    {
      type: "paragraph",
      text: "GORM 内置了一个 `gorm.Model` 结构体，把最常用的几个「骨架字段」打包在一起。",
    },
    {
      type: "code",
      title: "gorm.Model 的结构",
      language: "go",
      code: `type Model struct {
    ID        uint           \`gorm:"primaryKey"\`
    CreatedAt time.Time
    UpdatedAt time.Time
    DeletedAt gorm.DeletedAt \`gorm:"index"\`
}

// 用法：直接内嵌
type Post struct {
    gorm.Model
    Title string
    Body  string
}`,
    },
    {
      type: "paragraph",
      text: "内嵌 `gorm.Model` 就自动获得了主键、时间戳、软删除三个能力，省去重复声明。不过它并非必须：如果你不需要软删除，或想自定义主键类型（比如用 int64、UUID），就自己声明字段而不内嵌 `gorm.Model`。这也是我们的示例模型选择自己写字段的原因——更透明，也更能看清每一层约定。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "内嵌还是手写？",
      body: "小项目追求速度可直接内嵌 `gorm.Model`；一旦你需要定制主键、不需要软删除、或想让字段完全显式，就手写字段。两种都是合法用法，选择取决于你是否需要 `gorm.Model` 附带的默认行为。",
    },
    {
      type: "heading",
      text: "主键的行为",
    },
    {
      type: "paragraph",
      text: "主键是模型里的特殊角色。默认情况下，名为 `ID` 的字段被当作主键；GORM 会在插入时把它当自增主键处理，插入后主键值会回填到你传入的结构体实例里。",
    },
    {
      type: "code",
      title: "插入后主键被回填",
      language: "go",
      code: `user := User{Name: "Alice", Email: "alice@example.com"}
db.Create(&user)

// 插入成功后，user.ID 被数据库的自增值回填
fmt.Println(user.ID)   // 例如 1`,
    },
    {
      type: "paragraph",
      text: "你可以用 `primaryKey` 标签覆盖主键约定（比如用自定义字段名），也可以用 `autoIncrement:false` 关闭自增。这些细节在写 `Create` 那节会再次出现，这里先建立「主键会回填」这一认知。",
    },
    {
      type: "quiz",
      question: "按 GORM 的默认约定，结构体 `BlogPost` 会映射成哪张表？",
      options: ["blog_posts", "blogpost", "BlogPosts", "blog_post"],
      answer: 0,
      explanation: "GORM 默认把结构体名转成蛇形（snake_case）并复数化：BlogPost → blog_post → blog_posts。其余选项要么没有复数化，要么保留了大小写，都不符合默认约定。",
    },
    {
      type: "quiz",
      question: "以下哪个标签的写法能限制一个字段最大长度为 64？",
      options: [
        'gorm:"size:64"',
        'gorm:"length:64"',
        'gorm:"type:64"',
        'gorm:"maxSize=64"',
      ],
      answer: 0,
      explanation: "限制长度用的是 size 标签，写法是 `gorm:\"size:64\"`。length、type、maxSize 都不是 GORM 约定用于限长的那种写法（type 用于覆盖 SQL 类型，如 type:text）。",
    },
    {
      type: "keypoints",
      items: [
        "约定：结构体名→蛇形复数表名，ID→主键，字段→蛇形列名。",
        "CreatedAt / UpdatedAt 自动维护；DeletedAt 启用软删除。",
        "不确定时可手写字段，或用 gorm.Model 内嵌快速获得骨架。",
        "标签（column/type/size/not null/unique/default 等）提供精确控制。",
        "表名与列名可用 TableName() / NamingStrategy / column 显式覆盖。",
      ],
    },
  ],
};
