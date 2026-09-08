/* ==================================================================
 * 课时：调度器：Pod 放到哪个节点（k8s-scheduler-model）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "调度器按「先过滤、后打分」为待绑定的 Pod 选择节点：理解 requests 如何参与记账、FailedScheduling 事件怎么读，以及为什么用 nodeName 钉死 Pod 是反模式。",
  blocks: [
    {
      type: "paragraph",
      text: "到目前为止，部署一个应用只需要两步：把 Deployment 的清单交给集群，然后等副本就绪。副本会出现在某个节点上，但「出现在哪个节点」这个问题一直悬而未决——它由控制面里的一个专门组件回答：调度器（kube-scheduler）。第 1 章《集群解剖：一次部署请求的旅程》里它出场过一次，本课把它讲透：一次调度决策如何发生、requests 怎样参与决策、Pod 停在 Pending 时事件怎么读，以及一个最常见的反模式。",
    },
    {
      type: "heading",
      text: "一次调度：从 Pending 到绑定",
    },
    {
      type: "paragraph",
      text: "新建的 Pod 先进入 Pending 阶段：它还没有被分配到任何节点。调度器 watch 到这类「待绑定」的 Pod 后开始决策，流程可以压缩成三步：从集群所有节点中过滤出可行节点；给可行节点打分；把得分最高的节点写回 Pod。最后一步叫绑定，落地形式就是设置 Pod 的 spec.nodeName 字段。",
    },
    {
      type: "definition",
      term: "绑定（binding）",
      definition:
        "调度器把决策结果写回对象：设置 Pod 的 spec.nodeName 为选中的节点名。绑定完成之前，Pod 停留在 Pending 阶段。",
    },
    {
      type: "paragraph",
      text: "调度器并不搬运任何东西，它只做决定并写一个字段。真正把容器拉起来的是节点上的节点代理（kubelet）：它 watch 到有 Pod 被绑定到自己名下，才通过容器运行时（CRI）拉镜像、起容器。你在 kubectl get pods 里看到的 STATUS 从 Pending 变成 ContainerCreating、再变成 Running，就是这个接力过程的外在表现。",
    },
    {
      type: "heading",
      text: "两阶段：先过滤，再打分",
    },
    {
      type: "paragraph",
      text: "调度决策分成性质不同的两步。过滤（filtering）是硬门槛：把「不可能放」的节点剔除，剩下的才是可行节点；打分（scoring）是软偏好：可行节点通常不止一个，按评分策略排出先后，取最优。一句话心智：过滤回答「能不能放」，打分回答「放哪里更好」。",
    },
    {
      type: "list",
      items: [
        "资源：节点的可分配量减去已调度 Pod 的 requests 总和，容不下新 Pod 的 requests → 剔除；",
        "污点：节点上有污点而 Pod 没有对应容忍 → 剔除（下一课展开）；",
        "约束：nodeSelector、节点亲和、Pod 亲和/反亲和不满足 → 剔除；",
        "其它：声明的主机端口被占用、所需卷无法在该节点挂载等。",
      ],
    },
    {
      type: "callout",
      variant: "note",
      title: "插件化调度",
      body: "过滤与打分的具体规则由一组可插拔的调度插件组成，默认策略（例如让负载在节点间更均衡、或优先打包到已用节点）会随版本调整，具体插件清单与权重以官方调度器文档为准。本课只需要掌握「两阶段」与「按 requests 记账」这两个不变量。",
    },
    {
      type: "heading",
      text: "requests：调度按「请求量」记账",
    },
    {
      type: "paragraph",
      text: "资源过滤用的账本不是实际用量，而是 requests——这正是第 2 章《资源请求与限制：CPU 与内存的语义》预留的伏笔：那一课说 requests 用于「调度预留」，现在兑现。调度器为每个节点维护一张账：节点可分配量减去该节点上所有 Pod 的 requests 之和，得到剩余可分配。举例：某 worker 可分配 4 核，上面已调度三个 Pod、各请求 0.5 核，账本剩 2.5 核；这时一个新 Pod 声明 requests 3 核，账本装不下，被过滤。Pod 实际只用了 0.1 核也没用——只要它声明了 0.5，账本就记 0.5。",
    },
    {
      type: "paragraph",
      text: "这套「占座式」记账带来两个必然现象。一是超卖：同一节点上所有 requests 之和可以大于真实容量，只要实际用量不超就行，云厂商靠它提升密度；二是碎片化：占座不坐会浪费，而且把节点按请求量切碎之后，剩余片段常常凑不出一个大 Pod 需要的量，于是集群「看起来还有空间，却放不下」。所以 requests 不是越大越安全：设得过大浪费容量、制造碎片；设得过小，本课的账本会过分乐观，后面《HPA：按负载水平伸缩》一课里按平均利用率伸缩时也会失真。requests 是整座集群资源决策的锚点。",
    },
    {
      type: "heading",
      text: "实操：制造一次调度失败",
    },
    {
      type: "paragraph",
      text: "先看节点的家底。kind 三节点集群里，control-plane 节点默认带 node-role.kubernetes.io/control-plane 污点（下一课细讲），业务 Pod 上不去，所以真正的候选节点通常只有两个 worker。",
    },
    {
      type: "code",
      title: "查看节点与其可分配资源",
      language: "bash",
      code: `kubectl get nodes
kubectl describe node k8s-course-worker`,
    },
    {
      type: "paragraph",
      text: "describe 输出的 Allocatable 区块会列出该节点可分配的 CPU 与内存。接着部署一个「胃口超过任何单节点」的 Deployment——下面的清单请求 100 核与 96Gi 内存，远超本地 kind worker 的可分配量；如果你的机器配置惊人，把数值调大即可。演示对象用完即删，放在 default 命名空间，避免污染 shop。",
    },
    {
      type: "code",
      title: "scheduler-demo.yaml：一个注定调度失败的 Deployment",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: scheduler-demo
spec:
  replicas: 1
  selector:
    matchLabels:
      app: scheduler-demo
  template:
    metadata:
      labels:
        app: scheduler-demo
    spec:
      containers:
        - name: echo
          image: registry.k8s.io/echoserver:1.10
          resources:
            requests:
              cpu: "100"
              memory: 96Gi`,
    },
    {
      type: "paragraph",
      text: "应用后查看状态与事件：",
    },
    {
      type: "code",
      title: "应用并观察 Pending",
      language: "bash",
      code: `kubectl apply -f scheduler-demo.yaml
kubectl get pods -l app=scheduler-demo -o wide
kubectl describe pod -l app=scheduler-demo`,
    },
    {
      type: "paragraph",
      text: "预期看到：STATUS 停在 Pending，-o wide 的 NODE 列为 <none>；describe 的 Events 区域出现调度失败事件。下面专门讲怎么读这类事件。",
    },
    {
      type: "heading",
      text: "读 FailedScheduling 事件",
    },
    {
      type: "paragraph",
      text: "调度器每次尝试失败都会追加一条 reason 为 FailedScheduling 的 Warning 事件，消息形如：0/3 nodes are available: 1 node(s) had untolerated taint {node-role.kubernetes.io/control-plane: }, 2 Insufficient cpu。具体数字随集群而异，但结构是固定的，按三段读：",
    },
    {
      type: "list",
      items: [
        "0/3：候选节点共 3 个，可行的 0 个——分子是可行数，分母是候选总数；",
        "untolerated taint：control-plane 节点因为污点被剔除（污点与容忍是下一课的主题）；",
        "Insufficient cpu：两个 worker 的 requests 账本都放不下 100 核的请求——上一节记账规则的现场版。",
      ],
    },
    {
      type: "paragraph",
      text: "注意 Pod 会一直保持 Pending，调度器会持续重试：一旦有副本被删除、资源被释放或污点被移除，下一次评估就可能成功。反过来，只要事件里还在持续出现 FailedScheduling，就说明约束一直没被满足。看完清理现场：",
    },
    {
      type: "code",
      title: "清理演示对象",
      language: "bash",
      code: `kubectl delete -f scheduler-demo.yaml`,
    },
    {
      type: "paragraph",
      text: "想在自己已有的 shop-api 上体验同样的效果也可以：把它的 replicas 临时调大（例如 20），超过集群容量后多出的副本就会以同样的方式停在 Pending——前提是它的容器写了 requests。记得用完把副本数改回去。",
    },
    {
      type: "heading",
      text: "nodeName：为什么别把 Pod 钉死在节点上",
    },
    {
      type: "paragraph",
      text: "知道节点名之后，一个诱人的念头是绕过调度器：直接在 Pod 的 spec 里写 nodeName，比如「我就想让 shop-db 跑在 worker-1」。它能生效，但代价是把本课讲的所有机制全部短路：",
    },
    {
      type: "list",
      items: [
        "自愈失效：节点故障后，控制器重建的替代副本依然被钉死在故障节点上，永远 Pending——第 3 章辛苦建立的副本自愈完全作废；",
        "记账失效：直接指定的节点可能早就超卖，调度器不再替你把关资源；",
        "维护困难：第 10 章要学的节点维护（排空 drain）对这种 Pod 也会束手束脚，必须先解钉才能动节点。",
      ],
    },
    {
      type: "paragraph",
      text: "nodeName 只适合极少数系统级场景。想让 Pod 去某类节点，正确工具是下一课的 nodeSelector 与节点亲和；想让某类 Pod 进不了某节点，是污点。两者的共同点是：以声明式约束交给调度器执行，控制器重建副本时约束会被重新评估——故障自愈和放置意图才不会互相拆台。",
    },
    {
      type: "paragraph",
      text: "最后给调度器一个定位：它是控制面组件，如果它宕机，正在运行的 Pod 不受影响，但所有新 Pod 都会停在 Pending。它的高可用形态（多副本、通过租约选主，同一时刻只有一个实例在干活）与 etcd、控制器管理器一起，在第 9 章《高可用控制面：etcd 与选举》统一展开。",
    },
    {
      type: "quiz",
      question:
        "某 worker 可分配 4 核，上面已调度三个 Pod，各自 requests.cpu=0.5、limits.cpu=2，实际一共只用了 0.3 核。现在一个新 Deployment 的 Pod 声明 requests.cpu=3，调度器会把它放到这个节点吗？",
      options: [
        "会：实际用量才 0.3 核，空间绰绰有余",
        "会：三个 Pod 的 limits 共 6 核，说明节点还放得下",
        "不会：按 requests 记账剩余 2.5 核，装不下 3 核的请求",
        "不会：HPA 会先把副本数缩下来腾地方",
      ],
      answer: 2,
      explanation:
        "调度器的账本只认 requests：4 减去 3×0.5 等于 2.5 核，装不下 3 核请求，节点被过滤。实际用量不参与记账；limits 是 cgroup 硬顶，同样不参与调度记账；HPA 只管已运行副本的伸缩，与能否调度无关。",
    },
    {
      type: "quiz",
      question: "生产环境里，最不应该用 spec.nodeName 直接指定节点的原因是什么？",
      options: [
        "这样写会让 YAML 变长",
        "它绕过了调度器：节点故障后重建的副本仍被钉死在故障节点，自愈机制失效",
        "kubelet 不认设置了 nodeName 的 Pod",
        "只有集群管理员能设置该字段",
      ],
      answer: 1,
      explanation:
        "nodeName 让放置决定完全脱离调度器，而副本自愈依赖控制器重建后重新调度：被钉死的替代副本永远去不了别的节点。它不是语法或权限问题，而是把声明式约束换成了硬编码位置，因此是反模式。",
    },
    {
      type: "keypoints",
      items: [
        "调度分两步：先过滤（硬性可行性）再打分（软偏好），最后绑定＝写 spec.nodeName，kubelet 才真正动手。",
        "资源账本只记 requests 不记实际用量：超卖与碎片化是这套记账的必然结果。",
        "FailedScheduling 事件按「可行数/候选总数 + 逐条被过滤原因及数量」读。",
        "nodeName 绕过调度器是反模式；放置意图请用下一课的亲和与污点这类声明式约束表达。",
      ],
    },
  ],
};
