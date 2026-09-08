/* ==================================================================
 * 课时：高可用控制面：etcd 与选举（k8s-ha-etcd）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary: "控制面高可用拆成两个独立问题：etcd 用 raft 多数派保证数据一致，控制器与调度器用 Lease 选主保证同一时刻只有一个在干活——并澄清控制面 HA 不等于业务不中断。",
  blocks: [
    {
      type: "paragraph",
      text: "kind 学习集群里控制面组件各跑一份，足够学 API 语义；但生产环境任何一份挂掉都意味着能力缺失。本课先推演每个组件单点的后果，再把「高可用」拆成两个相互独立的问题分别求解：etcd 的数据一致（多数派机制），以及控制器与调度器的选主（谁在干活）。本课不部署任何 HA——第 10 章的实操仍是单控制面集群——只建立「为什么这样设计」的心智。",
    },
    {
      type: "heading",
      text: "控制面每个组件挂了会怎样",
    },
    {
      type: "table",
      caption: "控制面组件的失效症状与对应的高可用手段",
      headers: ["组件", "失效的典型症状", "高可用手段"],
      rows: [
        ["apiserver", "所有读写被挡在门口，集群失去管理面", "无状态，多副本 + 负载均衡"],
        ["etcd", "apiserver 读写失败，控制器全部空转", "多数派（quorum）集群，本课重点"],
        ["控制器管理器", "不再补副本、滚动不推进、后端列表不更新；存量 Pod 照跑", "多副本 + Lease 选主"],
        ["调度器", "新 Pod 永远停在 Pending", "多副本 + Lease 选主"],
      ],
    },
    {
      type: "paragraph",
      text: "注意「存量 Pod 照跑」这一行：控制面失效不会杀死正在运行的业务——数据面的节点代理（kubelet）会继续维持已存在的容器——瘫痪的是「变化」：发布、扩容、自愈、调度全部停摆。这也解释了为什么常说 etcd 是地基：它一挂，apiserver 自身都无法工作，其余组件即使活着也无处读写状态。",
    },
    {
      type: "heading",
      text: "问题一：etcd 如何保持一致",
    },
    {
      type: "paragraph",
      text: "etcd 是分布式键值存储，同一份数据在多个成员上各存一份。让这些副本保持一致的是 raft 共识协议，机制直觉（不谈算法细节）是：成员中会选出一个 leader，它接收全部写请求并把每次写同步给其他成员；只有多数派成员确认后，这次写才算提交，apiserver 才会收到成功响应。因此任何一个单成员的数据都不是权威，「多数派」才是。",
    },
    {
      type: "paragraph",
      text: "多数派的大小用 quorum 表示：quorum = (n + 1) / 2。三节点集群 quorum 为 2，容忍 1 台故障；五节点 quorum 为 3，容忍 2 台故障。生产最小规模是 3 节点，追求更高容错用 5。为什么取奇数：四节点与三节点的容错能力相同（都只能坏 1 台），却要多维护一台机器、且每次写要等更多成员确认——偶数节点不增加容错，只增加成本与延迟。",
    },
    {
      type: "paragraph",
      text: "多数派还顺带解决了脑裂（split brain）：网络把集群切成两半时，任何一边都凑不齐多数，也就无法提交写——不可能出现两个分区各自接受写、随后数据分叉的局面。数据始终只有一个「多数派版本的故事」。",
    },
    {
      type: "callout",
      variant: "note",
      title: "HA 与备份是两件事",
      body: "etcd 是集群唯一权威持久状态，其余组件无状态或可重建。多数派集群防的是「单台机器故障」；而误删除、坏数据这类逻辑灾难要靠快照备份来救——流程见第 10 章《etcd 快照与灾难恢复》。高可用降低故障概率，备份缩短恢复时间，两者都要做。",
    },
    {
      type: "heading",
      text: "问题二：谁在干活——Lease 选主",
    },
    {
      type: "paragraph",
      text: "本课开头那张「组件失效症状与 HA 手段」表格里有个不对称：apiserver 无状态，多副本前置负载均衡即可，副本之间不需要协调——它不持有全局工作状态，写的一致性全部交给 etcd 的多数派机制。但控制器管理器与调度器不行：它们把工作进度体现在集群对象上（status、绑定关系），如果两个副本同时执行调谐，会互相踩踏——比如两个 Deployment 控制器同时发现缺副本，各建一个，于是副本翻倍，再各自删掉多余的，来回抖动。",
    },
    {
      type: "paragraph",
      text: "它们的解法是选主（leader election）：组件以多副本方式运行，通过 coordination.k8s.io/v1 的 Lease（租约）对象竞争「领导者」身份，流程是：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "启动时，各副本尝试创建或更新同一个 Lease 对象，在 spec.holderIdentity 里写下自己的实例标识",
        "拿到租约的副本成为 leader，只有它执行控制循环；其余副本 standby，只观察与续约",
        "leader 周期性续约（renewTime 不断刷新）；一旦它失联超过租约期限，其他副本便接管——完成秒级到数十秒级的故障转移",
      ],
    },
    {
      type: "code",
      title: "在单控制面 kind 集群里观察租约",
      language: "bash",
      code: `# 控制面组件的选主租约：kube-controller-manager 与 kube-scheduler 各一条
kubectl -n kube-system get lease
# 节点心跳租约：每个节点一条（kubelet 用 Lease 向集群报告存活）
kubectl -n kube-node-lease get lease`,
    },
    {
      type: "paragraph",
      text: "输出特征：每条 Lease 有 holderIdentity（当前持有者）与 renewTime（最近续约时间）。单控制面集群里同样存在这两类租约——leader 就是唯一那个副本。顺带一提，节点失联的判定也依赖 kubelet 的租约心跳超时，具体的宽限与驱逐节奏在第 10 章《节点维护：cordon、drain 与故障自愈》展开。",
    },
    {
      type: "heading",
      text: "控制面 HA ≠ 业务不中断",
    },
    {
      type: "paragraph",
      text: "把控制面做成高可用，保证的是「管理面可用」：能发布、能调度、能自愈。业务持续可用靠的是另一套正交机制——应用多副本与滚动发布（第 3 章）、把副本分散到不同节点（第 7 章《亲和、反亲和与污点容忍》）、以及第 10 章节点维护里的 PDB 与 drain 纪律。一句话区分：控制面 HA 回答「集群还能被管理吗」，工作负载层回答「流量还在吗」。一个 3 节点 etcd 集群管好了控制面，也救不了只有一个副本且恰好在故障节点上的 shop-api。",
    },
    {
      type: "heading",
      text: "HA 部署形态：一句话定位",
    },
    {
      type: "paragraph",
      text: "生产常见的两种形态只差在「etcd 放哪」：堆叠（stacked）etcd——etcd 成员与控制面组件跑在同一批机器上，是 kubeadm 的默认形态，节点少时简单直接；外部（external）etcd——etcd 独立成集群，故障域分离、升级互不影响，规模大或可用性要求高时选用。两种形态下 API 与对象完全一致，差异只在控制面运维层面；部署步骤不在本课范围，生产搭建以官方 kubeadm 文档为准。",
    },
    {
      type: "quiz",
      question: "一个 3 节点 etcd 集群坏掉 1 台后，集群还能正常接受写请求吗？",
      options: [
        "能，quorum 为 2，多数派仍成立",
        "不能，所有成员必须同时存活",
        "只能读不能写，直到坏掉的节点恢复",
        "取决于坏掉的是不是 leader",
      ],
      answer: 0,
      explanation: "3 节点集群 quorum = (3+1)/2 = 2，剩余 2 台仍构成多数派，写照常提交。选项 B 错在把 etcd 当成必须全员存活的服务；选项 C 混淆了「失去多数派」的情形（坏 2 台才发生）；选项 D 的迷惑性在于：即使 leader 挂了，剩余成员也会选出新 leader 继续服务。",
    },
    {
      type: "quiz",
      question: "为什么控制器管理器与调度器需要 Lease 选主，而 apiserver 不需要？",
      options: [
        "因为 apiserver 是只读的，不产生写请求",
        "因为 apiserver 无状态，多副本间无需协调；而控制器会把工作进度写进集群对象，多副本同时调谐会互相踩踏",
        "因为控制器管理器运行在 etcd 里，必须选主才能访问 etcd",
        "因为 Lease 对象只能由控制器创建，apiserver 无权使用",
      ],
      answer: 1,
      explanation: "关键差别是有没有「跨副本的共享工作状态」：apiserver 每个请求独立处理，状态一致性交给 etcd；控制器则把调谐结果写进对象 status，两个副本同时干活会重复创建或互相抵消，因此需要选主保证同一时刻只有一个 leader 执行。选项 A 不对，apiserver 处理大量写请求；选项 C、D 对机制的理解都是错的——Lease 只是 coordination.k8s.io/v1 的普通对象，任何客户端都能访问。",
    },
    {
      type: "keypoints",
      items: [
        "控制面单点的后果各不相同：apiserver 挂=门关了，etcd 挂=地基没了，控制器/调度器挂=变化停了、存量照跑",
        "etcd 用多数派保证一致：3 节点容 1 台、5 节点容 2 台，偶数节点不增加容错只增加成本",
        "控制器管理器与调度器用 coordination.k8s.io/v1 的 Lease 选主，同一时刻只有一个副本在调谐",
        "控制面 HA 管「能否被管理」，业务不中断还要靠副本、调度分布与节点维护纪律",
      ],
    },
  ],
};
