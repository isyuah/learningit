/* ==================================================================
 * 课时：中间件顺序与请求生命周期（nyauth-http-lifecycle-middleware）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与文件名一致。
 * 内容块类型见 ../../../types.ts。
 * 本课面向已掌握 HTTP 与数据库基础的学习者，重点讲 Nyauth 里
 * 「请求如何在 HTTP 层穿过中间件、落到 handler/service/store」。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-http-lifecycle-middleware",
  "courseSlug": "nyauth-backend",
  "title": "中间件顺序与请求生命周期",
  "summary": "中间件不是「装饰器堆叠」，顺序本身就是安全与正确性的一部分。本课拆解 buildRouter 的中间件链，以及请求范围如何自顶向下流动。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "你可能已经写过不少中间件：打日志、加 CORS、限流……它们单独看都不难。但 Nyauth 这类认证服务真正的难点在于：中间件的「顺序」本身就是一个安全边界。HTTP 请求从进入 `buildRouter` 的 chi 路由开始，会被一层层函数包住，每一层既能「先做点事，再把请求交给下一层」，也能在返回的路上把响应包装一下。这一课我们只盯一件事：请求到底按什么顺序穿过这些层，以及为什么这个顺序不能随意调换。"
    },
    {
      "type": "heading",
      "text": "先记住这条中间件链"
    },
    {
      "type": "paragraph",
      "text": "在 `internal/server/server.go` 的 `buildRouter` 里，Nyauth 用 `r.Use(...)` 依次挂上了全局中间件。以下是实际代码里出现的精确顺序（新增能力 gate 之类属于路由组内的局部中间件，先放一放）："
    },
    {
      "type": "code",
      "title": "buildRouter 中的全局中间件顺序",
      "language": "text",
      "code": "r.Use(middleware.RequestID)          // ① 请求 ID（贯穿日志/追踪）\nr.Use(securityHeadersMiddleware)   // ② 安全响应头\nr.Use(s.clientIPMiddleware)        // ③ 客户端 IP / 可信代理\nr.Use(s.telemetry.HTTPMiddleware)  // ④ 遥测\nr.Use(redactedRequestLogger)       // ⑤ 脱敏日志\nr.Use(structuredRecoverer)         // ⑥ panic 恢复\nr.Use(timeoutExcept(30*time.Second, ...)) // ⑦ 超时（部分 SSE 路径豁免）\nr.Use(cors.Handler(...))           // ⑧ CORS\n// 之后是具体路由，路由组内再按需挂 auth / CSRF / capability gate"
    },
    {
      "type": "paragraph",
      "text": "chi 的中间件是「洋葱模型」：请求先进入第 ① 层，第 ① 层调用第 ② 层，……一路到真正的 handler；handler 返回后，响应再逆序穿过每一层（由各层决定是否在返回路上加工）。所以越靠前的中间件，包住的范围越大——它能看到并影响后续所有层的行为。"
    },
    {
      "type": "subheading",
      "text": "为什么顺序就是正确性"
    },
    {
      "type": "list",
      "items": [
        "客户端 IP 解析放得很靠前：`clientIPMiddleware` 用 `trustedProxies` 判断哪些上游可信，再决定是否采信 `X-Forwarded-For` / `X-Real-IP`。如果限流、登录审计跑在它之前，它们读到的可能是可伪造的 IP。",
        "Request ID 在最外层：唯一下游所有层（日志、遥测、错误、审计）都能引用的请求标识必须最先建立，否则后半段无法关联到同一请求。",
        "panic 恢复要在 timeout 之外（先于 timeout 挂载）：恢复器负责把 panic 转成 500 并记日志，若放在 timeout 之后，超时杀掉 goroutine 的路径可能绕开恢复逻辑。",
        "CORS 靠后：它只管「跨源响应头」，不需要也不应该先于日志/超时执行，放在后面反而保证这些基础设施层对所有请求一致生效。",
        "logout/改密这类安全操作不能被太靠前的中间件误伤，所以能力 gate、必须改密检查放在路由组内而非全局。"
      ]
    },
    {
      "type": "table",
      "caption": "调换中间件顺序的后果",
      "headers": ["如果改成……", "会出什么问题"],
      "rows": [
        ["客户端 IP 解析放到限流之后", "限流按可信代理伪造的 IP 计数，攻击者可以绕过限流、抹掉审计归属"],
        ["把 timeout 从 30s 收到 2s", "正常 SSE 长连接和优雅排空被提前杀掉，`/notifications/events` 等长连接端点被迫豁免"],
        ["把 CSRF 挂到全局而非仅用户/管理写操作", "OAuth 回调、token 端点等公开协议端点也会被 CSRF 挡住，破坏协议兼容性"],
        ["把 RequestID 放到日志之后", "日志层级无法引用同一请求 ID，链路追踪与排错失去关联线索"]
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "顺序错误的典型案例：可信代理",
      "body": "没有配置可信代理时，`resolveClientIP` 直接返回 `RemoteAddr`（TCP 对端），不会采信 `X-Forwarded-For`。一旦有人把某个反向代理误加入可信列表，却不做 IP 白名单校验，攻击者就能伪造 `X-Forwarded-For` 头，把自己伪装成任意 IP。客户端 IP 是限流、登录失败计数、审计归属的关键键值——它错了，后面基于它的所有安全判断都跟着错。这与「在正确的中间件位置上解析」同样重要。"
    },
    {
      "type": "heading",
      "text": "handler → service → store 的分层"
    },
    {
      "type": "paragraph",
      "text": "中间件后面是 handler，但它不该是一大坨逻辑。Nyauth 的分层是：handler 只做「协议与输入边界」——解析 JSON、读取上下文里的当前用户、调用 service、把业务结果翻译成 HTTP 状态码；service 承载「业务规则」；store 管「PostgreSQL / Redis 的原子状态」。中间件解析出的 `currentUserFromContext(r)` 和 `sessionFromContext(r.Context())`，正是 handler 读取的输入来源。"
    },
    {
      "type": "code",
      "title": "handler 薄、service 厚、store 管状态",
      "language": "go",
      "code": "// handler（协议/输入边界）：只做编排，不碰 SQL\nfunc (s *Server) handleUpdateMe(w http.ResponseWriter, r *http.Request) {\n    current := currentUserFromContext(r) // 中间件放进去的当前用户\n    if current == nil {\n        writeAPIError(w, http.StatusUnauthorized, \"authentication required\")\n        return\n    }\n    var req struct {\n        DisplayName *string `json:\"display_name,omitempty\"`\n    }\n    if err := decodeJSON(w, r, &req); err != nil {\n        writeAPIError(w, http.StatusBadRequest, \"invalid request body\")\n        return\n    }\n    updated, err := s.userService.Update(r.Context(), current.ID,\n        models.UpdateUserRequest{DisplayName: req.DisplayName})\n    if err != nil {\n        writeAPIError(w, http.StatusBadRequest, \"invalid update\")\n        return\n    }\n    writeJSON(w, http.StatusOK, updated)\n}"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "为什么 handler 不直接访问 store",
      "body": "把业务规则留在 service 层，是让同一个 handler 面对「浏览器会话」和未来「机器对机器」调用时行为一致的关键。handler 只管把一个 `*models.User` 翻译成 JSON；校验、依赖关系、并发与原子性都在 service/store。面试时被问「数据库错误为什么不直接返回给用户」，答案就是：HTTP 层必须把底层错误转换成稳定、可行动、且不泄露内部信息的响应，而诊断上下文留在日志里。"
    },
    {
      "type": "heading",
      "text": "请求范围：context 从顶流到底"
    },
    {
      "type": "paragraph",
      "text": "一组中间件需要共享的数据，不是通过全局变量（会污染并发请求），而是通过 `context.Context` 自上而下传递。`clientIPMiddleware` 写入 `clientIPContextKey`，`userAuthMiddleware` 写入 `currentUserContextKey` 和会话对象，中间的 telemetry、日志、handler、service、store 全部可以从 `r.Context()` 里取。除此之外，`context` 还携带了超时与取消语义——这才是「一次请求的生命周期」真正所在。"
    },
    {
      "type": "code",
      "title": "Request ID + 超时中间件的典型形状",
      "language": "go",
      "code": "// Request ID：为每个请求生成/复用 ID，放进 context\nfunc RequestID(next http.Handler) http.Handler {\n    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n        id := r.Header.Get(\"X-Request-ID\")\n        if id == \"\" {\n            id = uuid.NewString()\n        }\n        w.Header().Set(\"X-Request-ID\", id)\n        next.ServeHTTP(w, r.WithContext(\n            context.WithValue(r.Context(), reqIDKey, id)))\n    })\n}\n\n// 超时：给请求一个 deadline，超时则中止下游（注意对特定端点豁免）\nfunc timeoutExcept(timeout time.Duration, excluded ...string) func(http.Handler) http.Handler {\n    excludedSet := map[string]struct{}{}\n    for _, p := range excluded {\n        excludedSet[p] = struct{}{}\n    }\n    return func(next http.Handler) http.Handler {\n        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n            if _, ok := excludedSet[r.URL.Path]; ok {\n                next.ServeHTTP(w, r) // 长连接/排空端点不套超时\n                return\n            }\n            withTimeout(chimiddleware.Timeout(timeout))(next).ServeHTTP(w, r)\n        })\n    }\n}"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "超时之后，数据库操作一定会停吗？",
      "body": "不一定。`context` 的 deadline 会被数据库驱动/`database/sql` 尊重，使用该 context 的查询会随超时被取消；但如果某处把 `context.Background()` 换掉了、或下游忽略了 context 取消，操作就不会被中止。这正是「为什么不能把 context 长期存在对象里」——它属于一次调用，脱离请求保存会污染取消语义。Nyauth 的实现正是用 `timeoutExcept(30 * time.Second, ...)` 这个带豁免名单的超时，保证常规 API 有 hard deadline，同时放行 SSE 长连接。"
    },
    {
      "type": "quiz",
      "question": "为什么在 Nyauth 中，`clientIPMiddleware` 必须排在基于 IP 的限流/审计之前？",
      "options": [
        "因为限流会先发请求，clientIPMiddleware 不跑就没人解析 IP",
        "因为客户端 IP 只有在可信代理配置正确时才能被信任；若限流先跑，它会基于可伪造的 X-Forwarded-For 计数，从而被绕过",
        "因为 clientIPMiddleware 会把 IP 存进响应头，限流需要先读到它",
        "因为两者之间没有关系，顺序无所谓"
      ],
      "answer": 1,
      "explanation": "客户端 IP 是限流、登录失败计数、审计归属的键值。若其在限流之后才解析，限流依据的是可能被伪造的对端/代理头，攻击者可借此绕过限流并污染审计。"
    },
    {
      "type": "exercise",
      "title": "手绘并追踪一次完整请求的生命周期",
      "description": "选「PUT /api/me（修改 display_name）」这条路径：(1) 写出它穿过的全局中间件层→用户路由组中间件（userAuthMiddleware → mutationAudit → requireCurrentPasswordChange → csrfMiddleware）→handler→service→store 的完整顺序；(2) 标出每层向 context 写入或读取了哪些请求范围数据；(3) 指出如果把它误挂到全局（而非仅用户组）会发生什么。",
      "hint": "对照 buildRouter：全局顺序是 RequestID→securityHeaders→clientIP→telemetry→redacted log→panic recovery→timeout→CORS；注意 PUT 是写操作，CSRF 必须能拿到会话中的 token 才能校验，所以 requirement 是要先有 session。"
    },
    {
      "type": "keypoints",
      "items": [
        "buildRouter 全局中间件顺序：RequestID→security headers→client IP/可信代理→telemetry→脱敏日志→panic 恢复→timeout→CORS",
        "中间件顺序就是正确性：IP 解析放错位置会破坏限流与审计，timeout 太短会误杀 SSE/排空",
        "CSRF 只应包住基于 Session Cookie 的写操作，不能包住 OAuth 回调等公开协议端点",
        "分层：handler(协议/输入边界) → service(业务规则) → store(PostgreSQL/Redis 原子状态)",
        "请求范围数据（RequestID、client IP、current user、session）经 context 自上而下流动，不可用全局变量承载",
        "context 携带 deadline/取消；超时是否真的中止数据库操作，取决于下游是否尊重 context 取消"
      ]
    }
  ]
};
