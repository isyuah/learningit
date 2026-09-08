/* ==================================================================
 * 课时：弹性全景：VPA、ClusterAutoscaler 与 KEDA（k8s-scaling-panorama）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "把弹性拆成三层：HPA 改副本数、VPA 改单 Pod 资源请求、ClusterAutoscaler 改节点数；KEDA 用事件把 HPA 的触发源扩展到队列积压等场景——最后按现实需求做组合决策。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课的 HPA 把「副本数」自动化了，这是弹性拼图里最常用的一块，但远不是全部。负载涨到「整个集群都放不下」时，副本再多也无处安放；requests 长期靠猜，扩一百个副本也是浪费。完整的弹性版图至少有三个维度——副本数、单个 Pod 的大小、节点数——外加一个触发源问题：拿什么信号来决定伸缩。本课把它们铺成一张全景图，并给出组合决策的思路。",
    },
    {
      type: "heading",
      text: "三层伸缩：副本、容器资源、节点",
    },
    {
      type: "table",
      caption: "水平、垂直、集群三层伸缩的分工",
      headers: ["维度", "组件", "改什么", "由谁实现", "生效代价"],
      rows: [
        [
          "水平（副本数）",
          "HPA",
          "工作负载的副本数",
          "控制面内置控制器（autoscaling/v2 对象）",
          "快：新副本就绪即可用",
        ],
        [
          "垂直（容器资源）",
          "VPA",
          "每个 Pod 的 requests/limits",
          "独立部署的生态组件，不在控制面内置",
          "需要重建 Pod 才生效，有重启窗口",
        ],
        [
          "集群（节点数）",
          "ClusterAutoscaler",
          "节点池里的节点数量",
          "独立组件，依赖云厂商的节点池 API",
          "慢：开新机器以分钟计",
        ],
      ],
    },
    {
      type: "paragraph",
      text: "三者的共同点值得先点破：它们都不是 kube-apiserver 内置的控制器——HPA 控制器虽然随控制面分发，但也只是 kube-controller-manager 里的一个普通成员；VPA 与 ClusterAutoscaler 则来自官方 autoscaler 项目、需要单独部署。Kubernetes 核心提供的只是机制：scale 子资源与 metrics API 这套契约，让任何控制器都能「按自己的策略改副本数或资源」。这和第 9 章《扩展：CRD、Operator 与准入 Webhook》讲的扩展哲学一脉相承：核心给机制，生态给策略。",
    },
    {
      type: "heading",
      text: "VPA：垂直伸缩，以及它的重启代价",
    },
    {
      type: "paragraph",
      text: "VPA（Vertical Pod Autoscaler，垂直 Pod 自动伸缩）调整的是单个 Pod 的资源请求：通过观察长期实际用量，把 requests/limits 收敛到贴近真实画像。为什么调整 requests 通常意味着一次重建？因为 requests/limits 在 Pod 创建那一刻就固化了——调度记账要按它预留、cgroup 要按它设限，运行中无法修改，所以 VPA 只能更新工作负载模板并触发滚动重建。这个重启窗口对无状态服务无所谓，对有状态服务就要谨慎，配合 PDB 和低峰窗口执行。",
    },
    {
      type: "paragraph",
      text: "VPA 通常提供两种工作模式：只给建议（recommendation，不自动改）和自动执行（auto，改完重建）。初次上手建议先用「只给建议」模式，拿它当资源画像的参考——这也是它最有价值的使用方式：很多团队根本不知道自己的服务该申请多少资源。风险同样要讲：如果 HPA 也在用 CPU 利用率伸缩，而 VPA 又在调 CPU 的 requests，两者会对着同一个指标互相拉扯，官方建议避免这种组合（具体边界以官方文档为准）。",
    },
    {
      type: "heading",
      text: "ClusterAutoscaler：集群本身也要伸缩",
    },
    {
      type: "paragraph",
      text: "HPA 和 VPA 都在既有的节点上做文章。当峰值需求超过整个集群的容量，副本只能停在 Pending——上一课那种 Insufficient cpu 的 FailedScheduling 事件成片出现时，就是 ClusterAutoscaler（CA）的出场信号。CA 观察到因资源不足而长时间无法调度的 Pod，就去请求云厂商把某个节点池扩大；新节点就绪后，Pending 的 Pod 被调度上去。缩的方向同理：节点长期低利用率、上面的 Pod 都能挪走时，CA 先把节点排空再回收——排空的语义在第 10 章《节点维护：cordon、drain 与故障自愈》讲过。",
    },
    {
      type: "paragraph",
      text: "CA 有两个现实边界。一是依赖云环境：加节点要调云厂商的节点池/自动扩缩组 API，裸金属自管集群没有这个 API，只能预留余量或人工扩容。二是速度：开一台新机器以分钟计，突发流量靠 CA 根本来不及，所以生产里常在节点池里留 buffer，或配置过度供给类策略兜底。典型的组合是：HPA 应对负载波动，CA 应对「集群放不下」——但 CA 只对 Pending 反应，不会预判流量。",
    },
    {
      type: "heading",
      text: "指标驱动的盲区，与 KEDA 的定位",
    },
    {
      type: "paragraph",
      text: "到目前为止，所有伸缩依据都是「指标」：CPU 利用率、内存占用。指标驱动有个前提——先有流量，指标才会涨，副本才会加。但有一类负载天生是事件驱动的：消息队列积压。设想 shop 的夜间批处理：订单消息不断进入队列，但消费者没起来，没人消费，队列越来越长——此时 CPU 指标是零，HPA 认为天下太平，而真正的信号「队列长度」它根本看不见。没有消费者就没有指标，没有指标就不扩消费者，死锁。",
    },
    {
      type: "paragraph",
      text: "KEDA（Kubernetes Event-driven Autoscaling，Kubernetes 事件驱动伸缩）就是冲着这个盲区来的。它的定位可以概括为：把「外部事件深度」翻译成期望副本数的适配层——监听消息队列积压数、数据库待处理数等事件源，换算成目标副本，然后仍然走 HPA 这套机制去伸缩，而不是另起炉灶。为什么需要它：autoscaling/v2 原生只认集群内指标，自定义/外部指标要自己搭整套管道，而 KEDA 内置了几十种事件源适配器，把「队列长 → 加消费者」这类需求从不可能变成配置项。判断要不要 KEDA 很简单：负载是常规 HTTP 流量，不需要；负载本质是消息/流式任务，值得评估。",
    },
    {
      type: "heading",
      text: "现实决策：从最小集开始",
    },
    {
      type: "list",
      items: [
        "只有常规 HTTP 流量波动、节点常年有余量：只要 HPA——这是绝大多数服务的起点，也是默认答案；",
        "高峰逼近集群容量上限：在 HPA 之上补 ClusterAutoscaler（云托管集群通常提供一键开启）；自管集群没有节点池，用监控数据提前扩容或预留余量（指标长期数据见第 11 章《集群可观测》）；",
        "requests 长期靠猜、利用率两极分化：先上 VPA 的「只给建议」模式做资源画像，再决定手动收敛还是自动执行；",
        "负载本质是消息队列/事件流：评估 KEDA，用事件深度而不是 CPU 当伸缩信号；",
        "每加一个自动伸缩组件，就多一个故障面和运维负担：别一次性全上，按上面顺序一步步来。",
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "自动伸缩不解决 requests 设错",
      body: "无论是 HPA、VPA 还是 KEDA，都建立在合理的资源声明之上。先拿数据说话：kubectl top 看当下、长期监控看趋势，画像清楚了再决定上哪个组件——否则只是在把错误放大成自动化的错误。",
    },
    {
      type: "quiz",
      question:
        "大促期间，shop-web 的 HPA 已经扩到 maxReplicas，节点 CPU 逼近 100%，新副本成片 Pending（Insufficient cpu）。下一步最应该补哪个组件？",
      options: [
        "VPA：把每个副本的 requests 调大",
        "ClusterAutoscaler：让集群在容量不足时自动加节点",
        "KEDA：接入消息队列指标",
        "把 HPA 的 maxReplicas 再调大",
      ],
      answer: 1,
      explanation:
        "症状是集群绝对容量不足：副本上限已到、节点已满、新副本无处调度，这是 CA 的典型信号——它正是为「有 Pending 的 Pod 且节点池可扩」而生。调大 maxReplicas 只会制造更多 Pending；VPA 调大 requests 会让账本更紧、加剧问题；KEDA 解决的是事件型负载的触发问题，与容量无关。前提提醒：自管裸集群没有节点池 API，CA 无从谈起，只能预留余量或人工扩容。",
    },
    {
      type: "quiz",
      question: "为什么 VPA 调整 Pod 的 requests 通常意味着一次重建，而 HPA 扩副本不用？",
      options: [
        "requests/limits 在 Pod 创建时固化（调度记账与 cgroup 设限都基于它），运行中改不了，VPA 只能更新模板并触发滚动重建",
        "VPA 只改 limits，改 limits 不需要重建",
        "因为 VPA 不在控制面内置，kubelet 不认识它的请求",
        "重建是为了清空 metrics-server 的缓存",
      ],
      answer: 0,
      explanation:
        "requests/limits 是 Pod 创建时的固化属性：调度器按它预留资源、运行时按它设置 cgroup 上限，两者都无法在运行中变更，所以垂直调整只能通过「改模板 + 重建」生效——这正是 VPA 有重启窗口、与 HPA 无感扩缩形成对比的根源。其它选项都不成立：limits 同样固化；VPA 通过正常 API 更新工作负载，与是否内置无关；metrics-server 只是指标管道，不参与资源变更。",
    },
    {
      type: "keypoints",
      items: [
        "三层分工：HPA 改副本数（快）、VPA 改单 Pod 资源请求（要重建）、ClusterAutoscaler 改节点数（慢，依赖云）；",
        "VPA 与 CA 都不是 kube-apiserver 内置，需要单独部署；核心只提供 scale 子资源与 metrics API 契约；",
        "触发源维度：指标驱动（HPA/VPA/CA）覆盖不了「队列积压但 CPU 为零」的事件型负载，那是 KEDA 的定位；",
        "决策顺序：默认只上 HPA；容量见顶补 CA；requests 靠猜先上 VPA 建议模式；事件型任务评估 KEDA；每加一个组件都是新的运维负担。",
      ],
    },
  ],
};
