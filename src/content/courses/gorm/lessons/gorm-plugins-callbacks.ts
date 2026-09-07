import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-plugins-callbacks",
  courseSlug: "gorm",
  title: "Callback、Plugin 与扩展边界",
  summary: "理解 GORM 内部 Callback 管线、Plugin 生命周期、注册顺序与全局副作用。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "Create、Query、Update、Delete、Row、Raw 等 GORM 操作由 Callback 管线驱动。模型 Hook 是面向某个模型的生命周期扩展，Callback/Plugin 则能改变整个 *gorm.DB 的行为。能力越全局，风险越大：错误插件可能让所有查询漏租户条件、重复写审计或改变事务语义。",
    },
    {
      type: "heading",
      text: "Hook、Callback、Plugin 如何分工",
    },
    {
      type: "table",
      caption: "扩展层级",
      headers: ["机制", "作用范围", "适合什么", "主要风险"],
      rows: [
        ["模型 Hook", "实现方法的模型", "字段规范化、模型内不变量", "隐藏副作用、递归、批量行为"],
        ["Callback", "某个 *gorm.DB 的一类操作", "审计、统一过滤、指标", "全局顺序、条件覆盖、性能"],
        ["Plugin", "初始化时注册一组能力", "可复用扩展和配置", "版本兼容、全局状态、故障面"],
        ["Clause/Scope", "显式查询链", "查询策略与 SQL 表达", "调用方可能忘记使用"],
      ],
    },
    {
      type: "heading",
      text: "Callback 注册在 DB 级别",
    },
    {
      type: "code",
      title: "查询后记录安全指标",
      language: "go",
      code: `func observeQuery(db *gorm.DB) {
    if db.Error != nil {
        metrics.Inc("gorm.query.error")
    }
    if db.Statement != nil && db.Statement.Schema != nil {
        metrics.Inc("gorm.query.model", db.Statement.Schema.Table)
    }
}

err := db.Callback().
    Query().
    After("gorm:query").
    Register("blog:observe_query", observeQuery)`,
    },
    {
      type: "paragraph",
      text: "Callback 注册在根 *gorm.DB 上，不是某次 Session 的局部设置。需要不同 Callback 行为时应初始化不同的 *gorm.DB；不要假设 db.Session 能隔离注册。Callback 名称必须全局清晰，重复名称可能替换或冲突。",
    },
    {
      type: "heading",
      text: "顺序是合同的一部分",
    },
    {
      type: "code",
      title: "显式声明相对顺序",
      language: "go",
      code: `db.Callback().Create().
    Before("gorm:create").
    After("gorm:before_create").
    Register("blog:assign_request_id", assignRequestID)

db.Callback().Delete().
    After("gorm:delete").
    Register("blog:audit_delete", auditDelete)`,
    },
    {
      type: "paragraph",
      text: "Before/After 指的是 Callback 名称和管线位置。升级 GORM 或引入其它插件时，要检查依赖的预定义 Callback 仍存在且顺序合理；插件测试应覆盖与 Hook、默认事务和批量操作的交互。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "Callback 中不要做慢网络调用",
      body: "写操作 Callback 常运行在默认事务内。同步调用第三方审计、搜索或消息服务会延长事务、持锁和连接占用，还会让外部成功而数据库回滚。需要可靠外部副作用时使用 outbox：事务内只写 outbox 行，提交后由 worker 投递。",
    },
    {
      type: "heading",
      text: "Plugin 接口与初始化",
    },
    {
      type: "code",
      title: "一个最小插件",
      language: "go",
      code: `type AuditPlugin struct {
    Sink AuditSink
}

func (AuditPlugin) Name() string { return "blog:audit" }

func (p AuditPlugin) Initialize(db *gorm.DB) error {
    if p.Sink == nil {
        return errors.New("audit sink is required")
    }
    return db.Callback().Create().
        After("gorm:create").
        Register("blog:audit:create", p.afterCreate)
}

if err := db.Use(AuditPlugin{Sink: sink}); err != nil {
    return err
}`,
    },
    {
      type: "paragraph",
      text: "Plugin 由 Name 和 Initialize 组成，Use 会在初始化阶段注册。Initialize 应验证配置并返回错误，避免服务带着半初始化插件运行。插件实例可从 db.Config.Plugins 查询，但业务代码不应依赖内部 map 结构实现控制流。",
    },
    {
      type: "heading",
      text: "多租户插件为何高风险",
    },
    {
      type: "paragraph",
      text: "自动给所有查询追加 tenant_id 很诱人，但插件要处理 Raw SQL、关联 Preload、Unscoped、后台任务、迁移、跨租户运维和写操作。任何一个漏口都是数据泄漏；任何误加条件也可能破坏全局管理功能。更稳妥的方案是限制仓储入口、使用类型化 tenant context，并在数据库支持时叠加行级安全。",
    },
    {
      type: "heading",
      text: "插件评审清单",
    },
    {
      type: "list",
      items: [
        "作用于哪些 Callback，注册相对顺序是什么，升级依赖在哪里。",
        "批量、事务、Savepoint、Hook、泛型 API 和 Raw SQL 是否都覆盖。",
        "错误会阻止操作、触发回滚，还是只记录；调用者是否能感知。",
        "是否记录敏感 Statement Vars、模型字段或 DSN。",
        "是否引入网络、锁、全局可变状态或高基数指标。",
        "如何关闭、回滚、灰度和观察插件自身故障。",
      ],
    },
    {
      type: "heading",
      text: "何时不应写插件",
    },
    {
      type: "paragraph",
      text: "只有少数仓储使用的过滤条件用 Scope 更清楚；单个模型的字段规范化用 Hook；显式业务流程放 Service/事务函数；SQL 能力用 Clause。Plugin 只适合真正横跨大量模型、需要统一安装并且可以定义稳定全局语义的能力。",
    },
    {
      type: "quiz",
      question: "一个创建 Callback 需要向消息系统发送事件，最稳妥的设计是什么？",
      options: [
        "事务内写 outbox 行，提交后由 worker 可靠投递",
        "在 BeforeCreate 里同步 HTTP 调用",
        "忽略消息发送错误继续提交",
        "在 Callback 里无限重试直到成功",
      ],
      answer: 0,
      explanation: "outbox 让数据库状态和待发送事件在同一事务内提交，外部投递从长事务中移出并可重试。",
    },
    {
      type: "exercise",
      title: "评审一个审计插件设计",
      description: "插件要记录谁在何时修改了哪些模型。设计 context 身份传递、变更字段获取、事务内审计表、敏感字段脱敏、批量操作和失败语义，并说明为何不直接把整份模型 JSON 发到远程服务。",
      hint: "先定义审计数据合同，再处理 Callback 顺序、同事务写入、outbox 与日志隐私。",
    },
    {
      type: "keypoints",
      items: [
        "模型 Hook 局部，Callback/Plugin 作用于整个 DB 操作管线。",
        "Callback 注册是 DB 级全局行为，Session 不能隔离不同 Callback 集合。",
        "注册名称与 Before/After 顺序是插件兼容合同，升级时要验证。",
        "事务内 Callback 不做慢外部调用，可靠副作用优先 outbox。",
        "多租户自动过滤属于高风险全局安全能力，需要负面测试和数据库边界。",
        "局部能力优先 Scope/Hook/Service/Clause，真正全局且稳定的能力才做 Plugin。",
      ],
    },
  ],
};
