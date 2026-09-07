/* ==================================================================
 * 课时：用证据定位问题：可证伪假设（nyauth-debugging-evidence）
 * ----------------------------------------------------------------
 * 授课对象：已完成全课程、熟悉 Nyauth 架构，想学会用证据而非
 * 猜测来调试。内容基于 E:/Proj/nya（0.8.0-dev）与 06 章调试方法。
 * 块类型见 ../../../types.ts。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "nyauth-debugging-evidence",
  courseSlug: "nyauth-backend",
  title: "用证据定位问题：可证伪假设",
  summary: "把含糊的「登录有问题」变成可检验的断言，逐层观察，先用失败测试锁定不变量再修复。",
  minutes: 18,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "教科书教你怎么写正确的代码，但真实工作里，大量时间花在「找一个还没人定位的 bug」。这一课讲的是有纪律的调试方法：不看一眼就改代码，而是先把「问题」翻译成一个可证伪的假设，再用证据逐层确认或否定它，最后用失败测试把不变量锁死再修复。Nyauth 的多实例、事务与 Lua 结构让「猜哪里错了」尤其危险，因为同样的外层症状可以有完全不同的内因。"
    },
    {
      type: "heading",
      text: "第一步：精确描述症状"
    },
    {
      type: "paragraph",
      text: "「登录有问题」没有任何调试价值——它既不可检验，也不指向任何代码。Nyauth 的文档给出了一套描述模板：请求路径是什么，输入条件是什么，实际返回和预期返回分别是什么，以及你手上有什么证据（HTTP 状态码、响应 JSON、日志里的 request_id、Redis 的 key、数据库的那一行）。比如："
    },
    {
      type: "code",
      title: "把「登录有问题」重写成可检验的现象",
      language: "text",
      code: "# 请求数据：POST /api/login（模拟浏览器会话）\n# 输入条件：用户已绑定 TOTP，且当前 Session 不存在\n# 实际返回：200 并创建了完整 Session\n# 预期返回：MFA pending，且不应创建完整 Session\n# 证据：HTTP 状态码、响应 JSON、日志 request_id、Redis key / 数据库行",
    },
    {
      type: "paragraph",
      text: "这五行已经把「登录有问题」缩小成了一个具体的、可证伪的现象：它说的是「handler 在 MFA 通过前就创建了完整 Session」。你能针对这句断言去验证或反驳它，而不是对着整座服务器瞎猜。写现象时逼自己填「实际 vs 预期」和「证据」两列，正是为了把一个笼统的感受逼成一个可以检查的差异。"
    },
    {
      type: "heading",
      text: "第二步：建立可证伪的假设"
    },
    {
      type: "paragraph",
      text: "基于上面的现象，你可以提出一个具体假设：「可能是 handler 在验证 MFA 之前就调用了 CreateSession，所以完整的 Session 被提前建出来了。」注意这个假设是**可证伪**的：它断言了一个明确的调用顺序，只要去查 handleLogin 的代码顺序或相关测试，就能确认或推翻它。这就是有纪律调试的核心动作——先提出一个能被证伪的说法，再专门去验证它，而不是一次性开十个盲改。"
    },
    {
      type: "callout",
      variant: "tip",
      title: "可证伪 = 能被一个具体证据推翻",
      body: "一个假设如果「无论查到什么都说得通」，那它就不是假设，只是情绪。好的假设要具体到能列出一句「如果看到 X，就说明这个假设错了」。例如「可能是 handler 在 MFA 前建了 Session」→「如果代码里 CreateSession 调用确实在 MFA 校验之后，那这个假设就是错的，我就要去查别处」。这样每查一步，你的错误空间就缩小一块。"
    },
    {
      type: "heading",
      text: "第三步：逐层观察，而不是从中间猜"
    },
    {
      type: "paragraph",
      text: "Nyauth 有一条清晰的分层边界：handler（解析并响应请求）、middleware（鉴权与前置/后置处理）、service（业务状态）、store（事务提交与 Lua 返回码）、worker（领取、重试、去重）。调试时要顺着这条边界从外向内观察，每层问一个对应的问题——而不是随手在一个随机文件里打日志。文档给出了每层该问什么："
    },
    {
      type: "list",
      items: [
        "handler：请求是否被正确解析？参数/JSON 到了没？",
        "middleware：是否提前放行、或重复执行（比如鉴权跑了两次）？",
        "service：业务状态是否完整？状态机走到哪一步？",
        "store：事务到底提交了没有？Redis Lua 脚本的返回码是什么？",
        "worker：任务是否被领取、重试、还是被重复处理了？",
      ],
    },
    {
      type: "paragraph",
      text: "「先问这五层、每层只做一次观察」能避免最常见的浪费：在一个看似可疑的 store 里改了半天，结果发现 handler 压根没把请求传进去。逐层观察的目的，是把「问题在哪一层」这个未知数，一层一层地剥掉。"
    },
    {
      type: "heading",
      text: "第四步：先写一个失败测试，锁住不变量"
    },
    {
      type: "paragraph",
      text: "找到原因后，**不要直接改代码**。先写一个测试，让它复现这个问题、也就是说在当前代码上**失败**，并且这个测试要锁定一个不变量，而不是复现完整 UI。例如「旧 Refresh Token 重用会撤销整个 family」——你先写一个会失败的并发测试断言重用会撤销 family，确认它在当前坏代码上确实红了；然后再去修实现，让测试变绿。这样做有三重价值：它把 bug 变成了一个可重复的回归守卫，它强迫你把「我理解的问题」精确成「一个可执行的断言」，并且它保证之后任何人改坏这件事，测试立刻报警。"
    },
    {
      type: "callout",
      variant: "warning",
      title: "为什么用失败测试修复，而不是盲改",
      body: "盲改的陷阱是：你修了一个表面症状，却可能破坏另一条本应工作的路径，而且没有证据说明「这次真的修对了」——因为你唯一能对照的只有「好像好了」。失败测试给了一次独立于你直觉的验证：改动之前它必须红，改动之后它必须绿，这就把一个主观判断变成了可复现的证据。修复之后，再补 HTTP 或 E2E 测试来证明对外契约没有回归——先锁内部不变量（便宜、精确），再锁对外契约（昂贵、完整）。"
    },
    {
      type: "heading",
      text: "用 request_id 关联日志，而不要按浏览器报错猜"
    },
    {
      type: "paragraph",
      text: "一个问题跨越多层时，最需要的是把「同一份请求/任务」的证据串起来。Nyauth 的结构化日志里带 request_id——这是把 handler、service、store、worker 各层日志拼回同一段因果关系的钥匙。调试时遵循一条规则：**用 request_id 去捞这次请求在每一层留下的日志，逐一比对，而不是盯着浏览器控制台那一条注入脚本报错去猜。**浏览器报错往往只是前端某种失败的表象，真正的原因在服务端某一步；没有 request_id，你就无法把「前端看到的失败」和「后端某一步的异常」对上号。"
    },
    {
      type: "heading",
      text: "三条常见故障定位路线"
    },
    {
      type: "table",
      caption: "三条常见故障：症状 → 依次检查什么",
      headers: ["症状", "按顺序检查"],
      rows: [
        ["页面显示「请求失败」", "浏览器 Network 看 URL/方法/状态码/响应 JSON → handler 看 API error code 是否稳定 → 用 request ID 关联日志 → 确认前端构建来自当前镜像而非旧 build artifact"],
        ["设置保存没有效果", "确认请求真的发出 → 检查 expected_revision 是否最新（旧页面会 409）→ 检查 PostgreSQL runtime_settings 是否已提交 → 看 NOTIFY 后另一实例是否触发 reconciliation → 检查 UI 是否把 null 当数组/字符串用"],
        ["注册返回 503", "看 /api/registration 的 available → 检查 SMTP 是否 configured/active/available、circuit 是否 open → 看 Redis 限流是否可用 → 查用户与 self_registrations 是否被事务回滚 → 看审计与指标的结果分类"],
      ],
    },
    {
      type: "paragraph",
      text: "这三条路线展示的是同一种心智：先沿着请求路径从外向内，用每层的最小证据决定下一步，而不是一次性打开所有文件乱翻。例如「设置保存没有效果」，第一直觉不该是改某个 handler，而是先确认「请求发出没有、expected_revision 是不是旧值」——很可能根本不是代码 bug，而是旧页面带了过期 revision，被 CAS 正确拒绝（返回 409）。"
    },
    {
      type: "heading",
      text: "一个完整走通的调试例子"
    },
    {
      type: "callout",
      variant: "example",
      title: "从症状到修复的完整循环",
      body: "假设「注册并发下出现了两个 pending 注册占用了同一个邀请码」。先描述现象：两个并发 POST /api/registration，同一 invite，实际两个注册都被接受、预期只有一个 pending 注册能赢。建立可证伪假设：「可能是 store 没有用 FOR UPDATE SKIP LOCKED 去锁这一次性邀请码，导致两个事务同时读到了 available」。逐层观察：handler 正常、service 状态正常，于是把观察推进到 store，检查那条 SELECT 是否真的锁了行。然后写一个失败测试：并发跑两次注册，断言只有一个 pending 赢——它在坏代码上红。修好 SQL 后测试变绿，最后补一个 HTTP/E2E 测试证明对外契约没回归。每一步都有证据：这条链路里没有任何一步是「我觉得大概对了」。"
    },
    {
      type: "definition",
      term: "可证伪性（falsifiability）",
      definition: "一个陈述能被某种可想象、可执行的证据所推翻。在调试语境里，它指假设要具体到能列出「如果看到 X，这个假设就错了」——这样的假设才能逐步缩小排查空间，而不是怎么查都「说得通」。"
    },
    {
      type: "heading",
      text: "小结"
    },
    {
      type: "paragraph",
      text: "有纪律的调试是一套循环：精确描述症状（请求/输入/实际 vs 预期/证据）→ 建立可证伪假设 → 按 handler/middleware/service/store/worker 逐层观察 → 先写失败测试锁定不变量 → 修复 → 再加 HTTP/E2E 测试防回归。全程用 request_id 把证据串起来。这套方法真正的价值，是让「我以为我修好了」变成「有证据证明我修好了」——这也是面试里被问到「线上发现 Bug 你先做什么」时的标准答案：先补观测和复现测试，而不是先改代码。"
    },
    {
      type: "quiz",
      question: "「页面显示请求失败」时，下列说法哪个最符合文档推荐的第一步定位思路？",
      options: [
        "直接去改 handler 的返回逻辑，把错误改成更友好的提示",
        "先在浏览器 Network 里看 URL、方法、状态码和响应 JSON，再用 request ID 关联后端日志",
        "重装一次前端依赖，多半是构建缓存问题",
        "在 store 层加一条日志，反正问题一定在数据库"
      ],
      answer: 1,
      explanation: "文档推荐的路线是从外向内：先在浏览器 Network 确认请求本身的方法/状态码/响应 JSON，再用 request ID 把后端各层日志串起来。没看证据就改 handler、重装依赖或直接在 store 打日志都是「从中间猜」，违反了先描述证据、再逐层观察的纪律。"
    },
    {
      type: "exercise",
      title: "把一个含糊症状改写成可证伪陈述",
      description: "取一个模糊症状（例如「管理员改了设置但没生效」），先用本课的模板写出：请求路径、输入条件、实际 vs 预期、可收集的证据；然后据此提出一个可证伪的假设，并列出为了验证或推翻它，你第一步会去收集哪一份证据（例如 expected_revision 是不是旧值、runtime_settings 提交了吗）。",
      hint: "把「没生效」拆成「旧页面带过期 revision 被 CAS 拒绝（409）」或「新值已提交但 UI 把 null 当数组用」等具体断言。每一条都要能回答：看到哪个证据我可以排除它？"
    },
    {
      type: "keypoints",
      items: [
        "先精确描述症状：请求路径、输入条件、实际 vs 预期、证据（状态码/JSON/request_id/Redis key/DB 行）",
        "建立可证伪假设——能列出「看到 X 就说明假设错了」的假设才值得验证",
        "按 handler/middleware/service/store/worker 逐层观察，别从中间猜",
        "先写一个会失败的测试锁定不变量，再修复，最后补 HTTP/E2E 防回归",
        "用 request_id 把一次请求跨层的日志串起来，别只看浏览器报错",
        "常见故障（请求失败 / 设置不生效 / 注册 503）都有从外到内的固定排查路线",
        "线上发现 Bug：先补观测与复现测试，而不是先改代码"
      ],
    },
  ],
};
