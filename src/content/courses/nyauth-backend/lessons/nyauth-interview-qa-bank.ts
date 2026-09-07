/* ==================================================================
 * 课时：高频面试问答（nyauth-interview-qa-bank）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts。slug 必须与 course.ts 大纲一致。
 * 本课只给「回答框架」与关键推理点，不给背稿；真正把它说顺靠练习。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "nyauth-interview-qa-bank",
  courseSlug: "nyauth-backend",
  title: "高频面试问答：记住问题与回答框架",
  summary:
    "用统一的「问题 → 约束 → 方案 → 取舍 → 证据」回答框架，把 Go / 数据库 / Redis / OAuth / 安全 / 工程六层的高频问题讲得条理清晰。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "与其背一百个答案，不如掌握一个回答框架。这一课对所有高频问题统一使用：**问题 → 约束 → 方案 → 取舍 → 证据**。先复述问题确认理解，指出约束（隔离性、原子性、安全性、性能），给出方案，诚实说明取舍，最后用 Nyauth 里的真实选择或测试做证据。这一课给的是「骨架和推理点」，不是逐字稿——同一件事换一种问法，你要能换成自己的话讲出来。",
    },
    {
      type: "heading",
      text: "回答框架：先讲清楚再给答案",
    },
    {
      type: "list",
      items: [
        "问题：准确复述，把模糊的问题变成具体约束（「你说的 xx 是指并发下不丢还是不强一致？」）",
        "约束：这是一个一致性 / 安全性 / 性能 / 可用性问题，边界是什么",
        "方案：给出主方案，必要时提一个被否掉的备选及原因",
        "取舍：诚实承认代价，例如换来 at-least-once、可能误登出、牺牲可用性",
        "证据：用 Nyauth 里的机制、代码或测试名收尾，让回答落到你能验证的地方"
      ]
    },
    {
      type: "callout",
      variant: "tip",
      title: "追问是最好的提示",
      body: "很多问题不是要一个「正确词」，而是想听你怎么权衡。先用一句话讲约束再展开，往往能把面试官想听的「为什么」自己引出来，也避免答非所问。宁可先确认范围，也不要急着给一个可能错位的答案。"
    },
    {
      type: "heading",
      text: "Go 层",
    },
    {
      type: "subheading",
      text: "为什么 interface 由调用方（consumer）定义，而不是实现方",
    },
    {
      type: "paragraph",
      text: "Go 的隐式接口鼓励「消费方定义最小依赖面」：调用者只声明它需要的几个方法，而不是实现方声明一大坨方法让调用者全依赖。Nyauth 里 store / service / manager 各自暴露小接口，好处是便于用 fake 替换、测试只 mock 所需方法、且依赖倒置（高层不依赖低层实现）。取舍：接口方法太少会过度抽象、太多会耦合，应该按「真正用到的」来定义。",
    },
    {
      type: "subheading",
      text: "为什么 context 作为第一个参数，且不能存进 struct",
    },
    {
      type: "paragraph",
      text: "context 承载请求级的取消信号、截止时间与协商值（如超时、请求 ID）。作为第一个参数传递，是让取消和 deadline 随调用链传播的惯例；一旦把 context 存进 struct，就失去了「每个请求都可能有自己的 context」的语义——多个并发请求共用一个 struct 会共享或互相覆盖取消状态，这是数据竞争与行为混乱的源头。所以 context 只作为参数向下传，绝不作为字段。",
    },
    {
      type: "subheading",
      text: "handler / service / store 各负责什么",
    },
    {
      type: "paragraph",
      text: "handler：解析请求、校验输入、把内部错误翻译成恰当的 HTTP 状态并序列化响应；service：编排业务规则、跨 store 调用的流程与决策；store：纯数据读写，返回领域对象把持久化细节隔离。Nyauth 里 `CreateRegistration`（store）负责事务原子性，service 负责调用它并处理结果，handler 负责把 `ErrRefreshTokenReuse` 之类的错误映射成状态码。好处是每层可单独测试、错误分类清晰。",
    },
    {
      type: "subheading",
      text: "defer 回滚的安全写法",
    },
    {
      type: "paragraph",
      text: "手动 Begin/Commit/Rollback 时用 `defer tx.Rollback(ctx)` 兜底：任何提前 return 的路径都会自动回滚，不会遗留挂起的未提交事务；提交成功后再 Rollback 是安全的 no-op。Nyauth 的注册与配置事务都用了这个模式。要点：把 Commit 放在所有校验和写入之后、且确认 Commit 出错时返回错误；绝不要依赖「后面某条路径才回滚」。",
    },
    {
      type: "heading",
      text: "数据库层",
    },
    {
      type: "subheading",
      text: "FOR UPDATE vs SKIP LOCKED vs advisory lock",
    },
    {
      type: "list",
      items: [
        "FOR UPDATE：锁定选定行直到事务结束，处理「读到最新值并基于它改动」的原始并发；代价是其它事务会阻塞等待",
        "SKIP LOCKED：队列/任务场景——多个 worker 争同一批待处理行，直接跳过已被锁的行去处理下一批，避免互相阻塞；典型用于 outbox worker 从表中取待发送邮件",
        "advisory lock：与应用无关的行锁，锁的是业务语义而不是某一行；Nyauth 用它在客户端写与 OAuth 策略更新之间做互斥/共享（如 RequireOAuthPolicyTx 取的共享 advisory lock）"
      ]
    },
    {
      type: "subheading",
      text: "为什么迁移账号与 runtime 账号分离",
    },
    {
      type: "paragraph",
      text: "迁移（migration）账号需要 DDL 权限（建表、加列、改索引），而 runtime 账号只需 DML（增删改查与事务）。分离最小化权限面：即使 runtime 账号被攻破，攻击者也改不了表结构，无法通过 DDL 做破坏性变更；同时推不上的 DDL 权限也防止应用 bug 意外改 schema。这是一种纵深防御中的权限最小化。",
    },
    {
      type: "subheading",
      text: "唯一约束 vs SELECT-then-INSERT",
    },
    {
      type: "paragraph",
      text: "「先 SELECT 看存不存在、不存在再 INSERT」有竞态：两个并发请求都查不到，然后都插入成功。正确做法是依赖数据库唯一约束 + 冲突处理（唯一索引 + `ON CONFLICT DO NOTHING`），让数据库在并发下保证唯一。Nyauth 的注册里靠用户名/邮箱的唯一约束和事务回滚来兜底，而不是先查后插。",
    },
    {
      type: "heading",
      text: "Redis 层",
    },
    {
      type: "subheading",
      text: "pipeline vs Lua",
    },
    {
      type: "paragraph",
      text: "pipeline 把多条命令批量发给 Redis 减少往返，但每条仍是独立命令，中间可能被其它客户端命令插入，且无法根据前一条结果做条件分支。Lua 脚本在 Redis 服务端单线程原子执行，可以读-分支-写一整段逻辑。Nyauth 用 Lua 做 refresh 轮换正是需要「读旧 token → 判断是否已用 → 决定撤销整个 family」这种条件逻辑。取舍：Lua 适用范围更窄、需小心脚本内逻辑，pipeline 适合纯批量无依赖的命令。",
    },
    {
      type: "subheading",
      text: "Redis 数据丢失时哪些状态可恢复、哪些不可恢复",
    },
    {
      type: "paragraph",
      text: "不能无差别地说「Redis 丢了就完蛋」。可恢复的：会话/令牌这类**短生命、可重建或可重新认证**的状态——用户重新登录即可。不可恢复或不安全降级的：Refresh family 的 used/revoked 标记、授权码、以及用于安全决策的元数据——丢了就意味着**重用检测能力退化**，或无法确认某 token 是否已被撤销。所以 Nyauth 把「撤销/已用/策略」这类影响安全判断的状态做成 fail-closed：Redis 故障时宁可拒绝，也不在状态丢失下放行。",
    },
    {
      type: "subheading",
      text: "TTL 是按 key 还是按集合成员",
    },
    {
      type: "paragraph",
      text: "Redis 的 TTL 只能设在 key 上，不能设在一个 Set/Hash 的单个成员上。Nyauth 的 refresh family 用「每个 token 一个带 TTL 的 key + 一个 family 集合」来模拟成员级过期：给每个成员 key 单独设 PX TTL，并同步设置集合的 PEXPIRE 到足够覆盖最长的成员，从而近似成员级生命周期。这是「TTL 按 key、集合成员借助外部 key 实现过期」的关键区别。",
    },
    {
      type: "subheading",
      text: "为什么要用真实 Redis 测试",
    },
    {
      type: "paragraph",
      text: "Lua 脚本、TTL、Set 成员集合这些语义只有真实 Redis 才完整——内存 fake 无法复现服务端的原子执行、cjson 解析、键过期行为。Nyauth 的测试用真实 Redis 跑集成测试，锁住「并发轮换」「重用检测」「family 撤销」这些只有真品才可信的行为。这正是「集成测试证明什么」那一课的延续。",
    },
    {
      type: "heading",
      text: "OAuth / OIDC 层",
    },
    {
      type: "subheading",
      text: "state、nonce、PKCE 各自防什么",
    },
    {
      type: "list",
      items: [
        "state：防 CSRF 与登录混淆——发起授权时生成随机 state，回调里比对，确保回跳到「我发起的那个」",
        "nonce：防 ID Token 重放——OIDC 在 ID Token 里绑定一次性 nonce，确保这个 token 是回应我这次的请求",
        "PKCE（S256）：防授权码被第三方截取后换 token——用 code_verifier 与 code_challenge 绑定授权码到原始客户端（尤其保护 public client / 原生应用）"
      ]
    },
    {
      type: "subheading",
      text: "redirect URI 为什么必须精确匹配",
    },
    {
      type: "paragraph",
      text: "授权码会被重定向到 redirect_uri。如果允许前缀或模糊匹配，攻击者可以把授权码劫持到自己的地址。精确匹配（path、query、scheme 全等）把「授权码吐给谁」钉死。Nyauth 在配置里对每个 client 精确记录允许的 redirect URIs，并在授权时校验。",
    },
    {
      type: "subheading",
      text: "ID Token 与 Access Token 为什么不能混用",
    },
    {
      type: "paragraph",
      text: "语义不同：ID Token（JWT）证明「用户是谁」，给客户端（前端/原生）展示与验证身份；Access Token 授权「能访问哪些受保护资源」，给资源服务器做授权决策。把 ID Token 当授权用，或把 Access Token 当身份证明用，会制造权限混乱或信息泄露。Nyauth 里二者受众（audience）与用途分离，Access Token 配合 Redis 元数据做撤销，ID Token 按被授予的 scope/claim 限缩。",
    },
    {
      type: "subheading",
      text: "revoke vs introspection",
    },
    {
      type: "paragraph",
      text: "revoke（RFC 7009）让客户端主动作废一个 token——Nyauth 对 refresh token 撤销整条 family、删对应 Redis 元数据；对 JWT access token，由于 JWT 靠签名自证、天生不能被瞬时吊销，Nyauth 用 Redis 元数据/撤销列表配合，或不泄露无效 token 的信息（RFC 7009 不 reveal 无效 token）。introspection（RFC 7662）让资源服务器查询「这个 token 现在还有效吗」——Nyauth 的 `IntrospectTokenForClient` 返回 active + sub/client_id 等，且只能看自己 client 拥有的 token。",
    },
    {
      type: "subheading",
      text: "acr、amr、auth_time 在 Step-Up 里有什么区别",
    },
    {
      type: "paragraph",
      text: "Step-Up（RFC 9470）需要在敏感操作前确认用户最近用更强方式认证过。acr 表示认证上下文等级（多强），amr 列出本次使用了哪些认证方法（密码、TOTP、Passkey、WebAuthn），auth_time 是最近一次认证的时间戳。敏感操作要同时看三个：等级够不够、用的方法对不对、是不是最近——例如「要求近期（auth_time）用 TOTP/Passkey（amr）完成、达到某等级（acr）」。",
    },
    {
      type: "heading",
      text: "安全层",
    },
    {
      type: "subheading",
      text: "HttpOnly Cookie 能否防住 XSS",
    },
    {
      type: "paragraph",
      text: "HttpOnly 只能阻止脚本读取 Cookie 值，**不能**阻止 XSS 本身——如果页面被注入脚本，它仍能代表用户在已有的会话里发起请求（发给本站点时会自动带上 Cookie）。所以 HttpOnly 降低的是「窃取令牌」这一后果，而不是消除 XSS。正确姿势是分层：HttpOnly + 输入输出转义 + CSP + 最小化脚本特权，配合 CSRF 防护。Nyauth 的浏览器会话 Cookie 用 HttpOnly 防窃取，CSRF 靠 SameSite + token 复合防护。",
    },
    {
      type: "subheading",
      text: "SameSite 能否取代 CSRF Token",
    },
    {
      type: "paragraph",
      text: "SameSite=Lax/Strict 能挡住大多数跨站带 Cookie 的请求（现代浏览器里是实用的第一道防线），但它不是万能：老浏览器、跨站子请求、以及某些同站但跨子域场景不一定可靠。所以工程上应复合：SameSite 为主的减轻 + 对表单类接口保留 CSRF Token 或自定义头校验。Nyauth 两者都做。",
    },
    {
      type: "subheading",
      text: "如何避免登录 / 注册 / 邮件重发接口枚举账户",
    },
    {
      type: "paragraph",
      text: "让「存在与不存在」在响应上无法区分：注册时无论邮箱是否已存在都返回同一成功文案；邮件重发对存在/不存在返回一致；登录对「用户不存在」和「密码错误」返回同一错误。配合限流与审计，而不是让接口泄露「这个邮箱已注册」。Nyauth 在注册/邮件接口用统一响应 + 速率限制 + 审计来对抗枚举。",
    },
    {
      type: "subheading",
      text: "为什么安全操作需要近期重新认证",
    },
    {
      type: "paragraph",
      text: "认证是一次性证据，长期有效的会话可能被旁路共享、或被更高风险设备复用。敏感操作（改邮箱、改安全设置、管理操作）需要「最近用足够强的方法认证过」来证明操作者仍是本人。这正是 Step-Up + auth_time 的意义：不是无脑重认证，而是要求认证「够新且够强」。Nyauth 的管理操作（如 `TestRegistrationAdministrationRequiresRecentAuthenticationButRevocationDoesNot`）正是区分「要近期重认证」与「不需」的边界。",
    },
    {
      type: "heading",
      text: "工程层",
    },
    {
      type: "subheading",
      text: "worker 如何处理重复、超时与死信",
    },
    {
      type: "paragraph",
      text: "outbox/worker 至少要处理三类问题：重复（at-least-once，需要幂等消费或一次消费的 token）、超时（处理中途崩溃的任务要能被重新认领，用 SKIP LOCKED 取未完成任务、配超时与租约）、死信（彻底失败的投递要进死信/DLQ 或带重试上限暴露告警，而不是无限循环）。Nyauth 的 outbox worker 用事务提交与幂等 token 避免半处理，配合审计可观测重试与积压。",
    },
    {
      type: "subheading",
      text: "如何让两实例的运行时配置最终一致",
    },
    {
      type: "paragraph",
      text: "用「事务写 + 通知加速 + 对账兜底」：配置变更在一个事务里写库、写审计并 pg_notify；实例订阅通知刷新本地缓存；由于通知可能丢失，周期性 reconciliation 对账会把落后的实例拉回一致。关键是信任对账而不是只信通知。这就是 story 三的核心，测试 `TestRuntimePolicySettingsSynchronizeByNotification` 证明通知同步生效。",
    },
    {
      type: "subheading",
      text: "readiness 与维护暂停如何区分",
    },
    {
      type: "paragraph",
      text: "readiness 是「这个实例能不能开始服务新请求」——用于负载均衡流量摘除、滚动发布；维护暂停（maintenance / drain）是「已经在服务的请求让它排空、暂停接收新流量」以安全下线或更新。二者时序不同：先 readiness 摘流量，再等 in-flight 排空，才安全停止。Nyauth 的 service control 用能力 gate 与 in-flight 排空来协调这一类生命周期。",
    },
    {
      type: "subheading",
      text: "fail-closed 的推理方式",
    },
    {
      type: "paragraph",
      text: "决定 fail-closed（故障时拒绝）还是 fail-open（故障时放行），取决于失败方向的安全代价：认证/策略/撤销状态一旦在陈旧或丢失状态下放行，可能造成安全洞，代价远超一次短暂拒绝 → fail-closed；低风险功能（如可降级的展示性数据）故障时为了可用性可以 fail-open。Nyauth 在 Redis 或状态新鲜度无法证明时对敏感能力选择 fail-closed，理由就是「放行的安全代价 > 拒绝的可用性代价」。",
    },
    {
      type: "heading",
      text: "这一课怎么用",
    },
    {
      type: "paragraph",
      text: "不要试图一次背完。建议分三天：每天攻克两层，每个问题先合上文档用自己的话讲一遍，再对照本课的「框架要点」，只补你没讲到的点。真正到了面试，你讲出来的将是「约束 + 取舍 + 证据」而不是背稿。",
    },
    {
      type: "exercise",
      title: "定时自测：随机抽 5 题限时回答",
      description: "从本课六层中随机抽 5 个问题，每个给自己 60 秒，用「问题→约束→方案→取舍→证据」框架口头回答并录音。回放时只检查三件事：是否讲了约束、是否承认了取舍、是否给了证据（某个 Nyauth 机制或测试名）。连续做三轮，每次换不同组合。",
      hint: "卡住时不要重看全文——只提示「这题的约束是安全性还是可用性」。把答不顺的题目标记出来，重点复习它所在的层。"
    },
    {
      type: "keypoints",
      items: [
        "统一框架：问题 → 约束 → 方案 → 取舍 → 证据",
        "Go：consumer 定义接口、context 作首参不存 struct、handler/service/store 分层、defer 兜底回滚",
        "DB：FOR UPDATE（行锁）vs SKIP LOCKED（队列）vs advisory lock（业务语义锁）；迁移/runtime 账号分离；唯一约束优于先查后插",
        "Redis：Lua 做条件原子、TTL 按 key、区分可恢复/不可恢复状态，用真实 Redis 测试",
        "OAuth：state/nonce/PKCE 各自防什么、精确 redirect URI、ID vs Access、revoke vs introspection、acr/amr/auth_time",
        "安全：HttpOnly 不防 XSS、SameSite 是减轻不是万能、防枚举、近期重认证",
        "工程：worker 重复/超时/死信、对账求最终一致、readiness vs drain、fail-closed 的代价推理"
      ]
    },
  ],
};
