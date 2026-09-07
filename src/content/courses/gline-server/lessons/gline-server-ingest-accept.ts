/* ==================================================================
 * 课时：Accept 事务：三态响应与 ACK 边界（gline-server-ingest-accept）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * 本课是全课程核心——把「至少一次传输」变成「恰好一次入库」的那台机器。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-ingest-accept",
  courseSlug: "gline-server",
  title: "Accept 事务：三态响应与 ACK 边界",
  summary: "同一批重传到达时，Server 怎么区分「第一次」「重复」「冲突」？为什么事务 Commit 是 ACK 的唯一边界？",
  minutes: 20,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "这是全课程最重要的一课。Agent 侧你学过:它只在收到与 batch_id 匹配的 ACK 后才释放本地副本,否则无限重传。Server 侧要回答:同一批重传(可能并发)到达时,怎么知道它是「第一次」「安全重复」还是「恶意/错误冲突」?答案在 ingest.Service.Accept 的一个事务里。",
    },
    {
      type: "heading",
      text: "Accept 的前置校验:身份与内容",
    },
    {
      type: "paragraph",
      text: "Accept(ingest/service.go:110)先做一堆不进事务的快速校验:principal.Require(ScopeIngest)、candidate.ProjectID 若非空必须等于 principal 的(防伪造)、RequireAgent(candidate.AgentID)(key 若绑定 agent 必须匹配)、batch.PayloadHash 非空、batch.Validate()。随后是准入限流(admission.AllowIngest,下一课展开),拿到一个 reservation。",
    },
    {
      type: "callout",
      variant: "note",
      title: "留意 cloneBatch 与身份强注入",
      body: "Accept 先把 candidate 深拷贝(cloneBatch),然后把 batch.ProjectID 强设为 principal.ProjectID,并给每条 entry 也注入 ProjectID(batch 内部各 entry 若已带不同 ProjectID 则直接拒绝)。这是「项目身份只来自认证上下文」在服务层的第二次强制——协议层 Normalize 做过一次,服务层再做一次,双保险。",
    },
    {
      type: "heading",
      text: "事务内状态机:项目 → Agent → 管道 → 批次",
    },
    {
      type: "paragraph",
      text: "真正决定命运的逻辑在 s.withinTx 回调里(ingest/service.go:180-232),按依赖顺序检查:",
    },
    {
      type: "code",
      title: "事务内的检查链",
      language: "text",
      code: "withinTx(ctx, func(repos) error {\n  1. project := repos.Projects.Get(...)\n     project.CanIngest()          // project 必须 active\n     -> 否则 ErrProjectDisabled (409 resource_unavailable)\n\n  2. agent := repos.Agents.Get(...)\n     agent.Status != AgentDisabled  // disabled 是硬边界\n     -> 否则 ErrAgentDisabled (409 resource_unavailable)\n\n  3. pipeline := repos.Pipelines.Get(...)\n     pipeline.AgentID == batch.AgentID   // 绑定校验\n     pipeline.Status ∈ {enabled, paused} // paused 放行,disabled/error 拒绝\n     -> 否则 ErrPipelineUnavailable (409 resource_unavailable)\n\n  4. inserted := repos.Batches.InsertBatch(batch)\n       // INSERT ... ON CONFLICT (project_id, id) DO NOTHING\n     if !inserted {   // 冲突:同 (project_id, batch_id) 已存在\n        stored := repos.Batches.FindBatch(...)\n        stored.VerifyRetry(batch)\n          // 同 hash -> duplicate;不同 hash -> ErrIdempotencyConflict\n        result.Status = StatusDuplicate\n        return nil\n     }\n\n  5. repos.Batches.InsertEntries(batch)   // 新批次 -> 写所有 entry\n     repos.Usage.Add(...)                 // 用量分钟桶\n     result.Status = StatusAccepted\n     return nil\n})",
    },
    {
      type: "heading",
      text: "paused 放行、disabled 拒绝:为什么不同",
    },
    {
      type: "paragraph",
      text: "代码注释(ingest/service.go:203-205)点破了设计:paused 停的是「新的源读取」(通过心跳控制管道门),但**已经持久化在 Agent WAL 里的批必须还能排空**——否则暂停管道 = 永久卡死已入账数据。所以 paused 的管道仍接受 ingest。而 disabled/errored 是硬边界——禁用管道的批不该再进来,直接 409 让 Agent 把批留在本地。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "与 Agent 侧 block/retry 的对应",
      body: "这个 409 resource_unavailable 正是 Agent 侧 Dispatcher 分类成 ResultBlocked 的那个响应(transport.go 里 409+resource_unavailable → blocked)。Agent 收到后不退避丢弃,而是保留该批、跳过、等资源恢复——「暂停只停采集,已入账批必须能排空」在两端是同一个语义。",
    },
    {
      type: "heading",
      text: "三态响应:accepted / duplicate / conflict",
    },
    {
      type: "table",
      caption: "同一 batch_id 重传的三种结局",
      headers: ["情形", "响应", "Agent 动作"],
      rows: [
        ["新批次,事务提交成功", "200 status=accepted, accepted_entries=n", "释放该批"],
        ["同 (project_id, batch_id) 且 payload hash 相同", "200 status=duplicate, accepted_entries=已存数", "释放该批(数据已入库)"],
        ["同 batch_id 但 payload hash 不同", "409 code=idempotency_conflict", "停止(客户端 bug:复用 batch_id 传了不同内容)"],
      ],
    },
    {
      type: "paragraph",
      text: "注意 duplicate 分支:它**不写 entries、不加 usage**,只查已存的 StoredBatch 返回 entry_count,然后照常走事务 Commit。VerifyRetry 用 subtle.ConstantTimeCompare 比对 32 字节 hash(models.go:200-207)——不同即 ErrIdempotencyConflict。",
    },
    {
      type: "heading",
      text: "为什么 Commit 是 ACK 的唯一边界",
    },
    {
      type: "paragraph",
      text: "Accept 的返回值在事务提交成功后才产生(withinTx 返回 nil),reservation.Commit() 也在 accepted 之后才调(service.go:238-244)。这个顺序是整条可靠链的地基:",
    },
    {
      type: "list",
      items: [
        "若先回 ACK 再提交:ACK 后、提交前崩溃 → Agent 已释放 → 数据丢。",
        "若先提交再回 ACK:提交后、ACK 前崩溃/断网 → Agent 重试同 batch → 命中 duplicate → 不重复。",
        "所以「先提交后 ACK」把「丢」排除,把「重」变成无害的 duplicate——这正是 Agent 的 at-least-once 能成立的前提。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "InsertBatch 的可见性注释",
      body: "storage/postgres/ingest.go 在 InsertBatch 上有一句重要注释:\"The row is not visible, and must never be ACKed, until the caller commits.\"(行未提交前不可见、绝不能被 ACK)。事务隔离级别 ReadCommitted 保证:未提交的行对其他事务不可见,所以并发重试不会读到半成品。",
    },
    {
      type: "exercise",
      title: "推演:并发重复到达",
      description:
        "Agent 超时重发同一 batch,两个请求几乎同时到达 Server(两个不同连接)。画出两次 Accept 在 ReadCommitted 下的事务交错,说明为什么最终只有一个 accepted、一个 duplicate,而不会双写。",
      hint: "考虑 INSERT ... ON CONFLICT DO NOTHING 在并发下的行为:两个事务都尝试插入,只有一个成功,另一个 affected=0 走 duplicate 分支。",
    },
    {
      type: "quiz",
      question: "管道处于 paused 状态时,Agent 重传一批已入账的数据,Server 会怎么处理?",
      options: [
        "拒绝(409),因为管道暂停了",
        "接受(200 accepted 或 duplicate),因为暂停只停新读取、已入账批必须能排空",
        "接受但标记为隔离",
        "返回 503,要求 Agent 稍后重试",
      ],
      answer: 1,
      explanation:
        "代码注释明确:paused 停的是新源读取(通过心跳控制),已持久化的批仍要排空,所以 pipeline.Status ∈ {enabled, paused} 都放行(ingest/service.go:205-208)。只有 disabled/errored 才是硬边界(409 ErrPipelineUnavailable)。",
    },
    {
      type: "keypoints",
      items: [
        "Accept = 快速校验(scope/身份) + 限流 + 单事务(项目→Agent→管道→批次)。",
        "三态:accepted(新)/ duplicate(同 hash 重试)/ conflict(同 id 异 hash)。",
        "paused 放行、disabled/errored 拒绝——暂停只停采集,已入账批必须排空。",
        "Commit 是 ACK 唯一边界:先提交后 ACK 把「丢」排除、把「重」变 duplicate。",
      ],
    },
  ],
};
