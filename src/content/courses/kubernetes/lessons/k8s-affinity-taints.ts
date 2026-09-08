/* ==================================================================
 * 课时：亲和、反亲和与污点容忍（k8s-affinity-taints）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "用标签把「节点属性」和「Pod 相对位置」变成调度约束：节点亲和、Pod 亲和/反亲和；再让节点用污点主动拒绝、Pod 用容忍白名单放行——并在 kind 里动手观察调度结果与驱逐。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课结束时留了个钩子：想让 Pod 去某类节点，有比 nodeName 更体面的工具。本课把它们一次讲清：节点选择器（nodeSelector）、节点亲和（nodeAffinity）、Pod 之间的亲和与反亲和，以及由节点主动发起的污点与容忍（taint/toleration）。四者回答两类问题：「Pod 想或必须去哪里」（亲和系）和「节点不想让谁来」（污点系）。它们都只描述意图，执行者仍是调度器——上一课的过滤阶段，就是它们发挥作用的地方。",
    },
    {
      type: "heading",
      text: "标签：节点的自我介绍",
    },
    {
      type: "paragraph",
      text: "所有亲和约束的前提，是节点身上有标签可依。集群会为每个节点自动打上 kubernetes.io/hostname 等标签，control-plane 节点还有 node-role.kubernetes.io/control-plane；其余标签由管理员按需添加，例如标记磁盘类型、所在机架。查看与添加标签：",
    },
    {
      type: "code",
      title: "查看与打节点标签",
      language: "bash",
      code: `kubectl get nodes --show-labels
kubectl label node k8s-course-worker disktype=ssd
kubectl label node k8s-course-worker2 disktype=hdd`,
    },
    {
      type: "paragraph",
      text: "本课后面的实操会用到这两个自定义标签：worker 是 ssd，worker2 是 hdd。",
    },
    {
      type: "heading",
      text: "从 nodeSelector 到节点亲和",
    },
    {
      type: "paragraph",
      text: "最朴素的选择是 nodeSelector：Pod 声明一组键值对，只有标签全部匹配的节点才会被调度。它够用，但有两个硬伤：只能做等值匹配，表达不了「值是 ssd 或 nvme 之一」「存在某个标签即可」这类逻辑；而且只有「必须」，没有「最好放这里、放不了也行」的软偏好。",
    },
    {
      type: "code",
      title: "nodeSelector：最简单的节点选择",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: ssd-pod
spec:
  nodeSelector:
    disktype: ssd
  containers:
    - name: echo
      image: registry.k8s.io/echoserver:1.10`,
    },
    {
      type: "paragraph",
      text: "节点亲和（nodeAffinity）把表达能力补上，分为两类字段。requiredDuringSchedulingIgnoredDuringExecution 是硬性要求：调度时若没有节点满足，Pod 停在 Pending——上一课 FailedScheduling 事件的过滤原因之一就是它；preferredDuringSchedulingIgnoredDuringExecution 是软性偏好：带 weight（1–100 的权重）参与打分，没有节点满足也照样调度。拗口的后缀值得拆开记：DuringScheduling 表示只在调度那一刻评估；IgnoredDuringExecution 表示 Pod 运行之后节点标签再变化也不影响它、不会触发驱逐——目前只有这一种执行期策略。匹配条件写在 matchExpressions 里，用操作符表达：In（值属于列表）、NotIn、Exists（键存在即可）等；同一个节点选择词条内的多个表达式是「且」，多个词条之间是「或」。",
    },
    {
      type: "code",
      title: "nodeAffinity：硬性要求 + 软性偏好（结构示意，勿直接应用）",
      language: "yaml",
      code: `affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: disktype
              operator: In
              values: ["ssd"]
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 50
        preference:
          matchExpressions:
            - key: disktype
              operator: In
              values: ["nvme"]`,
    },
    {
      type: "heading",
      text: "Pod 亲和与反亲和：让 Pod 之间保持相对位置",
    },
    {
      type: "paragraph",
      text: "以上约束的对象都是「节点属性」。另一类需求的对象是「其它 Pod」：希望 shop-api 和 shop-cache 落在同一节点，省掉跨节点网络开销（podAffinity，Pod 亲和）；或者反过来，希望同一服务的副本分散开、别一起死（podAntiAffinity，Pod 反亲和）。反亲和是生产里更常用的那个——多副本高可用应用的标配。",
    },
    {
      type: "paragraph",
      text: "写法上比节点亲和多了两个关键概念。labelSelector 选择「参照组」：按标签匹配另一组 Pod——下面 spread-demo 的例子用反亲和把本 Deployment 自己的副本（app: spread-demo）彼此分散开；topologyKey 定义「同一位置」按节点的哪个维度来算：kubernetes.io/hostname 表示同一台节点，云环境里换成 zone 类标签键就是同一个可用区。kind 集群没有可用区，我们只用 hostname 维度。",
    },
    {
      type: "code",
      title: "spread-demo.yaml：2 副本必须落在不同节点",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: spread-demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: spread-demo
  template:
    metadata:
      labels:
        app: spread-demo
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchLabels:
                  app: spread-demo
              topologyKey: kubernetes.io/hostname
      containers:
        - name: echo
          image: registry.k8s.io/echoserver:1.10`,
    },
    {
      type: "paragraph",
      text: "注意反亲和是提出方单方面声明的约束：参照组里的 Pod 不需要声明任何东西。而且 required 反亲和一旦与容量冲突，就会把 Pod 卡死在 Pending。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "约束比容量更硬时，调度器不会变通",
      body: "kind 集群只有两个可用的 worker（control-plane 带污点），所以「3 副本 + required 反亲和 + hostname」必然有一个副本永远 Pending。想表达「尽量分散、实在不行就挤一挤」，要用 preferred 形态；下面的实操就用 2 副本 + required 展示干净的两节点分散。",
    },
    {
      type: "paragraph",
      text: "还有一层代价要心里有数：Pod 亲和/反亲和让调度器在决策时要去查其它 Pod 的分布，集群规模大了会明显增加调度成本；约束过强还会加剧上一课说的碎片化。能用反亲和解决的问题，不要叠加多余的亲和。",
    },
    {
      type: "heading",
      text: "污点与容忍：把决定权交给节点",
    },
    {
      type: "paragraph",
      text: "亲和系是 Pod 主动挑选。还有一类需求方向相反：节点或管理员想拒绝某些 Pod——比如 GPU 专用节点只给特定任务跑、磁盘告警的节点暂停接新活。污点（taint）就是节点的拒客声明，由键、值、效应（effect）三元组构成，值可以省略；容忍（toleration）是 Pod 侧的白名单，声明了对应容忍的 Pod 才被允许进入带污点的节点。注意语义方向：没有容忍只是进不了带污点的节点，去其它干净节点不受任何影响；容忍也不是邀请，只是放行。",
    },
    {
      type: "table",
      caption: "污点的三种效应",
      headers: ["effect", "对新 Pod", "对存量 Pod"],
      rows: [
        ["NoSchedule", "不容忍则不调度（硬性）", "不受影响"],
        ["PreferNoSchedule", "尽量不调度（软性）", "不受影响"],
        ["NoExecute", "不容忍则不调度", "立即驱逐不容忍的存量 Pod"],
      ],
    },
    {
      type: "paragraph",
      text: "NoExecute 是唯一会波及存量 Pod 的效应：给正在跑业务的节点打上它，不容忍的 Pod 会被驱逐（eviction）。这是「有计划的节点下线」的第一步直觉，完整的下线工具是第 10 章的排空（drain）。系统污点也走同一套机制：control-plane 节点默认带 node-role.kubernetes.io/control-plane:NoSchedule，这就是业务 Pod 永远上不去控制面节点的原因；节点失联时，节点控制器会打上 node.kubernetes.io/not-ready、unreachable 等污点来驱动故障驱逐，细节留到第 10 章《节点维护：cordon、drain 与故障自愈》。",
    },
    {
      type: "code",
      title: "给节点打污点、移除污点",
      language: "bash",
      code: `kubectl taint nodes k8s-course-worker2 disk=slow:NoSchedule
# 移除污点：在 effect 后加一个减号
kubectl taint nodes k8s-course-worker2 disk=slow:NoSchedule-`,
    },
    {
      type: "code",
      title: "Pod 侧声明容忍",
      language: "yaml",
      code: `tolerations:
  - key: disk
    operator: Equal
    value: slow
    effect: NoSchedule`,
    },
    {
      type: "paragraph",
      text: "容忍与污点按 key 与 effect 匹配：写了 value 时 value 也必须一致；operator 用 Exists 则只要求键存在。effect 必须写全——上面如果只容忍 NoSchedule，面对一个 NoExecute 污点，照样会被拒绝甚至被驱逐。",
    },
    {
      type: "heading",
      text: "实操：分散、污点与驱逐",
    },
    {
      type: "paragraph",
      text: "第一步，用反亲和把两个副本钉在不同 worker 上。应用上面的 spread-demo.yaml 后：",
    },
    {
      type: "code",
      title: "观察副本分散",
      language: "bash",
      code: `kubectl apply -f spread-demo.yaml
kubectl get pods -o wide -l app=spread-demo`,
    },
    {
      type: "paragraph",
      text: "预期看到：两个副本的 NODE 列分别是两个不同 worker——kind 的候选节点恰好只有它们，required 反亲和把「不在同一节点」变成了硬保证。这个对象留在后面观察驱逐用。",
    },
    {
      type: "paragraph",
      text: "第二步，验证 NoExecute 会驱逐存量 Pod。准备两个都用 nodeSelector 钉到 worker2（hdd 标签）的 Pod：一个没有容忍，一个带有 NoExecute 容忍。",
    },
    {
      type: "code",
      title: "victim-no-tol.yaml：没有容忍的 Pod",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: victim-no-tol
spec:
  nodeSelector:
    disktype: hdd
  containers:
    - name: echo
      image: registry.k8s.io/echoserver:1.10`,
    },
    {
      type: "code",
      title: "victim-with-tol.yaml：带容忍的 Pod",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: victim-with-tol
spec:
  nodeSelector:
    disktype: hdd
  tolerations:
    - key: maintain
      operator: Equal
      value: "yes"
      effect: NoExecute
  containers:
    - name: echo
      image: registry.k8s.io/echoserver:1.10`,
    },
    {
      type: "code",
      title: "应用、打污点、观察驱逐",
      language: "bash",
      code: `kubectl apply -f victim-no-tol.yaml -f victim-with-tol.yaml
kubectl get pods -o wide | grep victim
kubectl taint nodes k8s-course-worker2 maintain=yes:NoExecute
kubectl get pods -o wide | grep victim
kubectl describe pod victim-no-tol`,
    },
    {
      type: "paragraph",
      text: "预期看到：打污点前两个 Pod 都运行在 worker2；打上 maintain=yes:NoExecute 后，没有容忍的 victim-no-tol 进入 Terminating 随后消失，describe 的 Events 区域出现驱逐记录，而带容忍的 victim-with-tol 安然无恙——白名单的放行语义和 NoExecute 的存量驱逐，一次看全。如果被驱逐的 Pod 由 Deployment 管理，控制器会立刻在其它节点重建副本：驱逐不等于服务消失，这是第 3 章副本机制的又一次体现。",
    },
    {
      type: "code",
      title: "清理现场",
      language: "bash",
      code: `kubectl taint nodes k8s-course-worker2 maintain=yes:NoExecute-
kubectl delete -f victim-no-tol.yaml -f victim-with-tol.yaml -f spread-demo.yaml
kubectl label node k8s-course-worker disktype-
kubectl label node k8s-course-worker2 disktype-`,
    },
    {
      type: "paragraph",
      text: "给节点打污点会让该节点上的存量 Pod 遭殃，生产中请用第 10 章的排空（drain）而不是随手打 NoExecute 来下线节点。",
    },
    {
      type: "heading",
      text: "选择判据",
    },
    {
      type: "table",
      caption: "想表达的意图与对应机制",
      headers: ["意图", "推荐机制", "备注"],
      rows: [
        ["按节点属性做简单等值约束", "nodeSelector", "语法最简，但只有硬性"],
        ["按节点属性做复杂硬性约束", "nodeAffinity required", "In/NotIn/Exists 等操作符"],
        ["按节点属性做软性偏好", "nodeAffinity preferred", "配 weight 参与打分"],
        ["副本分散到不同节点/区域", "podAntiAffinity", "topologyKey 定义「同一位置」"],
        ["与特定 Pod 同机共置", "podAffinity", "低延迟、共享本地数据"],
        ["节点拒绝某类负载", "节点污点（无容忍即被拒）", "三种效应按需选择"],
        ["专用节点只放行特定 Pod", "污点 + 相应 Pod 加容忍", "白名单语义"],
      ],
    },
    {
      type: "paragraph",
      text: "决策时依次问三个问题：约束对象是节点属性还是其它 Pod？是必须还是偏好？是「我去哪」（亲和系）还是「谁来拒我」（污点系）？答案组合起来，四个机制各归其位。下一课把视野从「一个 Pod 放哪」抬起来，看一群副本如何跟随负载自动伸缩。",
    },
    {
      type: "quiz",
      question:
        "worker2 被打上 maintain=yes:NoExecute 污点，某个 Pod 只有 effect 为 NoSchedule 的容忍。它此刻正运行在 worker2 上，接下来会发生什么？",
      options: [
        "不受影响：它已经容忍了 maintain 这个键",
        "被驱逐：NoExecute 驱逐存量且不容忍的 Pod，而它的容忍效应是 NoSchedule，不匹配",
        "被驱逐，但立即重启并回到 worker2",
        "不受影响：NoExecute 只影响新 Pod，不管存量",
      ],
      answer: 1,
      explanation:
        "NoExecute 与 NoSchedule 的差别恰恰在存量 Pod：NoSchedule 不管存量，NoExecute 会驱逐存量。容忍按 key 与 effect 共同匹配，效应不同等于没有容忍，所以它会被驱逐。选项 3 错在被驱逐后由控制器重建的副本仍然没有 NoExecute 容忍，会停在 Pending 而非回到原节点；选项 4 把 NoExecute 说成了 NoSchedule。",
    },
    {
      type: "quiz",
      question:
        "在 kind 三节点集群（control-plane + 两个 worker）里，想让 shop-api 的三个副本「尽量分散、实在不行允许同节点」，最合适的约束是？",
      options: [
        "required podAntiAffinity + topologyKey: kubernetes.io/hostname",
        "preferred podAntiAffinity + topologyKey: kubernetes.io/hostname",
        "nodeSelector 指向两个 worker",
        "给 control-plane 节点加容忍",
      ],
      answer: 1,
      explanation:
        "kind 只有两个可用的 worker，required 反亲和要求三副本各占不同节点，必然有一个副本 Pending——约束比容量硬。preferred 形态会尽力分散，放不下也不卡调度，正合「尽量分散、允许同节点」。nodeSelector 只圈定节点范围、管不住副本彼此的位置；加容忍只会让副本也能上控制面，与分散无关。",
    },
    {
      type: "keypoints",
      items: [
        "亲和按对象分两类：节点亲和管节点属性，Pod 亲和/反亲和管 Pod 相对位置；required 是硬门槛，preferred 是带权重的软偏好。",
        "反亲和 + topologyKey: kubernetes.io/hostname = 副本分散到不同节点；required 变体遇到容量不足会 Pending。",
        "污点是节点拒客、容忍是 Pod 白名单；三种效应中只有 NoExecute 会驱逐存量 Pod。",
        "系统污点解释了常见现象：control-plane 节点上为什么没有业务 Pod；故障驱逐的完整机制在第 10 章。",
      ],
    },
  ],
};
