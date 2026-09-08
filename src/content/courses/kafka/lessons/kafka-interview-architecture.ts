/* ==================================================================
 * 课时：面试速查：集群、运维与系统设计题（kafka-interview-architecture）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 第 11 章第三课：KRaft 集群、升级、监控、再平衡风暴、安全、流处理
 * 选型与「设计订单事件系统」的口述框架。原理来自第 4、8、9、10 章。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "集群运维与系统设计类面试题的回答框架：KRaft 架构与去 ZK、部署拓扑与滚动升级、监控指标与告警分层、再平衡风暴、安全分层、Go 团队流处理选型，以及「设计订单事件系统」的完整走查。",
  blocks: [
    {
      type: "heading",
      text: "这一课怎么用",
    },
    {
      type: "paragraph",
      text: "本课覆盖第 11 章的第三类题：**集群、运维与系统设计**。前两类题（[核心机制](/courses/kafka/lessons/kafka-interview-core)、[可靠性语义](/courses/kafka/lessons/kafka-interview-reliability)）考「机制是否讲得准」，这类题考「从机制到生产现场的判断力」——升级怎么做、指标看什么、要不要上某套技术、一个系统怎么从零设计。所以本课框架大量是**决策顺序与检查清单**，口述时按顺序讲比堆知识点更像干过活的人。老规矩：先自答再对照，答不严的链接回对应课时；本课末尾的系统设计题与[第 10 章项目复盘](/courses/kafka/lessons/kafka-capstone-review)互相呼应，建议一起复习。",
    },
    {
      type: "heading",
      text: "Q1. 讲一下 KRaft：集群架构、process.roles、为什么去掉了 ZooKeeper",
    },
    {
      type: "paragraph",
      text: "架构题。标准答法：先说角色分工与控制面/数据面的分离，再说 quorum 的工作方式，最后给「为什么去 ZK」的动机——三条都不难，关键是别把 controller 和 broker 混成一个概念。",
    },
    {
      type: "list",
      items: [
        "**两个平面**：Kafka 集群分**数据平面**与**控制面**。brokers 属于数据平面——存业务数据、服务生产/消费 IO；[控制器（controller）](glossary:controller)与 quorum 属于控制面——管集群元数据（主题建删、分区分配、副本与 leader 状态、成员变更）。一句话记法：**brokers 存业务数据，controller quorum 管元数据**。",
        "**KRaft 的实现**：元数据本身是一条**内部元数据日志（metadata log）**，由一组投票节点（quorum，通常是奇数台 controller）复制并达成共识；quorum 从自己当中选出一个活跃控制器来执行元数据变更，其余 controller 是备用。每个节点的角色由 `process.roles` 声明：`broker`、`controller`、或 `broker,controller`（combined，仅开发/单机用）。",
        "**为什么去 ZooKeeper（一句话历史 + 动机）**：ZK 时代 Kafka 把元数据与选举外包给 ZooKeeper 集群——一个需要单独运维、还要小心协调的外部系统。KRaft 自 3.x 引入、**4.0 起成为唯一模式（ZK 被彻底移除）**。动机概括四条：少运维一个外部系统（部署与故障域简化）；元数据的存储与变更由 Kafka 自己的日志与 quorum 承载，可扩展性不再受 ZK 限制；控制器选举与故障切换内建且更快；社区迭代不再被外部系统绑住（后续新特性都基于 KRaft 演进）。",
        "**一致性心智**：controller quorum 与消费组协调、副本协议是同一族「日志 + 多数派」思想——元数据变更写日志、多数派确认后才生效；quorum 失去多数（如 3 台中 2 台故障）时元数据面停止工作，broker 上已有分区数据仍可继续服务读写。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 说「KRaft 是 ZooKeeper 的替代品」就完了——要讲清楚替代的是「外部协调系统」这一整层，且 4.0 起没有 ZK 模式可回退，老教程里的 ZK 部署步骤在 4.x 已不存在。② 把「controller」说成「管消费组协调的角色」——消费组归组协调器（broker 上的组件），controller 管的是集群元数据，两个角色别混（面试第 1–2 轮高频混淆点）。③ 说「controller quorum 需要偶数台」——多数派选举要容忍故障，生产用奇数（3 台容 1 台、5 台容 2 台）。④ 忘记 process.roles 这个名字或把它说成「mode」——配置项名也要准。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[KRaft 集群：架构、部署与升级](/courses/kafka/lessons/kafka-kraft-cluster-deploy)（部署细节与命令）、[核心心智模型](/courses/kafka/lessons/kafka-core-model)（控制面与数据平面）。",
    },
    {
      type: "heading",
      text: "Q2. 生产集群怎么部署？启动之前那一步「格式化」是怎么回事",
    },
    {
      type: "paragraph",
      text: "部署题通常追问「格式化和启动顺序」。答题结构：拓扑 → 每节点要配什么 → format 是什么、为什么只做一次 → 启动与验证。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**拓扑**：生产推荐**角色分离**——3 台（或 5 台）专用 controller 组成 quorum + N 台 broker；controller 只跑控制面、broker 只跑数据面，互不挤占资源、故障域独立。**combined（`process.roles=broker,controller`）只用于开发与单机学习**（第 1 章 quickstart 就是它），别带进生产。",
        "**每台节点要配的核心项**：`node.id`（集群内唯一）、`process.roles`（本机角色）、`controller.quorum.voters`（quorum 全名单：`id@host:port` 列表，controller 用它与同伴组 quorum）、listener 相关配置（客户端 listener 与 controller 内部 listener 分开）、`log.dirs`（数据目录，broker 建议独立磁盘）。具体配置项与默认值以官方文档和部署课为准。",
        "**格式化（format）是集群生命周期的关键一步**：先用工具生成一个集群 UUID（`kafka-storage.sh random-uuid`），再对每个节点的数据目录执行 format，把目录初始化为「属于这个集群的存储」——UUID 与节点身份会写进目录里的 `meta.properties`。要点：**同一个集群的所有节点用同一个 UUID**；format **只在初始化时做一次**；已经 format 过的目录不会重复覆盖，节点带着不匹配的元数据起不来（这是「broker 起不来」的常见原因之一，见排障课）。",
        "**启动顺序与验证**：先启动 controller quorum（多数在线后选出活跃控制器），再启动 brokers——它们启动时向 quorum 注册并拉取元数据。验证用官方工具确认 quorum 健康、主题能建、分区 leader 正常（确切命令以部署课与官方文档为准）。",
        "**故障域一句话**：分区副本不要落在同一台机器/同一机架/同一机房——副本的意义就是故障隔离；单点 broker 挂掉只是副本切换，机房级故障要靠跨机房副本布局预案。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 把 format 理解成「每次启动前都要做」——只做一次；启动失败常见原因就是没 format（目录未初始化）或 format 的 UUID 与集群不一致。② 生产用 combined 模式「省机器」——controller 与 broker 资源争抢、故障域耦合，生产规范是分离；combined 是开发便利不是省钱方案。③ 3 台机器装 3 个 broker 却忘了 quorum 需要的是 controller 节点——拓扑设计先分清「谁是 controller、谁是 broker」，再谈数量。④ 报错场景说不清：节点启动时元数据与集群不一致的典型报错与处置在排障课，部署题被追问时点出「先查 meta.properties 与 quorum 连通性」即可。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[KRaft 集群：架构、部署与升级](/courses/kafka/lessons/kafka-kraft-cluster-deploy)、[本地运行 Kafka 4.3（KRaft）与 CLI 初体验](/courses/kafka/lessons/kafka-kraft-quickstart)（单节点 format 全流程）、[排障手册](/courses/kafka/lessons/kafka-troubleshooting)（broker 起不来的原因树）。",
    },
    {
      type: "heading",
      text: "Q3. 集群滚动升级（4.x）的原则是什么",
    },
    {
      type: "paragraph",
      text: "面试考「升级」多半是考你有没有**过程纪律**的意识，而不是背某条命令。讲原则 + 明确「细节以官方 upgrade 文档为准」，比假装记得每一步更可信。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**原则零 · 先读文档再动手**：任何跨版本升级前，读官方 upgrade 文档与目标版本 release notes——官方对每个版本区间给出兼容性与步骤说明；4.x 的 KRaft 内部升级走 KIP-778 确立的滚动能力（利用元数据版本/特性版本机制，broker 与 controller 可以边升级边共存），但**确切步骤、顺序与检查点必须按官方文档执行**，不要照搬博客。",
        "**原则一 · 逐节点滚动，一次一台**：升级过程没有全局停机——逐台优雅停机（让出 leader、离开 quorum）、替换二进制、重启、**确认这一台健康后再动下一台**。任何一步的确认项不过（节点重新加入、分区 leader 恢复、ISR 追平），就停下来排查而不是继续滚。",
        "**原则二 · controller quorum 优先且谨慎**：先升级 controller 节点（一次一台，保证多数在线、选举稳定），确认 quorum 健康后再逐台升级 broker——因为 brokers 依赖控制面，先稳住元数据面再动数据面风险最小（确切顺序以官方文档为准）。绝不一次停超过多数 quorum 节点。",
        "**原则三 · 低峰执行 + 回滚预案**：升级窗口选在低峰；执行前备份配置与数据目录、记录当前版本与特性版本；官方在限制内支持降级，窗口期内保留回滚能力；每台升级后观察监控（分区离线、URP、异常日志）再继续。",
        "**收口句**：升级与部署一样，价值在「检查点纪律」——每一台都验证通过才动下一台，而不是「一把梭」。具体命令与版本对照表，以官方 upgrade 文档为准。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 把升级讲成「把二进制换了重启就行」——漏掉检查点与回滚预案，等于没做过生产升级。② 说 4.x 升级要迁移 ZooKeeper——4.0 起 ZK 已移除，只有从 3.x（ZK 模式）迁 KRaft 才涉及迁移，那是另一个话题（官方有专门迁移路径）。③ 报「先升 broker 再升 controller」这种细节前想清楚：你并没有查过当前版本官方文档，被追问「为什么这个顺序」就露馅——不如诚实说「顺序与检查点以官方 upgrade 文档为准，我这里讲原则」。④ 忽略客户端兼容性：升级 broker 前确认线上客户端版本在官方支持的范围内。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[KRaft 集群：架构、部署与升级](/courses/kafka/lessons/kafka-kraft-cluster-deploy)（升级小节按官方文档核对后的概述）。",
    },
    {
      type: "heading",
      text: "Q4. 监控一个 Kafka 集群，必看的指标有哪些、为什么",
    },
    {
      type: "paragraph",
      text: "监控题标准答法：按**三层**组织指标（可用性层 → 数据层 → 业务/延迟层），每层给出指标名 + 「它回答什么问题」+ 为什么重要。切忌背一串名字不知道含义。",
    },
    {
      type: "list",
      items: [
        "**可用性层 · 集群还活着吗**：broker 进程/磁盘/网络（基础设施层）；`OfflinePartitions`（有分区没有可用 leader，直接不可读写——最高优先级，理论上应为 0，出现即告警）；controller quorum 相关指标（活跃控制器是否稳定、选举是否抖动——KRaft 下控制面健康是元数据变更的前提，具体指标名以官方文档与观测课为准）。",
        "**数据层 · 副本还跟得上吗**：`UnderReplicatedPartitions`（Isr < Replicas：有副本落后，数据冗余度下降——不是立刻丢，但容错能力在缩水）；`IsrShrinksPerSec` / `IsrExpandsPerSec`（ISR 收缩/恢复速率——高频抖动说明网络或磁盘在波动，比一次性收缩更值得查）；对应地，主题 describe 里某分区 `Isr` 比 `Replicas` 少就是它。",
        "**容量/性能层 · 资源到顶了吗**：`RequestHandlerAvgIdlePercent` 与 `NetworkProcessorAvgIdlePercent`（请求线程/网络线程的空闲率——长期低位说明 broker 处理能力饱和，是「加机器/调线程数」的信号）；`BytesInPerSec` / `BytesOutPerSec`（吞吐水位——容量规划与峰值判断的基准，跨机房复制场景还要盯跨机房流量）；磁盘使用率与延迟（数据层的地基）。",
        "**业务层 · 数据流动顺畅吗**：每个[消费组](glossary:consumer-group)的[消费滞后（lag）](glossary:lag)——分区最新 offset 与已提交 offset 之差，按组×主题×分区维度看。它是业务视角的「健康计」：生产正常而 lag 持续增长 = 消费端有问题。",
        "**告警分层思路**：可用性层（分区离线、controller 选举异常、磁盘满）→ 立即告警且要求立刻响应；数据层（URP、ISR 收缩、写入被拒错误率）→ 告警并限期处理；业务层（lag、DLQ 增长）→ 按组分级告警。**阈值不给拍脑袋绝对数**：先跑基线，再按「正常波动上限 × 余量」定，并让 lag 告警阈值远小于数据保留期（保证积压还追得回来）。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 只知道 broker 指标不知道 lag——业务不感知 broker CPU 多高，它感知的是「事件多久到我这」；lag 是消费侧最重要的单一指标。② 把 `UnderReplicatedPartitions` 当「丢数据」告警——它是冗余度下降的预警，不是数据已丢；丢了会表现为 unclean 选举/副本永久缺失。③ 指标名说错方向：URP 高 ≠ ISR 扩张，先分清「副本落后」与「ISR 恢复」。④ 告警只有「broker 挂了」一级——没有分层等于磁盘慢这种渐进问题永远不报警。⑤ 忘了把第 5 章埋的失败计数（重试/死信）与 lag 合成一张看板——「lag 涨 + 死信涨」「lag 涨 + 重试涨」「lag 涨 + 无错误」三种组合指向三种完全不同的根因（见可靠性课 Q6）。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[观测：指标、日志与消费滞后](/courses/kafka/lessons/kafka-monitoring-lag)（指标清单、lag 计算与告警分层全文）、[排障手册](/courses/kafka/lessons/kafka-troubleshooting)。",
    },
    {
      type: "heading",
      text: "Q5. 什么是「再平衡风暴」？怎么识别、怎么缓解、协议往哪演进",
    },
    {
      type: "paragraph",
      text: "这道题把消费组协议（第 4 章）与运维（第 9 章）串起来，答得好说明你真在大组上踩过坑。结构：症状 → 根因 → 缓解手段 → 协议演进方向。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**症状与识别**：大消费组在滚动发布/弹性扩缩期间，消费出现周期性停顿、lag 锯齿状跳动；日志里大量 JoinGroup/再平衡记录；describe 组时成员与分区归属频繁整体变化。本质是经典协议把再平衡设计成**全组同步屏障**——任何成员加入、离开、失联，全员经历「revoke → 重新 Join → 重新分配」，期间消费停顿；成员越多、变化越频繁，风暴越烈（一次滚动发布几十个实例 = 一连串全员再平衡，即 thundering herd）。",
        "**根因清单**：成员频繁进出是燃料（发布重启、实例崩溃、心跳超时被踢）；会话超时太短/心跳不稳让健康成员被误判死亡；revoke 回调慢拖长每轮再平衡；没有用静态成员时「重启」也算成员变化。",
        "**缓解手段（由近及远）**：① 给重启频繁的服务用**静态成员**（KIP-345，`group.instance.id` 固定实例身份）——重启不触发再平衡，但要接受真死时协调器要等会话超时才让位；② 分配策略用 **cooperative-sticky**（KIP-429）——增量让出，只动受波及分区，把 stop-the-world 变局部迁移（注意组内成员策略混用会把 cooperative 组降级回 eager）；③ 调大再平衡超时/检查心跳与 poll 节奏，避免成员被误踢；④ 发布错峰、实例扩缩限速；⑤ 组大到风暴成为真实瓶颈时，评估**新协议（KIP-848）**。",
        "**协议演进方向**：经典协议的两代补丁（KIP-345 静态成员、KIP-429 cooperative）没动骨架；KIP-848 把 assignment 计算从成员 leader **搬上 broker 协调器**，用 member epoch 做增量协调，去掉全局同步屏障——成员变化只影响相关成员。4.x 服务端默认同时支持两种协议，弃用路线已公布（broker 配置 `group.coordinator.rebalance.protocols` 4.3 弃用、Java 客户端 5.0 默认切新协议）；Go 侧 franz-go v1.21.x 默认仍是 classic（新协议实现存在但默认隐藏、beta 期 opt-in），**现阶段通常不需要动，等风暴成为实测瓶颈再评估正式开关**。",
        "**收口句（不变的底线）**：无论协议怎么演进，「已处理未提交的位移在交接时会重读」这条定律不变——它由提交时机决定，与协议无关；幂等兜底与 revoke 补提交在任何协议下都是标准姿势。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 把「再平衡风暴」等同于「再平衡本身」——再平衡是正常机制，风暴是「全员频繁停顿」的病理形态，别把正常扩容的偶发再平衡说成事故。② 说「加消费者实例就能缓解 lag」而没先判断是不是风暴——风暴期加实例反而加剧全员再平衡。③ 提到新协议时把 KIP-848 说成「Share 组」——Share 组（KIP-932）是队列式工作分发，与消费组再平衡协议是两条独立的线（见协议课）。④ 建议 Go 项目立刻切新协议——现实是 franz-go 默认 classic、新协议隐藏 opt-in，抢跑无收益；先量化风暴是否真实瓶颈。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[消费组与经典再平衡协议](/courses/kafka/lessons/kafka-consumer-groups-classic)（生命周期/静态成员/cooperative）、[KIP-848 新组协议与 4.x 演进方向](/courses/kafka/lessons/kafka-consumer-group-protocol-848)（设计、弃用时间线与 franz-go 现状）。",
    },
    {
      type: "heading",
      text: "Q6. Kafka 安全：从哪几层入手（认证 / 授权 / 加密）",
    },
    {
      type: "paragraph",
      text: "安全简答题不需要你背证书命令，考的是**分层模型**与「每层回答什么问题」。按攻击面从外到内讲，最后一句带 Go 客户端视角。",
    },
    {
      type: "list",
      items: [
        "**分层模型（从外到内）**：① **网络隔离与 listener 分离**——内网数据 listener、controller 内部 listener、对外接入 listener 分开暴露，别把管理端口裸露公网；② **传输加密 TLS**——防窃听/中间人，生产一般双向（服务端证书 + 客户端证书）；证书要轮换，轮换是日常运维动作不是一次性上线；③ **认证 SASL**——确认「你是谁」：SCRAM-SHA-256/512（凭证由 broker 端管理，推荐）、PLAIN（明文传密码，只能配合 TLS 使用）、OAuth（4.x 支持 jwt-bearer 形态，一句话带过）；④ **授权 ACL**——确认「你能干什么」：模型是 `principal × resource（主题/消费组等）× operation × host`，用 `kafka-acls` 系列命令管理，`super.users` 是特权旁路；⑤ **配额**——按客户端限生产/消费字节率，防止单方打爆集群。",
        "**每个环节的一句话理由**：listener 分离缩小攻击面；TLS 管「路上安全」；SASL 管「身份可信」；ACL 管「权限最小化」；配额管「公平与稳定」——四层各管一件事，少一层就有一个洞。",
        "**运维要点**：ACL 变更与证书轮换要有变更流程与灰度；权限最小化（应用只授它消费/生产的主题）；审计日志留存。",
        "**Go 客户端视角**（一句话即可）：franz-go 支持 TLS dialer 与 SASL（SCRAM）配置接入加密认证集群，具体 API 骨架在第 9 章安全课与 pkg.go.dev，面试被追问时说明「客户端侧配置的是 dialer/TLS 与 SASL 机制，与 Java 客户端的 ssl./sasl. 前缀配置是同一套服务端协议」。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 把「TLS」和「认证」混为一谈——TLS 加密传输（可选双向认证），SASL 是应用层身份认证，两个独立层次，通常叠加使用。② 说「配了 ACL 就够了」——ACL 管授权，没 TLS+SASL 时身份都可以被伪造/窃听，授权无从谈起。③ 忘了 listener 分离与 controller 端口的保护——只谈认证不谈网络面是新手视角。④ 报错常见：ACL 配置后老客户端突然连不上（缺权限）——先查 principal 与超级用户配置，别先怀疑 broker。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[安全：TLS、认证、授权与配额](/courses/kafka/lessons/kafka-security)（配置名与 Go 客户端骨架全文）。",
    },
    {
      type: "heading",
      text: "Q7. 我们是 Go 团队，要不要上 Kafka Streams？（流处理选型）",
    },
    {
      type: "paragraph",
      text: "选型题最忌讳直接答「要」或「不要」。正确结构：先澄清「你要的到底是什么」→ 摆事实（Streams 是什么、Go 生态现实）→ 给出 Go 团队的三条路与取舍 → 用书舟例子收口。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**先澄清需求**：你要的是不是**有状态流计算**——按 key 聚合/窗口统计/流流 join、状态需要容错（进程重启后从 changelog 恢复）、还要跟上数据持续算？如果只是「消费一批事件 → 落库/转发/调接口」，那是普通消费组的事（第 4 章），不需要流引擎；先分清需求再谈选型。",
        "**摆事实**：[Kafka Streams](glossary:kafka-streams) 是官方流处理库，**进程内 JVM 库不是独立服务**：拓扑（source → processor → state store → sink）在你自己的 Java 进程里跑，状态存本地（RocksDB）+ changelog 内部主题做容错，再平衡时自动恢复。**只有 Java/Scala API——Go 没有官方 Streams**，这是硬约束，不是「还没写 Go 版」的临时状态。",
        "**Go 团队的三条路（按控制权与代价排序）**：① **自管消费者 + 外部状态**——用 Go 消费、把聚合状态放 Redis/数据库/自建存储，配合 Kafka 事务或幂等处理；适合简单聚合、团队不想引 JVM，代价是**状态与恢复逻辑全得自己写**（重启重建窗口、幂等、一致性问题都归你）；② **ksqlDB**——独立流处理服务，用 SQL 定义流/表/窗口聚合，产出结果主题；Go 侧主力姿势是**消费结果主题**（也可以 REST push query）；适合「SQL 能表达的聚合 + 不想写流代码 + 接受多运维一个服务」；③ **非 Go 流服务**——Java/Kafka Streams 或 Flink/Spark 集群，由专门团队维护；适合大状态、复杂事件时间语义、已有平台团队的规模。",
        "**决策维度一句话**：状态多大、容错多严、窗口/join 多复杂、语言栈与运维预算——状态小逻辑简单 → 自管；SQL 够用想少写代码 → ksqlDB；重活大状态 → JVM 流服务（哪怕它不是 Go）。",
        "**书舟例子收口**：实时营收看板（按订单事件做 5 分钟窗口 SUM）——如果团队是 Go 且不想维护新服务，ksqlDB 定义窗口聚合、Go 消费结果主题即可；行为特征实时更新（按 user_id 维护最新画像）——本质是状态更新，自管消费者写状态库更直接。**别为了「用上流处理」而上流处理**，选型跟着状态与容错的归属走。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 说「Go 团队用 Streams 的 Go 客户端」——不存在官方实现，谁这么推荐谁没核对过事实（本课版本边界 4.3/franz-go v1.21，2026-09）。② 把 ksqlDB 当「Streams 的 SQL 版 + 打进进程的库」——ksqlDB 是**独立服务**（基于 Streams），要部署运维；别把两者的运行形态讲反。③ 用 Streams 解决「消费落库」这种普通管道问题——大炮打蚊子，运维与学习成本都白付。④ 忘了提 Flink/Spark 的存在——即使不选，答案里有一句「更重的活有外部集群引擎」能体现你视野完整。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[流处理心智模型与引擎选型](/courses/kafka/lessons/kafka-streaming-model)（Go 生态三条路与决策表）、[拓扑、KStream/KTable、状态与窗口](/courses/kafka/lessons/kafka-streams-dsl-topology)（Streams 机制）、[ksqlDB：用 SQL 做流处理](/courses/kafka/lessons/kafka-ksqldb-streaming-sql)（Go 集成姿势）。",
    },
    {
      type: "heading",
      text: "Q8. 拿到一道「用 Kafka 设计 X 系统」的题，回答的通用骨架是什么",
    },
    {
      type: "paragraph",
      text: "系统设计题没有标准答案，但**有标准流程**。面试官打分看的是你有没有按顺序把关键决策点走完，而不是某个数字对不对。骨架六步，与这门课的章节顺序完全一致——这也是为什么学完本课程你天然会答设计题。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**① 澄清范围与量级**（先问再答，永远第一步）：谁生产、谁消费；事件类型；**峰值 TPS 与消息大小**（决定分区数与容量量级）；**顺序要求**（按哪个实体？order_id 还是全局）；可靠性级别（丢/重容忍度、是否账务）；保留与回放需求（要补历史吗）；消费方数量与各自延迟要求。",
        "**② 定数据模型**：事件还是指令（事件 = 已发生事实，带 occurred_at）；主题划分与命名（按领域：`orders.events`、`user.behavior`）；字段约定与 schema 演进策略（第 6 章：向后兼容、add-only）。",
        "**③ 定主题与分区**：每个主题的 key（= 顺序边界）、分区数（吞吐 ÷ 单分区吞吐、消费并行度、2 年增长三约束）、保留策略（delete vs [compact](glossary:compaction) 按语义选）、副本与故障域。",
        "**④ 定可靠性与语义**：生产端 acks/RF/[minISR](glossary:min-insync)/unclean 关闭；消费组划分（每组一种读法）；提交时机与失败处理（重试/死信/[DLQ](glossary:dead-letter) 命名 `dlq.<topic>`）；幂等设计（业务键）；要不要事务（只在 Kafka 内闭环且两处状态同生共死时）。",
        "**⑤ 定观测与运维**：lag 看板与告警、失败/死信计数、容量水位、安全（认证/ACL/配额）、数据保留与磁盘预算。",
        "**⑥ 讲演进**：schema 兼容演进、分区扩容预案（代价已知）、新消费方加入 = 新组从头读、故障演练。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 跳过澄清直接报数字——设计题一半分数在提问：不问峰值、不问顺序要求、不问丢消息容忍度就开设计，等于假设了一个不存在的需求。② 主题设计只有名字没有决策理由——每个主题要能说出「为什么这个 key、为什么这个分区数、为什么这个保留策略」，说不出的决策在追问下都会塌。③ 只设计「正常路径」不设计「坏了怎么办」——可靠性/死信/幂等/监控缺一块，方案就不是生产方案。④ 把「演进」当加分项而不是必答题——分区扩容代价、schema 兼容这些一定要主动讲，它们区分「背过模板」和「真设计过」。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[事件建模与兼容性思维](/courses/kafka/lessons/kafka-event-modeling)、[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)、[容量规划与性能调优](/courses/kafka/lessons/kafka-capacity-tuning)（估算量级方法）。",
    },
    {
      type: "heading",
      text: "Q9. 完整走查：设计书舟的「订单事件系统」",
    },
    {
      type: "paragraph",
      text: "用 Q8 的骨架把书舟场景完整走一遍——这正是[第 10 章综合项目](/courses/kafka/lessons/kafka-capstone-order-pipeline)与[项目复盘](/courses/kafka/lessons/kafka-capstone-review)做过的系统，答案直接对应课程正文，面试时照此口述即可。量级设定：下单峰值 **5000 单/秒**、每单生命周期 3~5 个事件、行为事件 **10 万条/秒**。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**① 主题与键**：`orders.events`——订单领域事件（order.created/paid/cancelled），**key = `order_id`**：同一订单的全部事件进同一分区，状态机不被跨分区乱序破坏；保留 7 天（delete，事件流按时间淘汰）。状态型数据另设主题并走不同保留：`inventory.stock`（key = sku，**compacted**——只留每 sku 最新库存，下游可从头重建快照）、`user.profile`（key = user_id，compacted）。支付域用 `order.payments` / `payment.results` 承载指令与结果（事务演示场景）；失败隔离用 `dlq.orders.events`。",
        "**② 分区数**（按三约束推导，量级示意需压测）：`orders.events` 峰值约 2 万事件/秒，单分区按数千~上万条/秒量级算，需要 2~4 个分区覆盖峰值；消费并行度（4~8 实例）与 2 年增长留余量 → 取 **12**；`user.behavior` 10 万条/秒 → 取 **24**。结论必带一句：单分区吞吐依硬件而异，数字是量级假设，上线前压测校准。",
        "**③ 可靠性**：RF=3、minISR=2、客户端 acks=all、unclean 默认关闭——多数派先持久化；ISR 跌破 2 时宁可拒绝写入（业务降级/告警）也不单副本确认。消费端处理完再提交 + revoke 补交 + **幂等落库**（`payment_settlements` 以 `order_id` 唯一，`ON CONFLICT DO NOTHING`）——at-least-once 传输 + 幂等处理 = 端到端有效一次；账务类 Kafka 内闭环（结算管道）才评估事务。",
        "**④ 消费与失败处理**：每个下游一个[消费组](glossary:consumer-group)（inventory-组、notify-组、analytics-组），各记各的进度、互不拖累；analytics 要补历史 = 新组从 earliest 读或重置组位置（数据在保留期内即可）。失败分类：瞬态有限退避重试 → 仍失败与永久坏消息投 `dlq.orders.events`（带原始消息 + 错误现场），毒消息限次后进死信让分区前进；重放时靠业务键幂等去重。",
        "**⑤ 监控与演进**：每组的 lag 分层告警（阈值远小于保留期）、死信计数、URP/ISR/磁盘水位同看板（本课 Q4）；事件 schema 走 add-only 向后兼容演进；分区扩容预案写清楚代价（同 key 新旧数据可能分居两区——按 2 年峰值定，能不动就不动）；新团队接入 = 加一个组，不需要上游配合。",
        "**收口句（把项目讲成面试叙事）**：这套系统就是本课程 capstone 项目的完整版——面试时先给「主题设计 + 可靠性选型 + 消费幂等」三条主线结论，再按追问展开每个决策的理由；追问点（为什么 12 分区、为什么 at-least-once + 幂等而非事务、DLQ 语义边界）都能在[项目复盘](/courses/kafka/lessons/kafka-capstone-review)里找到对应的「踩过的坑 → 为什么这么定」素材，那是比背答案更抗追问的讲法。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "易错点",
      body: "① 报分区数不带推导与假设——「12 分区」本身没有意义，附上「峰值 ÷ 单分区吞吐 × 增长余量」的推导才有说服力；② 把 `inventory.stock` 也按 7 天 delete 设计——状态主题要用 compact，否则重建快照缺长尾 key 的最新值；③ 说「用事务保证不丢不重」就完了——对外部落库没有事务可谈，答案要落在幂等键/Outbox（见可靠性课 Q4）；④ 忘了 DLQ 与监控——生产方案没有失败路径与告警等于没有运维设计；⑤ 把「扩分区解决一切」当演进方案——主动说出扩容的顺序代价（第 2 章），面试官会高看这一句。",
    },
    {
      type: "paragraph",
      text: "**关联课时**：[综合项目：订单事件管道（Go）](/courses/kafka/lessons/kafka-capstone-order-pipeline)、[项目复盘：架构决策与评审清单](/courses/kafka/lessons/kafka-capstone-review)（30 秒/3 分钟叙事结构）、[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)（12/24 分区推导出处）。",
    },
    {
      type: "heading",
      text: "本课收束：集群、运维与系统设计自检",
    },
    {
      type: "keypoints",
      items: [
        "KRaft：brokers 存业务数据、controller quorum（奇数台）管元数据；process.roles 声明角色；4.0 起 ZK 彻底移除——动机是少运维一个系统、元数据与选举内建、更快更可演进",
        "生产拓扑：controller 与 broker 分离；format 一次（同一集群同一 UUID，写进 meta.properties），启动先 quorum 后 broker；combined 只用于开发",
        "滚动升级讲检查点纪律：逐台升级、每台验证通过再动下一台、controller 优先、低峰执行 + 回滚预案；细节以官方 upgrade 文档为准",
        "监控三层：可用性（OfflinePartitions、controller 健康）、数据层（UnderReplicatedPartitions、ISR 收缩/扩张）、业务层（每组每分区 lag）；告警阈值先基线后余量，lag 阈值远小于保留期",
        "再平衡风暴 = 全员停顿的病理形态：静态成员 + cooperative-sticky 缓解，根解在 KIP-848（分配上服务端、增量协调）；提交时机决定丢/重的定律协议无关",
        "安全分层：listener 分离 → TLS → SASL（SCRAM/PLAIN/OAuth）→ ACL（principal/resource/operation/host）→ 配额；每层一个问题",
        "Go 团队流处理选型：先分清「有状态流计算」还是「普通消费」；Go 无官方 Streams，三条路 = 自管状态 / ksqlDB / 非 Go 流服务，决策跟状态与容错的归属走",
        "系统设计六步骨架：澄清量级 → 数据模型 → 主题/分区 → 可靠性 → 观测运维 → 演进；每一步都要能说出决策理由",
        "订单事件系统答案锚点：orders.events 按 order_id 12 分区、状态主题 compact、RF3+minISR2+acks=all、幂等落库 + DLQ + lag 告警、add-only schema 与扩容代价预案",
      ],
    },
    {
      type: "quiz",
      question: "监控面板上某主题的 UnderReplicatedPartitions 连续一小时大于 0，describe 显示某分区 Replicas: 1,2,3 而 Isr: 1,2。下列哪个判断与处置最准确？",
      options: [
        "数据已经丢了：URP 大于 0 意味着该分区已有已确认消息被删除，需要立即从备份恢复",
        "副本 3 暂时落后或失联，数据冗余度从 3 降到 2：先查 broker 3 的网络/磁盘/负载与 ISR 收缩原因，同时确认它没有触发 unclean 选举；追平后 Isr 应恢复为 1,2,3",
        "这是正常现象：Isr 比 Replicas 少是 Kafka 的日常状态，不需要处理，指标很快会自己归零",
        "应该立刻把该分区复制因子降到 2，让 Replicas 与 Isr 一致，消除告警",
      ],
      answer: 1,
      explanation: "Replicas 是「应该有几份」（创建时定死），Isr 是「现在有几份跟得上」——两者不一致正是 UnderReplicatedPartitions 的含义：副本 3 活着但没追上（或已失联）。此时数据没丢（已确认消息都在 ISR 内），只是冗余度下降、容错能力缩水，处置是查落后副本的根因（网络/磁盘/GC/负载）等它追平；若落后副本已损坏且 ISR 成员足够，应按运维流程处理副本替换而非降低复制因子（那会让 Replicas 与 Isr 一致，但牺牲的是冗余而非消除问题）。unclean 选举关闭时，落后副本不会抢当 leader，已确认数据不会因 URP 丢失。",
    },
  ],
};
