/* ==================================================================
 * 课时：维护存量 Gen：查询 API 与自定义方法（gorm-gen-usage）
 * ----------------------------------------------------------------
 * slug 与 course.ts 大纲一致；内容块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-gen-usage",
  courseSlug: "gorm",
  title: "维护存量 Gen：查询 API 与自定义方法",
  summary: "在不破坏存量 DAO 的前提下维护查询、动态 SQL、关联与自定义方法，并为渐进迁移到泛型 API 留边界。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "存量 Gen 代码通常包含 model/ 与 query/ 两包。这一课把它们接进业务：先实例化查询对象，再写条件、关联和分页，最后用官方 Dynamic SQL 接口承载可复用查询。生成文件不能手改；新模块可在仓储边界采用 gorm.G[T]，逐步替换而不是混用全局 Query。",
    },
    {
      type: "heading",
      text: "实例化查询对象",
    },
    {
      type: "paragraph",
      text: "要用生成代码，先把数据库连接交给查询结构体。最简单的方式是用生成时通过 WithDefaultQuery 产出的包级 query 变量：启动时调用一次 query.SetDefault(db)，之后直接 query.User / query.Post 使用；也可以直接 query.Use(db) 返回绑定了连接的查询实例。",
    },
    {
      type: "code",
      title: "把数据库接进生成代码",
      language: "go",
      code: "import (\n    \"yourmodule/query\"\n    \"gorm.io/gorm\"\n)\n\nfunc Init(db *gorm.DB) {\n    // 设置默认连接，之后可直接用 query.User / query.Post\n    query.SetDefault(db)\n}\n\n// 之后任意地方：\nu := query.User        // 绑定好的 User 查询对象\np := query.Post       // Post 查询对象",
    },
    {
      type: "heading",
      text: "用生成方法写条件",
    },
    {
      type: "paragraph",
      text: "生成的条件方法让查询像搭积木：u.Name 是字段，后面接 .Eq / .Neq / .Like / .Gt / .Lt 等比较方法，多个条件用逗号并列（逻辑与）。这些方法返回新的查询对象，可以继续链式叠加排序、分页、预加载，直到调用终止方法（如 Find）执行。",
    },
    {
      type: "code",
      title: "链式条件、排序、分页、预加载",
      language: "go",
      code: "type WantedUser struct {\n    query.User\n}\n\nfunc ListAdultAlice(db *gorm.DB) ([]*WantedUser, error) {\n    u := query.User\n\n    wanted := make([]*WantedUser, 0)\n    err := u.Where(u.Name.Eq(\"alice\"), u.Age.Gt(18)).\n        Order(u.ID.Desc()).\n        Limit(10).Offset(0).\n        Preload(u.Posts).       // 生成出的关联方法，预加载帖子\n        Find(&wanted)\n    return wanted, err\n}",
    },
    {
      type: "definition",
      term: "生成的比较方法",
      definition: "如 u.Name.Eq(\"alice\")、u.Age.Gt(18)、u.Title.Like(\"%gorm%\")。它们把「列名 + 操作符 + 值」包装成类型安全的条件对象，可直接交给 Where，也支持 And / Or 组合。",
    },
    {
      type: "heading",
      text: "关联与连接",
    },
    {
      type: "paragraph",
      text: "对定义了关联的模型，Gen 会顺带生成关联访问方法（如 u.Posts 表示 User 的 Posts 关联）。你既可以用它做预加载，也可以基于它继续构造条件；需要有 JOIN 的查询同样可以通过生成的连接方法（如 u.Join）来表达，再叠加 Select 裁剪列。",
    },
    {
      type: "code",
      title: "基于关联构造查询",
      language: "go",
      code: "u := query.User\np := query.Post\n\n// 用生成的关联做预加载：查出用户并带上他们的帖子\ndb := u.WithContext(ctx).Where(u.Age.Gt(18)).Preload(u.Posts).Find(&users)\n\n// 用 JOIN 组合两张生成表，并只取需要的列\ntx := u.Join(p, p.UserID.EqCol(u.ID)).\n    Where(p.Title.Like(\"%教程%\")).\n    Select(u.ID, u.Name, p.Title)\n// ...继续 Find/Scan 得到结果",
    },
    {
      type: "heading",
      text: "Dynamic SQL：把重复查询声明成接口",
    },
    {
      type: "paragraph",
      text: "Gen 的自定义查询不是在生成文件里补方法，而是声明一个带 SQL 注解的接口，再用 ApplyInterface 把接口应用到模型。gen.T 是生成阶段的模型类型占位符；生成后会替换成具体模型，调用方得到普通的类型安全方法。",
    },
    {
      type: "code",
      title: "声明并生成 RecentByUser",
      language: "go",
      code: `type PostQuerier interface {
    // SELECT * FROM @@table
    // WHERE user_id=@userID
    // ORDER BY created_at DESC LIMIT @limit
    RecentByUser(userID uint, limit int) ([]*gen.T, error)
}

func main() {
    g := gen.NewGenerator(gen.Config{
        OutPath: "./query",
        Mode:    gen.WithDefaultQuery,
    })
    g.UseDB(db)
    g.ApplyInterface(func(PostQuerier) {}, model.Post{})
    g.Execute()
}

posts, err := query.Post.WithContext(ctx).
    RecentByUser(userID, 20)`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "接口和 SQL 注解才是源文件",
      body: "修改接口、注解或生成配置后重新生成并审查差异；不要直接编辑 query 包。@userID 与 @limit 是绑定参数，@@table 由生成器按模型替换，但权限条件和 limit 上限仍需业务层保证。",
    },
    {
      type: "heading",
      text: "落地到一个仓储风格的服务",
    },
    {
      type: "paragraph",
      text: "把以上组合起来，一个仓储层就不再满眼是手写字符串：初始化一次性接好连接，业务方法里全是类型安全的生成调用与可复用的自定义方法。下面是一个小而真实的例子，展示了「读」与「写」都收敛到生成代码上。",
    },
    {
      type: "code",
      title: "仓储式服务里使用生成 DAO",
      language: "go",
      code: "type UserRepo struct{ db *gorm.DB }\n\nfunc NewUserRepo(db *gorm.DB) *UserRepo {\n    query.SetDefault(db)\n    return &UserRepo{db: db}\n}\n\nfunc (r *UserRepo) FindActiveAdults(limit int) ([]*User, error) {\n    u := query.User\n    users := make([]*User, 0)\n    err := u.Where(u.Age.Gte(18)).\n        Order(u.ID.Asc()).Limit(limit).Find(&users)\n    return users, err\n}\n\nfunc (r *UserRepo) CountByName(name string) (int64, error) {\n    u := query.User\n    return u.Where(u.Name.Eq(name)).Count()\n}\n\nfunc (r *UserRepo) Create(u *User) error {\n    // 生成的 User 查询对象直接支持 Create 等写方法\n    return query.User.WithContext(r.db).Create(u)\n}",
    },
    {
      type: "quiz",
      question: "在生成代码里，u.Where(u.Name.Eq(\"alice\"), u.Age.Gt(18)) 这条调用大致会被翻译成什么样的 SQL 语义？",
      options: [
        "SELECT * FROM users WHERE name = 'alice' OR age > 18",
        "SELECT * FROM users WHERE age > 18（忽略 name 条件）",
        "SELECT * FROM users WHERE name = 'alice' AND age > 18",
        "UPDATE users SET name='alice' WHERE age > 18",
      ],
      answer: 2,
      explanation: "Where 里并列的多个条件按逻辑与（AND）组合，u.Name.Eq 与 u.Age.Gt 分别生成 name = ? 与 age > ? 两个条件，最终是 AND 关系。多个条件并列默认是 AND，需要 OR 时显式用生成方法的 Or 组合。",
    },
    {
      type: "exercise",
      title: "把一段手写查询重构成生成代码",
      description:
        "给出手写版本：db.Where(\"user_id = ? AND created_at > ?\", uid, since).Order(\"id DESC\").Limit(20).Find(&posts)。请用生成代码把它改写成类型安全版本，并说明如果这段逻辑在多个接口复用，你会如何用自定义方法进一步收敛。",
      hint: "查询对象 u := query.Post 上有 u.UserID、u.CreatedAt 字段；比较可以用 u.UserID.Eq(uid) 与 u.CreatedAt.Gt(since)，排序用 u.ID.Desc()。复用需求则提示你可以把这段抽成自定义方法。",
    },
    {
      type: "keypoints",
      items: [
        "用 query.SetDefault(db) 或 query.Use(db) 一次接好连接，之后直接 query.User / query.Post",
        "条件用生成的字段方法表达：u.Name.Eq、u.Age.Gt、u.Title.Like，并列默认 AND",
        "Order/Limit/Offset/Preload 生成方法可继续链式叠加，关联方法可直接预加载或用于 JOIN",
        "自定义方法通过 gen.WithMethod / ApplyBasic 织入，避免手改生成文件被覆盖",
        "仓储层用生成 DAO 收敛样板：同一段查询在多个接口复用时就该抽成自定义方法",
      ],
    },
  ],
};
