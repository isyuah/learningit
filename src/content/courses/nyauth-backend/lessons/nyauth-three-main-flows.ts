/* ==================================================================
 * 课时：登录 / 授权 / 注册三条主链路（nyauth-three-main-flows）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course 大纲一致。
 * 内容块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-three-main-flows",
  "courseSlug": "nyauth-backend",
  "title": "登录 / 授权 / 注册三条主链路",
  "summary": "把 Nyauth 的三条核心业务链路走一遍：登录、OAuth 授权、注册——每一步交代它要满足的不变量和由谁来做权威判断。",
  "minutes": 24,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "前两课我们搭好了「这是什么」和「模块怎么组织」的地图。这一课要往里填最重要的肉：三条贯穿整个服务的主业务链路——登录（Login）、OAuth 授权（Authorize + Token）、注册（Register）。它们不是三个孤立的端点，而是你之后学习每个模块时都会回访的「主干道」：几乎每个安全、事务、令牌的细节，都能在这三条链路上找到落点。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "把三条链路当成课程的脊柱",
      "body": "这堂课的价值不是让你背步骤，而是建立一张「主干道地图」。后面讲到会话过期、PKCE、consent、原子消费授权码、注册事务时，你都能立刻说出它属于哪条链路的哪一环。所以现在慢下来，把每一步的意义和它的权威判断者看清。"
    },
    {
      "type": "heading",
      "text": "链路一：登录（第一方用户进入控制台）"
    },
    {
      "type": "paragraph",
      "text": "登录解决的是「浏览器用户想进入 Nyauth 自己的用户中心」这件事。它的产出不是 OAuth 令牌，而是一个浏览器会话（Session），并通过 HttpOnly Cookie 把它交给浏览器。这条链路的关键不变量是：**数据校验和限流必须先于密码验证**，任何失败都不能让攻击者轻松枚举用户。"
    },
    {
      "type": "code",
      "title": "登录链路（POST /api/login）",
      "language": "text",
      "code": "POST /api/login\n  -> 输入校验 + 限流（先挡住暴力尝试）\n  -> 用户名/密码验证（慢哈希比较，错误信息不泄露用户名是否存在）\n  -> 判断 MFA / trusted device（该账号是否要第二步、是否可信设备）\n  -> 创建 Redis Session（短期 TTL 状态的权威来源）\n  -> 设置 HttpOnly Cookie（浏览器持凭据）\n  -> 返回当前用户 DTO"
    },
    {
      "type": "paragraph",
      "text": "这里的权威判断者是 `user` 服务（验证身份）与 `session` 存储（创建会话）。注意一个细节：会话状态放在 Redis，而不是 JWT——因为它需要被服务端随时撤销、设定过期、绑定设备，这些是「短期可变状态」，正符合 Redis 的职责。Cookie 用 `HttpOnly` 防止脚本直接读取，但请记住：它只是层层防御中的一环，并不能单独防住 XSS。"
    },
    {
      "type": "heading",
      "text": "链路二：OAuth 授权（第三方应用拿走令牌）"
    },
    {
      "type": "paragraph",
      "text": "第二条链路是 Nyauth 作为 Authorization Server 的核心舞台，也是你将来回答面试最依赖的部分。它分为两段：第一步 `GET /authorize` 在浏览器里完成「确认客户端合法 + 获得用户同意」，产出一个只能用一次的一次性授权码（Authorization Code）；第二步 `POST /token` 由 Client 用这个码（连同 PKCE verifier）兑换真实的令牌。"
    },
    {
      "type": "code",
      "title": "授权链路第一段：GET /authorize",
      "language": "text",
      "code": "GET /authorize\n  -> 校验 client_id、redirect_uri、scope、state、PKCE(S256)、nonce\n  -> 校验当前登录状态，以及 max_age / acr_values（认证新鲜度与等级）\n  -> 展示 Consent（用户同意授权哪些 scope）\n  -> 记录授权决定（authorization 记录）\n  -> 生成一次性 authorization code"
    },
    {
      "type": "code",
      "title": "授权链路第二段：POST /token",
      "language": "text",
      "code": "POST /token\n  -> 校验 code、client、redirect_uri、code_verifier（与当初的 S256 challenge 匹配）\n  -> 原子消费授权码（一个码只能用一次）\n  -> 签发 Access / ID / Refresh Token"
    },
    {
      "type": "paragraph",
      "text": "这条链路最密集地体现了安全边界：`redirect_uri` 必须是已登记的精确值（防止回调劫持）；`state` 绑定请求与响应的顺序（防止 CSRF 式串线）；`nonce` 绑定这次 OIDC 登录与 ID Token；`code_verifier` 必须匹配当初的 `code_challenge`（证明兑换者就是发起授权的人）。最关键的不变量是：**授权码只能被原子消费一次**——两个并发请求同时兑换同一个码，只有其中一个能成功。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "不要把 state 当身份，也不要把 nonce 当 CSRF Token",
      "body": "这三个参数解决的问题不同：`state` 绑定「请求↔响应」的顺序，`nonce` 绑定「这次 OIDC 登录↔ID Token」，CSRF Token 防的是「借助 Cookie 的跨站状态改写」。它们分别属于不同的协议上下文，混用会破坏各自的安全保证。"
    },
    {
      "type": "heading",
      "text": "链路三：注册（新用户进入系统）"
    },
    {
      "type": "paragraph",
      "text": "第三条链路是注册。它的特殊之处在于「一次请求要原子地写入一大堆相互关联的长期数据」——这正是它成为全项目讲解 PostgreSQL 事务最佳素材的原因。注册不可能成功一半：要么用户、注册记录、邀请预占、验证 Token、邮件 outbox、审计全部写进去，要么一个都不写。"
    },
    {
      "type": "code",
      "title": "注册链路（POST /api/register）",
      "language": "text",
      "code": "POST /api/register\n  -> 注册模式 / SMTP / 限流 / 人机验证（先看服务是否开放、环境是否具备）\n  -> 校验用户名 / 邮箱 / 密码 / 邀请码\n  -> 准备验证 Token 和邮件内容\n  -> 一个事务写入：用户 + 注册记录 + 邀请预占 + Token + 邮件 outbox + 审计\n  -> 返回 201 pending_verification"
    },
    {
      "type": "paragraph",
      "text": "注意返回的是 `201 pending_verification`：注册不等于立即可用，用户还处于「待验证」状态，等验证邮件里的 Token 被消费后才真正激活。这解释了为什么要同时写入一个验证 Token，也解释了为什么要写邮件 outbox——邮件不能靠当前请求的同步发送来保证，投递是后台 worker 的事。"
    },
    {
      "type": "heading",
      "text": "为什么注册必须是一个原子事务"
    },
    {
      "type": "paragraph",
      "text": "如果不用事务，会出现各种「半成品」：用户建了但注册记录没写、Token 发了但用户在库里的状态不完整、邀请码被预占却无法追溯。一个 pending 注册涉及六种长期数据，任何一步失败都不能让调用方以为「注册成功」。事务保证的是数据库提交的原子性——注意，它保证不了「SMTP 服务器已经收到了信」：邮件投递由之后的 worker 以「至少一次」语义完成，可能重复，但不会出现同一封邮件身份下不一致的状态。"
    },
    {
      "type": "table",
      "caption": "三条链路中的权威判断者",
      "headers": ["数据 / 状态", "权威来源", "在 Redis/内存中的作用"],
      "rows": [
        ["用户名/邮箱唯一性", "PostgreSQL 唯一约束", "无或仅缓存快照"],
        ["浏览器 Session", "Redis", "本身就是短期权威状态，可撤销、可过期"],
        ["Authorization Code", "Redis", "短期权威状态，只能被原子消费一次"],
        ["Refresh Token family", "Redis", "原子轮换 + 重用检测，旧 token 重用时撤销整条 family"],
        ["Access Token", "JWT + Redis 元数据", "JWT 供协议方验证，Redis 支持撤销与策略检查"],
        ["用户、Client、授权、设置", "PostgreSQL", "长期权威数据"],
        ["邮件/审计待发任务", "PostgreSQL outbox", "worker 领取投递，至少一次语义"]
      ]
    },
    {
      "type": "quote",
      "text": "每条链路都要问同两个问题：这一步必须满足什么不变量？由谁来对这个不变量做权威判断？",
      "source": "本课程对三条链路的统一读法"
    },
    {
      "type": "heading",
      "text": "三条链路合起来看：一条怎样的主循环"
    },
    {
      "type": "paragraph",
      "text": "如果把三条链路放在一起，你会看到 Nyauth 的「主循环」：注册把一个用户以原子方式带进系统（长期数据归 PostgreSQL）→ 登录把用户接到一个可撤销的浏览器会话上（短期状态归 Redis）→ 授权让经过用户同意的第三方应用拿到一组短期令牌（授权码原子消费，Refresh 轮换）。你在后面每一章里看到的会话、令牌、事务、outbox、限流，都是这条主循环上某个环节的「放大镜」。"
    },
    {
      "type": "quiz",
      "question": "为什么 `POST /token` 中消费授权码必须是一个原子操作？",
      "options": [
        "为了让响应更快",
        "因为授权码只能使用一次，两个并发请求同时兑换同一个码时只能有一个成功，否则会诱发重放/重放攻击",
        "为了把授权码放到 PostgreSQL 里",
        "因为授权码不需要匹配 PKCE verifier"
      ],
      "answer": 1,
      "explanation": "授权码是一次性凭据。只有在 Redis 里原子消费（验证匹配后删除/标记已用），才能保证并发兑换时只有一个成功，防止同一个码被重放使用。"
    },
    {
      "type": "quiz",
      "question": "关于注册返回 `201 pending_verification` 和事务，哪个理解正确？",
      "options": [
        "注册事务保证邮件一定被 SMTP 收到",
        "注册在一个事务里写入用户、注册、邀请预占、Token、邮件 outbox 与审计；待验证状态意味着邮件投递由后台 worker 完成，事务只保证数据库原子性",
        "注册不需要写验证 Token",
        "注册不需要审计记录"
      ],
      "answer": 1,
      "explanation": "事务保证的是数据库提交的原子性；邮件通过 outbox 由后台 worker 以至少一次语义投递，当前请求只记录待发送事件。"
    },
    {
      "type": "exercise",
      "title": "预测真实入口并用自己的话讲一条链路",
      "description": "基于这三条链路的知识，先预测（再核对）它们的真实入口文件：登录的 HTTP 处理函数、OAuth 的 `Authorize` 与 `Token`、注册的 HTTP 处理函数分别在哪个 package。然后从中挑一条链路（建议选 OAuth 授权），在不看笔记的前提下，用自己的话把这个链路从请求进来到令牌回去的每一步、以及每步的不变量讲清楚。",
      "hint": "登录处理在 `internal/server` 的 handlers.go（handleLogin），授权在 `internal/auth` 的 handler.go（Authorize/Token），注册在 `internal/server` 的 registration.go（handleRegister）。验证身份在 `internal/user` service.go。"
    },
    {
      "type": "keypoints",
      "items": [
        "登录：校验+限流→密码→MFA/可信设备→Redis Session→HttpOnly Cookie→用户 DTO；权威是 user 服务与 session 存储",
        "授权分两段：/authorize 产出一次性授权码，/token 用码+PKCE verifier 原子兑换令牌",
        "OAuth 不变量：精确 redirect_uri、state 防串线、nonce 绑 OIDC、S256 verifier 匹配、授权码只能原子消费一次",
        "注册：一个事务写用户+注册+邀请预占+Token+邮件 outbox+审计，返回 201 pending_verification",
        "事务保证数据库原子性，不保证 SMTP 已送达；邮件与审计由 worker 以至少一次语义投递",
        "三条链路构成主循环：注册进系统→登录接会话→授权发令牌，是后续所有章节的回访主干"
      ]
    }
  ]
};
