/* ==================================================================
 * 课时：Nyauth 是什么：一个完整的认证与授权服务（nyauth-what-is-it）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course 大纲一致。
 * 内容块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-what-is-it",
  "courseSlug": "nyauth-backend",
  "title": "Nyauth 是什么：一个完整的认证与授权服务",
  "summary": "先用一句话定义 Nyauth，再建立三个角色和安全边界的心智模型，最后认识它的能力版图与 0.3.0 断裂基线。",
  "minutes": 15,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "在本课程第一课，我们要回答一个看似简单、却决定后面所有章节怎么讲的问题：Nyauth 到底是什么？如果你只把它当作一个「用户名密码登录页面」来理解，你会在学习到 OAuth 授权、令牌签发和安全边界时反复困惑。所以这一课的目标，是在你脑子里先种下一个正确、完整的定义，以及最重要的三个角色的图景。"
    },
    {
      "type": "definition",
      "term": "Nyauth",
      "definition": "一个以 Go 编写的身份认证与 OAuth2/OIDC 授权服务器，同时内置第一方用户中心（User Center）和管理后台（Admin Console）。它承担 Authorization Server、OIDC Provider、用户中心和运维后台四种职责。"
    },
    {
      "type": "heading",
      "text": "一句话定义：它不是登录页，而是一条安全边界"
    },
    {
      "type": "paragraph",
      "text": "Nyauth 提供的核心能力可以压缩成一句：它验证「你是谁、你能要什么、我给你哪些凭据」。它不是一个「登录页面」——登录页只是它向外暴露的一个端点。真正重要的是，Nyauth 处在用户、业务应用和资源服务之间，是一条职责明确的安全边界（security boundary）。它要保护的对象不是某一张表，而是：用户身份（identity）、授权范围（scope）、令牌（token）、以及接入的外部 Provider 凭据（如 GitHub / Google 的密钥）。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "为什么用「安全边界」来框定它",
      "body": "把 Nyauth 理解为安全边界，会立刻改变你的学习视角：每一条进入它的请求、每一次它发出的令牌，都在跨越这条边界。于是你会自然地问「谁来验证、谁来授权、谁来签发、谁来撤销」——这正是整个课程反复出现的四个问题。如果你把它当作「登录页」，这些问题永远不会被问出来。"
    },
    {
      "type": "heading",
      "text": "先建立三个角色"
    },
    {
      "type": "paragraph",
      "text": "要读 Nyauth，第一件事是分清「谁在跟谁打交道」。绝大多数困惑都来自把三个角色混为一谈。项目里最常出现的三个角色是：浏览器用户（Browser User）、OAuth Client、以及 Nyauth 服务端本身（Authorization Server）。未来接入的业务应用还可能作为第四个角色——Resource Server（资源服务器）。顺带一提：这里的「浏览器用户」就是 OAuth 标准里的 Resource Owner（资源所有者）——具体持有、授权资源的人；到「OAuth 2.0 角色」一课会正式建立这套五角色模型。"
    },
    {
      "type": "table",
      "caption": "Nyauth 的三个核心角色",
      "headers": ["角色", "在 Nyauth 中的例子", "你要理解的责任"],
      "rows": [
        ["浏览器用户（Browser User）", "登录、同意授权、管理 Passkey", "持有浏览器会话，自主决定是否授权某个 Client"],
        ["OAuth Client", "你的测试应用，或用户创建的应用", "申请 scope、接收授权码或访问令牌，代表用户访问资源"],
        ["Nyauth 服务端（Authorization Server）", "承担 Authorization Server + UserInfo", "验证身份、保存授权决定、签发并撤销令牌"]
      ]
    },
    {
      "type": "paragraph",
      "text": "补充一个将来会用到的角色：Resource Server。它负责在业务侧验证 Access Token，并在用户权限不足时要求「更高认证等级」。Nyauth 负责在 Authorization Server 一侧完成升级认证，并把 `acr`（实际达到的认证等级）、`amr`（实际使用的方法）和 `auth_time`（认证时间）放进令牌上下文，交给 Resource Server 做判断。先记住这条分工：登录和升级认证属于 Nyauth，资源访问的最终校验属于 Resource Server。"
    },
    {
      "type": "heading",
      "text": "核心能力版图"
    },
    {
      "type": "paragraph",
      "text": "Nyauth 不是一个单一功能的服务，而是一组围绕「身份与授权」的能力集合。用面试语言说，它同时实现了三种协议面：第一，标准的 OAuth 2.0 授权服务器——支持 Authorization Code + PKCE 等流程，负责出 token；第二，OpenID Connect Provider——在 OAuth 之上增加 ID Token 和 UserInfo，让客户端能确认用户身份；第三，第一方用户中心与管理员控制台——管理用户资料、MFA、Passkey、OAuth Client、以及系统设置。"
    },
    {
      "type": "list",
      "items": [
        "OAuth2 授权流程：Authorization Code + 强制 PKCE S256，负责令牌签发",
        "OpenID Connect：ID Token、Discovery、JWKS、UserInfo，负责「确认用户是谁」",
        "MFA / Passkey：TOTP、恢复码、WebAuthn 无密码凭据",
        "管理后台：管理 OAuth Client、Scope、审计、运行时能力开关",
        "外部 Provider：接入 GitHub / Google / 其他 OIDC 作为第三方登录来源"
      ]
    },
    {
      "type": "heading",
      "text": "0.3.0 断裂基线：为什么它「不留兼容层」"
    },
    {
      "type": "paragraph",
      "text": "版本约定上，Nyauth 把 0.3.0 视作一个「断裂基线」（breaking baseline），当前开发版本是 0.8.0-dev。仓库里「断裂」的原始语义，主要指数据库 schema 以 `000001_baseline` 建立了一个与早期开发库不兼容的新迁移基线——旧库、旧 token、旧 OAuth 客户端注册一律不兼容，升级前必须备份再重建。与此同时，这一版本也借着「不留兼容层」的机会落了一组更严格的安全默认（见下）。分开记这两件事，比笼统地说「很严格」更准确。"
    },
    {
      "type": "list",
      "items": [
        "PKCE 强制使用 S256：不接受 plain，也不接受没有 PKCE 的授权码流程",
        "签名只允许 RS256：JWT 固定使用 RS256，从根上排除算法混淆攻击",
        "Refresh Token 强制轮换 + 重用检测：旧 token 一旦被再次使用，就撤销整条 family",
        "拒绝 implicit / hybrid 等弱流程：只保留授权码这一条主流程"
      ]
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "把「强制」看成设计哲学，而不是刁难",
      "body": "这些强制项不是为了让学习者难受，而是「安全默认」的具体体现：在安全与便利冲突时，Nyauth 选择安全，并拒绝退路。你在阅读代码时会反复看到 validatePKCE、算法白名单、原子消费这类实现——它们都是这条基线哲学落地的结果。"
    },
    {
      "type": "heading",
      "text": "为什么认证服务器必须被当作高价值目标"
    },
    {
      "type": "paragraph",
      "text": "普通业务系统泄露一笔订单，影响的是有限的几行数据；而身份服务泄露一个 Session、一个 Refresh Token、签名私钥或 Provider Secret，可能影响所有接入它的应用——因为令牌是「通用的敲门砖」。这决定了 Nyauth 的安全权重远高于普通 CRUD 服务：安全不是某个单独模块的责任，而是叠加在每一条请求路径上的约束。"
    },
    {
      "type": "paragraph",
      "text": "这也是为什么本课程会强调「不变量」而不是「清单」：你要掌握的，是每条链路在每一步必须满足什么约束（比如「授权码只能消费一次」），而不是背出几十个端点。面试官往往沿着一条链路连续追问，你若能指出每一层的防护、失败行为和测试证据，才是真正的理解。"
    },
    {
      "type": "quiz",
      "question": "把 Nyauth 理解成「一条安全边界」而非「登录页」，最主要的学习价值是什么？",
      "options": [
        "能让前端登录按钮写得更简洁",
        "能立刻分清浏览器用户、OAuth Client、Nyauth 服务端三个角色各自对谁负责",
        "能减少需要编写的 API 端点数",
        "能让密码哈希算法自动变安全"
      ],
      "answer": 1,
      "explanation": "安全边界框架会把我们的注意力引向「谁验证、谁授权、谁签发、谁撤销」这四个贯穿课程的问题，而不是把 Nyauth 当成一个渲染登录表单的前端功能。"
    },
    {
      "type": "quiz",
      "question": "关于 Nyauth 的 0.3.0 断裂基线，下面哪个说法正确？",
      "options": [
        "它为了兼容旧客户端而保留了 plain PKCE 和 implicit 流程",
        "它强制 PKCE S256、仅允许 RS256，并对 Refresh Token 做轮换加重用检测",
        "它允许任意签名算法以提升性能",
        "它不再使用 JWT，全部改用不透明字符串"
      ],
      "answer": 1,
      "explanation": "0.3.0 断裂基线的核心是不留兼容层、强制安全默认：PKCE 只用 S256、JWT 只用 RS256，并且 Refresh Token 必须轮换，旧 token 被重用时整条 family 被撤销。"
    },
    {
      "type": "keypoints",
      "items": [
        "Nyauth = Go 写的 OAuth2/OIDC 授权服务器 + 第一方用户中心 + 管理后台",
        "它不是登录页，而是一条保护身份、Scope、令牌与 Provider 凭据的安全边界",
        "三个核心角色：浏览器用户、OAuth Client、Nyauth 服务端（再加未来的 Resource Server）",
        "能力版图：OAuth2 流程、OIDC、MFA/Passkey、管理后台、外部 Provider",
        "0.3.0 是断裂基线：PKCE 强制 S256、仅 RS256、Refresh 轮换 + 重用检测、拒绝弱流程",
        "身份服务的泄露影响所有接入应用，因此安全是每条请求路径的约束，而非单一模块"
      ]
    }
  ]
};
