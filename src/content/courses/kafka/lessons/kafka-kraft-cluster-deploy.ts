/* ==================================================================
 * 课时：KRaft 集群：架构、部署与升级（kafka-kraft-cluster-deploy）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 事实核对（2026-09-08）：
 * - 命令形态与输出按 Apache Kafka 4.3.1 实测（docker 内 3 controller +
 *   1 broker 的动态 quorum 集群演练）；describe --status / --replication、
 *   format --standalone / --no-initial-controllers、add-controller、
 *   kafka-features.sh describe 的输出均来自实测。
 * - 架构表述（quorum、majority、2N+1、combined 建议、5GB 量级）对照
 *   kafka.apache.org/43/operations/kraft/；滚动升级原则对照
 *   kafka.apache.org/43/getting-started/upgrade/。
 * - 与第 1 章 quickstart 课保持一致：CLI 名称带 .sh、format 可用 -t 别名。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "KRaft 的元数据日志与投票 quorum 架构、controller/broker 角色与部署拓扑，以及多节点格式化、启动、验证与滚动升级的实操。",
  blocks: [
    {
      type: "paragraph",
      text: "第 1 章你在自己机器上跑通了单节点 [KRaft](glossary:kraft)，后面几章从[主题](glossary:topic)、生产者、消费者一路讲到 Streams/Connect 生态——但所有这些代码练习都连着一个「假的」生产环境：一台 combined 节点，无副本、无冗余。这一课开始进入第 9 章，把单节点换成**真集群**：先讲清 KRaft 的元数据日志与 quorum 架构，再给出一套可照抄的分离角色部署流程（含本机即可复现的最小演练），最后是 4.x 滚动升级的原则。学完这一课，[下一课](/courses/kafka/lessons/kafka-monitoring-lag)的所有指标才有意义——你总算有了一个值得观测的对象。",
    },
    {
      type: "heading",
      text: "先回答「为什么没有 ZooKeeper 了」",
    },
    {
      type: "paragraph",
      text: "Kafka 在 3.0 之前用 ZooKeeper 存集群元数据（主题、分区、副本、节点、controller 选举），[controller](glossary:controller) 角色也依赖与 ZK 的会话。3.x 开始 Apache Kafka 用 KIP-500 引入 KRaft：把「元数据」本身变成一份内部日志，由一组投票节点自己管理，不再需要 ZooKeeper；**4.0（2025-03）起 ZooKeeper 模式被移除，KRaft 是唯一模式**。一句话背景就够了：这套演进换来的是元数据一致性模型统一（不再有「ZK 里一套、broker 内存一套」的协调难题）、运维组件减少（少部署一套分布式系统、少一种故障域），以及后续元数据层的弹性演进（4.1 起的动态 controller quorum 就是建立在 KRaft 之上的）。老集群从 ZooKeeper 迁移到 KRaft 需要经过 3.9 这个最后的 bridge 版本——本课不展开，4.x 新集群直接按 KRaft 部署即可。",
    },
    {
      type: "heading",
      text: "架构：元数据日志 + 投票 quorum",
    },
    {
      type: "paragraph",
      text: "KRaft 下，集群的全部元数据（哪个主题几个分区、每个分区的副本分配、leader 是谁、配置变更、新增/下线节点…）不是分散存的，而是追加进**一份**内部主题 `__cluster_metadata` 的日志里。这份日志由集群中选出的若干节点组成的 quorum 复制与裁决——这就是全部要点。把它画出来：",
    },
    {
      type: "code",
      title: "KRaft 集群的逻辑结构（3 投票 controller + 2 broker）",
      language: "text",
      code: `                    ┌─────────────────────────────┐
  客户端(生产者/消费者)  │        控制器 quorum          │
        │               │  controller-1 (leader/active) │
        ▼               │  controller-2 (voter/standby) │
  ┌──────────┐          │  controller-3 (voter/standby) │
  │ broker-4 │◄─────────┤                               │
  │ broker-5 │  订阅并   │  共同复制/提交 __cluster_metadata 日志
  └──────────┘  应用元数据│  （Raft：多数派写入才算提交）    │
                        └─────────────────────────────┘
  · 投票者(voter)：能参与选主与提交裁决 —— 只有 controller
  · 观察者(observer)：只读元数据日志并应用 —— 所有 broker + 备用 controller`,
    },
    {
      type: "paragraph",
      text: "三个角色词需要钉死：**投票者（voter）**参与元数据日志的复制与提交裁决，只有 controller 是投票者；**观察者（observer）**订阅并应用元数据，broker 全是观察者；quorum 中当前被选出的 leader 就是**活跃 controller（active controller）**，负责处理 broker 心跳、下发 leader 变更等事件，其余投票者是热备。broker 通过 `controller.quorum.bootstrap.servers`（或老配置 `controller.quorum.voters`）里的地址列表找到 quorum，再随元数据日志更新自己的内存视图——所以**broker 能服务读写，前提是它跟得上元数据日志**，这也是第 9 章观测课里「broker 元数据滞后」类指标的意义。",
    },
    {
      type: "definition",
      term: "多数派（majority）",
      definition:
        "KRaft quorum 的裁决规则：只有超过半数的投票者确认，元数据记录才算提交。因此集群可用性取决于投票 controller 的多数派是否在线：3 台可容忍 1 台故障，5 台可容忍 2 台（公式 2N+1 容忍 N 台）。broker 再多也不参与投票——它们宕机只影响自己的分区，不威胁元数据层。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "单节点也是 quorum",
      body: "第 1 章 quickstart 的单节点 combined 就是「1 台投票者」的 quorum（format 时用 `--standalone` 声明）。它多数派=自己，任何时刻都可用；代价是没有冗余——controller 进程一死，整个集群的元数据层就停了。生产集群的 controller 数量永远是 3 或 5 这样的奇数。",
    },
    {
      type: "heading",
      text: "process.roles：一台 Kafka 进程当什么角色",
    },
    {
      type: "paragraph",
      text: "每个 Kafka 服务端进程在配置文件里用 `process.roles` 声明自己扮演什么：`broker`（纯存数据的节点）、`controller`（纯元数据节点）、或 `broker,controller`（两者兼的 **combined** 模式）。官方文档的部署建议很直接：combined 只适合小规模/开发场景，**关键生产环境应分离**——因为 combined 下 controller 无法与 broker 分开滚动升级、分开扩容，controller 的资源与故障也被数据流量干扰。",
    },
    {
      type: "table",
      caption: "process.roles 三种组合的取舍（4.3 官方建议）",
      headers: ["process.roles", "适用", "关键约束"],
      rows: [
        ["`broker`", "生产集群的数据节点", "本身不参与投票；必须能连上 controller quorum 才能注册"],
        ["`controller`", "生产集群的元数据节点（3 或 5 台）", "只监听 controller 专用 listener；controller 宕机影响元数据层"],
        ["`broker,controller`（combined）", "单机学习、小规模非关键环境", "controller 无法与 broker 分离滚动/扩容；官方不建议关键环境使用"],
      ],
    },
    {
      type: "paragraph",
      text: "配套的还有几个每个节点都要写对的身份/通信配置：`node.id`（全集群唯一的整数，就是第 1 章 describe 输出里 Leader/Replicas 列出现的那种编号）、`listeners` 与 `advertised.listeners`（进程监听地址与对外通告地址——controller 之间的互连、broker 与 controller 的连接都按通告地址走，配成 `localhost` 会让其它机器连不上）、`controller.listener.names`（声明哪个 listener 名字是 controller 专用的，KRaft 必需）、`log.dirs`（数据目录；controller 节点的这份目录存的是元数据日志与快照）。",
    },
    {
      type: "heading",
      text: "节点身份：集群 UUID、node.id 与 meta.properties",
    },
    {
      type: "paragraph",
      text: "KRaft 集群有三层身份，别混：**集群 UUID** 由 `kafka-storage.sh random-uuid` 生成一次，**全集群所有节点共享**（格式化每个节点都用同一个值，它是「这是同一个集群」的凭据）；**node.id** 每个节点各自在配置里声明，必须唯一；**directory.id** 是 format 时随机写入每个数据目录的目录身份（动态 quorum 用它精确指认节点，扩容时你会见到它）。format 会把身份写进数据目录的 `meta.properties`——第 1 章观察一里你已经见过它一次，多节点下它的真实样貌是：",
    },
    {
      type: "code",
      title: "实测：格式化后数据目录里的 meta.properties",
      language: "text",
      code: `cluster.id=ykdd1lBXRjGALWkgjbYAng   # 全集群共享：format 时 -t 传入的那个 UUID
directory.id=9fbeJwWfTEGjdWuEBmZIdw  # 本目录随机身份（动态 quorum 扩容要用）
node.id=11                           # 本节点身份（来自配置文件）
version=1`,
    },
    {
      type: "paragraph",
      text: "注意官方从某一代起**取消了自动格式化**：新节点必须显式执行 format 才会启动。理由值得记住——如果多数 controller 都「自动以空元数据日志启动」，它们可能选出 leader 而实际丢失了已提交的元数据；显式 format 逼你确认「这份目录属于哪个集群」。同一目录已被格式化后再执行 format 会报错（不会覆盖），自动化脚本要么先清空目录、要么加 `--ignore-formatted` 跳过已格式化目录。",
    },
    {
      type: "heading",
      text: "静态 quorum 还是动态 quorum：先分清再部署",
    },
    {
      type: "paragraph",
      text: "4.3 支持两种 quorum 形态，**格式化那一刻就定死了**，所以部署前必须选好：",
    },
    {
      type: "list",
      items: [
        "**静态 quorum（kraft.version=0，老方式）**：每台 broker 与 controller 的配置里都写死完整的 `controller.quorum.voters=1@host1:9093,2@host2:9093,3@host3:9093`，voter 集合固定。第 1 章 Docker 镜像的默认单机配置、以及 4.1 之前建的所有集群都是这种。",
        "**动态 quorum（kraft.version=1，4.1+，官方推荐）**：只写 `controller.quorum.bootstrap.servers=host1:9093,host2:9093,host3:9093`（语义类似客户端的 bootstrap 地址，不必写全，能引导找到 quorum 即可）；controller 可以后续用 `add-controller`/`remove-controller` 动态增删，不需要停机改所有节点配置。4.3 发行包自带的 `config/controller.properties` 与 `config/broker.properties` 样例就是这种写法。",
      ],
    },
    {
      type: "code",
      title: "判别自己的集群是静态还是动态（kafka-features.sh，4.3.1 实测）",
      language: "text",
      code: `$ bin/kafka-features.sh --bootstrap-server localhost:9092 describe
...
Feature: kraft.version   SupportedMinVersion: 0  SupportedMaxVersion: 1  FinalizedVersionLevel: 1
Feature: metadata.version SupportedMinVersion: 3.3-IV3  SupportedMaxVersion: 4.3-IV0  FinalizedVersionLevel: 4.3-IV0
...
# kraft.version FinalizedVersionLevel=1 → 动态 quorum；=0 或该行缺失 → 静态 quorum`,
    },
    {
      type: "paragraph",
      text: "本课下面的实操按 4.3 官方推荐路径走**动态 quorum**（与发行包样例一致）；静态 quorum 只是把 `controller.quorum.bootstrap.servers` 换成写死的 `controller.quorum.voters`、format 时不带下面三种初始化标志即可，其余完全一样。老集群想从静态迁到动态：先把 `kraft.version` 升到 1、再切配置，官方升级文档有专门步骤，不在本课展开。",
    },
    {
      type: "heading",
      text: "部署实操：一个 controller + 一个 broker（本机可复现）",
    },
    {
      type: "paragraph",
      text: "下面这套流程我在 4.3.1 上完整跑过，你在一台机器上就能复现（需要 JDK 17+ 与解压好的发行包）：先起一台**纯 controller**（角色分离的最小形态），再起一台**纯 broker** 让它加入。理解了这个最小闭环，生产拓扑只是把它放大到 3+3 台并把地址从 `127.0.0.1` 换成真实主机。第一步，给第一个 controller 写配置并格式化：",
    },
    {
      type: "code",
      title: "controller-1 配置（config/controller.properties）与格式化",
      language: "bash",
      code: `# 这台机器上第一个 controller 的配置文件
cat > config/controller.properties <<'EOF'
process.roles=controller
node.id=11
listeners=CONTROLLER://127.0.0.1:19093
advertised.listeners=CONTROLLER://127.0.0.1:19093
controller.listener.names=CONTROLLER
controller.quorum.bootstrap.servers=127.0.0.1:19093
log.dirs=/tmp/kraft-ctrl-1
num.network.threads=3
num.io.threads=8
EOF

# 1) 生成集群 UUID（全集群共享，只生成一次）
KAFKA_CLUSTER_ID="$(bin/kafka-storage.sh random-uuid)"
echo "$KAFKA_CLUSTER_ID"

# 2) 格式化：--standalone = 声明本节点是动态 quorum 的第一个（也是唯一的）投票者
bin/kafka-storage.sh format --cluster-id "$KAFKA_CLUSTER_ID" --standalone -c config/controller.properties

# 3) 启动（前台跑会占住终端；生产用 systemd 等托管）
bin/kafka-server-start.sh config/controller.properties`,
    },
    {
      type: "code",
      title: "格式化与启动的真实输出（4.3.1 实测）",
      language: "text",
      code: `Formatting dynamic metadata voter directory /tmp/kraft-ctrl-1 with metadata.version 4.3-IV0.
# …启动日志…
INFO [KafkaRaftServer nodeId=11] Kafka Server started (kafka.server.KafkaRaftServer)`,
    },
    {
      type: "paragraph",
      text: "接着验证 quorum 状态——`describe --status` 是 KRaft 最重要的体检命令，可以指 broker 端口也可以直接指 controller 端口：",
    },
    {
      type: "code",
      title: "体检：kafka-metadata-quorum describe --status（4.3.1 实测）",
      language: "text",
      code: `$ bin/kafka-metadata-quorum.sh --bootstrap-controller 127.0.0.1:19093 describe --status
ClusterId:              ykdd1lBXRjGALWkgjbYAng
LeaderId:               11
LeaderEpoch:            1
HighWatermark:          17
MaxFollowerLag:         0
MaxFollowerLagTimeMs:   0
CurrentVoters:          [{"id": 11, "directoryId": "9fbeJwWfTEGjdWuEBmZIdw", "endpoints": ["CONTROLLER://127.0.0.1:19093"]}]
CurrentObservers:       []`,
    },
    {
      type: "table",
      caption: "describe --status 输出列含义（4.3）",
      headers: ["字段", "含义", "异常信号"],
      rows: [
        ["`ClusterId`", "集群 UUID", "与预期不一致说明连错集群"],
        ["`LeaderId` / `LeaderEpoch`", "当前活跃 controller（元数据 leader）及其任期", "LeaderId 为 -1 = quorum 暂无 leader（多数派失联）"],
        ["`HighWatermark`", "元数据日志已提交到的位置", "不再增长 = 元数据写入停滞"],
        ["`MaxFollowerLag` / `MaxFollowerLagTimeMs`", "投票者/观察者中最落后的复制差距与时间", "持续变大 = 有节点复制跟不上（网络/磁盘问题）"],
        ["`CurrentVoters`", "当前投票者集合（动态 quorum 下含 directoryId 与端点）", "少了一台 = 有 controller 被移除或失联"],
        ["`CurrentObservers`", "当前观察者（broker 与备用节点）", "上线中的 broker 应出现在这里"],
      ],
    },
    {
      type: "paragraph",
      text: "现在写第二份配置，格式化并启动一台纯 broker。broker 用 `--no-initial-controllers` 格式化——语义是「我要加入一个已存在的动态 quorum，我不带任何初始投票权」：",
    },
    {
      type: "code",
      title: "broker-1 配置、格式化与启动（4.3.1 实测通过）",
      language: "bash",
      code: `cat > config/broker.properties <<'EOF'
process.roles=broker
node.id=21
listeners=PLAINTEXT://127.0.0.1:29092
advertised.listeners=PLAINTEXT://127.0.0.1:29092
inter.broker.listener.name=PLAINTEXT
controller.listener.names=CONTROLLER
listener.security.protocol.map=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
controller.quorum.bootstrap.servers=127.0.0.1:19093
log.dirs=/tmp/kraft-broker-1
# 内部主题副本数：offsets.topic.replication.factor 等默认 1，
# 生产（≥3 broker 时）请改为 3，否则 __consumer_offsets 无冗余
offsets.topic.replication.factor=3
transaction.state.log.replication.factor=3
transaction.state.log.min.isr=2
EOF

bin/kafka-storage.sh format --cluster-id "$KAFKA_CLUSTER_ID" --no-initial-controllers -c config/broker.properties
bin/kafka-server-start.sh config/broker.properties`,
    },
    {
      type: "code",
      title: "broker 加入后的 quorum 状态（4.3.1 实测：broker 是观察者）",
      language: "text",
      code: `$ bin/kafka-metadata-quorum.sh --bootstrap-controller 127.0.0.1:19093 describe --status
ClusterId:              ykdd1lBXRjGALWkgjbYAng
LeaderId:               11
...
CurrentVoters:          [{"id": 11, "directoryId": "9fbeJwWfTEGjdWuEBmZIdw", "endpoints": ["CONTROLLER://127.0.0.1:19093"]}]
CurrentObservers:       [{"id": 21, "directoryId": "sMU19nAbv5j777x0Q778Dg"}]

# broker 端同样可用 --bootstrap-server 指 broker 端口查（客户端视角的验证）`,
    },
    {
      type: "code",
      title: "端到端验证：broker 端口上建主题（4.3.1 实测输出）",
      language: "bash",
      code: `bin/kafka-topics.sh --create --topic orders.events --partitions 3 \\
  --replication-factor 1 --bootstrap-server 127.0.0.1:29092
bin/kafka-topics.sh --describe --topic orders.events --bootstrap-server 127.0.0.1:29092`,
    },
    {
      type: "paragraph",
      text: "输出里 `Leader: 21 Replicas: 21 Isr: 21`——单 broker 的 RF=1 主题只有自己，和第 1 章单机一模一样。**副本的意义要 ≥2 台 broker 才出现**：书舟生产集群（3 台 broker、RF=3、minISR=2）建出的主题 describe 里，`Replicas` 会是三台 broker 的编号而 `Isr` 在健康时与它相同——「Isr 比 Replicas 少」才是副本落后的信号，这是[第 2 章副本与 ISR](/courses/kafka/lessons/kafka-replication-isr)讲过的判据，现在你能亲眼看到它了。想在本机体验多 broker 复制：把上面的 broker 配置复制成第二、三份（换 `node.id`、`listeners` 端口与 `log.dirs`），重复「格式化 + 启动」，broker 会自动加入集群、自动分担新建主题的分区。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "格式化最常见的一对错误",
      body: "① 忘了 format 直接 `kafka-server-start`：进程启动即失败（找不到已格式化的元数据目录），日志里会报目录未格式化/无 cluster id 之类错误——先 `format` 再启动。② 格式化时用了**别的集群**的 UUID：节点带着不同的 cluster.id 想加入，会一直无法注册。所以多节点部署要把「全集群一个 UUID」当成纪律：UUID 只生成一次，其它节点全部复用同一个。",
    },
    {
      type: "heading",
      text: "扩容到 3 台 controller：动态 quorum 的增员流程",
    },
    {
      type: "paragraph",
      text: "上面只有 1 台投票者，controller 一挂元数据层就停——生产至少 3 台。动态 quorum 的扩容流程（4.3 官方文档 + 实测）：新 controller 先用 `--no-initial-controllers` 格式化并启动，此时它只是**观察者**（复制元数据但无投票权）；等它追上 leader（看 `describe --replication` 的 Lag 归零），再执行 `add-controller` 授予投票权。add-controller 要在**被加入的那台节点上**执行，并带上它自己的配置文件：",
    },
    {
      type: "code",
      title: "新增 controller-2：观察 → 追平 → 授票（4.3.1 实测命令）",
      language: "bash",
      code: `# controller-2 的配置（node.id=12、listeners/广告地址换端口 19094、log.dirs 换目录）
# 其余与 controller-1 相同，controller.quorum.bootstrap.servers 保持指向现有 quorum

bin/kafka-storage.sh format --cluster-id "$KAFKA_CLUSTER_ID" --no-initial-controllers -c config/controller2.properties
bin/kafka-server-start.sh config/controller2.properties

# 在 quorum 端观察复制进度：Lag 归零、Status 显示 Observer 说明已追平
bin/kafka-metadata-quorum.sh --bootstrap-controller 127.0.0.1:19093 describe --replication

# 在 controller-2 本机执行：把自己加进投票者集合
bin/kafka-metadata-quorum.sh --command-config config/controller2.properties \\
  --bootstrap-controller 127.0.0.1:19094 add-controller
# 输出：Added controller 12 with directory id ... and endpoints: CONTROLLER://127.0.0.1:19094`,
    },
    {
      type: "paragraph",
      text: "第三台重复同样步骤。完成后 `describe --status` 的 `CurrentVoters` 应有 3 个条目——此时才获得「容忍 1 台 controller 故障」的冗余。反向操作是 `remove-controller`（先移除投票权再停机，避免留下一个永远失联的投票者拖累多数派计算）。另一种建 3 台的方式是**一次性初始化**：三台 controller 用同一个 `--initial-controllers \"11@host1:9093:<dirid>,12@host2:9093:<dirid>,13@host3:9093:<dirid>\"` 参数格式化（每台都要先拿到三台的 directory.id，命令里 `id@host:port:directoryId` 的写法见官方文档），从第一秒起就是三人 quorum，适合新集群一把梭。",
    },
    {
      type: "heading",
      text: "生产拓扑、故障域与启动顺序",
    },
    {
      type: "paragraph",
      text: "把上面的最小演练放大到生产，拓扑与顺序都很朴素：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**3 台 controller**（或 5 台）：只跑 `process.roles=controller`，放在**不同的故障域**（不同机架/可用区），机器之间网络要低延迟高可靠——它们每写一条元数据都要等多数派确认，跨机房大延迟会直接拖慢建主题、加分区等操作。官方给出量级参考：典型的 controller 节点给 5GB 内存、元数据日志目录 5GB 磁盘通常足够（元数据在内存与磁盘各有一份）。",
        "**N 台 broker**（书舟示例 3 台起步）：`process.roles=broker`，`log.dirs` 指向数据盘；broker 宕机只影响它持有的分区（由其它副本接管），不影响元数据层。",
        "**启动顺序**：先让 controller quorum 达到多数派（3 台里至少 2 台起来、能选出 leader），再启动 broker——broker 启动时要去 quorum 注册，quorum 没就绪它会一直重试等待，日志里能看到连接/重试信息，这不是错误。",
        "**每台节点的验证**：`describe --status`（quorum 视图）+ `describe --replication`（各节点追平情况）+ `kafka-topics.sh --describe`（数据面副本分布）+ broker 日志里出现 `Kafka Server started` 与 `Successfully registered broker`。",
      ],
    },
    {
      type: "callout",
      variant: "tip",
      title: "把 controller 当成「元数据的 Kafka」",
      body: "controller 之间跑的是一套 Raft 复制，数据目录里躺着 `__cluster_metadata-0` 目录与快照 checkpoint——它同样吃磁盘、同样要备份思想（不过元数据另有快照机制）。排障时如果「分区 leader 迟迟选不出来」，先看 quorum 是不是缺了多数派，再怀疑数据面——这个先后顺序是第 9 章[排障手册](/courses/kafka/lessons/kafka-troubleshooting)反复要用的判断。",
    },
    {
      type: "heading",
      text: "滚动升级 4.x → 4.3：原则与顺序",
    },
    {
      type: "paragraph",
      text: "升级方法随版本演进（具体步骤、中间版本、feature 版本号都以你升级时对应的官方 [upgrade 文档](https://kafka.apache.org/43/getting-started/upgrade/)为准），但原则是稳定的，本课把这些原则讲透：",
    },
    {
      type: "list",
      items: [
        "**KRaft 是前提**：4.3 只支持 KRaft；仍在 ZooKeeper 模式的集群必须先用 3.9（最后 bridge 版）迁到 KRaft，KRaft 但元数据版本低于 3.3 的集群建议先升到 3.9.x，再谈 4.3。",
        "**逐节点滚动，一次一台**：停节点 → 换二进制/镜像 → 启动 → 验证集群行为与性能符合预期，再动下一台。任何时候都别让 controller quorum 丢多数派（3 台时一次只动 1 台），broker 侧同理逐台进行；重启前用受控停机（`controlled.shutdown.enable=true` 时 broker 会先同步日志并把自己领导的分区移交出去，尽量缩短不可用窗口）。",
        "**新旧版本混跑是特性不是 bug**：滚动期间老节点与新节点共存、feature 版本未提升前按旧语义运行——这正是逐台验证的意义所在。",
        "**最后一步才提升版本**：全部节点就绪并验证通过后，执行 `bin/kafka-features.sh --bootstrap-server <broker> upgrade --release-version 4.3` 把集群的元数据版本最终化（这一步由 controller quorum 提交）。",
        "**留意降级方向**：4.3 的元数据版本包含结构性变更，**不支持降级**——升级窗口一旦越过 finalize，就没有回头路，这也是「先在低版本充分验证」的原因。",
      ],
    },
    {
      type: "paragraph",
      text: "升级窗口里最该盯的观测项，正好是下一课的内容：`describe --replication` 的 Lag 与 quorum 状态、UnderReplicatedPartitions 是否归零、以及各消费组 lag 是否在每台节点重启后正常回落。把「升级」当成一次受控的故障演练来对待，比任何 checklist 都管用。",
    },
    {
      type: "keypoints",
      items: [
        "KRaft = 元数据放进内部日志 `__cluster_metadata`，由投票 controller 组成的 quorum 用多数派规则复制与裁决；[4.0 起 ZooKeeper 移除，KRaft 唯一](glossary:kraft)",
        "角色由 `process.roles` 决定：生产用 3 或 5 台纯 controller + N 台纯 broker（2N+1 容忍 N 台 controller 故障）；combined 只适合开发环境",
        "身份三层：集群 UUID 全集群共享（format 必带）、node.id 每节点唯一、directory.id 格式化时随机生成（动态 quorum 扩容指认用）；format 后写进 meta.properties",
        "4.1+ 动态 quorum（KIP-853，推荐）：配 `controller.quorum.bootstrap.servers`，首台 `format --standalone`，新节点 `--no-initial-controllers` 加入后再 `add-controller` 授票；老静态方式用 `controller.quorum.voters`；`kafka-features.sh describe` 看 kraft.version 判别",
        "体检三板斧：`kafka-metadata-quorum.sh describe --status`（quorum 视图）、`describe --replication`（复制进度）、`kafka-topics.sh --describe`（数据面）",
        "滚动升级原则：KRaft 前提 → 逐台（停/换/启/验）→ 保持多数派 → 全部验证后才 `kafka-features.sh upgrade --release-version <目标>` 最终化；4.3 起不支持降级",
      ],
    },
    {
      type: "quiz",
      question:
        "你的 KRaft 集群有 3 台投票 controller（controller-1/2/3）与 6 台 broker，多数派规则正常工作。某一刻 controller-1 与 controller-2 所在的机架同时断电。以下哪个描述正确？",
      options: [
        "集群完全不可用：因为 6 台 broker 无法工作，所有分区读写都会失败",
        "controller-3 作为唯一存活的投票者仍可单独提交元数据，集群照常服务，无需任何干预",
        "投票 controller 只剩 1/3，不构成多数派：无法选出活跃 controller、元数据变更（如新建主题、为宕机分区补选 leader）会停滞；数据面已分配的分区读写仍可继续，直到 controller 恢复",
        "Kafka 会自动把 broker 提升为投票者以补足多数派，几秒后集群自愈",
      ],
      answer: 2,
      explanation:
        "KRaft 的裁决权只属于投票 controller：3 台失 2 台即失去多数派，元数据日志无法提交，选举与一切元数据变更停滞（describe --status 会显示无 leader、建主题请求会卡住）。但 broker 是观察者、数据面独立于元数据提交——已存在的分区 leader 仍能服务生产与消费。恢复 = 让 controller 回到多数派。broker 永远不会自动获得投票权。",
    },
    {
      type: "paragraph",
      text: "集群立起来了，下一课回答「它现在健康吗」：[观测：指标、日志与消费滞后](/courses/kafka/lessons/kafka-monitoring-lag)会给你一张可以照着建监控的指标清单，并把这节课里的 quorum 状态命令翻译成长期盯守的告警。",
    },
  ],
};
