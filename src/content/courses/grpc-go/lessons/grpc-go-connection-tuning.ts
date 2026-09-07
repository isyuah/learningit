import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "grpc-go-connection-tuning",
  courseSlug: "grpc-go",
  title: "Keepalive、流控与消息边界",
  summary:
    "理解连接保活、HTTP/2 流控、消息大小和压缩的边界，用测量而不是猜测做连接级调优。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "gRPC 的性能问题常常不是“序列化够不够快”，而是连接是否被错误地管理：客户端频繁建连、空闲连接被中间设备清掉、单个消息过大、发送队列无界增长，或者服务端把连接级参数当作请求级 timeout。Keepalive、流控和消息限制解决的是不同问题，调参前要先分清它们。",
    },
    {
      type: "heading",
      text: "Keepalive 不是 RPC deadline",
    },
    {
      type: "table",
      caption: "连接级与请求级时间控制",
      headers: ["能力", "作用", "不保证什么"],
      rows: [
        ["RPC deadline", "限制一次调用等待多久", "不保证连接本身存活"],
        ["Keepalive ping", "探测长时间空闲或失联的 HTTP/2 连接", "不替代业务请求超时"],
        ["TCP keepalive", "操作系统层的连接探测", "不理解 gRPC stream 或业务状态"],
        ["健康检查", "判断服务是否适合接收流量", "不一定能发现每个依赖问题"],
      ],
    },
    {
      type: "code",
      title: "客户端 Keepalive 参数",
      language: "go",
      code: 'params := keepalive.ClientParameters{\n  Time:                30 * time.Second,\n  Timeout:             10 * time.Second,\n  PermitWithoutStream: false,\n}\n\nconn, err := grpc.NewClient(\n  target,\n  grpc.WithKeepaliveParams(params),\n  grpc.WithTransportCredentials(creds),\n)\nif err != nil {\n  return err\n}\ndefer conn.Close()',
    },
    {
      type: "paragraph",
      text: "Keepalive 的间隔必须和服务端 enforcement policy、中间代理和网络设备约定。过于激进的 ping 会增加开销，服务端也可能因为客户端违反最小间隔而关闭连接。示例中的数值只是教学示意，不能直接当作所有生产环境的默认值。",
    },
    {
      type: "heading",
      text: "流控会让 Send/Recv 产生背压",
    },
    {
      type: "paragraph",
      text: "HTTP/2 和 gRPC 会对连接与 stream 的未消费数据施加流控。当接收方处理不过来时，发送方的 Send 可能阻塞；这是一种保护机制，不是错误。应用层如果再建立一个无界 channel 或 goroutine 生产队列，就可能把网络背压变成进程内存增长。",
    },
    {
      type: "list",
      items: [
        "为批量上传设置有界并发和有界队列。",
        "让 Send 的阻塞能够被 context 取消，而不是无限等待。",
        "接收端尽快消费消息，重计算放到有界 worker 池。",
        "用消息数量、字节数、Send 等待时间和活动 stream 数量观测背压。",
      ],
    },
    {
      type: "heading",
      text: "消息大小是契约与资源边界",
    },
    {
      type: "code",
      title: "显式设置消息上限",
      language: "go",
      code: 'server := grpc.NewServer(\n  grpc.MaxRecvMsgSize(4<<20),\n  grpc.MaxSendMsgSize(4<<20),\n)\n\nbook, err := client.GetBook(\n  ctx,\n  req,\n  grpc.MaxCallRecvMsgSize(4<<20),\n  grpc.MaxCallSendMsgSize(4<<20),\n)\nif err != nil {\n  return err\n}\n_ = book',
    },
    {
      type: "paragraph",
      text: "提高上限只会提高内存和拒绝超大输入的成本，并不会让大消息自动变得适合传输。大结果优先考虑分页或服务端流，大上传考虑客户端流和逐条验证；压缩也要通过基准测试确认 CPU 与网络节省的交换是否值得。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要用无限上限解决 ResourceExhausted",
      body: "超大消息可能来自合法业务，也可能来自错误配置或恶意输入。无界接收会放大内存压力和 GC；应先定义资源上限，再用分页、流和对象存储等方式重构消息模型。",
    },
    {
      type: "quiz",
      question: "Keepalive ping 与 RPC deadline 的关键区别是什么？",
      options: [
        "Keepalive 是业务错误码，deadline 是 TLS 配置",
        "Keepalive 探测连接，deadline 限制一次调用的等待预算",
        "Keepalive 只能用于客户端流，deadline 只能用于 unary",
        "二者都保证服务端一定完成业务",
      ],
      answer: 1,
      explanation:
        "Keepalive 是连接级探测，deadline 是请求级生命周期边界。它们不能互相替代，也都不保证业务副作用已经完成。",
    },
    {
      type: "exercise",
      title: "为批量上传找出背压风险",
      description:
        "设计一个客户端流上传 1 GB 数据的方案：指出消息大小、并发、队列、deadline、取消和服务端处理速度分别如何限制，并说明应该观测哪些指标。",
      hint:
        "不要先调大 MaxRecvMsgSize。先决定消息拆分、单次窗口和接收端消费节奏。",
    },
    {
      type: "keypoints",
      items: [
        "Keepalive 探测连接，deadline 限制 RPC，健康检查判断接流量能力。",
        "HTTP/2 流控形成背压，应用层应使用可取消的有界队列。",
        "消息大小上限是内存和安全边界，不是性能开关。",
        "分页、流式、对象存储和压缩应通过工作负载与基准测试选择。",
      ],
    },
  ],
};
