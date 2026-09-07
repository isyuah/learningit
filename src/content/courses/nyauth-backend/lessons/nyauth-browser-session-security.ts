/* ==================================================================
 * 课时：浏览器会话、CSRF、XSS 与 SameSite（nyauth-browser-session-security）
 * ----------------------------------------------------------------
 * slug 必须与 course.ts 大纲一致。块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-browser-session-security",
  "courseSlug": "nyauth-backend",
  "title": "浏览器会话、CSRF、XSS 与 SameSite",
  "summary": "HttpOnly/Secure/SameSite/CSRF 各拦什么，会话的生命周期与撤销语义，以及 CSRF 与 CORS 的区别。",
  "minutes": 22,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "浏览器会话安全的麻烦在于：Cookie 会自动跟随同源请求，而恶意页面可能诱导用户的浏览器发起任意请求。这需要一层一层的防线，而不是靠单一机制。这一课把 Nyauth 浏览器会话上的每道防线拆开：它拦什么攻击、它拦不住什么、以及为什么不能互相替代。核心安全链不变：输入校验 -> 身份认证 -> 会话保护 -> 授权范围 -> 令牌签发 -> 撤销/轮换 -> 审计/告警，本课聚焦「会话保护」这一环。"
    },
    {
      "type": "definition",
      "term": "会话（Session）数据模型",
      "definition": "一次已认证的浏览器会话是一个服务端保存的状态对象，包含 UserID、AuthVersion、SessionVersion、CreatedAt、AuthenticatedAt、LastSeenAt，以及三个由策略计算出的撤销期限：SessionExpiresAt（绝对过期）、SessionIdleExpiresAt（空闲过期）、RecentAuthenticationExpiresAt（近期重认证期限）。会话 id 通过 HttpOnly Cookie 交给浏览器。"
    },
    {
      "type": "heading",
      "text": "Cookie 属性各自拦什么",
    },
    {
      "type": "paragraph",
      "text": "Nyauth 设置在会话 Cookie 上的三个属性是 HttpOnly、Secure、SameSite=Lax。它们各立了一块防火墙：HttpOnly 拦截「脚本读取 Cookie」，Secure 拦截「明文传输」，SameSite 拦截「跨站请求自动带上 Cookie」。但注意：HttpOnly 只挡 JS 读取，不挡恶意脚本用浏览器发同源请求——那正是 CSRF 的通道。"
    },
    {
      "type": "table",
      "caption": "Cookie 属性/机制 -> 拦什么攻击 -> 局限",
      "headers": ["机制", "拦住的攻击", "拦不住的 / 局限"],
      "rows": [
        ["HttpOnly", "XSS 脚本直接读走 Cookie 值", "不防 XSS 本身；恶意脚本仍可用浏览器发同源请求（CSRF 通道仍在）"],
        ["Secure", "明文 HTTP 上的窃听与篡改（Cookie 只在 HTTPS 发送）", "对已上 HTTPS、但被脚本劫持的页面无帮助；需要正确部署 TLS"],
        ["SameSite=Lax", "大多数跨站（cross-site）请求不再自动带 Cookie；缓解 CSRF", "跨站顶层导航 GET 仍会带；不能替代显式 CSRF Token；对同源 XSS 无效"],
        ["CSRF Token", "跨站伪造的状态变更请求（需要提交只有本站 JS 知道的 token）", "对同源 XSS 无效；若 token 被脚本读到则失效"],
        ["输出编码 + CSP", "XSS 注入（防止脚本落进 DOM 执行）", "HttpOnly 不是它的替代品；要正确配置并对所有注入点编码"]
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "面试高频追问：HttpOnly 到底保护什么",
      "body": "问题往往是「如果攻击者能执行同源 JavaScript，HttpOnly Cookie 还能保护什么？」答案：它阻止脚本把 Cookie 值读出来带到攻击者的服务器（防 Cookie 数据外泄给攻击者），但不能阻止脚本借用户浏览器发同源请求（它还是会带上 Cookie）。所以在 HttpOnly 之外，还必须有输出编码/CSP（防 XSS）、SameSite（限跨站）、CSRF Token（防伪造状态变更）、同源校验和近期重认证。这就是 Nyauth 把它们叠在一起的原因。"
    },
    {
      "type": "heading",
      "text": "为什么 SameSite=Lax 之后仍要 CSRF Token",
    },
    {
      "type": "paragraph",
      "text": "一个常见的误解是「只要 SameSite=Strict/Lax 就不需要 CSRF Token了」。SameSite 是浏览器按「站点」识别请求的启发式，它不完美：Lax 放行跨站顶层导航的 GET，而 GET 也不该有副作用；更根本的是，SameSite 的判定依赖浏览器版本与行为，且它管的是「是否带 Cookie」，而 CSRF 的本质是防「状态变更被伪造」。一个 `POST /logout`、改密码、改安全设置的请求，标准做法是既设 SameSite 限制、又在服务端校验 CSRF Token，把防御建立在「服务端可控的验证」而非「浏览器可选的行为」上。"
    },
    {
      "type": "paragraph",
      "text": "Nyauth 的 `csrfMiddleware` 对非 GET/HEAD/OPTIONS 请求要求请求头 `X-CSRF-Token` 与会话数据里的 CSRF Token 恒定时间相等（`subtle.ConstantTimeCompare`），并提供内置的 `RecordCSRFReject` 遥测记录拒绝原因（missing_session / missing_token / mismatch）。CSRF Token 是「状态变更须由本站 JS 显式授权」的证明，这正是 Cookie 自动携带所缺的。"
    },
    {
      "type": "definition",
      "term": "CSRF 与 CORS 的区别",
      "definition": "CORS 约束的是「浏览器脚本能否读取跨源响应」——它决定响应能不能被 JS 看到；CSRF 防的是「攻击者利用浏览器自动携带的 Cookie 执行状态变更」——它决定一个跨站请求是不是被当成用户本人的操作。CORS 配错不等于有 CSRF 防护；对使用 Bearer Token 的跨域 API（token 不在 Cookie 里、由 JS 显式带头）威胁模型又不同，不能照搬 Cookie API 的策略。"
    },
    {
      "type": "heading",
      "text": "会话生命周期：绝对、空闲与近期重认证",
    },
    {
      "type": "paragraph",
      "text": "Nyauth 用三个期限限制一个会话的寿命：绝对过期（SessionExpiresAt）无论是否活跃，到期即失效；空闲过期（SessionIdleExpiresAt）在一段时间没有活动后失效；近期重认证期限（RecentAuthenticationExpiresAt）限制「最近一次完整认证」的新鲜度，用于敏感操作。`applyDeadlines` 基于 CreatedAt / LastSeenAt / AuthenticatedAt 分别计算这三个时间点，`effectiveSessionExpiry` 取空闲与绝对中更早的那个作为 Cookie 到期时间。"
    },
    {
      "type": "paragraph",
      "text": "会话读取时（`GetSession`）会按策略推算剩余寿命；若到期则删除会话并清 Cookie，返回「session expired」。空闲会话按 `sessionTouchInterval`（空闲期限的一半，封顶 5 分钟）才写一次 LastSeenAt，避免每个请求都回写 Redis。近期重认证在 `reauthentication.go`：`requireRecentAuthentication` 检查 `AuthenticatedAt` 距离现在是否在 `RecentAuthenticationDuration` 之内，超过就返回「需要近期重新验证」(403)。高价值操作（改密码、管理 MFA、重置）会叠加这一道闸。"
    },
    {
      "type": "heading",
      "text": "auth_version 与 session_version：两代失效语义",
    },
    {
      "type": "paragraph",
      "text": "Nyauth 用两个递增版本号区分「认证本身失效」与「会话被撤销」：`auth_version` 在密码/MFA 等安全事件发生后递增（例如改密码、绑定/解除 MFA、安全重置），表示「旧的认证凭据不再可信」；`session_version` 用于整批撤销会话的版本边界（例如管理员重置该用户的所有会话）。"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "两者如何协同",
      "body": "会话里存着签发时的 AuthVersion 与 SessionVersion。`userAuthMiddleware` 每次请求都拿当前用户的实际版本与会话里存的比对：任一不一致就销毁会话并返回 401。这样改密码或管理员撤销会话会立刻让旧浏览器会话失效，而无需显式遍历删除每条会话记录——版本比对就是撤销边界。MFA 相关的敏感变更还会用 `lockAuthenticationState` 在事务里锁定并校验版本，防止并发变更产生竞态。"
    },
    {
      "type": "heading",
      "text": "MFA pending 用一个独立 Cookie",
    },
    {
      "type": "paragraph",
      "text": "登录流程中需要第二阶段（MFA）时，Nyauth 不开立完整会话，而是创建独立的 `nyauth_mfa_pending` Cookie（TTL 5 分钟），里面是一条临时的 MFA pending 状态。它持有随机的 token 与短暂的生命周期，直到第二因子（TOTP/恢复码/Passkey）验证完成。此时配套的 CSRF 保护也是临时的——它还处于「未完整认证」状态，不能复用已认证会话的 CSRF Token 体系。这保证了第二因子验证的这个窗口本身是有状态、可一次性消费、有 TTL 的，避免「半认证」被当成「已认证」使用。"
    },
    {
      "type": "heading",
      "text": "会话撤销与安全中心",
    },
    {
      "type": "paragraph",
      "text": "用户可在安全中心（security_center.go）列出自己的会话、撤销单个会话、撤销「除当前外」的所有会话；管理员可列/删/批量撤销指定用户的会话。撤销单个用 `DeleteUserSessionByPublicID`，批量撤销走 `userService.RevokeSessions`（提升 session_version）再清理旧会话。所有撤销都记录审计事件（谁、对哪个会话、结果）。这是「会话保护」闭环的最后一环：不仅有创建和保持，还有可证明的、可审计的撤销。"
    },
    {
      "type": "heading",
      "text": "同源校验与安全响应头",
    },
    {
      "type": "paragraph",
      "text": "`validSameOriginRequest` 对带 `Origin` 的请求，比较解析后的 scheme 与 host 是否与 issuer 一致（大小写不敏感），不一致即拒绝；`securityHeadersMiddleware` 设置了 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`、`X-Frame-Options: DENY`、`Permissions-Policy`。这些是纵深防御的一部分：Referrer 策略能减少令牌/敏感 URL 经 Referer 泄露，iframe 限制降低点击劫持。"
    },
    {
      "type": "exercise",
      "title": "设计一个证明 CSRF 被拒绝的测试",
      "description": "针对 Nyauth 的某个状态变更接口（例如修改会话或安全设置），设计一个自动化测试：先正常登录拿到 Cookie 与 CSRF Token；再模拟一个「跨站请求」只带 Cookie、不带/带错的 X-CSRF-Token。写出你期望的状态码、响应体、以及 `RecordCSRFReject` 里对应的拒绝原因，并说明为什么用真实 HTTP 测试而不是只测中间件逻辑。",
      "hint": "分别覆盖三种分支：missing_session、missing_token、mismatch。同时写一个「带正确 token 成功」的对照用例，证明不是所有请求都被拦。"
    },
    {
      "type": "quiz",
      "question": "HttpOnly Cookie 能阻止 XSS 攻击本身吗？",
      "options": [
        "能，HttpOnly 会拦截恶意脚本执行",
        "能，HttpOnly 会让脚本解析失败",
        "不能，HttpOnly 只阻止脚本读取 Cookie 值，XSS 仍需靠输出编码/CSP 等防护",
        "不能，HttpOnly 反而加剧 XSS"
      ],
      "answer": 2,
      "explanation": "HttpOnly 仅阻止 JS 访问 Cookie 值；它不阻止恶意脚本注入和执行。防 XSS 要靠在注入点做输出编码、配 CSP 等内容安全机制。"
    },
    {
      "type": "quiz",
      "question": "设置了 SameSite=Lax 之后，为什么通常仍需要 CSRF Token？",
      "options": [
        "因为 CSRF Token 比 SameSite 更快",
        "因为 SameSite 是浏览器启发式行为，Lax 对部分跨站顶层导航仍放行，且把安全建立在服务端可验证的 token 上更可靠",
        "因为 CSRF Token 可以替代 HTTPS",
        "因为 SameSite 只影响 GET 请求"
      ],
      "answer": 1,
      "explanation": "SameSite 依赖浏览器按站点识别请求且并非在所有跨站场景都拦截（Lax 放行部分顶层导航）；CSRF Token 由服务端显式校验，把状态变更的授权建立在服务端可控的证明上。"
    },
    {
      "type": "keypoints",
      "items": [
        "HttpOnly 防脚本读 Cookie，不防 XSS 本身；XSS 需输出编码 + CSP",
        "Secure 让 Cookie 只在 HTTPS 发送；SameSite=Lax 限制跨站自动携带",
        "CSRF 防跨站伪造状态变更；CORS 管跨源响应读取——两者不同，不能互相替代",
        "会话生命周期：绝对过期 / 空闲过期 / 近期重认证期限，最严者生效",
        "auth_version（认证失效）与 session_version（会话撤销）是两代失效语义，请求时逐请求比对",
        "MFA pending 用独立 nyauth_mfa_pending Cookie + 临时 CSRF，半认证不可当已认证",
        "安全中心提供可审计的会话列出/撤销；撤销是会话保护闭环的一环",
        "同源校验与安全响应头是纵深防御的一部分"
      ]
    }
  ]
};
