/* ==================================================================
 * 课程：Nyauth 后端系统学习（nyauth-backend）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 * ------------------------------------------------------------------
 * 学习对象：已具备 HTTP 与数据库基础、希望补齐 OAuth/OIDC 并把它
 * 讲成后端求职项目的学习者。课程以 E:/Proj/nya（nyauth）仓库为
 * 真实案例，阅读代码时以仓库当前 0.8.0-dev 分支为准。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "nyauth-backend",
  title: "Nyauth 后端系统学习：用 Go 构建 OAuth2/OIDC 认证服务",
  tagline: "从读架构到讲清设计，一个能写进简历的后端求职项目",
  description:
    "Nyauth 是一个用 Go 编写的统一认证与用户系统，同时是 OAuth 2.0 Authorization Server、OpenID Connect Provider 以及第一方用户中心和管理后台。本课程带你从零读懂它的架构、协议、安全、可靠性与测试，并把其中的关键设计讲成后端面试能力。\n\n课程按「先建项目地图 → 再学 HTTP 骨架 → 数据与一致性 → OAuth2/OIDC 协议 → 认证安全 → 可靠性与运维 → 测试与调试 → 面试准备」推进。你会读到真实的 handler/service/store 分层、注册与邮件 outbox 事务、Refresh Token 的 Redis Lua 原子轮换、多实例运行时配置的 revision CAS，以及它们各自的失败行为与测试证据。每一节配套要点、测验与练习，帮助你不仅看懂，还能讲清楚、写出来。",
  level: "intermediate",
  hours: 22,
  learners: 0,
  coverIndex: "07",
  coverColor: "danger",
  updatedAt: "2026-08",
  outcomes: [
    "建立 Nyauth 的架构地图：进程启动、模块关系、数据归属与三条主链路",
    "读懂 HTTP 层：中间件顺序、Cookie Session、CSRF 与错误分层",
    "掌握 PostgreSQL 事务、行锁、outbox 与 Redis Lua 的一致性设计",
    "系统掌握 OAuth2/OIDC：用 Authorization Code + PKCE、Scope/Claim、Refresh family 讲清授权闭环",
    "理解认证服务器的威胁模型：Cookie/CSRF、密码、TOTP、Passkey、Secrets 与审计",
    "能解释运行时配置的 revision CAS、能力 gate、outbox worker 与可观测性",
    "用真实测试与可证伪假设定位问题，而不是盲改代码",
    "把项目讲成后端能力：90 秒介绍、三个深挖故事与高频问答",
  ],
  chapters: [
    {
      id: "overview",
      title: "认识 Nyauth：先建立项目地图",
      intro: "先回答「这是什么、为谁解决什么问题」，再建立启动路径与模块关系。",
      lessons: [
        {
          slug: "nyauth-what-is-it",
          title: "Nyauth 是什么：一个完整的认证与授权服务",
          minutes: 15,
          kind: "reading",
        },
        {
          slug: "nyauth-architecture-map",
          title: "进程启动与模块关系",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "nyauth-three-main-flows",
          title: "登录 / 授权 / 注册三条主链路",
          minutes: 24,
          kind: "reading",
        },
      ],
    },
    {
      id: "http",
      title: "请求如何穿过 HTTP 层",
      intro: "已具备 HTTP 与数据库基础，这里聚焦 Nyauth 的项目级模式：中间件、会话与错误分层。",
      lessons: [
        {
          slug: "nyauth-http-lifecycle-middleware",
          title: "中间件顺序与请求生命周期",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "nyauth-session-cookie-csrf",
          title: "Cookie Session、CSRF 与安全响应头",
          minutes: 22,
          kind: "reading",
        },
      ],
    },
    {
      id: "data",
      title: "数据与一致性：PostgreSQL、Redis 与 Lua",
      intro: "一份数据放哪、一个操作是否必须事务化、并发如何原子处理，是后端一致性的核心。",
      lessons: [
        {
          slug: "nyauth-data-ownership",
          title: "数据归属：谁在 PostgreSQL、谁在 Redis",
          minutes: 18,
          kind: "reading",
        },
        {
          slug: "nyauth-transactions-outbox",
          title: "事务与 outbox：注册链路",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "nyauth-postgres-locking",
          title: "行锁、SKIP LOCKED 与 advisory lock",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "nyauth-redis-lua-atomicity",
          title: "Redis Lua 与 Refresh Token 原子轮换",
          minutes: 24,
          kind: "reading",
        },
      ],
    },
    {
      id: "oauth",
      title: "OAuth 2.0：授权服务器的协议基础",
      intro: "本节补上 OAuth 核心：角色、授权方式，以及最重要的 Authorization Code + PKCE。",
      lessons: [
        {
          slug: "nyauth-oauth-roles-grants",
          title: "OAuth 角色与授权方式总览",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "nyauth-oauth-code-pkce",
          title: "Authorization Code + PKCE 时序",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "nyauth-oauth-consent-scope",
          title: "Scope、Claim 与 Consent",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "nyauth-oauth-device-stepup",
          title: "Device Authorization 与 RFC 9470 Step-Up",
          minutes: 18,
          kind: "reading",
        },
      ],
    },
    {
      id: "oidc-tokens",
      title: "OIDC 与令牌体系",
      intro: "OAuth 之上确认「用户是谁」：ID Token、Discovery、UserInfo，以及 Refresh 轮换与 JWT 验证。",
      lessons: [
        {
          slug: "nyauth-oidc-id-token",
          title: "OIDC：ID Token、Discovery 与 UserInfo",
          minutes: 22,
          kind: "reading",
        },
        {
          slug: "nyauth-tokens-access-vs-id",
          title: "Access Token、ID Token 与 Refresh Token 有何不同",
          minutes: 18,
          kind: "reading",
        },
        {
          slug: "nyauth-refresh-family-rotation",
          title: "Refresh Token family：轮换与重用检测",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "nyauth-jwt-jwks-verification",
          title: "JWT 验证与 JWKS：签名有效不等于可信",
          minutes: 20,
          kind: "reading",
        },
      ],
    },
    {
      id: "security",
      title: "认证安全专题",
      intro: "身份服务的每个安全追问都值得认真准备：威胁模型、会话、密码 / MFA / Passkey 与审计。",
      lessons: [
        {
          slug: "nyauth-auth-threat-model",
          title: "认证服务器的威胁模型",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "nyauth-browser-session-security",
          title: "浏览器会话、CSRF、XSS 与 SameSite",
          minutes: 22,
          kind: "reading",
        },
        {
          slug: "nyauth-password-mfa-passkey",
          title: "密码、TOTP、恢复码与 Passkey",
          minutes: 26,
          kind: "reading",
        },
        {
          slug: "nyauth-secrets-audit-logging",
          title: "Secrets、日志脱敏与审计",
          minutes: 18,
          kind: "reading",
        },
      ],
    },
    {
      id: "reliability",
      title: "可靠性、异步与运维",
      intro: "请求成功之外，还要能讲清多实例、配置更新、Worker 与可观测性的工程能力。",
      lessons: [
        {
          slug: "nyauth-runtime-settings-cas",
          title: "运行时配置、revision CAS 与多实例同步",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "nyauth-service-control-drain",
          title: "能力 gate 与 in-flight 排空",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "nyauth-outbox-worker",
          title: "outbox worker：至少一次与重试",
          minutes: 20,
          kind: "reading",
        },
        {
          slug: "nyauth-health-observability",
          title: "健康检查与可观测性",
          minutes: 18,
          kind: "reading",
        },
      ],
    },
    {
      id: "testing",
      title: "用测试证明它真的工作",
      intro: "把测试当作可执行规范与证据，而不是「为了让覆盖率好看」。",
      lessons: [
        {
          slug: "nyauth-testing-four-layers",
          title: "四层测试，各自证明什么",
          minutes: 22,
          kind: "reading",
        },
        {
          slug: "nyauth-debugging-evidence",
          title: "用证据定位问题：可证伪假设",
          minutes: 18,
          kind: "reading",
        },
      ],
    },
    {
      id: "interview",
      title: "面试准备：把一个项目讲成能力",
      intro: "把技术理解转化成能经受追问的表达：90 秒介绍、三个深挖故事与高频问答。",
      lessons: [
        {
          slug: "nyauth-90s-project-intro",
          title: "90 秒项目介绍与简历写法",
          minutes: 16,
          kind: "reading",
        },
        {
          slug: "nyauth-three-deep-dive-stories",
          title: "三个深挖故事：事务 outbox、Refresh family、多实例配置",
          minutes: 26,
          kind: "reading",
        },
        {
          slug: "nyauth-interview-qa-bank",
          title: "高频面试问答：记住问题与回答框架",
          minutes: 24,
          kind: "reading",
        },
        {
          slug: "nyauth-project-showcase",
          title: "综合练习：把这个项目过成你自己的",
          minutes: 30,
          kind: "exercise",
        },
      ],
    },
  ],
};
