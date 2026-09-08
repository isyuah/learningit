/* ==================================================================
 * 课时：NetworkPolicy：集群内的流量防线（k8s-networkpolicy）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Kubernetes 默认不限制 Pod 间流量；NetworkPolicy 用「目标 Pod + 入站/出站白名单」给东西向流量划线，本课给出 shop 分层白名单的完整 YAML 并说明 kindnet 不执行策略的现实。",
  blocks: [
    {
      type: "paragraph",
      text: "前几课我们解决的都是「让流量通」：Service 提供稳定入口、Ingress 把外部流量送进来。但集群里还有一类流量几乎没有被讨论——Pod 之间的东西向流量。默认情况下 Kubernetes 对 Pod 间通信不做任何限制：shop-web 能访问 shop-db，任何被攻破的 Pod 都能横向扫全集群。想象 shop-api 因某个依赖漏洞被攻破，攻击者拿到的 shell 可以直连数据库的 5432 端口——这就是默认全放通的危险。NetworkPolicy 就是给这条东西向流量画线的工具：它是命名空间级对象，用白名单模式声明「谁可以访问哪些 Pod、Pod 可以访问谁」。",
    },
    {
      type: "heading",
      text: "模型：一个策略 = 目标 Pod + 方向白名单",
    },
    {
      type: "code",
      title: "最小示例：只允许 shop-web 访问 shop-api 的 8080",
      language: "yaml",
      code: `apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shop-api-allow-web
  namespace: shop
spec:
  podSelector:
    matchLabels:
      app: shop-api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: shop-web
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: shop-db
      ports:
        - protocol: TCP
          port: 5432`,
    },
    {
      type: "paragraph",
      text: "结构分三层读：spec.podSelector 选择「这份策略管谁」——本策略作用到 shop 命名空间里带 app: shop-api 标签的 Pod（注意：策略是命名空间级的，只能约束自己命名空间里的 Pod，空选择器 {} 则匹配该命名空间全部 Pod）。policyTypes 声明要约束哪些方向（Ingress 入站 / Egress 出站），省略时由规则自动推断。ingress/egress 是白名单规则列表：凡是被 policyTypes 声明的方向，被选中的 Pod 只放行命中规则的流量，其余一律默认拒绝。上面的 Ingress 规则翻译成人话：只允许来自带 app: shop-web 标签的 Pod、访问 8080 端口的入站流量。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "白名单模式的开关：policyTypes",
      body: "「该方向其余默认拒绝」只对出现在 policyTypes 里的方向生效。本例声明了 Egress，却只放行了到 shop-db 的连接——shop-api 发往其他任何地方的流量都会被拒，所以必须把每条必要路径都写全（本课稍后处理 DNS）。反之，如果一个方向没被声明（比如只写了 Ingress），那个方向的流量完全不受限。刚上手时最常见的翻车就是：只写了入站规则没声明 Egress，以为出站也限制了——实际没有。",
    },
    {
      type: "heading",
      text: "规则里的来源与目的地怎么写",
    },
    {
      type: "paragraph",
      text: "ingress 规则用 from 声明「允许谁进来」，egress 规则用 to 声明「允许访问谁」，语法相同，支持三种对端写法。需要精确区分组合语义，官方规则如下：同一策略里多条规则条目之间是「或」（命中任意一条即放行）；同一条规则里 from/to 与 ports 之间是「且」；from/to 数组内部的多个对端之间是「或」。",
    },
    {
      type: "table",
      caption: "对端（peer）的三种写法与语义",
      headers: ["写法", "选择范围", "注意"],
      rows: [
        ["podSelector", "策略所在命名空间内带某标签的 Pod", "只在本命名空间内选；想选别的命名空间必须配合 namespaceSelector"],
        ["namespaceSelector", "满足标签条件的整个命名空间", "跨命名空间放行的基本手段；与 podSelector 写在同一对端里时是「且」"],
        ["ipBlock", "指定的 IP 网段（可配 except 排除）", "用于无法用标签表达的场景（节点网段、集群外地址）；通常单独使用"],
      ],
    },
    {
      type: "paragraph",
      text: "组合语义的完整拼图：同一条规则内 from（或 to）与 ports 是「且」——来源对了端口不对也放行不了；from 数组里的多个对端是「或」——「来自 shop-web 的 Pod 或来自监控命名空间」都算命中；一个对端条目里同时写 namespaceSelector 与 podSelector 则是「且」——「在 ingress-nginx 命名空间里且带某个标签的 Pod」。规则不写 from/to 表示不限制来源/目的（此时只剩 ports 条件）；某方向出现在 policyTypes 但规则列表为空（ingress: []），则该方向全部拒绝——这是常见的「默认拒绝」写法。ipBlock 覆盖的是 IP 网段，而 CNI 里 Pod IP 会随重建变化，因此能用标签表达的对端优先用标签，网段用于放行节点或集群外来源。",
    },
    {
      type: "heading",
      text: "egress 的坑：拒绝之后连 DNS 都断了",
    },
    {
      type: "paragraph",
      text: "一旦给某组 Pod 声明了 Egress 白名单，它的所有出站都要显式放行——包括域名解析。集群里 Pod 的 DNS 请求是发给 kube-system 命名空间里 CoreDNS 的（第 4 章《Service：稳定的访问入口与 DNS》讲过它的位置），所以每条 egress 规则都要带上「允许访问 kube-system 的 kube-dns Pod 的 53 端口」这一条，否则症状很迷惑：直连 IP 能通、按服务名访问全部超时（解析失败）。下面的完整示例会看到这个模式的反复出现。",
    },
    {
      type: "heading",
      text: "shop 分层白名单：完整 YAML",
    },
    {
      type: "paragraph",
      text: "把最小权限落到 shop：web 只接受来自 Ingress 控制器的流量、只访问 api；api 只接受 web 的访问、只访问 db 与缓存；db 只接受 api 的访问、不需要出站。三个 NetworkPolicy 可以放在一个文件里用 --- 分隔。",
    },
    {
      type: "code",
      title: "shop-networkpolicies.yaml",
      language: "yaml",
      code: `# 1) shop-db：只允许 shop-api 访问 5432；不声明 Egress → 出站不受限
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shop-db-allow-api
  namespace: shop
spec:
  podSelector:
    matchLabels:
      app: shop-db
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: shop-api
      ports:
        - protocol: TCP
          port: 5432
---
# 2) shop-api：只允许 shop-web 访问 8080；出站只许去 db、缓存与 DNS
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shop-api-allow-web
  namespace: shop
spec:
  podSelector:
    matchLabels:
      app: shop-api
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: shop-web
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: shop-db
      ports:
        - protocol: TCP
          port: 5432
    - to:
        - podSelector:
            matchLabels:
              app: shop-cache
      ports:
        - protocol: TCP
          port: 6379
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
---
# 3) shop-web：入口只放行 Ingress 控制器命名空间；出站只许去 api 与 DNS
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: shop-web-allow-ingress
  namespace: shop
spec:
  podSelector:
    matchLabels:
      app: shop-web
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: shop-api
      ports:
        - protocol: TCP
          port: 8080
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53`,
    },
    {
      type: "paragraph",
      text: "逐条解读这份 YAML：数据库策略只声明 Ingress，因为它不需要主动访问别人——不声明的方向默认放行，这本身就是一种克制的最小化。api 与 web 的 egress 都带上了放行 kube-dns 的那一条，对应前面说的 DNS 坑；对端里 namespaceSelector（kube-system）与 podSelector（k8s-app: kube-dns）并用是「且」的关系，精确到 CoreDNS 的 Pod。web 的入站放行的是整个 ingress-nginx 命名空间且没限制端口，因为入口控制器的健康检查与转发可能来自不同端口——最小权限原则下能写端口就写，这里为了不误伤故意放宽。",
    },
    {
      type: "callout",
      variant: "tip",
      title: "策略端口写的是 Pod 端口，不是 Service 端口",
      body: "NetworkPolicy 在内核数据面执行，规则里的端口对应后端 Pod 真实监听的端口（DNAT 之后的目标端口）：web 访问 shop-api 走 Service 的 80，但策略里写 8080——因为包到达 shop-api Pod 时目的端口已是容器端口。如果还有 shop-cache，只需照 shop-db 的模式加一条「允许来自 app: shop-api 的 6379 入站」，本课不单独展开。",
    },
    {
      type: "heading",
      text: "kindnet 的现实：默认不执行 NetworkPolicy",
    },
    {
      type: "paragraph",
      text: "这里必须澄清一个重要的现实：NetworkPolicy 是规范，执行它需要 CNI 插件内置策略引擎（在数据面按规则放行/丢弃）。本课程 kind 集群默认的 kindnet 只实现基本连通，不执行 NetworkPolicy——《网络模型：每个 Pod 一个 IP》一课提到过这个边界。也就是说，把上面的 YAML apply 进 kind 不会报错，但流量行为不会有任何变化。验证方法：应用策略前后，从 shop-web 的 Pod 里 curl shop-api，两次都通——这恰恰说明策略没有被执行。想在本地真实验证策略生效，需要把集群换到支持策略的 CNI（如 Calico、Cilium），kind 官方文档提供了禁用默认 CNI 后安装它们的路线，安装与配置以各自官方文档为准，超出本课范围。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "策略在「真集群」里的连带影响",
      body: "在支持策略的集群里上线白名单要格外小心：它不只拦 Pod 之间的访问，经 NodePort/LoadBalancer/Ingress 进来的流量也要过目标 Pod 的入站白名单——比如上面 web 的策略就要求入口流量来自 ingress-nginx 命名空间，若你改用 NodePort 直连 shop-web，就需要额外的放行来源。推荐的落地顺序：先在测试环境逐条 apply、用真实流量路径验证，再推广；上线策略最常见的翻车点是「写策略时漏掉一条业务路径」。",
    },
    {
      type: "quiz",
      question: "给 shop-api 应用了一份只声明 policyTypes: [Ingress]、且 ingress 只放行来自 shop-web 的策略后，shop-api 访问 shop-db 会出现什么情况？",
      options: [
        "正常访问——Egress 未声明，出站方向不受任何限制",
        "连接被拒绝——Ingress 白名单也会顺带限制出站流量",
        "正常访问但必须经过 shop-web 中转",
        "只有 DNS 解析会失败，直连 IP 不受影响",
      ],
      answer: 0,
      explanation:
        "白名单只约束出现在 policyTypes 里的方向：只声明 Ingress 意味着入站只放行 shop-web，出站（Egress）完全没有被限制，所以访问 shop-db 正常。这正是「声明方向 = 开启该方向白名单」语义的核心，也解释了为什么想限制出站必须显式声明 Egress 并放行 DNS。",
    },
    {
      type: "keypoints",
      items: [
        "默认无策略 = 全放行；NetworkPolicy 是命名空间级白名单：policyTypes 声明方向后，该方向未命中规则即拒绝。",
        "组合语义：规则条目间「或」、对端数组内「或」、同对端多字段与 ports 是「且」；ipBlock 通常单独使用。",
        "声明 Egress 白名单必须放行 kube-system 的 kube-dns（53 端口），否则域名解析全断。",
        "kind 默认 kindnet 不执行 NetworkPolicy：策略 apply 成功但无效果，真实验证需换支持策略的 CNI。",
      ],
    },
  ],
};
