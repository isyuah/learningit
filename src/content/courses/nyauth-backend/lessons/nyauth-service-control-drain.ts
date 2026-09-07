/* ==================================================================
 * 课时：能力 gate 与 in-flight 排空（nyauth-service-control-drain）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与文件名一致。
 * 内容块类型见 ../../../types.ts。
 * 本课时讲解 nyauth 的服务控制：按能力暂停、lease 与排空、
 * 多实例心跳 fail-closed，以及 break-glass 语义。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  "slug": "nyauth-service-control-drain",
  "courseSlug": "nyauth-backend",
  "title": "能力 gate 与 in-flight 排空",
  "summary": "运维不只是开关整个端口：如何按能力暂停、让旧请求排空、并保证多实例一致地 fail-closed。",
  "minutes": 20,
  "kind": "reading",
  "blocks": [
    {
      "type": "paragraph",
      "text": "当你需要「临时关掉注册」或「给数据库做维护」时，最粗暴的办法是把整个进程停掉。但这么做既切断了所有流量，又无法区分「我在刻意暂停某类操作」和「服务坏了」。nyauth 的服务控制（service control）把这个问题重构成：不关整个 HTTP 端口，而是按「能力」（capability）暂停，让正在进行的请求有尊严地收尾——这一课讲它的模型、lease、排空、心跳与 fail-closed。"
    },
    {
      "type": "heading",
      "text": "按能力暂停，而不是关端口"
    },
    {
      "type": "paragraph",
      "text": "一个认证实例同时处理登录、注册、发邮件、写头像、管理操作等彼此无关的事情。维护时往往只想停掉其中一类。nyauth 定义了六个独立的受控能力，每个能力对应一个「可以单独开/关的操作类别」。暂停某个能力，只影响走到对应 gate 的请求。"
    },
    {
      "type": "list",
      "items": [
        "self_registration —— 公开自助注册",
        "account_mutations —— 账户相关的变更（改邮箱、密码等）",
        "admin_mutations —— 管理端变更",
        "auth_issuance —— 签发认证/token（登录等关键路径）",
        "mail_delivery —— 邮件投递 worker",
        "media_writes —— 头像等媒体写入"
      ]
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "为什么是「能力」而不是「开关一个进程」",
      "body": "能力门控把「维护意图」表达成数据（存 PostgreSQL，写审计、可跨实例同步、可按 preset 一键暂停多类），而不是靠运维去杀进程。比如做媒体存储迁移时要同时暂停 media_writes 与相关变更类——这些是业务语义，放数据库里可以让管理员与审计都能看到、能回滚、能被 CLI 强制恢复。它本质上是一种「受控的、可编排的、有排空的停机」。"
    },
    {
      "type": "heading",
      "text": "lease：请求开始取、结束还"
    },
    {
      "type": "paragraph",
      "text": "每个走到能力 gate 的请求，在开始时通过 middleware 调用 `Acquire`（对应 `Controller.AcquireAll`）拿到一个 lease，结束时 `defer release()` 归还（`Lease.Release` 是幂等的，用 `sync.Once` 保证只释放一次）。lease 的作用是：让 controller 精确知道此刻每个能力有多少个「在途中」（in-flight）请求。这是实现排空的基础——要等旧请求走完，你得能数出它们。"
    },
    {
      "type": "code",
      "title": "能力 gate 的 lease 生命周期（对照服务端 capabilityMiddleware）",
      "language": "go",
      "code": "// middleware 包裹每个需要该能力的路由\nfunc (s *Server) capabilityMiddleware(caps ...Capability) func(http.Handler) http.Handler {\n    return func(next http.Handler) http.Handler {\n        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n            release, err := s.acquireCapabilities(caps...)   // 请求开始：acquire\n            if err != nil {\n                s.writeCapabilityPaused(w, err)              // 门关着 -> 503 + Retry-After\n                return\n            }\n            defer release()                                  // 请求结束：release\n            next.ServeHTTP(w, r)\n        })\n    }\n}"
    },
    {
      "type": "paragraph",
      "text": "`Controller` 内部有个 `inFlight map[Capability]int64` 计数器，配合一把互斥锁让「检查 + 计数」对 revision 变更原子。`AcquireAll` 会先看两条：是否处于 fail-closed（见下），以及当前生效快照里这些能力是否在暂停列表（`PausedCapabilities`）。只要任一被暂停，就返回 `PausedError`，HTTP 层转成 `503 Service Unavailable` 并带 `Retry-After`。"
    },
    {
      "type": "heading",
      "text": "排空序列：先关门，再等旧请求走完"
    },
    {
      "type": "paragraph",
      "text": "暂停一个能力的真正难点在「新 revision 到达时」：你得既不让新请求进来，又给已经 admit 的旧请求足够时间完成。nyauth 把它们拆成两步：先 `publish`（同步关门），再 `WaitApplied`（等旧 lease 排空）。"
    },
    {
      "type": "code",
      "title": "排空序列（对照 Apply / publishAndWait）",
      "language": "text",
      "code": "管理员提交暂停 -> 数据库写入新 revision R（pauses 列表变化）\n1) 本实例 publish(R)：停用快照里暂停能力的 gate（此刻起新请求被 503 拒绝）\n2) 等待已 admit 的 in-flight 请求逐个 release，直到这些能力 in-flight 归零\n3) appliedRevision >= R       -> 本实例标记 applied\n4) publishAndWait 轮询数据库 application 状态，收集所有活动实例的排空确认\n5) 全部实例 applied（或 5 秒 ApplyTimeout 到）-> 返回 202 applying\n   （设置已生效，不会自动回滚；管理员再轮询管理状态直到所有实例 applied）"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "为什么先关门再等，而不是等完再关门",
      "body": "关门和排空是两个独立目标：关门要立刻生效（不能放了新请求再慢慢关门，否则永远关不完），排空要宽松（给旧请求时间）。`publish` 负责前者（同步、立即），`WaitApplied` 负责后者（异步、带超时）。把两者拆开还有一个好处：manager 可以先上报 `loaded_revision`，同时后台等本地与远端实例排空。排空有上限（默认 5 秒 ApplyTimeout），超时返回 pending 状态，但部署不会假装已排空。"
    },
    {
      "type": "heading",
      "text": "多实例心跳与 fail-closed"
    },
    {
      "type": "paragraph",
      "text": "在 HA 里，每个实例在数据库里维护自己的 liveness 行，默认每 5 秒 `MarkHeartbeat` 刷新一次（`heartbeatLoop`），并每 5 秒做一次 reconciliation 刷新状态快照。`Controller.failClosedLocked` 的判断是：当前还没有加载过快照、或距上次状态刷新超过 `staleAfter`（默认 15 秒）、或距上次心跳超过 `staleAfter`——只要任一成立，这个实例对全部六个受控能力 fail-closed，即拒绝一切走 gate 的工作。"
    },
    {
      "type": "paragraph",
      "text": "为什么心跳过期要 fail-closed 而不是继续服务？因为「这个实例是否还跟得上全局暂停状态」取决于它能否持续证明自己与数据库同步。一个失联 15 秒的实例无法确定其它管理员是否刚暂停了某个高风险能力（比如 auth_issuance）；继续签发就是让它在一个未知的全局状态上行动。宁可拒绝受控的写路径，也不能冒险在管理员以为已暂停时继续放行。注意：fail-closed 只影响六个受控能力——健康检查、撤销、登出、审计、清理这些路径仍然可用，这也是「不让 /readyz 失败」的一部分。"
    },
    {
      "type": "callout",
      "variant": "warning",
      "title": "503 与 500 的区别",
      "body": "暂停/维护返回 503（Service Unavailable）而不是 500（Internal Server Error）。语义上：503 是「我此刻没坏的，是刻意不接受这类工作，稍后可恢复」，客户端/代理会配合 Retry-After 重试或被 LB 分流；500 是「内部出错了」。面试时要把这个区别讲清楚：503 表示的是一个明确的、临时的、可重试的服务状态，是受控停机的一部分，而不是故障信号。"
    },
    {
      "type": "callout",
      "variant": "note",
      "title": "主动维护不能拉垮 /readyz",
      "body": "`/readyz` 回答的是「这个实例物理上是否能接收流量、核心依赖是否可用」（DB、Redis、schema、JWK、provider）。主动维护是「运维刻意暂停某类操作」的另一个维度——所以它是独立的 operating 状态，绝不能因为「正在维护」就让 /readyz 返回失败。否则负载均衡会把这个实例摘掉，你本想在维护时保留的其它能力（健康、登出、审计、撤销）反而被流量调度绕开，甚至让整个集群陷入「维护实例被摘走、健康实例更忙」的恶性循环。维护是 503 级别、定向的暂停，不是节点级的 down。"
    },
    {
      "type": "heading",
      "text": "CLI break-glass reset"
    },
    {
      "type": "paragraph",
      "text": "万一管理 UI 不可用、数据库协调正常但管理员被自己的暂停锁住（比如无限期暂停所有能力），就需要一条不依赖 Web 的逃生通道。`service-control reset` 是 CLI 的 break-glass 突变：它不经过一个用户 actor（没有交互式身份），只用 runtime PostgreSQL DSN 就能执行——删除全部暂停、把 revision 加一、清空消息，并写一条带强制理由的 critical 审计。命令默认等待在线实例一段时间并输出 JSON 应用进度，配合 revision CAS 保证幂等。文档明确要求不要在两个节点并发重复执行：会多出无意义的审计与 revision，但 CAS 保证状态仍一致。"
    },
    {
      "type": "callout",
      "variant": "tip",
      "title": "为什么 break-glass 要「绕过可信 UI」但仍审计",
      "body": "break-glass 的两个设计要点看似矛盾：一是要有「即使管理端和数据库管理入口都不可用也能恢复」的通道（所以是 CLI 直连数据库，不开放额外端口）；二是这条通道不能毫无痕迹（所以仍写 critical 审计，带 mandatory reason）。恢复能力 ≠ 偷偷摸摸：绕过的是 UI 和身份入口，不是审计责任。面试答「什么时候需要 CLI break-glass reset」时，点出「管理 UI 不可用时的紧急解锁」即可。"
    },
    {
      "type": "quiz",
      "question": "一个实例 15 秒未能刷新数据库心跳与状态快照。下面哪个描述最准确？",
      "options": [
        "它继续为全部能力服务，因为暂停只在管理端生效",
        "它对六个受控能力 fail-closed（拒绝走 gate 的新工作），但健康检查、登出、撤销等仍可用",
        "它整个进程退出，交给负载均衡摘除",
        "它把所有请求都返回 500"
      ],
      "answer": 1,
      "explanation": "failClosedLocked 在心跳或状态刷新超过 staleAfter 时成立，实例拒绝受控能力的新工作；但非受控路径（健康、撤销、登出、审计、清理）和 /readyz 不受影响，目的是避免在未知全局暂停状态下继续放行高风险操作。"
    },
    {
      "type": "keypoints",
      "items": [
        "服务控制是按能力暂停，不是关整个端口；六个能力可单独编排",
        "每个受控请求：开始 acquire lease、结束 release，in-flight 计数支撑排空",
        "排空两步：先 publish 关门（立即），再 WaitApplied 等旧 in-flight 归零（带 5s 上限）",
        "多实例：5s 心跳 + 5s reconciliation；超过 staleAfter（15s）fail-closed 六个能力",
        "fail-closed 不影响健康检查、撤销、登出、审计、清理与 /readyz",
        "暂停返回 503 + Retry-After（可重试的明确状态），不是 500",
        "主动维护是独立 operating 状态，绝不能拉垮 /readyz",
        "CLI service-control reset 是 break-glass：绕过 UI 但强制理由 + critical 审计"
      ]
    }
  ]
};
