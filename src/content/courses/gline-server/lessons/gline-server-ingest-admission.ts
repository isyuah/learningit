/* ==================================================================
 * 课时：准入限流：令牌桶与 reservation（gline-server-ingest-admission）
 * ----------------------------------------------------------------
 * 事实源：E:/Proj/gline-full 当前源码（file:line 指向仓库根）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "gline-server-ingest-admission",
  courseSlug: "gline-server",
  title: "准入限流：令牌桶与 reservation",
  summary: "限流怎么做到「不丢数据地保护 Server」？为什么扣费要等事务成功、拒绝要退款？",
  minutes: 16,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "Server 要防的不是恶意攻击,而是「大量 Agent 同时重试」把数据库打垮。准入层(admission)在事务之前用令牌桶决定「这一批现在能不能进」,超限返回 429 + Retry-After。关键设计:Agent 收到 429 会保留同一批稍后重试——**限流不丢数据,只是推迟**。",
    },
    {
      type: "heading",
      text: "三层预算:每 key 请求率 + 每 project 资源",
    },
    {
      type: "paragraph",
      text: "AllowIngest(limiter.go:118)维护两组状态:keyState(每 key 一个请求令牌桶)与 projectState(每 project 的 entries/bytes 令牌桶 + inflight 计数)。检查顺序:",
    },
    {
      type: "code",
      title: "AllowIngest 的预算检查链",
      language: "text",
      code: "1. 单批硬上限:entries > EntriesPerMinute 或 payloadBytes > BytesPerMinute\n     -> ErrBatchExceedsCapacity (413 admission_capacity_exceeded)\n\n2. key 请求令牌桶(每 key 每分钟 N 次请求)\n     tokens < 1 -> 429 rate_limited (ReasonKeyRate) + Retry-After\n\n3. project.entries 令牌桶(每 project 每分钟 N 条 entry)\n     不够本批 -> 429 (ReasonProjectEntries) + Retry-After\n\n4. project.bytes 令牌桶(每 project 每分钟 N 字节)\n     不够本批 -> 429 (ReasonProjectBytes) + Retry-After\n\n5. project.inflight >= MaxInflight(并发在途批次)\n     -> 429 (ReasonProjectInflight, Retry-After=1s)\n\n全部通过 -> 扣 tokens、inflight++、返回 Reservation",
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么单批超限是 413 而不是 429",
      body: "ErrBatchExceedsCapacity 意味着「这一批本身就超过预算上限,重试也没用」(比如 4MB 的批 > 单批上限)——所以是 413 admission_capacity_exceeded,Agent 侧归为 quarantine(批坏了),而不是 retryable。429 只留给「现在满、稍后有空」的限流。",
    },
    {
      type: "heading",
      text: "Reservation:先预留、后结算",
    },
    {
      type: "paragraph",
      text: "AllowIngest 返回的不是「通行证」而是 reservation(预留):tokens 已经被扣了、inflight 已经加了。调用方(ingest.Service.Accept)在事务结束后决定预留的命运:",
    },
    {
      type: "code",
      title: "Accept 里的 reservation 用法(ingest/service.go)",
      language: "go",
      code: "reservation, err := s.admission.AllowIngest(...)   // 扣 tokens,inflight++\nif err != nil { return }\ndefer reservation.Release()        // 兜底:任何提前返回都会退款\n\nerr = s.withinTx(...)              // 事务...\n\nif result.Status == StatusAccepted && reservation != nil {\n    reservation.Commit()            // 只有 accepted 才真正消费预留\n}\n// duplicate/错误路径:defer Release() 退款,inflight--",
    },
    {
      type: "list",
      items: [
        "Commit():真正消费——事务提交成功、数据入库了,扣掉的 tokens 不退。",
        "Release():退款——duplicate(没写数据)或事务失败,把 tokens 还回去、inflight 减一。",
        "为什么:如果不退款,duplicate/失败请求会持续消耗预算,最终「什么都没写进去,预算却被耗光」——限流本身造成数据不一致。",
      ],
    },
    {
      type: "heading",
      text: "令牌桶:平滑突发、自动恢复",
    },
    {
      type: "paragraph",
      text: "令牌桶(tokens 浮点 + last 时间戳)在每次检查前按速率 refill:距离上次的时间 × 每分钟容量 = 新增 tokens,封顶容量。好处:允许短时突发(桶是满的),长期超速被平滑限流,且 Agent 退避后桶会自动回满——不需要人工重置。retryAfter 函数根据「还差多少 tokens / 速率」算出建议秒数,写进 Retry-After 头。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "诚实的边界:per-process,不是全局配额",
      body: "这份限流状态存在单进程内存里(map + mutex),是每 Server 进程的本地令牌桶。多副本部署时,集群有效额度 ≈ 各副本之和,不是精确全局配额(README 明示)。单机单体的当前形态下这是诚实边界;要做全局配额需要共享存储(Redis/DB),属演进项。",
    },
    {
      type: "quiz",
      question: "为什么 duplicate 的批(数据其实已入库)要走 reservation.Release() 退款?",
      options: [
        "因为 duplicate 的批没有经过事务",
        "因为 duplicate 没有写入新数据,不该消耗预算;否则重试风暴会把预算耗光",
        "因为 Release 会触发数据库回滚",
        "因为 duplicate 的批要重新排队",
      ],
      answer: 1,
      explanation:
        "duplicate 意味着同批已入库,这次请求没有产生任何写入。如果它仍消耗 tokens,大量重试(Agent 超时后并发重试同批)会把预算耗光,导致真正的新数据被 429 拒绝——限流本身造成数据饥饿。Release 把预留还回去,只让真正 accepted(有写入)的请求消费预算。",
    },
    {
      type: "keypoints",
      items: [
        "三层预算:每 key 请求率、每 project 条目率/字节率、每 project 并发在途。",
        "单批超限 = 413(重试无用);临时满 = 429 + Retry-After(稍后重试)。",
        "Reservation 先扣后结:accepted 才 Commit,duplicate/失败 Release 退款。",
        "限流不丢数据——429 让 Agent 保留批次重试,只是推迟。",
        "本地令牌桶是 per-process,非全局配额(诚实边界)。",
      ],
    },
  ],
};
