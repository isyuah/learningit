/* ==================================================================
 * 课时：集群解剖：一次部署请求的旅程（k8s-cluster-anatomy）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "解剖集群：分清控制面与数据面各组件的职责，并跟随一次 kubectl apply 走完从 apiserver 到容器运行的完整旅程。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课留下的心智图是「控制面定状态，节点跑负载」。这一课把它放大成一张组件图：集群不是一个程序，而是一组各司其职的组件。我们会先认识控制面与数据面各自的成员，然后跟着一次 kubectl apply 走完从客户端到容器的完整旅程。学完你应当能回答：一条部署命令发出后，集群里谁先动了手、各自做了什么、它们之间靠什么沟通。",
    },
    {
      type: "heading",
      text: "两个平面：控制面与数据面",
    },
    {
      type: "paragraph",
      text: "集群从职责上分成两部分。控制面是集群的「大脑」：保存所有状态、对状态变化做决策、驱动系统收敛；对使用者而言，它表现为一个统一的 API 入口。数据面由一台台工作节点组成，它们是「肌肉」：真正拉取镜像、运行容器、提供计算资源的地方。你永远不会直接 ssh 到某台节点去「启动一个容器」——所有意图都表达为对控制面的请求，再由控制面把任务分派给具体节点。",
    },
    {
      type: "heading",
      text: "控制面组件各自管什么",
    },
    {
      type: "table",
      caption: "控制面四组件",
      headers: ["组件", "一句话职责"],
      rows: [
        [
          "API 服务器（kube-apiserver，全课统一简称 apiserver）",
          "集群唯一入口：kubectl、控制器、节点代理的一切读写请求都先到它这里，经认证与校验后读写状态",
        ],
        [
          "etcd",
          "键值存储，保存集群全部对象状态的唯一持久化位置",
        ],
        [
          "调度器（kube-scheduler）",
          "为新建但尚未安置的 Pod 挑选一台合适的工作节点",
        ],
        [
          "控制器管理器（kube-controller-manager）",
          "打包运行一批内置控制器（如 Deployment、ReplicaSet 控制器），持续把实际状态调谐到期望状态",
        ],
      ],
    },
    {
      type: "paragraph",
      text: "注意一个容易混淆的点：apiserver 本身几乎不「干活」，它的职责是登记状态——校验你提交的对象、写入存储、并向关注者广播变化。真正推动系统动作的是控制器管理器里的各类控制器和调度器；它们的工作方式也统一为「读状态、做决定、把结果写回 apiserver」。这也是为什么我们说 etcd 是集群唯一权威状态：任何组件都可以随时从它那里得知「现在应该是什么样」，而不依赖某个组件私有的内存。",
    },
    {
      type: "callout",
      variant: "note",
      title: "etcd：唯一持久状态，第一次正式出场",
      body: "控制面组件大多无状态或可随时重建，唯独 etcd 保存着集群的全部对象——你的清单、Pod 的调度结果、运行状态都在里面。它挂掉意味着集群失忆。本章只需要记住「etcd = 权威状态库」这一定位；它的高可用机制到第 9 章、备份实操到第 10 章才展开。",
    },
    {
      type: "heading",
      text: "数据面：每台节点上有什么",
    },
    {
      type: "table",
      caption: "工作节点三件套",
      headers: ["组件", "一句话职责"],
      rows: [
        [
          "节点代理（kubelet）",
          "每台节点一个的「管家」：通过 watch 接收 apiserver 指派给本节点的 Pod，驱动容器运行并回报状态",
        ],
        [
          "容器运行时（container runtime）",
          "真正创建、停止容器的程序，是容器运行时接口（CRI）的实现，如 containerd",
        ],
        [
          "网络代理（kube-proxy）",
          "让 Service 的访问规则在本机生效的代理；只在用到 Service 时才介入（第 4 章细讲）",
        ],
      ],
    },
    {
      type: "callout",
      variant: "warning",
      title: "kubelet 不是容器运行时",
      body: "新手最常见的混淆是把 kubelet 当成「启动容器的东西」。分工其实是：kubelet 是 Kubernetes 的节点代理，它决定「本节点应该跑哪些容器」（向 apiserver 汇报、接收指派）；真正执行拉镜像、建容器的是容器运行时。两者通过 CRI 这个标准接口对话——这也是 Docker 被替换为 containerd 等运行时后集群不受影响的原因。",
    },
    {
      type: "heading",
      text: "一次部署请求的旅程",
    },
    {
      type: "paragraph",
      text: "把组件记熟之后，我们用 shop 的例子串一遍：你写好 shop-api 的 Deployment 清单，执行 kubectl apply。从命令敲下到容器真正跑起来，中间有六个角色接力：",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "kubectl 读取 kubeconfig，找到 apiserver 的地址，把清单以 HTTPS 请求发过去。",
        "apiserver 校验对象合法后，把它作为期望状态写入 etcd。此刻还没有任何容器——只是「登记在册」了。",
        "控制器管理器里的 Deployment 控制器发现新对象，创建它下属的 ReplicaSet；ReplicaSet 控制器再据此创建 Pod 对象。Pod 同样只是登记好的期望。",
        "调度器发现一个处于 Pending 状态的 Pod，结合资源与约束选出一台工作节点，把结果写进 Pod 的绑定信息。",
        "被选中的节点上的 kubelet 通过 watch 得知「有个 Pod 派给我」，于是通过 CRI 让容器运行时拉取镜像、创建并启动容器。",
        "容器运行后，kubelet 把状态回报给 apiserver，写进对象的 status。之后你执行 kubectl get 读到的 Running，正是这次回写的数据。",
      ],
    },
    {
      type: "paragraph",
      text: "这趟旅程值得记住三件事。第一，每一步都是「写状态 → 有人 watch 到 → 动手 → 回写状态」，没有任何组件直接调用另一个组件的内部接口，组件间靠 apiserver 这个「公告板」解耦。第二，etcd 中的对象从第 2 步起就是唯一权威，任何组件崩溃都能照着重放自己的职责，这也为第 9 章的控制器机制埋下伏笔。第三，kube-proxy 全程没有出场——它只在你要用 Service 提供稳定入口时才登场（第 4 章）。",
    },
    {
      type: "heading",
      text: "kubectl 怎么找到 apiserver：kubeconfig 与 context",
    },
    {
      type: "paragraph",
      text: "kubectl 本身不内置任何集群地址，它读取一个叫 kubeconfig 的配置文件（默认 ~/.kube/config）。文件里登记三类信息：若干集群（cluster，含 apiserver 地址与证书）、若干用户凭据（user）、以及上下文（context）——上下文把「某个集群 + 某组凭据 + 默认命名空间」组合成一个当前生效的连接配置。`kubectl config get-contexts` 列出全部上下文，`kubectl config use-context <名字>` 切换当前项。第 4 课《用 kind 起第一个集群》动手创建集群时你会看到：kind 创建完成后会自动写好一个名为 kind-<集群名> 的上下文并把当前项切过去，所以 kubectl 开箱即用。",
    },
    {
      type: "quiz",
      question: "在「kubectl apply 一个 Deployment」的旅程中，业务容器真正被创建发生在哪一步之后？",
      options: [
        "apiserver 把对象写入 etcd 之后立即发生",
        "调度器把 Pod 绑定到某台节点、该节点 kubelet 收到指派之后",
        "Deployment 控制器创建出 ReplicaSet 的瞬间",
        "kubectl 命令返回成功的那一刻",
      ],
      answer: 1,
      explanation:
        "apiserver 写入 etcd 只是登记期望状态，Deployment 控制器创建 ReplicaSet、ReplicaSet 控制器创建 Pod 也都只是把对象逐级补齐；真正启动容器的是被指派节点上的 kubelet 通过 CRI 调用容器运行时完成，所以选 2。kubectl 返回成功只代表对象已被 apiserver 接受登记，此刻容器往往还没开始创建。",
    },
    {
      type: "keypoints",
      items: [
        "控制面（apiserver、etcd、调度器、控制器管理器）定状态、做决策；数据面（kubelet、容器运行时、kube-proxy）在工作节点上跑负载。",
        "etcd 是集群唯一持久状态；组件之间靠「读写对象 + watch 变化」协作，不直接互相调用。",
        "一次 apply 的接力：apiserver 登记 → 控制器补齐对象层级 → 调度器选节点 → kubelet 经 CRI 起容器 → 状态回写。",
        "kubeconfig 决定 kubectl 连哪个集群：集群、凭据与上下文三件套，context 是当前生效的组合。",
      ],
    },
  ],
};
