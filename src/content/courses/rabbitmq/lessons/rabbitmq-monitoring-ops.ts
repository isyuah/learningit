/* ==================================================================
 * 课时：监控、告警与日常运维（rabbitmq-monitoring-ops）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 版本边界：RabbitMQ 4.x（主线 4.3，LTS 4.2）。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "rabbitmq-monitoring-ops",
  courseSlug: "rabbitmq",
  title: "监控、告警与日常运维",
  summary: "用指标、健康检查、管理 API 与 definitions 掌握集群的日常观察、排障与变更流程。",
  minutes: 26,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "消息队列是业务的「血管」：订单服务发布、支付/库存/通知服务消费。它出问题时通常不是进程死了那么简单——可能是队列越堆越高、消费者悄悄跟不上、内存告警把生产者全部卡住。这一节把 RabbitMQ 的观测手段串起来：看哪些指标、用什么命令与 API、怎么做健康检查、怎么把拓扑定义备份与恢复，以及重启、升级、扩容的常见流程。",
    },
    {
      type: "heading",
      text: "要盯哪些指标",
    },
    {
      type: "paragraph",
      text: "监控分三层：基础设施层（CPU、内存、磁盘 IO、网络、文件描述符）、RabbitMQ 节点层、队列与应用层。RabbitMQ 自己暴露的指标中最常被盯的是：队列深度（messages_ready）、未确认消息数（messages_unacknowledged）、连接数、信道数、内存使用与水位、磁盘剩余与水位、发布/投递速率。unacked 尤其值得单独盯——它是「消息被消费但没处理完」的量，如果长期上涨，说明消费者卡住或处理变慢，而队列深度还没开始涨。",
    },
    {
      type: "list",
      items: [
        "队列深度 messages_ready：ready 上涨 = 生产快于消费（背压信号）。",
        "未确认 messages_unacknowledged：unacked 上涨 = 消费者拿走了但处理不完/不 ack。",
        "连接数与信道数：异常突增通常是连接泄漏或客户端重连风暴。",
        "内存 mem_used 与 mem_limit、磁盘 disk_free 与 disk_free_limit：触达水位会触发告警并阻塞生产者。",
        "发布/投递速率 message_stats.publish / deliver_get：观察吞吐与趋势。",
        "文件描述符 fd_used/fd_total：接近上限时节点开始拒绝新连接。",
      ],
    },
    {
      type: "heading",
      text: "Prometheus 与管理插件：两条观测通道",
    },
    {
      type: "paragraph",
      text: "官方推荐的生产监控组合是 Prometheus + Grafana：内置插件 `rabbitmq_prometheus` 在 15692 端口暴露 `/metrics`，抓取开销低、适合长期存储。管理插件（`rabbitmq_management`）提供 15672 端口的 HTTP API 与 UI，方便开发环境与人工排障，但它有显著局限：监控与被监控系统耦合、内存开销更大、只保留短期数据。两条通道可以并存，但生产采集应以 Prometheus 为主。",
    },
    {
      type: "code",
      title: "启用插件并抓取指标",
      language: "bash",
      code: `# 启用 Prometheus 指标插件（生产推荐）
rabbitmq-plugins enable rabbitmq_prometheus

# 抓取指标（默认端口 15692）
curl -s http://localhost:15692/metrics | head

# 管理插件（开发/人工排障用，端口 15672）
rabbitmq-plugins enable rabbitmq_management

# 管理 API：集群概览（Basic Auth）
curl -s -u username:password http://localhost:15672/api/overview | jq '.queue_totals'

# 管理 API：节点内存告警状态
curl -s -u username:password http://localhost:15672/api/nodes/rabbit@localhost | jq '.mem_alarm'`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "监控频率与抓取开销",
      body: "生产采集间隔推荐 30~60 秒；开发环境也别低于 5 秒。抓取太频繁（尤其管理 API 那种「为了一个指标拉全量队列」的抓法）会显著增加节点 CPU 与内存。管理插件的采集进程（如 `rabbit_mgmt_db_cache_connections`、`queue_metrics_metrics_collector`）在 `rabbitmq-diagnostics observer` 里居高不下时，就是监控开销过大的信号。Kubernetes 上官方 Operator 已内置 Prometheus 暴露与 TCP 就绪探针，不必自建。",
    },
    {
      type: "heading",
      text: "健康检查：从 ping 到多数派检查",
    },
    {
      type: "paragraph",
      text: "健康检查是「对状态做断言」的命令，应按层级组合使用。最基础的是 `rabbitmq-diagnostics ping`（运行时存活，几乎无假阳性）；再往上是 `status`（取系统信息）、`check_running` + `check_local_alarms`（应用在跑且无本地告警）、`check_port_connectivity`（监听端口可达）、`check_virtual_hosts`（vhost 无故障）。做升级/重启这类可能压垮多数派的操作前，还要跑 `check_if_node_is_quorum_critical`：如果目标节点关机会让任何 Quorum 队列或 Stream 失去在线多数派，它会非零退出并列出受影响组件。",
    },
    {
      type: "code",
      title: "组合健康检查（shell）",
      language: "bash",
      code: `# 第 1 层：运行时存活
rabbitmq-diagnostics -q ping

# 第 2 层：应用在跑 + 无本地资源告警
rabbitmq-diagnostics -q check_running && rabbitmq-diagnostics -q check_local_alarms

# 第 3 层：监听端口连通性
rabbitmq-diagnostics -q check_port_connectivity --address 127.0.0.1

# 维护前：关掉此节点会不会让任何队列/Stream 失去多数派？
rabbitmq-diagnostics check_if_node_is_quorum_critical

# 升级流程中：阻塞直到在线节点足以维持多数派 + 1
rabbitmq-upgrade await_online_quorum_plus_one`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "别再用过时的 node_health_check",
      body: "老文档里的 `rabbitmq-diagnostics node_health_check` 早已废弃：它强制系统里每个连接、队列、信道都产出指标，开销极大、假阳性高，现代版本中只是 no-op。不要把它当就绪探针用。K8s 上推荐的就绪探针是 AMQP 端口 TCP 检查（Operator 默认如此），而不是 CLI 健康检查——CLI 每次都要加入 Erlang 分布，高频调用本身就有开销。",
    },
    {
      type: "heading",
      text: "日志、审计与 definitions 导出导入",
    },
    {
      type: "paragraph",
      text: "日志与指标互补：连接拒绝、认证失败、分区检测、leader 选举、告警触发都会写日志。生产环境应把多节点日志统一收集（ELK 等）。审计层面，管理 API 与 rabbitmqctl 的变更记录有限，更可靠的审计手段是：权限模型收敛（见安全课时）+ 从 definitions 文件版本化地管理拓扑。definitions 是节点/集群全部元数据（用户、vhost、交换机、队列、绑定、策略、运行时参数）的 JSON 导出，是「拓扑备份」与「新环境播种」的标准手段。",
    },
    {
      type: "code",
      title: "definitions 导出与导入",
      language: "bash",
      code: `# 导出全部定义（不需要管理插件）
rabbitmqctl export_definitions /backup/defs-$(date +%F).json

# 导入
rabbitmqctl import_definitions /backup/defs-2026-09-01.json

# 启动时自动导入（rabbitmq.conf）：
#   definitions.import_backend = local_filesystem
#   definitions.local.path = /etc/rabbitmq/defs.json
#   definitions.skip_if_unchanged = true

# 注意：导出文件含密码哈希，属敏感信息，须按密文对待`,
    },
    {
      type: "heading",
      text: "常见运维流程：重启、升级、扩容",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "重启单个节点：`rabbitmqctl stop_app` → 维护/升级 → `rabbitmqctl start_app`；重启前先确认不会破坏任何 Raft 组件的多数派。",
        "滚动升级：逐节点 stop → 升级 RabbitMQ/Erlang → start → 观察监控；升级前确认所有 stable feature flags 已启用、无告警、无复制同步进行中。升级路径受版本约束：3.13 → 4.2 → 4.3（不能从 3.13 直跳 4.3；3.13 若启用了 Khepri 实验支持则不能原地升级到 4.x，需蓝绿）。",
        "扩容：`rabbitmqctl stop_app` → `join_cluster rabbit@<seed>` → `start_app`；新节点默认不承载任何 Quorum 队列成员/Stream 副本，需要时用 `rabbitmq-queues grow <node> all` 或显式 add_member 把队列成员放上去，再用 `rabbitmq-queues rebalance all` 均衡 leader。",
        "下线节点：先把该节点上的队列成员/副本迁走（grow 到新节点再 shrink），再 `rabbitmqctl forget_cluster_node` 永久移除，避免成员残留导致队列失联。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "升级的两个隐藏坑",
      body: "第一，版本跳跃：只有相邻/受支持的路径可以原地升级，跨版本升级会失败或损坏数据；升级前务必对照官方版本可升级表。第二，feature flags：升级到新版本后，新引入的 stable feature flags 需要显式启用（`rabbitmqctl enable_feature_flag <flag>`），且升级前旧版本要求启用的 flag 必须先启用——这一步遗漏是升级失败的常见原因。升级期间 leader 会重选、连接会重连，请预留余量并在低峰执行。",
    },
    {
      type: "keypoints",
      items: [
        "核心指标：队列深度、unacked、连接/信道数、内存与磁盘水位、发布/投递速率、文件描述符。",
        "生产用 Prometheus（15692）采集；管理 API（15672）适合开发与人工排障，注意抓取开销。",
        "健康检查分层组合：ping → check_running+check_local_alarms → check_port_connectivity → check_virtual_hosts → check_if_node_is_quorum_critical。",
        "definitions 是元数据备份与播种的标准手段；导出文件含密码哈希须保密。",
        "重启/升级/扩容都遵循同一原则：不破坏多数派、先检查再操作、逐节点滚动、升级前确认 feature flags 与升级路径。",
      ],
    },
  ],
};
