/* ==================================================================
 * 课时：outbox worker：至少一次与重试（nyauth-outbox-worker）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与文件名一致。
 * 内容块类型见 ../../../types.ts。
 * 本课时讲解 nyauth 的 outbox 模式：FOR UPDATE SKIP LOCKED、
 * lease、至少一次语义、临时/永久失败与死信处理。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-outbox-worker",
  "courseSlug": "nyauth-backend",
  "title": "outbox worker：至少一次与重试",
  "summary": "为什么业务事务只写「待处理事件」，后台 worker 如何领取、发送、重试与丢弃，以及「至少一次」意味着什么。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "你在前面章节见过：注册事务会同时写入 `email_outbox` 和 `audit_event_outbox`。这背后是一个贯穿式的可靠性模型——outbox（发件箱）模式。它解决的核心问题是：业务请求不能把「发送邮件」「写审计日志」这些副作用塞进响应路径里，因为一旦中途失败，事务和副作用就不一致了。这一课讲 worker 怎么领任务、怎么保证不重复领取、为什么做不到绝不重复，以及失败后怎么区分类别地处理。"
    },
    {
      "type": "heading",
      "text": "为什么用 outbox：事务只保证数据库，不保证 SMTP"
    },
    {
      "type": "paragraph",
      "text": "还记得注册事务的边界吗？一个 pending 注册要同时写用户、自注册记录、邀请预占、验证 token、邮件 outbox 和审计 outbox，全部在一个数据库事务里。「事务提交成功」只意味着数据库里的这些行都落了地——它绝对不意味着 SMTP 服务器已经接受了这封邮件。真正的发送，是后台 worker 之后再领取 outbox 行去做的。这就是 outbox 的真谛：业务事务只负责「可靠地记录待办」，把外部副作用（邮件、审计投递）推迟并解耦出去，让主流程快、稳、可重试。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "把副作用移出请求路径的收益",
      "body": "把邮件发送塞进用户注册请求里，有三个问题：慢（请求要等 SMTP 往返）、脆（SMTP 挂了请求也失败）、不可重试（事务已经提交，发出去的半截副作用没法撤销）。outbox 让请求只写一行「pending 邮件」，立刻返回成功；SMTP 的问题由 worker 异步消化，重试也不会回滚用户的注册。审计同理：先写 outbox 事件，后台再投递到 `audit_logs`。"
    },
    {
      "type": "heading",
      "text": "领取：为什么是 FOR UPDATE SKIP LOCKED"
    },
    {
      "type": "paragraph",
      "text": "多实例都可能跑 worker，同一个 outbox 行绝不能让两个 worker 同时处理。`ClaimEmailBatch`（account/outbox.go）的做法是在一个事务里先 `SELECT id ... FOR UPDATE SKIP LOCKED` 挑候选，再 `UPDATE` 把这些行标记为 `sending`、`attempt_count+1`、写入 `locked_at` 和 `locked_by`，然后提交，最后在事务外做真正的发送。"
    },
    {
      "type": "code",
      "title": "领取批次（ClaimEmailBatch 的核心 SQL 思路）",
      "language": "sql",
      "code": "-- 候选行：可投递的 pending/failed（到期可用），或 lease 已超期的 sending\nWITH candidates AS (\n  SELECT id FROM email_outbox\n  WHERE expires_at > $1 AND (\n    (status IN ('pending','failed') AND available_at <= $1)\n    OR (status='sending' AND locked_at < $2)   -- $2 = now - lease（旧 lease 超期可被重新认领）\n  )\n  ORDER BY available_at, created_at\n  FOR UPDATE SKIP LOCKED   -- 已被其它 worker 锁住的行直接跳过，不阻塞\n  LIMIT $3\n)\nUPDATE email_outbox AS outbox\nSET status='sending', attempt_count=attempt_count+1,\n    locked_at=$1, locked_by=$4, updated_at=$1\nFROM candidates WHERE outbox.id = candidates.id;"
    },
    {
      "type": "paragraph",
      "text": "`FOR UPDATE SKIP LOCKED` 是这里的关键。`FOR UPDATE` 锁定候选行，保证两个并发事务不会选中同一行；`SKIP LOCKED` 则让第二个事务直接跳过已被锁的行而不是傻等——这正是「多 worker 分批领取」的利器，代价是公平性略差（忙的 worker 会抢走更多），这在 outbox 场景可接受。`locked_by` 记录 workerID，后面 `MarkEmailSent`/`MarkEmailFailed` 都要 `WHERE ... AND locked_by=$workerID`，防止一个 worker 去动已被别人重新认领的行（返回 `ErrOutboxLeaseLost`）。"
    },
    {
      "type": "heading",
      "text": "至少一次（at-least-once）的真实含义"
    },
    {
      "type": "paragraph",
      "text": "outbox 是「可靠但不是 exactly-once」的。看邮件流程：worker 领取（数据库提交）→ 调 SMTP 发送 → 成功后再 `MarkEmailSent` 把行标为 sent。如果 worker 在 SMTP 发送成功后、写回 sent 前崩溃了，重启后如何？这一行的状态仍是 `sending`，且 `locked_at` 会随着 lease 超时被另一个 worker 重新认领——那封邮件会被「再发一次」。这就是重复。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "outbox ≠ exactly-once",
      "body": "数据库事务能保证「database 提交只发生一次」，但保证不了「SMTP 服务器只收到一次」。跨系统的外部副作用无法用同一个数据库事务的原子性约束。这个窗口（外部发送成功 → 标记 sent 之间）是 at-least-once 的固有部分。所以要坦诚：outbox 保证的是「至少一次、不丢、可重试」，而不是「绝不重复」。处理重复靠两层：业务容忍（多收一封验证邮件通常无碍）和幂等（如审计投递用 OUTBOX ID 做幂等键，见下）。面试时一定要主动说出这个限制，不要把「用了 outbox」说成「绝不重复」。"
    },
    {
      "type": "heading",
      "text": "失败分类：领取失败 / 临时 / 永久"
    },
    {
      "type": "paragraph",
      "text": "worker 必须区分三类失败，处理方式完全不同。混淆它们会导致灾难：例如把「某个收件人地址无效（永久失败）」当成系统级 SMTP 故障去熔断整个邮件通道，会把所有邮件都停掉。nyauth 的邮件 dispatcher 用 `SMTPErrorDetails` 对错误分类，`smptError.Category` 分 configuration/authentication/tls/transport/recipient，`Permanent` 标志区分临时与永久。"
    },
    {
      "type": "table",
      "caption": "Outbox 失败的类别与处理（邮件 worker 视角）",
      "headers": ["失败类别", "含义", "nyauth 的处理"],
      "rows": [
        ["领取失败", "ClaimEmailBatch 本身出错（DB 问题、邮件 service control gate 变了、熔断开关打不开）", "本轮放弃，记 onError，不推进任何行；gate/circuit 变化会刷新 sender 后重试"],
        ["临时失败", "收件人暂时不可达、SMTP transport 抖动，但值得重试", "MarkEmailFailed：状态回 failed，available_at 设为重试时间点，指数退避后重新可领"],
        ["永久失败", "收件人地址永久错误等，重试也不会好", "MarkEmailRejected：状态 rejected（视为死信），只记该行失败，绝不熔断整个 SMTP circuit"],
        ["进程在外部动作后崩溃", "SMTP 已发但没写回 sent", "lease 超期后被重新认领重发 => 重复；用幂等/业务容忍兜底"]
      ]
    },
    {
      "type": "paragraph",
      "text": "注意「永久收件人失败不得让整个 SMTP circuit 熔断」——这是第 104 行资料特意强调的。SMTP circuit breaker 是对「整个通道」（配置、认证、TLS、transport）的健康判断，熔断时所有投递暂停；而单个收件人的永久失败只是这一条消息的终局判断，把它标记 rejected 即可，继续投其它邮件。把两者分开，一个坏地址才不会拖垮整条邮件管线。"
    },
    {
      "type": "heading",
      "text": "邮件 outbox 与审计 outbox 的对照"
    },
    {
      "type": "paragraph",
      "text": "两个 outbox 用同一个模式，但终态处理略有不同，值得对照："
    },
    {
      "type": "list",
      "items": [
        "邮件（ClaimEmailBatch / MarkEmailSent / MarkEmailFailed / MarkEmailRejected）：外部 SMTP 副作用，终态可 sent / failed / rejected / expired；额外提供 MailDeliveryGate 与共享熔断协调，投递前要过 gate",
        "审计（ClaimAuditBatch / DeliverAuditEvent / MarkAuditEventFailed）：投递目标是本数据库的 audit_logs；DeliverAuditEvent 用 `ON CONFLICT (id,created_at) DO NOTHING` 以 outbox 事件 ID 为幂等键——重复投递同一条事件不会产生重复审计行，这比邮件更容易做到幂等",
        "两者都指数退避重试：retryDelay / auditRetryDelay 都是 `1<<(attempt-1)` 分钟，attempt 封顶到 7",
        "审计顶多用 failed 重试，processed 行会定时清理；邮件过期（expires_at 到）会清空敏感 payload 并置 expired"
      ]
    },
    {
      "type": "exercise",
      "title": "设计一个带重试 + 退避 + 死信的 outbox worker",
      "description": "你负责实现一个「通知回调」outbox。要求：多 worker 并行领取不重复；临时失败按 1/2/4/8 分钟指数退避重试，最多 N 次；永久失败进入死信表并告警；进程崩溃后任务不丢。请写出领取 SQL（含 FOR UPDATE SKIP LOCKED、lease 超期重认领）、状态机、退避与死信的触发条件，并说明在哪些点上重试仍可能产生重复、你如何降低其影响。",
      "hint": "状态机可用 pending -> processing(带 locked_by/locked_at) -> sent / failed(retry) / dead。领取条件同时覆盖「到期的 pending/failed」与「lease 超期的 processing」。按 AttemptCount 计算下次 available_at；超 maxAttempts 移入死信并可写一条告警指标。重试窗口的重复点就是外部副作用成功与标记 sent 之间，考虑给回调方一个幂等键或业务幂等。"
    },
    {
      "type": "quiz",
      "question": "关于 outbox 的 at-least-once 语义，下面哪句最准确？",
      "options": [
        "数据库事务保证每条消息恰好发送一次",
        "worker 在 SMTP 发送成功后立即返回，绝不重复",
        "外部副作用成功到标记 sent 之间崩溃可能造成重复，因此需要幂等或业务容忍",
        "SKIP LOCKED 完全消除了重复发送的可能"
      ],
      "answer": 2,
      "explanation": "数据库事务能保证提交原子，但保证不了 SMTP 收到一次。发送成功到 MarkEmailSent 之间存在崩溃窗口，lease 超期后消息被重新认领重发——这就是 at-least-once 的重复来源，只能靠幂等或业务容忍缓和，无法用 DB 事务根除。"
    },
    {
      "type": "keypoints",
      "items": [
        "outbox：业务事务只写待处理事件，外部副作用由后台 worker 异步执行",
        "领取用 FOR UPDATE SKIP LOCKED + lease（locked_by/locked_at），避免多 worker 重复领取同一行",
        "语义是 at-least-once：发送成功到标记 sent 之间崩溃会重发，需幂等/业务容忍",
        "区分领取失败（本轮放弃）、临时失败（指数退避重试）、永久失败（死信 rejected）",
        "永久收件人失败不得熔断整个 SMTP circuit；熔断是对整个通道，不是对单条消息",
        "审计 outbox 用 outbox 事件 ID 做幂等键（ON CONFLICT DO NOTHING），比邮件更易幂等",
        "邮件 worker 与审计 worker 都是定时 tick 驱动，重试退避为 1<<(attempt-1) 分钟、封顶 7"
      ]
    }
  ]
};
