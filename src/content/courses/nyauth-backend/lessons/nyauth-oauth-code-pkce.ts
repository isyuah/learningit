/* ==================================================================
 * 课时：Authorization Code + PKCE 时序（nyauth-oauth-code-pkce）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 事实基线：03-oauth-oidc.md、internal/auth/handler.go（Authorize/Token）、
 * internal/auth/pkce.go、internal/session/store.go（ConsumeAuthorizationCodeIfMatch）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-oauth-code-pkce",
  "courseSlug": "nyauth-backend",
  "title": "Authorization Code + PKCE 时序",
  "summary": "从 verifier 到 /token 兑换，逐帧追踪完整的授权码 + PKCE 流程，并把每一步绑定在防什么攻击上。",
  "minutes": 24,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "上一课我们把 OAuth 的核心问题定为「委托访问」。这一课进入真正被执行的协议：**Authorization Code + PKCE**——Nyauth 唯一支持的浏览器交互式授权方式。你将看到一条请求链：Client 生成秘钥 → 浏览器走 /authorize → 登录与同意 → 重定向回带 code、state 的地址 → 客户端到 /token 换令牌。看懂这条链、以及每一环在防什么攻击，是面试与排查问题的关键。"
    },
    {
      "type": "heading",
      "text": "第 0 步：生成 verifier 与 challenge"
    },
    {
      "type": "paragraph",
      "text": "在发任何请求之前，客户端先生成一对秘钥。`code_verifier` 是 43–128 字符的随机串（只含大写小写、数字、`-` `.` `_` `~`）；然后客户端对 verifier 做 **S256 变换** 得到 `code_challenge`：先 SHA-256，再做 base64url（URL 安全）编码。关键设计是：challenge 是不可逆的——从 challenge 无法反推出 verifier，所以挑战值可以安全地放在 /authorize 的参数里交给服务器，而真正的 verifier 必须保密。"
    },
    {
      "type": "code",
      "title": "生成 PKCE 秘钥对（概念性 Go 描述）",
      "language": "go",
      "code": "// verifier：43-128 字符的随机串，客户端自己保管，绝不外发\ntype pkcePair struct{ verifier, challenge string }\n\nfunc newPKCE(rand io.Reader) (pkcePair, error) {\n    b := make([]byte, 32)\n    if _, err := io.ReadFull(rand, b); err != nil {\n        return pkcePair{}, err\n    }\n    verifier := base64.RawURLEncoding.EncodeToString(b) // 43 个字符\n\n    sum := sha256.Sum256([]byte(verifier))\n    challenge := base64.RawURLEncoding.EncodeToString(sum[:]) // 仍为 43 个字符\n    return pkcePair{verifier: verifier, challenge: challenge}, nil\n}"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "challenge 为什么不能反推 verifier",
      "body": "S256 走的是 SHA-256 + base64url，这是一个单向变换。服务器只保存 challenge，未来用你交上来的 verifier 重算一次 SHA-256，再比对是否等于当初的 challenge。即便服务器或传输被截获，攻击者也拿不到 verifier。这正是 PKCE 阻止「授权码被他人截获后窃用」的基础。Nyauth 的 pkce.go 用 `subtle.ConstantTimeCompare` 做常数时间比较，避免时序泄露。"
    },
    {
      "type": "heading",
      "text": "第 1–3 步：/authorize、登录与同意"
    },
    {
      "type": "paragraph",
      "text": "浏览器带上 `client_id`、`redirect_uri`、`response_type=code`、`scope`、`state`、`code_challenge`、`code_challenge_method=S256`，必要时还有 `nonce`，访问 `/authorize`。Nyauth 的 `Authorize`（internal/auth/handler.go）先做一系列校验：client 存在、redirect_uri 是**已登记精确值**、response_type 必须是 code、client 具备 authorization_code grant、scope 在 client 允许集之内、challenge 是合法 S256。然后检查用户登录状态与认证新鲜度，展示 Consent（同意界面），用户接受后生成一次性 authorization code，并把浏览器重定向回 `redirect_uri?code=...&state=...`。"
    },
    {
      "type": "list",
      "ordered": true,
      "items": [
        "客户端生成 verifier → S256 得到 challenge（verifier 自己保密）",
        "浏览器带上 code_challenge 等参数访问 /authorize",
        "Nyauth 校验 client、redirect_uri、response_type、scope、S256 challenge、state、nonce、acr/max_age",
        "未登录则跳登录页；已登录则核对认证等级与新鲜度，必要时要求重新认证",
        "展示 Consent，用户接受/拒绝；接受则生成一次性 code 并存下全套上下文",
        "浏览器重定向回 redirect_uri，带上 code 与 state",
        "客户端用 code + verifier + redirect_uri 到 /token 兑换",
        "Nyauth 校验并原子消费 code，比对 verifier，签发 Access/ID/Refresh Token"
      ]
    },
    {
      "type": "heading",
      "text": "第 4 步：在 /token 兑换"
    },
    {
      "type": "paragraph",
      "text": "客户端拿到 code 后，把 `code`、`code_verifier`、`redirect_uri` 作为 grant_type=authorization_code 的表单 POST 到 /token。`Token` 端点（handler.go）取出当初保存的 AuthorizationData，逐项比对：code 与 client 匹配、redirect_uri 与当初登记并保存的一致、client 仍具备该 grant、且 `validatePKCE(verifier, stored.CodeChallenge, \"S256\")` 通过。然后通过 `ConsumeAuthorizationCodeIfMatch` 在 Redis 里**原子消费** code——这一步同时完成「只能用一次」和「reuse 检测」。全部通过后签发一组 Access/ID/Refresh Token。"
    },
    {
      "type": "paragraph",
      "text": "注意：/token 校验 code 时，Nyauth 会把 code 用过的状态与「从未存在」区分开：`GetAuthorizationCode` 若命中已消费的 code 会返回 `ErrAuthorizationCodeReuse`。重用一张 code 会被当作可疑行为处理（`rejectAuthorizationCodeReuse`），而不是安静地再发一张新令牌。"
    },
    {
      "type": "heading",
      "text": "每个绑定在防什么攻击"
    },
    {
      "type": "table",
      "caption": "参数 → 作用 → 在 repo 里哪里校验/防什么",
      "headers": ["参数", "作用", "防什么攻击"],
      "rows": [
        ["redirect_uri（在 authorize 精确匹配、在 token 比对已存值）", "把 code 送回预登记的精确地址", "防止授权码注入：攻击者想办法让它回环到自己的伪造回调地址"],
        ["Authorization Code 单次使用（ConsumeAuthorizationCodeIfMatch）", "code 只能换一次令牌", "防止重放（replay）：偷到 code 的人重放一次就被识别"],
        ["code_verifier 匹配当初的 S256 challenge", "证明兑换者持有当初生成 challenge 的 verifier", "防授权码被截获后窃用（code interception）：没 verifier 换不到令牌"],
        ["state", "把授权响应路由回发起这次请求的那个客户端实例", "防 CSRF/串线：攻击者诱导合法客户端用他伪造的响应"],
        ["nonce", "把这次 OIDC 登录请求绑定到返回的 ID Token", "防 ID Token 重放与登录态串线（绑定到本次登录上下文）"],
        ["client_id 与 redirect_uri 绑定", "授权码只能被创建它的客户端消费", "防 code 被其它 client 冒领（client 泛化）"]
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "别把 state 当家当，也别把 nonce 当 CSRF Token",
      "body": "`state` 用来把 OAuth 响应路由回正确的客户端实例，属于「请求/响应上下文绑定」；`nonce` 用来把 OIDC 登录请求绑定到 ID Token。两者都不是身份凭证，也不能互相当 CSRF token 用——Nyauth 的文档明确告诫：它们绑定的是不同的协议上下文。混淆它们是把协议细节记串的常见根源。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "为什么强制 S256、拒绝 plain",
      "body": "`plain` 方法是把 verifier 明文直接当 challenge 传给服务器，等于把秘密交出去，失去 PKCE 的意义。Nyauth 在 `Authorize` 里直接要求 `code_challenge_method == \"S256\"` 且 challenge 长度合法，在 `validatePKCE` 里也只接受 S256。对 SPA、移动端这种无法保守 client_secret 的场景，S256 是唯一可用的防线。"
    },
    {
      "type": "quiz",
      "question": "PKCE 的 S256 code_challenge 主要用来防住哪种攻击？",
      "options": [
        "授权码被攻击者截获后，因为没有 code_verifier 而无法兑换成令牌",
        "防止用户把密码泄露给第三方",
        "防止 Access Token 本身的签名被伪造",
        "防止 Refresh Token 被轮换"
      ],
      "answer": 0,
      "explanation": "即使攻击者拦截了重定向里的授权码，由于它没有当初的 code_verifier，/token 的 validatePKCE 比对会失败，换不到令牌。这就是 PKCE 的核心价值（code interception）。"
    },
    {
      "type": "exercise",
      "title": "掐断一根线，看整个流程崩在哪",
      "description": "逐项改动并判断流程会在哪一步失败：① 把 redirect_uri 从登记值改成 http://evil.example/cb；② 重定向回来的 state 与客户端自己存的 state 不相同；③ 在 /token 提交时故意传错 code_verifier；④ 把同一个 code 提交两次。对每一项说明失败节点与报错方向。",
      "hint": "①在 /authorize 就被拒绝（HasRedirectURI 精确匹配）；②在客户端回调侧被掐掉；③在 /token 的 validatePKCE 返回 invalid_grant；④第二次会命中 reuse，触发 rejectAuthorizationCodeReuse 而非再次发令牌。"
    },
    {
      "type": "keypoints",
      "items": [
        "PKCE：客户端生成 verifier（机密）→ S256 单向得到 challenge；challenge 不可逆",
        "Nyauth 只接受 code_challenge_method=S256，拒绝 plain/implicit/hybrid",
        "redirect_uri 必须精确匹配登记值，code 只回送到这个地址",
        "Authorization Code 单次使用，配合 Redis 原子消费与 reuse 检测",
        "code_verifier 匹配当初 challenge，防授权码被截获后窃用",
        "state 绑定客户端请求上下文；nonce 绑定 OIDC 登录到 ID Token",
        "OIDC client 必须验证 ID Token 的签名、issuer、audience、时间与 nonce"
      ]
    }
  ]
};
