/* ==================================================================
 * 课时：并发模型：线程、事件循环与协程（sc-concurrency-models）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 章节 2「请求路径与 IO：第一公里的性能」第 2 课。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "从 C10K 问题出发，对比「线程每连接 / 事件循环 / 协程」三种并发模型，理解阻塞 IO 为什么限死了并发上限，以及 Go 如何用同步风格的代码实现高并发。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课讲完网络栈，这一课回答「服务端如何同时伺候成千上万个连接」。1999 年 Dan Kegel 提出 C10K 问题：在千兆网卡、单台服务器的年代，如何支持一万个并发连接？问题听起来过时——今天的单机已能支撑百万级并发连接，讨论前沿也从 C10K 推进到了 C10M（千万级）——但**制约方式的演化史**恰恰是并发模型的主线：从「一连接一线程」到事件循环，再到 Go 的 goroutine，每一种模型都是在回答同一个问题：当一个线程阻塞在 IO 上时，CPU 核闲置了怎么办？",
    },
    {
      type: "heading",
      text: "模型一：多线程，一连接一线程（阻塞 IO）",
    },
    {
      type: "paragraph",
      text: "**阻塞 IO**：进程发起读/写后睡眠，直到数据就绪/写完才返回，期间不占用 CPU 但线程本身被挂起。最早的写法就是每个连接分配一个线程，线程内用阻塞的 read/write 处理。编程极其简单：逻辑天然顺序。代价是线程本身昂贵——现代 Linux 上每条线程默认约 8 MB 虚拟内存栈（具体随 ulimit 与配置变化），线程创建、切换都要进入内核。1 万个连接配 1 万个线程，光栈就是几十 GB 虚拟内存，加上频繁上下文切换，系统很快被「伺候线程」本身拖垮。结论：**阻塞模型的天花板不在 CPU，在线程数量**。",
    },
    {
      type: "heading",
      text: "模型二：事件循环（非阻塞 + epoll）",
    },
    {
      type: "paragraph",
      text: "换一个思路：把 socket 设为**非阻塞**——调用立即返回「未就绪」，稍后再查询或等通知；连接不配线程，只配一个状态；进程把成千上万个 socket 交给 epoll 统一监听，内核告诉它「哪些连接可读可写」，它就只处理就绪的那些。单线程在用户态处理所有事件，这就是 Node.js、Redis、Nginx（多进程下的每个 worker）采用的模型。这条路收益与约束同在：单线程没有锁竞争、纯 IO 密集下延迟抖动小，Redis 单线程模型能到每秒十万级命令正是巅峰示例；但代码被拆成「回调/状态机」，一个请求的生命周期散落在多个回调里，而且任何一段同步的 CPU 密集计算都会堵死整个循环（Node 的经典警告：别在回调里跑重计算）。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "C10K 的教训：连接多 ≠ 计算多，别为「并发连接」本身买单",
      body: "一万个连接绝大多数时间在等客户端，真正活跃的只有一小撮。按「连接数 × 每连接开销」设计并发，是对资源的巨大浪费。正确做法是按「同时活跃的任务数」（受 CPU 核数与 IO 等待支配）配置并发能力。这条直觉贯穿本章，也是连接池与线程池大小的共同出发点（第 3 课展开）。",
    },
    {
      type: "heading",
      text: "模型三：协程——把异步写成同步（Go 的解法）",
    },
    {
      type: "paragraph",
      text: "Go 选择了第三条路。goroutine 是用户态协程，初始栈只有几 KB、按需增长，几十万并发在内存上可行（数量级概念，栈会增长，不能简单乘算）；由 Go 运行时把阻塞点包装成非阻塞：goroutine 发起网络 IO 时挂起自己并让出线程，运行时的 **netpoller** 用 epoll 等机制监听 socket，数据就绪后把 goroutine 唤醒继续跑。对程序员而言，代码是线性同步的——没有回调地狱；对机器而言，底层仍是事件驱动。",
    },
    {
      type: "code",
      title: "net/http：Go 默认就是 goroutine-per-request",
      language: "go",
      code: `// sale 服务里典型的处理器：每个请求由 net/http 自动分配一个 goroutine，
// 内部代码可以像单线程程序一样顺序书写（标准库行为，不涉及第三方 API）。
func (s *Server) handleCreateOrder(w http.ResponseWriter, r *http.Request) {
    var req CreateOrderReq
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil { // 读请求体（IO）
        http.Error(w, "bad request", http.StatusBadRequest)
        return
    }
    order, err := s.orderSvc.Create(r.Context(), req) // 内部会访问 Redis/MySQL（IO）
    if err != nil {
        http.Error(w, err.Error(), http.StatusServiceUnavailable)
        return
    }
    _ = json.NewEncoder(w).Encode(order) // 写响应（IO）
}`,
    },
    {
      type: "paragraph",
      text: "这段代码里每一处 IO（读请求、访问 Redis/MySQL、写响应）都会把当前 goroutine 挂起、让出线程，就绪后再恢复。`net/http` 每个请求起一个 goroutine 的开销远小于线程，所以「goroutine-per-request」能支撑数万并发；真正占用线程的只有**正在跑 CPU 或正被 netpoller 唤醒执行**的少数 goroutine。线程池大小问题推迟到下一课细说。",
    },
    {
      type: "heading",
      text: "IO 密集与 CPU 密集：配比的正确问法",
    },
    {
      type: "paragraph",
      text: "线程模型下常问「线程池该设多大」；换成 goroutine 后问题变成「多少并发合适」。判据是任务类型：**IO 密集**的任务大部分时间在等（等网络、等磁盘），并发可以远超核数，因为等待不占 CPU——sale 的下单请求链路由多次 IO 组成，属于此类；**CPU 密集**的任务（图片处理、加解密、压缩、JSON 大对象序列化）几乎全程占核，并发超过核数只会引入上下文切换，理论最优接近核数。",
    },
    {
      type: "table",
      caption: "三种并发模型速查",
      headers: ["模型", "代表", "IO 并发的代价", "最大短板"],
      rows: [
        ["多线程阻塞", "经典线程池 Web 服务", "每个连接一个线程", "线程数与切换开销，连接数受限"],
        ["事件循环", "Node.js、Redis、Nginx worker", "状态机 + 回调，代码被拆散", "任何同步重计算堵死整个循环"],
        ["协程", "Go goroutine + netpoller", "用户态协程，同步写法", "需运行时调度；CPU 密集同样占核"],
      ],
    },
    {
      type: "paragraph",
      text: "三种模型怎么选？业务以 IO 为主、希望线性代码 → 协程模型（Go）或事件循环配 async/await；强实时/低延迟且回调可控 → 事件循环；要跑大量 CPU 计算且需要简单同步代码 → 多线程 + 核数级线程池（Go 则 goroutine + GOMAXPROCS 天然并行）；混合负载 → 协程/事件循环负责 IO、把 CPU 重活隔离到专用 worker。闪购的 sale 服务选 Go 的意义正是：**用同步风格写出事件驱动的吞吐**。",
    },
    {
      type: "quiz",
      question:
        "压测一个 CPU 密集的 Go 服务（如纯图片处理）：网络 IO 完全空闲、CPU 已近打满，此时继续增加并发（goroutine/线程）数量，吞吐却不再上升。最可能的原因是什么？",
      options: [
        "goroutine 数量还不够，需要继续成倍增加",
        "CPU 密集任务吃的是核时：并发超过核数只会增加上下文切换，瓶颈在核数与单核计算",
        "epoll 监听数量达到上限，需要换事件循环模型",
        "连接复用得不够，需要更多 keep-alive 连接",
      ],
      answer: 1,
      explanation:
        "IO 空闲、CPU 打满说明瓶颈在核时而非等待：CPU 密集任务的理论并发上限约等于核数，超过后每个 goroutine 分到的执行时间更碎、上下文切换开销上升，吞吐不再增长。此时应优化计算本身或加核（垂直/水平扩容），而不是继续加大并发。",
    },
    {
      type: "keypoints",
      items: [
        "C10K 的本质：并发连接数不应由「线程数」买单，多数连接只是挂着等。",
        "多线程阻塞模型天花板在线程数量；事件循环（epoll）让单线程支撑海量连接，但代码被拆成回调。",
        "Go 的 goroutine + netpoller：用户态协程 + 内核事件通知，代码保持同步线性，net/http 默认 goroutine-per-request。",
        "IO 密集并发可远超核数（等不占 CPU）；CPU 密集并发约等于核数，多了只有切换开销。",
        "模型选择看负载与写码心智：协程兼顾吞吐与可维护性，是 sale 服务选型的主因。",
      ],
    },
  ],
};
