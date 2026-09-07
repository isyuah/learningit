/* ==================================================================
 * 课时：心跳服务端：对账与期望状态（gline-server-heartbeat）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-heartbeat",
  courseSlug: "gline-server",
  title: "心跳服务端：对账与期望状态",
  summary: "Agent 每 30 秒上报一次状态,Server 这边做了什么校验、存了什么、回了什么?",
  minutes: 18,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "Agent 侧你学过:管道每次读文件前过 WaitUntilRunnable,而「能不能跑」取决于最近一次心跳拿到的 desired_status 与 config_version。这一课翻到服务端:那次心跳 HTTP 请求到达后,Server 做了什么——校验什么、持久化什么、返回什么。",
    },
    {
      type: "heading",
      text: "控制面心智:期望状态与观测状态分离",
    },
    {
      type: "paragraph",
      text: "Gline 的控制回环刻意不用「Server 直接命令 Agent 线程」的脆弱模型,而是声明式对账:",
    },
    {
      type: "list",
      items: [
        "Server 存「期望状态」:每管道 status ∈ {enabled, paused, disabled, error}(还有 error,但当前无代码写它,DB 允许、产品未启用)。",
        "Agent 报「观测状态」:running / stopped / error(reported_status 列)。",
        "心跳 = Agent 上报观测 + Server 返回期望,Agent 自己收敛到期望。",
      ],
    },
    {
      type: "paragraph",
      text: "这种分离的好处:Agent 内部线程怎么实现(读循环、门控)是 Agent 的事,Server 只声明「我希望你怎样」;网络抖动导致心跳丢失,不会让控制面进入不确定状态——下次心跳继续对账即可。",
    },
    {
      type: "heading",
      text: "Heartbeat 服务端流程(control/service.go:361-423)",
    },
    {
      type: "code",
      title: "Heartbeat 的实现骨架",
      language: "text",
      code: "Heartbeat(ctx, principal, input):\n  校验:Require(ScopeAgentWrite) + RequireProject + RequireAgent\n        len(Pipelines) <= 256; Version <= 128 字符\n\n  withinTx:\n    1. Projects.Get(projectID)          # 项目存在性(不校验 active/disabled)\n    2. Agents.Heartbeat(...)            # UPDATE agents SET\n                                          #   version, last_heartbeat_at, last_seen_ip,\n                                          #   status = CASE WHEN status='stale'\n                                          #                THEN 'active' ELSE status END\n                                          # WHERE project_id=$1 AND id=$2 AND status<>'disabled'\n                                          # 未命中 -> ErrNotFound (404)\n    3. for each PipelineReport:\n         ID.Valid && ConfigVersion>0 && Status.Valid\n         重复 ID 拒绝\n         Pipelines.Get -> pipeline.AgentID != input.AgentID\n                          -> ErrResourceBinding (400 invalid_resource_binding)\n         Pipelines.ReportStatus(...)     # 存 reported_status/reported_at/last_error\n\n    4. ListByAgent(projectID, agentID, 256)   # 该 agent 全部管道\n       result.Pipelines[i] = PipelineControl{\n           ID: pipeline.ID,\n           DesiredStatus: pipeline.Status,      # ← 期望状态 = 库里的 status 列\n           ConfigVersion: pipeline.ConfigVersion, # 原样透传\n       }",
    },
    {
      type: "heading",
      text: "desired_status 从哪来?",
    },
    {
      type: "paragraph",
      text: "返回给 Agent 的 PipelineControl.DesiredStatus 就是**数据库 pipelines.status 列**(service.go:411-418)——管理员通过 Console 调 enable/pause/disable 接口写的就是这列;Agent 心跳时 Server 原样读出返回。所以「期望状态」的权威源是 DB,心跳只是把它带给 Agent。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "config_version 的真相:服务端不校验,只透传",
      body: "Agent 侧学到的「版本门控」容易让人以为 Server 会校验上报的 config_version 是否匹配。源码事实(service.go:388-406):Server 对每个 report 只校验 ConfigVersion > 0,**不比对库里的 ConfigVersion**,也不参与任何门控——它只是把库里的期望 ConfigVersion 原样放进响应。真正的「版本不匹配就停读」是 Agent 侧 PipelineState 自己做的:它拿到期望的 config_version,和自己本地的比,不一致就 WaitUntilRunnable 阻塞。控制回环的智能在两端,服务端只负责存与传。",
    },
    {
      type: "heading",
      text: "Agent 状态机:active / stale / disabled",
    },
    {
      type: "paragraph",
      text: "Agents.Heartbeat 的 UPDATE 里藏着状态机:正常心跳把 stale 拉回 active;disabled 的 agent 心跳 UPDATE 不命中(WHERE status<>'disabled')→ ErrNotFound → HTTP 404。把 agent 变 stale 的是后台 maintenance worker(超过 AgentStaleAfter 无心跳就 MarkStale,见运维章)。所以:",
    },
    {
      type: "table",
      caption: "Agent 三态与心跳的关系",
      headers: ["状态", "怎么进入", "心跳时"],
      rows: [
        ["active", "创建 / stale 后心跳回来", "刷新 last_heartbeat_at,保持 active"],
        ["stale", "maintenance worker:超时无心跳", "UPDATE 命中,拉回 active"],
        ["disabled", "管理员禁用", "UPDATE 不命中 → 404,无法心跳复活"],
      ],
    },
    {
      type: "heading",
      text: "ReportStatus:观测状态落库",
    },
    {
      type: "paragraph",
      text: "每个管道上报的 running/stopped/error 会写进 pipelines 的 reported_status/reported_at/last_error 列(pipeline.go:88-101)。这些列是「观测」事实,供管理员在 Console 看到 Agent 实际跑没跑;它们与「期望」status 列分离,正是对账模型的两半。last_error 长度上限 2048,超长直接拒绝整个心跳(report.LastError 校验)。",
    },
    {
      type: "quiz",
      question: "Agent 心跳上报的 config_version 与 Server 库里不一致时,Server 会怎么做?",
      options: [
        "拒绝心跳,返回 409",
        "接受上报并把它当作新的期望版本",
        "接受心跳、原样返回库里的期望 ConfigVersion,由 Agent 自行判断是否停读",
        "自动更新本地配置文件到上报版本",
      ],
      answer: 2,
      explanation:
        "源码事实:Server 对 report 只校验 ConfigVersion > 0,不比对库中版本;响应里的 ConfigVersion 是库里原样透传(service.go:388-418)。版本门控(不一致就停读)完全在 Agent 侧 PipelineState 实现。服务端不校验、不更新、不拒绝——只存与传。",
    },
    {
      type: "keypoints",
      items: [
        "控制回环 = 声明式对账:Server 存期望(DB status),Agent 报观测(reported_status)。",
        "desired_status 就是库里的 status 列,心跳只是把它带给 Agent。",
        "config_version 服务端只透传不校验;停读门控在 Agent 侧。",
        "Agent 状态机 active/stale/disabled:心跳拉回 stale,disabled 无法复活。",
      ],
    },
  ],
};
