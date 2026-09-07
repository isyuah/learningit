import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-capstone-blog-service",
  courseSlug: "gorm",
  title: "综合项目：构建可上线的博客数据层",
  summary: "把泛型 CRUD、关联、事务、错误、测试和性能边界组合成一个可验收的博客服务数据层。",
  minutes: 75,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "本项目不要求再做一个漂亮的页面，而是交付一个可以被 HTTP handler、后台任务和测试稳定调用的数据访问层。你要实现用户、文章、标签和评论的模型与仓储，完成发布流程、列表查询、软删除恢复和并发更新，并用可重复的测试证明边界。所有示例以 GORM v1.30+ 泛型 API 为主。",
    },
    {
      type: "heading",
      text: "业务合同",
    },
    {
      type: "table",
      caption: "最小领域规则",
      headers: ["对象", "必须满足的规则", "可观察结果"],
      rows: [
        ["文章", "只有草稿可以发布；发布必须写 published_at；软删除后默认不可见", "状态和时间在同一事务内改变"],
        ["标签", "同一文章不能重复关联同一标签", "唯一约束或冲突处理保证幂等"],
        ["评论", "只能关联存在且未删除的文章，正文长度有上限", "非法输入在进入数据库前失败"],
        ["用户", "邮箱唯一；删除用户不能意外删除文章", "外键策略与服务层语义一致"],
      ],
    },
    {
      type: "heading",
      text: "建议的目录与边界",
    },
    {
      type: "code",
      title: "让数据层职责可定位",
      language: "text",
      code: `internal/
  model/       // 纯模型、字段标签、Scanner/Valuer
  repository/  // 泛型查询与业务仓储方法
  migration/   // AutoMigrate 或版本化迁移入口
  testutil/     // 独立测试数据库、清理和工厂
cmd/api/       // HTTP 层只依赖 repository 接口`,
    },
    {
      type: "paragraph",
      text: "handler 不应自行拼接 SQL，也不应把 *gorm.DB 传遍整个业务图。repository 接收 context 并返回领域可理解的结果；service 负责跨仓储事务和业务规则。这样才能在测试中替换仓储，或以后从单体数据库迁移到远端运行时服务。",
    },
    {
      type: "heading",
      text: "模型与约束",
    },
    {
      type: "code",
      title: "从业务不变量落到数据库",
      language: "go",
      code: `type Post struct {
    ID          uint           \`gorm:"primaryKey"\`
    AuthorID    uint           \`gorm:"not null;index"\`
    Title       string         \`gorm:"size:200;not null"\`
    Body        string         \`gorm:"type:text;not null"\`
    Status      string         \`gorm:"size:20;not null;index"\`
    PublishedAt *time.Time
    DeletedAt   gorm.DeletedAt \`gorm:"index"\`
    Tags        []Tag          \`gorm:"many2many:post_tags"\`
}

type PostTag struct {
    PostID uint \`gorm:"primaryKey"\`
    TagID  uint \`gorm:"primaryKey"\`
}`,
    },
    {
      type: "paragraph",
      text: "联合主键让关联表天然去重，但仍要根据数据库检查外键和删除策略。AutoMigrate 适合本地和向后兼容的小步变更；生产破坏性变更、回填和索引并发创建应使用版本化迁移。不要把迁移成功误认为业务规则已经完整实现。",
    },
    {
      type: "heading",
      text: "仓储 API：先写调用者看到的合同",
    },
    {
      type: "code",
      title: "泛型查询与明确的业务方法",
      language: "go",
      code: `type PostRepository interface {
    Create(ctx context.Context, post *model.Post) error
    FindPublished(ctx context.Context, limit, offset int) ([]model.Post, error)
    FindWithTags(ctx context.Context, id uint) (model.Post, error)
    Publish(ctx context.Context, id uint, at time.Time) error
    Restore(ctx context.Context, id uint) error
}

func (r *PostRepo) FindPublished(ctx context.Context, limit, offset int) ([]model.Post, error) {
    if limit < 1 || limit > 100 {
        return nil, ErrInvalidPageSize
    }
    return gorm.G[model.Post](r.db).
        Where("status = ?", "published").
        Order("published_at DESC, id DESC").
        Limit(limit).Offset(offset).
        Find(ctx)
}`,
    },
    {
      type: "paragraph",
      text: "泛型终端方法显式接收 context，查询返回 []T 和 error，减少传统 API 链式状态的误读。分页必须有上限和稳定的二级排序；公开仓储方法应把记录不存在、无效参数和数据库错误映射成调用者可以处理的合同。",
    },
    {
      type: "heading",
      text: "发布是一个事务状态机",
    },
    {
      type: "code",
      title: "只允许草稿转为已发布",
      language: "go",
      code: `func (s *Service) Publish(ctx context.Context, id uint, at time.Time) error {
    return s.db.Transaction(func(tx *gorm.DB) error {
        n, err := gorm.G[model.Post](tx).
            Where("id = ? AND status = ? AND deleted_at IS NULL", id, "draft").
            Set(clause.Assignments(map[string]any{
                "status":       "published",
                "published_at": at,
            })).
            Update(ctx)
        if err != nil {
            return err
        }
        if n != 1 {
            return ErrPublishConflict
        }
        return nil
    })
}`,
    },
    {
      type: "paragraph",
      text: "示例展示了应用层状态检查与数据库条件更新的双重防线。并发请求下，只有一个请求应拿到一行更新；另一个请求要收到可重试或可提示的冲突，而不是静默成功。若需要更强语义，可以使用行锁或数据库原子更新，并在目标数据库上验证执行计划。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "零行更新需要继续分类",
      body: "示例把记录不存在、已删除和已发布统一映射成发布冲突。真实 API 若要区分 404 与 409，可在零行更新后追加一次只读查询，但不能先读后无条件写；真正控制状态转换的仍是带 draft 条件的原子更新。",
    },
    {
      type: "heading",
      text: "关联列表与安全边界",
    },
    {
      type: "list",
      items: [
        "文章详情使用泛型 Preload 预加载标签；列表只选需要的列，避免把大正文和所有关联一次性带出。",
        "评论创建前校验文章状态，数据库外键只解决存在性，不替代已发布、未删除等业务规则。",
        "所有筛选值通过参数绑定；排序字段用白名单映射，不能把用户输入直接拼进 Order。",
        "租户、作者或管理员权限在仓储条件中明确出现，并为越权访问写负面测试。",
        "软删除恢复使用 Unscoped 查询，并明确恢复是否需要管理员权限和审计记录。",
      ],
    },
    {
      type: "heading",
      text: "测试矩阵",
    },
    {
      type: "table",
      caption: "至少覆盖这些稳定合同",
      headers: ["场景", "断言", "测试方式"],
      rows: [
        ["发布竞争", "一个成功、一个冲突，最终只有一条已发布记录", "真实事务 + 两个 goroutine"],
        ["列表分页", "顺序稳定、limit 上限生效、已删除记录不可见", "独立数据库与多页数据"],
        ["关联去重", "重复标签关联不产生重复 join 行", "唯一约束 + 重复请求"],
        ["错误映射", "不存在、无权限、冲突和连接错误可区分", "表驱动测试"],
        ["取消", "context 超时后不继续写入", "短 deadline + 慢查询/锁"],
      ],
    },
    {
      type: "paragraph",
      text: "测试数据库应使用与生产兼容的方言；SQLite 适合快速单元测试，但不能替代目标数据库对锁、索引、外键和 JSON 行为的验证。每个测试负责清理自己的数据，日志可以帮助诊断，但不要记录 DSN 密码或完整敏感正文。",
    },
    {
      type: "heading",
      text: "上线前检查",
    },
    {
      type: "list",
      items: [
        "连接池 MaxOpenConns、MaxIdleConns、ConnMaxLifetime 与数据库和副本容量有预算依据，并能通过 Stats 观测。",
        "读写分离或 DBResolver 的路由规则经过事务、刚写后读取和故障切换测试。",
        "慢查询日志只在受控环境打开，敏感参数脱敏，生产日志等级和采样有明确配置。",
        "迁移脚本可重复执行或明确不可重复，索引和回填不会阻塞整个发布窗口。",
        "生成代码、模型、仓储、服务、HTTP 层和文档在干净环境可构建；CI 拒绝脏生成差异。",
      ],
    },
    {
      type: "heading",
      text: "交付物与评分",
    },
    {
      type: "table",
      caption: "项目验收",
      headers: ["部分", "分值", "验收重点"],
      rows: [
        ["模型与迁移", "20", "字段类型、索引、关联表和迁移策略可解释"],
        ["泛型仓储", "25", "context-first、分页、预加载、错误与参数绑定"],
        ["事务与并发", "25", "发布状态机、冲突处理和回滚证据"],
        ["测试与安全", "20", "负面测试、越权、取消、注入和敏感日志"],
        ["运维与生成", "10", "池配置、观测、版本固定和干净构建"],
      ],
    },
    {
      type: "exercise",
      title: "完成并复盘博客数据层",
      description: "实现上述 API，补齐测试矩阵，并提交一份 ADR：解释为何选择泛型 API、AutoMigrate 或版本化迁移、是否引入 CLI/Gen、如何处理读写分离，以及最可能的线上故障和回滚步骤。",
      hint: "先让一个最小发布流程端到端通过，再逐项加入关联、并发、权限、观测和迁移；每个决策都附一条可运行的证据。",
    },
    {
      type: "quiz",
      question: "发布接口在并发下出现两个请求都返回成功，最应该先检查什么？",
      options: [
        "更新是否带有 status = 'draft' 条件并检查 rows affected，而不是只依赖应用层读取",
        "把所有错误都改成 nil，让调用方重试",
        "提高连接池大小，连接越多就越不会冲突",
        "把发布改成异步 goroutine，不等待数据库结果",
      ],
      answer: 0,
      explanation: "应用层检查可能在并发下同时通过，数据库条件更新与 rows affected 才能把状态转换变成可验证的竞争结果。",
    },
    {
      type: "keypoints",
      items: [
        "综合项目的核心是可验收的数据层合同，而不是把 API 名称抄一遍。",
        "业务状态机需要事务、条件更新、rows affected 和明确错误映射共同保证。",
        "关联、分页、租户权限和软删除都要在查询边界显式表达并测试负面路径。",
        "SQLite 快速测试不能代替生产方言对锁、索引、外键和 JSON 的验证。",
        "上线检查必须覆盖连接池、路由、迁移、日志隐私、生成版本和干净构建。",
      ],
    },
  ],
};
