import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-testing-strategy",
  courseSlug: "gorm",
  title: "测试策略：DryRun、集成测试与方言差异",
  summary: "按风险分层验证查询构造、错误语义、事务、约束、锁和目标数据库行为。",
  minutes: 36,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "GORM 测试最常见的两种失衡，一种是把每条生成 SQL 都做字符串快照，导致换方言或升级版本时测试大面积破碎；另一种是只用 SQLite 内存库，误以为 MySQL/PostgreSQL 的锁、约束和类型行为也被验证了。好的测试按风险选择最便宜且可信的层级。",
    },
    {
      type: "heading",
      text: "四层测试模型",
    },
    {
      type: "table",
      caption: "每层保护什么",
      headers: ["层", "工具形态", "适合验证", "不能证明"],
      rows: [
        ["纯逻辑", "普通 Go 单元测试", "Scope 参数、分页数学、错误翻译", "生成 SQL 与数据库行为"],
        ["构造层", "DryRun/ToSQL", "是否带关键 Clause、表和绑定参数", "SQL 可执行、索引和锁"],
        ["数据访问集成", "真实目标方言临时库", "CRUD、约束、事务、迁移、错误码", "完整 HTTP/消息工作流"],
        ["场景/E2E", "运行中的服务 + 数据库", "用户结果、鉴权、重试、可观测性", "所有内部边界细节"],
      ],
    },
    {
      type: "heading",
      text: "DryRun 用于看结构，不要冻结所有格式",
    },
    {
      type: "code",
      title: "检查关键 Clause 和变量",
      language: "go",
      code: `stmt := db.Session(&gorm.Session{DryRun: true}).
    Model(&Post{}).
    Where("tenant_id = ? AND status = ?", tenantID, "draft").
    Order("id DESC").
    Limit(20).
    Find(&[]Post{}).Statement

if !strings.Contains(stmt.SQL.String(), "tenant_id") {
    t.Fatal("tenant predicate missing")
}
if len(stmt.Vars) != 2 {
    t.Fatalf("unexpected vars: %#v", stmt.Vars)
}`,
    },
    {
      type: "paragraph",
      text: "只断言真正稳定且重要的结构，例如 tenant 条件、锁 Clause、limit 或冲突目标。不要把反引号、空格、别名和全部列顺序当成产品契约；这些可能随方言和 GORM 内部优化合理变化。",
    },
    {
      type: "heading",
      text: "SQLite 适合什么，不适合什么",
    },
    {
      type: "paragraph",
      text: "SQLite 内存库启动快，适合基础映射、简单 CRUD 和仓储组合测试。但它的类型系统、并发模型、外键默认设置、锁、RETURNING、JSON 和 ALTER 能力与 MySQL/PostgreSQL 不同。只要行为依赖目标数据库，就必须在目标方言上验证。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要把 SQLite 通过写成跨方言保证",
      body: "FOR UPDATE、SKIP LOCKED、部分唯一索引、错误码、事务隔离、时间精度和 JSON 操作都可能不同。测试目标是保护真实部署行为，而不是追求最快的绿色勾。",
    },
    {
      type: "heading",
      text: "真实方言集成测试的生命周期",
    },
    {
      type: "code",
      title: "每个测试使用独立事务",
      language: "go",
      code: `func withRollback(t *testing.T, db *gorm.DB, test func(*gorm.DB)) {
    t.Helper()
    tx := db.Begin()
    if tx.Error != nil {
        t.Fatal(tx.Error)
    }
    t.Cleanup(func() {
        _ = tx.Rollback().Error
    })
    test(tx)
}

func TestPublishPost(t *testing.T) {
    withRollback(t, testDB, func(tx *gorm.DB) {
        // 安排真实数据 -> 调用仓储 -> 断言数据库可见结果
    })
}`,
    },
    {
      type: "paragraph",
      text: "回滚隔离很快，但无法测试跨连接可见性、提交后 Hook、副本读取或并发锁。此类场景用独立 schema/database、显式提交和确定性清理。测试进程可以复用一个数据库容器，测试之间用唯一 schema 或事务隔离，避免每个用例都启动新服务。",
    },
    {
      type: "heading",
      text: "高价值测试场景",
    },
    {
      type: "list",
      items: [
        "唯一键和外键冲突能被翻译成稳定领域错误。",
        "条件更新 rows=0 被识别为状态冲突，而不是返回成功。",
        "事务中间一步失败后，已写步骤不可见。",
        "软删除、恢复、物理删除与唯一性策略符合目标方言。",
        "Preload/Joins 返回正确对象图且没有意外重复。",
        "并发扣减不会超卖，锁超时/死锁按设计重试。",
        "迁移从上一版本 schema 升级到当前版本后，历史数据仍可读取。",
      ],
    },
    {
      type: "heading",
      text: "SQL mock 的合理边界",
    },
    {
      type: "paragraph",
      text: "驱动 mock 可以验证连接错误、回滚路径或上层错误传播，但如果测试严格要求 GORM 按固定顺序调用 Begin、Query、Commit 并匹配整条 SQL，它会紧耦合实现。核心仓储行为优先用真实数据库；mock 留给难以制造的驱动故障，而不是代替方言集成测试。",
    },
    {
      type: "heading",
      text: "测试查询数量与 N+1",
    },
    {
      type: "paragraph",
      text: "N+1 是稳定的性能不变量时，可以给测试 Logger 或 Callback 计数 SQL，并断言一个场景不随父记录数线性增加。不要把每个普通页面的精确查询条数永久冻结；只有当增长会构成真实回归时才值得保护。",
    },
    {
      type: "code",
      title: "测试 context 取消",
      language: "go",
      code: `ctx, cancel := context.WithCancel(context.Background())
cancel()

_, err := gorm.G[User](db).Find(ctx)
if !errors.Is(err, context.Canceled) {
    t.Fatalf("expected canceled context, got %v", err)
}`,
    },
    {
      type: "paragraph",
      text: "有些驱动会包装 context 错误，断言时用 errors.Is。真正的数据库超时测试应设置短但不脆弱的 deadline，并避免依赖 sleep 精确时序；锁等待场景可用两个连接和同步屏障确定执行顺序。",
    },
    {
      type: "quiz",
      question: "需要验证 MySQL 的 SELECT FOR UPDATE 能阻止并发更新，哪种测试最可信？",
      options: [
        "使用真实 MySQL、两个独立连接/事务和同步屏障",
        "只检查 DryRun SQL 含 FOR UPDATE",
        "只在 SQLite 内存库运行",
        "mock First 被调用一次",
      ],
      answer: 0,
      explanation: "锁是数据库运行时语义。DryRun 只能验证 SQL 构造，SQLite/mock 不能证明 MySQL 的并发行为。",
    },
    {
      type: "exercise",
      title: "为博客仓储设计最小高价值测试集",
      description: "覆盖 CreateUser、PublishPost、ListPostsWithComments、DeleteUser 和迁移升级。为每个行为选择纯逻辑、DryRun、目标方言集成或 E2E 层，并解释为什么不需要测试所有内部调用。",
      hint: "先写每个测试要阻止的真实回归，再选择最低成本且能证明该行为的层级。",
    },
    {
      type: "keypoints",
      items: [
        "测试按纯逻辑、DryRun、真实方言集成和 E2E 分层。",
        "DryRun 保护关键查询结构，不冻结无关格式，也不能证明 SQL 可执行。",
        "SQLite 只覆盖共有子集；锁、类型、错误码、约束和迁移必须测目标方言。",
        "真实数据库测试可用事务回滚加速，但跨连接/提交语义需要独立隔离。",
        "核心仓储优先行为测试；SQL mock 只用于难制造的驱动故障。",
        "只有重要性能不变量才固定查询数量，避免把实现细节变成合同。",
      ],
    },
  ],
};
