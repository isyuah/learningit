/* ==================================================================
 * 课时：行锁、SKIP LOCKED 与 advisory lock（nyauth-postgres-locking）
 * ----------------------------------------------------------------
 * 内容块类型见 ../../../types.ts。
 * 权威来源：02-postgresql-redis.md、internal/registration/lifecycle.go、
 * internal/account/outbox.go、migrations/000001_baseline.up.sql。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-postgres-locking",
  "courseSlug": "nyauth-backend",
  "title": "行锁、SKIP LOCKED 与 advisory lock",
  "summary": "并发竞争时选对锁机制：约束、行锁、跳过锁定、还是约定式互斥。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "数据库并发控制的难点不在于「要加锁」，而在于「选哪种机制」。太多问题其实是同一个形态：两个请求同时要改同一份资源，怎么保证只有一个赢、且赢后的状态一致。nyauth 在同一套 system 里用到了五种不同的手段——唯一约束、`FOR UPDATE`、`FOR UPDATE SKIP LOCKED`、advisory lock、CAS revision。它们的适用场景完全不同，误用会把「防重复」错当成「防互斥」，或反过来。这一章建立一个决策框架。"
    },
    {
      "type": "heading",
      "text": "普通 SELECT 不是锁"
    },
    {
      "type": "paragraph",
      "text": "先说 MVCC 的直觉基础。PostgreSQL 用多版本并发控制（MVCC）：每个事务看到的是自己事务开始时的快照，普通 `SELECT` 不持有任何写锁，也不会阻塞其它事务。这意味着「先 SELECT 看剩余名额，再 UPDATE 扣减」这种经典模式是脆弱的——两个事务可以同时通过 SELECT（都看到还有 1 个名额），然后各自继续，导致名额被超卖。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "「先查再改」最易出丢失更新",
      "body": "在 READ COMMITTED 下，`SELECT 剩余名额` 看不到其它尚未提交事务的修改；两个事务各自读到旧值，随后都写入，后写覆盖先写，形成丢失更新（lost update）。要建立提交边界，必须锁定目标行并在同一个事务里完成「判断 + 更新」，让第二个事务等第一个提交后才执行。"
    },
    {
      "type": "heading",
      "text": "机制一：唯一约束——最后防线"
    },
    {
      "type": "paragraph",
      "text": "唯一约束是「防重复值」的最终防线，它由数据库在索引层面保证，不依赖任何应用层锁。在 nyauth 里，用户名、邮箱、Client ID、Provider 外部 ID 都用它兜住了并发注册的重复问题——即便两个请求同时通过了前置校验，最终只有一个能插入成功，另一个撞上唯一冲突而失败。"
    },
    {
      "type": "code",
      "title": "Schema 里的唯一约束（baseline 迁移）",
      "language": "sql",
      "code": "username VARCHAR(64) NOT NULL UNIQUE;\n-- 邮箱按规范化形式唯一（大小写/空白不敏感）\nCREATE UNIQUE INDEX idx_users_email_normalized\n  ON users (LOWER(BTRIM(email))) WHERE email IS NOT NULL;\n-- Provider 维度唯一，防止同一外部账号被绑定两次\nCONSTRAINT identities_external_unique UNIQUE (provider, external_id);"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "唯一约束 ≠ 优雅的用户提示",
      "body": "唯一约束会在提交时让某个事务抛出冲突错误。它保证的是数据最终唯一，而不是用户体验——应用层仍需要把这个数据库错误转换成「用户名已被占用」这样的友好提示。面试里常被问「为什么有唯一约束还要做应用层转换」，答案就在这里：一个保证不变量，另一个负责把不变量被违反的情况翻译成用户可以理解的反馈。"
    },
    {
      "type": "heading",
      "text": "机制二：FOR UPDATE——锁住你要改的行"
    },
    {
      "type": "paragraph",
      "text": "当你需要「锁定将被修改的行、在同一事务里判断并更新」时，用 `SELECT ... FOR UPDATE`。它把命中的行加写锁，直到事务提交/回滚才释放；第二个事务遇到这些行会等待。nyauth 的邀请码预占正是这个模式：`ReserveInviteTx` 用 `SELECT ... FROM invites ... FOR UPDATE` 锁住目标 invite 行，然后检查 `max_uses` 是否还有余量。"
    },
    {
      "type": "code",
      "title": "ReserveInviteTx：锁行 + 判断容量（源码）",
      "language": "go",
      "code": "SELECT id, max_uses FROM invites\nWHERE code_hash=$1 AND revoked_at IS NULL AND expires_at>$2\nFOR UPDATE   -- 锁住这行，串行化对同一邀请码的竞争者\n\n候选事务在拿到锁后重新读取当前 max_uses（此时已包含先前\n已提交的预占），在同事务内比较剩余名额并决定是否可预占。"
    },
    {
      "type": "paragraph",
      "text": "这解决了经典的「最后一个名额竞争」：两个请求都要用最后一个可用邀请名额。如果只是先查再用，两个都通过；用 `FOR UPDATE` 锁定目标行后，第二个事务会等待第一个提交，等它再读 `max_uses` 时名额已经用尽，于是失败。锁的作用是把「判断」和「更新」放进同一个提交边界。"
    },
    {
      "type": "heading",
      "text": "机制三：FOR UPDATE SKIP LOCKED——多 worker 抢任务"
    },
    {
      "type": "paragraph",
      "text": "outbox dispatcher 的场景不同：不是「只有一个竞争名额」，而是「多个 worker 同时从一张表里抢任务，每人拿一批，且不能重复拿同一行」。若用普通 `FOR UPDATE`，worker 会互相阻塞、串行领取，吞吐很低。`FOR UPDATE SKIP LOCKED` 让每个 worker 跳过已被其它事务锁住的行，各拿自己那批，互不等待。"
    },
    {
      "type": "code",
      "title": "ClaimEmailBatch / ClaimAuditBatch：SKIP LOCKED 领取",
      "language": "sql",
      "code": "WITH candidates AS (\n    SELECT id FROM email_outbox\n    WHERE (status IN ('pending','failed') AND available_at<=$1)\n       OR (status='sending'  AND locked_at<$2)  -- lease 过期可重新领取\n    ORDER BY available_at, created_at\n    FOR UPDATE SKIP LOCKED   -- 跳过已被别的工作者锁住的行\n    LIMIT $3\n)\nUPDATE email_outbox AS o\nSET status='sending', attempt_count=attempt_count+1,\n    locked_at=$1, locked_by=$4, updated_at=$1\nFROM candidates WHERE o.id=candidates.id\nRETURNING o.id, ...;"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "SKIP LOCKED 换来的代价：公平性",
      "body": "`FOR UPDATE SKIP LOCKED` 只为并发吞吐优化，它不保证领取的公平性——某个 worker 可能总是抢到前面的任务，其它 worker 拿到得少，甚至可能出现饥饿。这在「队列式消费」里是常见且通常可接受的取舍，但面试常问「SKIP LOCKED 适合队列，但可能带来什么公平性问题？」，要能答出这一点。"
    },
    {
      "type": "heading",
      "text": "机制四：advisory lock——没有天然行可锁时"
    },
    {
      "type": "paragraph",
      "text": "有时根本没有「那行数据」可锁，但你又需要全局互斥——例如月度维护（把某些长期任务串行化、避免多个实例同时执行）、运行时控制、或配额边界。这时用 PostgreSQL 的 advisory lock（会话级/事务级咨询锁）：大家约定「用同一个整数钥匙代表同一件事」，拿到锁的人才执行，等同于一把命名互斥锁。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "advisory lock 只是约定式互斥，不是约束",
      "body": "advisory lock 用得好是「分布式互斥」，用错了是坑：它靠的是所有参与者遵守同一约定，数据库并不「记得」这把锁对应什么不变量。不要把它当成万能锁去兜底所有并发问题——数据最终的唯一性、关联完整性仍应由唯一约束、外键和事务保证。换句话说：advisory lock 管「互斥执行」，约束管「数据正确」。"
    },
    {
      "type": "heading",
      "text": "机制五：CAS revision——防止旧页面覆盖新设置"
    },
    {
      "type": "paragraph",
      "text": "管理设置（settings）是一类特殊的并发问题：两个管理员窗口同时编辑，各自基于旧版本，后保存的人不应静默覆盖先保存的人的修改。nyauth 用 CAS（Compare-And-Swap）revision：设置快照带一个单调递增的 revision（`BIGINT GENERATED ALWAYS AS IDENTITY`），更新时携带「我当时读到的 revision」，数据库只在 revision 匹配时才应用更新——不匹配说明数据已被别人改过，请求失败，前端刷新重试。"
    },
    {
      "type": "definition",
      "term": "CAS revision",
      "definition": "乐观并发控制：携带读取到的版本号执行更新，数据库在版本匹配时写入、不匹配时拒绝，从而防止「基于过期快照」的覆盖更新。"
    },
    {
      "type": "table",
      "caption": "锁机制选型速查",
      "headers": ["机制", "适用场景", "nyauth 例子"],
      "rows": [
        ["唯一约束", "最终防止重复值", "用户名、邮箱、Client ID、Provider external_id"],
        ["FOR UPDATE", "锁将要修改的行，同事务判断+更新", "注册生命周期、邀请码预占"],
        ["FOR UPDATE SKIP LOCKED", "多 worker 抢任务、不重复领取", "邮件/审计 outbox 领取"],
        ["advisory lock", "无天然行可锁 / 全局互斥", "月度维护、运行时控制、配额边界"],
        ["CAS revision", "防止旧快照覆盖新数据", "管理设置 PUT"]
      ]
    },
    {
      "type": "quiz",
      "question": "多个 worker 实例要并发地从 email_outbox 领取待发邮件，要求高效、且同一行不被两个 worker 同时处理。最合适的机制是？",
      "options": [
        "对领取 SELECT 加普通 FOR UPDATE",
        "对领取 SELECT 加 FOR UPDATE SKIP LOCKED",
        "用唯一约束防止重复",
        "用会话级 advisory lock 把所有 worker 串行化"
      ],
      "answer": 1,
      "explanation": "outbox 是「多 worker 分批抢任务、互不重复」的场景，FOR UPDATE SKIP LOCKED 让每个 worker 跳过已锁行、各抢一批且不互相阻塞；普通 FOR UPDATE 会串行阻塞，唯一约束只防重复值，advisory lock 会把吞吐压成单 worker。"
    },
    {
      "type": "exercise",
      "title": "为场景选择正确的锁机制",
      "description": "为下面三个新需求选择最合适的机制并说明理由：① 防止两个管理员在同一秒创建相同 username 的用户；② 每月 1 号只允许一个实例执行一次归档任务，且多实例同时开始；③ 多个后台 worker 同时从 audit_event_outbox 领事件。",
      "hint": "① 是「防重复值」→ 唯一约束；② 是「全局互斥、无天然行」→ advisory lock；③ 是「多 worker 抢任务」→ FOR UPDATE SKIP LOCKED。"
    },
    {
      "type": "keypoints",
      "items": [
        "普通 SELECT 不持写锁，MVCC 下「先查再改」会产生丢失更新",
        "唯一约束是防重复值的最终防线，但仍需应用层做友好错误转换",
        "FOR UPDATE：锁定要改的行，同事务判断+更新，建立提交边界",
        "FOR UPDATE SKIP LOCKED：多 worker 抢任务不互等，但牺牲公平性",
        "advisory lock：无天然行可锁时的约定式全局互斥，不是数据约束",
        "CAS revision：乐观并发，防止旧快照覆盖新设置"
      ]
    }
  ]
};
