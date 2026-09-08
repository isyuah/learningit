/* ==================================================================
 * 课程：Kubernetes 系统学习（kubernetes）
 * ----------------------------------------------------------------
 * 课程元信息与章节大纲；课时内容在 ./lessons/<slug>.ts（一节课一个文件）。
 * 格式说明见 docs/CONTENT-AUTHORING.md，类型见 ../../types.ts。
 *
 * 版本边界：Kubernetes v1.37（2026-08-26 发布，当前主线；支持 1.35–1.37）。
 * 实践环境：kind v0.33+（默认节点镜像 kindest/node:v1.37.0），需要本机
 * Docker 与 kubectl ≥ 1.37（官方支持 kubectl 相对 apiserver ±1 小版本）。
 * 示例只用 GA API（apps/v1、batch/v1、networking.k8s.io/v1、autoscaling/v2、
 * policy/v1、storage.k8s.io/v1、rbac.authorization.k8s.io/v1 等）。
 * 贯穿示例：shop 书店系统（nginx 店面 + echo 模拟接口 + Redis + PostgreSQL），
 * 全部可在 kind 三节点集群（k8s-course）中实际演练。
 * 配套计划与写作契约：local/k8s-course-plan.md。
 * ================================================================== */
import type { Course } from "../../types";

export const course: Course = {
  slug: "kubernetes",
  title: "Kubernetes 系统学习",
  tagline: "从 Pod 心智模型到集群运维与故障排障",
  description:
    "面向熟悉 Docker 与 Linux、想体系化掌握 Kubernetes 的后端与基础设施学习者。课程不做工具清单，而是同时覆盖两条主线：应用开发者视角（对象模型、工作负载、Service 与 Ingress、配置与存储、发布与伸缩）与集群运维视角（控制面机制、etcd 与高可用、节点维护、升级与治理、排障），并用「调谐循环」这一心智模型把两条线串成一张图：你声明期望状态，控制面负责收敛，剩下的工作是理解每一层如何失败、如何排查。\n\n全程围绕一套可在 kind 三节点集群（k8s-course）上实际运行的「shop」书店系统展开：nginx 店面、模拟接口服务、Redis 与 PostgreSQL。从第一个集群、第一个 Pod 开始，逐步叠加工作负载、服务发现、配置、存储、弹性、安全与运维能力，最后用四节综合实战完成从零部署、滚动发布、水平伸缩到故障注入恢复的完整演练。每节实操课都给出可复制的 YAML 与 kubectl 命令、预期结果与常见失败。\n\n版本边界：Kubernetes v1.37（2026-08 发布，官方支持窗口 1.35–1.37），kind v0.33+。课程只讲 GA API，涉及 Gateway API、VPA、ClusterAutoscaler、KEDA 等生态组件时只讲定位与选择依据；不覆盖云厂商控制台细节、CNI 实现源码与 Helm 创作。",
  level: "intermediate",
  hours: 16,
  learners: 0,
  coverIndex: "17",
  coverColor: "info",
  updatedAt: "2026-09",
  outcomes: [
    "用一句话说清 Kubernetes 解决什么问题、边界在哪里，并画出集群组件协作图：一次 kubectl apply 如何变成节点上运行的 Pod",
    "建立「对象、期望状态、调谐循环」的心智模型，能读懂任意清单的 spec 与 status，用 labels/selectors 理解资源之间的关联",
    "编写并运维 Pod 与四种工作负载：滚动发布与回滚、自愈、优雅终止、探针语义，知道何时该用 Deployment/StatefulSet/DaemonSet/Job",
    "用 Service、DNS、Ingress/Gateway API、NetworkPolicy 设计并验证集群内外的流量路径，理解每层代理的职责与取舍",
    "用 ConfigMap/Secret 管理配置与敏感数据，用 PV/PVC/StorageClass 承载有状态应用，说清每类存储的生命周期与责任边界",
    "理解调度与资源模型（requests/limits、QoS、亲和、污点），能配置 HPA 并解释水平/垂直/集群三层弹性的分工",
    "用 RBAC、securityContext、Pod Security Admission 与供应链纪律加固集群和工作负载，识别默认配置的安全缺口",
    "看懂控制面内部机制（一次 API 请求的旅程、控制器与 finalizer、etcd 共识、CRD/Operator/准入扩展），掌握节点维护、etcd 备份、版本升级与命名空间治理",
    "按「症状 → 证据 → 假设 → 验证」的方法排障，并能在 kind 上独立完成 shop 系统的部署、发布、伸缩与故障恢复演练",
  ],
  chapters: [
    {
      id: "orientation",
      title: "先建立全景：集群与心智模型",
      intro: "先回答两个问题：Kubernetes 解决什么问题、一台集群由哪些组件组成；再建立贯穿全课程的对象与调谐心智模型，最后亲手用 kind 起一个三节点集群。",
      lessons: [
        { slug: "k8s-why-kubernetes", title: "为什么需要 Kubernetes", minutes: 20, kind: "reading" },
        { slug: "k8s-cluster-anatomy", title: "集群解剖：一次部署请求的旅程", minutes: 26, kind: "reading" },
        { slug: "k8s-object-model", title: "对象模型：声明式、spec 与调谐循环", minutes: 24, kind: "reading" },
        { slug: "k8s-kind-first-cluster", title: "用 kind 起第一个集群", minutes: 26, kind: "exercise" },
      ],
    },
    {
      id: "pod-deep",
      title: "Pod：最小调度单元",
      intro: "集群里真正跑业务的是 Pod。理解它的字段、生命周期、资源声明与日常操作，后面的工作负载与网络都建立在这一层。",
      lessons: [
        { slug: "k8s-pod-basics", title: "Pod 与容器：解剖一个 YAML", minutes: 24, kind: "reading" },
        { slug: "k8s-pod-lifecycle-probes", title: "生命周期、重启与三种探针", minutes: 28, kind: "reading" },
        { slug: "k8s-pod-resources", title: "资源请求与限制：CPU 与内存的语义", minutes: 26, kind: "reading" },
        { slug: "k8s-pod-ops", title: "Pod 日常操作：日志、进入与调试", minutes: 22, kind: "exercise" },
      ],
    },
    {
      id: "workloads",
      title: "工作负载：让应用自愈与发布",
      intro: "裸 Pod 没有自愈能力。Deployment、StatefulSet、DaemonSet、Job 这些工作负载控制器，才是「声明期望、自动收敛」的落地形态。",
      lessons: [
        { slug: "k8s-deployment-replicaset", title: "Deployment 与 ReplicaSet：副本从哪来", minutes: 24, kind: "reading" },
        { slug: "k8s-rollout-updates", title: "滚动更新、回滚与发布策略", minutes: 28, kind: "reading" },
        { slug: "k8s-statefulset", title: "StatefulSet：有状态应用的秩序", minutes: 26, kind: "reading" },
        { slug: "k8s-daemonset", title: "DaemonSet：每个节点恰好一个", minutes: 18, kind: "reading" },
        { slug: "k8s-job-cronjob", title: "Job 与 CronJob：跑完即走", minutes: 22, kind: "reading" },
      ],
    },
    {
      id: "networking",
      title: "服务发现与集群网络",
      intro: "Pod 会生老病死，IP 不稳定。Service 提供稳定入口与负载均衡，DNS 提供发现，Ingress 与 Gateway API 把流量送进集群，NetworkPolicy 管住东西向流量。",
      lessons: [
        { slug: "k8s-network-model", title: "网络模型：每个 Pod 一个 IP", minutes: 22, kind: "reading" },
        { slug: "k8s-service-basics", title: "Service：稳定的访问入口与 DNS", minutes: 30, kind: "reading" },
        { slug: "k8s-service-types", title: "NodePort、LoadBalancer 与 ExternalName", minutes: 22, kind: "reading" },
        { slug: "k8s-ingress-gateway-api", title: "Ingress 与 Gateway API：七层入口", minutes: 28, kind: "reading" },
        { slug: "k8s-networkpolicy", title: "NetworkPolicy：集群内的流量防线", minutes: 24, kind: "reading" },
      ],
    },
    {
      id: "config-secrets",
      title: "配置与敏感信息",
      intro: "镜像不可变，环境差异放哪里？ConfigMap 与 Secret 把配置和敏感数据移出镜像、放进 API 对象，随清单一起评审、发布与回滚。",
      lessons: [
        { slug: "k8s-configmap", title: "ConfigMap：配置与镜像分离", minutes: 22, kind: "reading" },
        { slug: "k8s-secrets", title: "Secret：敏感数据与信任边界", minutes: 26, kind: "reading" },
        { slug: "k8s-config-release-practice", title: "配置发布实践：diff、dry-run 与滚动生效", minutes: 20, kind: "exercise" },
      ],
    },
    {
      id: "storage",
      title: "存储：让数据活过 Pod",
      intro: "容器文件系统随容器消亡。卷、PV 与 PVC、StorageClass 把存储从「挂在哪台机器」抽象成「声明多大、什么模式」，让数据可以跟随工作负载迁移。",
      lessons: [
        { slug: "k8s-storage-mental-model", title: "卷的心智模型：emptyDir 与 hostPath", minutes: 22, kind: "reading" },
        { slug: "k8s-pv-pvc-storageclass", title: "PV、PVC 与 StorageClass：存储的声明式抽象", minutes: 28, kind: "reading" },
        { slug: "k8s-csi-stateful-production", title: "CSI 与有状态应用的生产注意", minutes: 24, kind: "reading" },
      ],
    },
    {
      id: "scheduling-scaling",
      title: "调度、资源与弹性",
      intro: "调度器决定 Pod 去哪里，requests 与 limits 决定它凭什么占那么多，HPA 决定副本跟随负载。三者合起来回答「集群如何把资源用对」。",
      lessons: [
        { slug: "k8s-scheduler-model", title: "调度器：Pod 放到哪个节点", minutes: 24, kind: "reading" },
        { slug: "k8s-affinity-taints", title: "亲和、反亲和与污点容忍", minutes: 28, kind: "reading" },
        { slug: "k8s-hpa", title: "HPA：按负载水平伸缩", minutes: 28, kind: "reading" },
        { slug: "k8s-scaling-panorama", title: "弹性全景：VPA、ClusterAutoscaler 与 KEDA", minutes: 22, kind: "reading" },
      ],
    },
    {
      id: "security",
      title: "安全：从集群到工作负载",
      intro: "默认配置面向可用性而非安全。从威胁模型出发，用 RBAC 管住「谁能做什么」，用 securityContext 与 Pod Security 收紧工作负载，用供应链纪律管住镜像与凭据。",
      lessons: [
        { slug: "k8s-security-threat-model", title: "安全边界与威胁模型", minutes: 22, kind: "reading" },
        { slug: "k8s-rbac", title: "RBAC：谁可以对什么做什么", minutes: 30, kind: "reading" },
        { slug: "k8s-workload-hardening", title: "工作负载加固：securityContext 与 Pod Security", minutes: 26, kind: "reading" },
        { slug: "k8s-supply-chain-secrets", title: "镜像供应链与数据保护", minutes: 22, kind: "reading" },
      ],
    },
    {
      id: "control-plane",
      title: "控制面内部与扩展",
      intro: "把「调谐」从黑盒变成机制：一次请求如何穿过 apiserver、控制器如何 watch 与收敛、etcd 如何保持一致，以及 CRD、Operator 与准入 Webhook 如何扩展集群。",
      lessons: [
        { slug: "k8s-api-request-journey", title: "一次 API 请求的旅程", minutes: 26, kind: "reading" },
        { slug: "k8s-controllers-internals", title: "控制器模式：watch、调谐与 finalizer", minutes: 28, kind: "reading" },
        { slug: "k8s-ha-etcd", title: "高可用控制面：etcd 与选举", minutes: 26, kind: "reading" },
        { slug: "k8s-crd-operator-admission", title: "扩展：CRD、Operator 与准入 Webhook", minutes: 28, kind: "reading" },
      ],
    },
    {
      id: "cluster-ops",
      title: "集群生命周期与运维",
      intro: "学会用集群只是开始。安装形态怎么选、节点如何维护、etcd 如何备份、版本如何升级、多团队如何治理——这些决定集群能活多久。",
      lessons: [
        { slug: "k8s-install-landscape", title: "集群从哪来：安装方式全景", minutes: 22, kind: "reading" },
        { slug: "k8s-node-maintenance", title: "节点维护：cordon、drain 与故障自愈", minutes: 26, kind: "exercise" },
        { slug: "k8s-etcd-backup-restore", title: "etcd 快照与灾难恢复", minutes: 24, kind: "reading" },
        { slug: "k8s-upgrade-strategy", title: "升级与版本治理", minutes: 24, kind: "reading" },
        { slug: "k8s-quota-governance", title: "命名空间治理：配额与多团队", minutes: 22, kind: "reading" },
      ],
    },
    {
      id: "troubleshooting",
      title: "排障与可观测",
      intro: "排障不是背命令，是按「症状 → 证据 → 假设 → 验证」收敛。掌握状态读取、Pod 与网络两类高频故障、集群指标，最后一节综合演练把前面的知识全部串起来。",
      lessons: [
        { slug: "k8s-debug-toolkit", title: "排障工具箱：状态、事件与 describe", minutes: 20, kind: "reading" },
        { slug: "k8s-pod-troubleshooting", title: "Pod 排障：从 Pending 到 CrashLoop", minutes: 28, kind: "reading" },
        { slug: "k8s-network-troubleshooting", title: "Service 与网络排障", minutes: 28, kind: "reading" },
        { slug: "k8s-monitoring-cluster", title: "集群可观测：指标、事件与日志", minutes: 22, kind: "reading" },
        { slug: "k8s-troubleshoot-drill", title: "综合故障演练", minutes: 24, kind: "exercise" },
      ],
    },
    {
      id: "capstone",
      title: "综合实战：书店系统上 K8s",
      intro: "把课程所有知识用于一个真实目标：让 shop 书店系统在 kind 集群上从零跑起来、能发布、能伸缩、坏了能自愈。四节课逐步交付并验证。",
      lessons: [
        { slug: "k8s-capstone-design", title: "设计：把 shop 变成一份清单", minutes: 24, kind: "exercise" },
        { slug: "k8s-capstone-deploy", title: "从零部署：分层落地与验证", minutes: 32, kind: "exercise" },
        { slug: "k8s-capstone-release-scale", title: "发布与伸缩演练", minutes: 28, kind: "exercise" },
        { slug: "k8s-capstone-failure-recovery", title: "故障注入与恢复演练", minutes: 24, kind: "exercise" },
      ],
    },
  ],
};
