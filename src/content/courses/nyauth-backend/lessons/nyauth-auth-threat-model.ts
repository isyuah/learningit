/* ==================================================================
 * 课时：认证服务器的威胁模型（nyauth-auth-threat-model）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-auth-threat-model",
  "courseSlug": "nyauth-backend",
  "title": "认证服务器的威胁模型",
  "summary": "一个泄露的会话或签名密钥为何会影响所有接入应用，以及 OAuth/OIDC 的经典攻击与防御。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "普通业务系统泄露一条订单记录，影响的只是一部分数据；身份服务（这里即 Nyauth）泄露一条 Session、一个 Refresh Token、签名密钥或 Provider Secret，可能影响所有接入应用。因为认证服务器签发的令牌会被其它系统信任：一个有效的 Access Token 就是通往任何被信任资源的大门。所以安全不是挂在代码最外层的一个「安全模块」，而是贯穿每个请求路径的硬约束，是评审、测试和面试的重心。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "面试官会沿一条链路连续追问",
      "body": "把整条请求处理链路记成一条安全链：输入校验 -> 身份认证 -> 会话保护 -> 授权范围 -> 令牌签发 -> 撤销/轮换 -> 审计/告警。要做到能指出每一层的防护是什么、失败行为是什么、以及用什么测试证明它有效。这一课围绕 OAuth/OIDC 特有的威胁展开，浏览器会话层的威胁在下一课。"
    },
    {
      "type": "heading",
      "text": "为什么身份服务的权重特别高",
    },
    {
      "type": "paragraph",
      "text": "关键区别在于「信任传播」。业务服务里的一个 token 只代表用户对那一个服务授权；而认证服务器签发的令牌、维护的会话、握着的签名密钥，是很多资源服务器共同信任的基础。攻击者只要拿到：一个用户的 Refresh Token（可长期换取新令牌）、签名私钥（可伪造任意用户的令牌）、或 OAuth Provider Secret（可冒充用户走第三方登录），破坏范围就从「一个用户」放大到「一群接入方」。因此泄密成本高的组件，必须在签发、撤销、审计每一处都收紧。"
    },
    {
      "type": "heading",
      "text": "威胁一：授权码拦截与注入",
    },
    {
      "type": "paragraph",
      "text": "Authorization Code 流程里，code 会经过浏览器重定向回传给客户端。攻击者可能：拦截传输中的 code，或把自己的 code 注入受害者的客户端回调。防御不是靠「code 很随机」，而是靠多个绑定关系叠加。Nyauth 的要求是：`redirect_uri` 必须精确匹配已登记的值；code 只能消费一次；强制 PKCE S256（不接受 `plain`、implicit、hybrid）；用 `state` 绑定「这个响应属于我发起的这次请求」；OIDC 里再用 `nonce` 绑定 ID Token 与本次登录。"
    },
    {
      "type": "table",
      "caption": "授权码拦截/注入：威胁 -> 防御 -> 绑定什么",
      "headers": ["威胁", "防御", "绑定的对象"],
      "rows": [
        ["回执地址被改到攻击者域名", "精确匹配已登记 redirect_uri（不含模糊前缀）", "客户端注册时登记的回执端点"],
        ["code 被重复兑换", "一次性消费（ConsumeAuthorizationCodeIfMatch）", "code 与它对应的授权上下文"],
        ["攻击者用自己拿到的 code 换令牌", "强 PKCE S256：验证 vcode_verifier 匹配当初的 code_challenge", "发起点与兑现点的秘密（verifier）"],
        ["CSRF 式把用户请求与响应串线", "state 随机绑定，回调时校验", "客户端自己发起的这一次请求"],
        ["ID Token 被冒充或重放", "nonce 绑定 + 校验签名/iss/aud/exp", "本次 OIDC 登录上下文"]
      ]
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "不要把 state 当身份，也不要把 nonce 当 CSRF Token",
      "body": "`state` 绑定的是「客户端请求与回执」；`nonce` 绑定的是「OIDC 登录请求与 ID Token」；CSRF Token 保护的是会话 Cookie 的状态变更请求。三者分别解决不同问题，绝不能互换或省略其一。"
    },
    {
      "type": "heading",
      "text": "威胁二：Open Redirect 与回调污染",
    },
    {
      "type": "paragraph",
      "text": "绝不能允许客户端在请求里随意指定「任意回调地址」。Nyauth 在客户端注册时保存允许的地址，授权时必须精确匹配。为什么只比较 host 不够、不能用模糊前缀匹配、错误回调也要守同样的边界？因为接收方由整个 URL 决定：路径、端口、scheme、甚至 query 都可能改变谁拿到 code。"
    },
    {
      "type": "list",
      "items": [
        "只比较 host 不够：`https://example.com` 与 `https://example.com.evil.io` 主机不同；同 host 下 `/oauth` 与 `/oauth2` 可能是不同后端；`http://` 与 `https://` 明文/密文不同；不同端口也可能指向不同服务。",
        "不能模糊前缀匹配：`https://example.com/*` 会放过 `https://example.com.evil.com` 这类前缀延伸，等于把错误回调变成开放重定向。",
        "错误回调也要守同一边界：即使授权失败，凡是要把浏览器重定向出去的 URL，都必须先经过同一套精确验证，否则失败路径会变成唯一的注入口。"
      ]
    },
    {
      "type": "heading",
      "text": "威胁三：令牌泄露与重放",
    },
    {
      "type": "paragraph",
      "text": "令牌是「字面意义上的门禁钥匙」，一旦进入日志、URL、Referer、或第三方脚本能读到的位置，就相当于把钥匙丢在了大街上。Nyauth 的应对分三层：签发时不把 token 写进日志或 URL；轮换 + 重用检测让旧令牌失效且能被发现；状态变化及时撤销。"
    },
    {
      "type": "list",
      "items": [
        "Access/Refresh Token 不写日志、不进 URL（避免进 Referer 和代理日志）。",
        "Refresh Token 轮换：每次刷新签发新令牌、作废旧令牌，并用 family 关联一组轮换令牌。",
        "重用检测：如果一把「已经被轮换掉」的旧 Refresh Token 又出现，说明可能被盗，撤销整个 family。",
        "安全版本变化：用户改密码、改 MFA、改授权或安全版本提升时，撤销相关的会话与令牌。",
        "持续检查：Introspection 和用户授权策略在令牌使用时持续校验，而不是只在签发那一刻检查一次。"
      ]
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "面试追问：拿到了 Refresh Token，轮换能发现什么、不能发现什么",
      "body": "能发现：旧令牌被重复使用（replay）——两个请求同时交上同一把令牌，第二次会触发 family 撤销，据此冻结整条令牌链。不能发现：攻击者先于正常用户用掉了当前令牌、把原持有者顶下去而自己不重放——此时没有「旧令牌被重放」的信号。所以旋转只是减少损失窗口，不是魔法，仍需要 introspection 与持续策略检查兜底。"
    },
    {
      "type": "heading",
      "text": "威胁四：算法混淆与 JWT 错误验证",
    },
    {
      "type": "paragraph",
      "text": "验证 JWT 时，「签名有效」不等于「令牌可信」。Nyauth 固定使用 RS256，并限制 parser 的允许算法，防止算法混淆攻击（例如把 RS256 降级成 HS256，用公钥当对称密钥验签）。此外签名之外仍要逐项校验：`iss` 等于预期 issuer，`aud` 包含当前 Client/API，`exp`/`iat`（必要时 `nbf`）合理，OIDC 的 `nonce` 匹配本次请求，`kid` 对应的公钥来自可信 JWKS。"
    },
    {
      "type": "code",
      "title": "验证 JWT 的检查项（伪代码）",
      "language": "go",
      "code": "// 1) 算法白名单：只允许 RS256，拒绝任何其它 alg（防降级/混淆）\n// 2) 校验签名：用 kid 从可信 JWKS 取公钥\n// 3) iss == 配置的预期 issuer\n// 4) aud 包含当前调用方/API 标识\n// 5) exp > now（已过期即拒），iat/nbf 合理\n// 6) OIDC：nonce 必须等于本次授权请求下发的值\n// 全部通过才叫「可接受」，签名有效只是第一步"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "不要对外说「这令牌是 JWT，无状态，所以无可撤销」",
      "body": "Nyauth 实际是 JWT + 服务端状态（Redis/Session）组合：token 本身能自验证，但服务端仍保存状态以便支持撤销、权限变化和重用检测。面试里把「无状态」讲成「不能撤销」是常见的错误点。"
    },
    {
      "type": "heading",
      "text": "安全评审清单：每个新接口逐项过",
    },
    {
      "type": "paragraph",
      "text": "新增任何一个接口，都要把它当作攻击面重新走一遍下面的清单。回答不是「我们框架默认安全」，而是逐条给出该接口的答案与证据。"
    },
    {
      "type": "list",
      "items": [
        "是否改变状态？需要 CSRF 吗？（非幂等 + Cookie 会话 = 需要）",
        "需要用户、管理员或近期重新认证吗？（敏感操作要 recent re-auth）",
        "需要 rate limit 吗？操作名是否来自权威 catalog（不能用客户端任意编造）？",
        "错误会枚举用户、Client、Provider 或邮箱吗？（要统一错误，避免区分「存在/不存在」）",
        "输入有长度、格式、scheme、host 和资源上限吗？（尤其 redirect_uri / 回调）",
        "存在并发重复提交吗？权威约束在哪里（唯一约束、FOR UPDATE、Redis Lua、CAS revision）？",
        "失败会留下半成品吗？应放进同一事务吗？",
        "日志、指标、审计会泄露秘密或产生高基数吗？",
        "依赖 Redis/PostgreSQL/SMTP 失败时是 fail-open 还是 fail-closed？为什么这个选择合理？",
        "有真实 PostgreSQL/Redis 或 HTTP 集成测试，而不只是 mock 吗？"
      ]
    },
    {
      "type": "table",
      "caption": "威胁 -> 防御 -> 在 Nyauth 哪里落实",
      "headers": ["威胁", "防御", "落实位置"],
      "rows": [
        ["授权码拦截/注入", "精确 redirect_uri、一次性 code、强制 PKCE S256、state、nonce", "auth/handler.go Authorize/Token、auth/pkce.go、session/store.go ConsumeAuthorizationCodeIfMatch"],
        ["Open Redirect / 回调污染", "精确 host+path+port+scheme 匹配，拒绝模糊前缀", "Auth 的 redirect_uri 校验与回调边界"],
        ["令牌泄露/重放", "日志脱敏、轮换 + family 重用检测、安全版本撤销、持续 introspection", "auth/token.go TokenService、session/store.go RotateRefreshTokenAndStoreAccess、audit/helpers.go"],
        ["算法混淆 / JWT 误验证", "固定 RS256、校验 iss/aud/exp/kid/nonce", "内部 token 验证与 JWKS"]
      ]
    },
    {
      "type": "heading",
      "text": "本课小结",
    },
    {
      "type": "paragraph",
      "text": "抓住一条主线：认证服务器的每个「绑定」都在回答「这个凭据到底属于谁、能去换什么」。checklist 的价值在于把抽象的「更安全」变成可审查的逐条问题——这也是安全审计时真正会被追问的内容。"
    },
    {
      "type": "quiz",
      "question": "为什么 OAuth 授权服务器不能接受客户端任意指定的 redirect_uri？",
      "options": [
        "因为浏览器不认识错误地址，会直接报错",
        "因为重定向回执地址决定了谁收到 authorization code，接受任意地址等于把 code 交给不可信接收方（开放重定向+拦截）",
        "因为 redirect_uri 只是显示用途，跟安全性无关",
        "因为客户端必须重新登录才能改地址"
      ],
      "answer": 1,
      "explanation": "redirect_uri 精确决定 authorization code 的去向；接受任意地址会让攻击者指定自己的回调，从而拦截 code。所以必须精确匹配 host+path+port+scheme，且错误回调也守同一边界。"
    },
    {
      "type": "quiz",
      "question": "给定了 `redirect_uri=https://example.com`，下面哪种写法是对的？",
      "options": [
        "只比较 host 等于 example.com 就放行",
        "用前缀匹配：Uri.StartsWith(\"https://example.com\") 就放行",
        "对整个 URI 做规范化的精确字符串/结构匹配，且 error 回调也走同一套校验",
        "客户端随便填，服务端只记录到日志"
      ],
      "answer": 2,
      "explanation": "路径、端口、scheme、query 都可能改变接收方，且前缀匹配会放过 `example.com.evil.com` 之类的延伸。必须整体精确匹配，并让失败路径同样受控。"
    },
    {
      "type": "exercise",
      "title": "构造令牌重放场景与验证点",
      "description": "用 Nyauth 的 OAuth 流程模拟：同一个 Refresh Token 被两个并发请求同时交上。写出你认为会发生什么（哪些请求成功、哪些失败、family 何时被撤销），并列出为了证明这一行为，集成测试必须断言哪些 Redis/DB 状态变化。",
      "hint": "参考 docs 里的 Lua 原子轮换：旧令牌确认、作废旧、写新令牌、维护 family 索引、检测重用。测试要覆盖「先成功的正常路径」与「后到的重放路径」两种时序。"
    },
    {
      "type": "keypoints",
      "items": [
        "身份服务的泄密影响所有接入方，因为令牌与签名密钥被多处信任",
        "安全链：输入校验->身份认证->会话保护->授权范围->令牌签发->撤销/轮换->审计/告警",
        "授权码拦截要用精确 redirect_uri、一次性 code、强制 PKCE S256、state、nonce 绑定",
        "回调验证只按 host 或前缀匹配是错的；错误回调也要守同一边界",
        "令牌不写日志/URL；Refresh 轮换 + family 重用检测撤销；安全版本变化撤销相关状态",
        "JWT 验证：固定 RS256，校验 iss/aud/exp/kid/nonce；「签名有效」不等于「可信」",
        "每个新接口都要过安全检查清单：CSRF、权限/重认证、限流、枚举、输入上限、并发权威约束、事务边界、日志泄露、fail-open/closed、真实测试"
      ]
    }
  ]
};
