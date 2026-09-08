/* ==================================================================
 * 课时：StatefulSet：有状态应用的秩序（k8s-statefulset）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "Deployment 假设副本可互换；StatefulSet 用序号命名、headless Service 稳定 DNS 与每副本独立卷，给数据库这类有状态应用补上身份与存储的秩序。",
  blocks: [
    {
      type: "paragraph",
      text: "前两课的 Deployment 能管理 shop-web、shop-api，是因为它们「无状态」：每个副本长一样、可互换，名字是随机的（shop-web-<哈希>-<随机串>），删了重建一个就行。但轮到 shop-db（PostgreSQL）时，这套假设塌了：数据库的每个实例有身份、有必须活过 Pod 的数据。本课讲 StatefulSet 如何给这类应用补上秩序，以及它和 Deployment 的分界线在哪里。",
    },
    {
      type: "heading",
      text: "Deployment 的三个隐含假设",
    },
    {
      type: "list",
      items: [
        "副本可互换：任何副本都可以替代另一个，名字无关紧要，于是 Pod 名带随机串。",
        "共享一份存储即可：副本之间不各自独占数据（或者数据根本不落地）。",
        "启停顺序无所谓：同时拉起、同时删除，彼此不依赖启动次序。",
      ],
    },
    {
      type: "paragraph",
      text: "对照 shop 系统：shop-web 满足全部假设，shop-db 一个都不满足——它需要固定身份让客户端持续找到「同一个库」、需要独立且持久的存储、主从之间（若有）还有明确的启动顺序。把数据库硬塞进 Deployment，等于接受「每次发布数据库实例都会换名字、数据随 Pod 消失」。",
    },
    {
      type: "heading",
      text: "StatefulSet 的三样秩序",
    },
    {
      type: "definition",
      term: "序号命名",
      definition:
        "副本按序号 0..N-1 命名，Pod 名固定为 <statefulset 名>-<序号>，如 shop-db-0、shop-db-1。只要 StatefulSet 存在，shop-db-0 这个名字就属于这个实例——它被删后重建仍叫 shop-db-0。",
    },
    {
      type: "definition",
      term: "稳定的网络标识",
      definition:
        "配合 spec.serviceName 指向的 headless Service（clusterIP: None），每个 Pod 获得稳定的 DNS 名：shop-db-0.shop-db.shop.svc.cluster.local（同命名空间内可写短名 shop-db-0.shop-db）。客户端用这个名字，无论 Pod 被调度到哪个节点、重建多少次，都能找到同一个实例。headless Service 的完整语义在第 4 章《Service：稳定的访问入口与 DNS》展开，本课只需要知道：没有它，StatefulSet 就只有序号没有 DNS 身份。",
    },
    {
      type: "definition",
      term: "稳定存储",
      definition:
        "volumeClaimTemplate 像「Pod 模板里的 PVC 模板」：每创建一个副本，控制器就按模板给它生成一个独立的 PVC，名字形如 <卷模板名>-<副本名>，例如 data-shop-db-0。每个副本因此拥有只属于自己的卷，重启、重调度后数据还在。PVC/PV 的绑定与供给机制放在第 6 章《PV、PVC 与 StorageClass》讲，本课只记结论：每个副本独立卷。",
    },
    {
      type: "heading",
      text: "有序启停与「删了不自动清 PVC」",
    },
    {
      type: "paragraph",
      text: "扩容时控制器按序号顺序创建：shop-db-0 就绪后才创建 shop-db-1，依次推进（这就是 Pod 的「有序部署」）；缩容则反过来，从最大序号开始删：3 副本缩到 1，先删 shop-db-2、再删 shop-db-1，shop-db-0 始终保留。这是刻意的语义：对数据库这类应用，保底的那个实例（通常是主库）最后才被动摇。删除整个 StatefulSet（kubectl delete statefulset）同样不会删除 PVC——数据保留是特性不是缺陷；想连同数据一起删，需要手动删 PVC（PVC 被删后数据如何处理由回收策略决定，第 6 章展开）。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "volumeClaimTemplate 的卷要等存储就绪",
      body: "较老版本的 kind 集群没有 StorageClass 与动态供给：这里声明的 PVC 会停在 Pending，Pod 也停在 Pending 等卷——这是「缺少存储供给」，不是 StatefulSet 的问题。注意：2026 年发布的较新 kind 会在创建集群时自带 local-path-provisioner 默认存储类，此时 PVC 会直接 Bound、Pod 正常启动。两种情况都正常，以 kubectl get storageclass 的实际输出为准。第 6 章《PV、PVC 与 StorageClass》会系统讲静态供给与默认类，第 12 章综合实战会用完整方案跑起 shop-db。本课先聚焦对象语义。",
    },
    {
      type: "heading",
      text: "shop-db：StatefulSet + headless Service + Secret",
    },
    {
      type: "paragraph",
      text: "先建数据库凭据 Secret（环境变量将从它注入；Secret 的结构、类型与防护放在第 5 章《Secret：敏感数据与信任边界》，这里先按约定名创建，密码仅用于本地演示）：",
    },
    {
      type: "code",
      title: "创建 shop-db 凭据 Secret",
      language: "bash",
      code: `kubectl -n shop create secret generic shop-db-credentials \
  --from-literal=POSTGRES_USER=shop \
  --from-literal=POSTGRES_PASSWORD='Shop-db-pass-2026' \
  --from-literal=POSTGRES_DB=shop`,
    },
    {
      type: "paragraph",
      text: "headless Service 只负责「给每个 Pod 发稳定的 DNS 名」，不做负载均衡——StatefulSet 的 spec.serviceName 填它的名字：",
    },
    {
      type: "code",
      title: "shop-db-headless.yaml",
      language: "yaml",
      code: `apiVersion: v1
kind: Service
metadata:
  name: shop-db
  namespace: shop
spec:
  clusterIP: None
  selector:
    app: shop-db
  ports:
    - port: 5432
      targetPort: 5432`,
    },
    {
      type: "code",
      title: "shop-db.yaml（StatefulSet 骨架）",
      language: "yaml",
      code: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: shop-db
  namespace: shop
spec:
  serviceName: shop-db
  replicas: 1
  selector:
    matchLabels:
      app: shop-db
  template:
    metadata:
      labels:
        app: shop-db
    spec:
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - containerPort: 5432
          envFrom:
            - secretRef:
                name: shop-db-credentials
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 1Gi`,
    },
    {
      type: "paragraph",
      text: "清单要点：volumeClaimTemplates 里的 name: data 与容器 volumeMounts 对应，控制器为每个序号生成 PVC data-shop-db-<序号>；数据目录 /var/lib/postgresql/data 挂在这个独立卷上（为什么 postgres 数据要落在这里、卷的类型怎么选，都是第 6 章的事）。envFrom 把 Secret 的三个键注入为同名环境变量，postgres 镜像的入口脚本据此初始化数据库——Secret 的创建与保护细节见第 5 章。副本数保持 1 是刻意的：未配置复制的多个 PostgreSQL 副本是互相独立的库，写入会分裂——生产多副本要复制方案或数据库 Operator（第 6 章《CSI 与有状态应用的生产注意》会讲这条责任边界）。",
    },
    {
      type: "code",
      title: "验证序号与稳定标识",
      language: "bash",
      code: `kubectl apply -f shop-db-headless.yaml -f shop-db.yaml
kubectl -n shop get statefulset,pods,pvc
# 注：有序扩缩容要等「卷可绑定、Pod 能 Ready」才能完整观察；
# 若无动态供给（PVC 停留 Pending），到第 6 章把存储补上后再回来看这一节。
kubectl -n shop scale statefulset/shop-db --replicas=3
kubectl -n shop get pods -w -l app=shop-db
kubectl -n shop scale statefulset/shop-db --replicas=1
# 若 shop-db-0 处于 Running（意味着卷已就绪），可验证稳定 DNS：
kubectl -n shop run dns-probe --image=busybox:1.36 --rm -it --restart=Never -- \
  nslookup shop-db-0.shop-db.shop.svc.cluster.local`,
    },
    {
      type: "paragraph",
      text: "预期特征（前提：卷可绑定、Pod 能 Ready）：PVC 列表出现 data-shop-db-0（扩到 3 时依次出现 data-shop-db-1、data-shop-db-2）；扩容时 Pod 按 shop-db-0 → shop-db-1 → shop-db-2 顺序进入 Running；缩回 1 时删除顺序相反，且 PVC 全部保留。存储未就绪时 PVC/Pod 停在 Pending，只能看到控制器按序创建与删除对象的动作。nslookup 返回 shop-db-0 的 Pod IP（headless Service 没有虚拟 IP，DNS 直接给出 Pod 地址）。",
    },
    {
      type: "heading",
      text: "更新策略与选型决策",
    },
    {
      type: "paragraph",
      text: "StatefulSet 的 updateStrategy 默认 RollingUpdate：按序号逐个替换为新模板；也可设 OnDelete：只有手动删除某个 Pod，它才按新模板重建——适合想自己控制节奏的运维。其余发布机制（滚动节奏、回滚）与 Deployment 类似，但数据库换版本通常伴随迁移脚本，不是简单回滚能解决的，这层复杂性归第 6 章《CSI 与有状态应用的生产注意》讨论。选型时记住一句话判断：副本可互换、数据可重建 → Deployment；每个实例有身份、有独立数据、有启停顺序 → StatefulSet。",
    },
    {
      type: "table",
      caption: "Deployment 与 StatefulSet 选型",
      headers: ["维度", "Deployment", "StatefulSet"],
      rows: [
        ["副本身份", "随机名、可互换", "序号名（0..N-1）、身份固定"],
        ["网络标识", "由 Service 统一负载均衡", "headless Service + 每 Pod 稳定 DNS"],
        ["存储", "无独立卷假设", "volumeClaimTemplate，每副本独立 PVC"],
        ["启停", "无顺序要求", "有序部署/缩容/删除，缩容从最大序号开始"],
        ["适合", "shop-web、shop-api 等无状态服务", "数据库、消息队列等有状态服务"],
      ],
    },
    {
      type: "quiz",
      question:
        "shop-db 先扩到 3 副本、再缩回 1 副本。关于这个过程的描述，哪一句正确？",
      options: [
        "控制器随机挑选 Pod 删除，可能是 shop-db-1 先消失",
        "缩容按序号从大到小：先删 shop-db-2 再删 shop-db-1，shop-db-0 保留；它们各自的 PVC 会随 Pod 一起被删除",
        "缩容按序号从大到小：先删 shop-db-2 再删 shop-db-1，shop-db-0 保留；PVC 不会被自动删除",
        "缩容从序号最小的 shop-db-0 开始，先删最老的副本",
      ],
      answer: 2,
      explanation:
        "StatefulSet 缩容严格按序号从大到小进行，保证序号最小的实例（通常承载主库/最早数据）最后被动摇，所以 A 与 D 的方向都不对。PVC 由 volumeClaimTemplate 生成、独立于 Pod 存在：Pod 被删（缩容或删除 StatefulSet）都不会自动删除 PVC——数据保留是刻意设计，要连数据一起清必须手动删 PVC，因此 B 错、C 对。",
    },
    {
      type: "keypoints",
      items: [
        "StatefulSet 给有状态应用三样秩序：序号命名（0..N-1）、headless Service 提供的稳定 DNS、volumeClaimTemplate 带来的每副本独立卷。",
        "扩缩容按序号有序进行：扩容从 0 开始，缩容从最大序号开始；删除 StatefulSet 不删 PVC，数据保留是特性不是缺陷。",
        "选型分界一句话：副本可互换、数据可重建用 Deployment；需要稳定身份 + 独立数据用 StatefulSet。",
      ],
    },
  ],
};
