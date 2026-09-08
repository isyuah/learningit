/* ==================================================================
 * 课时：节点维护：cordon、drain 与故障自愈（k8s-node-maintenance）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "用 PodDisruptionBudget 为自愿中断设下限，用 cordon/drain/uncordon 三件套安全地维护节点，并理解节点故障时控制面如何自愈——这套动作是升级、缩容等一切节点级操作的地基。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课解决了「集群从哪来」，这一课解决「节点要动它怎么办」。设想最普通的运维动作：给一台 worker 打内核补丁要重启。如果直接 `kubectl delete node` 或重启物理机，正在上面运行的 shop-api 副本会怎样？——节点上的 kubelet 与容器一起消失，控制面要等一段时间才能确认节点失联，副本才在其他地方重建，期间你的 Service 后端直接少了一截。维护节点不是重启一台机器那么简单，因为节点上托管着别人的工作负载。这一课先引入为「自愿中断」设下限的 PodDisruptionBudget（PDB），再实操 cordon/drain/uncordon 三件套，最后走一遍节点故障时的自愈路径。",
    },
    {
      type: "heading",
      text: "自愿中断与非自愿中断：为什么需要 PDB",
    },
    {
      type: "paragraph",
      text: "Kubernetes 把 Pod 的消失分成两类。非自愿中断（involuntary disruption）是你无法预知、也无法通过预算来推迟的：硬件故障、内核崩溃、节点失联、节点资源耗尽被驱逐。自愿中断（voluntary disruption）则是有人或工具主动发起的：排空节点做维护、缩容、升级节点——特点是「可以挑时间、可以商量」。PDB（PodDisruptionBudget，Pod 中断预算）就是商量机制：它是命名空间里的一个 policy/v1 对象，用选择器圈住一组 Pod，声明「任何时刻至少要有多少副本保持可用（minAvailable）」或「最多允许多少副本同时不可用（maxUnavailable）」，两者只能二选一。它只约束自愿中断：预算不满足时，驱逐请求会被拒绝。",
    },
    {
      type: "definition",
      term: "自愿中断（voluntary disruption）",
      definition:
        "由管理员或自动化工具主动发起的 Pod 中断：节点排空、缩容、节点升级、集群自动扩缩容的节点整理。可以择时执行，是 PDB 唯一能约束的对象。",
    },
    {
      type: "definition",
      term: "非自愿中断（involuntary disruption）",
      definition:
        "硬件故障、内核崩溃、节点失联等不可预知的中断。PDB 拦不住它，但它造成的不可用会计入预算计数——所以预算不是可用性的保证，副本数与跨节点分布才是。",
    },
    {
      type: "paragraph",
      text: "看一份给 shop-api 配的 PDB。它要求 shop-api 的 Pod 在任何时候至少有 2 个保持可用：",
    },
    {
      type: "code",
      title: "shop-api 的 PDB：至少 2 个可用",
      language: "yaml",
      code: `apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: shop-api-pdb
  namespace: shop
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: shop-api`,
    },
    {
      type: "paragraph",
      text: "预算怎么算？控制面通过 Pod 的属主引用（ownerReference）找到管理它的工作负载，以「期望副本数」为分母；「可用」按官方定义是 Ready 条件为 True 的 Pod。控制器会持续更新 PDB 的 status，`kubectl get pdb -n shop` 的 ALLOWED DISRUPTIONS 列就是当前还允许驱逐几个。当 shop-api 有 3 个副本且都 Ready 时，minAvailable=2 意味着允许同时中断 1 个——排空会变成一次驱逐、等新副本就绪、再驱逐下一个的串行过程；当健康副本只剩 2 个时，ALLOWED DISRUPTIONS 归零，任何驱逐都会被拒绝。对由单一工作负载管理、副本数会变动的应用，官方推荐用 maxUnavailable，因为它跟随期望副本数自动伸缩；本课练习用 minAvailable 更直观。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "PDB 的边界：只约束 Eviction API",
      body: "PDB 只对走驱逐（Eviction）API 的请求生效——kubectl drain、节点维护工具、显式的驱逐请求都会先过预算检查。直接 `kubectl delete pod`、删除 Deployment 这类「绕过驱逐接口的删除」不受 PDB 约束；滚动更新同样如此：官方文档明确指出，Deployment 等做滚动更新时不受 PDB 限制（节奏由自身的 maxSurge/maxUnavailable 控制，见第 3 章《滚动更新、回滚与发布策略》），但滚动造成的不可用会计入健康计数、占用预算空间。这就是本课与滚动更新课的桥梁：发布刚结束、副本还没全部就绪时紧接着排空节点，很可能被 PDB 卡住——发布与维护要错峰安排。",
    },
    {
      type: "heading",
      text: "维护三件套：cordon、drain、uncordon",
    },
    {
      type: "paragraph",
      text: "把节点从「正常服务」切换到「可安全重启」，是三步走。第一步冻结（cordon）：`kubectl cordon <节点>` 给节点打上不可调度标记，调度器不再把新 Pod 放上来，但存量 Pod 原地不动——它只是停止「进新货」。第二步排空（drain）：`kubectl drain <节点>` 先执行冻结，再把节点上的存量 Pod 逐个驱逐：对每个有控制器的 Pod 发起驱逐请求，驱逐会先经过 PDB 检查，再以优雅终止（遵守 terminationGracePeriodSeconds，回看第 2 章《生命周期、重启与三种探针》）结束；没有控制器的裸 Pod 驱逐不掉。第三步 uncordon：维护完成、节点重启并重新 Ready 后，`kubectl uncordon <节点>` 去掉不可调度标记，节点重新接单。",
    },
    {
      type: "table",
      caption: "排空时的 Pod 类型与对应参数",
      headers: ["节点上的 Pod 类型", "默认行为", "需要的参数"],
      rows: [
        ["Deployment/StatefulSet 等控制器管理的副本", "驱逐，且新副本由控制器在其他节点重建", "无需额外参数"],
        ["DaemonSet 管理的 Pod（如 CNI、kube-proxy）", "不驱逐（每个节点都要有，驱逐无意义）", "--ignore-daemonsets"],
        ["挂载 emptyDir 的 Pod", "拒绝驱逐（数据在节点本地，会丢）", "--delete-emptydir-data（确认可丢后使用）"],
        ["无控制器的裸 Pod", "拒绝驱逐", "需人工评估 --force 的风险：没有控制器会重建它"],
      ],
    },
    {
      type: "paragraph",
      text: "排空是「有商量的驱逐」：预算不满足时驱逐请求被拒，drain 不会放弃，而是反复重试并打印类似「cannot evict pod as it would violate the pod's disruption budget」的提示，直到所有 Pod 排空或到达 --timeout。看到排空卡住先别急着加 --force——先读提示：是 PDB 拦着（说明你的预算或副本数设置与维护计划冲突），还是裸 Pod、emptyDir 这类需要人工决策的对象。`kubectl drain` 完成后节点仍处于冻结状态，正好配合维护窗口；`kubectl uncordon` 之后节点恢复可调度。整件事的心智：cordon 停新、drain 清旧、uncordon 复员，而 PDB 保证「清旧」的过程不把可用副本压到线以下。",
    },
    {
      type: "heading",
      text: "节点真故障了：非自愿路径",
    },
    {
      type: "paragraph",
      text: "排空是「我先打招呼再动」，节点故障则是「没打招呼就消失」。自管集群的默认路径是这样：节点失联后，kubelet 的心跳中断，控制器管理器内的节点控制器等待约 40 秒宽限期（node-monitor-grace-period，默认值；云厂商常调短），随后给节点打上 NotReady 状态并添加对应的污点；如果约 5 分钟（pod-eviction-timeout，默认值）内节点没有恢复，节点控制器就删除该节点上的 Pod 对象——注意这些 Pod 不是被「驱逐」到别的节点，而是被删除后由各自的控制器在其他节点重建，所以 PDB 对这条路径没有约束力。等节点修好重新上线，它上面的旧 Pod 不会自己回来——它们早已被删除并在别处重建完毕，新 Pod 是按当时的调度决策分布的。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "不要用 kubectl delete node 做维护",
      body: "delete node 删除的是 Node 对象本身，语义是「让节点离开集群」，通常配合销毁或重新初始化节点使用。拿它当维护手段，控制面会失去对该节点的跟踪，而节点上仍在运行的 kubelet 与容器并不知情——形成失控的「幽灵负载」。可预期的维护一律走 cordon → drain → 维护 → uncordon；节点要永久下线再走 delete（并确保其上的 Pod 已排空）。本课程后面的升级课会反复用到这套三件套。",
    },
    {
      type: "exercise",
      title: "给 shop-api 配 PDB，然后安全排空一个 worker",
      description: `在 3 节点 kind 集群 k8s-course 上完成一次完整的节点维护演练：

1. 准备：确认集群有 1 个控制面和 2 个 worker（kubectl get nodes 看 NAME/STATUS），如还没有 shop 命名空间则 kubectl create namespace shop。若前面章节已部署过 shop-api，把它缩放到 2 副本（kubectl scale deployment shop-api -n shop --replicas=2）；若集群里还没有 shop-api，用下面的清单创建：

apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: shop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop-api
  template:
    metadata:
      labels:
        app: shop-api
    spec:
      containers:
        - name: api
          image: registry.k8s.io/echoserver:1.10
          ports:
            - containerPort: 8080

   注意：排空会迁移节点上的所有工作负载。若某些负载使用了绑定节点本地目录的卷（第 6 章静态供给练习里的 hostPath PV Pod），它们被排空后可能因卷绑定的节点而无法在其他节点重建——为聚焦本课主题，优先选择没有这类负载的 worker 做排空对象；若无法避开，可把本次演练放到临时命名空间（练习可临时用 default）里只跑 shop-api 与 PDB。
2. 把正文中的 PDB 清单保存为 shop-api-pdb.yaml 并执行 kubectl apply -f shop-api-pdb.yaml，然后 kubectl get pdb -n shop：预期看到 ALLOWED DISRUPTIONS 为 0——2 个健康副本刚好满足 minAvailable=2，一个都不让动。
3. 用 kubectl get pods -n shop -o wide 确认副本分布（大概率两个 worker 各一个；若两个副本恰好挤在同一节点，就选那个节点做排空对象）。
4. 对运行着 shop-api 副本的 worker 执行 kubectl cordon <节点>，再用 kubectl get nodes 确认它出现不可调度特征。
5. 执行 kubectl drain <节点> --ignore-daemonsets --delete-emptydir-data：预期 drain 卡住并反复提示驱逐会违反中断预算（cannot evict ... disruption budget）。这就是 PDB 在起作用。
6. 解除僵局：另开终端 kubectl scale deployment shop-api -n shop --replicas=3，新副本会被调度到未冻结的 worker；等它就绪后 drain 自动继续，把冻结节点上的旧副本逐个排空。体会「PDB 把排空变成串行、每一步都等新副本就绪」。
7. kubectl uncordon <节点>，确认节点恢复可调度；最后 kubectl get pods -o wide 观察副本如何重新分布。
8. 复盘两个问题：为什么 drain 需要 --ignore-daemonsets？如果这一步没有 PDB，直接 drain 会发生什么？`,
      hint: "先想清楚 PDB 的 ALLOWED DISRUPTIONS 为 0 意味着什么，再动手；排空卡住是预期行为，不是命令出错。解除僵局的两个可选方向（加副本 / 临时调低 minAvailable）分别对应「扩容保可用」与「接受短暂降级」两种运维选择。",
    },
    {
      type: "quiz",
      question: "以下哪种操作不会受到 PDB 的约束（可能绕过预算直接造成中断）？",
      options: [
        "kubectl drain 排空一个节点",
        "集群自动扩缩容工具通过 Eviction API 驱逐 Pod",
        "管理员直接执行 kubectl delete pod 删除某个副本",
        "节点维护脚本调用驱逐接口逐出 Pod",
      ],
      answer: 2,
      explanation:
        "PDB 只在驱逐走 Eviction API 时生效：drain、扩缩容工具的驱逐请求都会先检查预算。而 `kubectl delete pod` 是直接的删除调用，不经过驱逐接口，预算对它无效——这就是为什么官方文档提醒「删除 Deployment 或直接删 Pod 会绕过 PDB」。维护与自动化工具应当走驱逐路径，人为删 Pod 前也要意识到它不受预算保护。",
    },
    {
      type: "keypoints",
      items: [
        "PDB 为自愿中断设下限：选择器 + minAvailable/maxUnavailable 二选一，只约束 Eviction API，非自愿中断拦不住。",
        "cordon 停新调度、drain 清空存量（驱逐尊重 PDB）、uncordon 恢复——维护节点永远走三件套，不用 delete node。",
        "排空卡住先读提示：PDB、DaemonSet、emptyDir、裸 Pod 各有各的解法，--force 是最后手段。",
        "节点故障的自愈路径：约 40s 宽限标记 NotReady → 约 5 分钟未恢复则删除 Pod 由控制器重建（自管集群默认值），恢复的节点不会带回旧 Pod。",
      ],
    },
  ],
};
