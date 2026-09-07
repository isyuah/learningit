/* ==================================================================
 * 课时：GORM Gen：从数据库生成代码（gorm-gen-intro）
 * ----------------------------------------------------------------
 * slug 与 course.ts 大纲一致；内容块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-gen-intro",
  courseSlug: "gorm",
  title: "维护存量 Gen：生成模型与 DAO",
  summary: "维护已有 gorm.io/gen 生成链：数据库反向生成、模型映射、DAO 输出与可复现升级边界。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "存量系统常常已经依赖 gorm.io/gen 生成的模型、字段和 DAO。Gen 能把很多列名和查询组合带到编译期，但它不会自动理解业务权限、迁移顺序或 SQL 性能；数据库 schema、生成配置、生成器版本和输出代码仍必须纳入同一变更流程。",
    },
    {
      type: "heading",
      text: "为什么要代码生成",
    },
    {
      type: "list",
      items: [
        "编译期类型安全：u.Where(u.Name.Eq(\"alice\")) 里字段名是生成出来的常量方法，写错会直接编译报错，而不是运行时才懵。",
        "消灭样板：表一多，手写模型、条件、排序会很重复，生成器一次搞定并且风格统一。",
        "减少手工同步：可以从 schema 生成模型，但 schema、生成配置和代码仍需纳入同一变更流程。",
        "可组合、可复用：生成的条件方法可以像拼 SQL 一样链式叠加，还能扩展自定义方法。",
      ],
    },
    {
      type: "definition",
      term: "类型安全查询",
      definition: "查询条件像 u.Name.Eq(\"x\") 这样以「字段」而不是「字符串」表达：字段存在性、比较关系都由编译器校验，避免手写 \"name = ?\" 时拼错列名的运行时错误。",
    },
    {
      type: "heading",
      text: "Gen 会生成什么",
    },
    {
      type: "paragraph",
      text: "典型地，Gen 会产出两类东西：模型包（model/）与查询包（query/）。查询包里的「查询对象」为每张表提供一个可以继续链式调用的类型化 DAO——你既可以直接调用它执行 CRUD，也可以用它的字段方法继续拼条件。",
    },
    {
      type: "code",
      title: "生成代码的使用形态（预告）",
      language: "go",
      code: "// 生成后，你可以这样查询：\nu := query.User\n\n// Where 里是生成出的字段方法，拼错会编译失败\nwanted, err := u.Where(u.Name.Eq(\"alice\"), u.Age.Gt(18)).\n    Order(u.ID.Desc()).Find()\n\n// 关联方法也顺带生成，如 u.Posts() 拿到该用户的帖子\n// 这些都由 Gen 根据 users/posts 表结构自动产出",
    },
    {
      type: "heading",
      text: "两条生成的路径",
    },
    {
      type: "paragraph",
      text: "Gen 提供两种产生代码的方式，按你的习惯二选一即可：gentool 命令行工具，或一个 Go 生成程序。两者最终都产出同样的模型与查询代码。",
    },
    {
      type: "subheading",
      text: "路径一：gentool 命令行工具",
    },
    {
      type: "paragraph",
      text: "gentool 是 Gen 配套的 CLI 二进制，直接读一个数据源（DSN）把代码生成到指定目录。它的参数多以 -- 开头的 flag，例如 --dsn 指定连接串、--outPath 指定输出目录。具体 flag 集合会随版本演进，动手前先看当前版本的帮助与文档核对。",
    },
    {
      type: "code",
      title: "gentool CLI 的典型调用（flag 以文档为准）",
      language: "text",
      code: "# 安装命令行工具\n$ go install gorm.io/gen/tools/gentool@latest\n\n# 依据 DSN 指定的数据库，生成模型与查询代码\n$ gentool --dsn \"user:pass@tcp(127.0.0.1:3306)/blog?charset=utf8mb4&parseTime=True&loc=Local\" \\\n          --outPath \"./query\"",
    },
    {
      type: "subheading",
      text: "路径二：用 Go 程序驱动生成器",
    },
    {
      type: "paragraph",
      text: "更喜欢在 Go 里声明式控制生成时，可以用 gen.NewGenerator 构建生成器、用 g.GenerateModel 指定要生成的表、最后 g.Execute() 落盘。这比 CLI 更易于在 CI 里重复执行、也便于对生成做更细的定制。",
    },
    {
      type: "code",
      title: "一个最小但真实的生成器 main.go",
      language: "go",
      code: "package main\n\nimport (\n    \"gorm.io/driver/mysql\"\n    \"gorm.io/gen\"\n    \"gorm.io/gorm\"\n)\n\nfunc main() {\n    // ① 连上数据库，用它读 schema\n    db, err := gorm.Open(mysql.Open(\n        \"user:pass@tcp(127.0.0.1:3306)/blog?charset=utf8mb4&parseTime=True&loc=Local\"))\n    if err != nil {\n        panic(err)\n    }\n\n    // ② 配置生成器输出目录\n    g := gen.NewGenerator(gen.Config{\n        OutPath: \"./query\", // 查询代码输出目录\n        Mode:    gen.WithDefaultQuery | gen.WithQueryInterface,\n    })\n    g.UseDB(db)\n\n    // ③ 按表生成：也可以调用 g.ApplyBasic(&User{}) 从结构体生成\n    g.GenerateModel(\"users\")\n    g.GenerateModel(\"posts\")\n\n    // ④ 执行生成，把代码写到 OutPath\n    g.Execute()\n    println(\"生成完成：./query 下已产出查询代码\")\n}",
    },
    {
      type: "table",
      caption: "两条生成路径对比",
      headers: ["维度", "gentool CLI", "Go 生成程序"],
      rows: [
        ["形态", "命令行二进制", "main.go 中 gen.NewGenerator + Execute"],
        ["触发方式", "手动执行", "可脚本化、可进 CI 重复执行"],
        ["定制能力", "以 flag 为主", "可在 Go 里精细控制模型与查询"],
        ["适用", "快速一次性生成", "需要可重复、可版本化的生成流程"],
      ],
    },
    {
      type: "heading",
      text: "生成产物长什么样",
    },
    {
      type: "paragraph",
      text: "执行后会得到独立的包：./model 放模型结构体，./query 放查询对象与所有生成的条件方法。它们都应当是「生成即正确、不要手改」的产物，你只需在业务代码里 import 并使用。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "生成是单向的：别手改生成文件",
      body: "下次重新执行生成会把生成目录整体重写。在生成的 model/query 里手写了逻辑，一旦再运行生成就会被覆盖丢失。需要加业务逻辑时，要么把自定义方法「织入」生成流程（下一课讲），要么放在独立的业务文件里，而不是直接改生成产物。",
    },
    {
      type: "quiz",
      question: "关于 GORM Gen 的代码生成，下列说法正确的是？",
      options: [
        "Gen 只能通过 gentool 命令行工具使用，无法在 Go 程序里驱动",
        "Gen 生成的是运行时才会解释的条件字符串，因此拼错字段名也要等运行时才发现",
        "Gen 主要是把条件写成字符串以节省代码量，类型安全并无提升",
        "Gen 依据数据库 schema 生成模型与类型化查询代码，字段以方法形式出现，拼错在编译期就能暴露",
      ],
      answer: 3,
      explanation: "Gen 的核心价值正是类型安全：字段以生成出的方法（如 u.Name.Eq）出现，写错会编译报错；它既支持 gentool CLI，也支持在 Go 程序里用 NewGenerator 驱动。",
    },
    {
      type: "keypoints",
      items: [
        "Gen 是 GORM 官方代码生成器，把模型与查询代码从 schema 批量生成出来",
        "收益：编译期类型安全、消灭样板、模型与库表保持一致",
        "生成 model/ 与 query/ 两包，查询对象可链式加条件、有排序与关联方法",
        "两条路径：gentool CLI（--dsn/--outPath 等 flag，以文档为准），或 Go 生成程序 gen.NewGenerator + GenerateModel + Execute",
        "生成单向进行，不要手改生成产物，自定义逻辑应另行组织",
      ],
    },
  ],
};
