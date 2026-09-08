/* ==================================================================
 * 课程术语表（gorm）：整门课共享的概念速查
 * ----------------------------------------------------------------
 * 类型见 ../../../types.ts 的 GlossaryEntry。正文中用
 * [显示文字](glossary:key) 引用词条：悬浮看 summary、点击直达
 * /courses/gorm/glossary#key。写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { GlossaryEntry } from "../../types";

export const glossary: GlossaryEntry[] = [
  {
    key: "orm",
    term: "ORM",
    summary:
      "对象关系映射（Object-Relational Mapping）：在结构体与表、方法调用与 SQL 之间做双向翻译的一层库抽象。",
    detail: [
      {
        type: "paragraph",
        text: "ORM 不消灭 SQL，而是替你书写与翻译 SQL。学习时要看清它覆盖的边界：它负责映射、构造与执行常规语句；复杂的查询、批量写入或方言特性仍然需要你理解底层 SQL 才能用好。",
      },
      {
        type: "list",
        items: [
          "定义方向：结构体约定 → 表 / 列 / 主键 / 索引",
          "写入方向：结构体实例 → INSERT / UPDATE",
          "读取方向：查询调用 → SELECT，结果行 → 结构体切片",
        ],
      },
    ],
  },
  {
    key: "auto-migrate",
    term: "AutoMigrate",
    summary:
      "按传入的 model 结构体自动创建缺失的表、列与索引，并可能调整列属性的迁移入口；适合开发期，不能代替生产迁移流程。",
    detail: [
      {
        type: "paragraph",
        text: "AutoMigrate 会创建缺失的表、外键、约束、列和索引；在支持的方言上还可能调整已有列属性。它不保存版本历史、不会删除废弃列，也不会自动写出数据回填脚本。",
      },
      {
        type: "callout",
        variant: "warning",
        title: "生产环境边界",
        body: "大表加 NOT NULL、列重命名、旧数据改写都需要显式迁移脚本与发布编排；用 DryRun、迁移日志或影子库审查最终 DDL。",
      },
      {
        type: "code",
        title: "基本用法",
        language: "go",
        code: "err := db.AutoMigrate(&User{}, &Post{})\nif err != nil {\n    return fmt.Errorf(\"migrate schema: %w\", err)\n}",
      },
    ],
  },
  {
    key: "soft-delete",
    term: "软删除",
    summary:
      "模型含 gorm.DeletedAt 字段时，db.Delete 不删行而是写删除时间并默认从查询中隐藏——可恢复、可审计，但需要为唯一约束与查询过滤付出额外代价。",
  },
  {
    key: "dbresolver",
    term: "DBResolver",
    summary:
      "GORM 的读写分离插件：按 source/replica 路由查询，支持事务固定与按表/按条件分流；不消除复制延迟与读己之写问题。",
  },
];
