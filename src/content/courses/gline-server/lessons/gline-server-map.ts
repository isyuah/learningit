/* ==================================================================
 * 课时：Server 是什么：与 Agent 的分工（gline-server-map）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲一致。
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-map",
  courseSlug: "gline-server",
  title: "Server 是什么：与 Agent 的分工",
  summary: "把 Server 放回整条日志链路中：它与 Agent 各守一条不变量，合起来才是「不丢不重」。",
  minutes: 12,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "在 Agent 侧的课程里，你反复听到一句话：Agent 负责「至少一次传输」，Server 负责「幂等去重」，合起来是端到端恰好一次。这一课把 Server 从这句话的背面翻到正面——它到底由什么组成、边界在哪、为什么「接收端」和「发送端」的可靠性是两种完全不同的问题。",
    },
    {
      type: "heading",
      text: "两个进程，一条不变量链",
    },
    {
      type: "paragraph",
      text: "Gline 的运行时是三个进程：Agent（跑在产生日志的机器上）、Server（唯一业务后端）、Console（浏览器端，只是 Server API 的客户端）。持久化只有两处：Agent 的本地 WAL 磁盘，和 Server 的 PostgreSQL（唯一事实源）。这条链的可靠性来自两端各守一条不变量（docs/guides/06 有完整推演）：",
    },
    {
      type: "list",
      items: [
        "Agent 不变量：在收到与发出的 batch_id 完全匹配的 ACK 之前，绝不删除本地副本 → 可能重、绝不丢。",
        "Server 不变量：只在 PostgreSQL 事务提交成功后返回 ACK；同一 (project_id, batch_id) + 内容 hash 只入库一次 → 可能拒、绝不重。",
        "合起来：任意单点故障下，一条日志最终恰好入库一次。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么是两种不同的问题",
      body: "Agent 面对的是「文件系统崩溃一致性」（WAL 半写、fsync 语义、文件轮转）；Server 面对的是「并发去重与事务边界」（同一批重传可能并发到达、提交与 ACK 之间崩溃）。你已有的 WAL 心智在这里不会浪费，但 Server 侧的新主角是数据库事务。",
    },
    {
      type: "heading",
      text: "Server 的形态：模块化单体",
    },
    {
      type: "paragraph",
      text: "Server 刻意不是微服务，而是一个「模块化单体」（决策记录在 docs/adr/0001-modular-monolith.md）：一个进程、一个 PostgreSQL，内部按业务切成四个平面。这么做换来的是：事务可以跨平面保持原子（比如「建管道 + 写审计」在同一事务），部署只有一个单元，演进边界靠 package 纪律而不是网络。",
    },
    {
      type: "table",
      caption: "四个业务平面",
      headers: ["平面", "职责", "典型 endpoint", "核心仓储"],
      rows: [
        ["Control", "项目 / 凭据 / Agent / 管道 / 审计", "POST /agents/:id/heartbeat", "project, api_key, agent, pipeline, audit"],
        ["Ingest", "批校验 / 幂等 / 事务写入", "POST /batches", "ingest_batches, log_entries"],
        ["Query", "受限检索 / 游标分页", "GET /entries", "log_entries"],
        ["Operations", "保留清理 / 隔离重放 / 用量", "后台任务", "retention, quarantine, usage"],
      ],
    },
    {
      type: "paragraph",
      text: "四平面之外还有横切组件：httpapi（HTTP 适配）、auth（认证）、admission（限流）、bootstrap（装配）。代码里它们各是一个 package：internal/server/control、internal/server/ingest、internal/server/query、internal/server/operations，加上 internal/storage/postgres（所有 SQL）与 internal/protocol/ingestv1（Agent/Server 共享的协议包）。",
    },
    {
      type: "heading",
      text: "分层纪律：谁不能碰什么",
    },
    {
      type: "paragraph",
      text: "AGENTS.md 定了一条贯穿全仓的边界：HTTP 适配器不拥有 SQL 或领域规则；PostgreSQL 适配器不拥有鉴权策略。落到代码上的可观察结果是：任何 handler 里看不到 SQL，任何 storage 文件里看不到 scope 判断。后面几课你会反复看到这条纪律如何让每一层可以独立测试。",
    },
    {
      type: "keypoints",
      items: [
        "Server 是模块化单体：一个进程 + PostgreSQL，四平面 + 横切层。",
        "可靠性的分工：Agent 至少一次传输，Server 幂等去重，合起来恰好一次入库。",
        "Server 侧的新主角是数据库事务，不是 WAL。",
        "分层纪律：HTTP 层无 SQL、存储层无鉴权。",
      ],
    },
    {
      type: "quiz",
      question: "「Server 只在事务提交成功后返回 ACK」这个不变量，直接防止了下面哪种数据问题？",
      options: [
        "Agent 本地 WAL 半写导致的数据丢失",
        "Server 提交后、ACK 前崩溃导致的重复入库",
        "日志文件轮转导致的重复读取",
        "Agent 时钟偏差导致的 retention 误删",
      ],
      answer: 1,
      explanation:
        "如果先回 ACK 再提交，ACK 后提交前崩溃，Agent 已释放该批 → 数据丢。先提交再 ACK，即使 ACK 前崩溃，Agent 重试同一 batch 会命中 duplicate → 不重复。这正是 Server 不变量要防的「重复入库」窗口。",
    },
  ],
};
