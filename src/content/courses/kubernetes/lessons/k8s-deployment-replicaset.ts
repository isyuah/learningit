/* ==================================================================
 * 课时：Deployment 与 ReplicaSet：副本从哪来（k8s-deployment-replicaset）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "从裸 Pod 的三种死法出发，理解 ReplicaSet 如何用期望副本数调谐自愈，以及 Deployment 为什么是管着 ReplicaSet 的控制器。",
  blocks: [
    {
      type: "paragraph",
      text: "上一章把 Pod 讲到了「最小调度单元」，但你也亲眼见过它有多脆弱：第 1 章《用 kind 起第一个集群》里 kubectl delete 掉的那个裸 Pod 再也没有回来。这不是操作失误——裸 Pod 背后没有任何对象在守护它。从本课开始的三课，我们给 Pod 逐层加上守护者：ReplicaSet 保证「数量」，Deployment 管理「版本」，StatefulSet、DaemonSet、Job 则处理各自特殊的工作负载形态。学完这一课，你应该能回答：一个 Pod 没了，到底是谁、凭什么把它补回来。",
    },
    {
      type: "heading",
      text: "裸 Pod 没有守护者：三种死法",
    },
    {
      type: "paragraph",
      text: "没有控制器时，Pod 的终结基本无法挽回。最常见的终结场景有三种：其一，节点宕机或失联，Pod 随节点一起消失，没有人会在别的节点重建它；其二，被人或脚本 delete，删除即结束；其三，容器反复崩溃或被 OOM 杀死——此时节点代理（kubelet）会按 restartPolicy 在同一 Pod 内重启容器（详见第 2 章《生命周期、重启与三种探针》），但 Pod 本身永远留在原地。如果镜像本身有问题，CrashLoopBackOff 可以无限循环下去，没有任何机制「换个地方重试」。",
    },
    {
      type: "callout",
      variant: "note",
      title: "两个自愈层面不要混淆",
      body: "restartPolicy 是 kubelet 在同一个 Pod 里重启「死掉的容器」，管进程；本课讲的控制器处理「整个 Pod 消失」（被删、节点故障），管数量。前者由第 2 章的 restartPolicy 决定，后者由工作负载控制器负责——两层叠加才是完整的自愈。",
    },
    {
      type: "heading",
      text: "ReplicaSet：把「要有 N 个副本」变成机制",
    },
    {
      type: "paragraph",
      text: "ReplicaSet 的核心只有三样东西：selector 声明「我管哪些 Pod」（按标签选择），template 声明「副本长什么样」（一份完整的 Pod 模板），replicas 声明「期望几个」。控制面里对应的控制器（第 1 章《集群解剖：一次部署请求的旅程》提到过控制器管理器）持续调谐：数一数当前匹配 selector 的 Pod 有几个，比期望值少就新建，比期望值多就删除。于是你删掉一个受管的 Pod，几秒内会出现一个全新的 Pod 补齐数量——注意是「新建一个」：被删的那个不会复活，新 Pod 的名字也不同。",
    },
    {
      type: "paragraph",
      text: "这正是第 1 章《对象模型》里「期望状态 + 调谐」心智模型的第一次真正落地：ReplicaSet 的 spec.replicas 是期望状态，控制器把「匹配 selector 的现存 Pod 数」这个实际状态不断拉回期望值。节点故障也同理：失联节点上的 Pod 被清理后（驱逐的时间线细节在第 10 章《节点维护》展开），ReplicaSet 会在其它节点把副本补回来。但请记住，它只保数量。",
    },
    {
      type: "heading",
      text: "Deployment：管理 ReplicaSet 的控制器",
    },
    {
      type: "paragraph",
      text: "直接用 ReplicaSet 有个尴尬：它的 template 一旦变化，控制器只会「按新模板把现有 Pod 全部换掉」，既没有渐进过程，也没有后悔药。而团队真正想声明的往往是「我要这个应用的某个版本跑几个副本」，不是「我要管理这组 Pod」。于是 Deployment 出现了：它自己不直接建 Pod，而是管理 ReplicaSet——spec 里同样有 selector、template、replicas，控制器用你的模板创建出一个 ReplicaSet（名字带模板哈希），由 ReplicaSet 负责具体副本的调谐。",
    },
    {
      type: "paragraph",
      text: "于是 shop-web 的声明链是：Deployment（期望 3 副本、模板是 nginx:1.27-alpine）→ ReplicaSet（把 3 落实到 Pod）→ Pod。每个下层对象都带 ownerReference 指向上层（级联删除的机制在第 9 章《控制器模式》展开），删除 Deployment 时，它的 ReplicaSet 与 Pod 会被连带清理。Deployment 里改 replicas 是扩缩容，改 template 则是「换版本」——后者会触发什么，是下一课《滚动更新、回滚与发布策略》的全部内容，本课先把这条链建立起来。",
    },
    {
      type: "code",
      title: "shop-web.yaml：三副本的 nginx 店面",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop-web
  namespace: shop
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shop-web
  template:
    metadata:
      labels:
        app: shop-web
    spec:
      containers:
        - name: shop-web
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80`,
    },
    {
      type: "paragraph",
      text: "注意 selector 与 template 里的 labels 必须匹配——Deployment 靠它认出「哪些 Pod 归我管」，这一关联机制在第 1 章《对象模型》讲过，第 4 章 Service 还会用同样的方式选择后端。ports 里的 containerPort 仍只是文档性字段（第 2 章讲过），nginx 镜像默认监听 80。apply 之后用下面一组命令观察三层对象与自愈过程。",
    },
    {
      type: "code",
      title: "观察副本与自愈",
      language: "bash",
      code: `kubectl apply -f shop-web.yaml
kubectl -n shop get deployments,replicasets,pods
kubectl -n shop get pods -l app=shop-web    # 记下一个 Pod 名
kubectl -n shop delete pod <pod-name>
kubectl -n shop get pods -l app=shop-web`,
    },
    {
      type: "paragraph",
      text: "预期特征：get deployments 的 READY 列出现 3/3；replicasets 里有一个名字形如 shop-web-<哈希> 的对象；pods 的名字形如 shop-web-<哈希>-<随机串>。手动删除一个 Pod 后，会先看到它进入 Terminating，随后出现一个名字全新的 Pod——数量始终回到 3。这与第 1 章里裸 Pod 被删后一去不返形成鲜明对比。",
    },
    {
      type: "heading",
      text: "扩缩容：声明式地改 replicas",
    },
    {
      type: "paragraph",
      text: "两种改法都合法：kubectl scale 直接写 scale 子资源；或者修改清单里的 replicas 再 kubectl apply。推荐后者——清单是团队里期望状态的唯一源头，直接改线上对象的话，下次 apply 旧清单会把改动覆盖回去（第 5 章《配置发布实践》会练 kubectl diff 与 dry-run）。下面命令先扩到 5 再缩回 3，观察 ReplicaSet 如何补齐与裁减。",
    },
    {
      type: "code",
      title: "声明式扩缩容",
      language: "bash",
      code: `kubectl -n shop scale deployment/shop-web --replicas=5
kubectl -n shop get pods -l app=shop-web
kubectl -n shop scale deployment/shop-web --replicas=3`,
    },
    {
      type: "heading",
      text: "READY 列背后的 status 字段",
    },
    {
      type: "paragraph",
      text: "get deployments 的 READY 列写作「可用/期望」，来自对象的 status：readyReplicas 是探针就绪的副本数，availableReplicas 则是「就绪且稳定超过 minReadySeconds 的副本数」。默认 minReadySeconds 为 0，此时两者相同；下一课让这个字段真正变得有意义。describe 一个 Deployment，底部能看到 Conditions（Available、Progressing 等），这是控制器报告健康状况的地方，第 11 章排障会反复读它。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "ReplicaSet 只保数量，不保质量",
      body: "如果镜像 tag 写错、应用持续 CrashLoopBackOff，ReplicaSet 会忠实地把崩溃的 Pod 一遍遍重建——数量永远满足，业务永远不可用。救业务的不是补副本，而是修正模板或回滚到好版本，这正是下一课的主题。",
    },
    {
      type: "quiz",
      question:
        "一个由 Deployment 管理、replicas: 3 的 shop-web 正在稳定运行（未处于发布中）。此时你 kubectl -n shop delete pod 删掉其中一个 Pod，接下来会发生什么？",
      options: [
        "该 Pod 不会复活——第 1 章裸 Pod 的删除语义对受管 Pod 同样生效",
        "ReplicaSet 控制器发现匹配 selector 的 Pod 数少于期望值 3，会新建一个 Pod 补齐，新 Pod 名字不同",
        "kubelet 会在同一节点重启被删 Pod 的容器，Pod 名字保持不变",
        "Deployment 控制器会因此把整个 ReplicaSet 回滚到上一个版本",
      ],
      answer: 1,
      explanation:
        "ReplicaSet 调谐的对象是「数量」：只要匹配 selector 的 Pod 数小于 spec.replicas，它就会创建新 Pod 补齐，所以 Pod 不是原样复活，而是以新名字重建——选项 A 错在把裸 Pod 的语义套到了受管 Pod 上。选项 C 描述的是容器进程崩溃时 kubelet 按 restartPolicy 做的同 Pod 重启，而 Pod 已被删除，kubelet 无从重启它。选项 D 中，回滚是 Deployment 对模板变更的响应，与本次删除无关。",
    },
    {
      type: "keypoints",
      items: [
        "裸 Pod 没有守护者：节点宕机、被删除都会让它永久消失；restartPolicy 只能在同一个 Pod 内重启容器。",
        "ReplicaSet 用 selector + template + replicas 声明期望副本数，控制器把实际数量调谐回期望值；它只保证数量，不保证质量。",
        "Deployment 是 ReplicaSet 的控制器：它管版本与副本数，Pod 由它间接管理；删除上层对象会沿 ownerReference 级联清理下层对象。",
      ],
    },
  ],
};
