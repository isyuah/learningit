/* ==================================================================
 * 课时：优先级、单活跃消费者与更多队列参数（rabbitmq-priority-other-args）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2），AMQP 0-9-1。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-priority-other-args",
  courseSlug: "rabbitmq",
  title: "优先级、单活跃消费者与更多队列参数",
  summary: "x-max-priority、Single Active Consumer、长度上限与消费者优先级——以及 quorum 队列在 4.3 的严格优先级与超时语义。",
  minutes: 22,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "默认队列是严格 FIFO：先到先出。但真实业务经常需要「插队」：VIP 订单优先处理、赔付指令先于普通报表；或者反过来，要求「同一时刻只允许一个消费者」以保序。RabbitMQ 用一组以 x- 开头的队列参数与消费参数来满足这些需求。这一节介绍四件事：消息优先级、Single Active Consumer、长度上限与溢出策略、消费者优先级，并重点标注 4.3 中 quorum 队列的严格优先级与 consumer timeout——它们和经典队列的行为有明显差异。",
    },
    {
      type: "definition",
      term: "x-arguments（可选队列参数）",
      definition: "声明队列时随 queue.declare 传入的键值对，用于开启 TTL、长度上限、优先级、队列类型等特性。部分参数（如 x-queue-type、x-max-priority）在声明后不可变更，只能通过策略（policy）或重新声明队列来调整。",
    },
    {
      type: "heading",
      text: "消息优先级：经典队列的 x-max-priority",
    },
    {
      type: "paragraph",
      text: "经典队列默认不启用优先级。声明时设置 x-max-priority（1–255 的正整数）后，消费者按消息 priority 属性从高到低取消息；未带 priority 的消息按 0 处理，超过队列上限的按上限处理。官方强烈建议只设 2–4 个档位：每个优先级在队列里对应一条内部子队列，档位越多 CPU 和内存开销越大。优先级不能通过策略配置——因为策略是动态的，而优先级档位在声明后不可变。",
    },
    {
      type: "code",
      title: "声明优先级队列并发布不同优先级消息（Java 示意）",
      language: "java",
      code: `// 声明：最多 4 个优先级档（0-3）
Map<String, Object> args = new HashMap<>();
args.put("x-max-priority", 4);
channel.queueDeclare("orders.priority", true, false, false, args);

// 发布：VIP 订单高优先级
byte[] vipBody = "{\\"order_id\\": 1, \\"vip\\": true}".getBytes();
AMQP.BasicProperties vipProps = new AMQP.BasicProperties.Builder()
        .priority(3)          // 越大越优先
        .build();
channel.basicPublish("", "orders.priority", vipProps, vipBody);

// 普通订单默认优先级（未设置 = 0）
byte[] normalBody = "{\\"order_id\\": 2}".getBytes();
channel.basicPublish("", "orders.priority", null, normalBody);`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "优先级队列的三个常见误解",
      body: "（1）prefetch 会架空优先级：如果消费者 prefetch=10 且队列里已有 10 条低优先级消息在途，后到的高优先级消息必须等它们 ack 完才能被投递——优先级只影响「排队中」的消息。（2）经典队列的 TTL 只在队头生效：低优先级消息可能被高优先级消息挡住，即使已过期也不会被清除（quorum 队列 4.3 起改为按优先级扫描，无此问题）。（3）max-length 溢出按队头丢弃：高优先级消息可能被低优先级消息挤出队列。真正需要「低优先级流量不被饿死」时，官方建议用多条队列（priority.low / .medium / .high）而非单队列优先级。",
    },
    {
      type: "heading",
      text: "Single Active Consumer（SAC）：保序的单消费者",
    },
    {
      type: "paragraph",
      text: "x-single-active-consumer=true 让队列在任意时刻只向一个消费者投递消息，其余已注册消费者待命；活跃消费者取消或断开后自动切换到下一个，无需应用层感知故障并重新注册。这解决了「多个消费者抢消息导致顺序错乱」的问题，典型场景是按订单 ID 严格串行处理。注意：SAC 与 exclusive consumer 互斥，且不能通过策略开启（防止策略动态变化导致语义突变）；AMQP 0-9-1 在 stream 上启用 SAC 不会生效，需要原生 stream 协议客户端。经典队列的活跃消费者是随机选出的；quorum 队列上新注册的高优先级消费者会在当前活跃者 ack 完所有在途消息后接管。",
    },
    {
      type: "heading",
      text: "长度上限、溢出与消费者优先级",
    },
    {
      type: "paragraph",
      text: "x-max-length（条数）与 x-max-length-bytes（字节数）限制队列里 ready 消息的量（未 ack 的消息不计入）。达到上限后的行为由 x-overflow 决定：drop-head（默认，丢队头最旧消息）、reject-publish（拒绝新发布，开启发布确认时客户端收到 basic.nack）、reject-publish-dlx（拒绝并顺便把被拒消息死信，仅 classic 队列）。quorum 队列支持 drop-head 与 reject-publish，但不支持 reject-publish-dlx，且 reject-publish 允许队列略微超限（在途消息会带来约 1 条以上的超额）。消费者优先级（basic.consume 的 x-priority 参数）与消息优先级不同：它决定「消息优先给谁」——高优先级消费者活跃时独享投递，只有它们被 prefetch 阻塞（blocked）时低优先级消费者才轮到消息；同优先级消费者之间仍是轮询。默认 0，可正可负，在 quorum 与 classic 队列上都受支持。",
    },
    {
      type: "table",
      caption: "4.3 quorum 队列新增的三个行为（与经典队列对比）",
      headers: ["特性", "经典队列", "quorum 队列（4.3）"],
      rows: [
        ["消息优先级", "需 x-max-priority 显式开启，0–255 档", "始终开启 0–31 档，x-max-priority 被忽略；无 priority 视为 4"],
        ["返回消息的优先级", "按队列内子队列规则处理", "reject/nack/modify 返回的消息进入返回队列，按返回顺序重排（不保留原优先级）"],
        ["consumer timeout", "不评估（4.3 起）", "支持：未 ack 超过阈值则取消消费者 / 关闭 channel，消息重新入队"],
      ],
    },
    {
      type: "paragraph",
      text: "4.3 起 consumer timeout 只在 quorum 队列上评估：消费者持有未确认消息超过阈值（默认 30 分钟，可经 x-consumer-timeout 队列参数、consumer-timeout 策略或全局 consumer_timeout 配置调整，取值下限 1 分钟、建议不低于 5 分钟）时，AMQP 0-9-1 消费者被取消（支持 consumer_cancel_notify 时）或 channel 以 precondition_failed 关闭，在途消息全部重新入队。这防止了「消费者卡死却占着消息」的问题；与之配合的还有 4.0 起的 delivery-limit（默认 20）与 4.3 的 x-delivery-count / x-acquired-count 头。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "quorum 严格优先级：低优先级可能被饿死",
      body: "4.3 的 quorum 严格优先级与经典队列不同：经典队列靠轮转子队列防止低优先级饿死，而 quorum 队列是严格优先——持续涌入的高优先级消息会无限期推迟低优先级消息。另外，被 reject/nack/modify 退回的消息不保留原优先级（按返回顺序重排），依赖「重投递也要优先」的业务逻辑会失效。需要保证低优先级流量有份额时，请改用多条独立队列。",
    },
    {
      type: "keypoints",
      items: [
        "x-max-priority（仅 classic，推荐 2–4 档）开启消息优先级；prefetch、TTL 队头阻塞、max-length 丢头都会影响优先级效果。",
        "x-single-active-consumer 提供单消费者保序 + 故障自动接管，不能用策略配置；与 exclusive 互斥。",
        "x-max-length / x-max-length-bytes 配合 x-overflow：drop-head / reject-publish / reject-publish-dlx（仅 classic）。",
        "消费者优先级（x-priority）决定投递顺序，高优先级消费者 blocked 时低优先级才被投递。",
        "4.3 quorum：优先级始终开启（0–31，默认 4）、返回消息按返回顺序重排、consumer timeout 仅 quorum 评估（默认 30 分钟）。",
      ],
    },
  ],
};
