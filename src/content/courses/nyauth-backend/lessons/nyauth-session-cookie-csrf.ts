/* ==================================================================
 * 课时：Cookie Session、CSRF 与安全响应头（nyauth-session-cookie-csrf）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与文件名一致。
 * 内容块类型见 ../../../types.ts。
 * 本课讲 Nyauth 第一方登录的会话机制：HttpOnly+SameSite=Lax 的
 * Cookie、CSRF 为什么必不可少、安全响应头，以及会话生命周期。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-session-cookie-csrf",
  "courseSlug": "nyauth-backend",
  "title": "Cookie Session、CSRF 与安全响应头",
  "summary": "登录不是『发一个 Token』就完事。Nyauth 用 HttpOnly+SameSite=Lax 的 Session Cookie 配合 CSRF Token，这一课讲清楚每一层防线到底防住什么。",
  "minutes": 22,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "OAuth2/OIDC 服务对外签发 Access Token，但对「自家浏览器里的第一方用户」则完全是另一条路：Nyauth 用一个 Redis 会话 + HttpOnly Cookie 来维持登录态，再靠 CSRF Token 保护所有状态变更。这听起来很简单，但里面每个属性、每个版本号都是有讲究的。我们先搞清楚「每个人各守什么门」，再落到代码和一条完整的登录→改资料请求链路。"
    },
    {
      "type": "heading",
      "text": "第一方会话是怎么建立的"
    },
    {
      "type": "paragraph",
      "text": "登录成功后，`handleLogin` 调用 `SessionMiddleware.CreateSessionWithAuthentication`，它做三件事：在 Redis 里保存一份会话数据（含用户、IP、User-Agent、认证等级、最后活跃时间等），生成一个 32 字节随机 `sessionID` 作为 Cookie 值，然后通过 `setCookieUntil` 写回 `nyauth_session` 这个 Cookie。之后每次请求，`GetSession` 用 Cookie 里的 ID 去 Redis 按值查回会话数据。"
    },
    {
      "type": "code",
      "title": "写会话 Cookie（真实模式）",
      "language": "go",
      "code": "http.SetCookie(w, &http.Cookie{\n    Name:     sessionCookieName, // \"nyauth_session\"\n    Value:    sessionID,          // 32 字节随机，Redis 的键\n    Path:     \"/\",\n    HttpOnly: true,               // JS 不可读\n    Secure:   m.secureCookie,     // 仅 HTTPS（由配置决定）\n    SameSite: http.SameSiteLaxMode,\n    MaxAge:   maxAge,             // 取自会话到期时间\n    Expires:  expiresAt,\n})"
    },
    {
      "type": "subheading",
      "text": "用户路由如何验证会话"
    },
    {
      "type": "paragraph",
      "text": "在 `buildRouter` 里，用户相关路由整组挂上了 `userAuthMiddleware`。它调用 `GetSession`，按错误类别分流：没有 Cookie → 401 `authentication required`；会话在 Redis 找不到（已过期/被删）→ 销毁 Cookie 并返回 401 `session expired`；Redis 不可用 → 503 `session service unavailable`。找到会话后，它还回到 PostgreSQL 取当前用户，并校验用户的 `AuthVersion`、`SessionVersion` 与会话里的一致，不一致就判定为「过期」销毁会话。最后把 `currentUser` 和会话对象放进 context 交给 handler。"
    },
    {
      "type": "table",
      "caption": "Cookie 属性各自防住什么",
      "headers": ["属性", "它防住的问题", "局限"],
      "rows": [
        ["HttpOnly", "XSS 注入的脚本无法通过 document.cookie 读取会话 Cookie", "不阻止恶意脚本代表用户发请求，也不替代输出编码"],
        ["Secure", "Cookie 只通过 HTTPS 传输，避免明文链路被截获", "若 HTTP 与 HTTPS 混用、或部署漏配，仍可能被降级命中"],
        ["SameSite=Lax", "跨站请求（非顶层导航的跨站 POST）默认不携 Cookie，降低 CSRF", "顶层导航（如 GET 跳转）仍会携带；且不含对已登录站内请求的纵深"],
        ["Path=/ + 高熵随机值", "Cookie 绑定到整个站点的会话 ID，难以被猜测/撞库", "仍需 CSRF 兜底，因为 Cookie 是本来的『凭证』"]
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "不要把 HttpOnly 当成 XSS 的解药",
      "body": "HttpOnly 只是让 JavaScript「读不到」Cookie 的值。它阻止不了恶意脚本用登录用户的身份去发请求——那些请求照样携带 Cookie，服务器照样应答。真正的 XSS 防护要靠输出编码、内容安全策略，以及「状态变更必须带 CSRF Token」这层纵深。Nyauth 里同时用了 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy` 这些安全响应头，目的就是把浏览器的默认行为往更安全的方向压。"
    },
    {
      "type": "definition",
      "term": "CSRF vs CORS",
      "definition": "CSRF（跨站请求伪造）是攻击面：利用浏览器自动携带 Cookie 的特性，诱导在别站登录的受害者在不知情下向本站发『状态变更』请求。CORS 是浏览器的机制：它只是一组响应头，告诉浏览器『这个跨源响应可以给哪个源读取/携带凭据』。CORS 不能替代认证，也不能防 CSRF——它控制的是『能否读响应』，而 CSRF 利用的是『请求本身带着 Cookie 去』。所以在 Nyauth 里 `Access-Control-Allow-Origin` 是精确的 issuer，且 `AllowCredentials: true`，绝不能用 `*` 配凭据。"
    },
    {
      "type": "heading",
      "text": "为什么 SameSite=Lax 还不够，还要 CSRF Token"
    },
    {
      "type": "paragraph",
      "text": "SameSite=Lax 覆盖了大多数第三方发起的写请求，但它是「协商式」的：老浏览器不识别、某些场景（顶层导航、同源 iframe 策略放宽）仍然会携带 Cookie。认证服务不能把一种「通常有效」的浏览器策略当作唯一的防线。Nyauth 因此对所有写操作叠加 `csrfMiddleware`：它跳过 GET/HEAD/OPTIONS，要求请求带 `X-CSRF-Token` 头，并用 `crypto/subtle.ConstantTimeCompare` 与会话数据里保存的 CSRF Token 做常数时间比较，不匹配或缺失一律 403，并记录拒绝原因（missing_session / missing_token / mismatch）。"
    },
    {
      "type": "code",
      "title": "前端：先取会话，再带 X-CSRF-Token 改资料",
      "language": "javascript",
      "code": "// 1) 登录后 / 刷新时，拿到会话（含 csrf_token）\nconst sessionRes = await fetch('/api/session', {\n  credentials: 'include', // 带上 HttpOnly Cookie\n});\nconst session = await sessionRes.json();\n// session.csrf_token 会由服务端在下发会话时返回给前端\n\n// 2) 改资料：带 Cookie + CSRF Token 的 PUT\nconst res = await fetch('/api/me', {\n  method: 'PUT',\n  credentials: 'include',\n  headers: {\n    'Content-Type': 'application/json',\n    'X-CSRF-Token': session.csrf_token, // 写操作必带\n  },\n  body: JSON.stringify({ display_name: '新昵称' }),\n});\n// 缺 token / token 错 -> 403 invalid CSRF token"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "CSRF 只包「需要 Session Cookie 的写操作」",
      "body": "在 buildRouter 里，`csrfMiddleware` 被放在用户路由组和管理路由组内部，而不是全局。原因正是本课上一章的教训：像 OAuth 回调、`/token` 这种公开协议端点依赖的是授权码/凭据而非 Session Cookie，套上 CSRF 反而破坏协议。CSRF 是「面对浏览器 Cookie 凭证」的防守武器，只有真正靠 Cookie 认证的写操作才需要它。"
    },
    {
      "type": "definition",
      "term": "纵深防御（Defense in Depth）",
      "definition": "不依赖单一防线：HttpOnly 挡住脚本偷 Cookie，SameSite 挡掉大部分跨站请求，`X-Frame-Options`/`nosniff` 收紧浏览器默认行为，CSRF Token 兜底「即使 Cookie 被自动携带，也不足以完成写操作」。每一层都防一个不同的问题，合起来才构成认证服务该有的信任边界。"
    },
    {
      "type": "heading",
      "text": "会话的生命周期"
    },
    {
      "type": "paragraph",
      "text": "会话不是「建了就永久有效」。Nyauth 在 `applyDeadlines` 里给会话同时算三条期限：绝对到期 `SessionExpiresAt`（从 `CreatedAt` 起算）、空闲到期 `SessionIdleExpiresAt`（从 `LastSeenAt` 起算）、以及「近期重新认证」期限 `RecentAuthenticationExpiresAt`（从 `AuthenticatedAt` 起算）。Cookie 的 `MaxAge` 取的是 `effectiveSessionExpiry`——即空闲期限与绝对期限里较早的那个。"
    },
    {
      "type": "list",
      "items": [
        "绝对到期：无论多活跃，超过绝对时长就强制下线，防止无限期会话",
        "空闲到期：一段时间没活动（`LastSeenAt` 不再刷新）就过期；`GetSession` 会按间隔 touch 并顺延",
        "近期重新认证：管理后台与敏感操作要求 `AuthenticatedAt` 足够新，过期就得「重新认证」（reauth），这就是登录后久置再点敏感按钮会被要求再输密码的原因",
        "auth_version：用户安全凭证变更（改密码/禁用 MFA）后全局抬高，所有旧会话一并失效",
        "session_version：会话级安全变更后让旧的已签到会话失效",
        "PolicyRevision：运行时生命周期策略改版后，下一次 `GetSession` 会按新策略重算期限"
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "登录的两种成功形态：200 vs 202",
      "body": "`handleLogin` 并不总是返回 200 + 会话。当 `beginMFAPending` 判断当前用户需要 MFA 且没有可信设备时，它只创建一个 `mfa_pending` 临时会话并返回 `202 Accepted`（`mfa_required`），此时还没有正式会话 Cookie。只有当 MFA 验证通过（或无需 MFA、或命中可信设备）后，才走 `CreateSessionWithAuthentication` 正式建会话并返回 200 + 会话数据。理解这个分支，你调登录接口时就不会因偶发 202 而困惑——它只是一种「还没完成登录」的中间状态。"
    },
    {
      "type": "table",
      "caption": "错误状态与区分",
      "headers": ["情况", "HTTP", "body 里的话术"],
      "rows": [
        ["同一会话，同时更新 auth_version 与 session_version 并比较身份", "——", "防止走旧会话"],
        ["没有 Cookie（从未登录）", "401", "authentication required"],
        ["有 Cookie 但 Redis 里找不到（过期/被删）", "401", "session expired"],
        ["Redis 不可用", "503", "session service unavailable"],
        ["CSRF 缺失/不匹配", "403", "invalid CSRF token"],
        ["admin 路由但非 admin", "403", "admin access required"]
      ]
    },
    {
      "type": "quiz",
      "question": "为什么即便配置了 SameSite=Lax 的会话 Cookie，Nyauth 仍要求所有写操作带 X-CSRF-Token？",
      "options": [
        "因为 SameSite=Lax 只对顶级导航生效，对站内 API 完全无效",
        "因为 SameSite 是浏览器协商策略，老浏览器可能不识别，且某些场景（顶层导航等）仍会携带 Cookie，认证边界不能只依赖它",
        "因为 CSRF Token 是唯一能识别真实用户身份的凭证",
        "因为 CORS 不允许浏览器跨源发送 Cookie，所以必须改用 Token"
      ],
      "answer": 1,
      "explanation": "SameSite 覆盖了大多数第三方写请求，但它是浏览器侧的协商策略而非强保证；认证服务必须把『状态变更必须有不可预测的证明』作为自己的纵深防御，CSRF Token 正是补上这一层，且用常数时间比较防时序侧信道。"
    },
    {
      "type": "exercise",
      "title": "设计一个验证 CSRF 拒绝的测试",
      "description": "针对 `csrfMiddleware` 写一个测试计划：(1) 完成登录拿到会话后，分别不带 `X-CSRF-Token`、带错误的 token、带正确 token，对 `PUT /api/me` 各发一次请求，断言三种情况的状态码；(2) 验证 GET/HEAD/OPTIONS 不受 CSRF 拦截；(3) 验证 OAuth 协议端点（如 `/authorize`）没有被 CSRF 中间件误伤。最后说明：为什么用 `crypto/subtle.ConstantTimeCompare` 而不是普通的 `==` 比较。",
      "hint": "正确=200 或业务码；缺/错=403 invalid CSRF token。常数时间比较是为了避免把『token 是否匹配』的信息通过响应时间的微小差别泄露给攻击者，哪怕只有一位字符不同也应消耗相近时间。"
    },
    {
      "type": "keypoints",
      "items": [
        "第一方会话 = Redis 会话 + HttpOnly+SameSite=Lax 的 nyauth_session Cookie（32 字节随机 ID）",
        "userAuthMiddleware 按错误类别分流 401/401(expired)/503，并校验 auth_version 与 session_version",
        "HttpOnly 防读不防发，不能替代 XSS 输出编码；Secure 仅 HTTPS；SameSite=Lax 是浏览器协商而非强保证",
        "CSRF Token 用 X-CSRF-Token 头 + 常数时间比较保护所有 Session Cookie 写操作，且只挂在用户/管理路由组而非全局",
        "安全响应头簇：nosniff、no-referrer、X-Frame-Options DENY、Permissions-Policy",
        "生命周期：绝对到期、空闲到期、近期重新认证三段期限，加上 auth_version/session_version/PolicyRevision 的失效机制",
        "登录成功返回 200+会话，需 MFA 未完成为 202 mfa_required"
      ]
    }
  ]
};
