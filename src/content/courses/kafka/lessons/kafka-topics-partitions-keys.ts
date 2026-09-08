/* ==================================================================
 * 课时：主题、分区与键：并行与顺序的边界（kafka-topics-partitions-keys）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：Apache Kafka 4.3（主线 4.3.1，KRaft-only）。
 * Go 示例以 franz-go v1.21.x（pkg/kgo）为准。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "分区是 Kafka 并行与顺序的唯一边界：分区内有序、跨分区无全局序；key 决定消息进哪个分区，分区数决定并行度与扩容后的顺序命运。",
  blocks: [
    {
      type: "paragraph",
      text: "在 [核心心智模型](/courses/kafka/lessons/kafka-core-model) 里我们已经建立了第一张全景图：[主题](glossary:topic) 被切成若干 [分区](glossary:partition)，消息按 [偏移量](glossary:offset) 顺序躺在分区日志里。从这一课开始，我们要补上真正的工程决策——它是后面一切可靠性讨论的地基：一个主题到底建多少个分区？一条消息凭什么进这个分区而不是那个？这两个问题看着独立，实际上被同一个机制绑在一起，选错的代价要到扩容那天才爆发。书舟书店正好要为平台定这套方案，我们跟着推导一遍。",
    },
    {
      type: "heading",
      text: "分区：并行与顺序的唯一边界",
    },
    {
      type: "paragraph",
      text: "先精化一个容易被低估的事实：**Kafka 的顺序保证是「分区内」的，不是「主题内」的**。同一分区里的消息按追加顺序获得递增的 offset，消费者按 offset 顺序读到它们；不同分区之间没有全局顺序——两条消息谁先被生产者发出、甚至谁先落盘，都不构成跨分区的先后关系。换句话说，分区同时是 Kafka 的两个单位：**并行单位**（读写都以分区为粒度摊到多台机器、多个消费者上）和**顺序单位**（顺序只在一个分区内部有意义）。想要并行度，就要多分区；想要顺序，就要把相关消息塞进同一分区。二者只能通过分区键调和，没有第三个旋钮。",
    },
    {
      type: "code",
      title: "订单事件流：跨分区没有全局序（示意）",
      language: "text",
      code: "主题 orders.events（示意 3 个分区；分区数只是教学假设）某一瞬间的写入视角：\n\n分区 0                          分区 1                          分区 2\n20260908-000101 created        20260908-000099 created      20260908-000100 created\n20260908-000101 paid           20260908-000099 paid         20260908-000102 paid\n20260908-000103 created        20260908-000100 cancelled\n\n只看单个分区：每个 key 只出现在一个分区里（000101 在分区 0、\n000099 在分区 1、000100 在分区 2），分区内记录有确定的前后顺序。\n把多个分区拼起来看：不存在「全局第几条」——分区 0 里的 created\n与分区 1 里的 created 谁先谁后，Kafka 不回答也不保证。",
    },
    {
      type: "paragraph",
      text: "对书舟的 `orders.events` 来说，一个订单会先后产生 order.created、order.paid、order.cancelled 等事件。订单状态机对顺序极其敏感：支付事件先于创建事件到达，下游轻则告警，重则把状态机推进到非法状态。所以「同一订单的全部事件必须落在同一分区」不是洁癖，是业务正确性要求。**而 Kafka 只承诺「同 key 的消息进同一分区」**——这正是 key 存在的意义：key 不是消息内容，而是路由的输入。",
    },
    {
      type: "definition",
      term: "分区键（partition key）",
      definition: "生产者写消息时附带的字节串，分区器把它映射到某个分区，从而把「逻辑上相关的一串消息」钉进同一个分区以获得分区内顺序。书舟的约定：`orders.events` 用 `order_id`（如 `20260908-000123`），`user.behavior` 用 `user_id`（如 `u_10086`）。注意：key 只是路由依据，消费端不要依赖它的存储与内容。",
    },
    {
      type: "heading",
      text: "key 如何决定分区：默认分区器的语义",
    },
    {
      type: "paragraph",
      text: "决定「key → 分区」映射的组件叫分区器（partitioner），运行在**生产者进程里**——broker 不参与选分区。franz-go v1.21 的默认分区器（不传任何选项时）等价于 `UniformBytesPartitioner(64KiB, adaptive=true, keys=true, murmur2)`：这套语义照搬 KIP-794（Java 客户端自 3.3 起）的 uniform sticky 分区器，所以**只要分区数相同，任何语言、任何客户端对同一个 key 都会算出同一个分区**。它包含两条规则：",
    },
    {
      type: "list",
      items: [
        "有 key（`Record.Key` 非空）：对 key 做 murmur2 哈希，转成正整数后对分区数取模，结果稳定——分区数不变的前提下，**同一个 key 永远映射到同一个分区**。Kafka 刻意把 murmur2 定为跨客户端统一的哈希，而不是各语言自带哈希，就是为了让不同语言的客户端路由结果一致。",
        "无 key：走 sticky 策略——先粘住一个分区持续攒批，攒到约 64 KiB（或批次滚动）才换一个分区，换时倾向选择当前积压最少的分区（adaptive）。粘批让批次更大，broker 收到的请求数大幅减少；长期看各分区收到的消息量近似均匀。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "「同 key 同分区」是路由结果，不是 Kafka 层面的承诺",
      body: "官方设计文档的原话是：客户端提供 key，系统「用哈希把它映射到分区」。也就是说「同 key 同分区」是默认分区器实现的产物——仅在分区数不变、且没人换用别的分区器时成立。后面马上会看到：一旦分区数变化，这个映射全体失效。另外，消息进入分区后能否按发送顺序落盘还受生产者重试影响，那是第 3 章 [可靠发布](/courses/kafka/lessons/kafka-producer-reliability-acks) 的内容。",
    },
    {
      type: "code",
      title: "Go：带 key 的生产（节选，真实 API）",
      language: "go",
      code: `// 同一订单的全部生命周期事件都带上 order_id 作为 key
rec := &kgo.Record{
    Topic: "orders.events",
    Key:   []byte(orderID), // 默认分区器：murmur2(orderID) % 分区数
    Value: payload,         // JSON 序列化由业务代码负责（第 3 章展开）
}
cl.Produce(ctx, rec, func(r *kgo.Record, err error) {
    if err != nil {
        log.Printf("produce failed: %v", err)
        return
    }
    // 成功后回调里已填好落点，可据此观测 key 分布
    log.Printf("order %s -> partition %d, offset %d", orderID, r.Partition, r.Offset)
})`,
    },
    {
      type: "paragraph",
      text: "franz-go 通过 `kgo.RecordPartitioner(...)` 选项更换分区器，常用选择如下（API 与语义以 [pkg.go.dev 文档](https://pkg.go.dev/github.com/twmb/franz-go/pkg/kgo)为准）：",
    },
    {
      type: "table",
      caption: "franz-go 分区器选项速览",
      headers: ["写法", "行为", "什么时候用"],
      rows: [
        ["默认（不传选项）", "UniformBytesPartitioner(64KiB, adaptive, keys)：有 key 按 murmur2 哈希，无 key 粘批到约 64 KiB 后轮换（倾向积压最少者），长期近似均匀", "绝大多数场景；与 Java 客户端默认行为一致"],
        ["kgo.RoundRobinPartitioner()", "逐条轮询所有可用分区，分布最均匀，但批次小、请求多、broker CPU 开销高", "消息极小且强求瞬时均匀时"],
        ["kgo.StickyKeyPartitioner(nil)", "镜像 Java 客户端 2.4–3.3 的旧默认（KIP-480）：有 key 按 murmur2 哈希，无 key 随机起步粘批", "需要与旧版 Java 客户端路由一致"],
        ["kgo.ManualPartitioner()", "忽略 key，直接使用代码设置的 Record.Partition 字段", "手工指定分区、特殊路由"],
        ["kgo.BasicConsistentPartitioner(fn)", "用自定义函数实现任意路由策略", "定制哈希或按请求维度路由"],
      ],
    },
    {
      type: "paragraph",
      text: "手动分区是少数派用法，但下面两节的内容——分区数决策与扩容陷阱——本质上都是围着「key 哈希后取模」这个公式转的。先把公式记住：`partition = positive(murmur2(key)) % numPartitions`。",
    },
    {
      type: "heading",
      text: "分区数：吞吐、并行度与增长的三重约束",
    },
    {
      type: "paragraph",
      text: "主题的分区数在**创建时就要定好**。虽然 broker 允许主题在首次写入时被自动创建（`auto.create.topics.enable` 默认开启），自动创建的主题只会用 broker 默认值 `num.partitions = 1`——单分区意味着整个主题串行，等于主动放弃并行。生产主题一律用 `kafka-topics.sh --create` 显式指定分区数与副本数。定分区数要同时满足三个约束，缺哪个补哪个：",
    },
    {
      type: "list",
      items: [
        "**吞吐**：单个分区是一条物理上的串行追加流，可持续吞吐受单台 broker 的磁盘顺序写能力、网卡与请求处理限制（每条消息都要经 leader 所在机器的网卡）。全主题峰值吞吐 ÷ 单分区可持续吞吐，是分区数的下限。",
        "**消费并行度**：一个 [消费组](glossary:consumer-group) 内，同一时刻一个分区只归属一个消费者（第 4 章展开），所以组的最大并行度 = 订阅主题的分区数。想让分析服务 8 个实例同时干活，分区数就得 ≥ 8。",
        "**增长**：分区数只能增不能减（下一节），且扩容有真实的顺序代价——要用未来 2 年的峰值来算，而不是今天的均值。",
      ],
    },
    {
      type: "code",
      title: "书舟推导：orders.events 与 user.behavior（示意数字，务必压测校准）",
      language: "text",
      code: "orders.events：下单峰值 5000 单/秒，每单生命周期约 3~5 个事件\n  → 事件峰值 ≈ 1.5 万 ~ 2.5 万条/秒，单条消息约 0.5~2 KB\n\n  约束①吞吐：经验上，KB 级小消息的单分区可持续承担每秒数千到数万条\n             （真实上限依磁盘/网卡/批量设置与消息大小浮动，必须压测）\n  → 保守按单分区 5000~10000 条/秒算，需要 2~4 个分区覆盖峰值\n  约束②并行度：订单服务消费者计划 4 实例 → 分区数需 ≥ 4\n  约束③增长：留 2~3 倍余量\n  → 取 12 分区：峰值每分区约 2000 条/秒，余量充足，副本分布均衡\n\nuser.behavior：点击/浏览流峰值 10 万条/秒，单条 < 1 KB\n  → 保守按单分区 5000~10000 条/秒算，需要 10~20 个分区\n  → 取 24 分区：峰值每分区约 4000+ 条/秒\n\n交叉检查：3 台 broker、RF=3 时，12 分区 = 36 个副本，可均匀铺在\n3 台机器上（每台 12 个）；某分区日后成热点时仍有扩容的物理余量。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要照抄任何「单分区 X MB/s」的数值",
      body: "单分区吞吐不是常数：它取决于消息大小、批量与压缩设置、磁盘类型、网卡、副本数、acks 级别与是否幂等。上面的推导故意只给量级区间并注明依硬件而异——上线前必须用目标消息大小和峰值速率压测（第 9 章 [容量规划](/courses/kafka/lessons/kafka-capacity-tuning) 给方法）。但「全主题吞吐 ÷ 单分区吞吐」这个推导结构是通用的。",
    },
    {
      type: "heading",
      text: "扩容：只增不减，而且改变每个 key 的命运",
    },
    {
      type: "paragraph",
      text: "先接受一个硬约束：**Kafka 官方不支持减少主题的分区数**。减少分区意味着要把多个独立有序的日志按 offset 重新拼接或截断，这与「每个分区是一条独立提交日志」的模型根本冲突——官方运维文档原话是 `Kafka does not currently support reducing the number of partitions for a topic`。所以扩分区是单行道：改配置容易，反悔没有。增加分区本身只是命令行一条：",
    },
    {
      type: "code",
      title: "把 orders.events 从 12 分区扩到 24（4.3 CLI）",
      language: "bash",
      code: "kcli kafka-topics.sh --bootstrap-server localhost:9092 \\\n  --alter --topic orders.events --partitions 24",
    },
    {
      type: "paragraph",
      text: "命令背后发生的事才是重点。回想路由公式 `partition = hash(key) % numPartitions`：**分区数从 12 变 24，取模的底数变了，相当一部分 key 的映射都会变**（12→24 时约有一半 key 会换到新分区号，因为 hash % 24 ≥ 12 的 key 都落进新分区）——同一个 `order_id` 扩容前一直落在分区 3，扩容后的新事件却可能落进另一个分区。而 Kafka 不会搬动任何已有数据（官方文档：`Kafka will not attempt to automatically redistribute existing data`）。于是出现最尴尬的局面：",
    },
    {
      type: "code",
      title: "同一订单的事件在扩容前后被拆到两个分区（示意哈希值）",
      language: "text",
      code: "设 hash(\"20260908-000123\") = 1234567、hash(\"20260908-000456\") = 999999（示意）\n\n扩容前（12 分区）：1234567 % 12 = 7  → 000123 全部历史事件在分区 7\n                   999999 % 12 = 3  → 000456 全部历史事件在分区 3\n\n扩容后（24 分区）：1234567 % 24 = 7  → 000123 映射没变（示意：一半可能）\n                   999999 % 24 = 15 → 000456 迁到分区 15（示意：另一半可能）\n\n对 000456：order.created 永远留在分区 3，扩容后的 order.paid 落在分区 15。\n分区 3 内顺序依旧成立，但分区 3 与分区 15 之间没有任何先后保证——\n消费者并行读这两个分区时，完全可能先看到 paid、再看到 created。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "扩容的顺序代价：不是「暂时乱」，是「结构上可能永远乱」",
      body: "官方文档把「key 分布变化」列为动态增加分区数的头号副作用：默认分区器按 hash(key) % 分区数路由，分区数一变，同 key 消息可能被路由到不同分区，影响既有 key 的顺序保证；旧数据不迁移，新消息按新映射走。对生命周期恰好横跨扩容窗口的订单（比如大促期间），它的历史与未来事件可能就此分居两个分区，跨分区乱序不是临时抖动，而是持续存在的结构事实。缓解手段只有几种：让下游按事件时间而非到达顺序处理该 key 的事件；把扩容窗口选在低峰并把该窗口的消费做成幂等；或者接受并重建有状态 key 的会话。这也是为什么分区数要按 2 年峰值来定——**能一次定对，就别靠扩容补救**。",
    },
    {
      type: "quiz",
      question: "书舟把 orders.events 从 12 分区扩到 24 分区（沿用本课推导的 12 分区设计值）。订单 20260908-000456 的 order.created 在扩容前经 hash(key) % 12 写入分区 3；扩容后该订单新的 order.paid 经 hash(key) % 24 落进分区 15。以下哪项描述正确？",
      options: [
        "扩容后该订单的新事件仍会按序追加在分区 3，因为 Kafka 会为每个 key 维护固定分区",
        "该订单扩容后的新事件进入分区 15，与分区 3 里的历史事件之间不再有跨分区顺序保证，消费端可能先看到 paid 再看到 created",
        "扩容时 Kafka 会把该订单在分区 3 的历史数据自动迁移到分区 15，保证同一 key 的数据连续",
        "只要生产端保持 acks=all，扩容后同一 key 消息的顺序仍然受保证",
      ],
      answer: 1,
      explanation: "扩分区只新增分区、不搬动已有数据；key 的哈希映射从 %12 变为 %24，约一半 key 会换到新分区号（hash % 24 ≥ 12 的那些）。顺序保证只存在于分区内部，跨分区的两段事件没有先后关系——这与 acks 无关（acks 只管持久化确认，不管路由）。这正是「分区数只增不减、扩容有顺序代价」的原因。",
    },
    {
      type: "heading",
      text: "热点 key：分区倾斜的种子（预告）",
    },
    {
      type: "paragraph",
      text: "分区并行模型还有一个数学盲区：**哈希只能分散 key，不能均分流量**。书舟的爆款秒杀把大比例订单流量压在一个 sku 上、某个网红用户一天产生全站百分之几的点击——这些事件带着同一个 key，必然全部落进同一个分区。结果是一个分区吃满、其余空闲，加消费者实例也救不了：并行度上限等于分区数，而热点分区同一时刻只有一个消费者在处理。症状是热点分区 lag 持续增长、broker 之间负载悬殊。缓解方向几句话能说完：热点 key 拆成多个子 key 轮换（牺牲该 key 的顺序换并行）、对只读型热点用无 key 均匀打散、或改设计让热点维度不进 key（例如库存扣减按「单」而非按「sku」建模）。怎么从指标里认出倾斜、分几路缓解，细节留给第 9 章 [排障手册](/courses/kafka/lessons/kafka-troubleshooting)，这里先建立「key 选择是分区健康的前提」的直觉。",
    },
    {
      type: "keypoints",
      items: [
        "分区 = 并行单位 + 顺序单位：分区内有序、跨分区无全局序；业务顺序靠「相关消息同 key 同分区」获得",
        "key 是路由输入：默认分区器对非空 key 做 murmur2 哈希取模（跨客户端一致），无 key 时 sticky 粘批到约 64 KiB，长期近似均匀",
        "分区数下限 = max(峰值吞吐 ÷ 单分区吞吐, 消费组并行度需求)，再按 2 年增长留余量；单分区吞吐必须压测，不写死数值",
        "分区数只增不减；扩容改变 hash(key) % N，同 key 新旧消息可能分居两区，跨分区顺序断裂，且 Kafka 不迁移旧数据",
        "热点 key 使单分区过载（分区倾斜），加实例无效；缓解方向是拆 key、加盐或改设计，实操细节在第 9 章",
      ],
    },
  ],
};
