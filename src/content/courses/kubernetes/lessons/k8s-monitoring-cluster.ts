/* ==================================================================
 * 课时：集群可观测：指标、事件与日志（k8s-monitoring-cluster）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "分清三类信号的分工——指标定位趋势、事件定位变化、日志定位细节，并弄清集群自带的下限与 Prometheus 生态的衔接。",
  blocks: [
    {
      type: "paragraph",
      text: "前面几课的排障都发生在「当下现场」：get 与 describe 看当下状态、事件只保留约 1 小时、kubectl logs 只到容器重建之前。可排障时最常问的问题是「什么时候开始的、是不是一直在涨、这次和上次有什么区别」——这些需要指标。本课先把集群自带的可观测下限讲清（它够不够用、边界在哪），再讲要「长期可查」时生态组件各占什么位置，最后立起三类信号的分工心智：指标定位趋势、事件定位变化、日志定位细节。",
    },
    {
      type: "heading",
      text: "集群自带的下限：kubectl top 与 metrics-server",
    },
    {
      type: "paragraph",
      text: "kubectl top 是集群自带的资源用量查看工具，前提是装了 metrics-server——第 7 章《HPA：按负载水平伸缩》一课安装过的话，这里直接能用。metrics-server 从每个节点的 kubelet 采集 CPU 与内存用量，通过聚合 API（metrics.k8s.io）提供给 kubectl top 和 HPA 使用。装没装好，一条命令就能判断：`kubectl top nodes` 能出数字就是好的，报错就查 apiservices 里 metrics.k8s.io 的状态。kind 本地安装需要在官方部署清单基础上给 metrics-server 加 --kubelet-insecure-tls 参数——仅为本地实验关闭 TLS 校验，生产不得这样做，安装步骤以 metrics-server 官方部署文档为准。",
    },
    {
      type: "code",
      title: "看资源用量的两条命令",
      language: "bash",
      code: `# 节点维度：每列是 CPU 用量/占节点比例、内存用量/占节点比例
kubectl top nodes

# Pod 维度：实际用量（不是 requests），按 CPU 与内存分列
kubectl top pods -n shop`,
    },
    {
      type: "callout",
      variant: "warning",
      title: "top 只给你「现在这一瞬」",
      body: "metrics-server 把数据缓存在内存里，接口只返回最新采样，不落盘、不存历史——它没有时间序列查询，重启即空。`kubectl top` 适合回答「现在谁在吃资源」，回答不了「错误率从几点开始爬升」。想要趋势，必须接下面的长期指标生态。",
    },
    {
      type: "heading",
      text: "事件与节点日志：另外两条自带的线索",
    },
    {
      type: "paragraph",
      text: "事件（Events）在《排障工具箱：状态、事件与 describe》一课讲过：组件写给对象的时间线，默认约 1 小时清理。在可观测的分工里，事件的价值是「变化记录」——谁在什么时候动了哪个对象、调度器拒绝了什么。它天然短暂，适合现场排查，不适合做趋势与审计；想看更早的变化，要靠日志与指标平台。",
    },
    {
      type: "paragraph",
      text: "节点级日志则是 kubectl 够不到的最后一层：kubelet 与容器运行时跑在节点上，多数发行版由 systemd 托管，日志在节点上通过 journalctl 查看——`journalctl -u kubelet` 可以实时跟 kubelet 的决策过程（比如它为什么反复重启某容器）。kind 里节点是容器，需要先 docker exec 进节点容器再执行 journalctl。访问节点日志需要节点权限，这也提示了第 8 章讲过的边界：集群排障到节点层时，工具链会从 kubectl 切换成 SSH/journalctl。",
    },
    {
      type: "heading",
      text: "要历史与告警时：Prometheus 生态的定位",
    },
    {
      type: "paragraph",
      text: "kubectl top 不存历史，事件的窗口只有一小时——「长期可查」不在 Kubernetes 核心范围内（第 1 章就说过监控不是内置能力）。生产环境的标准答案是 Prometheus 生态，它由几个各司其职的组件组成，本课只讲定位，不展开细节：",
    },
    {
      type: "list",
      items: [
        "Prometheus 服务器：按周期抓取（pull）指标并存储为时间序列，提供查询与告警规则——它解决「历史可查」与「阈值告警」。",
        "kubelet / cAdvisor：节点侧资源指标的原始来源。kubelet 内置 cAdvisor，暴露节点与容器的 CPU、内存等指标；metrics-server 与 Prometheus 都从 kubelet 这一层取数。",
        "kube-state-metrics：把 API 对象的状态转成指标——Deployment 期望副本数与就绪副本数、Pod 数量与阶段分布、节点状态等。资源指标回答「用了多少」，kube-state-metrics 回答「对象层是否健康、规模是否符合预期」。它只读 apiserver，本身不采集资源用量。",
        "告警组件：Prometheus 里的告警规则把指标条件变成告警事件，再交给 Alertmanager 做通知路由。",
      ],
    },
    {
      type: "table",
      caption: "三个指标来源的分工",
      headers: ["来源", "提供什么指标", "典型用途"],
      rows: [
        ["metrics-server", "节点与 Pod 的即时 CPU/内存（短期缓存，无历史）", "kubectl top、HPA"],
        ["kubelet / cAdvisor", "节点与容器的资源指标原始数据", "被 metrics-server 与 Prometheus 采集"],
        ["kube-state-metrics", "API 对象状态：副本数、就绪数、对象数量、节点状态", "长期对象健康、容量与规模告警"],
      ],
    },
    {
      type: "paragraph",
      text: "PromQL 查询、告警规则写法、指标命名规范这些细节，属于本平台《可观测性系统学习》课程的范围（那里的三信号模型与本课一致，只是从「排障够用」讲到「体系化建设」）——本课只需要你记住：排障时遇到「要往回看」的需求，知道该去 Prometheus 生态里找哪一类指标，而不是在 kubectl top 里翻来翻去。",
    },
    {
      type: "heading",
      text: "日志三态：从哪来、能留多久",
    },
    {
      type: "list",
      items: [
        "容器 stdout：应用打到标准输出的日志，用 kubectl logs 看。容器重建日志就没了（容器文件系统与容器同寿命，回第 6 章卷的心智模型），且 kubectl logs 只能看当前与上一次运行。",
        "文件日志：应用写到容器内文件的日志。容器一重建文件就消失，所以要采集——两种姿势：同 Pod 的 sidecar 转发，或节点级采集器（每个节点一个 DaemonSet，把容器日志统一收走，这正是第 3 章《DaemonSet》一课讲的动机）。",
        "节点日志：kubelet、容器运行时、内核日志，在节点上 journalctl 查看，属于集群运维视角，业务排障一般够不到这一层。",
      ],
    },
    {
      type: "heading",
      text: "三类信号的分工心智",
    },
    {
      type: "paragraph",
      text: "把三节课的工具收拢成一个心智：指标回答「趋势」——什么时候开始、范围多大、是否持续；事件回答「变化」——哪个组件动了哪个对象、有没有变更类根因；日志回答「细节」——进程内部到底报了什么错。一次典型排障是这样串起来的：指标曲线显示接口错误率从 03:00 缓慢爬升（趋势，排除了瞬时抖动）→ 翻事件发现 03:00 前后没有任何部署、没有 Warning（变化，排除变更类根因）→ 才去看那个时间段的新版本容器日志，找到连接池报错（细节）→ 验证假设并修复。反过来，没有指标先翻日志，等于在不知道时间窗的情况下大海捞针。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "三类信号对着同一根时间轴看",
      body: "趋势图、事件列表、日志流的时间戳要能互相对齐。事件与日志常常成对出现——某个对象被删（事件）的同一秒，它的日志停止了（细节），这两个信号互相印证，比单看任何一类都可靠。",
    },
    {
      type: "quiz",
      question: "接口错误率从凌晨 3 点开始缓慢爬升，期间没有任何部署、也没有 Warning 事件。要判断「何时开始、是否持续、影响范围」，第一选择是什么？",
      options: [
        "打开 kubectl top 看当前 CPU 用量",
        "看有历史保留的指标趋势图（Prometheus 类平台）",
        "直接翻容器日志找 3 点前后的报错",
        "对全部 Pod 执行 kubectl describe 看事件",
      ],
      answer: 1,
      explanation: "「何时开始、是否持续」本质是趋势问题，只有存历史的指标能回答；kubectl top 只给当前瞬间，没有历史。事件无记录本身是证据——说明没有对象级变更，排除变更类根因；而日志应在指标圈定时间窗之后再看，直接全量翻日志效率最低。这正是三类信号的分工：指标定位趋势、事件定位变化、日志定位细节。",
    },
    {
      type: "keypoints",
      items: [
        "kubectl top 依赖 metrics-server，只有即时视图、不存历史；kind 本地需 --kubelet-insecure-tls（仅实验）",
        "事件默认约 1 小时保留，是变化记录不是趋势数据；节点日志在 journalctl -u kubelet",
        "长期可查交给 Prometheus 生态：Prometheus 存历史与告警，kubelet/cAdvisor 供资源指标，kube-state-metrics 供对象状态指标",
        "日志三态：容器 stdout（kubectl logs）、文件日志（sidecar/节点采集器）、节点日志（journalctl）",
        "分工心智：指标定位趋势、事件定位变化、日志定位细节，对着同一根时间轴看",
      ],
    },
  ],
};
