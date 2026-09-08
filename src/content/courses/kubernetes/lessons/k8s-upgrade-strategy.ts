/* ==================================================================
 * 课时：升级与版本治理（k8s-upgrade-strategy）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Kubernetes 的安全补丁只在支持窗口内发布，升级是运维的主任务。掌握官方版本偏差政策、控制面先行的升级顺序与逐 minor 约束，并理解托管集群里「按钮化」背后仍是你的责任。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课的 etcd 快照解决「出事怎么救」，这一课解决「怎么不出事」里最日常的一项：升级。Kubernetes 的版本号由 minor 与补丁（patch）组成，如 1.37 是 minor、1.37.2 是补丁版本。官方只为支持窗口内的版本发布安全补丁：每个 minor 大约获得一年支持，同一时间官方支持最近三个 minor——本课程写作时（v1.37 于 2026-08 发布）支持窗口是 1.35–1.37。停在窗口外的版本意味着：新的安全漏洞没有官方修复，只能自己扛。这决定了升级不是「有空再做的优化」，而是运维的主任务——它像呼吸一样周期性发生，不做就会积累风险与版本债务。",
    },
    {
      type: "heading",
      text: "版本偏差政策：为什么可以分批升",
    },
    {
      type: "paragraph",
      text: "集群不是一台整机，而是 apiserver、调度器、控制器管理器加一群节点上的 kubelet 的集合。如果要求所有组件永远同版本，升级就必须全集群原子完成——这在生产里不可行。官方的版本偏差（skew）政策给组件之间留了缓冲，正是它让「控制面先行、节点分批跟进」成为可能。",
    },
    {
      type: "table",
      caption: "官方版本偏差政策要点（以 kube-apiserver 为基准）",
      headers: ["组件", "相对 apiserver 的约束"],
      rows: [
        ["kubelet（每个节点）", "不得新于 apiserver，可最多旧 3 个 minor"],
        ["kubectl（客户端）", "±1 个 minor"],
        ["kube-controller-manager / kube-scheduler", "同 minor，或旧 1 个 minor"],
        ["kubeadm 升级", "必须逐 minor 升级，不允许跳版本"],
      ],
    },
    {
      type: "paragraph",
      text: "读这张表能得出两个实战结论。第一，kubelet 允许比 apiserver 旧最多 3 个 minor，意味着控制面先升上去后，节点有一个宽裕的窗口分批跟进，业务不需要整体停机。第二，约束是单向的：kubelet 不能新于 apiserver，所以顺序永远是「控制面在前、节点在后」，反过来的升级路径官方不支持。kubectl 相对宽松（±1），日常可以比集群稍新或稍旧，但别拿差好几个版本的客户端去操作集群。",
    },
    {
      type: "heading",
      text: "升级顺序：控制面先行，节点逐台",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "前置准备：确认快照备份可用（第 10 章《etcd 快照与灾难恢复》），在测试环境先升一遍，检查清单兼容性——本课程全程只用 GA API，常规清单一般无需改动；但长期不升级，废弃 API 最终被移除时会逼你改清单（例如 v1.32 移除了 flowcontrol v1beta3）。",
        "升级控制面：在控制面节点执行 kubeadm 的升级流程，把 apiserver、controller-manager、scheduler（堆叠模式下含 etcd）升到目标 minor。具体命令以官方「Upgrading kubeadm clusters」文档为准，这里不贴逐行命令。",
        "逐节点升级 kubelet：对每个 worker 执行第 10 章《节点维护：cordon、drain 与故障自愈》的三件套——排空（驱逐尊重 PDB，业务不中断）、升级节点上的 kubelet 与 kubeadm、uncordon 恢复调度。",
        "一台完成并确认节点 Ready、版本正确后再动下一台；全部完成后用 kubectl get nodes 核对所有节点版本一致，并跑一轮业务验证。",
      ],
    },
    {
      type: "paragraph",
      text: "补丁版本也有节奏：补丁升级（如 1.37.1 → 1.37.2）风险低、频率高，承载安全修复，应当及时跟进；跨 minor 升级前，官方建议先把当前 minor 升到最新补丁再跨下一步——例如从 1.35 的某个旧补丁出发，路径是「升到最新 1.35 → 1.36 → 1.37」，而不是带着旧补丁直接跳。逐 minor 的约束意味着跨版本差距越大，升级路径越长，这正是「版本债务」的利息：长期不升级的集群，最后要连续跨越多个 minor 才能回到支持窗口。",
    },
    {
      type: "heading",
      text: "业务侧配合与托管集群的现实",
    },
    {
      type: "paragraph",
      text: "升级的窗口安排是运维与业务协同的结果：控制面升级不触碰工作负载，但逐节点排空会制造自愿中断——如果每个工作负载都配了 PDB（上一课），排空会自动放慢到「新副本就绪才动下一个」的节奏，可用性有下限；反过来，刚做过大版本发布的集群（滚动更新同样消耗可用副本），紧接着升级节点容易被 PDB 卡住。因此升级窗口通常与发布冻结期重合：不发布新版本、不跑数据迁移，只做验证与升级。托管集群（EKS/AKS/GKE）把这一切按钮化了：控制面升级与 etcd 由厂商处理，节点池升级也往往只需点几下或设个维护窗口。但版本策略依然是你的责任——何时进入升级窗口、验证清单与客户端兼容、处理节点池的滚动，这些决策厂商替不了你；且各家托管服务有自己的版本支持范围与节奏，需要持续跟踪厂商文档，别默认它和上游窗口一致。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "升级前的最小检查单",
      body: "备份可用（并演练过恢复）→ 测试环境先升 → 检查废弃 API 与行为变更说明 → 确认 kubectl 在 ±1 内 → 通知业务冻结发布 → 控制面先行 → 逐节点 drain/uncordon，一台确认后再下一台 → 全部完成后核对版本与集群健康。",
    },
    {
      type: "quiz",
      question: "集群的 kube-apiserver 是 v1.37，下列哪个 kubelet 版本违反了官方版本偏差政策？",
      options: ["v1.36", "v1.35", "v1.34", "v1.33"],
      answer: 3,
      explanation:
        "kubelet 不得新于 apiserver，且最多可旧 3 个 minor：v1.37 之下允许 v1.36、v1.35、v1.34，v1.33 旧了 4 个 minor，超出缓冲。其余三个选项都在政策允许范围内。注意约束的方向——若某个节点的 kubelet 比 apiserver 还新（例如先升了节点），同样违规，这正是升级必须「控制面先行」的原因。",
    },
    {
      type: "quiz",
      question: "为什么升级 kubeadm 集群时通常先升控制面、再逐节点升 kubelet，而不是反过来？",
      options: [
        "因为控制面组件体积小、升级耗时短，先升可以节省整体时间",
        "因为 kubelet 不得新于 apiserver 且允许最多旧 3 个 minor，控制面前移后节点可在一段窗口内分批升级",
        "因为不先升控制面，etcd 会拒绝接受新版本的写入",
        "因为先升节点可以让业务流量提前切到新版本，缩短停机时间",
      ],
      answer: 1,
      explanation:
        "官方偏差政策是单向的：kubelet 不能比 apiserver 新，但可以旧最多 3 个 minor。先升控制面后，节点 kubelet 保持旧版本仍在政策范围内，于是可以配合排空逐台升级、业务不整体停机。选项 C 混淆了 etcd 与 apiserver 的关系；A 与 D 描述的理由不成立——升级耗时由验证决定，且节点先升反而制造「kubelet 新于 apiserver」的违规状态。",
    },
    {
      type: "keypoints",
      items: [
        "官方支持约 1 年、最近 3 个 minor；窗口外没有安全补丁，升级是运维主任务。",
        "偏差政策允许 kubelet 旧最多 3 个 minor、kubectl ±1、控制面组件不新于 apiserver——升级顺序只能是控制面先行。",
        "kubeadm 必须逐 minor：先升到当前 minor 最新补丁再跨下一步，跳版本不支持。",
        "托管集群把升级按钮化，但升级时机、兼容验证与节点跟进仍是你的责任。",
      ],
    },
  ],
};
