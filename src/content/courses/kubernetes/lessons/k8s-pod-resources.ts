/* ==================================================================
 * 课时：资源请求与限制：CPU 与内存的语义（k8s-pod-resources）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "requests 与 limits 的角色分工、CPU 可压缩与内存不可压缩的本质差异、QoS 三档如何推导，以及不声明资源的风险。",
  blocks: [
    {
      type: "paragraph",
      text: "前两课让 Pod 跑了起来、并且能自我修复，但还缺一块关键拼图：资源声明。设想你的 shop 集群上，shop-api 内存泄漏把节点内存吃光，同一节点上的 shop-web 被殃及、进程被内核杀掉——这就是经典的「嘈杂邻居」问题。反过来，调度器要把 Pod 放到合适的节点上，也需要知道每个 Pod 到底要多少资源，否则只能凭运气分配。这一课解决两件事：怎么声明资源、声明之后 Kubernetes 拿它做了什么。",
    },
    {
      type: "heading",
      text: "requests 与 limits：两个不同的承诺",
    },
    {
      type: "paragraph",
      text: "每个容器都可以声明两类资源数值，它们回答两个完全不同的问题：requests（请求量）回答「调度与预留」——调度器按它记账，保证节点上所有 Pod 的 requests 之和不超过节点的可分配量，相当于容器向集群承诺「我至少要这么多」；limits（上限）回答「运行时约束」——它是容器在节点上实际能用的硬顶，由 cgroup 强制执行，防止单个 Pod 饿死邻居。记住一句话：requests 决定 Pod 能被放到哪里，limits 决定 Pod 能用到多狠。",
    },
    {
      type: "code",
      title: "shop-api-resources.yaml：带资源声明的裸 Pod",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: shop-api-resources
  namespace: shop
  labels:
    app: shop-api
spec:
  containers:
    - name: api
      image: registry.k8s.io/echoserver:1.10
      resources:
        requests:
          cpu: 100m        # 0.1 核（100m = 0.1 core）
          memory: 128Mi
        limits:
          cpu: 500m        # 0.5 核
          memory: 256Mi
      ports:
        - containerPort: 8080`,
    },
    {
      type: "paragraph",
      text: "单位的写法需要习惯一下：CPU 可以用核的整数/小数（1、0.5），更常用毫核（millicore）后缀——100m 就是 0.1 核，1000m 等于 1 核，最小粒度是 1m。内存用字节或带后缀的数值，常见 Mi/Gi 这类二进制后缀（1Gi = 1024Mi），官方也接受 K/M/G 这类十进制后缀（1G = 1000M），两者别混用。",
    },
    {
      type: "heading",
      text: "CPU 可压缩，内存不可压缩",
    },
    {
      type: "paragraph",
      text: "两类资源在被「用超」时的行为天差地别，这是本课最重要的一个机制区分：CPU 是可压缩资源——容器超过 CPU limit 时，内核只对它限流（throttle），进程继续运行只是变慢，绝不会被杀；内存是不可压缩资源——容器超过内存 limit 时没有「慢下来」的选项，内核的 OOM killer 只能杀掉进程来回收内存，于是容器以 OOMKilled 状态结束，退出码 137。所以「CPU 超了是性能问题，内存超了是可用性问题」——前者应用还能扛，后者直接重启。从 Docker 迁移过来的同学可以把直觉平移：docker run 的 --cpus 与 --memory 分别对应这两类 limit（cgroup 层面同一套机制），而 requests 是 Kubernetes 新增的调度层概念，Docker 单机编排里没有对应物。",
    },
    {
      type: "table",
      caption: "两类资源的超限行为对比",
      headers: ["维度", "CPU", "内存"],
      rows: [
        ["是否可压缩", "可压缩：超过 limit 被限流", "不可压缩：没有限流选项"],
        ["超过 limit 的后果", "进程继续运行，调度变慢", "OOM killer 杀进程，容器 OOMKilled、退出码 137"],
        ["requests 的角色", "调度与预留的依据", "调度与预留的依据"],
        ["与 Docker 的对应", "--cpus（cgroup cpu 配额）", "--memory（cgroup 内存上限）"],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "什么都不声明 = 没有保护",
      body: "不写 resources 字段的容器既没有 requests 也没有 limits：调度器不知道它要多少资源，它也没有 cgroup 硬顶。这类 Pod 属于 QoS 最低档（见下），在节点内存紧张时是最先被回收的对象，还可能因为无限膨胀拖垮同节点的邻居。生产清单里给每个容器写资源声明，应该是默认动作而不是加分项。",
    },
    {
      type: "heading",
      text: "QoS 三档：requests 与 limits 的组合推出来的等级",
    },
    {
      type: "paragraph",
      text: "把 requests 与 limits 的组合归纳一下，Pod 会落进三个服务质量等级（QoS class）之一。推导规则只看「设没设、等不等」，不看数值大小：",
    },
    {
      type: "table",
      caption: "QoS class 推导规则",
      headers: ["QoS class", "满足条件", "资源保障"],
      rows: [
        ["Guaranteed", "Pod 内每个容器都设置了 CPU 与内存的 requests 和 limits，且 requests 等于 limits（只写 limits 时 requests 视为等于 limits）", "最稳：资源被完全预留，节点压力下最后被动"],
        ["Burstable", "不满足 Guaranteed，但至少有一个容器设置了 requests 或 limits", "中间档：有自己的资源下限，超出的部分不保证"],
        ["BestEffort", "没有任何容器设置任何 requests 或 limits", "最弱：没有任何承诺，节点压力下最先被回收"],
      ],
    },
    {
      type: "paragraph",
      text: "这背后是一条现实的设计：Guaranteed 的「requests 等于 limits」意味着容器既不会被超卖（它承诺要多少就锁多少），也没有超限空间，等价于告诉调度器「我就要这么多，别跟我抢」。BestEffort 则完全没有发言权。等级的价值在节点资源紧张时才显现：压力越大，回收顺序越是从 BestEffort 往 Guaranteed 走——低等级 Pod 先被牺牲。理解了这个，前面那句「什么都不写 = 没有保护」就落在实处了。",
    },
    {
      type: "code",
      title: "用 kubectl describe 看 QoS",
      language: "bash",
      code: `kubectl -n shop apply -f shop-api-resources.yaml
kubectl -n shop describe pod shop-api-resources`,
    },
    {
      type: "paragraph",
      text: "describe 输出里有三处值得读：容器小节会显示 Limits 与 Requests 两组数值（对照清单核对是否生效）；Pod 信息区有 QoS Class 一行，显示 Guaranteed/Burstable/BestEffort 之一；Events 区能看到调度结果。养成 apply 之后 describe 一眼的习惯，资源写没写对立刻现形。",
    },
    {
      type: "paragraph",
      text: "资源声明到这里已经完整，但它的影响面比本课大得多：调度器具体如何利用 requests 给 Pod 选节点（记哪本账、超卖与碎片化从何而来）在第 7 章《调度器》一课展开；HPA 计算扩容目标时用的「平均利用率 = 实际用量 ÷ requests」也建立在 requests 之上，见第 7 章《HPA》一课——到那时你会回来理解为什么利用率的分母是 requests 而不是 limits。",
    },
    {
      type: "quiz",
      question: "一个 Pod 里只有一个容器，配置为：cpu limits=1、memory limits=1Gi，没有写 requests。它的 QoS class 是？",
      options: [
        "BestEffort",
        "Burstable",
        "Guaranteed",
        "无法确定，取决于节点剩余资源",
      ],
      answer: 2,
      explanation:
        "未显式写 requests 时，Kubernetes 把 requests 视为等于 limits；容器同时设置了 CPU 与内存的 limits，于是 requests 与 limits 相等，满足 Guaranteed 的条件。BestEffort 要求任何容器都不设任何值，Burstable 是其余中间情况；QoS 由清单推导，与节点资源无关。",
    },
    {
      type: "quiz",
      question: "某容器的 memory limits 设为 256Mi，实际使用超过该值时会发生什么？",
      options: [
        "容器被限流，运行变慢但不受影响",
        "内核 OOM killer 杀掉容器进程，容器以 OOMKilled 结束、退出码 137",
        "整个 Pod 被调度器迁移到另一台节点",
        "容器继续无限使用内存，超出部分从邻居那里抢占",
      ],
      answer: 1,
      explanation:
        "内存不可压缩，超限时内核只能杀进程回收内存，容器表现为 OOMKilled、退出码 137。限流只存在于可压缩的 CPU；迁移是调度器的调度动作，不会因超限触发；「无限使用」正是 limits 要防止的事。",
    },
    {
      type: "keypoints",
      items: [
        "requests 用于调度与预留（决定 Pod 放哪），limits 是 cgroup 硬顶（决定能用多狠）",
        "CPU 可压缩：超限限流不杀进程；内存不可压缩：超限 OOMKilled、退出码 137",
        "CPU 毫核单位 100m = 0.1 核；内存常用 Mi/Gi 二进制后缀",
        "QoS 三档由 requests/limits 组合推导：Guaranteed（全设且相等）> Burstable > BestEffort（全不设）",
        "不声明资源 = BestEffort = 节点压力下最先被回收；kubectl describe 可直接看到 QoS Class",
      ],
    },
  ],
};
