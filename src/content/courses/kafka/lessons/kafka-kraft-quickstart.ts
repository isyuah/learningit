/* ==================================================================
 * 课时：本地运行 Kafka 4.3（KRaft）与 CLI 初体验（kafka-kraft-quickstart）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 事实核对（2026-09-08）：命令与输出均按 Apache Kafka 4.3.1 实测；
 * Docker 镜像 apache/kafka:4.3.1（Docker Hub tag 存在，amd64/arm64）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "用 Docker（或官方发行包）在本地跑起单节点 KRaft Kafka 4.3，创建主题、用 CLI 收发带 key 的消息，并观察消息落盘与消费位置。",
  blocks: [
    {
      type: "paragraph",
      text: "前两课把[主题（topic）](glossary:topic)、[分区（partition）](glossary:partition)、[偏移量（offset）](glossary:offset)、[Broker](glossary:broker) 这些概念立成了地图。这一课把地图变成真的：十五分钟内，在你自己机器上跑起一个单节点 Kafka 4.3，创建书舟的第一个主题 `orders.events`，用命令行工具发两条带 key 的订单事件再读回来，然后亲眼看到两件「只存在于口头」的事——消息落成了文件、消费位置被 broker 记住了。本课的每条命令在后面章节都会被反复用到，值得亲手敲一遍。",
    },
    {
      type: "heading",
      text: "要启动的东西：一个 combined 模式的 KRaft 节点",
    },
    {
      type: "paragraph",
      text: "Kafka 4.x 已经没有 ZooKeeper：[KRaft](glossary:kraft) 从 4.0 起是唯一模式，集群的元数据由内部元数据日志与投票 quorum 管理。生产集群里，存数据、服务读写的 [Broker](glossary:broker) 与管元数据的[控制器（controller）](glossary:controller)通常分角色部署；而本地学习只需要一个节点，于是把两个角色装进同一个进程——配置文件里一行 `process.roles=broker,controller` 就声明了这种 **combined 模式**。官方 quickstart 对单节点就推荐这种形态；角色分离的集群部署是[第 9 章](/courses/kafka/lessons/kafka-kraft-cluster-deploy)的内容。",
    },
    {
      type: "paragraph",
      text: "本课其余部分你只需要记住三个数字与一个目录：**9092** 是客户端（CLI、Go 程序）接入的端口；**9093** 是 controller 内部通信端口，单机场景无需对外；数据默认写在 `/tmp/kraft-combined-logs`（配置项 `log.dirs`），Kafka 把消息以文件形式存在这里，后面「观察一」会直接 `ls` 它。",
    },
    {
      type: "heading",
      text: "方式一：Docker（推荐，一条命令）",
    },
    {
      type: "paragraph",
      text: "`apache/kafka` 是 Apache 官方发布的镜像（本课按 `4.3.1` 实测，Docker Hub 上该 tag 存在）。镜像的启动脚本替你做了两件事：用内置的**单节点 combined 默认配置**生成 `server.properties`（`process.roles=broker,controller`、通告地址 `PLAINTEXT://localhost:9092`）；若数据目录还没有格式化，就自动格式化（容器内置了一个默认集群 UUID，无需手动生成）。所以对新手最友好的一条命令就是：",
    },
    {
      type: "code",
      title: "启动单节点 Kafka 4.3.1（Docker）",
      language: "bash",
      code: `docker run -d --name kafka -p 9092:9092 apache/kafka:4.3.1

docker logs -f kafka      # 跟随启动日志
# ……看到类似 "Kafka Server started" 的行，说明已就绪……
# Ctrl+C 退出日志跟随（只是不再看日志，容器继续在后台跑）

docker ps                 # 确认容器在运行`,
    },
    {
      type: "paragraph",
      text: "逐项说明：`-d` 让容器在后台运行；`--name kafka` 给容器起名，后续所有 `docker exec kafka ...` 都靠它寻址；`-p 9092:9092` 把容器内的客户端端口发布到宿主机——CLI 和 Go 程序连的都是这个端口；9093（controller 内部端口）只在容器内使用，不需要发布。镜像把 Kafka 发行包装在 `/opt/kafka`，容器内一切文件系统状态（包括消息数据）默认随容器生命周期走：`docker stop kafka` 停、`docker rm kafka` 删，数据即清空——学习够用，生产数据另说。首次运行会自动 `docker pull`，取决于网速稍等片刻即可。",
    },
    {
      type: "heading",
      text: "方式二：官方发行包（tar.gz，备选）",
    },
    {
      type: "paragraph",
      text: "不依赖 Docker 的路线：从 [Kafka 官方下载页](https://kafka.apache.org/downloads) 下载当前稳定版 4.3.1 的二进制包，文件名形如 `kafka_2.13-4.3.1.tgz`（`2.13` 是打包时使用的 Scala 版本号，纯属命名，无需安装 Scala）。这条路要求宿主机有 **JDK 17+**（官方 quickstart 的硬性要求），并且需要手动完成 KRaft 的「格式化」三步：",
    },
    {
      type: "code",
      title: "下载并启动（tar.gz，KRaft 三步）",
      language: "bash",
      code: `tar -xzf kafka_2.13-4.3.1.tgz && cd kafka_2.13-4.3.1

# 1) 生成集群 UUID：一个集群的唯一标识（将来扩容的节点要用同一个）
KAFKA_CLUSTER_ID="$(bin/kafka-storage.sh random-uuid)"
echo "$KAFKA_CLUSTER_ID"          # 例如 nav0oADgT3CSL0FnbX6JuQ

# 2) 格式化数据目录：把 log.dirs 初始化为"属于这个集群"的存储
bin/kafka-storage.sh format --standalone -t "$KAFKA_CLUSTER_ID" -c config/server.properties

# 3) 前台启动：日志直接打在当前终端，Ctrl+C 即停止
bin/kafka-server-start.sh config/server.properties`,
    },
    {
      type: "paragraph",
      text: "注意 4.3 的默认配置文件路径是 **`config/server.properties`**（combined 单节点配置，`process.roles=broker,controller`、`log.dirs=/tmp/kraft-combined-logs` 都在里面），这是官方 quickstart 现在的写法；老教程里常见的 `config/kraft/server.properties` 在 4.x 发行包里已不存在。`--standalone` 是单节点形态的格式化快捷标志（集群形态与更多配置含义见[第 9 章](/courses/kafka/lessons/kafka-kraft-cluster-deploy)）。格式化只需做一次；format 之后，UUID 会写进数据目录的 `meta.properties`——「观察一」里你会亲眼看到它。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "格式化这一步最容易漏",
      body: "tar 方式最常见的启动失败就是「没格式化就 `kafka-server-start`」：broker 找不到已初始化的数据目录，启动即报错退出。记住顺序：`random-uuid` → `format` → `server-start`，且数据目录里已有旧数据时 format 不会覆盖，需要先清空 `log.dirs` 再重来。具体报错形态见文末排障表。",
    },
    {
      type: "heading",
      text: "统一起跑线：CLI 前缀",
    },
    {
      type: "paragraph",
      text: "两种方式启动的是同一个 Kafka 4.3.1，管理工具也是同一套——发行包 `bin/` 目录下的 `kafka-*.sh`。差别只在「从哪里执行」：tar 方式在解压目录内直接 `bin/kafka-topics.sh`；Docker 方式容器内路径为 `/opt/kafka/bin/...`，需要用 `docker exec` 进入执行。为让下文命令保持简短，先定义一个 shell 函数（仅当前终端会话有效）：",
    },
    {
      type: "code",
      title: "定义 kcli：两种方式的统一前缀",
      language: "bash",
      code: `# Docker 方式（容器名 kafka，对应上面的 docker run --name kafka）
kcli() { docker exec -it kafka /opt/kafka/bin/"$@"; }

# tar 方式：注释掉上面那行，改用这行（前提：当前目录在解压目录内）
# kcli() { bin/"$@"; }`,
    },
    {
      type: "paragraph",
      text: "下文所有 CLI 示例统一写作 `kcli kafka-xxx.sh ...`，两种方式命令内容完全一致、输出也一致。Windows 提示：本课命令在 Git Bash / WSL 里执行最顺；tar 方式也可以直接使用发行包 `bin/windows/` 下的同名 `.bat`（参数相同），Docker 方式则无所谓宿主机系统。",
    },
    {
      type: "heading",
      text: "第一步：创建主题",
    },
    {
      type: "code",
      title: "创建 orders.events（3 个分区，单副本）",
      language: "bash",
      code: `kcli kafka-topics.sh --create \\
  --topic orders.events \\
  --partitions 3 \\
  --replication-factor 1 \\
  --bootstrap-server localhost:9092`,
    },
    {
      type: "paragraph",
      text: "参数含义：`--topic` 主题名（沿用书舟共享场景的 `orders.events`）；`--partitions 3` 把主题切成 3 个[分区](glossary:partition)——分区是并行与顺序的边界，数量在创建时定死。本课演示用 3 个即可；书舟生产的设计值是 12（`orders.events`）/ 24（`user.behavior`），怎么推出来的、以及为什么只能增不能减，第 2 章 [主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys) 专门讲；`--replication-factor 1` 副本数——单节点只能填 1，副本是「多存几份防宕机」的手段，需要多个 [Broker](glossary:broker) 才有意义（第 2 章 [副本与 ISR](/courses/kafka/lessons/kafka-replication-isr)）；`--bootstrap-server localhost:9092` 集群入口地址，所有 CLI 都要带它。",
    },
    {
      type: "code",
      title: "真实输出（Kafka 4.3.1）",
      language: "text",
      code: `Created topic orders.events.

# 若终端里还出现下面这行 WARNING，属正常提示：
# WARNING: Due to limitations in metric names, topics with a period ('.') or
# underscore ('_') could collide. To avoid issues it is best to use either,
# but not both.`,
    },
    {
      type: "callout",
      variant: "note",
      title: "主题名里的点号",
      body: "书舟的主题名（`orders.events`、`user.behavior` 等）都带点号。4.3 创建这类主题时会提示一条 WARNING：点号与下划线会让某些指标名（JMX 指标把点号视作层级分隔）难以区分。这只是监控命名层面的提醒，不影响功能，业界大量生产主题照样用点号命名。",
    },
    {
      type: "heading",
      text: "体检：describe 输出里每一列是什么",
    },
    {
      type: "code",
      title: "查看主题详情",
      language: "bash",
      code: `kcli kafka-topics.sh --describe \\
  --topic orders.events \\
  --bootstrap-server localhost:9092`,
    },
    {
      type: "code",
      title: "真实输出（Kafka 4.3.1，单节点）",
      language: "text",
      code: `Topic: orders.events	TopicId: 70JexIroSPu7WX4C_obxZw	PartitionCount: 3	ReplicationFactor: 1	Configs: min.insync.replicas=1,segment.bytes=1073741824
	Topic: orders.events	Partition: 0	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr: 
	Topic: orders.events	Partition: 1	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr: 
	Topic: orders.events	Partition: 2	Leader: 1	Replicas: 1	Isr: 1	Elr: 	LastKnownElr: `,
    },
    {
      type: "paragraph",
      text: "第一行是主题级信息：`TopicId` 是 4.x 为每个主题分配的内部唯一 ID；`PartitionCount` 分区总数；`ReplicationFactor` 副本数；`Configs` 列列出记录在主题上的配置（可能为空，也可能像本例这样显示几项本机默认值，取决于你的环境）。**每个分区单独占一行**（本例 3 行），逐列含义：",
    },
    {
      type: "table",
      caption: "describe 输出字段（单节点语境）",
      headers: ["字段", "含义", "本课例子为什么是 1"],
      rows: [
        ["`Partition`", "分区编号，0 起", "0 / 1 / 2 三个分区"],
        ["`Leader`", "当前服务该分区读写请求的[副本](glossary:replica)所在 broker 节点 id", "唯一节点（id=1）；leader 负责读写，follower 只同步"],
        ["`Replicas`", "该分区的全部副本分布在哪些节点", "只有节点 1，因为 replication.factor=1"],
        ["`Isr`", "与 leader 保持同步的副本集合（In-Sync Replicas）", "只有自己，自然同步；单节点没有「落后的副本」概念"],
        ["`Elr` / `LastKnownElr`", "较新版本追加的空列（与选举资格相关）", "本课忽略，第 9 章集群章节再提"],
      ],
    },
    {
      type: "paragraph",
      text: "`Leader` 的数值 = 节点 id：发行包默认配置 `node.id=1`，所以是 1；不同环境（某些镜像或改过配置）可能是 0——以你机器上的实际输出为准。`Leader`、`Replicas`、`Isr` 三个数在单节点上必然相等（都只有你自己），等第 9 章起了真集群，三者才会出现差异，而「Isr 比 Replicas 少」正是副本落后的信号。",
    },
    {
      type: "heading",
      text: "发消息：控制台生产者 + key",
    },
    {
      type: "paragraph",
      text: "控制台生产者把「终端里输入的每一行」当作一条消息发出去。默认整行都是 value；我们要发带 key 的消息（key 决定分区，是书舟按 `order_id` 组织订单事件的基础），所以打开两个配置项：`parse.key=true`（解析 key）与 `key.separator=:`（key 与 value 之间用第一个冒号分隔）。4.3 里这两个选项用 `--reader-property` 传入——旧写法 `--property` 已被弃用，在 4.3 中使用会打印一行弃用警告：",
    },
    {
      type: "code",
      title: "交互式发送两条带 key 的订单事件",
      language: "bash",
      code: `kcli kafka-console-producer.sh \\
  --topic orders.events \\
  --bootstrap-server localhost:9092 \\
  --reader-property parse.key=true \\
  --reader-property key.separator=:

# 出现 > 提示符后逐行输入（回车即发送一条），最后 Ctrl+C 结束：
>20260908-000123:{"orderId":"20260908-000123","event":"order.created","amount":5900,"at":"2026-09-08T10:00:00Z"}
>20260908-000124:{"orderId":"20260908-000124","event":"order.created","amount":12800,"at":"2026-09-08T10:00:01Z"}`,
    },
    {
      type: "paragraph",
      text: "每行的格式是 `key:value`：第一个冒号之前是 key（这里就是订单号 `20260908-000123`），冒号之后整段是 value——value 里即使还有冒号（JSON 里很多）也不会被误切，因为分隔只发生在第一个分隔符处。**同 key 的消息永远进同一分区**，这是后面所有「按订单聚合」逻辑的基石；不同 key 会被哈希到不同分区。终端没有任何回显就表示每条都已成功发出；如果 broker 拒绝了某条，会打印错误堆栈。发完可以留着这个终端，后面「观察二」还要继续发。",
    },
    {
      type: "heading",
      text: "读消息：控制台消费者",
    },
    {
      type: "code",
      title: "从头消费 orders.events",
      language: "bash",
      code: `# 新开一个终端（记得先执行上面的 kcli 定义）
kcli kafka-console-consumer.sh \\
  --topic orders.events \\
  --from-beginning \\
  --bootstrap-server localhost:9092`,
    },
    {
      type: "paragraph",
      text: "`--from-beginning` 的意思是：从该分区**最早可读的消息**开始读（等价于把 `auto.offset.reset` 设为 `earliest`；不带它时控制台消费者默认只看「之后才来的新消息」，即 `latest`——这是工具自身的默认值，4.3.1 源码如此）。消息是按分区连续打印的 value，Ctrl+C 退出。真实输出（4.3.1 实测）：",
    },
    {
      type: "code",
      title: "真实输出（value 为 JSON，键值未开启打印）",
      language: "text",
      code: `{"orderId":"20260908-000124","event":"order.created","amount":12800,"at":"2026-09-08T10:00:01Z"}
{"orderId":"20260908-000123","event":"order.created","amount":5900,"at":"2026-09-08T10:00:00Z"}
Processed a total of 2 messages`,
    },
    {
      type: "callout",
      variant: "note",
      title: "两条提示性输出",
      body: "首次运行你还会在 stderr 看到两行：`The consumer rebalance protocol (KIP-848) is production-ready! ...` 是 4.x 的提示（新组协议已可用但默认仍走经典协议，第 4 章讲）；`Processed a total of N messages` 是消费者退出前打印的统计。另注意：上面两条消息的打印顺序与发送顺序相反——它们落在了**不同分区**，而控制台消费者按分区输出。**跨分区没有全局顺序**，这正是分区心智模型的第一课（第 2 章展开）。",
    },
    {
      type: "paragraph",
      text: "想看 key 与分区归属，给消费者加 `--formatter-property`（这也是 4.3 相对旧写法 `--property` 的新名字）：",
    },
    {
      type: "code",
      title: "打印 partition / offset / key / value",
      language: "bash",
      code: `kcli kafka-console-consumer.sh \\
  --topic orders.events \\
  --from-beginning \\
  --bootstrap-server localhost:9092 \\
  --formatter-property print.partition=true \\
  --formatter-property print.offset=true \\
  --formatter-property print.key=true`,
    },
    {
      type: "code",
      title: "真实输出（4.3.1 实测，节选）",
      language: "text",
      code: `Partition:0	Offset:0	20260908-000124	{"orderId":"20260908-000124","event":"order.created","amount":12800,"at":"2026-09-08T10:00:01Z"}
Partition:2	Offset:0	20260908-000123	{"orderId":"20260908-000123","event":"order.created","amount":5900,"at":"2026-09-08T10:00:00Z"}`,
    },
    {
      type: "paragraph",
      text: "现在你能直接看到三件事：key 出现在输出里；每条消息带 `Partition` 与 `Offset` 两个坐标——**offset 是分区内从 0 起的递增序号**（本例两条消息各自是所在分区的第 0 条，所以都是 0）；key 决定分区——`000123` 与 `000124` 是不同 key，被哈希到了不同的分区。**同一个 key 的所有消息总是进同一分区、offset 连续递增**，这条规律马上会在[下一课的 Go 程序](/courses/kafka/lessons/kafka-go-client-hello)里用同一个订单号连发两条来验证；而下面「观察二」追加的两条不同 key（`000125`、`000126`）恰好撞进了同一分区——记住：不同 key 可能同区，同一 key 绝不会跨区。",
    },
    {
      type: "heading",
      text: "观察一：消息真的落成了文件",
    },
    {
      type: "paragraph",
      text: "打开第三个终端，看一眼 Kafka 的数据目录（默认 `log.dirs=/tmp/kraft-combined-logs`；Docker 方式数据在容器内，加 `docker exec` 前缀即可）：",
    },
    {
      type: "code",
      title: "查看数据目录",
      language: "bash",
      code: `# tar 方式
ls /tmp/kraft-combined-logs | grep -E 'orders|__cluster|__consumer|meta'

# Docker 方式
docker exec kafka ls /tmp/kraft-combined-logs | grep -E 'orders|__cluster|__consumer|meta'`,
    },
    {
      type: "code",
      title: "真实输出（节选，__consumer_offsets 有 50 个分区目录）",
      language: "text",
      code: `__cluster_metadata-0          # KRaft 元数据日志（主题、分区、节点等元数据的落盘处）
__consumer_offsets-0          # 消费组提交的偏移量就存在这类目录里（共 50 个）
__consumer_offsets-1
…
meta.properties               # 集群身份：cluster.id（就是 format 时给的那个 UUID）、node.id
orders.events-0               # 我们自己建的主题：每个 topic-分区 一个目录
orders.events-1
orders.events-2`,
    },
    {
      type: "paragraph",
      text: "`orders.events-0/1/2` 三个目录对应主题的三个[分区](glossary:partition)——分区不是抽象概念，它就是一个（组）日志目录。消息就存在目录里的 `.log` 段文件中（所以叫[提交日志（commit log）](glossary:commit-log)模型）；`__consumer_offsets-*` 是 broker 的内部主题，用来保存每个[消费组](glossary:consumer-group)的读取位置；`meta.properties` 里写着集群 UUID——回去对照你 `random-uuid` 生成的值，一模一样。文件如何切段、何时清理由保留策略决定，那是[第 2 章存储课](/courses/kafka/lessons/kafka-storage-segments-retention)的内容。",
    },
    {
      type: "heading",
      text: "观察二：消费位置被记住了吗",
    },
    {
      type: "paragraph",
      text: "上面无组消费时，每次 `--from-beginning` 都会从头把消息再读一遍——因为**没有消费组就没有被记录的位置**。现在给消费者挂一个组，验证位置确实被 broker 记住了。先停掉上一个消费者，然后：",
    },
    {
      type: "code",
      title: "带消费组第一次运行：组无历史位置，从最早开始读",
      language: "bash",
      code: `kcli kafka-console-consumer.sh \\
  --topic orders.events \\
  --bootstrap-server localhost:9092 \\
  --group orders-demo \\
  --from-beginning

# 打印出已有消息后，多等几秒再 Ctrl+C（让自动提交发生一次），重启的效果最干净`,
    },
    {
      type: "paragraph",
      text: "回到生产者终端，再发两条新消息（换个订单号）：",
    },
    {
      type: "code",
      title: "追加两条",
      language: "bash",
      code: `>20260908-000125:{"orderId":"20260908-000125","event":"order.created","amount":3500,"at":"2026-09-08T10:05:00Z"}
>20260908-000126:{"orderId":"20260908-000126","event":"order.created","amount":21900,"at":"2026-09-08T10:05:01Z"}`,
    },
    {
      type: "paragraph",
      text: "然后重启消费者，**这次不带** `--from-beginning`：",
    },
    {
      type: "code",
      title: "同一消费组重启：只读到新增的两条",
      language: "bash",
      code: `kcli kafka-console-consumer.sh \\
  --topic orders.events \\
  --bootstrap-server localhost:9092 \\
  --group orders-demo

# 只有 000125 / 000126 两条新消息被打印，旧消息不再重复`,
    },
    {
      type: "code",
      title: "真实输出（4.3.1 实测，节选）",
      language: "text",
      code: `{"orderId":"20260908-000125","event":"order.created","amount":3500,"at":"2026-09-08T10:05:00Z"}
{"orderId":"20260908-000126","event":"order.created","amount":21900,"at":"2026-09-08T10:05:01Z"}
Processed a total of 2 messages`,
    },
    {
      type: "paragraph",
      text: "两次运行用的是同一个组名 `orders-demo`，第二次却只读到新增消息——说明第一次消费到的位置被记录了下来。这个位置由 broker 的[组协调器](glossary:coordinator)负责接收与保存（就存在刚才数据目录里的 `__consumer_offsets` 主题中），消费者侧默认**自动提交**（开启、秒级节奏）：每读到一批消息，位置就按提交节奏往前挪。位置以「下一条要读的 offset」为语义：某分区已提交位置是 41，表示 0–40 已消费，重启后从 41 读起。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "偶尔看到最后几条重复，不是 bug",
      body: "自动提交是周期性的，如果在两次提交之间杀掉消费者，最后几秒消费到的消息可能还没提交，重启后会被再读一遍。这是「至少一次」语义的来源，也是第 4 章的主题（[拉取模型、位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)会讲透提交窗口与手动提交）。本课你只需要形成印象：**消费位置是组自己的进度，提交时机决定重启后从哪继续、会不会重复**。",
    },
    {
      type: "paragraph",
      text: "组的进度可以用 `kafka-consumer-groups.sh` 查。等消费者退出（Ctrl+C）后执行：",
    },
    {
      type: "code",
      title: "查看消费组的滞后情况",
      language: "bash",
      code: `kcli kafka-consumer-groups.sh \\
  --bootstrap-server localhost:9092 \\
  --describe \\
  --group orders-demo`,
    },
    {
      type: "code",
      title: "真实输出（4.3.1 实测，消费者已退出）",
      language: "text",
      code: `Consumer group 'orders-demo' has no active members.

GROUP         TOPIC          PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CONSUMER-ID  HOST  CLIENT-ID
orders-demo   orders.events  0          1               1               0    -            -     -
orders-demo   orders.events  1          2               2               0    -            -     -
orders-demo   orders.events  2          1               1               0    -            -     -`,
    },
    {
      type: "paragraph",
      text: "逐列含义：`CURRENT-OFFSET` 该组在此分区已提交的位置（下一条要读的序号）；`LOG-END-OFFSET` 分区里现有的最后一条的下一个序号；二者之差就是[消费滞后（lag）](glossary:lag)。上面的 `LAG` 全为 0，表示这个组已经把能读的都读完了；`CONSUMER-ID/HOST/CLIENT-ID` 显示 `-` 是因为组里当前没有在线成员（消费者已退出）。lag 是生产环境最重要的健康指标之一：它持续增长意味着消费跟不上生产——第 4 章与第 9 章都会回到它。",
    },
    {
      type: "heading",
      text: "排障：启动失败与连不上的常见原因",
    },
    {
      type: "table",
      caption: "高频问题速查（症状 → 原因 → 处理）",
      headers: ["症状", "原因", "处理"],
      rows: [
        ["Docker 起不来，报 `bind: address already in use`；tar 启动后立刻退出、日志见 `Address already in use`", "9092 端口已被占用（通常是上一个 Kafka 实例没停干净）", "`docker ps` 看是否有旧容器（`docker rm -f` 它）；或 `netstat -ano | grep 9092` 找到占用进程并结束；或干脆换端口（如 `-p 29092:9092`，后续所有 `--bootstrap-server` 同步改成 `localhost:29092`）"],
        ["tar 方式启动即失败，日志提示数据目录未格式化（找不到格式化的存储/无 cluster id）", "漏了 `kafka-storage.sh format`，或数据目录残留了旧数据", "停掉进程；清空 `log.dirs` 目录后重新执行 random-uuid → format → server-start"],
        ["bin 脚本报找不到 java / `JAVA_HOME` 相关错误", "宿主机的 JDK 缺失或版本低于 17", "安装 JDK 17+ 并设置 `JAVA_HOME`（脚本靠它定位 java），`java -version` 确认后再启动"],
        ["CLI 执行后长时间无响应或报连接被拒/超时", "broker 还没就绪，或 `--bootstrap-server` 地址端口不对", "先 `docker logs -f kafka` 确认出现 `Kafka Server started` 再跑 CLI；核对端口与 `-p` 映射一致"],
        ["容器外连不上，或换台机器就连接超时", "客户端连接的是 broker「通告（advertised）的地址」，默认 `localhost:9092` 只在本机成立", "本地学习无需处理；若 broker 在远程机/虚拟机/别的容器里，用环境变量 `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://<对端可达地址>:9092` 重启容器（命名规则：`KAFKA_` 前缀 + 配置名大写、`.` 换成 `_`）"],
      ],
    },
    {
      type: "heading",
      text: "小结与下一步",
    },
    {
      type: "keypoints",
      items: [
        "Kafka 4.x 无 ZooKeeper（[KRaft](glossary:kraft) 唯一模式）；本地单节点 = combined 模式：`process.roles=broker,controller` 一个进程两角色，生产分离部署见第 9 章",
        "Docker 一条命令：`docker run -d --name kafka -p 9092:9092 apache/kafka:4.3.1`（内置默认 combined 配置 + 自动格式化）；tar 包三步：`random-uuid` → `format --standalone -t <uuid> -c config/server.properties` → `kafka-server-start.sh config/server.properties`（需 JDK 17+）",
        "CLI 都在发行包 `bin/`：Docker 里是 `/opt/kafka/bin`，用 `kcli() { docker exec -it kafka /opt/kafka/bin/\"$@\"; }` 统一前缀",
        "`--create --partitions 3 --replication-factor 1` 分区数创建时定死；`--describe` 输出 Leader/Replicas/Isr，单节点三者相同",
        "控制台生产者带 key：`--reader-property parse.key=true --reader-property key.separator=:`（`--property` 在 4.3 已弃用）；value 里多余的冒号不受影响",
        "消息按 `topic-分区` 目录落盘（`/tmp/kraft-combined-logs`）；组的位置由 broker 存在内部主题 `__consumer_offsets`，自动提交默认开启",
        "不带组 = 位置不记录，`--from-beginning` 每次重读；带组重启从已提交位置继续，偶见末尾重复是提交时机所致——第 4 章讲透",
      ],
    },
    {
      type: "paragraph",
      text: "**先别关 broker**——下一课[用 franz-go 写第一个 Go 生产者与消费者](/courses/kafka/lessons/kafka-go-client-hello)时还要连它。我们刚用 CLI 验证过的三件事（key 决定分区、offset 递增、组位置被记录），马上会在代码里以 API 的形态再次出现。",
    },
    {
      type: "quiz",
      question:
        "你用 `--group orders-demo` 的消费者把某分区消费到 offset 41（即 0–40 已读并提交），Ctrl+C 退出。之后 CLI 向该分区写入 1 条。重启同一个组、不带 --from-beginning 的消费者，会发生什么？",
      options: [
        "从提交位置 41 继续，读到刚写入的那一条（它落在 offset 41）",
        "从头（offset 0）把所有消息再读一遍",
        "直接跳到最新位置，只等 41 之后才到达的新消息",
        "启动即报错：消费组 orders-demo 已存在",
      ],
      answer: 0,
      explanation:
        "组在 broker 里保存的是「已提交位置」：语义为下一条要读的 offset。位置已提交到 41，说明 0–40 都已读过，此时日志末端也是 41，所以新写入的一条落在 offset 41；重启后从提交位置 41 继续，正好读到它。41 之前的消息虽然还在日志里（可随时用 --from-beginning 或重置位置重放），但不会自动重读。若最后一批消息还没来得及提交就被杀掉，才会出现少量重复——那是提交时机问题，不是位置语义问题。",
    },
  ],
};
