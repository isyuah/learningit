/* ==================================================================
 * 课时：观测：指标、日志与消费滞后（kafka-monitoring-lag）
 * ----------------------------------------------------------------
 * 一节课 = 一个 Lesson 对象。slug 必须与 course.ts 大纲中的一致。
 * 内容块类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 *
 * 事实核对（2026-09-08）：
 * - 指标 MBean 名称、稳态期望值与语义对照 kafka.apache.org/43/operations/monitoring/
 *   （含 KRaft Quorum/Controller/Broker Monitoring 指标小节）。
 * - kadm 示例代码在 franz-go v1.21.6 + pkg/kadm v1.18.0 下编译并对 4.3.1
 *   集群实测（输出 commit=20 end=27 lag=7 与 CLI 一致）。
 * - 日志文件清单对照 4.3.1 发行包 config/log4j2.yaml 与 kafka-run-class.sh；
 *   日志行样例来自 4.3.1 实测启动日志。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "broker 与 controller 的关键指标清单及精确含义、消费滞后(lag)的定义与三种观测手段（CLI、Go/kadm 自研、客户端侧），以及日志与告警分层的工程方法。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课把集群立了起来：3 台投票 controller、若干 broker、`describe --status` 全绿。但「能启动」和「健康」是两回事——第 5 章[消费失败、重试、死信与幂等消费](/courses/kafka/lessons/kafka-failure-patterns-dlq)结尾埋过一个钩子：失败/重试/死信计数要与[消费滞后](glossary:lag)放在同一张看板上读，指标细节与告警分层留到本章。这一课兑现它：先给你一张**照着实测过的名称写**的指标清单（可用性、资源、KRaft quorum 三组），再把 lag 讲精确，最后是日志文件与告警分层——以及把第 5 章的失败计数和 lag 合并成一条告警规则的完整示例。",
    },
    {
      type: "heading",
      text: "指标从哪里来：JMX 与采集链",
    },
    {
      type: "paragraph",
      text: "Kafka 服务端（broker/controller）用 Yammer Metrics 暴露指标，Java 客户端用 Kafka Metrics，两者都通过 JMX 提供，也都能接可插拔的 reporter。默认情况下 **JMX 只对本机开放**（远程 JMX 默认关闭）——需要远程采集时通过 `JMX_PORT` 环境变量开启，并且生产环境必须用 `KAFKA_JMX_OPTS` 覆盖默认（JMX 默认无认证，裸奔到网络上等于把集群控制权交给别人）。最常见的落地形态是 Prometheus JMX exporter 之类的 agent 随进程启动、把 JMX 转成指标端点，再进监控系统。本课所有指标名都按官方文档写成 **JMX MBean 名**（如 `kafka.server:type=BrokerTopicMetrics,name=BytesInPerSec`）——这是文档与各类采集器共同的坐标系，翻译成你用的采集器的名字时一一对应即可。",
    },
    {
      type: "heading",
      text: "第一组指标：分区与副本健康（数据在不在、全不全）",
    },
    {
      type: "paragraph",
      text: "这一组回答「数据面的冗余是否完好」。它的核心思路在[第 2 章副本与 ISR](/courses/kafka/lessons/kafka-replication-isr)就建立过：[ISR](glossary:isr) 是同步副本集合，任何「ISR 缩水、少于应有副本」都是正在丢失冗余的信号。官方监控文档把这张表列为「我们实际会画图并告警的指标」，正常值一栏几乎全是 0：",
    },
    {
      type: "table",
      caption: "分区与副本健康指标（名称/语义按 4.3 官方 monitoring 页）",
      headers: ["指标（JMX MBean）", "精确含义", "正常", "告警思路"],
      rows: [
        ["`kafka.controller:type=KafkaController,name=OfflinePartitionsCount`", "当前没有可用 leader 的分区数（controller 视角）", "0", "非 0 即分区不可用（最高优先级），持续数分钟直接 P1"],
        ["`kafka.server:type=ReplicaManager,name=UnderReplicatedPartitions`", "ISR 数 < 副本总数（含 leader 自身）的分区数", "0", "非 0 持续 = 有副本追不上，冗余正在缩水"],
        ["`kafka.server:type=ReplicaManager,name=UnderMinIsrPartitionCount`", "ISR 数 < `min.insync.replicas` 的分区数（[min-insync](glossary:min-insync)）", "0", "非 0 = acks=all 的写入随时会被拒，离「拒写保不丢」只差一步"],
        ["`kafka.server:type=ReplicaManager,name=AtMinIsrPartitionCount`", "ISR 数恰好等于 minISR 的分区数（擦边运行）", "0", "上升 = 冗余余量耗尽的前兆"],
        ["`kafka.server:type=ReplicaManager,name=IsrShrinksPerSec` / `IsrExpandsPerSec`", "ISR 收缩 / 扩张速率（次/秒）", "平稳期 0", "成对尖峰 = 节点宕机又恢复；只缩不扩 = 有副本一直回不来"],
        ["`kafka.controller:type=ControllerStats,name=UncleanLeaderElectionsPerSec`", "由非 ISR 副本当选 leader 的速率（[unclean-election](glossary:unclean-election)）", "0", "非 0 = 发生过「可用性换一致性」的选举，意味着可能丢已确认消息"],
        ["`kafka.log:type=LogManager,name=OfflineLogDirectoryCount`", "坏掉/不可写的日志目录数", "0", "非 0 = 某块磁盘出问题，该盘分区会陆续下线"],
      ],
    },
    {
      type: "paragraph",
      text: "阅读口诀：**UnderReplicatedPartitions 看冗余在缩，UnderMinIsr 看写入快被拒，OfflinePartitions 看分区已不可用**——三者是同一根轴上的三个刻度。配合看 `LeaderElectionRateAndTimeMs`（`kafka.controller:type=ControllerStats`，broker 故障时非零）能确认缩水是否由一次节点宕机引起。",
    },
    {
      type: "heading",
      text: "第二组指标：请求处理与资源（broker 忙不忙、卡不卡）",
    },
    {
      type: "table",
      caption: "请求处理资源指标（名称按 4.3 官方 monitoring 页）",
      headers: ["指标（JMX MBean）", "精确含义", "正常 / 用法"],
      rows: [
        ["`kafka.server:type=BrokerTopicMetrics,name=BytesInPerSec` / `BytesOutPerSec`", "客户端流入/流出字节速率；带 `topic=(...)` 属性可看单主题", "跟业务走势走；做基线后看偏离"],
        ["`kafka.server:type=BrokerTopicMetrics,name=ReplicationBytesInPerSec` / `ReplicationBytesOutPerSec`", "broker 之间副本同步的字节速率", "平时平稳；突增常伴随新副本/重平衡"],
        ["`kafka.server:type=BrokerTopicMetrics,name=TotalProduceRequestsPerSec` / `TotalFetchRequestsPerSec`", "Produce / Fetch 请求速率（带 topic 属性可下钻）", "吞吐的请求视角，配字节率看平均批量"],
        ["`kafka.network:type=RequestMetrics,name=ErrorsPerSec,request=...,error=...`", "按请求类型与错误码统计的错误响应速率；`error=NONE` 是成功", "非 NONE 突增指向具体错误码（如 NOT_LEADER、TIMED_OUT）"],
        ["`kafka.network:type=RequestChannel,name=RequestQueueSize`", "等待请求线程处理的请求数", "持续堆积 = IO 线程跟不上"],
        ["`kafka.server:type=KafkaRequestHandlerPool,name=RequestHandlerAvgIdlePercent`", "请求处理线程空闲比例（0~1）", "官方经验：理想 > 0.3；长期贴 0 = 处理线程饱和"],
        ["`kafka.network:type=SocketServer,name=NetworkProcessorAvgIdlePercent`", "网络线程空闲比例（0~1）", "同上，理想 > 0.3；贴 0 = 网络/解析层饱和"],
      ],
    },
    {
      type: "paragraph",
      text: "两个 AvgIdlePercent 是「这台 broker 还剩多少余量」的体温计：任何一个长期趋近 0，都说明对应线程池是瓶颈（是加机器还是调参，是[容量规划与性能调优](/courses/kafka/lessons/kafka-capacity-tuning)课的决策）。注意它们读的是 broker 视角的忙闲，**不代表你的客户端体验**——客户端慢还要看消费滞后与端到端延迟，这正是本课下半场的主题。",
    },
    {
      type: "heading",
      text: "第三组指标：KRaft quorum 与元数据层（4.x 特有）",
    },
    {
      type: "paragraph",
      text: "上一课强调了「元数据层独立于数据面」，观测也得分开：quorum 健康看 raft 指标，controller 活跃看 controller MBean，broker 是否跟上元数据看 broker 侧元数据指标。名称照 4.3 官方 monitoring 页：",
    },
    {
      type: "table",
      caption: "KRaft quorum / controller 指标（4.3 官方 monitoring 页）",
      headers: ["指标", "出处（MBean）", "怎么读"],
      rows: [
        ["Current State / Current Leader / Current Epoch / High Watermark", "`kafka.server:type=raft-metrics`（controller 与 broker 都上报）", "Current State 取值 leader/candidate/voted/follower/unattached/observer；Current Leader 为 -1 说明 quorum 暂无 leader；High Watermark 不再增长 = 元数据提交停滞"],
        ["Append Records Rate / Fetch Records Rate / Average Commit Latency / Average Election Latency", "`kafka.server:type=raft-metrics`", "元数据写入/复制速率与延迟；选举延迟突增 = 投票者之间网络异常"],
        ["Last Applied Record Lag Ms", "broker：`kafka.server:type=broker-metadata-metrics`；controller：`kafka.controller:type=KafkaController,name=LastAppliedRecordLagMs`", "本节点落后元数据日志多久；活跃 controller 该值恒为 0；broker 该值持续变大 = 它跟不上元数据（会表现为「看到了部分主题却看不到另一些」）"],
        ["ActiveControllerCount", "`kafka.controller:type=KafkaController,name=ActiveControllerCount`", "全集群应恰好一台为 1（官方原话：only one broker in the cluster should have 1）；0 = 无活跃 controller"],
        ["TimedOutBrokerHeartbeatCount / FencedBrokerCount / ActiveBrokerCount", "`kafka.controller:type=KafkaController`", "活跃 controller 视角：broker 心跳超时数、被隔离的 broker 数、当前活跃 broker 数；心跳大面积超时 = controller↔broker 网络出问题"],
        ["NewActiveControllersCount", "`kafka.controller:type=KafkaController`", "活跃 controller 换届次数；短时间内多次 +1 = controller 在反复选举（不稳定信号）"],
        ["MetadataErrorCount", "`kafka.controller:type=KafkaController`", "元数据日志处理出错次数，正常 0"],
      ],
    },
    {
      type: "paragraph",
      text: "这套指标在[面试速查：集群、运维与系统设计题](/courses/kafka/lessons/kafka-interview-architecture)里也是高频考点：能把「元数据层 / 数据面」两层指标分开讲，是区分「会查文档」与「真懂 KRaft」的分水岭。",
    },
    {
      type: "heading",
      text: "lag：精确定义，以及一个常被误解的细节",
    },
    {
      type: "paragraph",
      text: "先回到定义：某消费组在某分区上的 [lag](glossary:lag) = **LOG-END-OFFSET − CURRENT-OFFSET**。`LOG-END-OFFSET` 是分区日志末端的下一个序号（broker 侧事实）；`CURRENT-OFFSET` 是**组协调器**里记录的**已提交位置**——语义是「下一条将要读的序号」。注意这里的用词：是「已提交」，不是「已处理」。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "CLI 看到的 lag ≠ 处理落后量",
      body: "消费者处理完一批消息后，位置要等提交动作才落到协调器。franz-go 默认的**安全自动提交**每 5 秒一次、且只提交「上一次 poll 的批次」（详见[拉取模型、位置管理与提交时机](/courses/kafka/lessons/kafka-consumer-poll-commit)）——因此一个完全健康的消费者，用 `--describe` 看也可能长期显示一个小 lag（≈ 最近一个提交周期内处理掉、还没提交的量）。**结论：单个时刻的 lag 值说明不了问题，lag 的走向才说明问题**——持续增长 = 消费跟不上生产；稳定在某个小值 = 只是提交节奏的正常窗口。",
    },
    {
      type: "paragraph",
      text: "另一个精度问题是：lag 是**逐分区**的，跨分区求和（总 lag）会掩盖热点。书舟的 `user.behavior` 有 24 个分区（推导见[主题、分区与键](/courses/kafka/lessons/kafka-topics-partitions-keys)），总 lag 平稳但分区 7 的 lag 单独爬升——那多半是某个网红 `user_id` 的热点 key 把流量压进了单分区，按分区看 lag 才能发现。所以观测的最小单位是 (组, 主题, 分区)，聚合只是给人看的摘要。",
    },
    {
      type: "heading",
      text: "观测手段一：CLI（kafka-consumer-groups --describe）",
    },
    {
      type: "code",
      title: "查看组在某主题上的滞后（4.3；列名与第 1 章 quickstart 完全一致）",
      language: "bash",
      code: `bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 \\
  --describe --group orders.events.consumers

# 输出（示意数值）：
# GROUP                 TOPIC         PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG    CONSUMER-ID  HOST   CLIENT-ID
# orders.events.consumers orders.events 0          120             4500            4380   consumer-1…  /1.2.3.4 consumer-1
# orders.events.consumers orders.events 1          4450            4500            50     consumer-1…  /1.2.3.4 consumer-1
# ……（组无在线成员时 CONSUMER-ID/HOST/CLIENT-ID 显示为 -）`,
    },
    {
      type: "paragraph",
      text: "一眼就能读出「分区 0 落后 4380、分区 1 只落后 50」——这就是上面说的分区视角。工具还有 `--describe --members`（看成员与分配）、`--describe --state`（组状态：Empty/Stable/Rebalancing 等）等子视图；`--list` 列出全部组。CLI 适合人肉排查；长期盯守要靠下面两种自动化手段。",
    },
    {
      type: "heading",
      text: "观测手段二：自己写 Go 采集（kadm）",
    },
    {
      type: "paragraph",
      text: "把 lag 变成指标（然后才能告警）需要一个可嵌入的采集器。franz-go 的 admin 客户端在 `pkg/kadm` 模块里：`kadm.NewClient(kgoClient)` 复用同一个 kgo 连接，`Lag(ctx, groups...)` 一次调用替你完成「描述组 → 取已提交位移 → 列日志末端 → 求差」多步请求。下面这个程序我在 4.3.1 集群上实测过，对某个组输出的 `commit/end/lag` 与 CLI 完全一致：",
    },
    {
      type: "code",
      title: "lagwatch：每 30 秒打印各组的逐分区 lag（franz-go v1.21 + kadm v1.18，实测可运行）",
      language: "go",
      code: `// go.mod 需要：
//   require github.com/twmb/franz-go v1.21.6
//   require github.com/twmb/franz-go/pkg/kadm v1.18.0
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"
)

func main() {
	if len(os.Args) < 3 {
		log.Fatalf("usage: %s <broker> <group> [group...]", os.Args[0])
	}
	brokers, groups := os.Args[1], os.Args[2:]

	cl, err := kgo.NewClient(kgo.SeedBrokers(brokers))
	if err != nil {
		log.Fatal(err)
	}
	defer cl.Close()
	adm := kadm.NewClient(cl) // admin 客户端，复用同一连接

	for {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)

		// Lag 返回 map：组名 -> 组的逐分区滞后。一次可传多个组。
		lags, err := adm.Lag(ctx, groups...)
		if err != nil {
			log.Printf("lag query error: %v", err)
		} else {
			for _, gl := range lags.Sorted() {
				// gl.Lag 是 map[topic]map[partition]GroupMemberLag
				rows := gl.Lag.Sorted() // 按 topic/partition 排序后的行
				for _, r := range rows {
					// Commit = 已提交位置（下一条将读）；End = 日志末端；
					// Lag 计算失败时为 -1（r.Err 有值），不要当 0 处理。
					fmt.Printf("group=%s state=%s topic=%s partition=%d commit=%d end=%d lag=%d\\n",
						gl.Group, gl.State, r.Topic, r.Partition, r.Commit.At, r.End.Offset, r.Lag)
				}
				fmt.Printf("group=%s state=%s total-lag=%d\\n",
					gl.Group, gl.State, gl.Lag.Total())
			}
		}
		cancel()
		time.Sleep(30 * time.Second)
	}
}`,
    },
    {
      type: "paragraph",
      text: "实测输出（对 4.3.1 上 lagprobe-grp 组的运行结果，与 `kafka-consumer-groups.sh --describe` 数值一致）：",
    },
    {
      type: "code",
      title: "lagwatch 实测输出（节选）",
      language: "text",
      code: `group=lagprobe-grp state=Empty topic=lag.demo partition=0 commit=20 end=27 lag=7
group=lagprobe-grp state=Empty total-lag=7`,
    },
    {
      type: "paragraph",
      text: "要点：**Lag 是对「已提交位移」求差**，所以与 CLI 是同一个数；`state=Empty` 表示组里当前没有在线成员（位移还在，等它过期或新成员加入）。真实系统里，把上面的 `fmt.Printf` 换成向你的指标注册器上报 gauge（标签带 group/topic/partition），lag 就成了可告警的时间序列。若要自己拼装（比如想同时拿分区起点算「可消费积压量」），底层原语是 `adm.FetchOffsets`（取已提交）+ `adm.ListEndOffsets`（取末端）+ `kadm.CalculateGroupLag`——`Lag` 只是把这三步封装好了，封装细节和取舍见 [kadm 文档](https://pkg.go.dev/github.com/twmb/franz-go/pkg/kadm)。",
    },
    {
      type: "heading",
      text: "观测手段三：客户端侧指标（franz-go hooks 与插件）",
    },
    {
      type: "paragraph",
      text: "broker 与协调器只告诉你「组提交到哪、日志到哪」，**处理过程的健康（批次多大、单条多久、失败多少）只有消费者自己知道**。Java 客户端的消费者自带 `records-lag-max` 这类 fetch 指标（broker 官方监控文档里也能查到）；Go 的 franz-go 思路是 hooks：`kgo.WithHooks` 可注册一组生命周期钩子（连接建立/断开、produce 记录入缓冲与写入、fetch 批次读到、组成员管理错误、客户端关闭等），把事件流导给任何你想要的统计。基于 hooks 的两个官方插件值得记住：`github.com/twmb/franz-go/plugin/kprom`（把客户端事件导出为 Prometheus 指标）与 `github.com/twmb/franz-go/plugin/kotel`（OpenTelemetry 的 metrics/tracing 集成）——它们的构造方式随版本演进，用时以各自文档为准，本课不贴调用代码，你需要带走的是**分工**：broker 指标描述集群，kadm 脚本描述消费位置，hooks/插件描述处理过程。第 5 章要的「失败数、重试数、死信数」正是处理过程指标，一般由业务代码自己在处理路径上计数（见下文的合并告警）。",
    },
    {
      type: "heading",
      text: "日志：文件在哪、哪几行值得看",
    },
    {
      type: "paragraph",
      text: "发行包启动脚本默认把日志写到安装目录下的 `logs/`（可用 `-Dkafka.logs.dir` 覆盖；用 Docker 官方镜像时日志直接打到 stdout，`docker logs` 即可）。4.x 用 log4j2 配置（`config/log4j2.yaml`），默认按用途拆成几个文件：",
    },
    {
      type: "table",
      caption: "Kafka 日志文件（4.3.1 发行包 config/log4j2.yaml 默认 appender）",
      headers: ["文件", "内容", "排障时看什么"],
      rows: [
        ["`logs/server.log`", "主体运行日志", "启动失败原因、ERROR/WARN 的上下文；「Kafka Server started」是就绪标志"],
        ["`logs/controller.log`", "controller 相关事件（选举、元数据变更、broker 心跳）", "选主异常、quorum 问题、fenced broker"],
        ["`logs/state-change.log`", "分区 leader 变更（谁接任、何时发生）", "对照「那一时刻哪些分区换了 leader」，配合排障时间线"],
        ["`logs/log-cleaner.log`", "日志清理/压缩（cleaner）线程", "compacted 主题清理停滞"],
        ["`logs/kafka-request.log`", "请求级日志", "慢请求定位（通常按需开 DEBUG 再看）"],
      ],
    },
    {
      type: "code",
      title: "实测关键日志行（4.3.1，正常启动的完整标志）",
      language: "text",
      code: `INFO [SocketServer listenerType=CONTROLLER, nodeId=1] Created data-plane acceptor and processors for endpoint : ListenerName(CONTROLLER) (kafka.network.SocketServer)
INFO [BrokerLifecycleManager id=1] Successfully registered broker 1 with broker epoch 11 (org.apache.kafka.server.BrokerLifecycleManager)
INFO [KafkaRaftServer nodeId=1] Kafka Server started (kafka.server.KafkaRaftServer)

# 排障时最常用的两条检索（tar 发行包形态）：
#   grep -E "ERROR|WARN" logs/server.log | tail -50
#   grep -E "ERROR" logs/controller.log | tail -50`,
    },
    {
      type: "paragraph",
      text: "读日志的原则是**对时间线**：指标说 14:03 发生 ISR 收缩，就去 state-change.log 看 14:03 前后的 leader 变更、去 server.log 看那台 broker 14:03 在干什么——日志是「原因」侧的证词，指标是「现象」侧的证词，两者对不上时先怀疑时钟或采集链路。",
    },
    {
      type: "heading",
      text: "告警分层：可用性 → 数据 → lag，阈值用方法不用拍脑袋",
    },
    {
      type: "paragraph",
      text: "把前面所有观测对象排成三层，每层职责不同、告警语义不同：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "**L1 可用性层**：集群还能不能服务。事件型、几乎不需要基线——`OfflinePartitionsCount > 0` 持续超过一次正常故障转移窗口、`ActiveControllerCount` 全集群不是恰好 1、quorum `Current Leader` 为 -1、`OfflineLogDirectoryCount > 0`、磁盘写满。这类告警必须配**处置动作**（runbook），因为它通常意味着事故正在进行。",
        "**L2 数据/冗余层**：数据还安全吗。`UnderReplicatedPartitions > 0` 持续、`UncleanLeaderElectionsPerSec` 非 0、`IsrShrinksPerSec` 持续非零且无对应扩张。它回答「冗余正在缩水，什么时候会恶化成 L1」。",
        "**L3 消费滞后层**：业务消费跟得上吗。按 (组, 主题) 看 lag 的**增长速度与持续时间**，而不是绝对值——用「数据保鲜 SLA」倒推阈值：书舟的 `orders.events` 保留 7 天、报表管道容忍 5 分钟延迟，那「该组 lag 换算成时间超过 5 分钟还在涨」就是一条有业务含义的告警线。",
      ],
    },
    {
      type: "paragraph",
      text: "阈值怎么定，给方法不给魔法数字，三条路：**事件型指标用「非期望值持续 N 分钟」**（N 覆盖一次正常恢复窗口，如节点重启+副本追平）；**资源型指标（两个 AvgIdlePercent、请求队列）用「稳态基线偏离」**——先让集群裸跑两周，记录同期同比（今天 14:00 对比上周同刻）的分布，偏离超过既定倍数才告警，官方文档的「理想 > 0.3」只是经验下限不是你的告警线；**速率型指标（IsrShrinks、ErrorsPerSec）平稳期本就该是 0，任何持续非零都值得看**，尖峰要对着节点宕机/发布的时间线解读。所有数字最终来自你的业务 SLA 与压测——[容量规划与性能调优](/courses/kafka/lessons/kafka-capacity-tuning)会给压测方法。",
    },
    {
      type: "heading",
      text: "把失败计数与 lag 合并：书舟告警规则示例",
    },
    {
      type: "paragraph",
      text: "第 5 章给过三条判读规则，现在把它们变成可执行的告警条件。场景：书舟结算管道（消费者组 `payment-settle`，消费 `order.payments`，失败进 `dlq.order.payments`）。业务侧埋了三个计数器（标签带 group/topic）：处理失败数 `payment_processing_failures_total`（按错误类别分）、死信投递数 `payment_dlq_total`、重试次数 `payment_retries_total`；平台侧有 lag 序列。合并规则骨架如下——`{占位}` 都是需要按你的基线与 SLA 填的阈值，**不要照抄任何绝对值**：",
    },
    {
      type: "code",
      title: "规则骨架（示意：表达告警意图，具体语法随监控系统；{…} 为待填阈值）",
      language: "text",
      code: `# 场景 A：lag 涨 + 重试计数涨        → 瞬态风暴，查下游依赖（支付渠道限流/抖动）
if    lag(payment-settle) 连续 {3} 个周期上升
  and rate(payment_retries_total[5m]) > 0
then  告警：瞬态处理风暴（提示看渠道/数据库/下游），勿扩容勿改代码，先止血

# 场景 B：lag 平稳 + 死信计数涨        → 有永久坏消息在等人工/补偿
if    rate(payment_dlq_total[5m]) > 0
then  告警：DLQ 增长，按错误类别聚合看坏数据源头（第 5 章死信消费路线）

# 场景 C：lag 涨 + 死信不涨 + 无重试   → 消费者静默卡死（poll 循环死了/毒消息无限重试）
if    lag(payment-settle) 连续 {3} 个周期上升
  and rate(payment_dlq_total[5m]) == 0
  and rate(payment_retries_total[5m]) == 0
then  告警：疑似卡死，去看 poll 循环与处理线程

# 场景 D：任意层：L1 可用性（示例）   → OfflinePartitions > 0 持续 {2} 分钟
#        L2 冗余      → UnderReplicatedPartitions > 0 持续 {10} 分钟`,
    },
    {
      type: "paragraph",
      text: "这套「三层 + 三个合并场景」的结构比任何单指标告警都难误报：单看 lag 涨，你分不清是峰值、是坏消息还是卡死；叠上失败计数后，三条路互斥且各自指向明确动作——这正是第 5 章把失败计数埋进业务代码、再与 lag 同看板的全部意义。机制写得再好，没有这几条规则兜底，出问题时你依然在黑箱里。",
    },
    {
      type: "quiz",
      question:
        "消费者稳定运行、处理速度略快于生产速度。你执行 kafka-consumer-groups.sh --describe，看到某分区 CURRENT-OFFSET=98、LOG-END-OFFSET=100、LAG=2（该消费者使用 franz-go 默认的 5 秒安全自动提交）。对这个 LAG=2 的最准确解读是？",
      options: [
        "消费者已经永久落后 2 条消息，说明它处理不过来，应该立刻扩容消费者实例",
        "LAG 反映的是「协调器里已提交位置」与日志末端的差；最近一两批刚处理完、还没到提交点，短暂非 0 属提交节奏的正常现象，关键看它是否持续增长",
        "这 2 条消息已经丢失，Kafka 会把它们重新投递给别的消费者",
        "describe 工具本身有 5 秒延迟，去掉延迟后真实 lag 一定是 0",
      ],
      answer: 1,
      explanation:
        "CURRENT-OFFSET 是组协调器记录的已提交位置，不是「已处理位置」。franz-go 默认安全自动提交每 5 秒一次且只提交上一次 poll 的批次，所以健康消费者也会显示一个约为最近一个提交周期处理量的 lag。lag 的正确用法是看走向：持续增长才说明消费跟不上生产；单点值（尤其小值）说明不了问题。",
    },
    {
      type: "keypoints",
      items: [
        "指标坐标系 = JMX MBean 名：分区/副本健康（OfflinePartitionsCount、UnderReplicatedPartitions、IsrShrinks/ExpandsPerSec、UncleanLeaderElectionsPerSec、OfflineLogDirectoryCount）+ 请求资源（BytesIn/OutPerSec、两个 AvgIdlePercent、ErrorsPerSec）+ KRaft（raft-metrics、broker-metadata-metrics、controller MBean）——正常值几乎全为 0，名称按 4.3 官方 monitoring 页核对",
        "lag = LOG-END-OFFSET − CURRENT-OFFSET，且 CURRENT 是「已提交位置」：安全自动提交（5s、滞后一轮）下健康消费者也会显示小 lag，**看走向不看单点**；观测最小单位是 (组, 主题, 分区)，总 lag 会掩盖热点 key",
        "三种观测：CLI `kafka-consumer-groups.sh --describe`（列名与第 1 章一致）；自研采集用 kadm `Lag(ctx, groups...)`（本课示例已在 4.3.1 实测，与 CLI 同数）；处理过程健康靠 franz-go hooks / kprom / kotel",
        "日志默认在 `logs/`（server.log / controller.log / state-change.log / log-cleaner.log；Docker 走 stdout），读日志要对着指标时间线",
        "告警三层：L1 可用性（事件型、配 runbook）→ L2 数据冗余 → L3 lag（用保鲜 SLA 倒推时间阈值）；阈值方法 = 非期望值持续 N 分钟 / 稳态基线偏离 / 持续非零",
        "第 5 章失败计数与 lag 合并成三条互斥告警：lag涨+重试涨=瞬态风暴；lag稳+死信涨=坏消息；lag涨+都不涨=卡死",
      ],
    },
    {
      type: "paragraph",
      text: "知道「看什么」之后，下一课回答「为什么会这样」——[容量规划与性能调优](/courses/kafka/lessons/kafka-capacity-tuning)解释指标背后的资源模型与瓶颈定位；再下一课[安全](/courses/kafka/lessons/kafka-security)给你的集群加锁；而本课积累的指标与日志，正是最后[排障手册](/courses/kafka/lessons/kafka-troubleshooting)每一节的判据来源。",
    },
  ],
};
