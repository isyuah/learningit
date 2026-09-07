/* ==================================================================
 * 课时：OIDC：ID Token、Discovery 与 UserInfo（nyauth-oidc-id-token）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-oidc-id-token",
  "courseSlug": "nyauth-backend",
  "title": "OIDC：ID Token、Discovery 与 UserInfo",
  "summary": "OAuth 只授权「能不能访问资源」；OIDC 在这里加上了「用户到底是谁」。",
  "minutes": 22,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "上一章我们熟悉了 OAuth 2.0 的角色、授权码与 PKCE：客户端获得 Access Token，用来代表用户访问资源。但这里有一个明显的空缺——OAuth 从头到尾都没有说清「这个用户是谁」。OAuth 的令牌承载的是「授权」，而不是「身份」。OIDC（OpenID Connect）就是在 OAuth 之上补上这一层的：它让客户端确认正在登录的人到底是谁，以及这次登录是一次什么样的认证事件。"
    },
    {
      "type": "heading",
      "text": "OAuth 与 OIDC 的分工"
    },
    {
      "type": "paragraph",
      "text": "一句话区分：OAuth 回答「客户端能否代表用户访问某些资源」，OIDC 回答「客户端如何确认用户身份」以及在什么条件下认证发生的。OIDC 不是取代 OAuth，而是叠加在 Authorization Code 流程之上：它复用同一个授权端点、令牌端点，只是额外引入 `openid` 这个触发 scope、签名的 ID Token、UserInfo 端点和 Discovery 元数据。在 Nyauth 的代码里，UserInfo 处理器依然用 `ValidateAccessToken` 校验你带来的 Access Token（`internal/auth/handler.go` 的 `UserInfo`），说明 OIDC 的身份层仍建立在 OAuth 的授权之上。"
    },
    {
      "type": "definition",
      "term": "ID Token",
      "definition": "由授权服务器签名的 JWT，代表「一次认证事件的结果」。它面向客户端（Client）而非 Resource Server：表达「这个用户确实在某个时间用某方式完成了认证」。它是 OIDC 登录流程的最终产物。"
    },
    {
      "type": "definition",
      "term": "UserInfo 端点",
      "definition": "受 Access Token 保护的 HTTP 接口（通常是 `/userinfo`），客户端用它获取关于用户的标准声明（sub、name、email、picture 等）。它不是凭据本身，而是「用 Access Token 换取用户资料」的接口。"
    },
    {
      "type": "definition",
      "term": "nonce",
      "definition": "客户端在授权请求时生成的随机值，随 `openid` scope 一并发送，并在签名的 ID Token 中原样返回。它把「这次 ID Token」绑定到「客户端发起的这一次登录请求」，防止重放与登录请求串线。"
    },
    {
      "type": "paragraph",
      "text": "`openid` 是 OIDC 的触发 scope。没有它，这个流程就只是普通 OAuth，不应该被当成登录协议——即使你收到了一个令牌，也缺少确认用户身份的关键语义。所以在 Nyauth 的 OAuth 设置里，客户端要启用 OIDC，就必须在申请的 scope 里包含 `openid`。这也是学习时最容易忽略、却决定「这是登录还是只是授权」的分界。"
    },
    {
      "type": "heading",
      "text": "Discovery：让客户端自己找到一切"
    },
    {
      "type": "paragraph",
      "text": "OIDC 的一个设计目标，是客户端不需要把每个端点的 URL 硬编码进配置文件。它实现方式是在一个固定位置发布「发现文档」(Discovery Document)。客户端的 SDK 只要知道 issuer（例如 `https://auth.example.com`），就能访问 `/.well-known/openid-configuration`，一次性读出该服务器的所有端点、支持的算法、scope 和授权方式。"
    },
    {
      "type": "code",
      "title": "Discovery 流程：客户端如何自动发现端点",
      "language": "text",
      "code": "Client 只知道 issuer\n        |\n        v\nGET  {issuer}/.well-known/openid-configuration\n        |  返回 JSON，例如：\n        |    authorization_endpoint : {issuer}/authorize\n        |    token_endpoint        : {issuer}/token\n        |    userinfo_endpoint     : {issuer}/userinfo\n        |    jwks_uri              : {issuer}/.well-known/jwks.json\n        |    revocation_endpoint   : {issuer}/revoke\n        |    introspection_endpoint: {issuer}/introspect\n        |    id_token_signing_alg_values_supported: [\"RS256\"]\n        |    code_challenge_methods_supported     : [\"S256\"]\n        |\n        v\nClient 据此发起授权、交换令牌、验证签名、读取用户资料"
    },
    {
      "type": "paragraph",
      "text": "Nyauth 的 `Discovery` 处理器（`internal/auth/handler.go`）从配置里的 issuer 拼出各个端点，并通过 `id_token_signing_alg_values_supported`（这里只有 `RS256`）和 `code_challenge_methods_supported`（只有 `S256`）向客户端宣告自己支持的能力。注意它只做静态描述，认证和签发都在其它端点完成。Discovery 的价值是：当新增端点或升级算法时，客户端无需改配置就能随之演进。"
    },
    {
      "type": "table",
      "caption": "OIDC 关键端点及其用途",
      "headers": ["端点", "用途"],
      "rows": [
        ["/.well-known/openid-configuration", "发现文档：发布 issuer、各端点 URL、支持的算法/scope/授权方式"],
        ["/.well-known/jwks.json", "JWKS：公开用于验证 ID Token / Access Token 签名的公钥（按 kid 索引）"],
        ["/authorize", "授权端点：用户登录/同意，返回授权码（连同 state、nonce）"],
        ["/token", "令牌端点：用授权码 + PKCE verifier 换 Access/ID/Refresh Token"],
        ["/userinfo", "UserInfo：用 Access Token 换取用户标准声明"],
        ["/revoke", "撤销 Refresh Token（RFC 7009）"],
        ["/introspect", "令牌内省：获取令牌的实时本地状态（RFC 7662）"]
      ]
    },
    {
      "type": "heading",
      "text": "UserInfo：用 Access Token 换取用户身份声明"
    },
    {
      "type": "paragraph",
      "text": "ID Token 在签发那一刻就固定了其中的身份声明，一旦过期就无法再更新。而 UserInfo 端点允许客户端在需要时，用当前有效的 Access Token 去拉取最新、完整的用户资料（受 scope 与声明策略裁切）。在 Nyauth 的实现里，`UserInfo` 处理器先校验 Access Token（`ValidateAccessToken`），再按 scope 允许的声明集合返回用户字段，始终包含 `sub`（用户的稳定标识）。这正是「Access Token 面向资源/API」的又一体现：UserInfo 端点是面向客户端提供的、受 Access Token 保护的一个资源。"
    },
    {
      "type": "paragraph",
      "text": "顺带说明 roles：凡是「把某令牌当作 API 访问凭据」的请求，都应该用 Access Token，而不是 ID Token。ID Token 是给客户端看「这人是谁」的登录凭据，其承载的声明（aud 是客户端、含 nonce）是为客户端会话设计的，拿去当 API bearer 既越权又混乱。下一课会专门对比这三类令牌。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "OIDC 集成必须校验 nonce",
      "body": "客户端在发起 OIDC 登录时生成一个不可预测的 nonce，并把「发送的 nonce」记下来；拿到 ID Token 后，必须校验里面的 nonce 与当时发送的一致（同时校验签名、issuer、audience 和时间）。缺少 nonce 校验，攻击者可能把一次登录事件的结果重放或串台到你的会话里。注意：nonce 不是 CSRF Token，别把两者混为一谈——nonce 绑定的是「这个 ID Token 对应的这次认证请求」。"
    },
    {
      "type": "heading",
      "text": "为什么 ID Token 不能当 API Access Token"
    },
    {
      "type": "list",
      "items": [
        "受众不同：ID Token 的 aud 是客户端自身；Resource Server 不会把自己列为 ID Token 的受众，不该接受它",
        "语义不同：ID Token 表达「一次认证事件」，不表达「对某资源/某 scope 的授权」",
        "缺少授权信息：ID Token 通常不含随 scope 变化的资源授权声明；Resource Server 需要的是 Access Token 的 scope 语义",
        "生命周期与撤销不同：Access Token 配套服务端元数据支持撤销与策略检查；把 ID Token 当长期 API 凭据会失去这些保障",
        "职责边界：让 API 接受 ID Token，等于把「身份确认」和「授权判定」混在一起，安全语义被破坏"
      ]
    },
    {
      "type": "callout",
      "variant": "example",
      "title": "一个典型 OIDC 登录时序（你已熟悉的授权码 + PKCE 上叠加 OIDC）",
      "body": "客户端生成 state 与 nonce，携带 `scope=openid ...`、PKCE challenge 跳转 `/authorize` → 用户登录并同意 → 回调带着 code 与 state → 客户端用 code + verifier 调 `/token` → 拿到 Access Token（与 ID Token、必要时 Refresh Token）→ 客户端本地校验并验证 ID Token 的 nonce → 登录完成。之后可再调 `/userinfo` 用 Access Token 拉取用户资料。整个 OIDC 身份层就是在你熟悉的授权码流程之上加了几样东西：`openid` scope、ID Token 与 nonce 校验、Discovery 与 UserInfo。"
    },
    {
      "type": "quiz",
      "question": "关于 OIDC 与 OAuth 的关系，下列哪一项正确？",
      "options": [
        "OIDC 取代了 OAuth 2.0，客户端不再需要 Access Token",
        "OIDC 在 OAuth 之上叠加身份层：确认「用户是谁」，仍依赖 Access Token 表示授权",
        "只要请求了 OAuth，就一定自动获得了 OIDC 身份确认能力",
        "ID Token 与 Access Token 完全等价，可以互换使用"
      ],
      "answer": 1,
      "explanation": "OIDC 叠加在授权码流程之上：`openid` scope 触发身份层，ID Token 确认身份，Access Token 仍表示授权（例如 UserInfo 端点就用 Access Token 换取用户资料）。不请求 `openid` 就只是普通 OAuth。"
    },
    {
      "type": "keypoints",
      "items": [
        "OAuth 管授权，OIDC 管身份：确认「用户是谁」",
        "openid scope 是 OIDC 的触发器，没有它就不是登录协议",
        "ID Token = 签名的 JWT，代表一次认证事件，面向客户端",
        "Discovery（/.well-known/openid-configuration）让客户端自动发现端点与能力",
        "JWKS（/.well-known/jwks.json）按 kid 发布验证签名所需的公钥",
        "UserInfo 端点是受 Access Token 保护的用户资料接口",
        "OIDC 集成必须校验 nonce，把 ID Token 绑定到本次登录请求"
      ]
    }
  ]
};
