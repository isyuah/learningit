/* ==================================================================
 * 课时：可靠投递综合练习（rabbitmq-reliability-exercise）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-reliability-exercise",
  courseSlug: "rabbitmq",
  title: "可靠投递综合练习",
  summary: "把发布确认、手动 ack、prefetch 与死信串成一套订单系统动手练习，亲手踩一遍可靠性边界。",
  minutes: 20,
  kind: "exercise",
  blocks: [
    {
      type: "paragraph",
      text: "前三节讲了可靠性的三块基石：发布确认、消费确认与持久化。这一节不引入新概念，只要求你动手把它们串起来——用订单系统的真实拓扑，亲手制造故障、观察消息去向，再逐一修复。你将需要一个可运行的 RabbitMQ 4.x（Docker 即可）与一个 Python/pika 环境。每道练习先自己动手，再对照末尾的要点。",
    },
    {
      type: "heading",
      text: "练习总览",
    },
    {
      type: "list",
      items: [
        "练习 1：搭建 durable 队列，验证重启后队列与消息的存亡",
        "练习 2：给订单生产者开启发布确认，制造不可路由与 Broker 重启观察 nack/ack",
        "练习 3：库存消费者手动 ack + prefetch，制造崩溃观察 requeue 与死信",
      ],
    },
    {
      type: "exercise",
      title: "练习 1：持久化三层与重启实验",
      description: "声明交换机 orders.events 与 durable 队列 orders.queue（绑定 order.created）。向队列发布两条消息：一条 delivery_mode=2，一条 delivery_mode=1（transient），均不开启发布确认。然后停止并重启 RabbitMQ（Docker: docker restart <container>）。重启后检查队列是否还在、两条消息各自是否还在队列里。",
      hint: "queue_declare(durable=True) 保证队列定义不丢；transient 消息只存在于内存，重启即消失；persistent 消息会落盘所以存活。观察前先 docker exec 确认队列里确实有 2 条消息，避免把「本来就没发进去」误判为丢失。",
    },
    {
      type: "exercise",
      title: "练习 2：发布确认与不可路由",
      description: "给生产者开启 confirm 模式（pika 用 confirm_delivery）。(a) 把路由键写成不存在的 order.deleted，观察 basic_publish 的返回值与 mandatory=True 时的 basic.return 回调——确认不可路由的消息到底算 ack 还是 nack；(b) 发布一条 delivery_mode=2 的消息到 durable 队列，随后立即 docker restart 队列所在节点，观察确认延迟与重启期间消息是否被确认（落盘后确认才会返回）。",
      hint: "不可路由时 confirm 仍会返回成功（消息被确认丢弃），但 mandatory 会先触发 basic.return——这就是为什么生产环境必须开 mandatory；持久消息的 ack 要等 fsync 完成，恒定负载下可达数百毫秒。",
    },
    {
      type: "exercise",
      title: "练习 3：手动 ack、prefetch 与死信",
      description: "为 orders.queue 配置死信交换机 orders.dlx（x-dead-letter-exchange，绑定队列 orders.dead）。库存消费者手动确认：正常消息 basic_ack；(a) 把 prefetch_count 设为 1，开两个消费者实例，各 sleep 不同时长，观察消息是否按「处理完再接」公平分发而非均分；(b) 在处理中 os._exit(1) 模拟崩溃，观察未 ack 消息被自动 requeue 且 redelivered=True；(c) 对一条永远处理失败的消息 basic_nack(requeue=False)，观察它进入 orders.dead，并统计重投递次数验证不会死循环。",
      hint: "打印 method.redelivered 观察重投标记；死信需要先声明 orders.dlx 交换机与 orders.dead 队列，再在声明 orders.queue 时传 arguments={\"x-dead-letter-exchange\": \"orders.dlx\"}；requeue=False 的 nack 会走死信而非丢弃。",
    },
    {
      type: "subheading",
      text: "做完后对照这些要点",
    },
    {
      type: "list",
      items: [
        "队列 durable 只保定义，transient 消息重启即失，persistent 消息存活——三层缺一不可",
        "不可路由消息会被确认丢弃；mandatory=True 才能收到 basic.return 提示",
        "持久消息的确认发生在落盘后，延迟可达数百毫秒，属正常现象",
        "未 ack 消息在消费者断开时自动 requeue，redelivered=True——消费逻辑必须幂等",
        "prefetch=1 + 手动 ack 实现公平分发；慢消费者不会被消息淹没",
        "requeue=False 的负向确认把消息送进死信队列，避免重投死循环",
      ],
    },
    {
      type: "quiz",
      question: "综合三个练习，以下哪条链路能保证「订单消息至少被处理一次，且不会无限重试」？",
      options: [
        "持久队列 + 持久消息 + 发布确认 + 手动 ack + 失败时 nack(requeue=True) 不限次数",
        "持久队列 + 发布确认 + auto ack + 失败时重新发布",
        "持久队列 + 持久消息 + 发布确认 + 手动 ack + 重试计数超限后 nack(requeue=False) 转死信",
        "非持久队列 + 持久消息 + 手动 ack + 失败时丢弃",
      ],
      answer: 2,
      explanation: "第一项会无限重投形成死循环；auto ack 下处理中崩溃即丢失，谈不上至少一次；非持久队列重启即丢。只有「三层持久化 + 手动 ack + 重试阈值转死信」既保证不丢，又避免无限重试。",
    },
    {
      type: "keypoints",
      items: [
        "可靠投递 = 发布确认（进 Broker）+ 持久化（进磁盘）+ 手动 ack（处理完）三层叠加",
        "不可路由不报错但会静默丢消息，生产必须开 mandatory + confirm",
        "consumer 断开自动 requeue 造成至少一次投递，业务要幂等",
        "prefetch 控制背压与公平分发，先从 1 或 100–300 起步再按实测调整",
        "死信 + 重试计数是终止重投循环的工程化手段",
      ],
    },
  ],
};
