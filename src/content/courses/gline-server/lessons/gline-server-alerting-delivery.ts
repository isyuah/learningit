/* ==================================================================
 * 课时：评估与投递：lease、outbox 与 webhook（gline-server-alerting-delivery）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * 前置：告警模型课；你会看到大量与 Agent Dispatcher/WAL 同构的可靠性手法。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-alerting-delivery",
  courseSlug: "gline-server",
  title: "评估与投递：lease、outbox 与 webhook",
  summary: "后台怎么知道「该评估哪条规则」？怎么防止多实例重复评估/重复投递？通知失败怎么退避？",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "模型课定义了「规则」和「状态机」。这一课看驱动它的两个后台循环:评估循环(每 10s 找出到期的规则、跑 COUNT、推进状态)与投递循环(每 5s 把 outbox 里的通知发给 webhook)。你会发现它的可靠性手法和 Agent 侧惊人地同构:lease 像 checkpoint、版本守卫像 CAS、outbox 像 WAL、退避像 Dispatcher。",
    },
    {
      type: "heading",
      text: "Worker:双 ticker",
    },
    {
      type: "paragraph",
      text: "alerting/worker.go 的 Run 起两个独立 ticker(启动先各跑一次,重启立即推进):",
    },
    {
      type: "list",
      items: [
        "runEvaluation:每 EvalInterval(默认 10s)调 service.Evaluate。",
        "runDelivery:每 DeliverInterval(默认 5s)调 DeliverOnce,顺带 CleanupHistory(历史清理骑在投递 ticker 上,每轮有界)。",
      ],
    },
    {
      type: "heading",
      text: "评估循环:ClaimDue 与 lease",
    },
    {
      type: "paragraph",
      text: "Evaluate 的骨架(service_eval.go:26-57):在 MaxRulesPerCycle=500 上限内反复 ClaimDue(每批 100 条),把到期的规则连同它的实例快照一起租出来,逐个 evaluateClaimed。",
    },
    {
      type: "code",
      title: "ClaimDue:一条 SQL 完成「选 + 锁 + 租」(alerting_instance.go:56-88)",
      language: "sql",
      code: `WITH picked AS (
    SELECT i.rule_id
    FROM alert_instances i
    JOIN alert_rules r ON r.id = i.rule_id
    JOIN projects p ON p.id = r.project_id
    WHERE p.status = 'active'
      AND r.status IN ('enabled', 'paused')       -- disabled 停止评估
      AND (i.claimed_at IS NULL OR i.lease_until < $1)   -- 未租出或租约过期
      AND (i.last_eval_at IS NULL
           OR i.last_eval_at <= $1 - make_interval(secs => r.window_seconds))
          -- 距上次评估满一个窗口(或从未评估)
    ORDER BY i.updated_at, i.rule_id
    FOR UPDATE OF i SKIP LOCKED                    -- 锁行,跳过别人租的
    LIMIT $2
)
UPDATE alert_instances i
SET claimed_at = $1, lease_until = $1 + $3::interval
FROM picked
WHERE i.rule_id = picked.rule_id
RETURNING ... 实例全列 + row_to_json(rule)`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "为什么窗口期恰好评估一次",
      body: "到期条件 `last_eval_at <= now - window_seconds` 是评估的节拍器:每条规则每窗口只被租出一次。这有两个后果:① 聚合窗口 [now-window, now) 是滚动且连续的——不会漏窗口也不会重叠;② for_seconds 的「连续满足 N 个窗口」因此等于真实墙钟时长(ClaimDue 注释明说)。lease(默认 60s)只防「worker 崩溃后规则被永久卡住」——崩溃者的租约过期后,规则会被重新认领。",
    },
    {
      type: "heading",
      text: "防「编辑与评估并发」:版本守卫",
    },
    {
      type: "paragraph",
      text: "ClaimDue 锁住了「评估不被并发评估」,但没锁「评估 vs 管理员编辑」。场景:worker 租出规则、开始跑 COUNT(事务外,可能几百 ms),期间管理员改了这条规则——旧配置的评估结果不该提交。解法:规则每次编辑/启停/静默都会 InvalidateEval,把实例的 version 加一;评估提交时 SaveEval 带期望版本,SQL 里 WHERE version=expectedVersion,不匹配 → ErrNotFound → 整个事务(状态+事件+outbox)回滚(alerting_instance.go:94-140)。注释原话:an evaluation started against an old config cannot commit after an edit lands。",
    },
    {
      type: "heading",
      text: "一次评估的提交事务",
    },
    {
      type: "paragraph",
      text: "evaluateClaimed(service_eval.go:83-226)的结构:COUNT 查询在事务外跑(可能慢),然后一个事务内提交所有副作用:",
    },
    {
      type: "code",
      title: "评估 = 事务外查询 + 事务内提交",
      language: "text",
      code: "1. 事务外: countForRule(rule, from, to)\n      # 直接对 log_entries 跑 count(*)\n      # count 指标: 一趟(带 FILTER level='ERROR')\n      # error_ratio: 可能两趟(分子 ERROR-only + 分母)\n      # 查询失败 -> SaveEval(eval_health=error) 就返回,不动状态\n\n2. 事务内(带 expected instance.Version):\n   a. SaveEval(下一状态)         # WHERE version=期望 -> 失败则全回滚\n   b. 若进入/离开 firing: Insert(事件)\n   c. 若发通知(且未静默):\n        eventID = 新 UUID          # 稳定幂等键\n        Outbox.Insert(payload)    # 状态+事件+outbox 同事务提交",
    },
    {
      type: "list",
      items: [
        "进入 firing(此前非 firing)→ 写 fired 事件 + outbox 行。",
        "离开 firing → 写 resolved 事件 + outbox 行。",
        "静默中(silenced_until 在未来)→ 事件照写、outbox 不插(通知不发)。",
        "每个事件一个全新 UUID 作 event_id(UNIQUE)——这是外部 webhook 的幂等键,至少一次投递。",
      ],
    },
    {
      type: "heading",
      text: "投递循环:outbox 状态机",
    },
    {
      type: "paragraph",
      text: "notification_outbox 是事务性 outbox:通知行与状态变更在同一事务提交,之后由独立投递者异步发送。它的状态机(与 Agent Dispatcher 的响应分类惊人同构):",
    },
    {
      type: "code",
      title: "DeliverOnce 的流程(service_eval.go:299-315)",
      language: "text",
      code: "DeliverOnce:\n  1. ReopenExpiredSending: 卡在 sending 且崩溃退避已过的行 -> 回 pending\n     # 崩溃安全: 投递中崩溃的行不会被永久卡死\n  2. ClaimDue: 认领到期行(status∈{pending,failed}, next_attempt_at<=now)\n     # 置 sending, attempts+1, next_attempt_at=now+RetryBase\n     # FOR UPDATE SKIP LOCKED, 单 deliverer 保证顺序\n  3. 逐条 deliverOne:\n     2xx                  -> sent\n     网络错误 / 5xx        -> failed(指数退避,下次再试)\n     4xx                  -> dead(通道/配置永久问题,停止重试)\n     attempts >= 8        -> dead(尝试上限)",
    },
    {
      type: "callout",
      variant: "example",
      title: "与 Agent Dispatcher 的惊人同构",
      body: "对比你学过的 Agent 侧 transport.go 分类:2xx accepted/duplicate ↔ 这里 2xx sent;5xx/429 retryable ↔ 这里 failed + 退避;4xx quarantine/terminal ↔ 这里 dead。两端独立演化出同一套「成功/可重试/永久失败」三分法,因为这是「可靠地送一个 HTTP 通知」的天然答案。区别:Agent 的 payload 在本地 WAL,这里的 payload 在数据库 outbox;Agent 的「释放」是本地 Ack,这里是 MarkOutboxSent(WHERE status='sending' 守卫——若行已被重置则本结果作废)。",
    },
    {
      type: "heading",
      text: "投递的崩溃安全:两道保险",
    },
    {
      type: "list",
      items: [
        "认领即前移 next_attempt_at:ClaimDue 把行置 sending 的同时把 next_attempt_at 推到 now+RetryBase——如果 worker 在 POST 前崩溃,重启后 ReopenExpiredSending 会把它放回 pending(退避过后),而不是立即重发。",
        "状态守卫更新:MarkSent/Failed/Dead 都带 WHERE status='sending';若行已被别的路径重置/重新认领,本 worker 的结果作废(not-found 当成功处理)——防止「迟到的成功覆盖新状态」。",
      ],
    },
    {
      type: "heading",
      text: "手动重试与历史清理",
    },
    {
      type: "paragraph",
      text: "运维可对 failed/dead 的通知手动 retry(RetryNotification):重置为 pending、attempts=0、next_attempt_at=now;sending 中的行不可重置。CleanupHistory 每轮有界删除 sent/dead 超过保留期(30 天)的 outbox 行与事件——pending/failed 永不自动清理(还要重试/给人看)。",
    },
    {
      type: "quiz",
      question: "评估 worker 在「ClaimDue 租出规则、COUNT 查询进行中」时崩溃。恢复后会怎样?",
      options: [
        "规则永久卡住,需要人工重置",
        "租约(默认 60s)过期后,规则会被下一个评估周期重新认领",
        "实例版本守卫阻止再次评估",
        "COUNT 结果由崩溃恢复自动补交",
      ],
      answer: 1,
      explanation:
        "ClaimDue 写入 lease_until=now+lease(默认 60s)。worker 崩溃后,到期条件 (claimed_at IS NULL OR lease_until < now) 在租约过期后重新满足,下一个评估周期会重新认领该规则。lease 是「崩溃安全」而非「永久锁」——这正是 Agent WAL 半写截断哲学在服务端的对应。",
    },
    {
      type: "exercise",
      title: "对比告警 outbox 与 Agent WAL 的可靠性分工",
      description:
        "列一张对照表:通知投递的 outbox 与 Agent 上传的 WAL,各自解决什么故障(进程崩溃/网络断/重复发送/半写)、用什么机制(落盘时机/幂等键/退避/状态守卫)、两者的「恰好一次」分别靠什么实现。",
      hint: "outbox:同事务落库 + event_id UNIQUE + sending 守卫;WAL:先落盘后发送 + batch_id 服务端幂等。",
    },
    {
      type: "keypoints",
      items: [
        "双 ticker:评估 10s、投递 5s;启动先各跑一次。",
        "ClaimDue:一条 SQL 完成选+锁+租;lease 防崩溃卡死,last_eval_at 门控每窗口一次。",
        "版本守卫(SaveEval WHERE version)防「旧配置的评估结果在编辑后提交」。",
        "outbox 状态机 pending→sending→sent/failed/dead;2xx sent、5xx/网络退避、4xx dead。",
        "与 Agent Dispatcher 同构:成功/可重试/永久失败三分法 + 退避 + 幂等键。",
      ],
    },
  ],
};
