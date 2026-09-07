import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-server-concurrency",
  courseSlug: "grpc-go",
  title: "高并发下的服务端资源保护",
  summary:
    "理解 gRPC 服务端并发模型，用同步原语保护共享状态，用限流与过载保护防止客户端把服务压垮。",
  minutes: 34,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前面学的是“一次调用如何正确完成”，这一节回答“很多调用同时到达时，服务端如何不崩溃”。gRPC-Go 服务端会为每个 RPC 启动 goroutine 处理，同一时刻可能有成百上千个 handler 在运行。它们共享同一个进程、同一个数据库连接池和同一份内存状态。没有并发保护，任何一处共享写操作都可能变成数据竞争。",
    },
    {
      type: "heading",
      text: "先认清并发模型",
    },
    {
      type: "list",
      items: [
        "每个 RPC 在其自己的 goroutine 中运行，handler 之间天然并发。",
        "grpc.Server 默认能同时处理大量并发调用，具体上限受系统资源约束。",
        "共享内存（缓存、计数器、连接池）需要同步；每个 handler 的局部变量是安全的。",
        "并发不仅来自客户端，还来自服务端自己启动的后台任务和流式消息。",
      ],
    },
    {
      type: "paragraph",
      text: "这意味着“我的 handler 里没写 go 关键字，所以没有并发”是错误认识。两个客户端同时调用 GetBook，两个 handler 就在并发执行；如果它们都读写同一个 map 缓存，就需要同步。",
    },
    {
      type: "heading",
      text: "共享状态要明确所有权",
    },
    {
      type: "code",
      title: "用互斥锁保护共享缓存",
      language: "go",
      code: 'type cache struct {\n  mu sync.RWMutex\n  books map[string]*pb.Book\n}\n\nfunc (c *cache) Get(isbn string) (*pb.Book, bool) {\n  c.mu.RLock()\n  defer c.mu.RUnlock()\n  b, ok := c.books[isbn]\n  return b, ok\n}\n\nfunc (c *cache) Put(isbn string, b *pb.Book) {\n  c.mu.Lock()\n  defer c.mu.Unlock()\n  c.books[isbn] = b\n}',
    },
    {
      type: "paragraph",
      text: "互斥锁能消除数据竞争，但持锁时间要短：不要在锁内做网络调用、数据库查询或重计算，否则锁会变成全局瓶颈。更进阶的做法是用 sync.Map、分片缓存或让状态只由单一 owner 写入。选择的依据是访问模式和一致性要求，而不是“哪种写法看起来简单”。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "数据竞争不等于立刻崩溃",
      body: "竞态可能只在特定调度下表现为错误结果、偶发 panic 或内存损坏，用 go test -race 才能稳定暴露。交付前应让测试在 -race 下运行，尤其是并发访问共享缓存的测试。",
    },
    {
      type: "heading",
      text: "连接池、goroutine 与资源边界",
    },
    {
      type: "code",
      title: "限制后台并发，而不是无限创建",
      language: "go",
      code: 'var sem = make(chan struct{}, 32) // 最多 32 个并发后台任务\n\nfunc (s *catalogServer) Reindex(ctx context.Context, req *pb.ReindexRequest) (*pb.ReindexSummary, error) {\n  select {\n  case sem <- struct{}{}:\n    defer func() { <-sem }()\n  case <-ctx.Done():\n    return nil, status.FromContextError(ctx.Err()).Err()\n  }\n  // 现在最多 32 个 Reindex 并发执行\n}',
    },
    {
      type: "paragraph",
      text: "semaphore 模式把“最多多少个并发”变成显式约束，防止一次性到达的请求创建成千上万个 goroutine。数据库连接池同理：连接数有限，handler 若都等待连接，就会出现排队；把池大小、等待超时和队列上限一起设计，才能让背压传到调用方而不是变成无限堆积。",
    },
    {
      type: "heading",
      text: "限流保护服务而不是拒绝一切",
    },
    {
      type: "code",
      title: "令牌桶限流（示意）",
      language: "go",
      code: 'type rateLimiter struct {\n  mu      sync.Mutex\n  tokens  float64\n  last    time.Time\n  rate    float64 // 每秒补充的令牌\n  burst   float64 // 桶容量\n}\n\nfunc (rl *rateLimiter) Allow() bool {\n  rl.mu.Lock()\n  defer rl.mu.Unlock()\n  now := time.Now()\n  rl.tokens = min(rl.burst, rl.tokens+(now.Sub(rl.last).Seconds()*rl.rate))\n  rl.last = now\n  if rl.tokens < 1 {\n    return false\n  }\n  rl.tokens--\n  return true\n}',
    },
    {
      type: "paragraph",
      text: "令牌桶允许短时突发，又限制长期速率，适合保护单个方法或服务。真正生产环境可以考虑标准限流库或网关层限流，但原理一致。被限流时应返回 ResourceExhausted，并让客户端知道这是可重试的暂时状态（还要受其自身的重试预算约束，避免限流和重试互相放大）。",
    },
    {
      type: "heading",
      text: "过载保护：在资源耗尽前降载",
    },
    {
      type: "table",
      caption: "限流与过载保护的差异",
      headers: ["机制", "依据", "典型动作"],
      rows: [
        ["限流（rate limit）", "预设的速率配额，与当前负载无关", "超过配额即拒绝，返回 ResourceExhausted"],
        ["并发上限（semaphore）", "当前活动调用数", "达到上限时排队或快速失败"],
        ["过载保护（load shedding）", "CPU、内存、队列深度等实时指标", "对低优先级请求快速失败，保护核心路径"],
        ["断路器（circuit breaker）", "最近的失败率", "失败率过高时短暂拒绝进入，给依赖恢复时间"],
      ],
    },
    {
      type: "paragraph",
      text: "限流处理“不该来的流量”，过载保护处理“该来的流量超过能力”。一个实用的组合是：用 semaphore 限制并发，用排队深度或 CPU 指标触发降载，对非核心方法优先拒绝。关键判断是保护哪些请求、牺牲哪些请求，以及被牺牲的请求返回什么 status code，让调用方可以安全降级。",
    },
    {
      type: "callout",
      variant: "note",
      title: "背压应该向前传递，而不是无限缓冲",
      body: "服务端处理不过来时，如果它先把请求放进一个无界队列“让调用看起来很成功”，内存最终会耗尽。让 Send 阻塞、让客户端看到 ResourceExhausted 或 Unavailable，都比吞掉负载更健康。",
    },
    {
      type: "quiz",
      question: "为什么“handler 里没有 go 关键字”不能证明没有并发？",
      options: [
        "因为 gRPC-Go 的每个 RPC 都会在其自己的 goroutine 中执行 handler",
        "因为并发只发生在客户端代码里",
        "因为 protobuf 会自动串行化所有调用",
        "因为 grpc.Server 默认只允许一个请求",
      ],
      answer: 0,
      explanation:
        "gRPC-Go 服务端为每个 RPC 启动独立 goroutine，多个客户端请求会并发执行同一个 handler。即使业务代码没写 go，共享状态仍需要同步。",
    },
    {
      type: "exercise",
      title: "为 CatalogService 设计过载保护",
      description:
        "为 GetBook 与 RecordReading 设计限流、并发上限和降载策略：什么情况下拒绝、返回什么 status code、如何保护数据库连接池、哪些请求应该被优先牺牲。给出至少两个可观测指标来验证保护生效。",
      hint:
        "先把读路径和写路径分开设计。读请求可以短暂排队，写请求要警惕重试放大；被拒绝时的 code 要能指导客户端安全降级。",
    },
    {
      type: "keypoints",
      items: [
        "gRPC-Go 为每个 RPC 启动 goroutine，handler 天然并发，共享状态必须同步。",
        "持锁时间要短，不要在锁内做网络调用；用 go test -race 验证并发正确性。",
        "semaphore、连接池上限和排队深度共同决定资源的背压边界。",
        "限流按配额拒绝，过载保护按实时负载降载，两者配合才完整。",
        "被拒绝的请求要返回可判断的 status code，让调用方安全降级而不是盲目重试。",
      ],
    },
  ],
};
