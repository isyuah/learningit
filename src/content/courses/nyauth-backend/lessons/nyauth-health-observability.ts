/* ==================================================================
 * 课时：健康检查与可观测性（nyauth-health-observability）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与文件名一致。
 * 内容块类型见 ../../../types.ts。
 * 本课时讲解 liveness/readiness/startup、结构化日志、
 * Prometheus 指标的低基数原则、审计与 OTLP。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-health-observability",
  "courseSlug": "nyauth-backend",
  "title": "健康检查与可观测性",
  "summary": "liveness、readiness、startup 各回答什么问题，指标为何必须低基数，以及日志、审计、tracing 的分工。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "前几课你学会了让系统「正确地跑、可控地停、可靠地投递」。这一课解决运维的另一半：怎么看它好不好。可观测性有四个容易混淆的维度——liveness、readiness、metrics、logs——外加一个经常被当成日志的 audit。把它们各自的职责和边界讲清楚，是运维与面试的核心。"
    },
    {
      "type": "heading",
      "text": "三类探针：liveness / readiness / startup"
    },
    {
      "type": "paragraph",
      "text": "探针回答的根本问题是「这一个请求要不要把流量交给这个实例」。nyauth 的 `/livez` 与 `/readyz` 分工明确：liveness 管「进程是否还活着」（吃没吃土、要不要重启），readiness 管「现在是否安全接收流量」（核心依赖是否可用）。Kubernetes 生态里还有第三个概念 startup，管「是否已完成初始化、可以开始被探活」——但请注意，nyauth 并没有独立实现 `/startupz` 端点（见下方的提示）。先看这两条真实端点，再理解 startup 作为概念如何融入。"
    },
    {
      "type": "table",
      "caption": "三类健康检查分别回答什么问题",
      "headers": ["探针", "回答的问题", "nyauth 的实现与失败语义"],
      "rows": [
        ["liveness（/livez）", "进程是否还活着？", "直接返回 200 {status:alive}，不查依赖；失败意味着进程需要被重启（如被 OOM/死锁卡死）"],
        ["readiness（/readyz）", "能否安全接收流量、核心依赖可用吗？", "依次 ping DB、ping Redis、校验 schema 版本、加载 JWK、确认 provider 初始快照完成；任一失败返回 503 not_ready"],
        ["startup（概念，非独立端点）", "初始化完成了吗？可以开始被探活了吗？", "通常以「完成 provider/快照等初始加载后再把实例标记为就绪」体现；nyauth 里由 readiness 内部的就绪 gate（accepting）表达，而非单独的 /startupz 端点"]
      ]
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "源码里只有 /livez 与 /readyz，没有独立的 startupz",
      "body": "在 `internal/server/server.go` 中，nyauth 只注册了 `/livez` 和 `/readyz` 两个探针端点；startup 是 Kubernetes 等编排平台的概念。nyauth 把「启动未完成」通过 readiness 内部的一个 `accepting` 就绪 gate（以及 provider 初始快照是否完成）来表达——即：还在启动初始化时 `/readyz` 会返回 not_ready，一旦初始化完成就绪 gate 置位才对外就绪。理解这一点，就能把「startup 是概念、readiness 是落地端点」区分清楚。"
    },
    {
      "type": "code",
      "title": "readiness 的依赖检查（internal/server/health.go）",
      "language": "go",
      "code": "func (s *Server) runtimeReadinessChecks() []readinessCheck {\n    return []readinessCheck{\n        {name: \"database\", check: func(ctx) error { return s.db.Ping(ctx) }},\n        {name: \"redis\",    check: func(ctx) error { return s.rdb.Ping(ctx).Err() }},\n        {name: \"schema\",    check: func(ctx) error { return database.ValidateSchemaVersion(ctx, s.db) }},\n        {name: \"jwk\",       check: func(ctx) error { _, _, err := s.jwkManager.GetPrivateKey(ctx); return err }},\n        {name: \"providers\", check: func(ctx) error {\n            if !s.readiness.accepting.Load() || !s.providerMgr.Ready() {\n                return errors.New(\"provider snapshot has not completed its initial load\")\n            }\n            return nil\n        }},\n    }\n}"
    },
    {
      "type": "paragraph",
      "text": "注意两点。第一，`/readyz` 返回 503 时绝不泄露内部细节——响应体只写 `{status:\"not_ready\"}`，具体哪个依赖失败进日志（`component`、`error_type`）而不进给客户端，避免把内部探测信息暴露给任意访问者。第二，`/readyz` 的检查清单是有意受限的：它检验「能不能安全收流量」所必需的核心依赖，而不是把每个功能都塞进去。这就和上一课的能力 gate 形成呼应——主动维护是独立的 operating 状态，绝不能拉垮 `/readyz`。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "探针选择错误的后果",
      "body": "把「重建会话」之类重依赖塞进 liveness，会把可恢复的依赖抖动放大成整实例重启；反过来拿 readiness 去重启进程又会造成频繁摘机。红线：liveness 只判生死、startup 只判初始化、readiness 才判依赖与流量。另一个常见错误是把「某个非核心能力挂了」塞进 readiness——例如 SMTP 或媒体存储故障必须「降级」而不是让 /readyz 失败，否则一次邮件/媒体故障会让整个实例被摘走，反而摧毁了登录与 OAuth/OIDC 这类核心能力。nyauth 的承诺正是：SMTP 与媒体写失败会向 `/readyz` 降级（服务降级、记录 degraded、相关 API 返回 503），但绝不让它把核心流量一起带走。"
    },
    {
      "type": "heading",
      "text": "结构化日志：一次请求/任务的诊断上下文"
    },
    {
      "type": "paragraph",
      "text": "日志回答的是「某个具体请求或任务到底发生了什么」。nyauth 用 `log/slog` 的结构化日志：每个入口注入 request ID，中间件链在 request ID 之后加上安全头、客户端 IP、telemetry、redacted logging 等。要点是「结构化、带上下文、可过滤」，让运维能按 request ID 把一条链路串起来，而不是靠 grep 一坨文本。日志也做脱敏（redact）——Token、密码等绝不能原样落盘，即使前端不显示也要在源头清洗（见 HTTP 基础章）。"
    },
    {
      "type": "heading",
      "text": "metrics：聚合数值，必须低基数"
    },
    {
      "type": "paragraph",
      "text": "指标回答的是「整体在往哪个方向走」：请求 RPS、延迟分布、依赖可用性、outbox 积压。它是聚合数值（计数器、直方图、gauge），供 Prometheus 采集、告警与看趋势。nyauth 的遥测 Runtime 明确声明：不把用户、客户端、token、IP 或其它无界标识符挂到指标上。"
    },
    {
      "type": "code",
      "title": "低基数标签：所有值都收敛到有限集合",
      "language": "go",
      "code": "// boundedValue 把任意字符串收敛到白名单，超出的归到 fallback\nfunc boundedValue(value, fallback string, allowed ...string) string {\n    for _, candidate := range allowed {\n        if value == candidate { return value }\n    }\n    return fallback // 未知值 -> 一个桶，而不是无限膨胀\n}\n\n// 例：注册结果是有限集合\nr.registrationEvents.Add(ctx, 1, metric.WithAttributes(\n    attribute.String(\"registration.result\", boundedResult),\n    attribute.String(\"registration.reason\", boundedReason),\n))\n// 例：HTTP 指标用路由模式与状态类，而不是具体 URL/用户\nattribute.String(\"http.route\", routePattern),          // /admin/users/{id} 而非真实 id\nattribute.String(\"http.response.status_class\", \"2xx\")  // 2xx 而非 200/201/..."
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "为什么用户 ID 绝不能是指标标签",
      "body": "Prometheus 每个「标签值组合」都是一条独立的时间序列，标签取值越多，序列数量越爆炸（cardinality explosion）。把 user_id 放进去，每个用户一条序列，百万用户就是百万条序列，会拖垮抓取、存储与查询。而且这泄漏了个人数据——指标端点本就不是给人看明细的地方，它只该看到聚合趋势。正确做法：需要「某个用户怎么样」去查审计/日志，而不是塞进指标。同理，邮箱、用户名、Token、任意回调 URL 都是无界的，一律不能进标签；nyauth 用 boundedValue 把所有标签都收敛到有限白名单，这就是「标签必须低基数」的工程落地。"
    },
    {
      "type": "heading",
      "text": "audit：面向安全追责，和日志不是一回事"
    },
    {
      "type": "paragraph",
      "text": "日志和审计经常被混为一谈，但它们服务不同的人与目的。日志帮助工程师调试「这次为什么会失败」；审计帮助安全/合规回答「谁在什么时候对什么对象做了什么、结果如何」。nyauth 的审计事件默认在业务事务里 `EnqueueTx` 落进 outbox，再由审计 worker 投递到 `audit_logs`——所以高风险设置变更与它的审计记录在同一数据库事务里原子提交，绝不能出现「改成了但没记上」或「记上了但没改成」。"
    },
    {
      "type": "table",
      "caption": "日志 vs 审计 vs tracing",
      "headers": ["可观测性", "服务对象", "回答的问题", "典型属性"],
      "rows": [
        ["结构化日志", "工程师", "某次请求/任务为什么如此？", "request ID、component、error、脱敏后的上下文"],
        ["审计", "安全 / 合规 / 追责", "谁在何时对什么对象做了什么、结果如何？", "actor、target、event、result、risk_level（与业务事务原子提交）"],
        ["指标/metrics", "监控 / 告警", "整体趋势与聚合数值如何？", "低基数标签的计数器/直方图/gauge，不含无界身份"],
        ["tracing（可选）", "工程师", "一次请求跨服务/依赖的时间花在哪？", "span 时序、依赖间延迟（OTLP/OpenTelemetry）"]
      ]
    },
    {
      "type": "heading",
      "text": "OTLP / OpenTelemetry：可选的跨服务时序"
    },
    {
      "type": "paragraph",
      "text": "tracing 是可观测性里的高级件，记录一次请求在数据库、Redis、SMTP、外部 provider 之间的耗时时序。nyauth 通过 OpenTelemetry 暴露 metrics：内置 Prometheus 导出器，并支持可热切换的 OTLP 导出器（dynamicOTLPExporter），OTLP 的端点与凭证在数据库运营配置里、测试通过后才激活，且 exporter 错误永远不会回显 Authorization 之类敏感头。tracing 是可选的，不是每个部署都需要——它最值钱的场景是「一次请求跨了多个服务/依赖，想知道瓶颈在哪」。"
    },
    {
      "type": "heading",
      "text": "部署形态与 HA 前提"
    },
    {
      "type": "paragraph",
      "text": "开发用根目录的 `docker-compose.yml`（postgres + redis + migrate + serve），生产/HA 用独立的 `docker-compose.ha.yml`。关键约束：多实例高可用只有在「共享外部 PostgreSQL、Redis 与私有 S3 媒体」时才成立，反向代理只把 `/readyz` 成功的实例纳入流量，不需要粘性会话（会话/token 状态由共享 Redis 保证，JWK 轮换由 advisory lock 保证单写者，媒体由共享 S3 提供）。docker-compose 用不可变镜像 digest、DSN/password 用文件挂载而非环境明文、media 用 S3 而非各实例本地目录——这些都是为了多实例一致性。"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "面试组合拳",
      "body": "把这一章的几条线串起来：/readyz 只验核心依赖且不因主动维护失败；SMTP/媒体故障降级而不摘机；指标低基数以保可查询不爆序列；审计与业务事务原子提交以保追责；HA 靠共享 PostgreSQL/Redis/S3 + 无粘性会话。面试官问任意一个，都能从「它回答什么问题、失败如何分级、为什么这么设计」三个角度展开。"
    },
    {
      "type": "quiz",
      "question": "关于指标与审计，哪句话正确？",
      "options": [
        "指标适合用 user_id 当标签，方便按用户排查问题",
        "指标必须低基数（标签收敛到有限集合），且不能含用户 ID/邮箱/token；审计面向安全追责，与日志不同",
        "日志就是审计，二者可以互相替代",
        "SMTP 或媒体故障时应让 /readyz 失败，以便尽快摘除实例"
      ],
      "answer": 1,
      "explanation": "指标标签必须低基数且不能含无界身份标识（会爆炸并泄漏数据）；审计与日志不同，审计面向安全追责且与业务事务原子提交。SMTP/媒体故障应降级而不是拉垮 /readyz，否则会连核心登录与 OAuth/OIDC 一起摘走。"
    },
    {
      "type": "keypoints",
      "items": [
        "liveness 判进程生死、readiness 判能否安全收流量+核心依赖、startup 判初始化完成",
        "/readyz 返回 503 但不泄露内部细节；主动维护是独立 operating 状态，不能拉垮 readiness",
        "SMTP/媒体写故障要降级（相关 API 503、记 degraded），绝不能牺牲登录与 OAuth/OIDC 的 /readyz",
        "结构化日志带 request ID 与上下文、做脱敏，服务一次请求/任务的诊断",
        "metrics 是聚合数值，标签必须低基数（boundedValue 收敛白名单），绝不含用户 ID/邮箱/token/任意 URL",
        "audit 面向安全追责，高风险变更与其审计在同一事务原子提交；与日志和 tracing 分工不同",
        "OTLP/OpenTelemetry 可选，动态切换 exporter 且不回显敏感头",
        "HA 依赖共享外部 PostgreSQL/Redis/S3、无粘性会话、反向代理只把 /readyz 成功的实例纳入流量"
      ]
    }
  ]
};
