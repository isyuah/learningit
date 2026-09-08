/* ==================================================================
 * 课时：控制器模式：watch、调谐与 finalizer（k8s-controllers-internals）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "拆开控制器黑盒：list-watch 如何触发调谐、为什么调谐天然自愈、ownerReference 级联删除与 finalizer 如何完成一次有清理的删除。",
  blocks: [
    {
      type: "paragraph",
      text: "从第 1 章《对象模型：声明式、spec 与调谐循环》起，「控制器把实际状态拉回期望状态」这句话反复出现：删一个副本会自动补、改了镜像会自动滚动。本课把控制器当成一类普通程序解剖：它内部循环长什么样、为什么被设计成「反复对比」而不是「精确执行指令」、删除对象时那串连带清理又是谁做的。学完你会理解两个常驻问题的答案：为什么控制器崩溃后一切还能收敛，以及命名空间为什么有时会卡在 Terminating。",
    },
    {
      type: "heading",
      text: "控制器 = watch → 工作队列 → 调谐 → 更新状态",
    },
    {
      type: "paragraph",
      text: "控制器管理器（kube-controller-manager）里运行着几十个控制循环，每个只关心一小类对象：Deployment 控制器管 Deployment，ReplicaSet 控制器管 RS，EndpointSlice 控制器管 Service 的后端列表。它们的骨架完全相同，都可以概括为四步：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "watch：用上一课的 list-watch 订阅自己关心的对象（以及它管辖的下游对象）",
        "入队：任何相关变化——创建、更新、删除，甚至周期性重扫——变成一个待办进入工作队列",
        "调谐（reconcile）：取出待办，读取期望状态（spec）与当前状态（status 与现实），执行必要的创建、更新或删除，把现实拉向期望",
        "更新状态：把收敛结果写回对象的 status，让用户与上层机制可观察",
      ],
    },
    {
      type: "paragraph",
      text: "关键认知：事件的意义只是「提醒我去看一眼」，真正干活的是调谐这一步。文档里常说的「控制器是 spec 与现实之间的调谐器」，指的就是这第三步。",
    },
    {
      type: "heading",
      text: "为什么是「反复调谐」而不是「按事件精确操作」",
    },
    {
      type: "paragraph",
      text: "设想一种事件驱动的写法：收到「Pod 被删」就「创建一个 Pod」。一旦事件丢失、顺序错乱，或进程在事件处理到一半时崩溃，状态就永远错了。调谐的思路完全不同：它不依赖事件历史，每次只回答一个问题——「期望的与现实的差多少，补齐」。于是：",
    },
    {
      type: "list",
      items: [
        "幂等：同一件事重复执行，结果不变",
        "崩溃恢复天然成立：进程重启后，任何一次触发都会重新全量对比并收敛",
        "丢事件无害：错过再多次变化，下一次对比照样把状态拉回正轨",
      ],
    },
    {
      type: "paragraph",
      text: "「自愈」与「调谐」其实是同一件事：第 3 章《Deployment 与 ReplicaSet》里，kubectl delete 掉 shop-api 的一个 Pod 后几秒出现新 Pod——那不是删除事件被精确补偿，而是 RS 控制器在任意触发下发现「现存 2 个、期望 3 个」，默默补了 1 个。你手动 kubectl scale、节点故障导致副本消失，走的是同一条路径，控制器根本不需要区分「为什么会少」。",
    },
    {
      type: "callout",
      variant: "note",
      title: "informer：别让控制器压垮 apiserver",
      body: "如果每个控制器都直接向 apiserver 发起读请求，控制面会把自己压垮。客户端库因此封装了 informer 模式：list-watch 之外，把对象缓存到本地内存，控制器读缓存、只在真正写时才请求 apiserver；watch 断线自动重连重列。代价是缓存有几秒延迟——换来 apiserver 负载与读放大都极小。这就是上一课 list-watch 机制存在的直接理由。",
    },
    {
      type: "heading",
      text: "ownerReference：对象间的父子关系与级联删除",
    },
    {
      type: "paragraph",
      text: "为什么删除 Deployment 时 RS 和 Pod 会成串消失，而不是留下孤儿？答案在属主引用（ownerReference）：被创建的「孩子」在自己的 metadata.ownerReferences 里记录「我是谁创建的」。第 3 章讲过 Deployment 是 RS 的控制器、RS 是 Pod 的控制器，ownerReference 就是这个关系的落点——Pod 的名字里带着 RS 的哈希，正是 RS 创建它时留下的印记。",
    },
    {
      type: "paragraph",
      text: "控制器管理器里的垃圾回收器（garbage collector）专职处理删除：owner 被删时，它按删除传播策略清理后代。策略有 background（先删 owner，再在后台清掉后代）与 foreground（先清完后代再删 owner），也可以选 Orphan——断开父子关系但不删除后代。所以 `kubectl delete deployment shop-api` 之后，RS 与 Pod 会相继消失，你不必挨个清理。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "级联删除的边界：数据卷不跟 Pod 走",
      body: "级联删除清理的是「受管对象」，不是所有相关资源。StatefulSet 的 PVC 由 volumeClaimTemplate 创建，但删除 StatefulSet 不会删 PVC——第 3 章《StatefulSet：有状态应用的秩序》里说过，删 STS 是「有序删 Pod、卷保留」。判断谁能被级联删除，就看对象之间有没有 ownerReference 这条链，而不是看名字像不像。",
    },
    {
      type: "heading",
      text: "finalizer：删除前的清理钩子与 Terminating 之谜",
    },
    {
      type: "paragraph",
      text: "有些对象在消失之前必须做外部清理：云盘要解挂、负载均衡器要释放、外部 DNS 记录要删除。这些事 apiserver 自己不会做，Kubernetes 的答案是终结器（finalizer）：metadata.finalizers 里列出「删除前必须完成的事」，删除流程变成：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "收到 delete 请求时，若对象带 finalizer，apiserver 并不立即删除，而是先写入 metadata.deletionTimestamp——删除已请求的时间戳，对象留在系统里",
        "拥有该 finalizer 的控制器观察到 deletionTimestamp 出现，执行自己的清理动作（释放外部资源、通知上游系统）",
        "清理完成后，控制器更新对象，把自己负责的那条 finalizer 从列表里移除",
        "最后一个 finalizer 移除后，对象才真正从集群消失",
      ],
    },
    {
      type: "paragraph",
      text: "deletionTimestamp 一句话总结：删除已被请求、但尚未完成。任何带 finalizer 的对象，在 finalizer 清空前都处于「将删未删」状态——你 kubectl get 仍看得到它。",
    },
    {
      type: "paragraph",
      text: "命名空间卡在 Terminating 的最常见原因由此而来：namespace 的删除要等其中所有对象清空，而某个对象带着 finalizer、对应的清理控制器却已不存在（典型场景：自建 CRD 的实例，加上一个没在运行的清理逻辑）。排查方法是先 `kubectl get ns <名称> -o yaml` 看状态，再逐个资源类型找出残留 finalizer 的对象。强行把 finalizers 置空能让它消失，但那会跳过外部清理——生产环境可能留下孤儿云盘，动手前务必先搞清楚这条 finalizer 的职责属于谁。",
    },
    {
      type: "heading",
      text: "status：控制器的输出，也是你的观察窗口",
    },
    {
      type: "paragraph",
      text: "调谐循环还有一项例行工作：把收敛进度写进 status——availableReplicas、conditions、observedGeneration 这些字段都是控制器在写。第 3 章你看 `kubectl get deployment` 的 READY 列、第 7 章 HPA 看 ready 副本数决定伸缩，读的都是控制器的输出。反过来，清单里手写的 status 会被忽略或覆盖——这解释了为什么 kubectl apply 的 YAML 只描述 spec，期望状态是你的，现实状态是控制器的。",
    },
    {
      type: "paragraph",
      text: "最后别忘了：控制器模式并不只在控制面。节点代理（kubelet）就是一台「单节点控制器」——它 watch 本节点被分配的 Pod，把容器现实（镜像有没有、容器活没活、探针通不通）持续拉向 Pod 的 spec，第 2 章讲的生命周期与重启语义全部由它在调谐。理解了这一点，整个课程的「声明式」心智就统一了：无论对象是 Deployment、Pod 还是 Service，背后都有一个循环在看、在比、在拉。",
    },
    {
      type: "code",
      title: "在集群里观察这三样东西",
      language: "bash",
      code: `# 每个 RS 的 metadata.ownerReferences 指向它的 Deployment（若本地没有 shop 资源，换成任意对象）
kubectl get rs -n shop -o yaml
# Pod 的 ownerReferences 指向 RS：级联删除链条的实证
kubectl get pods -n shop -o yaml
# finalizer 与 deletionTimestamp 字段的自文档
kubectl explain Pod.metadata.finalizers
kubectl explain Pod.metadata.deletionTimestamp`,
    },
    {
      type: "quiz",
      question: "某控制器因网络分区错过了一段时间内的全部事件，分区恢复后它最应该做什么？",
      options: [
        "尝试回放错过的每个事件并逐一补偿",
        "忽略：既然错过了，就等下一个事件再说",
        "重新对比期望状态与当前状态，补齐差异即可",
        "把依赖它的所有对象删掉重建",
      ],
      answer: 2,
      explanation: "调谐不依赖事件历史，恢复后重新对比 spec 与现实就能收敛——这是它相对事件驱动设计的核心优势。选项 A 回到事件驱动的脆弱思路；选项 B 会把状态错误无限期留到下次触发，而触发不一定再来；选项 D 是无谓的破坏性操作。",
    },
    {
      type: "quiz",
      question: "一个命名空间长期卡在 Terminating，最可能的原因是？",
      options: [
        "命名空间的 spec 写错了字段",
        "里面有对象带着 finalizer，而负责清理它的控制器没有运行或没完成清理",
        "etcd 存储已满，写不进去",
        "需要重启 apiserver 才能继续删除",
      ],
      answer: 1,
      explanation: "namespace 删除要等其中对象清空；带 finalizer 的对象会一直「将删未删」，若清理控制器缺失，删除就永远卡住——这是最常见原因。选项 A 中 spec 错误在创建时就会被校验拦住；选项 C、D 不是 namespace 删除流程的环节，重启 apiserver 也不会替谁执行 finalizer 清理。",
    },
  ],
};
