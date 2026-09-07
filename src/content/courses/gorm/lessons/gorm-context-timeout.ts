/* ==================================================================
 * 课时：Context、超时与 Session（gorm-context-timeout）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "gorm-context-timeout",
  "courseSlug": "gorm",
  "title": "Context、超时与 Session",
  "summary": "把请求的取消与超时语义传递到数据库，让慢查询不会挂住整个服务。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "Web 服务里，每个 HTTP 请求都有一个生命周期：客户端可能取消、网关可能超时、服务也可能给自己设一个整体时间预算。如果数据库查询不感知这些信号，它就会一直等锁、一直执行——即使请求早已没人要了。`context.Context` 就是把这些「取消 / 截止时间」的语义从请求一路带到数据库驱动的那根线。"
    },
    {
      "type": "heading",
      "text": "db.WithContext(ctx)：把 context 传给查询"
    },
    {
      "type": "paragraph",
      "text": "GORM 通过 `db.WithContext(ctx)` 把 context 关联到这一次（或这条链）操作上。关联之后，SQL 在执行时会把 context 的取消与截止时间传递给底层数据库驱动：一旦 deadline 到期或 cancel 被调用，正在执行的查询会被中断，`.Error` 会带上 `context.Canceled` / `context.DeadlineExceeded`。"
    },
    {
      "type": "code",
      "title": "带超时查询",
      "language": "go",
      "code": "func FindUser(ctx context.Context, db *gorm.DB, id uint) (*User, error) {\n    // 给查询套一个 2 秒的独立超时\n    ctx, cancel := context.WithTimeout(ctx, 2*time.Second)\n    defer cancel()\n\n    var u User\n    // WithContext 之后照常链式查询\n    err := db.WithContext(ctx).Where(\"id = ?\", id).First(&u).Error\n    if err != nil {\n        if errors.Is(err, context.DeadlineExceeded) {\n            return nil, fmt.Errorf(\"查询超时: %w\", err)\n        }\n        return nil, err\n    }\n    return &u, nil\n}"
    },
    {
      "type": "heading",
      "text": "在 HTTP handler 里传递请求 context"
    },
    {
      "type": "paragraph",
      "text": "规范做法是：在 handler 里直接复用 `r.Context()`，这样请求被取消或关闭时数据库查询会一并收手。配合 `http.TimeoutHandler` 或中间件设置的服务级超时，整条链路就有了一致的截止时间。"
    },
    {
      "type": "code",
      "title": "把请求 context 传进数据库调用",
      "language": "go",
      "code": "func (s *Server) GetUser(w http.ResponseWriter, r *http.Request) {\n    ctx := r.Context() // 请求的生命周期\n\n    var u User\n    // 复用一个连接池，但每次把请求 ctx 传下去\n    if err := s.db.WithContext(ctx).\n        Where(\"id = ?\", r.URL.Query().Get(\"id\")).\n        First(&u).Error; err != nil {\n        w.WriteHeader(http.StatusInternalServerError)\n        return\n    }\n    _ = json.NewEncoder(w).Encode(u)\n}"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "忘传 context 的后果：慢查询能拖垮服务",
      "body": "如果你只用 `db.Where(...).First(...)` 而从不 `WithContext`，查询就不会感知请求取消。一个锁等待或大表全扫会一直占用连接和线程，直到数据库自己超时——在高并发下，这些挂死的查询会耗尽连接池，让其它正常请求也进不来。养成「任何带网络 / 数据库的操作都接受 context」的 Go 习惯，是工程级的必修课。"
    },
    {
      "type": "heading",
      "text": "deadline 与查询超时不是一回事"
    },
    {
      "type": "paragraph",
      "text": "要区分两种「超时」：context 的 deadline 由 Go 侧控制，到点后 Go 主动取消，交给驱动中断查询；而「查询超时」（query timeout）通常是数据库/驱动层面的机制（如 MySQL 的 `max_execution_time` 或驱动连接参数），由数据库自身在执行中途放弃。GORM 层面的做法是前者——你在 Go 里用 `context.WithTimeout` 设一个统一的时间预算，这对应用开发最直接。"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "DB 侧也别裸奔",
      "body": "context 超时是应用侧的兜底，但数据库的连接参数同样可以配置超时与重试策略。下一节会看到如何通过 `gorm.Config` 勾子日志观察每次查询的耗时——用日志和数据来确认你的超时设置确实生效，而不是靠猜。"
    },
    {
      "type": "heading",
      "text": "db.Session：复用一组设置，而不是每次重配"
    },
    {
      "type": "paragraph",
      "text": "`WithContext` 只作用于当前一条链。如果想「这一批查询都用同一个 context / 配置」，可以用 `db.Session(&gorm.Session{...})` 得到一个带预设配置的会话，再在会话上链式调用。Session 是可复用、可组合的配置载体。"
    },
    {
      "type": "code",
      "title": "用 Session 复用 context 与设置",
      "language": "go",
      "code": "ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)\ndefer cancel()\n\n// 造一个共享的会话：默认继承 ctx，并跳过单条写操作的默认事务\ntx := db.Session(&gorm.Session{\n    Context: ctx,\n    SkipDefaultTransaction: true,\n})\n\n// 后续都在 tx 上操作，自动带上 ctx\ntx.Create(&userA)\ntx.Model(&User{}).Where(\"id = ?\", 1).Update(\"balance\", 100)\n// ..."
    },
    {
      "type": "paragraph",
      "text": "`gorm.Session` 里除了 `Context`、`SkipDefaultTransaction`，还支持 `DryRun`、`PrepareStmt`、`NewDB`、`SkipHooks`、`Logger`、`CreateBatchSize` 等配置。用 Session 的好处是把一组操作的公共策略集中定义；每个选项都会改变真实行为，应该按需要开启而不是复制一份万能配置。"
    },
    {
      "type": "heading",
      "text": "连接池与 DisableAutomaticPing（简述）"
    },
    {
      "type": "paragraph",
      "text": "建立连接时，GORM 默认会做一次 ping 来确认可用。通过 `gorm.Config{DisableAutomaticPing: true}` 可以关掉这次自动 ping——通常在延迟初始化、或有外部监控时不希望启动即联库。连接池本身由 `sql.DB` 控制（`SetMaxOpenConns`、`SetMaxIdleConns`、`SetConnMaxLifetime` 等），属于数据库驱动层面的配置，与 context 超时相互配合：context 管单次操作的截止时间，连接池管连接数量的水位。"
    },
    {
      "type": "code",
      "title": "关闭自动 ping",
      "language": "go",
      "code": "sqlDB, _ := db.DB()\nsqlDB.SetMaxOpenConns(50)\nsqlDB.SetMaxIdleConns(10)\nsqlDB.SetConnMaxLifetime(time.Hour)\n\n// 连接参数在 gorm.Config 里关掉自动 ping\ndb2, err := gorm.Open(mysql.Open(dsn), &gorm.Config{\n    DisableAutomaticPing: true,\n})\n"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "context 语义要贯穿",
      "body": "当你有中间层函数调用数据库时，建议把 `ctx` 作为第一个参数一路传递（`func X(ctx context.Context, ...)`），而不是在函数内部 `context.Background()`。后者的结果是所有调用共享一个永不取消的 context，等于把前面设的超时全部架空。"
    },
    {
      "type": "quiz",
      "question": "关于 `db.WithContext(ctx)`，正确的是？",
      "options": [
        "它会永久改变 db 的默认 context",
        "它把 ctx 关联到这一次操作，取消或超时会中断查询并让 .Error 带上 context 错误",
        "它只在建立连接时用一次，之后查询不再关心",
        "它会让所有查询永不超时"
      ],
      "answer": 1,
      "explanation": "WithContext 作用于当前这条链，把取消与截止时间传给驱动；到点后查询被中断，错误可从 .Error 或 errors.Is 检查。"
    },
    {
      "type": "exercise",
      "title": "给订单查询加超时",
      "description": "实现 `FindOrder(ctx, db, orderID)`：用 `context.WithTimeout(ctx, 1*time.Second)` 包装，在 `db.WithContext(ctx)` 上查询订单，并分别处理 `ErrRecordNotFound` 与 `context.DeadlineExceeded` 两种错误。",
      "hint": "查询后先 `errors.Is(err, gorm.ErrRecordNotFound)`，再判断 `errors.Is(err, context.DeadlineExceeded)`，各返回明确的错误信息。"
    },
    {
      "type": "keypoints",
      "items": [
        "用 db.WithContext(ctx) 把取消/超时传给数据库驱动",
        "HTTP handler 里复用 r.Context()，让请求取消能终止查询",
        "context deadline 是应用侧超时；查询超时是数据库侧机制",
        "用 db.Session(&gorm.Session{Context: ctx, ...}) 复用一组配置",
        "忘传 context 会让慢查询占死连接池",
        "连接池与 ping 属驱动层设置，与 context 超时配合使用"
      ]
    }
  ]
};
