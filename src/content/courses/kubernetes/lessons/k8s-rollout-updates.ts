/* ==================================================================
 * 课时：滚动更新、回滚与发布策略（k8s-rollout-updates）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "上一课遗留的问题是「改模板之后怎么换」：用 maxSurge/maxUnavailable 控制滚动节奏，用就绪探针与 minReadySeconds 给发布装刹车，失败时用 rollout undo 回滚。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课结尾留了个问题：Deployment 里改 template 就是「换版本」，但怎么换？最原始的做法是先把旧 Pod 全部删掉、再按新模板全部拉起——全量替换。假如 shop-api 有 4 个副本正在服务请求，这么做意味着一个明确的停机窗口：旧副本删光到新副本就绪之前，服务整体不可用。本课讲 Kubernetes 默认采用的滚动更新（rolling update）如何用「分批、新旧并存、探针把关」消除这个窗口，以及发布失败后如何回滚。",
    },
    {
      type: "heading",
      text: "两种更新策略：Recreate 与 RollingUpdate",
    },
    {
      type: "paragraph",
      text: "Deployment 的 spec.strategy 只有两种取值。Recreate 的语义是：先删光旧 Pod，再创建新 Pod——实现最简单，代价是更新期间服务不可用。RollingUpdate 是默认策略：先起新的、逐步替换旧的，全程保持有副本可用。判断标准很简单：新旧版本能否在集群里并存？能，就用 RollingUpdate；不能（独占端口、独占文件锁、有状态单实例这类场景），才退回 Recreate。",
    },
    {
      type: "table",
      caption: "两种更新策略对比",
      headers: ["维度", "Recreate", "RollingUpdate"],
      rows: [
        ["过程", "先删光旧 Pod 再建新 Pod", "新副本分批拉起，就绪后逐个替换旧副本"],
        ["停机", "存在完整停机窗口", "发布期间始终有可用副本"],
        ["资源峰值", "不超量", "可能短暂超过期望副本数（受 maxSurge 约束）"],
        ["适合", "新旧无法并存的场景", "绝大多数无状态服务的默认选择"],
      ],
    },
    {
      type: "heading",
      text: "两个 25%：maxSurge 与 maxUnavailable",
    },
    {
      type: "paragraph",
      text: "滚动节奏由两个约束决定，都可以写成百分比或绝对副本数。maxSurge：更新过程中允许超出期望副本数的比例上限——它决定了「最多能多起几个新的」，也就是先扩容的额度；maxUnavailable：更新过程中允许不可用副本的比例上限——它保证了「至少还有多少旧副本在服务」，即缩容不能过头。两者默认都是 25%。百分比按期望副本数换算后取整：maxSurge 向上取整，maxUnavailable 向下取整。",
    },
    {
      type: "paragraph",
      text: "以 4 副本、默认 25%（各相当于 1 个）为例，滚动是「先扩容、后缩容」的循环：新的 ReplicaSet 先多拉起 1 个新副本，等它通过就绪探针，才把旧 ReplicaSet 缩掉 1 个，如此往复。整个过程中 Pod 总数最多 5（125%），可用副本始终不少于 3（75%）。这就是「先扩容还是先缩容」的答案：默认语义下永远先给新的留出空间，而不是先缩旧的造成容量缺口。",
    },
    {
      type: "heading",
      text: "探针与 minReadySeconds：给发布装刹车",
    },
    {
      type: "paragraph",
      text: "光有配额，控制器怎么判断「新副本可以开始替换旧的了」？答案是就绪探针（readiness probe；三种探针的语义见第 2 章《生命周期、重启与三种探针》）：新 Pod 只有探针通过才被计入 ready，也才会被 Service 选为后端（第 4 章《Service》一课展开）。新副本不就绪 → 控制器认为替换条件不满足 → 不缩旧副本 → 滚动停在那里等待。所以探针是发布的刹车：没有探针的滚动，控制器只能靠「容器起来了」判断成功，等于盲发。",
    },
    {
      type: "paragraph",
      text: "光就绪还不够——有些应用启动后头几秒能应答，随后才因依赖未就绪而失败。minReadySeconds 要求新副本把就绪状态稳定保持 N 秒，才被 Deployment 计入可用——上一课 status 里的 availableReplicas 字段在这里派上用场，防止「假就绪」造成滚动看似完成、随即整体雪崩。配套的还有 progressDeadlineSeconds（默认 600s）：滚动若在期限内没有任何进展（典型场景：新副本一直不就绪），Deployment 会把 Progressing 条件标记为超时。注意它只「报告」，不会自动回滚——声明式系统不替你猜。",
    },
    {
      type: "callout",
      variant: "note",
      title: "预告：发布约束与节点维护是同一套思路",
      body: "本课的两个 25% 只约束「发布过程中」的副本下线。第 10 章《节点维护：cordon、drain 与故障自愈》会引入 PodDisruptionBudget（PDB），把「最少可用」这类约束扩展到节点排空等自愿中断场景——滚动发布与节点维护都会尊重它。",
    },
    {
      type: "heading",
      text: "完整演练：给 shop-api 做一次带刹车的发布",
    },
    {
      type: "paragraph",
      text: "演示对象是 shop-api——模拟接口服务，镜像 registry.k8s.io/echoserver:1.10，监听 8080。下面的清单把 4 副本、默认 25% 策略、10 秒 minReadySeconds 与就绪探针配齐，这是「生产可用的最小发布配置」：探针负责判断新副本能不能接流量，minReadySeconds 负责防止假就绪，两个 25% 负责控制替换节奏。",
    },
    {
      type: "code",
      title: "shop-api.yaml（v1）",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-api
  namespace: shop
spec:
  replicas: 4
  selector:
    matchLabels:
      app: shop-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%
      maxUnavailable: 25%
  minReadySeconds: 10
  template:
    metadata:
      labels:
        app: shop-api
    spec:
      containers:
        - name: shop-api
          image: registry.k8s.io/echoserver:1.10
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /
              port: 8080`,
    },
    {
      type: "paragraph",
      text: "本地 kind 没有第二个真实的业务镜像，所以我们用「给容器加一个 VERSION 环境变量」代表一次模板变更——滚动的机制与换镜像完全一致；真实发布时把 image 换成新 tag 即可（例如 registry.example.com/team/shop-api:v1.2.3，这是示例地址，仅作演示写法）。操作：给上面清单的 containers[0] 加上 env（VERSION=v2），保存后再次 apply，然后观察滚动。",
    },
    {
      type: "code",
      title: "发布 v2 并观察滚动",
      language: "bash",
      code: `kubectl apply -f shop-api.yaml
kubectl -n shop rollout status deployment/shop-api
kubectl -n shop get pods -l app=shop-api
kubectl -n shop get replicasets -l app=shop-api`,
    },
    {
      type: "paragraph",
      text: "预期特征：rollout status 先输出等待滚动完成的进度类信息，完成后提示发布成功；get pods 能看到新旧两批名字前缀（模板哈希）不同的 Pod 短暂并存，旧 Pod 逐个进入 Terminating；get replicasets 能看到两个 ReplicaSet——新的在扩容，旧的缩到 0 个副本但保留着。保留旧 RS 是回滚的资本，原因见下文。",
    },
    {
      type: "heading",
      text: "历史、回滚与 revision",
    },
    {
      type: "paragraph",
      text: "kubectl rollout history 列出历次 revision——每次模板变更产生一个新 revision。回滚用 kubectl rollout undo：它把模板「改回上一个 revision」并重新走一次滚动。回滚本质上就是一次方向相反的发布，不是什么特殊操作；undo 之后 history 里会出现一个新的 revision，其模板内容与旧版本一致——revision 计数只增不减。旧 ReplicaSet 之所以保留，是为了让回滚不必重新构造历史；revisionHistoryLimit 默认 10，即最多保留 10 个历史 revision 对应的旧 ReplicaSet。",
    },
    {
      type: "code",
      title: "回滚操作",
      language: "bash",
      code: `kubectl -n shop rollout history deployment/shop-api
kubectl -n shop rollout undo deployment/shop-api
kubectl -n shop rollout status deployment/shop-api`,
    },
    {
      type: "paragraph",
      text: "再做一个失败的演练：kubectl -n shop set image deployment/shop-api shop-api=registry.example.com/team/shop-api:v2.0.0（示例地址，本地不存在这个镜像），观察会发生什么。预期特征：新 Pod 拉镜像失败、反复 ImagePullBackOff，永不就绪，因此旧副本一个都不缩——线上服务不受影响；rollout status 会一直等待，直到 progressDeadlineSeconds（默认 600s）超时后被标记为失败。此时执行 kubectl -n shop rollout undo deployment/shop-api 一键回到上一个版本。说明：kubectl set image 是「改模板 image 字段并提交」的快捷命令，工程上建议直接改清单后 apply，语义一致。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "卡住的发布不会自己好",
      body: "进度超时只被「报告」，Deployment 不会自动回滚，也不会自动继续。上线窗口内发现发布没有进展，标准动作是查新 Pod 的事件与日志定位原因（方法见第 11 章排障课），必要时手动 undo——不要把卡住的发布留到明天。",
    },
    {
      type: "heading",
      text: "蓝绿与金丝雀：滚动之外的朴素策略",
    },
    {
      type: "paragraph",
      text: "滚动更新是「新旧交替」，另外两种常被提起的朴素策略是：蓝绿——同时运行完整的两套版本，流量一次性从蓝切到绿，回滚就是切回去，代价是双倍资源；金丝雀——先让新版本接一小部分流量验证，再逐步放大。两者共同的前提是能同时运行两个版本、且流量可以按批或按比例切换——这正是 Service/入口层的职责，真实灰度还需要额外工具（Argo Rollouts、服务网格一类，点到为止）。对大多数后端服务，Deployment 默认的滚动更新已经够用；蓝绿与金丝雀留给发布平台建设者。",
    },
    {
      type: "quiz",
      question:
        "shop-api 有 4 个副本，采用默认的 25%/25% RollingUpdate 发布新版本。滚动期间就绪探针对新版本持续失败（旧版本一切正常）。以下哪个描述正确？",
      options: [
        "新副本始终不就绪，Deployment 会继续把旧副本全部缩掉，优先保证新版本尽快上线",
        "滚动会卡住：新副本不就绪，旧副本保持提供服务；超过 progressDeadlineSeconds（默认 600s）后 rollout 被标记超时，但不会自动回滚",
        "progressDeadlineSeconds 一到，Deployment 会自动执行 rollout undo 回到上一版本",
        "kubelet 检测到新副本不就绪，会自动把 Deployment 暂停（pause）",
      ],
      answer: 1,
      explanation:
        "就绪探针失败意味着新副本永远不算 ready，控制器因此不会缩旧副本（缩旧的前提是新副本已就绪，且要维持 maxUnavailable 约束），滚动停在原地，旧副本继续服务——选项 A 与 maxUnavailable 的语义直接冲突。卡住超过 progressDeadlineSeconds 后，Deployment 只是把 Progressing 条件标记为超时并报告，声明式系统不会自作主张回滚，所以 B 对、C 错。D 中 pause 是人工执行的发布暂停操作，不是 kubelet 的自动行为。",
    },
    {
      type: "keypoints",
      items: [
        "滚动更新用 maxSurge 与 maxUnavailable 两个约束（默认各 25%）表达「先多起、再少停」的节奏，发布期间始终有可用副本；Recreate 只留给新旧无法并存的场景。",
        "就绪探针 + minReadySeconds 是发布的刹车：新副本不稳定，旧副本就不让走；卡住由 progressDeadlineSeconds（默认 600s）暴露，回滚由人用 rollout undo 执行。",
        "回滚 = 把模板改回上一个 revision；历史 revision 由旧 ReplicaSet 承载，revisionHistoryLimit 默认保留 10 个。",
      ],
    },
  ],
};
