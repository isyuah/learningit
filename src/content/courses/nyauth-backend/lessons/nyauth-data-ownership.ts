/* ==================================================================
 * 课时：数据归属：谁在 PostgreSQL、谁在 Redis（nyauth-data-ownership）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts。
 * 权威来源：docs/learning/00-project-overview.md、02-postgresql-redis.md、
 * internal/session/store.go、migrations/000001_baseline.up.sql。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-data-ownership",
  "courseSlug": "nyauth-backend",
  "title": "数据归属：谁在 PostgreSQL、谁在 Redis",
  "summary": "对每一份数据先问「谁是权威来源」，再决定放哪一层存储。",
  "minutes": 18,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "一个认证服务同时连着 PostgreSQL 和 Redis，很多初学者会问：这台服务器究竟把什么放数据库、什么放缓存？简单机械地回答说「热数据放 Redis、永久数据放 PG」是危险的口诀。正确的思考方式是为每一份数据问一个问题：**「如果这东西丢了、或者两份副本说法不一致，我以谁为准？」**——那个「谁」就是这份数据的权威来源（authoritative source）。权威来源决定它存放在哪里、如何写入、如何被消费。"
    },
    {
      "type": "heading",
      "text": "先想清楚：这不是缓存 vs 持久化的二分"
    },
    {
      "type": "paragraph",
      "text": "一个最常见的误解是把 PostgreSQL 当成「持久层」、Redis 当成「加速缓存」，然后默认所有权威数据都在 PG。在 nyauth 里这不是事实：有一部分数据（浏览器 Session、授权码、Refresh Token family、MFA pending）**Redis 本身就是权威**，PostgreSQL 里根本没有它们的长期副本。这两者不是「权威数据 vs 缓存」的分工，而是「长期可查询带约束的数据 vs 短期带 TTL、需要原子消费的状态」的分工。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "「Redis 只是缓存」是一个会误导你的假设",
      "body": "如果 Session 只是 Postgres 的缓存，那么重启 Redis 后重新登录仍是错的印象——丢失 Session = 用户需要重新认证，这是可以被接受的短期状态语义。真正的问题是：你把「必须 durable、丢了就出事故」的数据放进 Redis，还是不假思索地把 Redis 当成一切数据的加速层。先定性这份数据需不需要 durable、可查询、有约束，再选存储。"
    },
    {
      "type": "heading",
      "text": "权威来源清单：一句「谁说了算」"
    },
    {
      "type": "paragraph",
      "text": "项目文档里给过一张数据归属表，它是本章的地图。我们把每一行映射到「权威来源」和「Redis/内存在其中扮演的角色」两个维度："
    },
    {
      "type": "table",
      "caption": "nyauth 里每类数据的权威来源与 Redis/内存的作用",
      "headers": ["数据", "权威来源", "Redis/内存的作用"],
      "rows": [
        ["用户、OAuth Client、授权记录、设置（settings）", "PostgreSQL", "无，或只做缓存快照"],
        ["浏览器 Session、授权码、MFA pending", "Redis（短期权威状态）", "本身就是权威，TTL 到期即失效"],
        ["Access Token 元数据 + JWT", "Redis + JWT 联合", "Redis 持服务端元数据，支持撤销与策略检查"],
        ["审计历史", "PostgreSQL", "outbox 负责可靠投递，最终落 PG"],
        ["邮件待发任务", "PostgreSQL（email_outbox）", "worker claim 与重试都基于 PG"],
        ["当前运行时 gate（capability）", "PostgreSQL revision + 进程内 Controller", "本地快速拒绝，权威在 PG revision"]
      ]
    },
    {
      "type": "heading",
      "text": "为什么这么切：四个理由"
    },
    {
      "type": "paragraph",
      "text": "把长期权威数据放 PostgreSQL，不是因为它「更持久」，而是因为它能提供 Redis 给不了的四个能力。理解这四点，你才能在面试里解释「为什么这里要用 PG 而不是 Redis」。"
    },
    {
      "type": "list",
      "items": [
        "持久性（durability）：断电/重启后数据仍在，用户、授权、审计不能因进程退出而消失。",
        "查询与约束（query + constraints）：支持 SQL 联接、唯一约束、CHECK、外键，是并发竞争的最后防线。",
        "审计（audit）：审计历史必须长期保留、可追溯、可分区管理，Redis 只适合短期状态。",
        "可靠性（reliability）：邮件 outbox 的领取与重试需要 durable 的行，才能实现「至少一次」投递。"
      ]
    },
    {
      "type": "paragraph",
      "text": "把短期状态放 Redis，则是因为它提供了 PG 做得不顺手的三件事：TTL（到期自动失效，无需定时清理）、原子消费（取走即不再可用，如授权码）、速度（单线程内存操作、极低延迟）。注意「原子消费」是 Redis 作为权威的关键：授权码被领取一次后必须立刻失效，这要求消费动作本身具备原子性，而不仅是「存得快」。"
    },
    {
      "type": "definition",
      "term": "权威来源（authoritative source）",
      "definition": "一份数据中，被系统认作「事实基线」的那个副本。发生冲突时以它为准；其它层的副本只是它的投影或缓存。"
    },
    {
      "type": "heading",
      "text": "JWT 为什么仍然需要 Redis 元数据"
    },
    {
      "type": "paragraph",
      "text": "Access Token 是一个 JWT，协议方（Resource Server）验签即可，那么为什么 Redis 里还要存它的元数据？因为「签名有效」≠「尚未被撤销」。JWT 是一种自包含、无状态的凭证——签发之后，如果只凭签名验证，那么即使管理员把用户的某次授权撤销了，旧 token 在签名生命周期内依然有效。"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "JWT 是给协议方看的，Redis 是给服务端看的",
      "body": "JWT 让 Resource Server 无需回访签发服务即可本地验签；Redis 里的 token 元数据让 nyauth 自己在每次调用时能查到「这只 token 是否已被撤销、它的 auth_version / client 授权 revision 是否仍有效、是否属于某个被撤销的 family」。这两者是互补的：JWT 解决「离线可验证」，Redis 解决「在线可撤销」。也正因如此，Access Token 的权威来源被记作「Redis + JWT 联合」。"
    },
    {
      "type": "heading",
      "text": "审计与邮件：最终都要 durable"
    },
    {
      "type": "paragraph",
      "text": "审计历史和邮件待发任务虽然最终都落在 PostgreSQL，但它们的写入模式不是直接同步写完成，而是通过 outbox（发件箱）：业务事务只写一行「待处理事件」，后台 dispatcher 之后再领取并投递。这里要强调的是，outbox 的**权威与可靠性都在 PostgreSQL**——决定「这条邮件必须被尽力发送」的是 durable 的 outbox 行本身，而不是某个进程内存里的队列。这一点将在事务与 outbox 一课里展开。"
    },
    {
      "type": "heading",
      "text": "运行时 gate：PostgreSQL 当权威，进程内做加速"
    },
    {
      "type": "paragraph",
      "text": "一套特别的例子是「当前运行时 gate」（capability）。比如「是否允许注册」「是否允许发信」这类开关，它的权威存放在 PostgreSQL（一个不断更新的 revision/快照），而每个进程里持有一个 Controller 在本地判断，用来在请求早期快速拒绝。为什么权威不直接放在进程内？因为多实例部署下，每个实例的本地状态会漂移——必须有一个所有实例都能对齐的权威基线（PG 的 revision），进程内 Controller 只是它的本地投影，定期与权威同步。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "判断口诀：问问「丢了这个会出事故吗」",
      "body": "在做存储选型时，可以对每份数据跑一遍：如果 Redis 重启后这份数据消失，会造成不可接受的事故吗？会 → 大概率要放 PostgreSQL；不会、反而希望它过期失效 → 适合 Redis。但要注意：Redis 也常常是短期状态的权威来源，不是说放 Redis 就低人一等——只是它擅长的是「短期、原子、带 TTL」这一类权威。"
    },
    {
      "type": "table",
      "caption": "选型决策速查",
      "headers": ["数据特征", "倾向的存储", "原因"],
      "rows": [
        ["长期保留、可查询、需约束/外键", "PostgreSQL", "唯一约束、JOIN、审计、持久化"],
        ["有效期短、过期即失效", "Redis + TTL", "自动过期，无需清理任务"],
        ["一次性消费（授权码）", "Redis 原子消费", "取走即失效，防重放"],
        ["需要撤销的能力", "Redis 元数据 + JWT", "离线验签 + 在线撤销"],
        ["需可靠投递/重试", "PostgreSQL outbox", "durable 行 + worker claim"]
      ]
    },
    {
      "type": "quiz",
      "question": "关于 nyauth 中「浏览器 Session」的数据归属，下列说法正确的是？",
      "options": [
        "Session 只是 PostgreSQL 的缓存快照，权威数据在 users 表",
        "Redis 就是 Session 的权威来源，丢失即代表用户需重新认证",
        "Session 的权威来源是 JWT，Redis 只做加速",
        "Session 必须同时写 PostgreSQL 和 Redis 才能保证不丢"
      ],
      "answer": 1,
      "explanation": "浏览器 Session 属于「短期权威状态」，Redis 本身就是权威来源；它丢失的后果是用户重新认证，这是可接受的语义，而不是把它当作 PG 的缓存。"
    },
    {
      "type": "exercise",
      "title": "给三类新数据做主存储决策",
      "description": "假设 nyauth 新增三类数据：①「API 密钥」需要长期有效、可被管理员随时吊销；②「一次性找回密码链接」有效期 30 分钟、用一次即失效；③「登录失败次数」用于限流、每分钟自动清零。请为每类数据判断权威来源与存放位置，并各写一句理由。",
      "hint": "逐一问：需要 durable/可查询/有约束吗？需要自动过期吗？需要原子消费吗？"
    },
    {
      "type": "keypoints",
      "items": [
        "对每份数据先问「谁是权威来源」，而不是机械地按缓存/持久化二分",
        "PostgreSQL 存长期、可查询、带约束、需审计的数据；Redis 存短期、TTL、需原子消费的状态",
        "浏览器 Session、授权码、MFA pending：Redis 本身就是权威",
        "Access Token = JWT + Redis 元数据：JWT 离线可验证，Redis 在线可撤销",
        "审计与邮件 outbox 的可靠性和权威都在 PostgreSQL",
        "运行时 gate 的权威在 PostgreSQL revision，进程内 Controller 只是本地加速投影"
      ]
    }
  ]
};
