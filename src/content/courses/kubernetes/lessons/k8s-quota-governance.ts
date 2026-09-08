/* ==================================================================
 * 课时：命名空间治理：配额与多团队（k8s-quota-governance）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "一台集群被多个团队共享时，命名空间是治理单元：ResourceQuota 设总额、LimitRange 补默认值，配合同一命名空间里的 RBAC 形成「谁能用多少、能做什么」的完整边界。",
  blocks: [
    {
      type: "paragraph",
      text: "前几课讲的都是「单个集群、单个应用」的视角。但生产里更常见的是：一台集群被多个团队、多个环境共享——支付团队、推荐团队、测试环境、预发环境挤在同一批节点上。第 1 章《对象模型：声明式、spec 与调谐循环》预告过命名空间是软隔离边界，第 8 章《RBAC：谁可以对什么做什么》解决了「谁能做什么」，这一课补上另一半：「每个命名空间最多能用多少资源」。没有配额约束的共享集群，迟早会退化成一个「谁先抢到谁用」的蛮荒之地：一个团队把请求量开到极限，其他人的 Pod 全部 Pending。",
    },
    {
      type: "heading",
      text: "ResourceQuota：给命名空间设总额",
    },
    {
      type: "paragraph",
      text: "ResourceQuota 是命名空间级对象，通过 spec.hard 声明该命名空间的资源总额，维度分三类：计算资源的请求与限制之和（requests.cpu、requests.memory、limits.cpu、limits.memory）、对象数量上限（count/pods、count/deployments.apps、count/services 等，写法是 count/<复数资源名>.<API 组>）、存储声明量（requests.storage、persistentvolumeclaims）。它由准入控制强制执行：任何创建或更新如果会让命名空间超过任一维度，请求直接被 apiserver 拒绝，错误信息包含 exceeded quota 以及该维度的 used/limited 数字——所以第 5 章《配置发布实践：diff、dry-run 与滚动生效》教的 `--dry-run=server` 在这里很有用：它会执行准入检查而不落盘，发布前先跑一遍就能知道会不会撞上配额。日常巡检用 `kubectl describe resourcequota -n <命名空间>` 能看到每个维度的已用与上限。",
    },
    {
      type: "code",
      title: "shop 生产命名空间配额清单",
      language: "yaml",
      code: `apiVersion: v1
kind: ResourceQuota
metadata:
  name: shop-quota
  namespace: shop
spec:
  hard:
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "8"
    limits.memory: 16Gi
    count/pods: "40"
    count/deployments.apps: "20"
    count/services: "20"
    count/persistentvolumeclaims: "10"
    requests.storage: 100Gi`,
    },
    {
      type: "paragraph",
      text: "这份清单把 shop 命名空间的总盘子画了出来：所有 Pod 的 CPU 请求之和不超过 4 核、内存请求不超过 8Gi，limits 各翻一倍；对象数量也设了上限，防止「谁都能随手建一百个 Service」。配额是声明式的治理契约——超了就是超了，apiserver 直接拒绝，不靠自觉。注意对象数量配额对「扩副本」的另一种表现：`kubectl scale` 修改 replicas 字段本身不占配额，但控制器随后创建新 Pod 时会被拒，ReplicaSet 上会出现 FailedCreate 事件——症状是副本数上不去，根因却在配额，排障时要能想到这条线（第 11 章《综合故障演练》里就有这个场景）。",
    },
    {
      type: "heading",
      text: "计账语义：配额管的是「声明的和」",
    },
    {
      type: "paragraph",
      text: "配额按每个 Pod 声明的 requests/limits 计账，而不是按运行期的实际用量计账。这带来一个必须想清楚的边界：配额保证「命名空间内所有 Pod 的声明之和不超过上限」，但它不直接监控实际用量。运行期的实际占用由每个 Pod 自己的 limits 兜底——limits 是硬顶（cgroup 层执行，见第 2 章《资源请求与限制：CPU 与内存语义》）。换句话说，配额管准入、limits 管执行：一个团队把 Pod 的 limits 都声明得很小、实际打满，物理上可能比另一个声明大而闲置的团队更挤占节点——配额看不到这一点。所以多团队治理的正确姿势是三层叠加：配额限定声明的总量，统一的 LimitRange 保证每个 Pod 都有合理的 requests/limits 画像，监控看实际用量。",
    },
    {
      type: "heading",
      text: "LimitRange：给裸 Pod 补默认值",
    },
    {
      type: "paragraph",
      text: "配额带出一个连锁问题。配额是按维度计账的，如果允许 Pod 不声明某维度，任何团队都能靠「不写 resources」绕过配额上限——裸 Pod 想用多少就用多少，限额形同虚设。因此只要配额覆盖了某个计算维度，命名空间里每个新 Pod 都必须能给出该维度的值，不声明的裸 Pod 会被拒绝。解法不是要求所有人记住写 resources，而是用 LimitRange 在准入阶段自动补默认值：default 给 limits、defaultRequest 给 requests，还可用 min/max 约束单 Pod 的边界。",
    },
    {
      type: "code",
      title: "shop 命名空间的 LimitRange",
      language: "yaml",
      code: `apiVersion: v1
kind: LimitRange
metadata:
  name: shop-limitrange
  namespace: shop
spec:
  limits:
    - type: Container
      default:
        cpu: 200m
        memory: 512Mi
      defaultRequest:
        cpu: 100m
        memory: 256Mi
      max:
        cpu: "2"
        memory: 4Gi`,
    },
    {
      type: "paragraph",
      text: "这份 LimitRange 对 shop 命名空间里每个容器生效：没写 resources 的容器在创建时自动获得 100m/256Mi 的请求与 200m/512Mi 的限制，任何单个容器不许超过 2 核/4Gi。它与配额是配套关系：配额回答「这个命名空间总共能用多少」，LimitRange 回答「单个 Pod 最少要有多少、最多能要多少」——前者是总闸，后者是让总闸能算清账的默认值加上单 Pod 的天花板。这也是为什么第 12 章《从零部署：分层落地与验证》里，配额与 LimitRange 要先于工作负载落地：治理边界必须先声明，对象才能申请。",
    },
    {
      type: "heading",
      text: "多团队实践：环境即命名空间",
    },
    {
      type: "paragraph",
      text: "把治理组合起来看，一台共享集群的每个团队或每个环境对应一个命名空间，三个对象各司其职：ResourceQuota 限定资源总量，LimitRange 统一单 Pod 的资源画像，RBAC 的 Role/RoleBinding 把操作权限限制在命名空间内（第 8 章讲过 Role 只在命名空间内生效，正好配对）。想给某个团队开一个更大的环境？复制一个命名空间、调大配额、把该团队的 RoleBinding 指过去——治理跟着边界走，不需要碰别人的环境。配合 NetworkPolicy（第 4 章）还能在命名空间之间设流量白名单，进一步收窄「共享集群」的信任面。日常审计看两件事：配额的使用率（describe resourcequota 的 Used/Hard，接近上限就该扩或该找团队聊）与命名空间里的异常对象增长。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "配额是契约，先讲清楚再执行",
      body: "配额拒绝是硬性的，但「给多少」是组织决策：按团队业务量定 baseline、为测试环境设明显小于生产的上限、预留给突发扩容的余量。把配额当沟通工具——它把「够不够用」从吵架变成看数字：Used/Hard 一查便知，接近上限就申请扩容，流程透明可审计。",
    },
    {
      type: "quiz",
      question:
        "给 shop 命名空间配置了含 limits.memory 的 ResourceQuota 后，一个没写 resources 字段的裸 Pod 被拒绝创建。为什么配置 LimitRange 后同样的裸 Pod 就能创建成功？",
      options: [
        "LimitRange 会删除配额里 limits.memory 的限制，让裸 Pod 不再受约束",
        "配额要求每个 Pod 都能对该维度计账；LimitRange 在准入阶段给裸 Pod 补上默认的 requests/limits，使计账成立",
        "LimitRange 提高了配额的总额度，裸 Pod 因此落在限额之内",
        "裸 Pod 不受 ResourceQuota 约束，被拒只是暂时的网络错误，与 LimitRange 无关",
      ],
      answer: 1,
      explanation:
        "配额按声明计账，允许 Pod 不声明维度等于允许无限声明、配额形同虚设，所以裸 Pod 被拒。LimitRange 在创建时自动写入默认值（default/defaultRequest），Pod 因而有了可计账的 requests/limits，同时获得合理的资源画像。选项 A、C 曲解了 LimitRange 的作用——它不删除配额也不扩总额，只提供默认值与单 Pod 边界；D 忽略了准入机制。",
    },
    {
      type: "keypoints",
      items: [
        "ResourceQuota 以命名空间为单位设总额：计算资源（requests/limits）、对象数量（counts）、存储声明，超限由准入直接拒绝。",
        "配额按声明计账、不管实际用量；运行期执行靠每个 Pod 自己的 limits，治理要配额 + LimitRange + 监控三层叠加。",
        "LimitRange 给裸 Pod 补默认 requests/limits 并限制单 Pod 边界——没有它，裸 Pod 在带配额的命名空间里会被拒。",
        "多团队 = 每环境一个命名空间：配额管量、LimitRange 管画像、RBAC 管权限，Used/Hard 是日常审计的入口。",
      ],
    },
  ],
};
