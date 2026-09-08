/* ==================================================================
 * 课时：排障工具箱：状态、事件与 describe（k8s-debug-toolkit）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "立起「先读状态、再猜原因」的排障原则，配齐 get、describe、events、jsonpath 与 explain 这套读取证据的工具。",
  blocks: [
    {
      type: "paragraph",
      text: "前面章节的练习里，你遇到报错时多半会重试一次、再不行就删掉重建。但对真正的问题，重试不会让它消失——它会留下状态：Pod 停在某个阶段、对象带着某个条件、事件里记着一行原因。排障要做的第一件事不是修，而是把这些状态读出来。这一课把排障的第一原则立起来：先读状态，再猜原因；同时配齐读取状态所需的工具，并给出贯穿本章的方法论骨架「症状 → 证据 → 假设 → 验证」。后面几课的 Pod 排障、网络排障与故障演练，都是这套骨架的实例。",
    },
    {
      type: "heading",
      text: "排障四步：症状 → 证据 → 假设 → 验证",
    },
    {
      type: "paragraph",
      text: "大多数排障失误不是不会命令，而是跳过证据直接进入假设——「我觉得是网络问题」「可能是镜像坏了」。四步走能强制你按顺序收敛：",
    },
    {
      type: "list",
      items: [
        "症状：用户或监控报告的现象（页面打不开、请求超时、Pod 起不来）。只记录现象，不写结论。",
        "证据：用工具采集当前状态（状态列、事件、日志、字段值）。证据要可复述、可对比、可交给别人复核。",
        "假设：基于证据提出最可能的原因。假设必须能被证据检验，而不是来自经验直觉。",
        "验证：用最小动作检验假设——改一处、查一个端点、复现一次。验证通过才动手修复，修复完再验证一次。",
      ],
    },
    {
      type: "paragraph",
      text: "每一步的证据都会把可能的原因空间砍掉一大半：状态列排除了「没在跑」、事件排除了「没人碰过它」、日志排除了「进程正常」。这一课先把工具认全并讲清每个工具回答什么问题，下一课开始就是用它们在真实故障上收敛。",
    },
    {
      type: "heading",
      text: "kubectl get：先回答「现在是什么状态」",
    },
    {
      type: "paragraph",
      text: "排障的第一条命令永远是 get，不是 describe、更不是删掉重建。get 输出的是对象的「病情摘要」——Pod 的 STATUS 列（Pending、Running、CrashLoopBackOff……）直接告诉你它卡在哪一层，READY 列（如 1/1、0/1）告诉你容器与就绪的比例，RESTARTS 告诉你重启了多少次。加 -o wide 会补出所在节点与 IP 等扩展列，排查时几乎总是需要。",
    },
    {
      type: "code",
      title: "状态摘要三件套",
      language: "bash",
      code: `kubectl get pods -n shop
kubectl get pods -n shop -o wide
kubectl get nodes
kubectl get all -n shop`,
    },
    {
      type: "paragraph",
      text: "`kubectl get all -n shop` 是对命名空间内工作负载与 Service 的快捷盘点（Deployment、ReplicaSet、Pod、StatefulSet、Job、DaemonSet 等），但它不含 ConfigMap、Secret、PVC 这类非工作负载对象——盘点配置与存储要用 `kubectl get configmap,secret,pvc -n shop` 单独列。看节点时留意 STATUS 是否为 Ready：节点 NotReady 时，上面的 Pod 会处于无法调度或等待重建的状态，这往往是「大面积故障」的总根源。",
    },
    {
      type: "heading",
      text: "describe：再回答「为什么是这种状态」",
    },
    {
      type: "paragraph",
      text: "get 回答「是什么状态」，describe 回答「为什么会这样」。describe 把对象展开成三个区块，按顺序读即可：",
    },
    {
      type: "list",
      items: [
        "区块一·字段快照：对象当前的 spec 与 status 摘要，包括容器镜像、容器状态与重启次数、探针与资源字段、挂载的卷、QoS、被调度到的节点。这里能看出「定义长什么样、现在跑到哪一步」。",
        "区块二·条件（Conditions）：一组「是否型」结论，例如 Pod 的 PodScheduled、Initialized、ContainersReady、Ready。每个条件带 status、reason 与 message——Pod 不 Ready 时，reason 往往直接指向探针失败，message 补充细节。",
        "区块三·事件（Events）：与该对象相关的最近事件时间线，由调度器、kubelet 等组件按时间写入。describe 里的事件是便捷视图，行数有限，想看得全要用下一节的 get events。",
      ],
    },
    {
      type: "code",
      title: "describe 支持 -l 选择器，不用先抄 Pod 名",
      language: "bash",
      code: `kubectl describe pods -n shop -l app=shop-api`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "条件与事件的分工",
      body: "Conditions 是「当前结论」（Ready=False、reason=ProbeError），Events 是「过程记录」（什么时候发生了什么事）。结论告诉你该往哪查，过程告诉你这件事是突然出现还是一直如此——两个区块对着看，绝大多数 Pod 问题的方向就定了。",
    },
    {
      type: "heading",
      text: "Events：对象的时间线",
    },
    {
      type: "paragraph",
      text: "事件（Event）是集群各组件写给对象的小纸条：类型（Normal / Warning）、reason（简短机器码，如 FailedScheduling、BackOff）、message（给人类读的细节）与发生次数。它们回答的问题是「什么东西变了、是谁动的」——调度器拒绝时写 FailedScheduling，kubelet 反复拉不到镜像时写拉取失败。注意两点：事件默认只保留约 1 小时（apiserver 的 --event-ttl 默认 1h，之后清理），所以它是排障现场的第一手线索，不是审计记录；想要追溯更早的变更，得靠《集群可观测：指标、事件与日志》一课讲的指标与日志平台。",
    },
    {
      type: "code",
      title: "全量看事件：按时间排序、实时跟随",
      language: "bash",
      code: `kubectl get events -n shop --sort-by=.metadata.creationTimestamp
kubectl get events -n shop -w`,
    },
    {
      type: "paragraph",
      text: "事件很多时优先看 Warning 类型与最新时间戳，再把同一对象的 describe 与事件对照。事件里出现的 reason 是机器可读的稳定标识，后面两课会反复用到：FailedScheduling 指向调度、拉取失败指向镜像、BackOff 指向容器反复退出。",
    },
    {
      type: "heading",
      text: "精确取字段：-o yaml、jsonpath 与 explain",
    },
    {
      type: "paragraph",
      text: "describe 是给人类看的摘要，脚本、对比与精确取值要用原始字段。`-o yaml` 输出对象的完整定义，包含 status——保存现场、diff 前后差异都靠它；`-o jsonpath` 从一堆对象里抽单个值，适合快速比较或喂给脚本；`kubectl explain` 是集群内置的字段文档——记不清某个字段的类型与语义时，先在集群里查，不必翻网页。",
    },
    {
      type: "code",
      title: "读原始字段与字段文档",
      language: "bash",
      code: `# 完整对象（含 status）
kubectl get pods -n shop -l app=shop-api -o yaml

# 只取每个 Pod 的阶段
kubectl get pods -n shop -l app=shop-api -o jsonpath='{.items[*].status.phase}'

# 只取每个 Pod 的 IP
kubectl get pods -n shop -l app=shop-api -o jsonpath='{.items[*].status.podIP}'

# 字段自文档：不用背字段表
kubectl explain deployment.spec.strategy
kubectl explain pod.spec.containers.readinessProbe`,
    },
    {
      type: "callout",
      variant: "tip",
      title: "不确定字段就先 explain",
      body: "排障时最怕「凭印象改字段」。改任何 spec 之前，先用 explain 确认字段存在、类型正确、默认值是什么——很多「改了没用」其实是字段名拼错，apiserver 校验通过但语义完全不对。",
    },
    {
      type: "heading",
      text: "进入现场：logs、exec 与调试容器",
    },
    {
      type: "paragraph",
      text: "状态与事件告诉你「容器崩了」，日志告诉你「为什么崩」。具体用法在第 2 章《Pod 日常操作：日志、进入与调试》已展开，这里只把每个工具在排障框架里的位置点一遍：",
    },
    {
      type: "list",
      items: [
        "kubectl logs：看容器输出。崩溃容器加 --previous 看上一次运行的输出，--tail 限制行数，-f 实时跟随。",
        "kubectl exec：进入运行中的容器执行命令，用于自测探针端点、观察进程现场。",
        "kubectl port-forward：把远端端口映射到本地，绕过集群网络直接调后端，适合验证「应用本身通不通」。",
        "kubectl debug：为运行中的 Pod 挂临时容器（ephemeral container），业务镜像里没有 shell 时靠它进场观察——这是排障场景的救命工具。",
      ],
    },
    {
      type: "paragraph",
      text: "工具链齐全不等于可以乱试。每个工具服务框架中的一步：get 与 describe 采集证据，logs 与 exec 验证假设。一上来就 exec 进去翻文件，等于在没读状态前先猜——方向错了，翻得越深越浪费时间。",
    },
    {
      type: "table",
      caption: "问题 → 工具对照表",
      headers: ["你想回答的问题", "首选工具", "答案长什么样"],
      rows: [
        ["现在处于什么状态", "kubectl get … -o wide", "STATUS / READY / RESTARTS 与所在节点"],
        ["为什么会是这种状态", "kubectl describe / kubectl get events", "条件 reason + 事件时间线"],
        ["完整字段与精确值长什么样", "-o yaml / -o jsonpath", "对象原始字段（含 status）或单个值"],
        ["某个字段是什么意思", "kubectl explain", "字段类型、默认值与语义"],
        ["进程内部在发生什么", "logs / exec / kubectl debug", "应用日志与运行现场"],
      ],
    },
    {
      type: "quiz",
      question: "某 Pod 处于 Running、READY 0/1，RESTARTS 没有增长。要弄清「为什么不 Ready」，第一步最合适的证据采集是？",
      options: [
        "直接 kubectl delete 重建，看会不会恢复",
        "kubectl describe 看 Ready 条件与事件，再对照探针配置自测端点",
        "修改 Deployment 镜像版本重新发布",
        "去查 kube-apiserver 的日志",
      ],
      answer: 1,
      explanation: "Ready 条件为 False 时，reason 会直接指向探针失败并给出事件，自测端点用于验证假设——证据先于动作。删除重建会丢现场，改镜像引入新变量，而单 Pod 的就绪问题与 apiserver 日志无关。这也正是四步框架的意义：每一步先取证据，再决定动作。",
    },
    {
      type: "keypoints",
      items: [
        "排障四步：症状 → 证据 → 假设 → 验证，证据永远先于结论",
        "kubectl get 看状态摘要，-o wide 补节点与 IP 列；get all 不含 ConfigMap/Secret/PVC",
        "describe 按「字段快照 / 条件 / 事件」三区块阅读，条件里的 reason 常直接指向根因",
        "Events 是组件写给对象的时间线，默认约 1 小时保留；它是现场线索，不是审计记录",
        "-o yaml / jsonpath 取精确字段，kubectl explain 是集群内置的字段文档",
        "logs / exec / port-forward / kubectl debug 用于验证假设，不要跳过状态直接乱试",
      ],
    },
  ],
};
