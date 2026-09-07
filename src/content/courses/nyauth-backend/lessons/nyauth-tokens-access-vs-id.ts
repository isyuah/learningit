/* ==================================================================
 * 课时：Access Token、ID Token 与 Refresh Token 有何不同
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-tokens-access-vs-id",
  "courseSlug": "nyauth-backend",
  "title": "Access Token、ID Token 与 Refresh Token 有何不同",
  "summary": "三种令牌各司其职：授权、身份、续期。搞清受众与生命周期，才能安全地使用它们。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "一次 OAuth/OIDC 登录下来，客户端常常会同时拿到三种文件长相类似的令牌：Access Token、ID Token，必要时还有 Refresh Token。它们是同一套授权码流程的不同产物，却有着完全不同的受众、用途与生命周期。把它们混为一谈——尤其是把 ID Token 当 API 的 Bearer——是安全问题的常客。这一课我们把三者放在一起看，建立一张清晰的对照图。"
    },
    {
      "type": "heading",
      "text": "一次下发，三种角色"
    },
    {
      "type": "table",
      "caption": "三种令牌的受众、用途与生命周期对比",
      "headers": ["维度", "Access Token", "ID Token", "Refresh Token"],
      "rows": [
        ["受众", "Resource Server / API", "客户端（OIDC 登录结果）", "授权服务器（客户端换取新 Access Token）"],
        ["表达什么", "授权：代表用户对某资源/scope 的访问资格", "身份：一次认证事件的确认结果", "长期凭据：用于签发新的 Access Token"],
        ["是否签名 JWT（Nyauth）", "是，RS256 + 服务端元数据", "是，RS256（携带 nonce、auth_version）", "否——是随机不透明字符串，仅存哈希"],
        ["生命周期", "短（分钟级，默认 TTL）", "与登录会话相关，短命", "长（Refresh TTL），支持轮换"],
        ["存储位置", "客户端内存/受控存储，随请求发送", "客户端本地，用于维持登录态", "服务端 Redis + family 索引；客户端只持有值"]
      ]
    },
    {
      "type": "paragraph",
      "text": "这张表里最值得记住的分界线是「受众与语义」：Access Token 回答「这个请求被授权访问什么」，ID Token 回答「这次登录的人是谁」，Refresh Token 则是一把「换取新 Access Token 的钥匙」。真正用来访问 API 的、Resource Server 会校验的，只有 Access Token。"
    },
    {
      "type": "heading",
      "text": "逐个看懂：Access Token"
    },
    {
      "type": "paragraph",
      "text": "Access Token 面向 Resource Server / API，是「授权」的载体。在 Nyauth 里它是 RS256 签名的 JWT（`internal/auth/token.go` 的 `signAccessToken`），`token_use=access`，`aud` 是客户端，并携带 scope。但注意：Nyauth 并不是一个纯无状态 JWT 方案——它同时把该令牌的元数据（用户、scope、auth_version、授权版本等）写入 Redis，并让 `ValidateAccessToken` 在做完签名校验后，再比对服务端元数据并做授权/策略检查（`internal/auth/token.go`）。这就是「JWT + 服务端状态」的组合：既有 JWT 的紧凑签名，又保留撤销与策略检查的能力。"
    },
    {
      "type": "heading",
      "text": "ID Token：身份，不是授权"
    },
    {
      "type": "paragraph",
      "text": "ID Token 是 OIDC 登录的最终产物，面向客户端，用以确认「谁在什么时候、以什么方式完成了认证」。它由 `GenerateIDTokenWithClaimsAndAuthentication` 签发（`internal/auth/token.go`），`token_use=id`，`aud` 是客户端，携带 `nonce`（若请求了）、`auth_version`、认证上下文（acr/amr/auth_time）以及按 scope 裁切的用户声明。客户端验证它的签名、issuer、audience、时间与 nonce，从而把「某个用户登录成功」这个事实可靠地落到客户端会话里。关键区分：ID Token 确认身份，但它不携带「对某资源的授权」语义，因此绝不是 Resource Server 该接受的访问凭据。"
    },
    {
      "type": "heading",
      "text": "Refresh Token：长期凭据与轮换"
    },
    {
      "type": "paragraph",
      "text": "Access Token 生命周期短，客户端不能老让用户重新登录，于是需要 Refresh Token：一种生命周期长、专门用来签发新 Access Token 的凭据。它不是签名的 JWT，而是随机不透明字符串——在 Nyauth 里由 `GenerateRandomString(32)` 生成，Redis 里只存它的哈希。Refresh Token 只有在客户端获得 `offline_access` 授权时才会随授权码流程一起下发（参见上一章对 scope 的理解）。它的价值是「让客户端在令牌过期后能续期」，代价是它本身是需要严格保护的长期秘密。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "为什么 ID Token 绝对别拿去当 API Bearer",
      "body": "如果 Resource Server 接受 ID Token：一，它的 aud 是客户端而非该 API；二，它没有可用的 scope 授权语义；三，它携带 nonce 等只为登录流程设计的内容；四，它通常没有配套的服务端撤销元数据。一旦某个 API 开始信任 ID Token，就等于把这个 API 的授权决策建立在「一个给客户端看身份的令牌」之上——攻破这条路径往往就是「把身份和授权混为一谈」导致的。规矩是死的：API 只认 Access Token。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "把令牌放哪里的工程指引",
      "body": "不要把 Refresh Token（以及任何敏感的长期秘密）放进浏览器的 localStorage / sessionStorage——那里的任何 XSS 都能直接读到并窃走。业界推荐「BFF（Backend for Frontend）」模式：浏览器通过 HttpOnly + SameSite 的 Cookie 与自己的后端会话通信，Refresh Token 与令牌交换都放在服务端进行，前端只持有短期、内存中的 Access Token。这样即使页面被注入脚本，也拿不到可长期使用的刷新凭据。"
    },
    {
      "type": "callout",
      "variant": "example",
      "title": "三类令牌在一个生命周期里如何接力",
      "body": "登录时：ID Token 让你确认「用户是谁」，Access Token 立刻用于调用 API，Refresh Token 被安全存好。Access Token 过期 → 客户端用 Refresh Token 向 /token 换取一组新的（新的 Access Token + 更新的 Refresh Token，即轮换，下一课详解）。ID Token 过期不再影响 API 访问——它只在你需要重新确认身份时（例如重新登录）出现。于是三者的生命周期各司其职：短命授权、短命身份、长命续期。"
    },
    {
      "type": "quiz",
      "question": "一个客户单页应用需要调用公司 API 读取用户资料，随后把用户信息展示在页面上。关于令牌使用，下列哪一项正确？",
      "options": [
        "把 ID Token 塞进 Authorization 头调用 API，因为 ID Token 里已经有用户信息",
        "用 Access Token 调用 API；用 ID Token 确认登录用户身份",
        "把 Refresh Token 放进 localStorage，每次请求都带上",
        "二者完全等价，谁顺手用谁"
      ],
      "answer": 1,
      "explanation": "访问 API 必须用 Access Token（它承载授权语义且配套服务端元数据）；ID Token 只用于客户端确认本次登录的用户身份。Refresh Token 是长期秘密，绝不能进 localStorage，也不该随每次 API 请求发送。"
    },
    {
      "type": "keypoints",
      "items": [
        "Access Token 面向 Resource Server，承载授权",
        "ID Token 面向客户端，确认身份，绝不用于 API 鉴权",
        "Refresh Token 是长期凭据，仅用于换取新 Access Token，需 offline_access 授权",
        "Nyauth 用 JWT + 服务端元数据（Redis）支持撤销与策略检查",
        "Refresh Token 是不透明随机值，Redis 只存哈希，支持轮换",
        "敏感长期令牌不进 browser/localStorage；优先 BFF + HttpOnly Cookie"
      ]
    }
  ]
};
