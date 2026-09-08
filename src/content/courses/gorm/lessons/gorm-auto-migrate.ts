import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-auto-migrate",
  courseSlug: "gorm",
  title: "AutoMigrate、Migrator 与生产迁移",
  summary: "理解 AutoMigrate 的实际变更范围、方言差异、Migrator API 与版本化迁移边界。",
  minutes: 28,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "[AutoMigrate](glossary:auto-migrate) 适合快速建立开发 schema，但不能代替生产迁移流程。正确的学习目标不是记住“能不能迁移”四个字，而是能回答：这次模型变化会生成什么 DDL，是否会锁表或改写数据，失败后如何恢复，以及谁在部署前审查它。",
    },
    {
      type: "heading",
      text: "AutoMigrate 会做什么",
    },
    {
      type: "code",
      title: "迁移多个模型",
      language: "go",
      code: "err := db.AutoMigrate(&User{}, &Post{}, &Comment{})\nif err != nil {\n    return fmt.Errorf(\"migrate blog schema: %w\", err)\n}",
    },
    {
      type: "paragraph",
      text: "官方文档列出的行为包括创建缺失的表、外键、约束、列和索引；在支持的方言上，它还可能因为 size/precision 改变，或从不可空变为可空而调整已有列属性。方言实现和数据库版本会影响最终 DDL，必须在目标数据库上用 DryRun、迁移日志或影子库审查。",
    },
    {
      type: "table",
      caption: "把模型变化翻译成迁移决策",
      headers: ["变化", "AutoMigrate 可能做什么", "生产关注点"],
      rows: [
        ["新增字段", "补列并处理默认值/可空性", "大表加 NOT NULL 是否需要分阶段发布"],
        ["size/precision 改变", "部分方言可能调整列属性", "是否重建表、锁多久、旧数据是否可表示"],
        ["字段从 NOT NULL 变可空", "部分方言支持调整", "应用与 schema 的发布顺序"],
        ["删除字段或表", "不会删除废弃列保护数据", "显式迁移、回滚路径和数据保留策略"],
        ["重命名字段", "不会可靠推断这是重命名而非删旧增新", "先加新列、回填、双读/双写，再移除旧列"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "AutoMigrate 不会替你做数据迁移",
      body: "把 Name 从 string 改成结构化 JSON、把旧状态值映射成新枚举、把列重命名，都需要显式数据脚本和发布编排。AutoMigrate 不保存版本历史，也不会自动写出业务回填逻辑。",
    },
    {
      type: "heading",
      text: "Migrator：需要显式控制时的低层 API",
    },
    {
      type: "code",
      title: "检查并执行一个受控变更",
      language: "go",
      code: "m := db.Migrator()\nif !m.HasColumn(&User{}, \"Nickname\") {\n    if err := m.AddColumn(&User{}, \"Nickname\"); err != nil {\n        return err\n    }\n}\n\n// 这些操作应放在版本化迁移文件中，而不是每次服务启动都执行\n// m.RenameColumn(&User{}, \"Name\", \"DisplayName\")\n// m.DropColumn(&User{}, \"LegacyFlag\")",
    },
    {
      type: "paragraph",
      text: "Migrator 提供表、列、索引、约束和视图等统一接口，但“有接口”不等于“所有方言代价相同”。例如 SQLite 某些 ALTER 可能通过新表复制数据来模拟；MySQL 的重命名和索引行为也受版本影响。迁移评审必须看目标数据库执行计划和锁行为。",
    },
    {
      type: "heading",
      text: "开发环境与生产环境分工",
    },
    {
      type: "list",
      items: [
        "本地新项目或临时测试库：AutoMigrate 能快速建立第 0 版 schema。",
        "共享开发/预发布：可以运行 AutoMigrate，但应记录生成的 DDL 并检查与应用版本的兼容性。",
        "生产：使用版本化迁移文件，明确 up/down 或可恢复步骤，在部署管道中显式执行并审计。",
        "数据删除、重命名、回填和在线变更：单独设计兼容窗口，不要隐藏在服务启动副作用里。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "禁用迁移时自动创建外键要有理由",
      body: "GORM 默认可以在迁移时创建外键约束，也支持 DisableForeignKeyConstraintWhenMigrating。关闭不是性能开关，而是把完整性责任转移到显式 SQL/迁移流程；如果关闭，要说明约束在哪里创建、如何验证。",
    },
    {
      type: "heading",
      text: "用兼容发布完成一次重命名",
    },
    {
      type: "paragraph",
      text: "一个安全的字段重命名通常拆成多步：先加新列并让应用同时写旧列和新列；后台回填历史数据；切换读取逻辑；观察一段时间；最后再删除旧列。这样旧版本应用和新版本 schema 可以在滚动发布期间共存。AutoMigrate 只能帮你做其中的部分结构动作，不能替你决定发布顺序。",
    },
    {
      type: "quiz",
      question: "从 Post 模型里删除 Body 字段后重跑 AutoMigrate，最可靠的判断是什么？",
      options: [
        "posts.body 会被自动删除",
        "body 通常会保留，删除需显式迁移；其它受支持的列属性变化仍可能被调整",
        "posts 表一定会被整体重建",
        "AutoMigrate 一定报错并回滚整个数据库",
      ],
      answer: 1,
      explanation: "AutoMigrate 为保护数据不会删除废弃列，但并非完全不改已有列：部分 size、precision 和 nullable 演进可能被处理，实际行为还取决于方言。",
    },
    {
      type: "exercise",
      title: "写一份可滚动发布的 schema 变更计划",
      description: "把 User.Nickname 重命名为 DisplayName，要求旧版本应用在发布期间仍能工作。写出加列、回填、双写、切读和清理旧列的顺序，并标注每一步是否适合 AutoMigrate。",
      hint: "先把结构变更和数据变更分开，再考虑兼容窗口、失败恢复和最终删除的审批。",
    },
    {
      type: "keypoints",
      items: [
        "AutoMigrate 会创建缺失的表、列、索引、约束和外键，并可能调整部分列属性。",
        "它不会删除废弃列，也不会替你完成重命名、数据回填、在线变更和迁移历史。",
        "Migrator 提供显式 DDL 接口，但方言实现可能有重建表、锁和版本差异。",
        "生产 schema 变更应版本化、可审查、可恢复，并在受控管道中执行。",
        "兼容发布通常采用加列、回填、双写/双读、切换、清理的多阶段流程。",
      ],
    },
  ],
};
