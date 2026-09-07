/* ==================================================================
 * 课时：运行时配置、revision CAS 与多实例同步（nyauth-runtime-settings-cas）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与文件名一致。
 * 内容块类型见 ../../../types.ts。
 * 本课时讲解 nyauth 中「运营配置」的存储与并发控制模型。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-runtime-settings-cas",
  "courseSlug": "nyauth-backend",
  "title": "运行时配置、revision CAS 与多实例同步",
  "summary": "为什么一部分配置可以热更新，另一部分必须重启，以及 CAS 如何防止旧页面覆盖新配置。",
  "minutes": 24,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "你已经理解 OAuth/OIDC 与安全模型，现在进入「运维视角」：一个认证服务器的配置到底放在哪里、改了以后怎么让所有实例一致地生效、并发保存时怎么避免互相覆盖。nyauth 的做法是把这个话题拆成两个明显不同的问题：部署配置（部署形态、信任边界）与运营配置（后台可改、可审计），并给后者配上 CAS、快照和多实例同步。这一课先讲清楚这套模型，下一课再讲能力 gate 与排空。"
    },
    {
      "type": "definition",
      "term": "部署配置（deployment config）",
      "definition": "决定进程拓扑或信任边界的配置：数据库地址、Redis 地址、issuer、可信代理 CIDR、媒体挂载目录、S3 bucket 等。改动通常需要重启或发布流程，因为拓扑和信任边界不能在不信任旧请求的同时信任新请求。"
    },
    {
      "type": "definition",
      "term": "运营配置（operational config）",
      "definition": "存入 PostgreSQL、可以由管理员在后台修改并审计的设置：注册是否开放、限流阈值、会话期限、OAuth Scope、邮件模板、维护状态等。这是本课的主题——它们需要热更新且写入要可审计。"
    },
    {
      "type": "heading",
      "text": "为什么不是「所有配置都热更新」"
    },
    {
      "type": "paragraph",
      "text": "一个自然的诱惑是：既然有后台，就让一切都支持热更新，改完立刻生效。nyauth 的明确设计（settings 包注释与 05 章资料）是不追求这一点：一旦改变 issuer、签名密钥来源或数据库连接，旧的请求和新的请求在同一瞬间看到不同的配置，系统的行为可能比重启更难推理。想象正在用旧 issuer 签发 token 的实例与已换新 issuer 的实例同时服务——签名互相不认账，比一次干净重启造成的短暂不可用严重得多。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "热更新的边界是「可推理的一致性」",
      "body": "判断某份配置是否该热更新，问自己一个问题：新旧请求同时看到不同值，系统还是安全的、可推理的吗？注册开关、会话期限、邮件模板这类「策略」新旧不一致只是短暂的策略漂移，可以接受；而 issuer、密钥、DB DSN 这类「身份与拓扑」新旧不一致会直接破坏签名校验与连接语义，必须走重启。所以重构后的模板把「部署配置」留在配置文件里，只有「运营配置」进 PostgreSQL。"
    },
    {
      "type": "heading",
      "text": "保存路径：一个 PUT 如何在事务里安全落库"
    },
    {
      "type": "paragraph",
      "text": "运营配置存在 `runtime_settings` 表，每一行是一个设置组，带一个单调递增的 `revision`（BIGINT）。保存不是盲写，而是带着「期望的 revision 版本号」做 CAS。下面的路径同时做了三件必须原子的事：比较版本号、写值、写审计，然后才通知其它实例。"
    },
    {
      "type": "code",
      "title": "运营配置保存路径（对照 policy_store.go / settings.go）",
      "language": "text",
      "code": "GET settings        -> 读到当前 revision = N（供编辑页展示）\n管理员在编辑页改好后提交\nPUT settings  expected_revision = N\n  1) BEGIN 事务\n  2) 锁定设置行（advisory/行锁，建立提交边界）\n  3) 比较：WHERE key=$1 AND revision=$4   （revision 仍等于 N？）\n  4) 相等   -> UPDATE value, revision=N+1\n     不相等 -> 0 行影响 -> ErrRevisionConflict（HTTP 409）\n  5) 写 settings.updated 审计（与写值同事务）\n  6) NOTIFY nyauth_settings_changed（pg_notify，仍在事务里）\n  7) COMMIT\n  8) 本实例：原子替换进程内快照（atomic.Pointer）\n  9) 其它实例：收到通知 -> 重载快照 -> 原子替换\n 10) 每 60s reconciliation 全量重载，兜底丢失的通知"
    },
    {
      "type": "paragraph",
      "text": "核心代码是 `storeSettingTx`（settings/policy_store.go）：`UPDATE runtime_settings SET value=$2, revision=revision+1, ... WHERE key=$1 AND revision=$4 RETURNING revision`。关键在 `WHERE ... AND revision=$4`：只有当数据库当前 revision 仍等于请求携带的期望值时，这一行才会被更新并返回新 revision；否则影响 0 行，函数返回 `ErrRevisionConflict`，HTTP 层把它映射成 `409 Conflict`。`expected_revision == 0` 是首插路径：`INSERT ... ON CONFLICT (key) DO NOTHING`，仍存在则同样返回冲突——保证第一行只有一个赢家。"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "CAS 防止的是「丢更新」（lost update）",
      "body": "假设两个管理员 A 和 B 同时打开同一个设置页，都读到 revision=7。A 先保存成功 -> 数据库变成 revision=8。B 再用 revision=7 去 PUT，`WHERE revision=7` 匹配 0 行 -> 409。B 不会「静默覆盖」A 刚保存的新值。没有 CAS 的话，B 的写入会用旧的整份表单覆盖 A 的改动，而数据库没有任何版本概念，无法察觉——这正是「先读后写」的经典竞态，CAS 把并发写从悄悄覆盖变成了显式冲突。"
    },
    {
      "type": "heading",
      "text": "通知 vs 对账：为什么 LISTEN/NOTIFY 不能单独用"
    },
    {
      "type": "paragraph",
      "text": "数据库的 `LISTEN/NOTIFY` 让一个连接监听某个频道，别的事务 `pg_notify` 后它收到通知。nyauth 用 `nyauth_settings_changed` 频道做低延迟同步：写值的事务里 `pg_notify`，各实例的监听连接 `WaitForNotification` 后立即重载。这是「快」的路径。"
    },
    {
      "type": "paragraph",
      "text": "但它不可靠，所以必须叠加 reconciliation：通知本质上是「尽力而为」的。连接可能中断、通知可能丢失、实例可能在通知发出后才启动而错过它、监听断线重连之间也有空窗。因此 `StartSynchronization` 同时启动 `listenForChanges`（即时）和一个每 60 秒 `reconcile` 的定时器，定时器无条件全量 `Load()` 一次。这样即使某次通知彻底丢了，最迟下一个 reconciliation 周期也会收敛到最新版本。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "为什么不用纯 Redis pub/sub 做同步",
      "body": "通知只是「提醒你去数据库读」，真正的一致性来源始终是那张 `runtime_settings` 表与它的 revision。若用 Redis pub/sub 当权威：Redis 丢了消息、崩了、或一个实例错过了订阅，就永久停留在旧状态——Redis 没有「reconcile 自己」的机制，你得自己再建一套对账。而 PostgreSQL 既是权威存储又能发通知，幂等的 reconciliation 一次全量读回就能兜住所有遗漏。换句话说：pub/sub 做「加速」，权威与正确性交给可对账的数据库。这是本项目贯穿多个子系统（设置、服务控制、provider、动态 SMTP）的同一套「LISTEN/NOTIFY + reconciliation」范式。"
    },
    {
      "type": "heading",
      "text": "BIGINT revision 与溢出防护"
    },
    {
      "type": "paragraph",
      "text": "revision 是 `BIGINT`，范围约 ±9.22×10^18。哪怕一秒写一百万次也要亿万年才到顶，所以「版本号用光」在普通使用中几乎不可能。但既然版本号是单调递增的，实现就绝不能让它「溢出回负数」——那会破坏单调性，让 CAS 语义崩塌。nyauth 的实现做了显式防护：例如在 `SetCommunications` 里维护站内公告（site banner）的版本号，当当前版本已到 `math.MaxInt64` 时，直接返回「version is exhausted」错误，拒绝继续递增；`revision+1` 这种写法也只在确认未达上限后执行。同样的边界检查模式也应用在公告版本上。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "面试点：BIGINT revision",
      "body": "能主动说出「BIGINT 在实际中不会耗尽，但仍要显式拒绝在 math.MaxInt64 处递增，而不是依赖溢出回绕」，说明你既懂数量级，也懂工程上要为理论边界写防护。不要只说「用个自增整数」——面试官想听你解释为什么单调性本身不可破坏，以及防护是显式代码而非靠运气。"
    },
    {
      "type": "heading",
      "text": "快照的原子替换：中途失败不能看到半套配置"
    },
    {
      "type": "paragraph",
      "text": "进程内有多个设置组（branding、registration、security、protection、lifecycle、oauth、communications、observability）。`Manager.Load` 的做法是把所有组从数据库读出来、逐一解码并校验，全部成功后用一个 `atomic.Pointer` 统一发布新快照。这样即使某个组损坏、解码失败，也绝不会出现「部分组是新值、部分是旧值」的半套状态——`Load` 在发布前失败，进程继续使用上一份已知良好的快照。这与「先提交事务再原子替换内存」的顺序一致：数据库提交是权威，内存快照只是缓存，且替换是全体的、原子的。"
    },
    {
      "type": "paragraph",
      "text": "同一个模式也应用于公告/横幅这类需要审计与多实例同步的数据，它们复用同样的 `runtime_settings` + revision + NOTIFY + reconciliation 机制（如通讯设置里的 site banner 版本号）。理解一次，就能迁移到其它「运营状态」上。"
    },
    {
      "type": "quiz",
      "question": "一个管理员编辑页显示 revision=7 后提交 PUT；此时数据库里该设置的 revision 已被另一管理员改成 9。这次 PUT 会怎样？",
      "options": [
        "正常保存，revision 变成 10",
        "返回 409 冲突，拒绝写入，不会覆盖别人刚保存的新值",
        "数据库用旧值 7 覆盖 9，但不更新其它字段",
        "返回 200 但悄悄丢弃这次修改"
      ],
      "answer": 1,
      "explanation": "storeSettingTx 的 UPDATE 带 WHERE revision=$4，期望值 7 与当前 9 不匹配时影响 0 行，返回 ErrRevisionConflict，HTTP 层映射为 409。这正是 CAS 防止丢更新的机制：显式冲突，而不是静默覆盖。"
    },
    {
      "type": "keypoints",
      "items": [
        "配置分两类：部署配置（拓扑/信任边界，要重启）与运营配置（可后台改、可审计，进 PostgreSQL）",
        "运营配置以 setting 组存 runtime_settings，带单调 BIGINT revision",
        "保存用 CAS：UPDATE WHERE revision=期望值，不匹配 => ErrRevisionConflict => 409",
        "写值 + 写审计在同一事务里提交，然后才 NOTIFY",
        "LISTEN/NOTIFY 做低延迟，reconciliation 每 60s 全量重载兜底丢失通知，正确性永远靠数据库快照",
        "进程内用 atomic 快照整体替换；Load 任一失败则保留上一份已知良好快照",
        "BIGINT 实际耗不尽，但仍要在 math.MaxInt64 处显式拒绝递增，绝不溢出回绕"
      ]
    }
  ]
};
