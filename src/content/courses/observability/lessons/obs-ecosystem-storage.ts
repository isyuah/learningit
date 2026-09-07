/* ==================================================================
 * 课时：存储扩展：Thanos、Remote Write 与 K8s 观测（obs-ecosystem-storage）
 * ----------------------------------------------------------------
 * 第七章「生态全景」导览课：只建立认知地图，不深入实现细节。
 * block 类型见 ../../../types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * 导览节奏：问题 → 工具 → 定位一句话 → 小例子 → 何时需要 → 一句陷阱。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  slug: "obs-ecosystem-storage",
  courseSlug: "observability",
  title: "存储扩展：Thanos、Remote Write 与 K8s 观测",
  summary: "单机 Prometheus 的三道天花板与解法：remote write 送历史、Thanos 给 HA 与全局查询、VictoriaMetrics 省存储；补 Alertmanager 落地形态，再看 K8s 里谁产生什么指标。",
  minutes: 26,
  kind: "reading",
  blocks: [
    {
      type: "paragraph",
      text: "主线 demo 里的 Prometheus 是单机形态（第 14 课 obs-full-stack-deploy 那条 compose 起的一套）：一块本地磁盘存全部时序，一个进程同时负责抓取、查询与告警评估。对课程演示它刚刚好，规模一上来就有三道天花板。第一是磁盘有限：时序持续写入，本地盘很快吃满，保留期被迫压到「只够最近排障」；第二是单点：Prometheus 自己挂了，抓取、查询、告警一起停，监控系统变成新的故障源；第三是视野：staging/prod 多套环境、多个集群各跑一套 Prometheus，想用一个 PromQL 查全部时无从下手。本课围绕这三道墙导览存储与规模扩展家族——remote write、Thanos、VictoriaMetrics，补上 Alertmanager 从「判定出事」到「通知到人」的落地形态，最后看 K8s 里观测对象如何从进程扩展到节点与集群。",
    },
    {
      type: "heading",
      text: "存储扩展：Remote Write、Thanos 与 VictoriaMetrics",
    },
    {
      type: "paragraph",
      text: "**Remote Write** 是 Prometheus 向外推数据的协议：Prometheus 照常 scrape、本地照常查询，同时把样本经 HTTP 持续推给一个支持该协议的接收端——通常是长期存储（Thanos Receive、VictoriaMetrics、云托管服务等，接收端清单以官方文档为准）。本地与远端是「双写」：近窗口查本地，历史查长期库。它解决第一道墙：本地只留短窗（Prometheus 默认保留 15 天，可用启动参数调整，以官方文档为准），历史数据全量进对象存储或专用库，跨月趋势、容量规划、合规审计都在长期库上做。这个协议你已经见过一面——第 13 课（obs-collector）的 prometheusremotewrite exporter 就是把 OTel 指标翻译成 remote write 格式推给 Prometheus 兼容存储，所以它也是 OTel 指标进入这类后端的标准通道。追求极致瘦身时还有 agent 模式：Prometheus 只采集并 remote write，本地不留可查询的历史。",
    },
    {
      type: "code",
      title: "remote write：把样本推给长期存储（prometheus.yml 片段，示意）",
      language: "yaml",
      code: `# 追加在 prometheus.yml 里即可；字段以官方文档为准。
remote_write:
  - url: "https://thanos-receive.example.com/api/v1/receive"
    queue_config:
      max_samples_per_send: 5000   # 攒批推送，减少请求数

# 加了 remote_write 后，本地照常 scrape 与查询，数据是「双写」：
# 近窗口查本地，长期历史查远端（或经全局查询层同时查两者）。`,
    },
    {
      type: "paragraph",
      text: "**Thanos** 把「高可用 + 长期存储 + 全局查询」打包成一套开源方案，按需组装组件：sidecar 挂在你已有的每个 Prometheus 旁，把落盘的 TSDB 块上传到对象存储并提供 store API；receive 直接接收 remote write，适合不想维护完整 Prometheus 的场景（配合 agent 模式只采集）；store gateway 负责读对象存储里的历史块；querier 是统一查询入口，把多套 Prometheus 与对象存储并成一个数据源；compactor 做压缩与降采样。它解决什么：高可用——同一环境跑一对 Prometheus 各自抓取，查询端自动去重，挂一台不丢数据、查询不中断；长期——数据在对象存储里躺数年，本地保留期可收得很短；全局——一个 PromQL 同时查所有环境/集群。何时需要：保留超过数月、多集群、或对监控自身 HA 有要求。一句取舍：这些能力是用「一批组件 + 运维复杂度」换来的——块上传、查询去重、压缩、对象存储生命周期都要人维护。",
    },
    {
      type: "paragraph",
      text: "**VictoriaMetrics** 是同题的另一条路：兼容 Prometheus 的开源存储，单机版高压缩、单二进制部署（也有面向更大规模的集群版，以官方文档为准），能接收 remote write、查询兼容 PromQL，并内置按月保留等省心能力。何时选它：小团队、存储贵、想少运维——不想为长期方案养一整套组件，就把 Thanos 那套换成一个进程。一句话取舍：VM 单机省事、存储省得明显，代价是偏离原生 Prometheus 生态这条主线；Thanos 保留原生 Prometheus 却引入组件复杂度。先分清瓶颈是「存储贵」还是「要多集群统一查询」：前者倾向 VictoriaMetrics，后者倾向 Thanos。",
    },
    {
      type: "heading",
      text: "Alertmanager 落地：从风暴到一条通知",
    },
    {
      type: "paragraph",
      text: "第 8 课（obs-alerting）把边界划得很清：Prometheus 只判定「出事了没有」，把 firing 告警推给 Alertmanager；Alertmanager 决定「怎么让对的人知道」，武器是分组、抑制、静默、路由。那课不部署，这里补落地形态一句话：Alertmanager 是独立于 Prometheus 的进程/容器（官方镜像 prom/alertmanager，默认端口 9093，以实际部署为准），Prometheus 在配置的 alerting.alertmanagers 段把地址告诉它，生产上可多副本组集群同步状态；所有通知由它内部的一棵「路由树」决定去向。路由树解决告警风暴：故障是成片的——支付链路一慢，几十条规则同时 firing，各发各的就是通知风暴；树先把告警按共享标签分组收敛成一条，再按匹配规则分发给对应接收者（webhook、邮件、IM、PagerDuty 等）。最小配置长这样：",
    },
    {
      type: "code",
      title: "alertmanager.yml：按服务分组、按级别分发的最小路由示意",
      language: "yaml",
      code: `# 字段以官方文档为准。
route:
  group_by: ["alertname", "service"]  # 同一服务同一类故障 → 合并成一条通知
  group_wait: 30s                     # 组内先等 30s，让风暴里的告警聚齐
  group_interval: 5m
  repeat_interval: 4h                 # 未恢复前每 4h 重发一次
  receiver: "webhook-default"         # 根路由：兜底默认接收者
  routes:
    - matchers: ['severity="page"']   # 子路由：按标签继续分叉
      receiver: "webhook-oncall"      # page 级告警单独走 oncall 通道

receivers:
  - name: "webhook-default"
    webhook_configs:
      - url: "http://notify:8080/alert"
  - name: "webhook-oncall"
    webhook_configs:
      - url: "http://pager:8080/alert"`,
    },
    {
      type: "heading",
      text: "K8s 观测：从进程到集群",
    },
    {
      type: "paragraph",
      text: "把同一套栈搬进 K8s，最先撞见的是：单 Pod 的应用指标回答不了集群问题。「副本少了一个」——Deployment 期望 3 副本只剩 2，活着的 Pod 个个健康、RED 曲线毫无异常，集群容量却已悄悄少了三分之一；「节点内存压力」——某节点水位高到调度器不敢再放 Pod、甚至触发驱逐，Pod 内指标同样一无所知。这两类问题发生在「节点」与「集群对象」层，需要 K8s 观测组件群补齐：node-exporter 采集节点本身的资源指标（每节点一个）；kube-state-metrics 从 K8s API 派生 Deployment/Pod 等对象的期望与实际状态；cAdvisor 内嵌于 kubelet，采集容器级 CPU/内存。谁来把这些 target 告诉 Prometheus？K8s 里 Pod IP 随时漂移——重建、换节点、扩缩容都会换地址，写死 IP 的 static_configs 立刻失效；kubernetes_sd_configs 让 Prometheus 持续 watch API server，按 node/service/pod/endpoints 等角色与标签自动圈选目标并跟随变化（配合 relabel 只保留真正暴露指标的端口，细节以官方文档为准）。下表回答「K8s 里谁产生什么指标」。",
    },
    {
      type: "table",
      caption: "K8s 里谁产生什么指标（示例指标名以各项目官方文档为准）",
      headers: ["组件", "谁产生什么指标", "解决什么"],
      rows: [
        ["node-exporter", "节点级指标：CPU、内存、磁盘、文件系统、网络（每个节点一个实例）", "「节点这台机器健康吗」——磁盘将满、网卡丢包等宿主机问题，Pod 内指标看不到"],
        ["kube-state-metrics", "由 K8s API 派生的对象状态指标：Deployment 期望/可用副本数、Pod 所处阶段、PVC/Node 状态", "「声明状态与实际是否一致」——副本少了一个、滚动更新卡住、Pod 反复重启"],
        ["cAdvisor（kubelet 内置）", "容器级资源指标：每个容器的 CPU、内存、网络（经 kubelet 暴露）", "「容器吃了多少资源」——应用进程自身给不出的容器用量"],
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "K8s 观测不是「把 Prometheus 搬进 K8s」就完事",
      body: "完整图景是四层分工：应用自身指标（主线 RED/USE，scrape 应用 Pod）回答「服务健康吗」；cAdvisor 回答「容器吃了多少」；node-exporter 回答「节点扛得住吗」；kube-state-metrics 回答「集群声明与实际的偏差」——再靠 kubernetes_sd_configs 让 target 自动跟随集群变化。缺任何一层都有盲区：只盯应用指标，副本缺失、节点磁盘将满都不可见。生产上常用 kube-prometheus-stack 这类打包一次性装齐（含组件与 K8s 抓取/告警规则，以官方文档为准）；本课只需记住各层的职责分工。",
    },
    {
      type: "keypoints",
      items: [
        "单机 Prometheus 三道墙：磁盘有限（保留期）、单点（HA）、多环境/多集群统一查询；扩展家族各解一面",
        "remote write 是 Prometheus（或第 13 课 Collector 的 prometheusremotewrite exporter）把样本推给长期存储的协议：本地留短窗、历史进对象存储/专用库；agent 模式只采集不查询",
        "Thanos：HA + 对象存储长期保留 + 全局 PromQL；sidecar 上传 TSDB 块、receive 收 remote write、querier 统一查询、compactor 压缩——保留超数月/多集群/要 HA 时引入，代价是组件与运维复杂度",
        "VictoriaMetrics：Prometheus 兼容、单机高压缩、单二进制省运维；小团队/存储贵时选它。一句话取舍：VM 单机省事 vs Thanos 原生 Prometheus 生态",
        "Alertmanager 落地：独立进程收全部 Prometheus 的 firing，路由树按服务/级别分组收敛、分发到 webhook 等接收者，把告警风暴变成一条通知（机制详见第 8 课）",
        "K8s 组件分工：node-exporter 管节点指标、kube-state-metrics 管对象状态（期望 vs 实际副本）、cAdvisor 管容器资源（kubelet 内置）；kubernetes_sd_configs 让 target 自动跟随 Pod IP 漂移",
        "集群层指标补单 Pod 盲区：副本缺失、节点内存压力这类问题，只有「对象状态 + 节点 + 容器」三层合起来才看得见",
      ],
    },
  ],
};
