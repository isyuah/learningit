/* ==================================================================
 * 课时：端到端故障推演：为什么不丢不重（gline-server-reliability-loop）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码 + docs/guides/06（file:line 指向仓库根）。
 * 本课把 Agent 侧与 Server 侧知识合起来做故障推演——面试最能扛追问的部分。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-reliability-loop",
  courseSlug: "gline-server",
  title: "端到端故障推演：为什么不丢不重",
  summary: "把 Agent 与 Server 的不变量合起来,逐条推演崩溃/断网/重复/坏数据下到底发生什么。",
  minutes: 22,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前面的课把 Server 各平面拆开讲了。这一课把它们装回整条链路:Agent 发起的每个请求、Server 的每个响应,在故障时如何被两端的不变量兜住。学完你应该能不看代码,对任意单点故障说出「数据去哪了、为什么不丢不重」。",
    },
    {
      type: "heading",
      text: "两条不变量,合起来恰好一次",
    },
    {
      type: "list",
      items: [
        "Agent 侧:在收到与 batch_id 完全匹配的 ACK 之前,绝不删除本地 WAL 副本 → at-least-once(可能重,绝不丢)。",
        "Server 侧:只在 PostgreSQL 事务提交成功后返回 ACK;同一 (project_id, batch_id) + canonical hash 只入库一次 → 幂等(可能拒,绝不重)。",
        "合起来:任意单点故障下,一条日志最终恰好入库一次。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么「恰好一次」在两端分开实现",
      body: "纯粹的端到端恰好一次(比如两阶段提交)在分布式下代价极高且脆弱。Gline 的策略是把问题拆成两半,每半在一个信任边界内解决:Agent 只管「不丢」(本地 WAL 崩溃一致性),Server 只管「不重」(DB 事务幂等)。中间的重复传输是设计内的、无害的——这是 ADR-0003 的核心。",
    },
    {
      type: "heading",
      text: "故障推演表(面试背下这段 = 稳)",
    },
    {
      type: "table",
      caption: "逐故障推演(docs/guides/06 整理,与源码一致)",
      headers: ["故障", "发生什么", "为什么不丢不重"],
      rows: [
        ["Agent 进程崩溃", "WAL 未 ACK 批仍在盘上;重启恢复、CRC 截尾后重传", "数据在 WAL,checkpoint 未推进"],
        ["Server 崩溃(提交前)", "请求中断,Agent 未收到 ACK → 重试同 batch", "Server 重启后事务未提交=无数据;重试幂等插入"],
        ["Server 崩溃(提交后、ACK 前)", "Agent 重试同 batch → 命中 duplicate", "已提交数据不重插(幂等)"],
        ["网络分区(Server 不可达)", "Agent 退避重试(429/5xx/超时)", "批次在 WAL,背压不覆盖"],
        ["坏批次(400/413/422)", "移入 Agent 本地 quarantine,后续批继续", "坏数据隔离不阻塞好数据"],
        ["key 被吊销 / URL 错", "Agent 停止(terminal),批保持 pending", "配置修复前不丢"],
        ["WAL 半写(断电)", "CRC 校验失败 → 截断尾部残缺记录", "半写记录未推进 checkpoint=未发生"],
        ["心跳丢失 2min", "Agent 标 stale → 心跳回来转 active", "状态自动恢复,无人工"],
        ["管道被暂停", "409 resource_unavailable → Agent 保留批(blocked)", "暂停只停新读取,已入账批待恢复后排空"],
        ["并发重复到达", "INSERT ON CONFLICT → 一个 accepted 一个 duplicate", "DB 唯一约束保证不双写"],
      ],
    },
    {
      type: "heading",
      text: "两个最容易讲错的窗口",
    },
    {
      type: "paragraph",
      text: "窗口一:Server 提交后、ACK 前崩溃。很多人以为会丢——其实不丢:Agent 没收到 ACK 就会重试,重试命中 duplicate,数据早在第一次就入库了。这个窗口恰恰是「先提交后 ACK」设计的证明。",
    },
    {
      type: "paragraph",
      text: "窗口二:409 resource_unavailable(管道暂停/禁用)。注意 Agent 侧把它归为 blocked 而不是 quarantine——批没坏,只是通道暂时关着。等管道重新 enabled,Agent 重试就 accepted。如果你把暂停误当坏批隔离,恢复后数据就永远留在死信里了。",
    },
    {
      type: "heading",
      text: "端到端时序:一次成功 + 一次重试",
    },
    {
      type: "code",
      title: "正常路径与重试路径",
      language: "text",
      code: "成功路径:\n  Agent Dispatcher -> POST /batches (batch_id=X, payload)\n  Server: Decode -> Normalize -> 事务(InsertBatch成功)\n        -> InsertEntries -> Usage.Add -> COMMIT\n  Server -> 200 {status:\"accepted\"}\n  Agent 收到匹配 ACK -> 释放 WAL 中的 X\n\n重试路径(ACK 丢失):\n  Agent 没收到 ACK -> 重发 POST /batches (同 X,同 payload)\n  Server: InsertBatch -> ON CONFLICT DO NOTHING -> affected=0\n        -> FindBatch -> VerifyRetry(同 hash) -> Status=duplicate\n  Server -> 200 {status:\"duplicate\"}   (不写 entries,不扣 usage)\n  Agent 收到 duplicate -> 同样释放 X(数据早已入库)",
    },
    {
      type: "callout",
      variant: "warning",
      title: "idempotency_conflict:重试变成冲突",
      body: "如果 Agent 复用 batch_id X 但发了不同内容(payload hash 不同),VerifyRetry 返回 ErrIdempotencyConflict → 409。这是客户端 bug(同一幂等键配不同内容),Server 无法自动处理——Agent 侧把它归为 terminal 停止。注意 Agent 正常不会这样:它的 payload 在 WAL 里原样保存、重试原样重发,hash 必然一致。",
    },
    {
      type: "exercise",
      title: "复合故障推演:断电 + 轮转 + 暂停",
      description:
        "假设:Agent 读到文件偏移 800 处断电(已 Commit 到 600,600-800 在内存);重启后文件恰好被 logrotate 轮转;且该管道此时被管理员暂停。逐步说明:重启后 WAL 恢复出什么、文件源从哪读、遇到轮转走什么协议、暂停如何影响投递?数据会丢吗?",
      hint: "分三层:WAL 重放(已入账批)、文件续读(600 之后从旧文件读,遇轮转先 flush 再 Transition)、控制面(暂停只停新读取,已入账批 Dispatcher 照送)。",
    },
    {
      type: "keypoints",
      items: [
        "两端不变量:Agent 不丢(ACK 前不删)、Server 不重(提交后才 ACK + 幂等)。",
        "「提交后 ACK 前崩溃」不丢:重试命中 duplicate。",
        "409 resource_unavailable = blocked(通道问题),不是 quarantine(批问题)。",
        "idempotency_conflict = 客户端 bug(同 key 异内容),terminal。",
      ],
    },
  ],
};
