/* ==================================================================
 * 课时：PV、PVC 与 StorageClass：存储的声明式抽象（k8s-pv-pvc-storageclass）
 * ----------------------------------------------------------------
 * 本文件只含 summary 与 blocks；slug/title/minutes/kind 以
 * course.ts 大纲为权威，此处不冗余声明。
 * 块类型见 src/content/types.ts；写作规范见 docs/CONTENT-AUTHORING.md。
 * ================================================================== */
import type { Lesson } from "../../../types";

export const lesson: Lesson = {
  summary:
    "PV 描述底层存储资产、PVC 是使用者的申请单、StorageClass 让供给自动化；用 hostPath 在 kind 上走通从建卷、绑定到回收的静态供给全流程。",
  blocks: [
    {
      type: "paragraph",
      text: "上一课的两类卷各有一个死穴：emptyDir 随 Pod 蒸发，hostPath 焊死在单台节点上。合起来看，真实需求就清楚了——数据要活得比 Pod 长，还要在 Pod 换节点时跟过去。k8s 的回答不是再发明一种「更持久的卷」，而是一次抽象升级：把「存储长什么样」和「我要用多大、怎么用」彻底分开，由集群负责撮合。本课的三件套 PV、PVC 与 StorageClass 就是这套抽象的骨架。学完你会在 kind 上亲手把静态供给的全链路跑通，并亲眼观察回收策略的差别。",
    },
    {
      type: "heading",
      text: "两个角色：PV 是资产，PVC 是申请单",
    },
    {
      type: "paragraph",
      text: "在 k8s 里，「一块真实的存储」被表示成一个集群对象：持久卷（PersistentVolume，PV）。它描述一块盘的物理事实：容量多大、底层在哪里（云盘 ID、NFS 路径，或上一课见过的 hostPath 目录）、支持怎样的访问方式、Pod 用完它之后如何回收。PV 是集群级资源，不属于任何命名空间，通常由管理员创建。另一端是使用者的声明：持久卷声明（PersistentVolumeClaim，PVC）——命名空间内的对象，只说自己要什么：多大容量、什么访问模式、（可选）指定哪个 StorageClass。Pod 的清单里从不出现 PV，只写「我用哪个 PVC」——写应用的人不需要知道数据存在哪块盘上，这层隔离是刻意的。",
    },
    {
      type: "heading",
      text: "静态供给：从建卷到挂载的四步",
    },
    {
      type: "list",
      ordered: true,
      items: [
        "管理员创建 PV：声明容量、访问模式、回收策略与底层存储位置。",
        "用户创建 PVC：声明要多大、什么访问模式。",
        "控制面的卷控制器发现两者匹配，把 PVC 与 PV 绑定（互相写上对方的名字）。",
        "Pod 在 volumes 里引用 PVC；调度到节点后，kubelet 把对应的存储挂载进容器。",
      ],
    },
    {
      type: "paragraph",
      text: "绑定不是随机的，卷控制器只撮合「门当户对」的双方：PV 容量 ≥ PVC 申请量；PV 支持的访问模式覆盖 PVC 声明的模式；两边的 storageClassName 必须一致（都为「空」也算一致）。绑定成功时，PVC 上会多出 volumeName 字段指向 PV。找不到匹配的 PV 时，PVC 一直停在 Pending——这不是报错，而是等待：管理员补一块合适的 PV 进来，它当场绑定。静态供给因此需要提前规划。",
    },
    {
      type: "heading",
      text: "accessModes：存储的能力，不是锁",
    },
    {
      type: "paragraph",
      text: "访问模式描述的是底层存储的物理能力：同一时刻能被几个节点以什么方式挂载。它不是配额，更不是给卷上的锁。三种取值如下。",
    },
    {
      type: "table",
      caption: "accessModes 三值：能力声明",
      headers: ["取值", "语义", "典型底层存储"],
      rows: [
        ["ReadWriteOnce（RWO）", "单节点读写：同一时刻只能被一个节点挂载读写", "云盘、本地盘、hostPath"],
        ["ReadOnlyMany（ROX）", "多节点同时只读", "共享只读数据集、NFS"],
        ["ReadWriteMany（RWX）", "多节点同时读写", "NFS、分布式文件系统"],
      ],
    },
    {
      type: "paragraph",
      text: "最容易误会的是「单节点」三个字。RWO 说的是底层存储同一时刻只能挂到一台机器上——一块云盘物理上无法同时挂到两台虚拟机——而不是「只允许一个 Pod 用它」。同一节点上的多个 Pod 完全可以同时引用同一块 RWO 卷；真正会出问题的是让两个 Pod 在不同节点上同时挂它。RWX 同理，不是「允许多少个 Pod」的配额，而是「多节点可同时读写」的能力声明。把 accessModes 当能力而不是锁，很多疑虑就不会再困扰你。",
    },
    {
      type: "heading",
      text: "reclaimPolicy：PVC 删除后，卷怎么办",
    },
    {
      type: "paragraph",
      text: "回收策略声明在 PV 上（动态供给时也可由 StorageClass 统一设定），回答：PVC 被删除后，这块 PV 何去何从。两种主流取值。Delete：PV 对象被自动删除；动态供给的卷还会由 provisioner 把底层存储一并删掉，数据随之消失。Retain：PV 进入 Released 状态，对象与数据都保留，但不再参与绑定——它不会自动被别的 PVC 领走。Retain 之后的回收是管理员的手工活：确认数据确实可以丢弃 → 删除 PV 对象 → 清理或复用底层存储。k8s 的原则是：拿不准时宁可让卷闲置在 Released，也绝不自动销毁数据。早期还有一个 Recycle 策略，已经废弃，不用学。",
    },
    {
      type: "callout",
      variant: "warning",
      title: "删 PVC 之前，先看回收策略",
      body: "回收策略直接决定「删掉一个 PVC」是只撕掉一张申请单，还是连底层数据一起销毁。删除 PVC 前，先确认 PV（或 StorageClass）上的 reclaimPolicy，并确认自己已有备份。演示环境随便删；生产环境删前先演练。",
    },
    {
      type: "heading",
      text: "kind 实操：hostPath 静态供给全流程",
    },
    {
      type: "paragraph",
      text: "下面用 hostPath PV 在 kind 上把整条链路走一遍。hostPath 上一课被定性为「不适合生产数据」，但作为教学道具它很称职：不需要云账号、不需要额外组件，行为与真实静态供给一致。前提：已连上 k8s-course 集群，示例统一用 shop 命名空间。先执行 kubectl get storageclass 确认集群里没有任何存储类——kind 默认不装，这是后面 PVC 能匹配上无类静态 PV 的前提。",
    },
    {
      type: "code",
      title: "shop-db-pv.yaml：管理员建 PV（Retain）",
      language: "yaml",
      code: `apiVersion: v1
kind: PersistentVolume
metadata:
  name: shop-db-pv
spec:
  capacity:
    storage: 1Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  # hostPath 在 kind 的节点容器里扮演「一块真实盘」
  hostPath:
    path: /mnt/k8s/shop-db
    type: DirectoryOrCreate
  # hostPath 目录只存在于这台节点上，用 nodeAffinity 把卷钉在 worker-1
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
      text: "capacity 声明容量，accessModes 声明能力，persistentVolumeReclaimPolicy: Retain 表示「PVC 删了之后卷要留着观察」，hostPath 给出底层位置。nodeAffinity 是 hostPath 卷的必需品：目录只存在于 worker-1，必须声明「消费这块 PV 的 Pod 只能调度到这台节点」，否则 Pod 可能被调度到没有该目录的节点而挂载失败。真实的云盘 PV 通常不需要钉节点——存储的可达性由存储系统本身保证。",
    },
    {
      type: "code",
      title: "建卷并确认状态",
      language: "bash",
      code: `kubectl apply -f shop-db-pv.yaml
kubectl get pv`,
    },
    {
      type: "paragraph",
      text: "预期在 kubectl get pv 的输出里看到 shop-db-pv，STATUS 列为 Available——它正等待被认领。注意这里不需要 -n shop：PV 是集群资源，不属于任何命名空间。",
    },
    {
      type: "code",
      title: "shop-db-pvc.yaml：用户申请 PVC",
      language: "yaml",
      code: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shop-db-pvc
  namespace: shop
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: ""
  resources:
    requests:
      storage: 1Gi`,
    },
    {
      type: "paragraph",
      text: "PVC 只说自己要什么：1Gi、单节点读写。storageClassName 写成空字符串是刻意为之：它表示「明确不走任何存储类、只匹配无类的静态 PV」。在老版本 kind（无默认存储类）里省略该字段效果相同；2026 年起的较新 kind 会自带默认存储类，省略会被动态供给截获——显式写成空值在任何环境下语义都确定，不会被集群里出现的默认存储类悄悄改变行为。",
    },
    {
      type: "code",
      title: "申请并观察绑定",
      language: "bash",
      code: `kubectl apply -f shop-db-pvc.yaml
kubectl -n shop get pvc
kubectl get pv`,
    },
    {
      type: "paragraph",
      text: "apply 之后几乎立刻能看到 PVC 变成 Bound，VOLUME 列指向 shop-db-pv；同时这块 PV 的 STATUS 也从 Available 变成 Bound。绑定动作由 kube-controller-manager 里的卷控制器完成——第 1 章《集群解剖：一次部署请求的旅程》讲过控制器管理器把实际状态拉向期望状态，这里就是活例子：它 watch 到新 PVC，扫描 Available 的 PV，按容量、访问模式、类名撮合，再给双方互写名字。",
    },
    {
      type: "code",
      title: "db-writer.yaml：Pod 引用 PVC",
      language: "yaml",
      code: `apiVersion: v1
kind: Pod
metadata:
  name: db-writer
  namespace: shop
spec:
  containers:
    - name: writer
      image: busybox:1.36
      command: ["sh", "-c", "echo order-1001 >> /data/orders.log; sleep 3600"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: shop-db-pvc`,
    },
    {
      type: "code",
      title: "写入、删 Pod、重建后读回",
      language: "bash",
      code: `kubectl apply -f db-writer.yaml
kubectl -n shop get pod db-writer -w   # 等它 Running

kubectl -n shop exec db-writer -- cat /data/orders.log   # 看到 order-1001

kubectl -n shop delete pod db-writer    # 模拟 Pod 死亡
kubectl apply -f db-writer.yaml         # 用同一份清单重建
kubectl -n shop get pod db-writer -w    # 等新 Pod Running

kubectl -n shop exec db-writer -- cat /data/orders.log   # order-1001 还在`,
    },
    {
      type: "paragraph",
      text: "对比上一课：如果数据写在 emptyDir 里，Pod 一删就清零；这里 Pod 删了又建，文件原封不动——数据住在 PVC 背后的 PV 里，Pod 只是临时租客。PVC 是独立对象，不随 Pod 生死。实操里容易踩的坑是：PVC 正被 Pod 使用时直接删，会一直卡在 Terminating——PVC 上有保护机制（finalizer，第 9 章《控制器模式》会展开），要等引用它的 Pod 先消失才真正删除。所以下面观察回收策略时，先删 Pod 再删 PVC。",
    },
    {
      type: "code",
      title: "观察 Retain：PVC 删除后 PV 进入 Released",
      language: "bash",
      code: `kubectl -n shop delete pod db-writer
kubectl -n shop delete pvc shop-db-pvc
kubectl get pv   # shop-db-pv 仍在，STATUS 变为 Released`,
    },
    {
      type: "paragraph",
      text: "这就是 Retain 的语义：PVC 没了，PV 对象和数据都留着，但它已经「退役」——Released 状态的 PV 不会再自动绑定给新 PVC，防止数据被不知情的后来者领走。管理员的手动回收流程：确认数据可以丢弃 → kubectl delete pv shop-db-pv → 清理节点上的目录（kind 里执行 docker exec k8s-course-worker rm -rf /mnt/k8s/shop-db）→ 之后想复用同一路径，重新创建一块 PV 即可；数据还有价值，就先在集群外拷走再处置。",
    },
    {
      type: "paragraph",
      text: "再看 Delete 策略。把 shop-db-pv.yaml 复制一份另存为 shop-db-pv-del.yaml，只改三处：name 改为 shop-db-pv-del、persistentVolumeReclaimPolicy 改为 Delete、hostPath.path 改为 /mnt/k8s/shop-db-del。然后照前面的流程走一遍：apply 新 PV → 建 PVC shop-db-pvc-del（同样 1Gi / ReadWriteOnce / 空存储类）→ 等 Bound → 删 PVC。",
    },
    {
      type: "code",
      title: "观察 Delete：PVC 删除后 PV 自动消失",
      language: "bash",
      code: `kubectl apply -f shop-db-pv-del.yaml
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shop-db-pvc-del
  namespace: shop
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: ""
  resources:
    requests:
      storage: 1Gi
EOF
kubectl -n shop get pvc   # Bound
kubectl -n shop delete pvc shop-db-pvc-del
kubectl get pv            # shop-db-pv-del 已经不存在`,
    },
    {
      type: "callout",
      variant: "note",
      title: "hostPath 的 Delete 只删对象，不删目录",
      body: "Delete 保证的是 PV 对象被删除；真正去删底层存储的是 provisioner。hostPath 没有外部 provisioner 可以调用，节点目录 /mnt/k8s/shop-db-del 里的内容会原样留下，需要自己清理（docker exec k8s-course-worker rm -rf /mnt/k8s/shop-db-del）。而在真实的动态供给场景里，Delete 意味着 provisioner 真的会去删云盘——这正是前面 warning 说「删前先看回收策略」的原因。",
    },
    {
      type: "heading",
      text: "StorageClass：从人工备卷到按需供给",
    },
    {
      type: "paragraph",
      text: "静态供给的痛点已经肉眼可见：每块卷都要管理员手工建、手工对容量，申请还可能落空。StorageClass（存储类）把「如何造一块卷」变成集群里的命名对象，让供给自动化。核心字段有两个：provisioner——谁来造卷（CSI 驱动的名字，下一课展开）；parameters——造卷的参数（盘的类型、性能档等，由驱动自行定义）。PVC 声明 storageClassName: <类名>，控制面就按这个类自动创建 PV 并绑定，全程不需要管理员出现——这就是动态供给。",
    },
    {
      type: "paragraph",
      text: "集群还可以把某个 StorageClass 标记为 default：PVC 不写 storageClassName 时自动使用默认类。所以「PVC 里省略 storageClassName」在云上通常意味着「走默认动态供给」，而不是「匹配静态 PV」——本课演示显式写空字符串，正是为了绕开这个隐式默认。判断集群有没有默认类：检查 StorageClass 上是否带注解 storageclass.kubernetes.io/is-default-class（值为 true 的就是默认类，用 kubectl describe storageclass <名字> 查看注解）。",
    },
    {
      type: "paragraph",
      text: "在老版本 kind 上体验动态供给，需要先安装一个把节点本地目录变成动态卷的组件——最常见的是 local-path-provisioner 这类本地路径供给器，安装步骤以该组件的官方文档为准（本课不粘贴未核实的清单）。2026 年发布的较新 kind 会在创建集群时自动部署 local-path-provisioner 并注册默认存储类，无需手动安装——先 `kubectl get storageclass` 看集群里有没有默认类即可。装好（或自带）后，建 PVC 写上该类名字，就能看到 PV 被自动创建、PVC 很快 Bound。理解了机制即可——本章后续示例都走静态供给，不依赖额外组件。",
    },
    {
      type: "paragraph",
      text: "最后补一句 RWX 的现实方案：多副本同时读写同一份数据，底层必须是网络存储——生产里常见 NFS 或云厂商的共享文件系统，通过对应的 provisioner/CSI 驱动供给。kind 的本地目录做不到跨节点共享，本课不演示 RWX。选型结论先记住：单副本读写用 RWO 的云盘/本地盘，多副本共享读写才需要 RWX 网络存储。",
    },
    {
      type: "quiz",
      question:
        "管理员预建了一块 1Gi、ReadWriteOnce、Retain 的静态 PV。开发者提交了一个申请 2Gi 的 PVC，会发生什么？",
      options: [
        "立即绑定，超出容量的部分被截断",
        "PVC 一直停在 Pending，直到出现容量足够的 Available PV",
        "PVC 自动触发动态供给，创建一个 2Gi 的 PV",
        "PVC 创建被拒绝，kubectl apply 直接报错",
      ],
      answer: 1,
      explanation:
        "绑定的硬条件之一是 PV 容量 ≥ PVC 申请量。1Gi 的 PV 满足不了 2Gi 的申请，PVC 就停在 Pending 等待，不会报错——补一块合适的 PV 进来它会当场绑定。「截断」违背 PVC 的语义：PVC 是声明不是分配，超出部分根本不存在。触发动态供给需要 PVC 指定 StorageClass 且集群装了对应 provisioner，静态 PV 场景不会发生。PVC 对象本身合法，apply 必然成功，谈不上被拒绝。",
    },
    {
      type: "quiz",
      question: "删除 PVC 后，你看到 PV 进入 Released 状态且对象仍在。这说明什么？",
      options: [
        "该 PV 的回收策略是 Delete",
        "该 PV 的回收策略是 Retain，正在等待管理员手动回收",
        "Delete 回收的中间态，过一会儿 PV 会自动消失",
        "该 PV 仍被某个 Pod 使用",
      ],
      answer: 1,
      explanation:
        "Released 是 Retain 的典型结果：PVC 删除后 PV 对象与数据都保留、但不再自动参与绑定，等管理员手动处置（删对象、清理或复用底层存储）。Delete 策略下 PV 对象会被直接删除，不会留下 Released 状态可观察。「中间态」不成立。若 PV 仍被 Pod 使用，PVC 的删除会被保护机制挂起（Terminating），PVC 都删不掉，更不会触发 PV 回收。",
    },
    {
      type: "keypoints",
      items: [
        "PV 是集群级存储资产（管理员建），PVC 是命名空间级申请单（用户写），Pod 只认 PVC——存储与使用彻底解耦。",
        "绑定撮合规则：PV 容量 ≥ PVC 申请、访问模式覆盖、storageClassName 一致（都为空也算一致）。",
        "accessModes 是底层存储的能力声明（单/多节点 × 读/写），不是锁也不是 Pod 配额。",
        "reclaimPolicy：Delete 删 PV（动态供给连底层数据一起删）；Retain 留成 Released 等管理员手动回收；Recycle 已废弃。",
        "StorageClass = provisioner + parameters，让供给自动化；默认类会截获不写类名的 PVC，显式写空串表示不走任何类。",
        "kind 实操链路：建 PV → 建 PVC → Bound → Pod 挂载读写 → 删 PVC 观察 Retain/Delete 差异；hostPath 的 Delete 不清理节点目录。",
      ],
    },
  ],
};
