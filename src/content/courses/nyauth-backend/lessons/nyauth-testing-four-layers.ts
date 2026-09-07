/* ==================================================================
 * 课时：四层测试，各自证明什么（nyauth-testing-four-layers）
 * ----------------------------------------------------------------
 * 授课对象：已完成全课程、熟悉 Nyauth 架构，想学会如何用测试
 * 作为证据来验证与调试系统。内容基于 E:/Proj/nya（0.8.0-dev）。
 * 块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "nyauth-testing-four-layers",
  courseSlug: "nyauth-backend",
  title: "四层测试，各自证明什么",
  summary: "纯单元、handler、真实依赖集成、E2E 四层各自能证明与不能证明什么，以及如何把它当可执行规范读。",
  minutes: 22,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "你已经把 Nyauth 的架构读了一遍：PostgreSQL 里的事务与行锁、Redis 里的 Lua 原子轮换、多实例面前的 CAS 与 outbox worker。现在的问题是——这些「设计」凭什么可信？答案不是设计本身，而是测试。但测试有层次，每一层各能证明一点东西、也各有盲区。这一课把四层测试拆开讲：它们各自多快、能证明什么、不能证明什么，以及怎么把它们当成会执行的设计文档来读。"
    },
    {
      type: "heading",
      text: "为什么「测试通过」还分高低"
    },
    {
      type: "paragraph",
      text: "一句「单元测试全绿」听起来很安全，但 Nyauth 的核心不变量大多不在单函数里。刷新令牌的原子轮换发生在 Redis 的 Lua 脚本里；注册的原子性发生在 PostgreSQL 的事务和 SKIP LOCKED 里；旧页面保存配置不能覆盖新值，发生在数据库行的 revision 比较里。这些逻辑如果只用 mock 和内存假数据测试，数据库或 Redis 那层是否真按你想象工作，仍然没人证明。所以测试必须先分层，再决定每一层测什么。"
    },
    {
      type: "heading",
      text: "四层测试一览"
    },
    {
      type: "paragraph",
      text: "Nyauth 的测试大致分四层，从快到慢、从局部到整体。理解每一层的关键，是问一句：「如果这层的断言全绿，谁的行为被证明了？如果它们变红，错的又是什么？」下面这张表就是回答。"
    },
    {
      type: "table",
      caption: "四层测试：速度、能证明什么、示例",
      headers: ["层次", "速度", "能证明什么", "示例"],
      rows: [
        ["纯单元测试", "最快", "解析、校验、状态机、纯业务规则", "internal/oauthstepup、internal/mfa/totp_test.go"],
        ["handler 测试", "中", "HTTP 状态码、鉴权、错误脱敏、DTO", "internal/server/*_test.go"],
        ["真实依赖集成", "慢", "SQL 锁、迁移、Redis Lua、跨实例语义", "internal/database 与 internal/session 的 *_integration_test.go"],
        ["E2E / Playwright", "最慢", "用户实际流程、前后端契约", "web/tests/e2e"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "一个断言越靠上层，它锁住的不变量越「真实」",
      body: "同一个不变量（例如「旧 Refresh Token 重用会撤销整个 family」）其实可以出现在多层的测试里：纯单元验证轮换的数学规则，集成测试用真实 Redis 执行 Lua 脚本并同时在两个实例上轮换，E2E 则让一个真实浏览器走完完整流程。层越低越便宜、越容易定位失败；层越高越逼近用户看到的真相。工程上通常「由低到高」地补：先用便宜的层锁定规则，再用贵的层锁定跨边界语义。"
    },
    {
      type: "heading",
      text: "每一层能证明什么、不能证明什么"
    },
    {
      type: "subheading",
      text: "纯单元测试：局部、确定、极快"
    },
    {
      type: "paragraph",
      text: "纯单元测试不碰数据库，也不发 HTTP，只测一个纯函数或一个状态机。打开 `internal/mfa/totp_test.go`，你会看到 `TestTOTPUsesRFC6238SHA1VectorsTruncatedToSixDigits` 直接拿 RFC 6238 官方向量逐秒验证 TOTP 输出，`TestMatchTOTPAcceptsOnlySixDigitsWithinOneStep` 验证「只接受当前前后一秒、且必须是 6 位数字」。这种测试的价值在于：它把协议标准的确定性规则钉死了，跑得飞快，失败时能精确指出是哪个数学步骤错了。它能证明的是「这个函数在我给这些输入时给出我断言的输出」，仅此而已。它证明不了函数被谁调用、在什么并发下调用、以及调用它的那条链路是否真的提交了事务。"
    },
    {
      type: "subheading",
      text: "handler 测试：锁定 HTTP 边界行为"
    },
    {
      type: "paragraph",
      text: "handler 测试构造一个真实的 HTTP 请求，打进 handler，然后断言返回的状态码、响应 JSON、以及错误响应是否被正确脱敏。它比纯单元更接近用户，能证明「这个端点在正常和异常输入下，对外暴露什么契约」。但它通常用内存 Redis（miniredis）和某种假 store 来隔离下游，所以它证明的是 HTTP 层的契约，而不是数据库或 Redis 的真实行为。错误路径尤其重要：一个端点优雅地返回 409 而不是 500、敏感信息没有泄漏进响应体，这类断言往往比测 200 更有价值。"
    },
    {
      type: "subheading",
      text: "真实依赖集成：证明「真东西」真的按设计工作"
    },
    {
      type: "paragraph",
      text: "集成测试连真实 PostgreSQL 和真实 Redis。打开 `internal/session/store_redis_integration_test.go`，你会看到它通过环境变量 `NYAUTH_TEST_REDIS_ADDR` 连真实 Redis，并且刻意初始化两个 `Store`（`first` 与 `second`）——为什么要两个？因为刷新令牌轮换和重用检测的不变量是跨实例的：必须证明「旧令牌在一个实例被重用，能撤销另一个实例上的整个 family」。SQL 行锁、Lua 脚本的返回码、迁移后的表结构，只有真实依赖才能证伪。它最慢、最贵、通常需要环境变量，但它是唯一能证明原子性与跨实例语义的那一层。"
    },
    {
      type: "subheading",
      text: "E2E / Playwright：锁住真实用户流程与前后端契约"
    },
    {
      type: "paragraph",
      text: "最上层是端到端测试：一个真实浏览器走完登录、授权、注册。它证明「真实用户点击真实页面、后端真的收到预期的请求并返回预期的响应」。它的价值在于前后端契约——DTO 字段名、错误响应格式、重定向地址——任何一端改了而另一端没跟上，只有 E2E 能抓出来。代价是它最慢、最脆，所以通常只在后端契约变化时跑，而不是每次提交都全量运行。"
    },
    {
      type: "callout",
      variant: "warning",
      title: "mock 与真实依赖各自能证明什么",
      body: "mock 证明「我们代码在按我们假设的依赖行为运行时是对的」，它免费、快速、稳定。但一旦判断涉及真实系统的语义——例如 `SELECT ... FOR UPDATE SKIP LOCKED` 是否真的只让一个 worker 领到某行、Redis 的 `EVALSHA` 返回码到底是多少——mock 就从「帮手」变成「危险的假设」。真实依赖测试是那层不得不付的成本：没有它，『并发下只有一个 pending 注册能赢』唯一能靠的就是数据库锁语义，而 mock 锁不住这种语义。面试里被问到 06 章的 mock vs 真实测试，重点就是分清「接缝隔离」与「真实语义」这两件事。"
    },
    {
      type: "heading",
      text: "把测试当作可执行规范来读"
    },
    {
      type: "paragraph",
      text: "Nyauth 的测试名字本身就是一份规格说明书。注意看它们的取名方式：`TestTOTPUsesRFC6238SHA1VectorsTruncatedToSixDigits`、`TestIDTokenUserInfoIsLimitedByGrantedScopes`——标题就是一个完整的断言句，读起来像「TOTP 用 RFC 6238 SHA1 向量、截断到六位」。这比读实现更容易理解设计意图。读一份测试文件的顺序应该是：先扫 all test 函数名和每个函数里的断言，弄清楚「它想保证什么」；再往下问「为了让这个断言成立，实现必须怎么做」——这时候再去读对应的实现，通常几分钟就能定位到那个不变量所在的行。反过来，当你看到一个叫 `TestSomethingWorks` 的名字，往往意味着这个测试没有想清楚自己想锁住什么不变量——好名字应当本身就能当规格念。"
    },
    {
      type: "code",
      title: "推荐的快→慢运行顺序（06 章）",
      language: "text",
      code: "# 1. 最快的纯单元：解析 / 校验 / 状态机\ngo test ./internal/oauthstepup ./internal/auth ./internal/mfa\n\n# 2. handler 层：只跑关心的端点，用 -count=1 禁用缓存\ngo test ./internal/server -run \"TestRegistration|TestPasswordLogin|TestOAuthStepUp\" -count=1\n\n# 3. 真实依赖集成：database / session（需要环境变量）\ngo test ./internal/database ./internal/session -count=1\n\n# 4. 全量 + 竞态 + 静态检查\ngo test -count=1 ./...\ngo test -race ./internal/auth ./internal/session ./internal/server\ngo vet ./...\ngit diff --check",
    },
    {
      type: "paragraph",
      text: "前端测试只在后端契约变化时运行：进入 `web` 目录后执行 `npm run check` 和 `npm run test:unit`。这里的关键是顺序背后的心智模型——先用又便宜又能精确指到失败位置的层快速反馈，把慢而全的层留到最后。`-count=1` 不是可选的对齐：它强制不读 Go 测试缓存，避免「测试真跑了没」的不确定性。"
    },
    {
      type: "heading",
      text: "为什么错误路径和回滚比 200 更重要"
    },
    {
      type: "paragraph",
      text: "只测 200 相当于只测「一切顺利」。但安全与一致性问题几乎都藏在失败路径里：邮件 outbox 写入失败时，用户到底存不存在？注册事务中途回滚后，`self_registrations` 和用户是不是一起消失？配置 revision 冲突时，新值到底有没有被静默覆盖？这些问题的答案恰恰是你最需要锁住的不变量。写测试时脑子里要有一句话：「如果这一步失败了、或者系统在这一步重试/崩溃第二次，数据仍然一致吗？」用测试把这句话变成可执行断言，远比自己手推一遍逻辑可靠。"
    },
    {
      type: "callout",
      variant: "warning",
      title: "race detector 的边界：数据竞态≠逻辑竞态",
      body: "`go test -race` 能抓到真实的数据竞争——两个 goroutine 同时读写同一块内存而没有同步，这在 Nyauth 这类并发系统里非常常见，一定要跑。但它是内存工具的检查：它只能发现「对同一内存地址的无序访问」，发现不了「两段逻辑在时序上本应排他、却因为并发顺序产生了错误结果」的逻辑竞态。一个经典例子：两个实例同时轮换同一个 Refresh Token，各自内存里都没有数据竞争，但结果取决于谁先执行——这种跨实例/跨请求的逻辑竞态，race detector 看不到，只有真实依赖的并发测试（两个 Store 同时操作）能暴露。"
    },
    {
      type: "definition",
      term: "测试意图（test intent）",
      definition: "描述一个测试想锁住的不变量的完整句子，例如「邮件 outbox 写入失败时用户不会存在」。测试名越接近这句意图，这个测试就越像可执行的设计文档；反过来，只能命名为 `TestSomethingWorks` 的测试，往往说明不变量还没被想清楚。"
    },
    {
      type: "heading",
      text: "小结"
    },
    {
      type: "paragraph",
      text: "四层测试是一套「由便宜到昂贵」的证据阶梯：纯单元锁算法规则，handler 锁 HTTP 契约，真实依赖集成锁数据库/Redis 的原子语义，E2E 锁真实用户流程。它们的共同点是都要先想清楚「这一层想证明什么不变量」，而不是为了覆盖率好看。请记住一句判断标准：**「单元测试通过」只证明局部逻辑；涉及 SQL、Lua、Cookie、路由或多实例时，必须看更高层的测试。**"
    },
    {
      type: "quiz",
      question: "你想验证「旧 Refresh Token 重用会撤销整个 family」这个不变量，它最关键地依赖哪一层测试（且为什么）？",
      options: [
        "纯单元测试，因为它最快，能锁住轮换的数学规则",
        "handler 测试，因为它能验证 /token 端点的 HTTP 状态码",
        "真实 Redis 的集成测试，因为它要同时在多个实例上执行 Lua 并验证跨实例撤销",
        "E2E 测试，因为只有真实浏览器能点击刷新"
      ],
      answer: 2,
      explanation: "重用检测的核心语义落在真实 Redis 的 Lua 脚本和多实例之间——「一个实例检测到重用、另一个实例上的整个 family 被撤销」。这个跨实例原子语义，mock 与单实例 handler 测试都证明不了，必须用真实 Redis 的集成测试。纯单元/handler/E2E 可以补充契约层面，但不是证明该不变量最关键的层次。"
    },
    {
      type: "exercise",
      title: "写下一个不变量的测试意图",
      description: "选一个不变量（例如「旧 Refresh Token 重用会撤销 family」，或你熟悉的「邮件 outbox 写入失败时用户不会存在」「最后一个邀请码并发竞争只允许一个 pending 注册」），用一句话写出它的测试意图；然后说明你会用哪一层测试去锁住它、为什么那层最合适，以及测试名该叫什么。",
      hint: "测试意图 = 一句主语明确的断言句，读出来就是一条规格，例如「最后一个邀请码并发竞争只允许一个 pending 注册」。判断层次时问自己：这个不变量依赖数据库锁、Redis Lua 还是跨实例语义？依赖哪一层，就用哪一层的真实依赖测试去锁。测试名应当能直接念出这句意图。"
    },
    {
      type: "keypoints",
      items: [
        "四层：纯单元（算法规则）→ handler（HTTP 契约）→ 真实依赖集成（SQL/Redis/Lua/跨实例）→ E2E（真实流程）",
        "「单元测试通过」只证明局部逻辑；SQL、Lua、Cookie、路由、多实例要看更高层",
        "从快到慢运行：单元 → 目标 handler（-count=1）→ 集成 → 全量 + -race + vet",
        "mock 证明接缝隔离，真实依赖才证明真实语义；跨实例/原子性断言不能只用 mock",
        "读测试=读可执行规范：先扫测试名与断言，再回头找实现为什么成立",
        "错误路径与回滚比 200 更值得测；race detector 抓数据竞态、抓不到逻辑竞态",
        "测试意图要写成一句完整断言，能写成 TestSomethingWorks 往往说明不变量没想清楚"
      ],
    },
  ],
};
