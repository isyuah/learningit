/* ==================================================================
 * 课时：集群、Khepri 与节点角色（rabbitmq-clustering-basics）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-clustering-basics",
  courseSlug: "rabbitmq",
  title: "集群、Khepri 与节点角色",
  summary: "理解集群的共享状态、元数据存储（Mnesia→Khepri）、节点加入与网络分区行为。",
  minutes: 32,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "前面几节的拓扑都跑在单节点上：一个 Broker 进程既保存元数据，也保存所有队列的消息。单节点意味着单点故障——进程崩溃、磁盘损坏、机房断电都会让整个消息系统不可用。集群（cluster）解决的就是「把多个节点组织成一个逻辑整体，让 Broker 不再有单点」。但集群不是简单地多开几个进程：节点之间要共享哪些数据、不共享哪些数据、如何一致地复制、断网时会发生什么，这些行为在 RabbitMQ 4.x 里都发生了深刻的变化（元数据存储从 Mnesia 演进到基于 Raft 的 Khepri）。这一节先把集群的心智模型建对。",
    },
    {
      type: "heading",
      text: "集群是什么：共享元数据，不共享消息",
    },
    {
      type: "paragraph",
      text: "一个 RabbitMQ 集群是若干节点的逻辑分组，集群内所有节点共享：用户与权限、虚拟主机（vhost）、交换机、队列、绑定、运行时参数与策略。这些统称为元数据（metadata）。但有一个关键例外：队列里的消息默认只存在于一个节点上，不会被复制——除非你显式使用支持复制的队列类型（Quorum 队列或 Stream）。",
    },
    {
      type: "definition",
      term: "Cluster（集群）",
      definition: "多个 RabbitMQ 节点组成的逻辑整体，共享用户、vhost、交换机、队列、绑定、运行时参数与策略等元数据。所有节点互为对等节点（equal peers），不存在核心/边缘节点之分。消息内容默认只存储在一个节点，除非使用 Quorum 队列或 Stream 等复制型数据结构。",
    },
    {
      type: "list",
      items: [
        "元数据在所有节点上都有副本：从任意节点执行 rabbitmqctl 或访问管理 API，看到的 vhost、用户、队列定义都一致。",
        "消息默认不复制：经典队列（classic queue）的 leader 只在一个节点上，其它节点可以看到该队列并可路由消息进去，但消息本体在 leader 节点上。",
        "节点是对等的：任何节点都可以处理客户端连接、执行 rabbitmqctl 命令、选举队列 leader；没有「主节点」。",
      ],
    },
    {
      type: "heading",
      text: "节点角色：磁盘节点与内存节点的兴衰",
    },
    {
      type: "paragraph",
      text: "在 RabbitMQ 4.x 之前的漫长历史里，节点被分为磁盘节点（disc node）与内存节点（ram node）：内存节点把元数据只保存在内存里，换取更快操作，但重启后必须从磁盘节点同步。这带来一个著名的运维噩梦——如果集群里最后一个磁盘节点永久下线，内存节点无法恢复元数据，整个集群就废了。RabbitMQ 社区长期建议「绝大多数场景都用磁盘节点」。到了 4.x，这个决策终于被彻底终结：内存节点类型被废弃，并在 4.3.0 中移除（deprecated feature `ram_node_type` 被删除）。",
    },
    {
      type: "callout",
      variant: "note",
      title: "4.x 中你只需要知道一种节点：磁盘节点",
      body: "从 4.0 起 RAM 节点类型进入弃用轨道，4.3.0 起被移除。在 4.x 版本边界内，所有集群节点都持久化元数据。历史文档里「必须有磁盘节点兜底」的警告在现代版本已不适用——但仍要牢记：元数据存储（Khepri）要求集群多数派在线，这比「一个磁盘节点兜底」更严格（见下文网络分区一节）。",
    },
    {
      type: "heading",
      text: "节点加入集群：join_cluster 与集群发现",
    },
    {
      type: "paragraph",
      text: "每个节点有唯一节点名，形如 `rabbit@hostname`，主机名部分必须能被所有节点解析。两个节点能互相通信的前提是共享同一个 Erlang cookie（一个最多 255 字符的共享密钥）。手动组建集群的核心命令是 `rabbitmqctl join_cluster`：新节点先 `stop_app`（停掉应用但不停止 Erlang 进程），加入后 `start_app`，此时它会从集群同步全部元数据。",
    },
    {
      type: "code",
      title: "用 rabbitmqctl 组建三节点集群",
      language: "bash",
      code: `# 三台机器都配置了相同的 Erlang cookie（如 /var/lib/rabbitmq/.erlang.cookie）
# 并已确认主机名互相可解析。假设集群种子节点是 rabbit@node1

# ---- 在 node2 上 ----
rabbitmqctl stop_app
rabbitmqctl join_cluster rabbit@node1
rabbitmqctl start_app

# ---- 在 node3 上 ----
rabbitmqctl stop_app
rabbitmqctl join_cluster rabbit@node1
rabbitmqctl start_app

# 从任意节点查看集群状态
rabbitmqctl cluster_status
# => Running Nodes: rabbit@node1 rabbit@node2 rabbit@node3
# => Versions: [4.3.5, 4.3.5, 4.3.5]`,
    },
    {
      type: "paragraph",
      text: "生产环境通常不手动敲 join_cluster，而是用声明式集群发现：在配置里列出对等节点（config 文件显式列表）、DNS 发现、Kubernetes 发现、Consul 或 etcd 等。无论哪种方式，底层都要求：节点名唯一、主机名互相解析、Erlang cookie 一致、节点间端口可达（4369 是 epmd，25672 是节点间通信端口，35672-35682 是 CLI 工具使用的分布端口；Stream 复制额外使用 6000-6500）。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "cookie 不一致的典型症状",
      body: "节点间 Erlang cookie 不一致时，加入集群会失败并报错（常见如 `{badcookie,...}` 或握手失败）。cookie 文件权限也必须正确（UNIX 上通常是 600，仅属主可读）。在容器环境里要确保每个节点用同一个 `RABBITMQ_ERLANG_COOKIE`，而不是各自随机生成——随机生成的 cookie 只适合单机开发。",
    },
    {
      type: "heading",
      text: "元数据存储：从 Mnesia 到 Khepri",
    },
    {
      type: "paragraph",
      text: "用户、vhost、交换机、队列定义、绑定、策略这些元数据存哪里、怎么复制，是集群一致性的核心。RabbitMQ 长期使用 Erlang/OTP 自带的 Mnesia 数据库；Mnesia 的弱点是故障恢复特性：它假设系统可以丢弃网络分区一侧的全部数据，冲突要靠「分区处理策略」（partition handling strategies）来补救，而这些策略本身很难推理。RabbitMQ 团队从 3.13 起试验基于 Raft 共识算法的新元数据存储 Khepri，4.0 起 fully supported，4.2 起成为默认，并计划在未来版本完全移除 Mnesia。",
    },
    {
      type: "table",
      caption: "Mnesia 与 Khepri 的对比（课程版本边界内）",
      headers: ["维度", "Mnesia（≤4.2 可选）", "Khepri（4.2 默认 / 4.3 唯一）"],
      rows: [
        ["共识算法", "无（自行复制+冲突解决）", "Raft（与 Quorum 队列、Stream 同源）"],
        ["网络分区", "需要分区处理策略，易出脑裂", "Raft 语义：多数派在即可继续，恢复自动追赶日志"],
        ["多数派要求", "无硬性要求", "元数据写操作需要集群多数派在线"],
        ["可用版本", "4.2 仍可用；未来版本移除", "4.0 fully supported；4.2 默认"],
        ["可预测性", "差（依赖策略）", "高（所有复制组件行为一致）"],
      ],
    },
    {
      type: "paragraph",
      text: "Khepri 与 Quorum 队列、Stream 共用同一套 Raft 基础（Ra 库），因此「断网时行为如何」在三个组件间高度一致：少数派一侧的元数据写操作会被拒绝或延迟，恢复后从 leader 追赶缺失的日志条目。这大大简化了运维推理——你不再需要配置 `cluster_partition_handling` 这类 Mnesia 时代的分区策略（4.3 起这些配置键被接受但不再生效）。",
    },
    {
      type: "heading",
      text: "网络分区与脑裂：多数派规则",
    },
    {
      type: "paragraph",
      text: "Raft 的数据安全以「多数派必须在线」为代价。Khepri 在集群每个节点上都有副本，因此整个集群可用性直接取决于元数据多数派。3 节点集群能容忍 1 个节点故障；5 节点容忍 2 个；2 节点集群容忍 0 个——这也是官方强烈不推荐 2 节点集群的原因。分区（partition）就是节点间网络断开但节点本身没挂：此时少数派一侧的 Khepri 写操作无法达成共识，会阻塞或超时；恢复后断连节点自动找到 leader、拉取缺失日志并追赶。",
    },
    {
      type: "list",
      items: [
        "Leader 断开：多数派一侧立即选举新 leader，发布确认可能延迟或收到 basic.nack；未 ack 的消息由新 leader 重新投递（消费者可能重复收到消息）。",
        "Follower 断开：多数派侧正常读写；断连侧 Khepri 只服务本地缓存读，追赶完成后恢复。",
        "追赶中的节点不能成为 leader，应视为暂时不可用。",
        "Khepri 的读分两种：本地缓存读（多数派可用即可）与线性化读（必须过 leader，无 leader 时暂停）。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "「脑裂」在 4.x 的表现：少数派失写而非双主",
      body: "Mnesia 时代的脑裂是两侧都可能继续写、合并时冲突；Khepri 时代没有传统脑裂——少数派一侧的元数据写入会失败或阻塞（没有多数派就写不成），从而避免两侧分叉。但这带来新的运维含义：集群「活着」的判断标准从「进程在跑」变成了「多数派在线」。例如 3 节点集群中 2 个节点断网，剩下 1 个节点即使进程健康，Khepri 元数据写入也会被卡住，生产者和消费者都可能报错。因此在集群上做任何维护（升级、重启）前，先确认不会把在线节点压到少数派，并用 `rabbitmq-diagnostics check_if_node_is_quorum_critical` 或 `rabbitmq-upgrade await_online_quorum_plus_one` 这类工具兜底。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "集群规模建议",
      body: "生产环境首选 3 或 5 个奇数节点：3 节点容忍 1 台故障，5 节点容忍 2 台。偶数节点（2、4、6）不会带来额外容错（多数派是 N/2+1），却多付出一台机器的成本；2 节点集群在任意单点故障时都会失去多数派，官方明确不推荐。Khepri、Quorum 队列、Stream 都遵循同一张「节点数→可容忍故障数」表。",
    },
    {
      type: "keypoints",
      items: [
        "集群共享用户、vhost、交换机、队列定义、绑定、策略等元数据；消息内容默认不复制。",
        "所有节点是对等节点；RAM 节点类型已废弃并在 4.3.0 移除，4.x 中都是磁盘节点。",
        "加入集群需要节点名唯一、主机名互相解析、Erlang cookie 一致、节点间端口（4369/25672 等）可达。",
        "元数据存储 4.2 起默认为基于 Raft 的 Khepri，4.3 起为唯一选择（Mnesia 未来移除），网络分区行为由多数派规则决定。",
        "Khepri 消除了传统脑裂：少数派一侧写操作失败而非分叉；维护前必须保证多数派在线。",
      ],
    },
  ],
};
