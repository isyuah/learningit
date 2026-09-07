/* ==================================================================
 * 课时：装配根：依赖注入与生命周期（gline-server-bootstrap）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-bootstrap",
  courseSlug: "gline-server",
  title: "装配根：依赖注入与生命周期",
  summary: "一个进程怎么从配置长成「数据库 + 服务 + worker」的完整应用?退出时怎么优雅排空?",
  minutes: 16,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前面所有课都在讲「某个 service 内部怎么工作」。这一课退到最外层:进程启动时,这些 service 是怎么被组装起来的;运行时谁和谁并行;退出时按什么顺序排空。装配根在 internal/server/bootstrap/application.go。",
    },
    {
      type: "heading",
      text: "New:从配置到依赖图",
    },
    {
      type: "paragraph",
      text: "bootstrap.New(ctx, cfg, version, logger) 是唯一允许「知道所有组件」的地方——依赖注入的组装根。顺序严格按依赖方向(application.go:60-150):",
    },
    {
      type: "code",
      title: "装配顺序",
      language: "text",
      code: "1. sql.Open(pgx stdlib) -> db\n2. PingContext(DatabaseTimeout)      # 先确认数据库活着\n3. postgres.Migrate(migrations.FS)   # 启动时嵌入执行迁移(带校验和)\n4. postgres.New(db) -> store        # 所有 repository 的工厂\n5. observability:prometheus registry + http/server metrics\n6. serverauth.NewAuthenticator(store.APIKeys(), pepper)\n7. control.NewService(controlTransactions(store), ...)\n8. admission.New(限额配置)          # 令牌桶\n9. ingest.NewService(ingestTransactions(store), WithAdmission(...))\n10. query.NewService(..., newProjectLimiter(QueryConcurrency),\n                      cursorSecret)  # cursorSecret = HMAC(pepper, \"gline-query-cursor-v1\")\n11. operations.New(operationTransactions(store), ingestService, ingestLimits)\n12. alerting.New(...)\n13. httpapi.New(Config{...}, Dependencies{...})   # 注入所有 service\n14. maintenance.New(...) + alerting.NewWorker(...)\n15. 组装 Application{server, store, maintenance, alerts}",
    },
    {
      type: "heading",
      text: "每个 service 一个事务 runner",
    },
    {
      type: "paragraph",
      text: "注意第 7-12 步:每个 service 构造时都传入自己的 xxxTransactions(store)——它把 store 的仓储包成「事务内 Repositories」。这是摄取章讲的 WithinTx 模式的全景:control/ingest/query/operations/alerting 各有一个事务 runner,service 层不直接碰 db,只依赖注入的窄接口。这样每个 service 都能脱离真实 PG 做单测(传假 runner)。",
    },
    {
      type: "callout",
      variant: "note",
      title: "迁移在启动时执行:单体的取舍",
      body: "postgres.Migrate(migrations.FS) 在 New 里跑——嵌入的迁移文件(migrations 包,embed FS)启动即执行。这是模块化单体与「独立迁移服务」的取舍:单体只有一个部署单元,启动迁移保证 schema 与代码同版本。代价是多个 Server 实例同时启动会竞争迁移(需要迁移锁),当前单实例形态可接受。",
    },
    {
      type: "heading",
      text: "Run:三个并发单元与错误竞争",
    },
    {
      type: "paragraph",
      text: "Application.Run(application.go:180-244)启动三个 goroutine,谁先出错谁决定退出:",
    },
    {
      type: "code",
      title: "Run 的并发结构",
      language: "text",
      code: "Run(ctx):\n  go a.server.ListenAndServe()        # HTTP server\n  go a.maintenance.Run(runCtx)          # 维护 worker(每分钟一轮)\n  go a.alerts.Run(runCtx)               # 告警 worker\n\n  select {\n  case <-ctx.Done():                    # 外部取消(信号)\n  case err := <-serverErrors:           # HTTP server 挂\n  case err := <-workerErrors:           # maintenance 挂\n  case err := <-alertErrors:            # alerting 挂\n  }\n\n  draining.Store(true)                  # 标记排空:新请求被拒\n  cancel()                              # 停 worker\n  server.Shutdown(shutdownCtx)          # 优雅关 HTTP:等存量请求完成\n  ...join 所有错误返回",
    },
    {
      type: "list",
      items: [
        "三个单元并行:HTTP server、maintenance worker、alerting worker。",
        "任一单元异常退出 → 取消其他 → 整体退出(单体:部分失败=全停,靠进程管理器重启)。",
        "draining 标志:置位后 /readyz 返回不健康、新请求被拒,存量请求排空。",
        "Shutdown 有超时(shutdownCtx);超时未完成的请求被强制断开。",
      ],
    },
    {
      type: "heading",
      text: "HTTP server 的硬超时",
    },
    {
      type: "paragraph",
      text: "http.Server 配置了 ReadHeaderTimeout=5s、ReadTimeout=15s、WriteTimeout=30s、IdleTimeout=60s(application.go:166-170)——每个都防一类慢客户端/慢响应拖死连接。业务层还有各自的期限(query 10s 超时等),形成「传输层 + 业务层」双层超时。",
    },
    {
      type: "quiz",
      question: "maintenance worker 异常退出时,整个 Server 进程会怎样?",
      options: [
        "HTTP server 继续服务,worker 由内部自动重启",
        "Run 的 select 收到 worker 错误 → 取消其他单元 → 整体退出,交给进程管理器重启",
        "只有维护功能停止,摄取与查询不受影响",
        "进入 draining 模式等待人工恢复",
      ],
      answer: 1,
      explanation:
        "模块化单体刻意让 worker 错误传播为进程退出:后台任务(保留清理/隔离回收)停摆会导致数据治理失效,静默降级比显式重启更危险。Run 的 select 收到任一单元错误就 cancel 全部并返回错误——由 systemd/compose 重启整个进程。",
    },
    {
      type: "keypoints",
      items: [
        "bootstrap.New 是唯一组装根:db → migrate → store → 各 service(注入事务 runner)→ httpapi → workers。",
        "每个 service 一个 xxxTransactions runner,service 层不碰裸 db。",
        "Run 并行 HTTP + maintenance + alerting,任一错误整体退出。",
        "退出先 draining 再 graceful Shutdown,带超时。",
      ],
    },
  ],
};
