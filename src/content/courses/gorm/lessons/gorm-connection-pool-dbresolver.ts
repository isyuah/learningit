import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gorm-connection-pool-dbresolver",
  courseSlug: "gorm",
  title: "连接池、DBResolver 与读写一致性",
  summary: "用 database/sql 指标调连接池，并理解读写分离、事务固定和副本延迟的正确性代价。",
  minutes: 36,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "*gorm.DB 不是一条连接。常规配置下，它把操作交给 database/sql 连接池；事务会从池里占用一条连接直到结束。连接池太小会排队，太大则可能把数据库压垮。[DBResolver](glossary:dbresolver) 在此基础上增加 source/replica 路由，但它不能消除复制延迟和读己之写问题。",
    },
    {
      type: "heading",
      text: "四个池参数控制不同资源",
    },
    {
      type: "code",
      title: "取得底层连接池",
      language: "go",
      code: `sqlDB, err := db.DB()
if err != nil {
    return err
}

sqlDB.SetMaxOpenConns(30)
sqlDB.SetMaxIdleConns(10)
sqlDB.SetConnMaxLifetime(30 * time.Minute)
sqlDB.SetConnMaxIdleTime(5 * time.Minute)`,
    },
    {
      type: "table",
      caption: "参数与症状",
      headers: ["参数", "控制", "错误设置的表现"],
      rows: [
        ["MaxOpenConns", "打开与使用中的连接总上限", "太小排队；太大压垮数据库/耗尽全局连接"],
        ["MaxIdleConns", "可保留的空闲连接", "太小频繁建连；太大长期占资源"],
        ["ConnMaxLifetime", "单连接最长复用时间", "过短抖动，过长可能遇到服务端回收/负载不均"],
        ["ConnMaxIdleTime", "连接最大空闲时间", "帮助清理低峰期多余连接"],
      ],
    },
    {
      type: "paragraph",
      text: "参数要按数据库允许连接数、应用副本数、后台任务、事务时长和请求并发一起预算。例如数据库允许 300 个应用连接，服务有 10 个实例，就不能每个实例照抄 MaxOpenConns=100。还要为迁移、运维和故障切换保留余量。",
    },
    {
      type: "heading",
      text: "用 Stats 判断瓶颈",
    },
    {
      type: "code",
      title: "连接池关键指标",
      language: "go",
      code: `stats := sqlDB.Stats()
metrics.Gauge("db.open", stats.OpenConnections)
metrics.Gauge("db.in_use", stats.InUse)
metrics.Gauge("db.idle", stats.Idle)
metrics.Counter("db.wait_count", stats.WaitCount)
metrics.Counter("db.wait_duration_ns", stats.WaitDuration.Nanoseconds())
metrics.Counter("db.max_idle_closed", stats.MaxIdleClosed)
metrics.Counter("db.max_lifetime_closed", stats.MaxLifetimeClosed)`,
    },
    {
      type: "paragraph",
      text: "持续增长的 WaitCount/WaitDuration 表示请求在等连接，但根因可能是池太小，也可能是慢 SQL、长事务或数据库饱和。先结合查询延迟、InUse、数据库 CPU/锁等待定位，再决定扩池；盲目加连接往往只会把排队从应用搬到数据库。",
    },
    {
      type: "heading",
      text: "DBResolver 的路由模型",
    },
    {
      type: "code",
      title: "注册 source 与 replica",
      language: "go",
      code: `err := db.Use(
    dbresolver.Register(dbresolver.Config{
        Sources:  []gorm.Dialector{mysql.Open(primaryDSN)},
        Replicas: []gorm.Dialector{
            mysql.Open(replica1DSN),
            mysql.Open(replica2DSN),
        },
        Policy:            dbresolver.RandomPolicy{},
        TraceResolverMode: true,
    }).
    SetMaxOpenConns(30).
    SetMaxIdleConns(10).
    SetConnMaxLifetime(30 * time.Minute),
)`,
    },
    {
      type: "paragraph",
      text: "DBResolver 通常把 Query/Row 路由到 replicas，把 Create/Update/Delete 路由到 sources；Raw SQL 会按是否以 SELECT 开头判断，SELECT ... FOR UPDATE 是写侧语义。复杂 SQL 分类和自定义路由必须实测，不能只凭语句里是否出现单词 SELECT。",
    },
    {
      type: "heading",
      text: "读己之写与副本延迟",
    },
    {
      type: "code",
      title: "写入后强制从 source 读取",
      language: "go",
      code: `if err := gorm.G[Post](db).Create(ctx, &post); err != nil {
    return err
}

// 刚写完需要立即读到，显式选择写节点
fresh, err := gorm.G[Post](db, dbresolver.Write).
    Where("id = ?", post.ID).
    First(ctx)`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "读写分离会改变用户可见一致性",
      body: "副本异步复制时，写成功后立刻从 replica 读取可能返回旧值或未找到。缓存失效、登录状态、支付结果等场景要明确选择 source、会话粘滞、版本令牌或允许最终一致，而不是把问题当作偶发查询失败。",
    },
    {
      type: "heading",
      text: "事务会固定在选定连接",
    },
    {
      type: "code",
      title: "事务前选择 resolver 与模式",
      language: "go",
      code: `tx := db.Clauses(
    dbresolver.Use("orders"),
    dbresolver.Write,
).Begin()
defer func() {
    if r := recover(); r != nil {
        tx.Rollback()
        panic(r)
    }
}()

// 事务开始后，内部不会在 source/replica 之间自动切换
if err := tx.Create(&order).Error; err != nil {
    tx.Rollback()
    return err
}
return tx.Commit().Error`,
    },
    {
      type: "paragraph",
      text: "事务建立在哪个连接上由 Begin 前的 resolver/mode 决定，开始后保持该事务连接。常规写事务应选 source；不要尝试在同一数据库事务里跨多个 resolver 获得分布式原子性。",
    },
    {
      type: "heading",
      text: "多库和分片的边界",
    },
    {
      type: "list",
      items: [
        "按模型/表注册不同 resolver，可以拆分资源，但跨库 JOIN 与事务边界会变化。",
        "随机副本策略只决定连接选择，不做延迟、健康度或负载感知保证。",
        "分片键必须进入每个查询；漏分片键可能扫描错误节点或返回不完整结果。",
        "故障切换、重试和连接池重建需要结合驱动、代理与数据库拓扑设计。",
      ],
    },
    {
      type: "quiz",
      question: "创建 Post 成功后立即查询却偶尔 ErrRecordNotFound，启用了 DBResolver 副本，最可能的原因与修复是什么？",
      options: [
        "副本延迟；对读己之写路径显式使用 dbresolver.Write 或其它一致性策略",
        "GORM 泛型 API 不支持 First",
        "连接池必须设为 1",
        "把查询放进 goroutine 就会一致",
      ],
      answer: 0,
      explanation: "默认读可能路由到尚未重放写入的 replica。需要按业务一致性要求选择 source 或设计会话一致性。",
    },
    {
      type: "exercise",
      title: "为 10 实例服务预算连接池",
      description: "数据库允许应用侧最多 240 个连接，另需给迁移和运维留 40 个。服务有 10 个实例和 2 个后台 worker。给主库/副本分别设初始池参数和告警指标，并说明如何根据 WaitDuration、慢查询和数据库负载迭代。",
      hint: "先分配全局预算，再除以所有会建池的进程；不要忘记每个 DBResolver source/replica 都可能有独立池。",
    },
    {
      type: "keypoints",
      items: [
        "*gorm.DB 通常复用 database/sql 连接池，事务会占用连接直到结束。",
        "池大小按数据库总预算和所有应用实例分配，不能复制固定模板。",
        "Stats 的 WaitCount/WaitDuration 要与慢 SQL、锁和数据库负载联合诊断。",
        "DBResolver 自动路由读写，但副本延迟会破坏读己之写。",
        "泛型 API 可把 dbresolver.Write 作为 gorm.G 的选项强制读 source。",
        "事务在 Begin 前选择连接，开始后固定；DBResolver 不提供跨库分布式事务。",
      ],
    },
  ],
};
