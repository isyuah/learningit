/* ==================================================================
 * 课程：Go 数据库开发：GORM 系统学习（gorm）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "gorm",
  title: "Go 数据库开发：GORM 系统学习",
  tagline: "泛型优先，从 SQL 语义到生产工程",
  description:
    "面向已经掌握 Go 与基础 SQL 的学习者，系统学习现代 GORM。课程以 GORM v1.30+ 为版本边界，并按 v1.31.2 的公开 API 与官方文档核对示例：新代码以泛型 API 为主，同时保留传统 API，帮助你维护存量项目并理解插件生态。\n\n全程围绕一套博客后台模型展开。从连接、Statement 与 Clause 心智模型出发，依次覆盖泛型 CRUD、模型与迁移、复杂查询、关联、事务、钩子、自定义类型、批处理、安全、测试、连接池、读写分离、插件、GORM CLI 与 Gen。最后通过一个完整的数据访问层实战，把正确性、性能和可运维性串成一条工程主线。",
  level: "intermediate",
  hours: 17,
  coverIndex: "05",
  coverColor: "danger",
  updatedAt: "2026-08",
  outcomes: [
    "解释 *gorm.DB、Statement、Clause、连接池与一次数据库操作之间的关系",
    "熟练使用 GORM v1.30+ 泛型 API，并能与传统 API 安全共存和渐进迁移",
    "正确处理 CRUD、零值、错误、批量操作、Upsert、原生 SQL 与复杂查询",
    "设计模型、索引、约束、自定义数据类型、关联关系与可控的 schema 迁移",
    "在事务、钩子、软删除、并发更新中守住一致性与副作用边界",
    "建立 SQL 注入防线、测试分层、日志诊断、连接池与读写分离的生产实践",
    "理解插件、GORM CLI 与 Gen 的定位，并完成可测试的数据访问层实战",
  ],
  chapters: [
    {
      id: "orientation",
      title: "版本、架构与连接",
      intro: "先认清 GORM 的职责、两套 API 的版本边界，以及数据库句柄和连接池如何协作。",
      lessons: [
        { slug: "gorm-mental-model", title: "GORM 的核心心智模型", minutes: 24, kind: "reading" },
        { slug: "gorm-setup-connection", title: "安装、连接与启动验证", minutes: 22, kind: "reading" },
      ],
    },
    {
      id: "generics-first",
      title: "泛型优先：现代 GORM API",
      intro: "从 gorm.G[T] 开始学习新项目的首选写法，再理解它与传统链式 API 的差异。",
      lessons: [
        { slug: "gorm-generics-overview", title: "泛型 API：版本、设计与迁移路线", minutes: 30, kind: "reading" },
        { slug: "gorm-generics-crud", title: "泛型 CRUD：返回值、零值与错误", minutes: 34, kind: "reading" },
        { slug: "gorm-generics-joins-preload", title: "泛型查询：Joins、Preload 与 Raw SQL", minutes: 36, kind: "reading" },
      ],
    },
    {
      id: "modeling",
      title: "模型、Schema 与类型系统",
      intro: "把 Go 类型准确映射到数据库，并明确约定、标签、约束和迁移各自负责什么。",
      lessons: [
        { slug: "gorm-model-definition", title: "模型定义：结构体到数据库表", minutes: 22, kind: "reading" },
        { slug: "gorm-schema-indexes-constraints", title: "索引、约束与字段权限", minutes: 30, kind: "reading" },
        { slug: "gorm-custom-data-types", title: "自定义类型、Scanner/Valuer 与 Serializer", minutes: 34, kind: "reading" },
        { slug: "gorm-auto-migrate", title: "AutoMigrate、Migrator 与生产迁移", minutes: 28, kind: "reading" },
      ],
    },
    {
      id: "crud-traditional",
      title: "传统 API 的 CRUD 与兼容维护",
      intro: "掌握存量项目最常见的传统 API，并持续与泛型 API 对照，避免混淆返回语义。",
      lessons: [
        { slug: "gorm-create", title: "创建记录：Create、批量插入与默认值", minutes: 28, kind: "reading" },
        { slug: "gorm-read-find", title: "读取记录：Find、First 与主键查询", minutes: 18, kind: "reading" },
        { slug: "gorm-update", title: "更新记录：Save、Updates 与零值处理", minutes: 20, kind: "reading" },
        { slug: "gorm-delete-soft", title: "删除与软删除", minutes: 17, kind: "reading" },
        { slug: "gorm-crud-exercise", title: "CRUD 综合练习", minutes: 20, kind: "exercise" },
      ],
    },
    {
      id: "querying",
      title: "查询构造与 SQL 边界",
      intro: "从条件组合走到 Clause、Upsert 与流式批处理，始终能够解释最终 SQL。",
      lessons: [
        { slug: "gorm-query-conditions", title: "组合条件：Where、Not 与 Or", minutes: 20, kind: "reading" },
        { slug: "gorm-query-advanced", title: "Select、排序、分页与聚合", minutes: 22, kind: "reading" },
        { slug: "gorm-query-raw-scan", title: "原生 SQL、Scan 与子查询", minutes: 18, kind: "reading" },
        { slug: "gorm-query-scopes", title: "Scopes：复用查询片段", minutes: 14, kind: "reading" },
        { slug: "gorm-upsert-clauses", title: "Clause、Upsert 与 SQL 表达式", minutes: 32, kind: "reading" },
        { slug: "gorm-batch-processing", title: "批处理、FindInBatches 与资源释放", minutes: 32, kind: "reading" },
      ],
    },
    {
      id: "associations",
      title: "关联关系",
      intro: "从外键建模到加载与写入语义，分清对象图便利性和数据库约束的真实边界。",
      lessons: [
        { slug: "gorm-associations-intro", title: "四种关联：建模与标签", minutes: 24, kind: "reading" },
        { slug: "gorm-associations-preload", title: "预加载：Preload 与 Joins", minutes: 20, kind: "reading" },
        { slug: "gorm-associations-crud", title: "关联操作：Append、Replace 与 Clear", minutes: 18, kind: "reading" },
      ],
    },
    {
      id: "transactions-hooks",
      title: "事务与生命周期",
      intro: "把多步写入、回滚、保存点和模型副作用放进清晰的原子边界。",
      lessons: [
        { slug: "gorm-transactions", title: "事务：全做或全不做", minutes: 22, kind: "reading" },
        { slug: "gorm-hooks-lifecycle", title: "生命周期钩子：Before 与 After", minutes: 20, kind: "reading" },
      ],
    },
    {
      id: "correctness-safety-testing",
      title: "正确性、安全与测试",
      intro: "让每次数据库操作可取消、可诊断、不会串条件，也能被可靠验证。",
      lessons: [
        { slug: "gorm-context-timeout", title: "Context、超时与 Session", minutes: 18, kind: "reading" },
        { slug: "gorm-error-logging", title: "错误处理与日志", minutes: 16, kind: "reading" },
        { slug: "gorm-session-chain-safety", title: "Session、链污染与预编译语句", minutes: 32, kind: "reading" },
        { slug: "gorm-security-sql-injection", title: "SQL 注入、动态标识符与写保护", minutes: 30, kind: "reading" },
        { slug: "gorm-testing-strategy", title: "测试策略：DryRun、集成测试与方言差异", minutes: 36, kind: "reading" },
      ],
    },
    {
      id: "performance-scale",
      title: "性能、并发与扩展",
      intro: "从查询形状、锁竞争和连接池指标出发，而不是靠无依据的参数模板调优。",
      lessons: [
        { slug: "gorm-performance", title: "性能优化与避免 N+1", minutes: 24, kind: "reading" },
        { slug: "gorm-concurrency-locking", title: "并发安全与行锁", minutes: 20, kind: "reading" },
        { slug: "gorm-connection-pool-dbresolver", title: "连接池、DBResolver 与读写一致性", minutes: 36, kind: "reading" },
      ],
    },
    {
      id: "extension-codegen",
      title: "扩展机制与代码生成",
      intro: "理解全局 Callback/Plugin 边界，并在 GORM CLI 与 Gen 之间做有依据的选择。",
      lessons: [
        { slug: "gorm-plugins-callbacks", title: "Callback、Plugin 与扩展边界", minutes: 32, kind: "reading" },
        { slug: "gorm-cli-vs-gen", title: "代码生成：GORM CLI 与 Gen 的选型", minutes: 34, kind: "reading" },
        { slug: "gorm-gen-intro", title: "维护存量 Gen：生成模型与 DAO", minutes: 24, kind: "reading" },
        { slug: "gorm-gen-usage", title: "维护存量 Gen：查询 API 与自定义方法", minutes: 24, kind: "reading" },
      ],
    },
    {
      id: "capstone",
      title: "综合实战",
      intro: "交付一个有清晰边界、正确错误语义、可测试且可观测的博客数据访问层。",
      lessons: [
        { slug: "gorm-capstone-blog-service", title: "综合项目：构建可上线的博客数据层", minutes: 75, kind: "exercise" },
      ],
    },
  ],
};
