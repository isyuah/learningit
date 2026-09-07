/* ==================================================================
 * 课时：OAuth 角色与授权方式总览（nyauth-oauth-roles-grants）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 事实基线：E:\Proj\nya\docs\learning\03-oauth-oidc.md、
 * 00-project-overview.md 与 internal/auth/handler.go。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-oauth-roles-grants",
  "courseSlug": "nyauth-backend",
  "title": "OAuth 角色与授权方式总览",
  "summary": "用五个角色理解 OAuth 解决的核心问题——委托访问而不交出密码，并认清四种授权方式的取舍。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "你写过数据库和 HTTP 服务，但要真正读懂 Nyauth，得先把 OAuth 的思维模型建起来。OAuth 2.0 解决的核心问题，用一句话说就是：让第三方应用代表用户访问某类资源，却不必让这个应用拿到用户的密码。这就是「委托访问」（delegated access）。你登录时把权限「借」给了一个应用，而不是把账号「给」了它。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "这是本课程的认知起点",
      "body": "很多人以为 OAuth 就是「登录」。不对——OAuth 只解决\"客户端能否代表用户访问资源\"这一件事（delegation）。身份确认（identity）是 OIDC 在 OAuth 之上额外加的一层：Access Token 面向资源服务器/API，ID Token 才面向客户端表达一次登录结果。后面的课会反复用到这个区分。"
    },
    {
      "type": "heading",
      "text": "五个角色"
    },
    {
      "type": "paragraph",
      "text": "RFC 6749 把参与方抽象成五个角色。Nyauth 是其中的「授权服务器」，但一个完整系统里五方都出现。逐个建立定义，并记住 Nyauth 里每方的具体例子。"
    },
    {
      "type": "definition",
      "term": "Resource Owner（资源所有者）",
      "definition": "拥有被访问资源的实体，通常是用户本人。在 Nyauth 里就是那个登录、同意授权、决定「让不让你这个应用访问我」的人。他是授权的最终决策者。"
    },
    {
      "type": "definition",
      "term": "User Agent（用户代理）",
      "definition": "承载用户与服务器交互的浏览器。OAuth 时序里 /authorize、login、consent、redirect 都发生在浏览器里；redirect_uri 就是把授权码带回客户端的「运输通道」。"
    },
    {
      "type": "definition",
      "term": "Client（客户端）",
      "definition": "代表用户提出访问请求的应用。在 Nyauth 里就是测试应用或用户创建的应用。它申请 scope、接收授权码或令牌，是 OAuth 协议的直接对端。"
    },
    {
      "type": "definition",
      "term": "Authorization Server（授权服务器）",
      "definition": "验证用户身份、保存授权决定、签发和撤销令牌的一方。Nyauth 就是这个角色（同时承担部分 UserInfo/OIDC 职责）。它负责 /authorize 与 /token 两个核心端点。"
    },
    {
      "type": "definition",
      "term": "Resource Server（资源服务器）",
      "definition": "持有并保护实际资源的一方，负责验证 Access Token 并决定是否放行。Nyauth 自己的 UserInfo 端点也是一个 Resource Server 式接口；未来接入的业务 API 也是 Resource Server。"
    },
    {
      "type": "heading",
      "text": "四种常见授权方式（Grant）"
    },
    {
      "type": "paragraph",
      "text": "「授权方式」规定了客户端如何换取令牌。Nyauth 的 Discovery 文档（内部 `Handler.Routes`/`Discovery`，见 internal/auth/handler.go）明确声明支持的 grant 是：`authorization_code`、`device_code`、`client_credentials`、`refresh_token`。注意其中 `response_types_supported` 只有 `code`——implicit 流在这里根本不允许。"
    },
    {
      "type": "table",
      "caption": "四种授权方式：作用与适用场景",
      "headers": ["授权方式", "核心用途", "什么时候用", "Nyauth 的立场"],
      "rows": [
        ["Authorization Code + PKCE", "第三方应用代表用户访问资源，且有浏览器可交互", "Web、SPA、移动 App——几乎一切面向用户的应用", "强制使用，且强制 S256；不支持 plain/implicit/hybrid"],
        ["Client Credentials", "应用以自己的身份（而非用户身份）访问资源", "服务端到服务端、机器到机器（无用户在场景）", "支持；按 client 的 grant 白名单放行"],
        ["Device Authorization", "输入受限设备（电视、CLI）让用户到另一台设备确认", "设备无法方便输入用户名密码，但有浏览器可确认", "支持（RFC 8628），用 device_code 轮询换取令牌"],
        ["Refresh Token", "用已有的长期授权换取新的访问令牌", "用户在离线/离开后应用仍需继续访问", "仅当用户批准 offline_access scope 时才签发"],
        ["Implicit（隐式）", "（历史遗留）直接在重定向里给 access_token", "几乎不再使用，有安全性缺陷", "不支持——response_types 只有 code"]
      ]
    },
    {
      "type": "paragraph",
      "text": "这张表里有一条贯穿始终的判断标准：**有没有一个可交互的浏览器**。有 → 走 Authorization Code；没有用户、只有服务 → Client Credentials；设备不便输入但用户有别的浏览器 → Device Authorization；用户在很早就授权过、之后想续期 → Refresh。implicit 被 RFC 9700 视为过时，Nyauth 直接不支持。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "离线访问不是默认能力",
      "body": "`offline_access` 是一个敏感 scope：客户端请求它不代表就能拿到 Refresh Token。Nyauth 在 /authorize 与 /device_authorization 两处都检查：请求了 `offline_access` 的客户端，必须同时已经被授予 `refresh_token` 这个 grant，且该 scope 还要在同意界面里被用户批准（通常是可选 scope）。「能拿 Refresh」是三重条件：客户端有该 grant + 请求了该 scope + 用户批准了它。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "OAuth ≠ 登录，OIDC 才是登录",
      "body": "区分两个概念能避免大量面试失误。OAuth 是「授权/委托」：我的资源可以给这个应用用。OIDC 是「身份」：这个正在登录的人到底是谁。只有请求了 `openid` scope 的流程才是 OIDC 登录流程，才会拿到 ID Token。没有 `openid` 的普通 OAuth 授权，不应当被当作「登录协议」来用——Nyauth 的文档里特意强调这一点。"
    },
    {
      "type": "heading",
      "text": "Nyauth 的协议立场"
    },
    {
      "type": "list",
      "items": [
        "只能 Authorization Code + S256 PKCE 完成浏览器交互式授权，没有 plain、没有 implicit、没有 hybrid",
        "客户端可授予的 grant 由管理员配置（Grants 白名单），`unauthorized_client` 拒绝未授权的 grant",
        "Client Credentials 用于机器间；Device Authorization 用于输入受限设备",
        "Refresh Token 只在 `offline_access` 被批准且客户端具备 `refresh_token` grant 时才签发",
        "Discovery 的 token 端点认证方式支持 `client_secret_basic`、`client_secret_post`，公开客户端可 `none`"
      ]
    },
    {
      "type": "quiz",
      "question": "Nyauth 支持下列哪种浏览器交互式授权方式？",
      "options": [
        "Implicit Flow（响应类型为 token）",
        "Authorization Code + S256 PKCE",
        "Authorization Code + plain PKCE",
        "Hybrid Flow（code id_token）"
      ],
      "answer": 1,
      "explanation": "Nyauth 的 Discovery 声明 response_types_supported 只有 code，code_challenge_methods_supported 只有 S256；在 Authorize 中直接拒绝非 S256 或 implicit/hybrid。"
    },
    {
      "type": "exercise",
      "title": "为一个业务场景选授权方式",
      "description": "为下面三种场景分别挑选最合适的授权方式，并说明为什么：① 一个 Angular SPA 让用户用 Nyauth 登录后调用它的后端 API；② 一个每晚定时任务 API 需要读取公共报表数据；③ 一台智能电视显示用户相册，用户需要用手机浏览器确认。",
      "hint": "判断依据是「有没有可交互浏览器」和「代表谁」。SPA 是代表用户的浏览器场景→Code+PKCE；定时任务无用户→Client Credentials；电视不便输入→Device Authorization。"
    },
    {
      "type": "keypoints",
      "items": [
        "OAuth 解决委托访问：让应用代表用户访问资源，而不交出密码",
        "五角色：Resource Owner、User Agent、Client、Authorization Server、Resource Server",
        "Access Token 给资源服务器；ID Token 给客户端做身份；openid 是触发 OIDC 的 scope",
        "常见 grant：Code(强制+S256)、Client Credentials、Device、Refresh；implicit 已过时且不被支持",
        "离线访问需 client 有 refresh grant + 请求 offline_access + 用户批准",
        "选授权方式的抓手是「有没有可交互的浏览器」与「代表谁」"
      ]
    }
  ]
};
