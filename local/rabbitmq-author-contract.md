# RabbitMQ 课程作者共享契约（Planner 冻结）

## 课程定位
- 标题：RabbitMQ 消息队列系统学习
- 学习者：已掌握至少一门编程语言与基本后端概念（HTTP、数据库、部署）。**不教授编程语言基础**。
- 意图：系统学习 + 实战。课程主线是「订单系统」。
- 难度：intermediate。每节课应有实质内容：动机 → 机制 → 示例 → 陷阱 → 边界，而非罗列。

## 版本边界（权威事实，写作时不得违反）
- 课程以 **RabbitMQ 4.x** 为版本边界；主线 4.3（4.3.5，2026-08），LTS 4.2。
- **AMQP 0-9-1** 是主要协议；示例代码可用 Python（pika）或伪代码，标注语言。避免依赖特定客户端库未公开行为。
- 关键版本事实：
  - 4.0：移除镜像队列（classic queue mirroring）；Khepri 成为 fully supported 元数据存储。
  - 4.2：Khepri 成为默认元数据存储（Mnesia 仍可用但将移除）。
  - 4.3：默认禁止声明 transient 非排他 classic 队列（可用 durable、exclusive、或 durable+TTL 替代；配置 `deprecated_features.permit.transient_nonexcl_queues = true` 可恢复）。
  - 默认队列类型（DQT）可配置：classic / quorum / stream；vhost 级 DQT 优先于节点级。
  - 两种复制数据结构：quorum queues（Raft）与 streams。
- 不确定的行为：标注为「推断」或「需查阅官方文档」，不要编造。

## 共享场景（订单系统）
- 统一使用「电商订单系统」作为贯穿示例：
  - 生产者：订单服务（Order Service）发布订单事件。
  - 消息：订单创建、支付成功、库存扣减、发货通知等。
  - 消费者：支付服务、库存服务、通知服务、审计服务。
  - 交换机和队列命名使用 `orders.*`、`payments.*` 等清晰前缀。
- 各作者可引入局部示例，但不得与共享场景矛盾。

## 术语约定（全课程统一）
- Producer（生产者）/ Consumer（消费者）/ Broker（代理，即 RabbitMQ 服务器）
- Exchange（交换机）/ Queue（队列）/ Binding（绑定）/ Routing Key（路由键）
- vhost（虚拟主机，不译或写「虚拟主机」均可，首次出现用「虚拟主机（vhost）」）
- Publisher Confirms（发布确认）/ Consumer Acknowledgements（消费确认，简称 ack）
- Prefetch（预取）/ Dead Letter（死信）/ TTL（生存时间）/ RPC（远程过程调用）
- Classic Queue（经典队列）/ Quorum Queue（仲裁队列）/ Stream（流）
- AMQP 0-9-1 协议方法名用等宽字体，如 `basic.publish`、`basic.consume`、`basic.ack`、`basic.nack`、`basic.reject`
- 交换机类型：direct / fanout / topic / headers

## 平台写入规则（必须遵守）
- 每节课一个文件：`src/content/courses/rabbitmq/lessons/<slug>.ts`
- 文件必须导出 `lesson: Lesson`，slug 与文件名一致，courseSlug 为 "rabbitmq"。
- 内容块类型仅限 types.ts 中定义的：paragraph / heading / subheading / list / callout(tip|note|warning|example) / code / table / definition / keypoints / quiz / exercise / video / quote / divider。
- 中文写作；UI 默认简体中文。
- 代码示例要真实、完整、符合主题语义；可运行优先。
- 不要为了凑 block 类型而加内容；quiz/exercise 只在有教学价值时使用。
- 每节课篇幅参考：约 6-12 个 blocks，正文有实质深度（gorm 课程为参考标准）。
- 文件名与大纲 slug 一一对应；不要改 course.ts。

## 教学要求
- 每节课应回答「为什么存在、怎么工作、何时使用、常见陷阱」。
- 陷阱/边界用 callout(warning) 表达；重要提醒用 callout(note/tip)。
- 重要术语用 definition。
- 章节内课时要衔接：后一课可以引用前一课概念，但不要重复整段解释。

## 交付前自查
- 文件能通过 TS 类型检查（结构正确）。
- 不要运行 npm run validate / typecheck / build（由集成者统一执行）。
