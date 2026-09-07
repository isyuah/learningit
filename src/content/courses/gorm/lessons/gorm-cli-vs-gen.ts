import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-cli-vs-gen",
  courseSlug: "gorm",
  title: "代码生成：GORM CLI 与 Gen 的选型",
  summary: "用当前泛型优先的 GORM CLI 处理新代码，同时知道存量 gorm.io/gen DAO 何时仍然合适。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "代码生成不是把数据库变成一堆神奇文件，而是把可重复的查询契约交给工具维护。当前官方 CLI 的方向是生成泛型、接口驱动的类型安全查询；gorm.io/gen 仍然是成熟的旧 DAO 工作流。选型要看项目已有边界、数据库反向生成需求和团队能否稳定维护生成步骤。",
    },
    {
      type: "heading",
      text: "先确定生成边界",
    },
    {
      type: "table",
      caption: "两套工具的定位",
      headers: ["维度", "GORM CLI（当前方向）", "gorm.io/gen（存量常见）"],
      rows: [
        ["查询风格", "生成泛型 Query[T]、字段辅助器和接口实现", "生成带 DAO 方法的查询对象"],
        ["输入", "Go 模型与接口/SQL 注解，按配置筛选", "Go 模型或数据库表反向生成模型与 DAO"],
        ["适合", "新项目、希望保留显式泛型 API 的模块", "已有 Query/DAO 层、需要完整数据库反向生成的系统"],
        ["代价", "工具仍在演进，必须锁定版本并审查输出", "旧 API 面较大，迁移到泛型需要边界设计"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "版本边界",
      body: "本课按 2026-08 官方仓库的 CLI 形态讲解；命令和生成文件属于工具输出，不应当被业务代码当成永久 API。CI 应固定 CLI 与 GORM 版本，升级时在独立变更中重新生成、编译并审查 SQL 行为。",
    },
    {
      type: "heading",
      text: "安装并运行 CLI",
    },
    {
      type: "code",
      title: "把生成步骤放进可复现脚本",
      language: "bash",
      code: `go install gorm.io/cli/gorm@v0.2.3

# 以仓库根目录为工作目录，输出目录纳入源码管理
gorm gen -i ./internal/model -o ./internal/generated

# CI 中检查生成结果是否干净
git diff --exit-code -- internal/generated`,
    },
    {
      type: "paragraph",
      text: "真实项目不要依赖开发者机器上随手安装的 latest。可以在工具链文件、Makefile 或 CI 镜像中固定版本；命令退出码、输入目录、输出目录和生成前后的格式化步骤都应该可审查。生成文件带有 DO NOT EDIT 标记时，业务修改应回到模型、接口或配置源。",
    },
    {
      type: "heading",
      text: "从接口和 SQL 注解生成泛型查询",
    },
    {
      type: "code",
      title: "声明可复用的查询合同",
      language: "go",
      code: `type Query[T any] interface {
    // SELECT * FROM @@table
    // WHERE status = 'published'
    // ORDER BY published_at DESC LIMIT @limit
    FindPublished(limit int) ([]T, error)
}

// 生成结果的使用方式保持泛型和 context-first
posts, err := generated.Query[Post](db).
    FindPublished(ctx, 20)`,
    },
    {
      type: "paragraph",
      text: "接口是输入合同，生成器可以为不同模型实例化同一套 T。SQL 注解要经过代码审查：参数必须绑定、排序要稳定、LIMIT/OFFSET 要有上限，返回列要与模型或投影类型匹配。生成器不会替你证明业务权限正确。",
    },
    {
      type: "heading",
      text: "字段辅助器与 Set",
    },
    {
      type: "code",
      title: "类型安全更新的形态",
      language: "go",
      code: `n, err := gorm.G[User](db).
    Where(generated.User.ID.Eq(userID)).
    Set(generated.User.DisplayName.Set(name)).
    Update(ctx)

// 关联操作也由生成的字段/关联辅助器表达
_, err = gorm.G[User](db).
    Where(generated.User.ID.Eq(userID)).
    Set(generated.User.Roles.Create(roleInput)).
    Update(ctx)`,
    },
    {
      type: "paragraph",
      text: "生成的字段辅助器把列名和 Go 类型带到编译期，能减少手写字符串错列；Set 仍然表达数据库更新，不等同于领域校验。仓储层要继续验证调用者权限、允许更新的字段和 rows affected 语义。",
    },
    {
      type: "heading",
      text: "存量 Gen 不必一次性推倒",
    },
    {
      type: "paragraph",
      text: "如果系统已经依赖 gorm.io/gen 生成的 Query、DAO、动态 SQL 注解或数据库到模型流程，先把生成目录当成稳定适配层。新模块可以直接采用 gorm.G[T]，再在仓储边界逐步替换；不要让同一张表同时存在两套不一致的模型、命名和事务约定。",
    },
    {
      type: "list",
      items: [
        "保留旧 DAO 的生成命令、版本和输入快照，升级时先在 CI 重新生成。",
        "新旧模块共享连接、事务和错误映射，但不要混用一套请求的 context 或隐式全局 Query。",
        "迁移一个仓储方法时，比较生成前后的 SQL、预加载、rows affected 和锁行为。",
        "删除旧生成目录前，确认没有业务包直接导入其内部类型。",
      ],
    },
    {
      type: "heading",
      text: "生成代码的审查清单",
    },
    {
      type: "list",
      items: [
        "生成命令是否可在干净环境运行，依赖版本是否固定。",
        "生成文件是否只读，差异是否可定位到输入模型、接口或配置。",
        "查询是否始终绑定 context、参数和租户/权限范围。",
        "预加载、Join、分页和批量更新是否有行为测试，而不是只看编译成功。",
        "生成器升级是否单独提交，并保留 SQL 日志或解释计划对比。",
      ],
    },
    {
      type: "quiz",
      question: "新建模块希望使用泛型查询，但旧系统已经有稳定的 gorm.io/gen DAO，最合理的迁移策略是什么？",
      options: [
        "新模块按泛型边界落地，旧 DAO 保持可复现生成，再按仓储逐步迁移",
        "立刻删除所有生成代码并让业务改写 SQL",
        "把两套生成器混在同一个 Query 全局变量里",
        "只升级生成器版本，不运行编译和行为验证",
      ],
      answer: 0,
      explanation: "生成代码是边界，不是目的。渐进迁移能保持旧模块可运行，同时让新模块采用当前泛型 API；每次迁移都要比较 SQL 和事务行为。",
    },
    {
      type: "exercise",
      title: "为仓储建立生成策略",
      description: "选择一个现有 CRUD 仓储，写出输入源、生成命令、固定版本、输出目录、CI 检查和迁移验收项。分别说明为什么新查询用 gorm.G[T] 或 CLI，为什么暂时保留或迁移 Gen。",
      hint: "把模型/接口、生成文件、仓储 API、行为测试和 CI 命令画成一条链；链上任一输入改变都应能触发可解释的差异。",
    },
    {
      type: "keypoints",
      items: [
        "CLI 是当前泛型、接口驱动生成方向；gorm.io/gen 仍可作为存量 DAO 适配层。",
        "生成命令、版本、输入和输出必须可复现，生成文件不手改。",
        "字段辅助器减少错列，但不替代权限、参数上限和业务校验。",
        "生成器升级要比较 SQL、预加载、分页、事务和 rows affected，而不只看编译。",
        "新旧工具按仓储边界渐进迁移，避免一张表出现不一致的双模型。",
      ],
    },
  ],
};
