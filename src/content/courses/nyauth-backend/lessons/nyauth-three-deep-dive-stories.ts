/* ==================================================================
 * 课时：三个深挖故事（nyauth-three-deep-dive-stories）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts。slug 必须与 course.ts 大纲一致。
 * 三个故事的代码与测试名均已在 E:/Proj/nya 仓库中核实。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "nyauth-three-deep-dive-stories",
  courseSlug: "nyauth-backend",
  title: "三个深挖故事：事务 outbox、Refresh family、多实例配置",
  summary:
    "把 Nyauth 的三个旗舰工程问题，用「问题 → 旧行为 → 方案/边界 → 失败处理 → 证据」讲成能被反复追问的深挖故事。",
  minutes: 26,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "90 秒介绍里你提到了三个旗舰工程问题，面试官几乎一定会挑其中一个让你「展开讲讲」。这一课教你把它们讲成完整、自洽、有证据的故事。每个故事都用一个统一的结构：**问题 → 错误的旧行为 → 方案与边界 → 失败处理 → 证据（真实测试名）**。同时，每个故事都要诚实地承认它的局限——面试官最想看的，恰恰是你知道自己的方案哪里不完美。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "先记一条万能结构",
      body: "讲任何一个深挖故事时都用这个五段骨架：①问题（抽象成一句话）→ ②错误的旧行为（不这么做会怎样）→ ③方案与边界（做了什么、边界在哪）→ ④失败处理（崩了、重试了、并发了怎么办）→ ⑤证据（哪个测试锁住了这个行为）。先叙事后给证据，面试官才跟得上。"
    },
    {
      type: "heading",
      text: "故事一：注册与邮件的事务 outbox",
    },
    {
      type: "callout",
      variant: "example",
      title: "问题陈述",
      body: "用户注册不是「插一条 users 记录」就完事，而是一串必须同时成立的写操作：用户、自助注册记录、邀请名额占用、验证 token、要发出的验证邮件、以及审计日志。如果没有一个原子边界，就会发生「用户已建、邮件漏发」或「邀请名额被占、注册却没成功」这种部分提交的脏状态。"
    },
    {
      type: "subheading",
      text: "错误的旧行为",
    },
    {
      type: "paragraph",
      text: "最天真的做法是把这些写操作一条条执行：先 INSERT 用户，再发邮件，再写审计。问题是邮件（SMTP 是一个网络调用、可能失败或超时）一旦夹在数据库写操作中间，失败时你就面临脏数据：用户已入库但邮件没发，或者你为了让邮件成功而根本没建用户。更糟的是这类「跨数据库事务 + 外部副作用」的顺序无法原子回滚——要么牺牲一致性，要么牺牲可靠性。",
    },
    {
      type: "subheading",
      text: "方案与边界：一个事务 + 异步 outbox",
    },
    {
      type: "paragraph",
      text: "核心取舍是：**把 SMTP 移出数据库事务，用 outbox 表接住「要发的邮件」，由后台 worker 异步投递。**`CreateRegistration`（位于 internal/user/store.go）在单个数据库事务里完成：用户、自助注册记录、邀请名额保留（ReserveInviteTx）、验证 token 与邮件写入 outbox、以及审计——任何一步失败，`defer tx.Rollback(ctx)` 会回滚整件事。事务提交后，只是「邮件已排入 outbox」这一事实持久化了；SMTP 的发送由 outbox worker 在事务之外进行。",
    },
    {
      type: "list",
      items: [
        "一个事务内同时写入 users、self_registrations、invite 占用、token、email_outbox、audit outbox",
        "SMTP 永远不在事务里：事务只负责把邮件意图持久化到 outbox",
        "失败即整体回滚：任何一步返回 error，用户、邀请占用、审计全部撤销",
        "worker 从 outbox 读未发送记录，发给 SMTP，成功后才标记已发送"
      ]
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么要能回答「为什么 SMTP 不能放进事务」",
      body: "标准答案：数据库事务无法原子地包裹一个外部网络副作用——如果事务先 INSERT 又调 SMTP，SMTP 成功后事务回滚，邮件发了但用户没建（多发了）；SMTP 失败则要么事务回滚丢用户、要么提交了丢邮件。外部调用的成功与否既不在数据库的原子性范围内，也不可靠。outbox 把「我要发」这个意图和业务数据放进同一个原子边界，把「真正发出去」交给可靠重试的 worker——这就是至少一次投递的语义。"
    },
    {
      type: "subheading",
      text: "失败处理与诚实局限",
    },
    {
      type: "paragraph",
      text: "这套方案换来的可靠性是**至少一次（at-least-once）**：worker 可能在发送成功但标记失败前崩溃，于是重试时同一封邮件可能被发送两次。对此工程上有两种缓解方向：让邮件内容幂等（例如验证链接里的 token 只消费一次，重复访问只是再次展示「已验证」或返回明确错误），或接受极少数重复邮件。这是 outbox 模式的天然代价——你必须在面试里主动说出它，而不是等面试官逼问。",
    },
    {
      type: "subheading",
      text: "证据",
    },
    {
      type: "paragraph",
      text: "真实测试锁住了这条行为的边界：`internal/server/registration_http_integration_test.go` 里的 `TestRegistrationHTTPInfrastructureFailureRollsBackAndReturnsUnavailable`——它专门证明当基础设施失败（例如邮件或依赖不可用）时，注册会整体回滚并返回不可用，而不是留下半截数据。同文件还有 `TestRegistrationHTTPRejectsStaleLocalPolicyAndMailSnapshots`，证明使用陈旧本地策略/邮件快照的注册会被拒绝。",
    },
    {
      type: "heading",
      text: "故事二：Refresh Token family 的原子轮换与重用检测",
    },
    {
      type: "callout",
      variant: "example",
      title: "问题陈述",
      body: "长期有效的 Refresh Token 是重大威胁面：一旦泄露，攻击者能用它一直换取新的访问令牌。直觉做法是每次刷新都换一个新 token（轮换），但轮换本身引入新问题——如果攻击者和合法用户都持有旧 token，谁来换走、谁会被当作「重用」？如果把旧 token 的再次出现一律当窃取来处理，你要能原子地撤销整条 family（该用户、该客户端下的一整串后代），并且不能误伤合法并发刷新。"
    },
    {
      type: "subheading",
      text: "错误的旧行为",
    },
    {
      type: "paragraph",
      text: "两个常见坏做法：一是**不轮换**，一个 refresh token 用到过期，泄露即成长期后门；二是**轮换但分步执行**——先读 Redis 里的旧 token，再删旧的、写新的。分步执行是竞态温床：两个并发刷新各自读到同一个旧 token，都会被当作合法，产生两个新 token；而当你检测到其中一个「又用了旧 token」时，已经无法区分配合竞态的正常请求与真正的重放攻击。",
    },
    {
      type: "subheading",
      text: "方案与边界：Redis Lua 原子脚本 + family 元数据",
    },
    {
      type: "paragraph",
      text: "Nyauth 的做法（internal/auth/token.go 的 `RefreshTokenWithClaimPolicy` + internal/session/store.go 的 `rotateRefreshWithAccessScript`）把「校验旧 token → 写入新 token → 新访问令牌元数据 → 把旧 token 标记为已用 → 把 family 里的旧成员移除」放进**单个 Redis Lua 脚本**，在服务端一次执行、原子完成。Redis 元数据和 JWT 一起维护：JWT 本身不承载撤销状态（它无法自证已撤销），真正的 family 成员与已用/已撤销标记都活在 Redis 里。",
    },
    {
      type: "list",
      items: [
        "脚本一次执行完成旧 token 校验、新 token 落库、family 集合更新，中间无并发窗口",
        "旧 token 被标记为 already-used；family 记录保留一定 TTL 以便检测重用",
        "若脚本发现旧 token 已被使用（used 标记存在），说明有人重放旧 token → 撤销整个 family，并返回明确的 `ErrRefreshTokenReuse`",
        "每次成功刷新把新 token 和新 family 成员写进 Redis，access token 的 JWT 之外附 Redis 元数据（含 family_key）"
      ]
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么必须用 Lua，为什么不是「先读后写」或 Redis 事务",
      body: "Lua 脚本在 Redis 里是单线程执行的：执行期间没有其它命令能插入，天然获得原子性，且可以用 cjson 读取、分支、按 family 批量处理。相比之下「先 GET 再 SET」两个独立命令中间有竞态窗口；普通 MULTI/EXEC 只能保证多条命令不被插入，但**不能**根据上一条命令的结果做条件分支（因为是排队一起执行）。要「读到 used 标记就撤销整个 family」这种读-判断-写逻辑，Lua 是恰当的工具。"
    },
    {
      type: "subheading",
      text: "失败处理与诚实局限",
    },
    {
      type: "paragraph",
      text: "这里有一条必须主动承认的局限：**重用检测无法区分「攻击者重放」与「合法用户的网络重试 / 并发刷新」**。比如移动端断线重试把同一请求发了两次，第二次就会触发重用 → 撤销整个 family，把合法用户也登出。这是轮换机制的固有检测盲区：你只能知道「旧 token 被用了两次」，却不知道谁才是合法者。此外，如果 Redis 丢失了 family / used 元数据（比如未持久化重启丢内存数据），检测能力会退化——这也是要在面试里讲清楚「哪些状态可恢复、哪些不可恢复」的原因。",
    },
    {
      type: "subheading",
      text: "证据",
    },
    {
      type: "paragraph",
      text: "internal/auth/auth_test.go 给出了一串直接命中这条行为的测试：`TestRefreshReuseIsReportedDistinctly`（重用的 refresh 被明确报告为 `ErrRefreshTokenReuse`，而不是笼统的无效）、`TestRefreshRejectsRemovedScopesBeforeRotation` 与 `TestRefreshRejectsRemovedClaimsBeforeRotation`（scope/claim 已被撤销的 family 会在轮换前被整体撤销，而不是被换走）、`TestRefreshWrongClientDoesNotMutateToken`（错误 client 不触碰令牌状态）。这些名字能支撑「什么是重用、family 如何因撤销被拒」的断言。",
    },
    {
      type: "heading",
      text: "故事三：多实例运行时配置的一致性",
    },
    {
      type: "callout",
      variant: "example",
      title: "问题陈述",
      body: "认证服务会水平部署多个实例，但登录开关、MFA 要求、会话 TTL、审计保留天数这类「运行时配置」必须在所有实例间一致。两个问题叠加：一是多个管理员可能并发改动同一项配置，后写的会覆盖先写的（失去更新的丢更新问题）；二是单实例内存里缓存了旧配置，改完不通知别的实例，就会「一个实例关了登录、另一个实例还开着」。",
    },
    {
      type: "subheading",
      text: "错误的旧行为",
    },
    {
      type: "paragraph",
      text: "早期版本可能在配置管理界面「先读取当前值、用户改完、再写回」。两个管理员同时打开编辑页，各自基于同一个旧 revision 修改并写回，后提交者覆盖前者——这就是典型的 lost update（A 改完被 B 的旧快照覆盖，A 的改动静默丢失）。另一个坏做法是改了 PostgreSQL 之后只靠各实例的内存缓存自己过期，无法在改动后立刻一致。",
    },
    {
      type: "subheading",
      text: "方案与边界：revision CAS + 事务审计 + LISTEN/NOTIFY + reconciliation",
    },
    {
      type: "paragraph",
      text: "Nyauth 在每个运行时配置项上加一个单调递增的 revision，并强制**乐观并发控制（CAS）**：写操作必须携带它读到的 expected_revision，最终写回语句是 `UPDATE runtime_settings SET value=$2, revision=revision+1 ... WHERE key=$1 AND revision=$4`（internal/settings/policy_store.go 的 `storeSettingTx`）。如果 WHERE 里 revision 不匹配，影响行数为 0，就返回 `ErrRevisionConflict`——后写的管理员必须重新读取最新值再改，绝不允许基于旧快照覆盖。每次配置变更都在**同一个事务**里完成「写配置 + 写审计」并 `pg_notify` 通知频道；实例收到通知后刷新本地内存缓存。",
    },
    {
      type: "list",
      items: [
        "revision 每次 +1，CAS 用 `WHERE revision=$expected` 保证只有基于最新版本的写才成功",
        "配置、审计、NOTIFY 在同一个 PostgreSQL 事务里，避免「配置改了但审计漏记」",
        "实例用 LISTEN/NOTIFY 获知变动，通知触发后重新加载并应用到本地",
        "reconciliation（对账）兜底：即使通知丢失，周期性的对账也会把实例拉回一致",
        "更新后管理接口会等待（WaitApplied）所有实例确认应用了该 revision，而不是只信单点"
      ]
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么不是只用 Redis pub/sub，为什么 LISTEN/NOTIFY 有局限",
      body: "Redis pub/sub 只负责「广播消息」，它不持久化、也不保证到达——订阅者不在线或者消息在两者之间发出，就永久丢掉。PostgreSQL 的 LISTEN/NOTIFY 比它强的是通知承载在数据库上、和配置事务一起提交，但它也有经典局限：同一个连接里同时最多只能阻塞监听一个通知（LISTEN 本身有并发限制），且如果通知在实例的监听间隙发出，同样会丢。所以 Nyauth 不只是依赖通知进行最终一致，而是把**通知当加速器**、把**reconciliation 对账当安全网**——周期性对账保证无论如何都收敛到一致。"
    },
    {
      type: "subheading",
      text: "失败处理与诚实局限",
    },
    {
      type: "paragraph",
      text: "关键设计原则是 **fail-closed**：当某实例无法证明它持有最新状态（例如 Redis 或状态存储不可用、心跳过期、revision 对不上）时，它宁可拒绝受控能力（例如停止接受新的注册、登录），也不要在过期配置下继续放行。这是安全优先于可用性的选择——你必须说明为什么：认证/策略类的守卫一旦在陈旧配置下放宽，就变成安全洞，代价远高于一次短暂不可用。对运维，`servicecontrol/manager.go` 提供 Reset 来在失控时把实例状态重置回已知良好，并配套心跳、reconciliation、maintenance 循环来维持新鲜度。",
    },
    {
      type: "subheading",
      text: "证据",
    },
    {
      type: "paragraph",
      text: "internal/settings/runtime_policy_integration_test.go 给出真实证据：`TestRuntimePolicySettingsCASAuditRollbackAndRetention`（CAS 冲突、审计、回滚与保留策略）、`TestRuntimePolicySettingsSynchronizeByNotification`（两个实例通过通知把配置同步一致）、`TestRuntimeBrandingCASAuditAndLastKnownGood`（品牌配置的 CAS、审计与 last-known-good 兜底）。这些名字直接对应「CAS 防止旧快照覆盖」「通知同步」「失败回退」三件事。",
    },
    {
      type: "heading",
      text: "三个故事的对比与自测",
    },
    {
      type: "paragraph",
      text: "把三个故事放在一张表里，你会发现它们虽然叫「三个问题」，本质是同一个心智的统一应用：**把必须原子或一致的操作收进同一个权威边界（一个事务 / 一条 Lua / 一次 CAS），把外部或跨实例的不可靠因素移出边界，用可重试或对账的机制兜底，并用真实测试锁住行为。**",
    },
    {
      type: "table",
      caption: "三个旗舰工程问题的机制对比",
      headers: ["故事", "权威边界", "跨出的不可靠因素", "兜底机制", "诚实局限", "关键测试"],
      rows: [
        ["注册 + 邮件 outbox", "一个 PostgreSQL 事务", "SMTP 网络调用（移出事务）", "outbox worker 重试 / at-least-once", "重复邮件可能发生", "registration_http_integration_test.go"],
        ["Refresh family 轮换", "一条 Redis Lua 脚本", "并发刷新竞态（读-判断-写原子化）", "family TTL 元数据 + 重用检测", "无法区分攻击者与合法重试，会误登出", "auth_test.go"],
        ["多实例运行时配置", "revision CAS + 单事务", "跨实例异步缓存（通知可能丢）", "LISTEN/NOTIFY + reconciliation 对账", "通知丢失需靠对账兜底；fail-closed 牺牲可用性", "runtime_policy_integration_test.go"]
      ]
    },
    {
      type: "quiz",
      question: "下面哪个机制，专门解决「两个管理员基于同一个旧快照并发改配置，后改的覆盖先改的」这一丢更新问题？",
      options: [
        "Redis Lua 脚本做原子轮换",
        "PostgreSQL 的 revision CAS（`WHERE key=$1 AND revision=$expected`）",
        "outbox worker 的重试与至少一次投递",
        "LISTEN/NOTIFY 先广播再靠对账收敛"
      ],
      answer: 1,
      explanation: "revision CAS 用「只有携带最新 revision 的写才成功」来拒绝基于旧快照的覆盖——这是丢更新问题的直接解药。Lua 解决的是 Refresh 的并发竞态，outbox 解决的是外部副作用与事务的原子性，NOTIFY+对账解决的是跨实例缓存的收敛，都不是丢更新的主解。"
    },
    {
      type: "keypoints",
      items: [
        "每个深挖故事都用五段结构：问题 → 旧行为 → 方案/边界 → 失败处理 → 证据",
        "outbox 把 SMTP 移出事务，换取 at-least-once；要主动承认重复邮件的可能",
        "Refresh family 用单条 Redis Lua 实现原子轮换与重用检测；无法区分攻击者与合法重试",
        "多实例配置用 revision CAS 防丢更新，事务里同时审计并 NOTIFY，对账兜底",
        "fail-closed：不能证明状态新鲜时，宁可拒绝能力也不在陈旧配置下放行",
        "每个故事都有真实测试名可作证据，能说清它锁住了哪个具体行为"
      ]
    },
  ],
};
