/* ==================================================================
 * 课时：CSI 与有状态应用的生产注意（k8s-csi-stateful-production）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "CSI 把存储插件标准化，StorageClass 参数决定盘的类型与性能；把有状态应用放上 k8s 前，先分清集群负责什么、你必须负责什么。",
  blocks: [
    {
      type: "paragraph",
      text: "前两课把存储的抽象讲完了：emptyDir 与 hostPath 绑定 Pod/节点，PV/PVC/StorageClass 把存储提升为集群级声明。但还有一个悬而未决的问题：StorageClass 里的 provisioner 到底是谁？上一课的 hostPath 是 k8s 内置卷类型，不需要 provisioner——可云上的盘不是这样。如果每种存储都要写进 k8s 核心代码，新存储就只能等 k8s 发版才能用，显然不可持续。本课先讲行业给出的答案 CSI，再讲卷的扩容与快照，最后把 shop-db 完整跑在有状态形态上，并划清责任边界：集群保证什么、你必须自己保证什么。",
    },
    {
      type: "heading",
      text: "CSI：存储插件的统一标准",
    },
    {
      type: "paragraph",
      text: "CSI（Container Storage Interface，容器存储接口）是一份存储插件标准：存储厂商实现独立的 CSI 驱动（driver），k8s 通过标准接口调用它完成创建卷、删除卷、挂载、卸载、快照等操作——k8s 只定义接口，不实现厂商细节。驱动的部署形态和第 3 章学过的工作负载一致：通常一部分以 DaemonSet 跑在每个节点负责挂载，另一部分以 Deployment/StatefulSet 负责控制面操作。对使用者来说 CSI 几乎透明：你依然写 PVC，变化只发生在 StorageClass 上——provisioner 填驱动名，parameters 决定「造出来的卷长什么样」。同样是申请 10Gi，参数不同，底层可能是完全不同的存储产品。",
    },
    {
      type: "code",
      title: "一个 StorageClass 示例（字段形态，非真实驱动）",
      language: "yaml",
      code: `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-block
provisioner: csi.example.com/block   # 示例地址：真实值是你的 CSI 驱动名
parameters:
  type: gp3            # 示例参数：盘的类型
  iops: "3000"         # 示例参数：性能档
  encrypted: "true"    # 示例参数：是否加密
reclaimPolicy: Delete
allowVolumeExpansion: true`,
    },
    {
      type: "paragraph",
      text: "provisioner 填驱动名，parameters 是驱动自定义的键值对（上面是虚构地址 csi.example.com，真实值以你所用的驱动文档为准）。reclaimPolicy 在这里为动态供给的卷统一设定回收策略——上一课讲过，Delete 意味着 PVC 删除时底层盘可能真的被删。allowVolumeExpansion: true 打开后 PVC 才允许扩容（下一节展开）。把 StorageClass 想成集群里的「存储菜单」：管理员备菜（建带参数的类），应用作者点菜（PVC 里写 storageClassName）。",
    },
    {
      type: "paragraph",
      text: "k8s 官方正把内置（in-tree）存储插件逐步迁移到 CSI：新存储一律走 CSI，旧插件只维护不新增。学习时认准 PVC/PV/StorageClass 这一层抽象即可——底层换成任何存储，这一层的行为都一致。",
    },
    {
      type: "heading",
      text: "卷的两种进阶操作：扩容与快照",
    },
    {
      type: "paragraph",
      text: "容量是写死在 PVC 里的：申请 1Gi 就用 1Gi。数据涨了怎么办？扩容。前提是 StorageClass 开了 allowVolumeExpansion（如上面的示例）且 CSI 驱动支持。做法是改大 PVC 的申请：kubectl edit pvc 或改清单后重新 apply——沿用第 5 章《配置发布实践：diff、dry-run 与滚动生效》的声明式纪律。控制器发现申请变大，会调用驱动先扩底层卷、再扩文件系统。两个边界要记住：只能扩大、不能缩小——缩容会破坏数据，k8s 不支持按需缩卷；是否在线生效（应用不停机）取决于驱动与文件系统，有的需要重建 Pod 才会重新挂载。kind 的 hostPath 卷没有 CSI 驱动，扩不动，这个能力要在有真实驱动的集群上验证。",
    },
    {
      type: "paragraph",
      text: "快照是另一类操作：PVC 描述「当前状态的卷」，VolumeSnapshot 描述「某个时刻的卷」——由 CSI 驱动在存储侧做的一次只读拷贝。两个典型用途：备份（定期打快照，出事后基于快照恢复；恢复细节本课不展开，以官方文档为准）和克隆（从快照生成全新卷，用于测试环境或初始化新副本）。注意快照不是 k8s 核心自带的默认能力：需要 CSI 驱动支持，且集群里安装快照 CRD 与控制器（外部组件，按官方文档安装）。kind 的本地卷没有 CSI 驱动，本课不做快照演示。",
    },
    {
      type: "heading",
      text: "StatefulSet × PVC：稳定存储的完整形态",
    },
    {
      type: "paragraph",
      text: "第 3 章《StatefulSet：有状态应用的秩序》讲过 StatefulSet 的两个稳定：稳定网络标识与稳定存储。当时存储细节被推迟到本章，现在补全：StatefulSet 与 Deployment 语法上最显著的区别之一就是 spec.volumeClaimTemplates——它不是给 Pod 挂现成的 PVC，而是给每个副本生成独立的 PVC：序号为 0 的副本对应 PVC <模板名>-<控制器名>-0，序号 1 对应 -1，依此类推。Pod 被删除重建时，新 Pod 按同一序号重新认领同一块 PVC——数据跟着序号走，这就是「稳定存储」的实现机制。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "缩容与删除都不清 PVC，这是特性",
      body: "StatefulSet 缩容（副本数变小）只删 Pod，不删 PVC；把整个 StatefulSet 删掉，PVC 依然保留。这是刻意设计的数据安全措施：有状态数据不能因为一次误操作 scale 或 delete 就蒸发。代价是你需要记得手动清理：确定数据不要了，先删 StatefulSet，再手动 kubectl delete pvc 逐个删除，才会触发 PV 的回收策略。回看第 3 章《StatefulSet：有状态应用的秩序》里「删除不自动清 PVC」的提醒，现在你能看到它完整的因果链了。",
    },
    {
      type: "heading",
      text: "shop-db 完整示例：挂上真实卷的 PostgreSQL",
    },
    {
      type: "paragraph",
      text: "把第 3 章的 StatefulSet 骨架、第 5 章的 Secret 密码和第 23 课的静态供给拼在一起，就是 shop-db 的完整形态。先由管理员准备一块 PV（沿用上一课的静态供给方式；若上一课的演示卷还在集群里，注意名字不要冲突）：",
    },
    {
      type: "code",
      title: "shop-db-pg-pv.yaml：shop-db 的卷",
      language: "yaml",
      code: `apiVersion: v1
kind: PersistentVolume
metadata:
  name: shop-db-pg-pv
spec:
  capacity:
    storage: 1Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  hostPath:
    path: /mnt/k8s/shop-db-pg
    type: DirectoryOrCreate
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - k8s-course-worker`,
    },
    {
      type: "paragraph",
      text: "数据库凭据沿用第 3/5 章建立的全课约定：Secret `shop-db-credentials`（键 POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB，经 envFrom 注入，清单见第 3 章《StatefulSet：有状态应用的秩序》）。若前面章节还没创建过它，先创建一次（演示专用密码，仅限本地实验）：",
    },
    {
      type: "code",
      title: "创建数据库密码 Secret",
      language: "bash",
      code: `kubectl -n shop create secret generic shop-db-credentials \\
  --from-literal=POSTGRES_USER=shop \\
  --from-literal=POSTGRES_PASSWORD='Shop-db-pass-2026' \\
  --from-literal=POSTGRES_DB=shop`,
    },
    {
      type: "code",
      title: "shop-db.yaml：headless Service + StatefulSet + volumeClaimTemplate",
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
      targetPort: 5432
---
apiVersion: apps/v1
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
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "shop"]
            initialDelaySeconds: 5
            periodSeconds: 10
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: ""
        resources:
          requests:
            storage: 1Gi`,
    },
    {
      type: "paragraph",
      text: "与存储相关的有三处。第一，volumeClaimTemplates 声明「每个副本的卷长什么样」：模板名 data、1Gi、RWO、不走存储类（storageClassName 显式空值）；控制器为每个序号生成 PVC，单副本时名字是 data-shop-db-0（规则：模板名-控制器名-序号），自动去匹配管理员预建的无类 PV。第二，volumeMounts 把卷挂到 PostgreSQL 的数据目录 /var/lib/postgresql/data——清单里没有独立的 volumes 段，StatefulSet 的卷全部由模板按序号生成，这正是它与 Deployment 的语法差异。第三，凭据经 envFrom 从 shop-db-credentials 注入（与第 3 章清单同构），postgres 入口脚本据此完成建库建用户；readinessProbe 用 pg_isready 探测数据库是否就绪（探针语义见第 2 章《生命周期、重启与三种探针》）。",
    },
    {
      type: "code",
      title: "部署并验证数据活过 Pod",
      language: "bash",
      code: `kubectl apply -f shop-db-pg-pv.yaml
kubectl apply -f shop-db.yaml

kubectl -n shop get pvc -w    # data-shop-db-0 很快 Bound
kubectl -n shop get pod -l app=shop-db -w   # shop-db-0 Running/Ready

# 写入一张表
kubectl -n shop exec shop-db-0 -- psql -U shop -d shop -c \\
  "CREATE TABLE IF NOT EXISTS orders (id serial PRIMARY KEY, title text);"

# 模拟 Pod 死亡：StatefulSet 会重建同名 Pod，并认领同一块 PVC
kubectl -n shop delete pod shop-db-0
kubectl -n shop get pod -l app=shop-db -w   # 新的 shop-db-0 再次 Ready

# 数据还在——它住在 PVC 里，不在 Pod 里
kubectl -n shop exec shop-db-0 -- psql -U shop -d shop -c "\\dt"`,
    },
    {
      type: "paragraph",
      text: "整个实验想让你亲眼确认一件事：Pod 死了又活，表还在。删除 shop-db-0 后，控制器按序号重建同名 Pod——它可能被调度到另一台 worker——然后挂载同一块 PVC，数据从卷里回来。这就是 StatefulSet × PVC 的组合语义：序号即身份，DNS 与卷都随序号走。同样的操作换成 Deployment 就不成立：副本没有序号，PVC 与 Pod 之间不存在一一对应。这也是为什么有状态应用必须用 StatefulSet，而不是 Deployment 加一块共享盘硬凑。",
    },
    {
      type: "heading",
      text: "责任边界：k8s 管到哪，剩下是你的",
    },
    {
      type: "paragraph",
      text: "现在 shop-db 在集群里跑起来了，是时候回答最重要的问题：k8s 到底替你保证了什么？它保证调度、自愈与挂载——Pod 崩溃了重建、节点故障了换节点拉起并把卷重新挂上、PVC 按声明供给与回收。它不保证数据的备份、复制与高可用：没人替 PostgreSQL 做每日备份，不会自动配置主从复制，不会在数据库宕机时自动选主。数据库这类有状态应用的共识是：k8s 保证「卷跟着 Pod 走」，不保证「数据不会丢」。",
    },
    {
      type: "table",
      caption: "有状态应用上 k8s：谁负责什么",
      headers: ["环节", "谁负责", "说明"],
      rows: [
        ["Pod 调度、重启、自愈", "k8s（控制器）", "Deployment/StatefulSet 控制器 + 调度器"],
        ["卷的供给、绑定、挂载", "k8s（PV/PVC/CSI）", "按声明供给，Pod 换节点时重新挂载"],
        ["数据备份与恢复演练", "你", "pg_dump、卷快照，定时执行并定期演练"],
        ["复制、故障转移、选主", "你或 Operator", "数据库高可用方案要自己搭，或交给数据库 Operator"],
        ["底层存储的可靠性", "存储提供方", "云盘/NFS 的可用性与数据冗余由存储系统保证"],
      ],
    },
    {
      type: "paragraph",
      text: "「你或 Operator」是现在数据库上 k8s 的主流答案：Operator = CRD + 控制器（机制见第 9 章《扩展：CRD、Operator 与准入 Webhook》），把备份、复制、故障转移这类运维知识代码化——你声明一个「高可用数据库实例」，它负责调谐到那个状态。生态里 PostgreSQL 等数据库都有成熟 Operator，本课不展开任何具体 Operator 的使用。你需要带走的判断框架：单实例、可接受较长停机恢复的场景，裸 StatefulSet 加自己的备份脚本就够；要求自动故障转移与托管备份，才值得引入 Operator。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "别把「删 STS 数据还在」当成安全网",
      body: "PVC 不随 StatefulSet 删除，防的只是「误删工作负载」这一种事故。它防不了磁盘损坏、节点故障连带目录损坏、误删 PVC，更防不了整个集群被删。生产数据的防线是另外三件事：定时备份（并放到集群之外）、定期做恢复演练（没演练过的备份等于没有备份，第 10 章《etcd 快照与灾难恢复》讲控制面数据时还会强调同一件事）、以及用第 8 章要学的 RBAC 管住「谁能删」。",
    },
    {
      type: "quiz",
      question:
        "shop-db 用 volumeClaimTemplates 声明了卷。你把整个 StatefulSet 删掉（kubectl delete sts shop-db），数据卷会怎样？",
      options: [
        "PVC 随 StatefulSet 一起被自动删除，数据丢失",
        "PVC 与数据都保留，需要时手动删 PVC 才会触发回收",
        "PVC 保留，但卷里的数据被清空",
        "StatefulSet 删除会被拒绝，必须先删 PVC",
      ],
      answer: 1,
      explanation:
        "由 volumeClaimTemplates 生成的 PVC 刻意不跟随 StatefulSet 删除——这是数据安全设计：一次误删工作负载不能连带销毁数据。所以删除 STS 后 PVC 与数据都还在；想彻底清理，需先删 STS、再手动删 PVC，才会触发 PV 的回收策略（Retain/Delete）。选项 A 与 k8s 的实际行为相反；选项 C 中 k8s 不会主动清空卷内容；选项 D 不成立——StatefulSet 随时可删，只是 PVC 会留下来。",
    },
    {
      type: "quiz",
      question: "shop-db 已在集群里稳定运行。以下哪一项仍然必须由你（而不是 Kubernetes）来保证？",
      options: [
        "worker 节点宕机后，shop-db-0 连同它的卷在其他节点重建并重新挂载",
        "PostgreSQL 的数据每天有备份，且备份经过恢复演练",
        "PVC 按声明绑定到 PV，并被挂载进 shop-db-0 的 /var/lib/postgresql/data",
        "shop-db-0 崩溃后，StatefulSet 控制器把它重新拉起",
      ],
      answer: 1,
      explanation:
        "备份与恢复演练不在 k8s 的职责内：集群保证的是调度、自愈与卷挂载——选项 A（节点故障后重建并重挂卷）、C（PVC 绑定与挂载）、D（控制器重建 Pod）都是 k8s 控制器负责的事。数据的备份、复制与故障转移需要你自己或 Operator 负责，这正是本课「责任边界」的核心。",
    },
    {
      type: "keypoints",
      items: [
        "CSI 是存储插件统一标准：厂商实现驱动，k8s 只管接口；in-tree 内置插件逐步向 CSI 迁移。",
        "StorageClass 是存储菜单：provisioner 选驱动、parameters 定盘型与性能、reclaimPolicy 定回收、allowVolumeExpansion 开关扩容。",
        "扩容只能变大：PVC 声明式改大 + StorageClass 允许 + 驱动支持；快照（VolumeSnapshot）用于备份与克隆，需要驱动与外部组件。",
        "StatefulSet × PVC：volumeClaimTemplates 为每个序号生成独立 PVC（data-shop-db-0）；Pod 重建按序号认领同一卷；缩容与删除 STS 都不清 PVC——数据保留是特性，清理需手动删 PVC。",
        "责任边界：k8s 保证调度 + 挂载 + 自愈，不保证备份、复制、故障转移——数据库高可用要自己或 Operator 负责（机制见第 9 章《扩展：CRD、Operator 与准入 Webhook》）。",
      ],
    },
  ],
};
