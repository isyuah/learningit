/* ==================================================================
 * 课时：延迟消息：TTL、DLX 与插件（rabbitmq-delayed-messages）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2），AMQP 0-9-1。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-delayed-messages",
  courseSlug: "rabbitmq",
  title: "延迟消息：TTL、DLX 与插件",
  summary: "订单 30 分钟未支付自动取消、重试退避——用 TTL+DLX、延迟消息插件和 4.3 的 quorum 延迟重试实现。",
  minutes: 24,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "「订单创建后 30 分钟未支付就自动取消」是订单系统的经典需求。它不是一个立刻要执行的任务，而是「到点再处理」。RabbitMQ 原生没有「延时发布」这个开关，但借助上一节的 TTL 与死信机制，或者延迟消息插件，可以得到三种实现方案。这一节对比它们的延迟精度、可靠性边界与运维复杂度，并特别说明 4.x 版本下方案选择的变化。",
    },
    {
      type: "definition",
      term: "Message TTL（消息生存时间）",
      definition: "消息属性 expiration（毫秒）或队列参数 x-message-ttl 指定的存活时间。消息在队列里等待超过 TTL 后即被判定过期，配合死信配置可转投到其他队列，从而间接实现「延迟投递」。",
    },
    {
      type: "heading",
      text: "方案一：TTL + DLX（经典方案）",
    },
    {
      type: "paragraph",
      text: "思路是「绕一圈」：消息先进入一个带 TTL 的延迟队列，TTL 到期后按上一节机制死信到目标交换机，从而间接实现「延迟 N 毫秒后再投递」。拓扑上需要一条「延迟队列 → 死信交换机 → 业务队列」的链路。优点：零插件、纯原生能力，拓扑可见、可手动 purge，存储可落在 quorum/stream 等复制数据结构上。缺点：每个延迟档位要一条队列（5 分钟、30 分钟、1 小时……），档位多了拓扑爆炸；且经典队列里只有队头的消息参与 TTL 判定（head-of-line blocking），队头没过期时后面的消息即使已超时也不会被处理，消息量大时实际延迟会显著偏离设定值。",
    },
    {
      type: "code",
      title: "TTL + DLX 延迟消息（Python / pika）",
      language: "python",
      code: `# 30 分钟后自动取消未支付订单
import pika, json, time

conn = pika.BlockingConnection(pika.ConnectionParameters("localhost"))
ch = conn.channel()

# 业务交换机：订单服务真正消费的队列从这里收消息
ch.exchange_declare("orders.topic", "topic", durable=True)
ch.queue_declare("orders.timeout", durable=True)
ch.queue_bind("orders.timeout", "orders.topic", routing_key="order.timeout")

# 延迟队列：消息在这里待满 TTL，过期后死信到 orders.topic
delay_args = {
    "x-message-ttl": 30 * 60 * 1000,          # 30 分钟
    "x-dead-letter-exchange": "orders.topic", # 到期后转投这里
    "x-dead-letter-routing-key": "order.timeout",
}
ch.queue_declare("orders.delay.30m", durable=True, arguments=delay_args)

# 发布：消息进入延迟队列，30 分钟后才出现在业务队列
ch.basic_publish(
    exchange="",
    routing_key="orders.delay.30m",
    properties=pika.BasicProperties(
        delivery_mode=2,                       # 持久化
        expiration=str(30 * 60 * 1000),        # 也可逐条指定 TTL
    ),
    body=json.dumps({"order_id": 10086, "created_at": time.time()}),
)
print("已发布，30 分钟后订单超时消息将进入 orders.timeout")`,
    },
    {
      type: "callout",
      variant: "note",
      title: "4.x 下 TTL+DLX 仍是官方推荐的社区方案",
      body: "延迟消息插件仓库的 README 明确写着：TTL + 死信的组合「已被社区广泛用于基本延迟与任务重试」，并且推荐优先考虑它——因为它可见性好、可 purge、可用复制队列类型存储。quorum 队列从 3.10 起也支持消息 TTL（每条消息约增加 16 字节内存开销）。这一方案在当前课程版本边界（4.3）下是安全且推荐的默认选择。",
    },
    {
      type: "heading",
      text: "方案二：rabbitmq-delayed-message-exchange 插件",
    },
    {
      type: "code",
      title: "延迟交换机声明与发布（Java 客户端示意）",
      language: "java",
      code: `// 声明延迟交换机，x-delayed-type 指定内部实际路由行为
Map<String, Object> args = new HashMap<>();
args.put("x-delayed-type", "direct");   // 代理 direct 的路由语义
channel.exchangeDeclare("orders.delayed", "x-delayed-message", true, false, args);

// 发布：x-delay 头 = 延迟毫秒数，无 x-delay 则立即路由
byte[] body = "{\\"order_id\\": 10086}".getBytes(StandardCharsets.UTF_8);
Map<String, Object> headers = new HashMap<>();
headers.put("x-delay", 30 * 60 * 1000);       // 30 分钟后投递
AMQP.BasicProperties props =
    new AMQP.BasicProperties.Builder().headers(headers).build();
channel.basicPublish("orders.delayed", "order.timeout", props, body);`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "4.3 起该插件不再维护，选型需谨慎",
      body: "该插件有两个硬伤：一是延迟消息存在 Mnesia 表里，而 Mnesia 在 4.3.0 开发周期中已从 RabbitMQ 主线移除——官方仓库明确宣布 Team RabbitMQ 不再维护此插件，新的分布式设计（改造成自定义队列类型）只随商业版提供；二是即使能跑，它也是单节点存储（延迟消息只在本节点有一份副本），节点故障或禁用插件会丢失所有未投递的延迟消息，且 mandatory 标志不被支持、数十万级以上延迟消息量表现不佳。结论：新项目在 4.x 上不应再依赖这个插件；官方给出的方向是「外部调度器 + 数据存储」或「TTL+DLX」。",
    },
    {
      type: "heading",
      text: "方案三：4.3 quorum 队列的延迟重试（delayed retry）",
    },
    {
      type: "paragraph",
      text: "RabbitMQ 4.3 为 quorum 队列新增了延迟重试（delayed retry）：消息被消费者 reject / nack / modify 退回后，可以按线性退避在队列内「暂缓」一段时间再重新投递，避免快速重试风暴。延迟按公式 delay = min(min_delay × delivery_count, max_delay) 计算；重试类型分 disabled / all / failed / returned，可经队列参数（x-delayed-retry-type / x-delayed-retry-min / x-delayed-retry-max）或策略（delayed-retry-*）配置，管理界面还能看到延迟中的消息数。注意它只作用于「被退回的消息」，不是通用的「定时发布」能力——要延迟一笔新任务，仍需 TTL+DLX 或外部调度器。",
    },
    {
      type: "table",
      caption: "三种延迟消息方案对比（RabbitMQ 4.3 视角）",
      headers: ["维度", "TTL + DLX", "delayed-message 插件", "quorum delayed retry（4.3）"],
      rows: [
        ["延迟精度", "受队头阻塞影响，消息量大时偏差大", "按到期时间排序，精度较好", "线性退避，面向重试而非定时"],
        ["复制/可靠性", "可落在 quorum/stream 上，复制可靠", "Mnesia 单节点存储，节点丢失即丢消息", "quorum 原生复制，可靠"],
        ["运维复杂度", "低（零插件），但档位多则拓扑复杂", "高（需装插件；4.3 起不再维护）", "低（声明参数即可）"],
        ["适用场景", "定时任务、订单超时、业务延迟", "历史存量系统（不建议新用）", "消费失败退避重试"],
      ],
    },
    {
      type: "quiz",
      question: "在 RabbitMQ 4.3 上想实现「订单 30 分钟后自动超时」，最稳妥的做法是？",
      options: [
        "使用 x-delayed-message 插件，声明延迟交换机",
        "声明一条 x-message-ttl=30 分钟、x-dead-letter-exchange 指向业务交换机的队列",
        "把消息发布到临时队列，用 sleep(1800) 后再转发",
        "依赖 quorum 队列的 x-delayed-retry-type=all",
      ],
      answer: 1,
      explanation: "TTL+DLX 是官方在 4.x 推荐且零依赖的方案，延迟队列过期后把消息死信到业务交换机即可。插件 4.3 起不再维护、且单节点存储有丢消息风险；sleep 阻塞方式显然不可扩展；delayed retry 只处理被退回的消息，不提供「延迟一笔新任务」的语义。",
    },
    {
      type: "keypoints",
      items: [
        "RabbitMQ 原生没有「延时发布」，延迟消息靠 TTL+DLX 绕一圈实现，或借助插件 / 4.3 新特性。",
        "TTL+DLX：零插件、可靠可复制，但每个延迟档位一条队列，且经典队列受队头阻塞影响精度。",
        "x-delayed-message 插件：x-delay 头按消息独立延迟，但基于 Mnesia 单节点存储，4.3 主线移除 Mnesia 后官方停止维护，新项目不应采用。",
        "quorum 队列 4.3 的 delayed retry 提供线性退避重投递（min×delivery_count 封顶 max），只针对被退回的消息。",
        "长时间（天/周级）调度不属于消息队列职责，应交给外部调度器 + 数据存储。",
      ],
    },
  ],
};
