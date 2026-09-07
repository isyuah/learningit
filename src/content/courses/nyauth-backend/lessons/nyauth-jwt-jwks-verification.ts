/* ==================================================================
 * 课时：JWT 验证与 JWKS：签名有效不等于可信（nyauth-jwt-jwks-verification）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-jwt-jwks-verification",
  "courseSlug": "nyauth-backend",
  "title": "JWT 验证与 JWKS：签名有效不等于可信",
  "summary": "签名只证明令牌由持有私钥的一方签发；要真正信任它，还得验证每一处声明。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "很多关于 JWT 的事故都不是签名被伪造，而是验证方只验了「签名有效」就放行，却没有检查签发者是谁、令牌给谁用、是否已过期、对应哪个公钥。JWT 验证的关键认知是：签名有效 ≠ 令牌可信。这一课拆开签名 JWT 的结构、RS256 的非对称原理、JWKS 如何按 kid 提供公钥，并给你一张必须逐项过一遍的验证清单；最后用 Nyauth 的真实代码（`internal/auth/token.go` 的 `parseSignedToken`）说明一个负责任的验证器长什么样。"
    },
    {
      "type": "definition",
      "term": "签名 JWT 的三段结构",
      "definition": "`header.payload.signature`。header 声明签名算法与 kid（公钥标识）；payload 是声明的 JSON（iss、sub、aud、exp、iat、nbf 等）；signature 是用私钥对前两段计算出的签名，验证方需要用公钥重算比对。"
    },
    {
      "type": "definition",
      "term": "JWKS（JSON Web Key Set）",
      "definition": "授权服务器在 `/.well-known/jwks.json`（或 Discovery 里的 jwks_uri）上发布的一组公开密钥，每个 key 带 `kid`（key id）、`kty`（如 RSA）、`alg`（如 RS256）、`use`（如 sig）。验证方凭 JWT header 里的 kid 挑选对应公钥。"
    },
    {
      "type": "definition",
      "term": "kid 混淆攻击",
      "definition": "攻击者把 JWT 的 `kid` 指向一个私钥可控的 key（例如把 kid 设为某个可预测值），诱导验证方用错的「公钥」验签。防护方法是：只从可信 JWKS 读取、且只接受允许的算法与受信任的 kid。"
    },
    {
      "type": "heading",
      "text": "RS256：私钥签、公钥验"
    },
    {
      "type": "paragraph",
      "text": "Nyauth 固定使用 RS256——RSA + SHA-256 的非对称签名。授权服务器持有 RSA 私钥用于签名，任何人（包括 Resource Server）都可以用对应的公钥验证。因为非对称，私钥永远只留在签发方，验证方拿到的都是公钥，即便公钥泄露也无法伪造新令牌。私钥在 Nyauth 里以加密信封（envelope）形式保存（`JWKManager`，`internal/auth/jwk.go`），并支持按周期轮换：旧私钥转入 verification 阶段保留一段时间，让仍在有效期内的旧令牌仍可验证。"
    },
    {
      "type": "paragraph",
      "text": "因为有多把 key（当前签名 key + 仍在验证窗口的旧 key），JWT 的 header 里必须带 `kid`，验证方才能从 JWKS 里挑出「签发这把令牌用的那一个公钥」。这就是 kid 与 JWKS 配对的意义：不是任取一把 key，而是按 kid 精确匹配。"
    },
    {
      "type": "heading",
      "text": "验证清单：签名之后还有七件事"
    },
    {
      "type": "list",
      "ordered": true,
      "items": [
        "算法：是否是被允许的算法？Nyauth 固定 RS256，parser 只接受 RS256，杜绝算法混淆（见下方 warning）",
        "iss：issuer 是否等于预期签发方",
        "aud：audience 是否包含「当前客户端 / 当前 API」",
        "exp / iat / nbf：是否未过期、签发时间合理、生效时间已到",
        "nonce：若是 OIDC ID Token，nonce 是否匹配当前登录请求",
        "kid：header 的 kid 是否指向一个来自可信 JWKS 的公钥",
        "（结合服务端状态）owner/元数据一致性：若是 access token，还需比对 Redis 元数据并做授权/策略检查"
      ]
    },
    {
      "type": "paragraph",
      "text": "这份清单对应 Nyauth `parseSignedToken` 的真实行为（`internal/auth/token.go`）：先 `WithValidMethods([]string{\"RS256\"})` 锁定算法，拒绝非 RS256；再要求 header 的 `alg` 精确等于 `RS256`、`kid` 非空；从 JWKS 按 kid 取公钥；随后用 `WithIssuer`、`WithExpirationRequired`、`WithIssuedAt` 等校验 iss/exp/iat/nbf，并做时间偏差容忍（leeway）；最后还校验 `claims.Issuer==ts.issuer`、过期/签发时间非空。这就是「签名有效 ≠ 可信」在工程上的具体落地。"
    },
    {
      "type": "code",
      "title": "在 Go 中校验一个 JWT 的签名与声明（示意，贴合 Nyauth 的做法）",
      "language": "go",
      "code": "// 1) 锁定允许算法，防止算法混淆（alg: none / HS256 等一律拒绝）\nparser := jwt.NewParser(jwt.WithValidMethods([]string{\"RS256\"}))\n\n// 2) 从可信 JWKS 按 kid 取公钥（这里简化为已加载的 key）\nunverified, _, err := parser.ParseUnverified(tokenString, &claims)\nif err != nil || unverified.Header[\"alg\"] != \"RS256\" {\n    return ErrInvalidToken\n}\nkid, _ := unverified.Header[\"kid\"].(string)\nif kid == \"\" {\n    return ErrInvalidToken\n}\npublicKey := jwks.Lookup(kid) // 只接受来自可信 JWKS 的 kid\nif publicKey == nil {\n    return ErrInvalidToken\n}\n\n// 3) 验签 + 校验必要声明\nparsed, err := jwt.ParseWithClaims(tokenString, &claims, func(t *jwt.Token) (any, error) {\n    if t.Method != jwt.SigningMethodRS256 || t.Header[\"alg\"] != \"RS256\" {\n        return nil, ErrInvalidToken\n    }\n    return publicKey, nil\n}, jwt.WithValidMethods([]string{\"RS256\"}),\n    jwt.WithIssuer(\"https://auth.example.com\"),\n    jwt.WithExpirationRequired(), jwt.WithIssuedAt(),\n    jwt.WithLeeway(2*time.Minute))\nif err != nil || !parsed.Valid || claims.Issuer != \"https://auth.example.com\" {\n    return ErrInvalidToken\n}\n// 至此才说“这个令牌是可信的”"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "算法混淆 (algorithm confusion)",
      "body": "如果验证器允许「任意算法」，攻击者可以把 header 的 alg 改成 `none`（那就不需要签名）或把 RSA 验签换成 HMAC 对称验签（借用了公钥当 HMAC 密钥）。Nyauth 的防护是双重的：`WithValidMethods([]string{\"RS256\"})` 只允许 RS256，同时代码里再检查 `token.Header[\"alg\"] == \"RS256\"`。定死算法是算法混淆最直接的对策——这也是 Discovery 文档里 `id_token_signing_alg_values_supported` 只有 RS256 的原因。"
    },
    {
      "type": "heading",
      "text": "签名、声明之外：还有本地实时状态"
    },
    {
      "type": "paragraph",
      "text": "对 Resource Server 而言，验签 + 验声明仍然只能回答「这个令牌确由授权服务器签发、且还没过期」。它不能回答「这个令牌现在是否已被撤销、用户的授权是否还成立」。这就是「签名有效 ≠ 可信」的最后一层：信任还取决于实时状态。Nyauth 的方案是 JWT + 服务端元数据（Redis 里的 access-token 元数据 + 授权/策略检查）。另一种常见选择是内省 (introspection, RFC 7662)：Resource Server 把令牌交给授权服务器的 `/introspect` 端点，换取该令牌的实时本地状态。两者都在补「验签之外」的那一块。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "跨层的信任边界",
      "body": "JWT 验签解决「密码学真伪」，声明校验解决「给不给这个主体用」，内省/服务端状态解决「现在是否仍有效」。三层缺一不可。面试里被问「签名验证通过就代表令牌可接受吗」——答案是：还要验证 iss、aud、时间、nonce、正确的 kid/公钥来源，并在需要时查实时状态。把「签名有效」当「令牌可信」是整个领域最经典的坑。"
    },
    {
      "type": "quiz",
      "question": "一个 JWT 的 RS256 签名验证通过了，但它的 header alg 被改成 none、payload 里没有正确的 aud。下面哪一项关于它的判断正确？",
      "options": [
        "签名有效，令牌可以直接放行用作 API 鉴权",
        "只要签名验证过了，iss、aud、exp 就无需再检查",
        "签名通过只代表它确实由持有私钥的一方签发；仍需校验允许的算法与 iss/aud/exp 等声明后才能接受",
        "只要从公开 JWKS 抓到任何一把公钥验签通过即可，无需关心 kid"
      ],
      "answer": 2,
      "explanation": "验证器必须首先锁定允许算法（如 RS256，杜绝 alg: none / 算法混淆），并以可信 JWKS 的 kid 选出正确公钥，再校验 iss/aud/exp/iat/nbf/nonce。签名有效 ≠ 令牌可信。"
    },
    {
      "type": "keypoints",
      "items": [
        "签名 JWT = header.payload.signature；RS256 私钥签、公钥验",
        "JWKS 按 kid 发布公钥；验证方必须从可信 JWKS 且按允许算法取用",
        "验证清单：算法、iss、aud、exp/iat/nbf、nonce、受信任 kid，以及服务端状态",
        "签名有效 ≠ 令牌可信——必须逐项验证声明",
        "Nyauth 固定 RS256 并用 WithValidMethods 双重锁定，防止算法混淆",
        "实时状态：内省（RFC 7662）或 JWT + 服务端元数据，补齐「现在是否仍有效」"
      ]
    }
  ]
};
