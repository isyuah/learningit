/* ==================================================================
 * 课时：DaemonSet：每个节点恰好一个（k8s-daemonset）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Deployment 按副本数散布、StatefulSet 按序号排队；DaemonSet 回答另一个问题——「每个节点都需要的那个副本」。本课讲它的用途画像、调度语义与选型判据。",
  blocks: [
    {
      type: "paragraph",
      text: "前几课的工作负载都以「副本数」为期望：Deployment 说我要几个，StatefulSet 说我要有序的几个。但有一类组件，期望状态不是「几个」，而是「每个节点恰好一个」——日志采集器要在每个节点上读日志，监控探针要看到每个节点，网络插件要在每个节点上转发数据包。这类需求由 DaemonSet 表达。你在 kind 集群里其实早就见过它：kube-system 命名空间里的 kube-proxy 与 kindnet 都是以 DaemonSet 形态跑的（kube-proxy 的职责见第 4 章《网络模型》，CNI 实现细节本课不展开）。",
    },
    {
      type: "heading",
      text: "用途画像：节点级能力，不是业务副本",
    },
    {
      type: "list",
      items: [
        "日志采集：把每个节点上所有 Pod 的 stdout 日志捞走（与第 11 章《集群可观测》呼应）。",
        "监控探针：在每个节点暴露/采集节点与容器的资源指标。",
        "网络插件与网络代理：在每个节点上执行转发、NAT 等数据面工作（kube-proxy、CNI 插件）。",
        "存储/安全等节点代理：挂载节点存储、执行节点级安全策略的一类插件。",
      ],
    },
    {
      type: "paragraph",
      text: "它们的共同点：数量不由流量决定，而由「节点存在」决定；少一个节点副本，那一整类能力就在该节点缺失。比如日志采集 DaemonSet 漏了某个节点，就等于那个节点上所有容器的日志都没有出口。业务服务（shop-web、shop-api）则相反——副本数随负载伸缩，没必要也不应该每节点强塞一个。",
    },
    {
      type: "heading",
      text: "调度语义：节点增删自动跟随",
    },
    {
      type: "paragraph",
      text: "DaemonSet 的控制器为每个「符合条件的目标节点」创建一个 Pod，因此它的期望副本数等于目标节点数，而不是清单里的某个数字。两个推论很关键：新节点加入集群，控制器自动在新节点补一个副本，不需要人工 scale；节点被删除，它上面的 DaemonSet Pod 也随之清理，不存在「孤儿副本」。至于哪些节点算目标节点，由调度约束决定：默认所有节点，但受污点与容忍、nodeSelector、亲和规则约束——比如 kind 的控制面节点带 NoSchedule 污点，用户创建的 DaemonSet 默认不会跑上去（污点机制在第 7 章《亲和、反亲和与污点容忍》展开）。",
    },
    {
      type: "paragraph",
      text: "更新策略上，DaemonSet 同样支持 RollingUpdate（逐节点推进，语义与 Deployment 的 maxUnavailable 类似，精确默认值以官方文档为准）与 OnDelete 两种模式；与 Deployment 一样，它管的是「每个节点都要有、且都是新版本」。",
    },
    {
      type: "heading",
      text: "示例：给 shop 加一个节点日志采集器",
    },
    {
      type: "paragraph",
      text: "真实的日志采集器使用专用镜像与复杂配置（产品细节不展开），本课用一个 busybox:1.36 的骨架演示「每节点一个」的调度行为本身：每个节点上的副本每 30 秒往该节点的 /var/log/shop 目录追加一行采样（hostPath 卷把节点目录挂进容器，卷的机制第 6 章《卷的心智模型》展开）：",
    },
    {
      type: "code",
      title: "shop-node-logger.yaml",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: shop-node-logger
  namespace: shop
spec:
  selector:
    matchLabels:
      app: shop-node-logger
  template:
    metadata:
      labels:
        app: shop-node-logger
    spec:
      containers:
        - name: logger
          image: busybox:1.36
          command:
            - /bin/sh
            - -c
            - |
              while true; do
                echo "sample from $(hostname) at $(date -u)" >> /var/log/shop/node-sample.log
                sleep 30
              done
          volumeMounts:
            - name: node-log
              mountPath: /var/log/shop
      volumes:
        - name: node-log
          hostPath:
            path: /var/log/shop
            type: DirectoryOrCreate`,
    },
    {
      type: "code",
      title: "观察每节点一个",
      language: "bash",
      code: `kubectl apply -f shop-node-logger.yaml
kubectl -n shop get daemonsets
kubectl -n shop get pods -l app=shop-node-logger -o wide`,
    },
    {
      type: "paragraph",
      text: "预期特征（k8s-course 集群是 1 控制面 + 2 工作节点）：DaemonSet 的期望数显示 2，Pod 恰好分布在这两个 worker 上——控制面节点因 NoSchedule 污点不在目标列表里。每个副本写的是自己所在节点的文件，可 exec 进 Pod 读取验证：kubectl -n shop exec <pod-name> -- cat /var/log/shop/node-sample.log。若给集群再加一个 worker，新节点会自动出现一个副本——这正是 DaemonSet 与「手动在每节点部署 agent」的本质区别。",
    },
    {
      type: "heading",
      text: "回到现实：shop 的日志采集该采什么",
    },
    {
      type: "paragraph",
      text: "把上面的占位循环换成真实采集器，目标大致三类：容器标准输出——容器运行时会为每个容器把 stdout 落到节点日志目录（常见如 /var/log/containers，以运行时与发行版为准），采集器以只读 hostPath 挂载后读取转发；节点组件日志——kubelet 等系统组件的输出（位置随发行版）；节点与容器指标——资源使用情况交给监控链路（第 11 章《集群可观测》会讲指标、事件、日志的分工）。换句话说，日志采集 DaemonSet 的职责是「把节点上所有容器与系统组件的日志统一收走」，这正是每节点恰好一个副本的典型场景。",
    },
    {
      type: "table",
      caption: "Deployment 与 DaemonSet 的选择判据",
      headers: ["维度", "Deployment", "DaemonSet"],
      rows: [
        ["期望状态", "按需副本数（replicas）", "每个（符合条件的）节点恰好一个"],
        ["副本数来源", "spec.replicas 设定，可由弹性伸缩机制调整", "目标节点数，节点增删自动跟随"],
        ["分布诉求", "副本散布/集中由调度决定", "天然按节点铺满"],
        ["典型用例", "业务服务：shop-web、shop-api", "日志采集、监控、网络数据面组件"],
      ],
    },
    {
      type: "quiz",
      question:
        "集群当前有 1 个控制面 + 2 个 worker 节点，shop-node-logger DaemonSet（无 tolerations、无 nodeSelector）正在运行。此时为集群新增第 3 个 worker 节点。接下来会发生什么？",
      options: [
        "DaemonSet 控制器检测到新节点，自动在它上面创建一个新副本，无需人工干预",
        "需要手动执行 kubectl scale 才能让新节点上有副本",
        "副本数保持不变，直到重启整个 DaemonSet",
        "新副本会同时被调度到新节点与某个旧节点，造成重复",
      ],
      answer: 0,
      explanation:
        "DaemonSet 的期望状态是「每个符合条件的节点恰好一个」，控制器监听节点变化：新节点出现就在它上面补一个副本（A 对），节点删除则清理对应副本——所以不需要也无法用 scale 管理（B 错），更不需要重启（C 错）。控制器为每个目标节点只创建一个副本，不会出现同一节点上的重复（D 错）；控制面节点因 NoSchedule 污点默认不属于目标节点，但这不影响 worker 上的行为。",
    },
    {
      type: "keypoints",
      items: [
        "DaemonSet 的期望状态是「每个（符合条件的）节点恰好一个副本」，副本数不由 replicas 决定，而是跟着目标节点数走。",
        "调度语义由节点生命周期驱动：新节点自动补副本，节点删除自动清理对应 Pod；是否成为目标节点还受污点/容忍与亲和约束。",
        "选择判据：请求级业务服务用 Deployment；「节点级能力」（日志、监控、网络数据面）用 DaemonSet——真实采集器是专用镜像，busybox 骨架只演示调度形态。",
      ],
    },
  ],
};
