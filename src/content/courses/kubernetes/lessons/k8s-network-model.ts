/* ==================================================================
 * 课时：网络模型：每个 Pod 一个 IP（k8s-network-model）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Kubernetes 网络模型要求每个 Pod 拥有独立 IP 且 Pod 间免 NAT 直连；Pod IP 只在集群内有效，这正是 Service 与 Ingress 存在的根本原因。",
  blocks: [
    {
      type: "paragraph",
      text: "前几章我们不断创建、删除、重建 Pod，访问它要么用 port-forward，要么 kubectl exec 进去——一直没有正面回答一个问题：流量在集群里到底怎么走？这一课先把底层事实铺好：Kubernetes 要求每个 Pod 拥有一个独立、全局唯一的 IP，Pod 之间用这个 IP 直接通信。你会看到这套设计同时留下两个缺口：Pod 的 IP 只在集群内部有效，外部流量进不来；而且 Pod 一重建 IP 就变，地址不稳定。Service 与 Ingress（入口）正是为补这两个缺口而生的抽象，从下一课开始逐一展开。",
    },
    {
      type: "heading",
      text: "官方网络模型：四个基本要求",
    },
    {
      type: "paragraph",
      text: "Kubernetes 要求任何网络实现都满足一组相同的硬性约定，官方文档称之为网络模型（network model）。网络插件可以选不同的技术路线，但只要满足这组约定，上层（Pod、Service、Ingress）看到的网络行为就完全一致——这是「换了 CNI 集群照常工作」的根本原因。",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "每个 Pod 一个唯一 IP：无论 Pod 调度到哪台节点，都拿到全局唯一的地址；同 Pod 的容器共享这个 IP，用 localhost 互访。",
        "Pod 之间直接通信、无需 NAT：任意两个 Pod 都能用对方的 Pod IP 直连，中间不存在地址转换。",
        "节点上的组件能访问本节点 Pod：kubelet 做健康检查、节点上的代理程序要读本机 Pod，都必须有路可走。",
        "稳定的服务访问入口由网络代理实现：集群内的稳定入口 Service 由运行在每个节点上的 kube-proxy 提供（下一课《Service：稳定的访问入口与 DNS》细讲）。",
      ],
    },
    {
      type: "paragraph",
      text: "网络模型可以概括成一句话：集群里存在一张虚拟网络，每个 Pod 都像插了一张网卡，任意两个 Pod 可以互 ping——落在哪台物理节点上，对通信双方完全透明。前三条是网络实现必须满足的底层契约；第四条 Service 则是 Kubernetes 在这张网络上搭出的第一层集群级抽象，把「一组会变化的 Pod」收敛成一个固定地址。",
    },
    {
      type: "heading",
      text: "谁来实现它：CNI 插件",
    },
    {
      type: "paragraph",
      text: "kubelet 负责把容器拉起来，但不管网络。真正把 Pod 的「虚拟网卡」接进这张网络的是 CNI（Container Network Interface）插件。创建流程一句话：kubelet 先创建 Pod 的沙箱容器（网络命名空间），再调用 CNI 插件；插件负责创建 veth 对——一头在 Pod 的网络命名空间里、一头接在节点侧——并配置 bridge、路由与出站规则。不同插件技术路线不同，向 kubelet 与 Pod 承诺的结果一致：满足上面的网络模型。",
    },
    {
      type: "callout",
      variant: "note",
      title: "本课程的 kind 默认用 kindnet",
      body: "kind 自带的默认插件是 kindnet：一个极简实现，满足 Pod 间连通与出站访问，但有一个重要边界——它不执行 NetworkPolicy，即「策略写上去也不生效」。这一点会在《NetworkPolicy：集群内的流量防线》一课详细展开。生产中常见的插件有 Calico（路由/overlay 两种模式）与 Cilium（基于 eBPF 的数据面），课程只做到「点名定位」，不深入任何插件的实现细节。",
    },
    {
      type: "heading",
      text: "Pod IP 与集群网段",
    },
    {
      type: "paragraph",
      text: "每个集群在初始化时为 Pod 网络预留一个大网段（常称 cluster CIDR），节点再从里面切分自己的子网，调度到该节点的 Pod 依次领取 IP。kind 的默认 Pod 网段是 10.244.0.0/16（kindnet 的默认配置，以你的集群为准）——看到 Pod IP 是 10.244.x.x，就知道它来自 CNI 分配。Pod IP 不是「虚拟地址」：它真实配置在节点上 veth 的一端，容器内看到的 IP 与集群里其他人看到的完全一致——这正是模型第 1 条的意义所在。",
    },
    {
      type: "paragraph",
      text: "理解了这一点，就能解释一个反直觉现象：清单里的 containerPort 只是文档性字段。网络模型给的是 Pod 级 IP，端口从来不会被 kubelet 或 CNI「打开」，容器进程监听什么端口是它自己的事（第 2 章《Pod 与容器：解剖一个 YAML》提到过）。containerPort 的价值在于给人类与工具提供元数据——比如 Service 的 targetPort 可以按名字引用它。就算不写 containerPort，Pod 也照样被访问。",
    },
    {
      type: "heading",
      text: "两个缺口：出站要 NAT，入站进不来",
    },
    {
      type: "paragraph",
      text: "Pod IP 来自私有集群网段，集群外的路由器不认识它，于是出现两个方向的不对称：出站方向，节点上通常有一条伪装规则（masquerade）：凡是目的地不在集群网段的包，源地址被改写成节点 IP 再发出去——这是「Pod 能上网」的真相；入站方向，外部没有通往 10.244.x.x 这类地址的路由，报文根本进不了集群。外部流量要进来，必须经过一个「正门」把流量转发给 Pod——这就是 Service 的 NodePort/LoadBalancer 与 Ingress 存在的理由，后文《NodePort、LoadBalancer 与 ExternalName》和《Ingress 与 Gateway API：七层入口》会分别展开。再加上 Pod 一重建 IP 就变，「按 IP 找服务」在集群里从来不是正确姿势，这也是下一课 Service 要解决的核心问题。",
    },
    {
      type: "heading",
      text: "kube-proxy：Service 的数据面",
    },
    {
      type: "paragraph",
      text: "网络模型的第四条牵出一个重要组件 kube-proxy：它运行在每台节点上（第 1 章《集群解剖：一次部署请求的旅程》把它列入数据面），负责 watch Service 与其后端列表的变化，把转发规则写进本机内核，让访问 Service 的包最终到达某个后端 Pod。它有三种工作模式，记住一句话定位即可：iptables 模式是默认与最常见的实现，用内核 netfilter 规则逐包匹配转发；ipvs 模式改用内核态哈希表做负载均衡，规则量大时性能更好；nftables 模式是较新的 netfilter 接口。具体默认值由发行版与集群初始化方式决定，本课程按 iptables 的直觉理解数据路径就足够，机制细节在下一课展开。",
    },
    {
      type: "quiz",
      question: "你在 kind 集群里用 kubectl run 起了 shop-api 的一个 Pod，然后从集群外的笔记本上直接用它的 Pod IP 访问，为什么不通？",
      options: [
        "Pod IP 来自集群内部网段，外部网络没有到达它的路由，外部流量必须经过 Service/Ingress 这类入口",
        "kube-proxy 默认拒绝一切来自集群外的连接",
        "清单里没写 containerPort，Pod 就没有监听任何端口",
        "CNI 插件只允许同一节点上的 Pod 互相访问",
      ],
      answer: 0,
      explanation:
        "正确：Pod IP 是集群网段内的私有地址，外部路由器没有通往它的路由，所以必须经过 NodePort/LoadBalancer/Ingress 这类入口转发。kube-proxy 只处理发往 Service 的流量，不负责拦截 Pod IP 的入站；containerPort 只是文档字段，不写也不影响容器监听端口；CNI 恰恰要保证跨节点互通，Pod 不通的原因是路由缺失而非插件限制。",
    },
    {
      type: "keypoints",
      items: [
        "网络模型：每个 Pod 一个唯一 IP，Pod 间免 NAT 直连，节点组件可访问本节点 Pod。",
        "网络由 CNI 插件实现：kind 默认 kindnet（不执行 NetworkPolicy），生产常见 Calico/Cilium。",
        "Pod IP 是集群内部地址：出站靠节点伪装，入站必须经过 Service/Ingress 入口。",
        "containerPort 只是文档字段；真正把流量转进后端 Pod 的是 kube-proxy 依据 Service 写入的规则。",
      ],
    },
  ],
};
