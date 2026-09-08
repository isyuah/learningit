/* ==================================================================
 * 课时：进程启动与模块关系（nyauth-architecture-map）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course 大纲一致。
 * 内容块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-architecture-map",
  "courseSlug": "nyauth-backend",
  "title": "进程启动与模块关系",
  "summary": "顺着 nyauth serve 的启动路径走一遍，弄清 migrate 与 serve 的分工、模块之间的依赖关系，以及路由与能力开关如何分区。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "上一课我们给 Nyauth 建立了一个「安全边界」的心智模型。这一课我们要把它落实成一张可以走进去的架构地图：从进程启动那一刻开始，代码做了什么；这些模块之间是什么关系；HTTP 请求进来之后会落到哪一组路由。学完这一课，你应该能回答「一个请求从进进程到返回，经过哪些层」——这是任何后端项目中第一个被问到的问题。"
    },
    {
      "type": "heading",
      "text": "启动路径：nyauth serve 从零到监听"
    },
    {
      "type": "paragraph",
      "text": "Nyauth 的命令行入口是 `nyauth serve`（还有 `migrate`、`maintenance`、`healthcheck` 等兄弟命令）。启动不是「读个配置就监听端口」，而是一个有严格顺序的初始化流程：每一步都为下一步准备好了依赖。入口在 `cmd/nyauth/main.go` 的 `main`，服务装配在 `server.New` 与 `Server.Run`。"
    },
    {
      "type": "code",
      "title": "nyauth serve 的启动顺序",
      "language": "text",
      "code": "nyauth serve\n  -> load config（加载配置：issuer、数据库、Redis、可信代理等）\n  -> connect PostgreSQL（建立连接池）\n  -> validate schema and runtime role（只校验表结构 + 运行时角色权限）\n  -> connect Redis and Ping（连接并确认可达）\n  -> initialize telemetry（初始化日志、指标、追踪）\n  -> construct stores/services（按依赖顺序组装 store 与 service）\n  -> build router and workers（挂载路由、启动后台 worker）\n  -> start HTTP server（开始监听）"
    },
    {
      "type": "paragraph",
      "text": "注意其中「validate schema and runtime role」这一步：它只做校验，不做修改。这一点是下一小节的关键，也是 `serve` 和 `migrate` 拉开差距的地方。"
    },
    {
      "type": "heading",
      "text": "migrate 与 serve：两套不同的数据库权限哲学"
    },
    {
      "type": "paragraph",
      "text": "很多初学后端的人会问：为什么启动时不自动迁移数据库？Nyauth 的答案是：迁移和常驻服务是两种职责，绝不混在一个进程里。`migrate` 命令专门执行 DDL（建表、改表），跑完之后还会做「权限收紧」（grant runtime privileges / ensure runtime privileges）；而 `serve` 作为常驻服务，只验证 schema 是否符合预期，绝不在请求路径上偷偷执行 DDL。"
    },
    {
      "type": "table",
      "caption": "migrate 与 serve 的分工",
      "headers": ["维度", "migrate（迁移账号）", "serve（运行时账号）"],
      "rows": [
        ["职责", "执行 DDL 迁移并收紧权限", "只校验 schema，常驻处理请求"],
        ["数据库权限", "拥有 DDL 权限的迁移账号", "只拥有数据操作权限，无 DDL 权限"],
        ["是否自动建表", "是（运行迁移）", "否——结构不对会报错，但不动数据库"],
        ["失败影响", "迁移失败则进程退出", "校验失败则拒绝启动，保护数据边界"]
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "为什么 serve 不让运行时账号拥有 DDL 权限",
      "body": "这是面试经常追问的安全点：如果应用账号拥有 DDL 权限，一旦应用被攻破，攻击者就能修改表结构、触碰迁移表、扩大权限边界。把 DDL 隔离到单独的 migrate 账号，等于把「能被注入的代码」和「能改表结构的权限」彻底分开。所以常驻服务在启动时只 `validate`（验证 schema 与角色），不做迁移。"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "一条运维上的推论",
      "body": "理解了 migrate/serve 分离，你就能自己推理出正确的升级顺序：先跑 `nyauth migrate`（用迁移账号改结构），再启动 `nyauth serve`（用运行时账号验证并服务）。不要把迁移和发布混在一个动作里，也不要指望服务启动时自动帮你建表。"
    },
    {
      "type": "heading",
      "text": "模块关系地图：server 之下的十多个子域"
    },
    {
      "type": "paragraph",
      "text": "代码的组织方式是按「业务域」划分 package。以 `server` 为装配中心，下面是各负其责的子模块。它们的依赖方向大致是单向的：`server` 把 store/service 组合起来，`auth`、`user` 等模块再依赖 `session`、`settings` 等更底层的基础设施。读这张表时，重点是记住「每个模块管什么、它的权威数据源是什么」，而不是背代码行。"
    },
    {
      "type": "table",
      "caption": "server 之下的核心模块与职责",
      "headers": ["模块", "职责"],
      "rows": [
        ["auth", "OAuth/OIDC 协议、Consent、令牌签发与刷新（Authorization Server 核心）"],
        ["user", "用户资料、注册、密码验证与修改"],
        ["account", "邮箱动作、邮件模板、邮件 outbox（可靠投递）"],
        ["session", "Redis Session、授权码、Refresh family、MFA pending"],
        ["mfa", "TOTP、恢复码、Passkey/WebAuthn"],
        ["authorization", "用户对某个 Client 的授权记录"],
        ["client", "OAuth Client、Scope、Claim 映射、发布者状态"],
        ["provider", "GitHub/Google/OIDC 外部身份接入"],
        ["settings", "运行时配置快照与 CAS（compare-and-swap）"],
        ["servicecontrol", "维护能力 gate、多实例排空（drain）"],
        ["audit", "审计 outbox、分区、保留策略与查询"],
        ["telemetry", "Prometheus 指标、结构化日志、OTLP 追踪"],
        ["database", "连接池、迁移、运行时权限管理"]
      ]
    },
    {
      "type": "paragraph",
      "text": "数据归属原则在这里也成立：**PostgreSQL 存长期权威数据**（用户、Client、授权、设置、审计），**Redis 存短期 TTL 状态**（浏览器 Session、授权码、Refresh family、MFA pending），**Access Token 则是 JWT + Redis 里的服务端元数据**。你在读每个模块时，都可以用「这份数据归谁管」来校准理解。"
    },
    {
      "type": "heading",
      "text": "HTTP 路由分区与能力开关"
    },
    {
      "type": "paragraph",
      "text": "路由不是扁平的，而是分成三组，每组有不同的保护强度。在 `buildRouter` 里能看到三组明显的分区：公开路由、用户路由、管理路由。越往后，越需要更强的会话、CSRF 与近期重新认证。"
    },
    {
      "type": "list",
      "items": [
        "公开路由：健康检查、注册、登录入口、公开媒体、Discovery、JWKS——无需登录也能访问",
        "用户路由：需要浏览器 Session、CSRF 校验，以及「当前密码（或会话）变更」检查——保护已登录用户的操作",
        "管理路由：需要管理员 Session、CSRF、审计；敏感操作还会再要求「近期重新认证」"
      ]
    },
    {
      "type": "paragraph",
      "text": "除了这三组分区，路由上还挂着「能力开关」（capability gate）。它不是一个前端的 UI 禁用按钮，而是服务端在业务开始之前就拒绝被暂停能力的一种硬门禁。典型能力包括 `auth_issuance`（是否允许签发令牌）、`account_mutations`（是否允许改账户）、`mail_delivery`（是否允许发信）、`media_writes`（是否允许写媒体）。"
    },
    {
      "type": "callout",
      "variant": "example",
      "title": "能力开关与维护状态",
      "body": "想象运维要升级令牌签名密钥：运维可以用 servicecontrol 关掉 `auth_issuance` 这个 gate，新请求在业务开始前就被拒绝签发（返回 503），等在途请求归零后再升级。注意它「按能力暂停」而不是把整个 HTTP 端口关掉，这就是 `serve` 与「直接杀进程」的本质区别。"
    },
    {
      "type": "heading",
      "text": "第一轮不要碰的模块"
    },
    {
      "type": "paragraph",
      "text": "模块地图很大，但不是所有都值得第一轮学习。`avatar`（头像裁剪与对象存储）、`branding`（品牌外观）、`notification`（通知）是有价值的支线，但它们不能帮你先掌握认证服务的核心闭环。练习时先守住 `auth`、`user`、`session`、`mfa`、`authorization`、`client` 这条主线，等能讲清「授权码换令牌」和「注册事务」之后，再回头补支线。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "面试官真正在意的能力",
      "body": "读架构地图的目的不是「把 13 个模块名字背下来」，而是能说清：请求经过哪些层、哪些状态归 PostgreSQL、哪些归 Redis、能力开关在哪个位置拦截、以及 migrate/serve 为什么分离。能把这条链路讲成一个有顺序、有理由的故事，比罗列模块名有用得多。"
    },
    {
      "type": "quiz",
      "question": "为什么 `nyauth serve` 在启动时只「校验 schema」而不会自动执行迁移？",
      "options": [
        "因为它想减少启动时间",
        "因为运行时账号不应拥有 DDL 权限，数据库结构变更应隔离给独立的 migrate 账号",
        "因为 PostgreSQL 不支持自动建表",
        "因为迁移必须在登录之后才能执行"
      ],
      "answer": 1,
      "explanation": "把 DDL 隔离给 migrate 账号，运行时账号不拥有改表结构的权限，能避免应用被攻破后攻击者修改表结构或迁移表。"
    },
    {
      "type": "quiz",
      "question": "想知道 Nyauth 在请求处理前把能力开关放在哪个位置，正确的理解是？",
      "options": [
        "它只用于前端隐藏按钮，服务端不检查",
        "它是服务端在业务开始前就拒绝被暂停能力的硬门禁，是 HTTP 分区之外的又一道闸",
        "它只在数据库迁移时生效",
        "它只保护静态资源"
      ],
      "answer": 1,
      "explanation": "capability gate 不是前端禁用，而是服务端在进入业务逻辑前就检查并拒绝（理解成维护时返回 503 的来源）。"
    },
    {
      "type": "exercise",
      "title": "画出你的架构地图并标出数据归属",
      "description": "不看书，自己画一张图：从 `nyauth serve` 启动到 HTTP 监听，标出每一步；再把 server 之下的核心模块（auth / user / session / mfa / authorization / client / settings / audit）按职责分组，并给每个模块标注它的权威数据源（PostgreSQL / Redis / JWT+Redis）。最后用一句话解释 migrate 与 serve 为何必须分离。",
      "hint": "参考启动顺序表格和模块表格；数据归属只用三种答案——PostgreSQL、Redis、JWT+Redis 元数据。"
    },
    {
      "type": "keypoints",
      "items": [
        "启动顺序：加载配置→连 PostgreSQL→校验 schema 与角色→连 Redis/Ping→遥测→组装 store/service→建路由与 worker→监听",
        "migrate 负责 DDL 与权限收紧；serve 只验证 schema，运行时账号无 DDL 权限",
        "模块以 server 为装配中心，核心是 auth / user / account / session / mfa / authorization / client / provider / settings / servicecontrol / audit / telemetry / database",
        "数据归属：PostgreSQL=长期权威数据；Redis=短期 TTL 状态；Access Token=JWT+Redis 元数据",
        "路由分公开 / 用户 / 管理三组，能力开关在业务开始前按能力拒绝（如 auth_issuance、mail_delivery）",
        "第一轮别碰 avatar / branding / notification，先守住认证授权核心闭环"
      ]
    }
  ]
};
