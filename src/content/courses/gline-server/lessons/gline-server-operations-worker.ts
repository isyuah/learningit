/* ==================================================================
 * 课时：后台任务：维护 worker 与周期纪律（gline-server-operations-worker）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-operations-worker",
  courseSlug: "gline-server",
  title: "后台任务：维护 worker 与周期纪律",
  summary: "除了响应请求,Server 周期性地跑什么维护任务?为什么删除要有界、lease 要回收?",
  minutes: 16,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "Server 不是只响应请求——它还有一个 maintenance worker 周期性维护数据健康。这一课看它每轮做什么、为什么这样设计(有界删除、lease 回收)。(告警系统的评估/投递 worker 是另一条后台线,已在「告警子系统」章专讲,本课不重复。)",
    },
    {
      type: "heading",
      text: "maintenance worker:每轮三件事",
    },
    {
      type: "paragraph",
      text: "maintenance.Worker 以固定 Interval(默认配置)循环,每轮 RunOnce(worker.go:97-114)做三件独立的事,各带指标:",
    },
    {
      type: "code",
      title: "RunOnce 的三项任务",
      language: "text",
      code: "RunOnce(ctx):\n  1. agents.MarkStaleBefore(now - AgentStaleAfter, BatchSize)\n     # 把超过 N 分钟没心跳的 active agent -> stale\n     # (Agent 心跳回来时自动转回 active;disabled 不受影响)\n\n  2. quarantine.RequeueExpired(now - QuarantineLease, BatchSize)\n     # 回收超时的隔离重放 lease:\n     #   replaying 且 claimed_at 超阈值 -> 回 pending\n     #   (worker 崩溃不丢任务:lease 过期自动回收)\n\n  3. retention:按每 project 策略(时间/字节)有界清理\n     # 每 project 每轮 ≤ MaxBatchesPerProject(10) 批,\n     # 每批 ≤ BatchSize 行 —— 避免一条巨 DELETE 阻塞 ingest",
    },
    {
      type: "heading",
      text: "为什么删除必须有界",
    },
    {
      type: "paragraph",
      text: "retention 清理(按 retention_policies 的 max_age/max_bytes 删旧数据)刻意做成「每 project 每轮最多 10 批、每批限行数」的小步删除。原因:一条 DELETE 删百万行会锁住表、拖垮并发的 ingest/query。小步、多轮、可中断——这是后台任务与在线请求共存的标准做法,代价是清理不是瞬时的,但每轮都有进展且不伤人。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "lease:后台任务的「崩溃安全」",
      body: "服务端 quarantine 重放(operations)是另一个后台消费者:ClaimPending 用 FOR UPDATE SKIP LOCKED 把 pending 批标记为 replaying(claim 带 lease 时间)。如果 worker 在重放中途崩溃,批会永远卡在 replaying——所以 maintenance 每轮 RequeueExpired 把超 lease 的批放回 pending。这正是 Agent WAL「半写截断」哲学在服务端的对应:崩溃残留靠周期回收,不靠一次性清理。",
    },
    {
      type: "heading",
      text: "Agent 状态机在 worker 里的闭环",
    },
    {
      type: "paragraph",
      text: "MarkStaleBefore 是 Agent 三态机(active/stale/disabled)的推进器:心跳刷新 last_heartbeat_at;worker 发现超时未心跳就标 stale;Agent 下次心跳(control/service.go 的 Agents.Heartbeat)把 stale 拉回 active。这样「Agent 死了但没报错」能被自动发现,不用人工盯。",
    },
    {
      type: "callout",
      variant: "note",
      title: "后台纪律的家族相似性",
      body: "如果你接着学告警子系统章,会发现它的评估/投递 worker 与 maintenance 是同一套后台纪律的实例:周期 ticker、lease(崩溃安全)、每轮有界、SKIP LOCKED 认领。看懂 maintenance 的「lease 回收 + 有界」,alerting 的 outbox 投递就很好懂。",
    },
    {
      type: "quiz",
      question: "为什么 retention 清理要做成「每 project 每轮最多删 10 批」的小步删除,而不是一次 DELETE 全删完?",
      options: [
        "因为 SQL 不支持一次删多行",
        "避免一条巨型 DELETE 锁表,拖垮并发的 ingest 与 query",
        "为了给 retention_policies 表留出写入空间",
        "因为后台 worker 无法执行大事务",
      ],
      answer: 1,
      explanation:
        "后台清理与在线请求共享同一数据库。一条删除百万行的 DELETE 会长时间持锁,阻塞 ingest 的 INSERT 与 query 的 SELECT。有界小步删除(每轮每 project ≤10 批)让每次持锁时间极短,多轮完成——与在线流量共存的后台任务标准做法。",
    },
    {
      type: "keypoints",
      items: [
        "maintenance 每轮:标 stale agent、回收超时 lease、有界 retention 清理。",
        "有界删除:小步多轮,避免大事务锁表拖垮在线请求。",
        "lease 回收 = 服务端的崩溃安全:worker 崩了,任务自动回到 pending。",
        "告警 worker 是同一套后台纪律的另一实例(详见告警章)。",
      ],
    },
  ],
};
