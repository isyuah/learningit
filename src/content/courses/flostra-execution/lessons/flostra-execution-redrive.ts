import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "flostra-execution-redrive",
  courseSlug: "flostra-execution",
  title: "Redrive：为什么重跑必须显式、幂等并留下审计",
  summary: "从 FAILED/TIMED_OUT 恢复一项 execution，理解 redrive 的资格检查、幂等键、锁顺序和审计记录。",
  minutes: 38,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "Redrive 看起来像“把 status 改回 QUEUED”，但那样做会留下大量竞态：旧 attempt 可能仍在运行，outbox 可能还在发布，两个管理员可能同时点击重跑，操作员也无法解释为什么一次失败又执行了一遍。当前 `gback/internal/execution/redrive.go` 把 redrive 当成一项有权限、有资格、有审计的控制面操作。",
    },
    {
      type: "heading",
      text: "Redrive 的五个问题",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "谁请求了重跑？必须保存 actorID，而不是只留下一个系统时间。",
        "这次请求是否重复？同一个 execution + action + Idempotency-Key 只能产生一次 redrive 动作。",
        "现在是否可以重跑？只允许 FAILED 或 TIMED_OUT，且 outbox 不能仍处于活跃发布。",
        "旧 attempt 是否已经失去资格？如果还有活跃 attempt，先拒绝，而不是并行再发一条。",
        "重跑之后如何回到正常链路？只重置数据库事实，让 outbox dispatcher 继续负责新投递。",
      ],
    },
    {
      type: "code",
      title: "Redrive 的事务骨架",
      language: "text",
      code: `validate actor + idempotency key
  -> lock outbox row
  -> lock execution row
  -> re-check duplicate audit
  -> require FAILED or TIMED_OUT
  -> require delivery not active
  -> require current attempt not active
  -> clear cancellation marker (bounded Redis call)
  -> insert immutable audit(from -> QUEUED)
  -> reset execution(current_attempt_id = null)
  -> reset outbox(status = PENDING, attempts = 0)
  -> commit
  -> later dispatcher creates a fresh attempt`,
    },
    {
      type: "paragraph",
      text: "这里有一个值得练习的阅读方法：把函数拆成“资格检查”和“状态改变”两半。`Redrive` 前半段的错误返回不是多余防御，而是在定义操作员可以承担的责任边界；后半段不是直接 publish，而是恢复 outbox，让正常 dispatcher 决定何时、由谁发送。",
    },
    {
      type: "table",
      caption: "Redrive 的资格检查及其理由",
      headers: ["检查", "失败时返回", "防止什么"],
      rows: [
        ["Idempotency-Key 非空、长度和控制字符合法", "400", "把用户输入直接当唯一键或把敏感原文写进审计"],
        ["execution 是 FAILED 或 TIMED_OUT", "409", "重跑一个仍在 QUEUED/RUNNING 的任务造成并发执行"],
        ["outbox 状态可 redrive", "409", "旧 dispatcher 仍可能正在发消息"],
        ["current attempt 不活跃", "409", "旧 worker 仍可能产生外部副作用"],
        ["RabbitMQ 与 Redis 可用", "503", "重置了数据库却无法完成协调，留下半完成操作"],
      ],
    },
    {
      type: "heading",
      text: "幂等键保护的是 redrive 动作，不是外部业务副作用",
    },
    {
      type: "paragraph",
      text: "当前实现对 Idempotency-Key 做 SHA-256 digest，只把 digest 放入唯一索引和审计记录，不保存原始 key。并发请求先尝试查找已有 audit；拿到 outbox 锁后还会再次检查一次，防止第二个事务在等待锁期间已经提交。这样同一个请求重试会返回同一个 audit 结果，但新 attempt 内的 HTTP 或邮件副作用仍需要自己的幂等设计。",
    },
    {
      type: "callout",
      variant: "note",
      title: "为什么 redrive 要锁 outbox 再锁 execution",
      body: "dispatcher 通常先处理 outbox，再关联 execution；redrive 如果反过来加锁，可能与 dispatcher 或 watchdog 形成循环等待。当前代码把锁顺序固定为 outbox → execution，并在等待锁之后重新检查幂等记录和状态，说明锁顺序是并发协议的一部分，而不是实现细节。",
    },
    {
      type: "subheading",
      text: "Redrive 后三张表是什么样",
    },
    {
      type: "table",
      headers: ["记录", "redrive 后立即值", "之后由谁改变"],
      rows: [
        ["execution", "QUEUED，current_attempt_id = null，清除失败信息", "新 attempt 的 worker 事件或 watchdog"],
        ["outbox", "PENDING，attempts = 0，清除 lease/error/published_at", "dispatcher"],
        ["audit", "追加一条不可变 FAILED/TIMED_OUT → QUEUED", "不修改；它是历史证据"],
        ["旧 attempt", "保持原来的终态/失效状态", "不复活；新投递创建新行"],
      ],
    },
    {
      type: "exercise",
      title: "练习：判断两次点击是否产生两次重跑",
      description: "假设管理员 A 和 B 几乎同时对同一 execution 使用相同 Idempotency-Key，管理员 C 使用不同 key。分别推演三条请求会看到什么：哪条返回 idempotent=true，哪条会因为已有 redrive 或 execution 已 QUEUED 而返回 409，audit 表最终有几行。",
      hint: "同一个 key 的重复请求应收敛到同一 audit；不同 key 不是天然允许并发，第二个请求还要重新检查 execution 已经不是 FAILED/TIMED_OUT。",
    },
    {
      type: "quiz",
      question: "Redrive 为什么不直接调用 publisher，而是把 outbox 重置为 PENDING？",
      options: [
        "因为 publisher 只能由前端调用",
        "因为恢复数据库事实后仍应复用正常 dispatcher 的 lease、重试、Attempt 和确认流程",
        "因为 PENDING 比 PUBLISHED 更快",
        "因为 RabbitMQ 不支持手动发送",
      ],
      answer: 1,
      explanation: "Redrive 是控制面状态恢复，不应复制一套发送逻辑。重置 outbox 后由 dispatcher 继续处理，可以保持相同的 lease、Attempt fencing、超时和失败分类。",
    },
    {
      type: "keypoints",
      items: [
        "Redrive 是有资格检查、授权主体和审计的运维动作，不是简单改 status。",
        "同一个 execution + action + 幂等键只产生一次 redrive 动作；这不等于外部副作用 exactly-once。",
        "重跑前必须确认旧 delivery/attempt 不活跃，避免两个 worker 同时产生副作用。",
        "Redrive 只恢复 execution/outbox 的数据库事实，真正投递仍交给 dispatcher。",
        "锁顺序与拿锁后的二次检查共同构成并发协议。",
      ],
    },
  ],
};
