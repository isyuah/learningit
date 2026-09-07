/* ==================================================================
 * 课时：事务与 outbox：注册链路（nyauth-transactions-outbox）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts。
 * 权威来源：internal/user/store.go#CreateRegistration、
 * internal/account/outbox.go#ClaimEmailBatch、internal/audit/outbox.go。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-transactions-outbox",
  "courseSlug": "nyauth-backend",
  "title": "事务与 outbox：注册链路",
  "summary": "注册是整体原子的事务，但真正发邮件是事务之后 worker 的事。",
  "minutes": 24,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "前几章我们把用户、邮件 outbox、审计 outbox 都押给了 PostgreSQL。这一章回答关键问题：一次注册要写用户、写注册记录、预占邀请码、写验证 token、投递验证邮件、记审计——这六件事怎么保证「要么全成、要么全不成」？答案是一个**单一 PostgreSQL 事务**，而真正的 SMTP 发送则被挪到了事务外部、由一个后台 worker 完成。理解这个「事务 + outbox」的组合，是看懂注册链路一致性的钥匙。"
    },
    {
      "type": "heading",
      "text": "注册链路：六件事同时落地"
    },
    {
      "type": "paragraph",
      "text": "以源码 `CreateRegistration`（internal/user/store.go）为看板。它在一个事务里同时完成以下写入，任一步失败都整体回滚："
    },
    {
      "type": "list",
      "items": [
        "写入 `users`：新用户行（pending 或 active）",
        "写入 `self_registrations`：一次注册的 durable 生命周期记录",
        "预占邀请码（invite reservation）：占用一个可用名额",
        "写入验证 token：邮件验证所需的 artifacts",
        "写入 `email_outbox`：一条待发送的验证邮件任务",
        "写入 `audit_event_outbox`：审计事件（用户已注册、邀请已消耗）"
      ]
    },
    {
      "type": "code",
      "title": "CreateRegistration 的事务骨架（忠实于源码结构）",
      "language": "go",
      "code": "func (s *Store) CreateRegistration(ctx, u, options) (*uuid.UUID, error) {\n    tx, err := s.db.Begin(ctx)\n    if err != nil { return nil, err }\n    defer tx.Rollback(ctx)          // 任何 return 前未 Commit 都会回滚\n\n    // 1. 运行时 gate 检查（共享锁 + 设置快照）\n    runtimecoord.LockRegistrationShared(ctx, tx)\n    settings.RequireRegistrationTx(ctx, tx, options.Registration)\n\n    var inviteID *uuid.UUID\n    if options.InviteCodeHash != nil {\n        inviteID, err = registration.ReserveInviteTx(ctx, tx, *options.InviteCodeHash, now)\n        if err != nil { return nil, err }\n    }\n    insertUser(ctx, tx, u, ...)            // users\n    registration.InsertTx(ctx, tx, ...)    // self_registrations\n    account.ReplaceActionAndQueueEmailTx(ctx, tx, ...) // token + email_outbox\n    audit.EnqueueTargetResultTx(ctx, tx, ...)          // audit_event_outbox\n\n    if err := tx.Commit(ctx); err != nil { return nil, err }\n    return inviteID, nil\n}"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "defer tx.Rollback 是安全网",
      "body": "注意源码用 `defer tx.Rollback(ctx)` 兜底：无论事务中途哪一步 `return err`，defer 都会执行回滚；只有显式 `tx.Commit(ctx)` 成功之后，事务才算真正提交。这正是「回滚决策只有一个出口」的写法，避免了「某条分支漏回滚」的经典错误。"
    },
    {
      "type": "heading",
      "text": "为什么 SMTP 发送不能放进数据库事务"
    },
    {
      "type": "paragraph",
      "text": "你可能想：既然要原子，为什么不在同一个事务里直接调 `smtp.Send(...)`？因为数据库事务的原子性**只覆盖数据库内部的操作**，覆盖不了外部系统。假设在事务里直接发邮件：如果邮件服务器接受、但随后事务提交失败回滚——用户并没有注册成功，邮件却已经寄出，用户收到一封「请验证」却点不进去。更糟的是，外部调用发生在事务持锁期间，会把事务拖得极长，阻塞其它并发事务。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "事务保证的是「DB 提交原子性」，不是「SMTP 已收信」",
      "body": "把外呼塞进事务是典型反例：事务在持锁且不可回滚外部副作用。正确做法是——事务里只写一行「待发送」的 email_outbox 记录，然后立即提交；SMTP 真正发送交给事务之外的 worker。这样 DB 原子性保护的是「注册是否成功」，而邮件投递由 outbox 的可靠语义兜底。"
    },
    {
      "type": "heading",
      "text": "outbox：业务只写事件，worker 之后领取"
    },
    {
      "type": "paragraph",
      "text": "outbox（发件箱）模式把「业务状态变更」和「发送副作用」解耦：业务事务只负责把「待发送事件」写进 durable 的 outbox 表，后台 dispatcher 之后从中领取并真正发送。这样做到了一件关键的事：**「这条邮件必须被发送」的保证从业务事务里移到了 durable 的数据库行上**——只要提交成功，outbox 里就有一条待办，即使进程此刻崩溃，重启后 worker 会重新领取。"
    },
    {
      "type": "code",
      "title": "实现 outbox 的 worker 形态",
      "language": "go",
      "code": "// 业务事务里只排入一条待办，不发邮件\ntx: account.ReplaceActionAndQueueEmailTx(ctx, tx, action, email) // email_outbox 新增 pending 行\n    tx.Commit()\n\n// 后台 dispatcher 循环：\n//  1. 领取：ClaimEmailBatch 用 FOR UPDATE SKIP LOCKED 抢一批待办\n//  2. 发送：调用 SMTP\n//  3. 成功 -> MarkEmailSent(status='sent')\n//  4. 失败 -> MarkEmailFailed(status='failed', retryAt=...) 之后重试\n// 崩溃时：已领但未 mark 的行会在 lease 过期后再次可领"
    },
    {
      "type": "definition",
      "term": "outbox（发件箱）模式",
      "definition": "业务事务只写一行待处理事件（不直接做副作用）；后台 dispatcher 之后从 durable 的表里领取并执行副作用。副作用请求的可靠性由数据库行保证，而不是由进程内存队列保证。"
    },
    {
      "type": "heading",
      "text": "至少一次（at-least-once）与诚实的能力边界"
    },
    {
      "type": "paragraph",
      "text": "outbox + worker 带来的投递语义是**至少一次**，不是恰好一次（exactly-once）。为什么会重复？因为 worker 可能在「邮件已发送成功」与「把状态写回 sent」之间崩溃——它以为没发完，重启后重新领取同一行，于是同一条邮件被发了两遍。这个窗口是真实存在的：领取是原子的，但「发送 + 写回发送结果」这段跨外部系统的过程无法与数据库事务原子绑定。"
    },
    {
      "type": "callout",
      "variant": "example",
      "title": "诚实的能力边界",
      "body": "面试时不要只说「我们用了 outbox，所以绝不重复」。正确的说法是：outbox 保证的是「至少一次」投递，SMTP 这类外部系统我们只能尽量降低重复（幂等、去重、指数退避重试、死信），无法凭数据库事务让外部 SMTP 做到 exactly-once。能主动说出这个限制，比把 outbox 吹成「绝不重复」更能体现对系统真相的理解。"
    },
    {
      "type": "paragraph",
      "text": "这套设计还包括能力 gate 的检查：发信 worker 在领取前会检查邮件投递 gate 是否开启（`RequireMailDeliveryGate`），如果在注册时 gate 被关闭，注册事务会直接失败而不会产生一条永远无法投递的邮件——即「注册成功」与「邮件可投递」的承诺保持一致。"
    },
    {
      "type": "table",
      "caption": "注册链路：谁在事务里、谁在事务外",
      "headers": ["操作", "位置", "失败影响"],
      "rows": [
        ["写 users / self_registrations / invite / token / outbox / audit", "同一 PG 事务内", "任一失败，全部回滚"],
        ["能力 gate 检查", "事务内（读设置快照）", "gate 关闭则注册失败"],
        ["调用 SMTP 发送", "事务外（worker）", "发送失败进 failed/qued 重试，不影响已提交注册"],
        ["标记 sent / failed", "worker 独立事务", "崩溃后按 lease 重新领取（可能重复发送）"]
      ]
    },
    {
      "type": "quiz",
      "question": "关于注册链路中的事务，下列说法正确的是？",
      "options": [
        "事务会直接调用 SMTP 发送验证邮件，确保邮件和注册同时完成",
        "数据库事务保证「DB 提交原子性」，不保证 SMTP 已接受邮件；发送由事务外的 worker 完成",
        "outbox 保证每封邮件恰好发送一次，绝不重复",
        "如果 worker 崩溃，已领取的邮件会永久丢失"
      ],
      "answer": 1,
      "explanation": "事务只保证 DB 提交原子性；SMTP 发送在事务外的 worker 中完成。outbox 是至少一次语义，worker 崩溃后按 lease 会重新领取，可能重复但不会丢（不会永久丢失）。"
    },
    {
      "type": "exercise",
      "title": "预测 outbox 写失败后的数据库状态",
      "description": "模拟一种失败：`CreateRegistration` 已经写入了 users 行和 self_registrations 行，但在 `account.ReplaceActionAndQueueEmailTx`（写 verify token + email_outbox）这一步返回了错误。请回答：此时数据库里 users、self_registrations、invite 预占、email_outbox 中分别留下了哪些行？为什么？",
      "hint": "只要事务尚未 Commit 且 defer tx.Rollback 生效，任何一步失败都会回滚整个事务——users、self_registrations、invite 预占、email_outbox 应全部不剩余。"
    },
    {
      "type": "keypoints",
      "items": [
        "注册是单一 PostgreSQL 事务：users + self_registrations + invite 预占 + token + email_outbox + audit 同生共死",
        "defer tx.Rollback 兜底，只有显式 Commit 成功才算提交",
        "SMTP 发送不能放进事务：外部副作用不可随 DB 回滚，且会拖长持锁时间",
        "outbox 把「待发送事件」写进 durable 表，worker 事务外领取并投递",
        "outbox 语义是至少一次（at-least-once），不是 exactly-once；要主动说出这个限制",
        "能力 gate 在事务内检查，保证「注册成功」与「邮件可投递」承诺一致"
      ]
    }
  ]
};
